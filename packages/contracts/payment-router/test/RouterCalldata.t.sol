// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {Harness} from "./helpers/Harness.sol";

/// @dev The contract half of the #49 round-trip.
///
///      `packages/providers/evm` builds the calldata that `PaymentRouter` runs.
///      TypeScript encoding a struct the way Solidity decodes it is exactly the
///      kind of thing that is right until someone reorders a field, so the
///      fixture it emits is verified here two independent ways:
///
///      1. **Byte equality** — re-encode the same inputs with
///         `abi.encodeWithSelector` and compare. Catches a wrong selector, a
///         reordered field, a mis-sized integer, a bad tuple layout.
///      2. **The contract accepts it** — call the deployed router with the
///         fixture bytes verbatim and require the revert to be `InvalidSigner`.
///         Reaching signature verification means the selector matched a real
///         function, the ABI decode succeeded, and every field landed where the
///         contract reads it. A malformed encoding fails earlier and differently,
///         so this is a real acceptance check rather than a shape assertion.
///
///      The fixture's signature is deliberately a dummy — the EIP-712 domain
///      binds to the router's deployed address, which an address-agnostic fixture
///      cannot know. Getting as far as `InvalidSigner` is the assertion.
contract RouterCalldataTest is Harness {
    string internal constant FIXTURE_PATH = "./test/fixtures/router-calldata.json";

    string internal fixture;
    IPaymentRouter.Order internal fixtureOrder;
    bytes internal fixtureSignature;
    address internal fixtureDex;
    bytes internal fixtureSwapData;

    function setUp() public override {
        super.setUp();
        fixture = vm.readFile(FIXTURE_PATH);
        fixtureOrder = IPaymentRouter.Order({
            intentId: vm.parseJsonBytes32(fixture, ".order.intentId"),
            minOut: vm.parseJsonUint(fixture, ".order.minOut"),
            fee: vm.parseJsonUint(fixture, ".order.fee"),
            merchantSafe: vm.parseJsonAddress(fixture, ".order.merchantSafe"),
            refundTo: vm.parseJsonAddress(fixture, ".order.refundTo"),
            deadline: vm.parseJsonUint(fixture, ".order.deadline")
        });
        fixtureSignature = vm.parseJsonBytes(fixture, ".signature");
        fixtureDex = vm.parseJsonAddress(fixture, ".dex");
        fixtureSwapData = vm.parseJsonBytes(fixture, ".swapCallData");
    }

    // ------------------------------------------------------------------
    // 1. Byte equality
    // ------------------------------------------------------------------

    function test_payEth_calldata_matches_solidity_encoding() public view {
        assertEq(
            vm.parseJsonBytes(fixture, ".payEthCalldata"),
            abi.encodeWithSelector(
                IPaymentRouter.payEth.selector,
                fixtureOrder,
                fixtureSignature,
                fixtureDex,
                fixtureSwapData
            ),
            "payEth calldata"
        );
    }

    function test_payERC20_crossAsset_calldata_matches_solidity_encoding() public view {
        assertEq(
            vm.parseJsonBytes(fixture, ".payErc20CrossCalldata"),
            abi.encodeWithSelector(
                IPaymentRouter.payERC20.selector,
                fixtureOrder,
                abi.encode(_permit(vm.parseJsonAddress(fixture, ".permit.token")), _permitSig()),
                fixtureSignature,
                fixtureDex,
                fixtureSwapData
            ),
            "payERC20 cross-asset calldata"
        );
    }

    /// @dev Same-asset carries no route at all — `address(0)` and empty calldata,
    ///      which is what makes the contract skip the router entirely.
    function test_payERC20_sameAsset_calldata_matches_solidity_encoding() public view {
        assertEq(
            vm.parseJsonBytes(fixture, ".payErc20SameCalldata"),
            abi.encodeWithSelector(
                IPaymentRouter.payERC20.selector,
                fixtureOrder,
                abi.encode(_permit(vm.parseJsonAddress(fixture, ".usdc")), _permitSig()),
                fixtureSignature,
                address(0),
                bytes("")
            ),
            "payERC20 same-asset calldata"
        );
    }

    // ------------------------------------------------------------------
    // 2. The contract accepts it
    // ------------------------------------------------------------------

    function test_contract_decodes_payEth_calldata() public {
        // Whitelist the fixture's router so the call cannot stop at
        // RouterNotWhitelisted before reaching signature verification.
        vm.prank(admin);
        router.addRouter(fixtureDex);

        uint256 value = vm.parseJsonUint(fixture, ".value");
        vm.deal(customer, value);
        vm.prank(customer);
        (bool ok, bytes memory ret) =
            address(router).call{value: value}(vm.parseJsonBytes(fixture, ".payEthCalldata"));

        assertFalse(ok, "the dummy signature must not verify");
        assertEq(bytes4(ret), PaymentRouter.InvalidSigner.selector, "decoded, reached the signer check");
    }

    function test_contract_decodes_payERC20_calldata() public {
        vm.prank(admin);
        router.addInputAsset(vm.parseJsonAddress(fixture, ".weth"));

        vm.prank(customer);
        (bool ok, bytes memory ret) =
            address(router).call(vm.parseJsonBytes(fixture, ".payErc20CrossCalldata"));

        assertFalse(ok, "the dummy signature must not verify");
        assertEq(bytes4(ret), PaymentRouter.InvalidSigner.selector, "decoded, reached the signer check");
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _permit(address token) internal view returns (IPermit2.PermitSingle memory) {
        return IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token: token,
                amount: uint160(vm.parseJsonUint(fixture, ".permit.amount")),
                expiration: uint48(vm.parseJsonUint(fixture, ".permit.expiration")),
                nonce: uint48(vm.parseJsonUint(fixture, ".permit.nonce"))
            }),
            spender: vm.parseJsonAddress(fixture, ".permit.spender"),
            sigDeadline: vm.parseJsonUint(fixture, ".permit.sigDeadline")
        });
    }

    function _permitSig() internal view returns (bytes memory) {
        return vm.parseJsonBytes(fixture, ".permitSignature");
    }
}
