// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {SigHelpers} from "./helpers/SigHelpers.sol";

/// @title RealPermit2Test — gated fork test against the canonical Permit2 (#29)
/// @dev Skips cleanly when `BASE_SEPOLIA_RPC_URL` is unset, mirroring the repo's
///      `DATABASE_URL`-gated Postgres tests (`packages/db/test/postgres.test.ts`).
///      Run with: `BASE_SEPOLIA_RPC_URL=… forge test --match-contract RealPermit2Test`.
///
///      Exercises the real Permit2 `permit` + `transferFrom` at the canonical
///      address — the integration the MockPermit2 unit tests do not cover (the
///      mock does not re-verify the payer's EIP-712 signature). The same-asset
///      path (input == settlement token) is used so the test needs no real DEX:
///      it isolates the Permit2 surface (the real risk), not swap logic.
///
///      The settlement token is a freshly deployed `MockERC20` on the fork — the
///      test's purpose is the real Permit2 path, not real USDC, so a mock
///      settlement keeps it self-contained and deterministic.
contract RealPermit2Test is Test, SigHelpers {
    /// @dev Canonical Uniswap Permit2 — same address on every chain where deployed.
    address internal constant PERMIT2 = 0x0000000000001fF3684f28c67538d4D072C22734;

    PaymentRouter public router;
    MockERC20 public token; // settlement + input (same-asset path)

    uint256 internal adminPk; // timelock stand-in (holds CONFIG_ROLE)
    address internal admin;
    uint256 internal signerPk; // backend quote-signing key
    address internal signerAddr;
    address internal treasury;
    address internal merchant;
    uint256 internal customerPk; // payer + refundTo
    address internal customer;

    bytes32 internal constant INTENT = keccak256("intent-real-permit2");
    uint48 internal constant NONCE = 0;

    // ------------------------------------------------------------------
    // Permit2 EIP-712 signing
    // ------------------------------------------------------------------
    // Domain: EIP712Domain(string name,uint256 chainId,address verifyingContract)
    //         name = "Permit2", verifyingContract = canonical Permit2.
    // PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)
    // PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)
    // The typehashes below match Uniswap's IAllowanceTransfer exactly; verify
    // against the real Permit2 on the first run (the test is skipped until an RPC
    // is provided, so a format mismatch surfaces only then).
    bytes32 internal constant PERMIT2_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 internal constant PERMIT_DETAILS_TYPEHASH =
        keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)");
    bytes32 internal constant PERMIT_SINGLE_TYPEHASH =
        keccak256(
            "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)"
            "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
        );

    function setUp() public {
        string memory emptyRpc = "";
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", emptyRpc);
        if (bytes(rpc).length == 0) {
            vm.skip(true, "BASE_SEPOLIA_RPC_URL not set; skipping real Permit2 fork test");
        }
        vm.createSelectFork(rpc);
        // Defensive: if Permit2 is not deployed at canonical on this fork, skip
        // rather than fail with a confusing call-to-non-contract error.
        if (PERMIT2.code.length == 0) {
            vm.skip(true, "Permit2 not deployed at canonical address on this fork");
        }

        adminPk = 0xA11CE;
        admin = vm.addr(adminPk);
        signerPk = 0xB0B;
        signerAddr = vm.addr(signerPk);
        treasury = makeAddr("treasury");
        merchant = makeAddr("merchant");
        customerPk = 0xCAB;
        customer = vm.addr(customerPk);

        // Settlement token = input token (same-asset path → no DEX needed).
        token = new MockERC20("Test Settle", "TST", 6);

        router = new PaymentRouter({
            timelock: admin,
            guardian: admin,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementAssets: _oneSettlementAsset(address(token)),
            permit2_: PERMIT2
        });

        // admin holds CONFIG_ROLE → whitelists the settlement token as an input.
        vm.prank(admin);
        router.addInputAsset(address(token));

        // Fund the customer and approve the REAL Permit2 to pull — as any owner
        // must before Permit2.transferFrom calls token.transferFrom.
        token.mint(customer, 200e6);
        vm.prank(customer);
        token.approve(PERMIT2, type(uint256).max);
    }

    /// @dev Permit2 domain separator for this chain (name="Permit2", no version).
    function permit2DomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(PERMIT2_DOMAIN_TYPEHASH, keccak256("Permit2"), block.chainid, PERMIT2)
        );
    }

    /// @dev EIP-712 digest of a PermitSingle, as the real Permit2 verifies it.
    function permit2Digest(IPermit2.PermitSingle memory p) internal view returns (bytes32) {
        bytes32 detailsHash = keccak256(
            abi.encode(
                PERMIT_DETAILS_TYPEHASH, p.details.token, p.details.amount, p.details.expiration, p.details.nonce
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_SINGLE_TYPEHASH, detailsHash, p.spender, p.sigDeadline));
        return keccak256(abi.encodePacked(hex"1901", permit2DomainSeparator(), structHash));
    }

    /// @dev Signs `p` with `pk` → 65-byte `r ‖ s ‖ v` blob the real Permit2 expects.
    function signPermit2(IPermit2.PermitSingle memory p, uint256 pk)
        internal
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, permit2Digest(p));
        return abi.encodePacked(r, s, v);
    }

    function encodePermit(IPermit2.PermitSingle memory p, bytes memory sig)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(p, sig);
    }

    // ------------------------------------------------------------------
    // Real Permit2 happy path
    // ------------------------------------------------------------------

    function test_real_permit2_pull_and_settle() public {
        uint256 inputAmount = 200e6;
        uint256 minOut = 150e6;
        uint256 fee = 5e6;
        uint256 expires = block.timestamp + 3600;

        IPermit2.PermitSingle memory p = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token: address(token),
                amount: uint160(inputAmount),
                expiration: uint48(expires),
                nonce: NONCE
            }),
            spender: address(router),
            sigDeadline: expires
        });
        bytes memory permitSig = signPermit2(p, customerPk);

        IPaymentRouter.Order memory o =
            makeOrder(INTENT, address(token), minOut, fee, merchant, customer, expires);
        bytes memory orderSig = signOrder(address(router), o, signerPk);

        uint256 m0 = token.balanceOf(merchant);
        uint256 t0 = token.balanceOf(treasury);

        // Customer is msg.sender = Permit2 `owner`; the signed permit binds to them.
        vm.prank(customer);
        router.payERC20(o, encodePermit(p, permitSig), orderSig, address(0), "");

        assertEq(token.balanceOf(merchant) - m0, minOut - fee, "merchant settled");
        assertEq(token.balanceOf(treasury) - t0, fee, "treasury fee");
        assertEq(token.balanceOf(customer), inputAmount - minOut, "customer refund");
        assertTrue(router.consumed(INTENT), "intent consumed");
        assertEq(token.balanceOf(address(router)), 0, "zero resting balance");
    }
}