// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockPermit2} from "./MockPermit2.sol";
import {MockRouter} from "./MockRouter.sol";
import {SigHelpers} from "./SigHelpers.sol";

/// @dev Shared fixture for #24/#25/#26/#28 tests. A plain EOA stands in for the
///      TimelockController (it holds CONFIG_ROLE + GUARDIAN_ROLE + DEFAULT_ADMIN),
///      so config setup is direct. Admin.t.sol (#27) deploys a REAL
///      TimelockController to test the delay and boundaries.
abstract contract Harness is Test, SigHelpers {
    PaymentRouter public router;
    MockERC20 public usdc; // settlement token, 6 decimals
    MockERC20 public weth; // cross-asset input, 18 decimals
    MockPermit2 public permit2;
    MockRouter public dex;
    MockRouter public badDex; // unwhitelisted, for the whitelist-revert test

    uint256 public adminPk; // timelock stand-in + guardian
    address public admin;
    uint256 public signerPk; // backend quote-signing key
    address public signerAddr;
    address public treasury;
    address public merchant;
    address public customer; // payer + refundTo

    uint256 internal constant FAR_FUTURE = type(uint48).max;

    /// @dev Reference copy of the public event for `vm.expectEmit` matching. The
    ///      topic is the keccak256 of the signature, identical to the contract's,
    ///      so the match is exact without inheriting the interface.
    event PaymentCompleted(
        bytes32 indexed intentId,
        address indexed merchantSafe,
        address indexed refundTo,
        address inputAsset,
        address settlementAsset,
        uint256 inputAmount,
        uint256 settledAmount,
        uint256 fee,
        uint256 refundAmount,
        uint256 deadline
    );

    function setUp() public virtual {
        adminPk = 0xA11CE;
        admin = vm.addr(adminPk);
        signerPk = 0xB0B;
        signerAddr = vm.addr(signerPk);
        treasury = makeAddr("treasury");
        merchant = makeAddr("merchant");
        customer = makeAddr("customer");

        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        permit2 = new MockPermit2();
        dex = new MockRouter();
        badDex = new MockRouter();

        router = new PaymentRouter({
            timelock: admin,
            guardian: admin,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementAssets: _oneSettlementAsset(address(usdc)),
            permit2_: address(permit2)
        });

        // admin holds CONFIG_ROLE → whitelists directly.
        vm.startPrank(admin);
        router.addRouter(address(dex));
        router.addInputAsset(address(weth));
        router.addInputAsset(address(usdc)); // same-asset path: settlement is also an input
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Order helpers
    // ------------------------------------------------------------------

    function order(
        bytes32 intentId,
        uint256 minOut,
        uint256 fee,
        uint256 deadline
    ) internal view returns (IPaymentRouter.Order memory) {
        return makeOrder(intentId, address(usdc), minOut, fee, merchant, customer, deadline);
    }

    function sign(IPaymentRouter.Order memory o) internal returns (bytes memory) {
        return signOrder(address(router), o, signerPk);
    }

    function deadlineIn(uint256 secs) internal view returns (uint256) {
        return block.timestamp + secs;
    }

    // ------------------------------------------------------------------
    // Permit2 helpers
    // ------------------------------------------------------------------

    function buildPermit(address token, uint256 amount, uint48 nonce)
        internal
        view
        returns (IPermit2.PermitSingle memory)
    {
        return IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token: token,
                amount: uint160(amount),
                expiration: uint48(FAR_FUTURE),
                nonce: nonce
            }),
            spender: address(router),
            sigDeadline: FAR_FUTURE
        });
    }

    function encodePermit(IPermit2.PermitSingle memory p) internal pure returns (bytes memory) {
        return abi.encode(p, ""); // MockPermit2 ignores the sig; real sig is fork-tested.
    }

    /// @dev Mints `amount` of `token` to `who` and approves the Permit2 mock to pull.
    function fund(address token, address who, uint256 amount) internal {
        MockERC20(token).mint(who, amount);
        vm.prank(who);
        MockERC20(token).approve(address(permit2), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // Swap calldata helpers
    // ------------------------------------------------------------------

    /// @dev ERC-20 swap: pulls `inputAmount` from the router, delivers `output`
    ///      of `usdc` to the router. Mint `output` to `dex` first.
    function ercSwapData(address inputToken, uint256 inputAmount, uint256 output)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            MockRouter.swap.selector, inputToken, inputAmount, address(usdc), output, address(router)
        );
    }

    /// @dev Native swap: consumes msg.value, delivers `output` of `usdc` to the router.
    function ethSwapData(uint256 output) internal view returns (bytes memory) {
        return abi.encodeWithSelector(MockRouter.swapFromETH.selector, address(usdc), output, address(router));
    }

    /// @dev Exact-output native swap: delivers `output` and hands `nativeRefund`
    ///      of the unspent value back to the PaymentRouter mid-call.
    function ethSwapDataWithRefund(uint256 output, uint256 nativeRefund)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            MockRouter.swapFromETHWithRefund.selector,
            address(usdc),
            output,
            address(router),
            nativeRefund
        );
    }

    /// @dev Partial fill: the router consumes only `consume` of the `inputAmount`
    ///      the PaymentRouter holds, stranding the rest.
    function ercPartialSwapData(address inputToken, uint256 consume, uint256 output)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            MockRouter.partialSwap.selector, inputToken, consume, address(usdc), output, address(router)
        );
    }
}