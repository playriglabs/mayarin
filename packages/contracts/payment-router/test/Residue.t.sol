// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {Harness} from "./helpers/Harness.sol";

/// @dev Regressions for the baseline-relative resting-balance check (#25/#26/#28).
///
///      The original check asserted absolute zero. Anyone can move tokens to any
///      address, so 1 wei of the settlement token sent to the router was enough to
///      make every subsequent payment revert — permanently, since there is no
///      sweep and no admin recovery path. These tests pin both halves of the fix:
///      a donation is inert (it neither bricks a payment nor counts as swap
///      output), and value that genuinely arrives mid-call — unconsumed input, a
///      route's native refund — leaves to `refundTo` instead of resting here.
contract ResidueTest is Harness {
    bytes32 internal constant INTENT = keccak256("intent-residue");
    uint48 internal constant NONCE = 7;

    event ResidueRefunded(
        bytes32 indexed intentId, address indexed asset, address indexed to, uint256 amount
    );

    function setUp() public override {
        super.setUp();
        usdc.mint(address(dex), 1_000_000e6);
        vm.deal(customer, 100 ether);
    }

    // ------------------------------------------------------------------
    // A donation must not brick the contract
    // ------------------------------------------------------------------

    function test_donated_settlement_dust_does_not_brick_payEth() public {
        uint256 dust = 1; // one wei of USDC — the whole attack
        usdc.mint(address(router), dust);

        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);

        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(120e6));

        assertEq(usdc.balanceOf(merchant), 99e6, "merchant settled through the donation");
        assertEq(usdc.balanceOf(address(router)), dust, "donation still stuck, still unsweepable");
    }

    function test_donated_native_dust_does_not_brick_payEth() public {
        // `vm.deal` models a SELFDESTRUCT force-send: it bypasses `receive()`,
        // so no whitelist check can prevent it. Only a baseline can absorb it.
        vm.deal(address(router), 1 wei);

        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);

        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(120e6));

        assertEq(usdc.balanceOf(merchant), 99e6, "merchant settled");
        assertEq(address(router).balance, 1 wei, "forced native still stuck");
    }

    function test_donated_dust_does_not_brick_payERC20_sameAsset() public {
        usdc.mint(address(router), 1);
        uint256 inputAmount = 150e6;
        fund(address(usdc), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(usdc), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);

        vm.prank(customer);
        router.payERC20(o, encodePermit(p), sig, address(0), "");

        assertEq(usdc.balanceOf(merchant), 99e6, "merchant settled");
        assertEq(usdc.balanceOf(customer), 50e6, "excess refunded");
        assertEq(usdc.balanceOf(address(router)), 1, "donation untouched");
    }

    /// @dev The other half: a donation must not be usable to *top up* a short
    ///      swap. Output is measured as a delta against the baseline, so dust
    ///      sitting in the contract cannot help a route clear `minOut`.
    function test_donated_dust_is_not_counted_as_swap_output() public {
        uint256 minOut = 100e6;
        usdc.mint(address(router), 10e6); // more than the shortfall below

        IPaymentRouter.Order memory o = order(INTENT, minOut, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);

        vm.expectRevert(
            abi.encodeWithSelector(PaymentRouter.MinOutNotMet.selector, minOut - 1, minOut)
        );
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(minOut - 1));
    }

    function test_fuzz_donation_never_blocks_payment(uint256 dust, uint256 nativeDust) public {
        dust = bound(dust, 1, 1_000_000e6);
        nativeDust = bound(nativeDust, 1, 10 ether);
        usdc.mint(address(router), dust);
        vm.deal(address(router), nativeDust);

        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);

        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(120e6));

        assertEq(usdc.balanceOf(merchant), 99e6, "merchant settled");
        assertEq(usdc.balanceOf(address(router)), dust, "settlement donation conserved");
        assertEq(address(router).balance, nativeDust, "native donation conserved");
    }

    // ------------------------------------------------------------------
    // Value arriving mid-call leaves to refundTo
    // ------------------------------------------------------------------

    function test_payEth_native_refund_from_route_forwarded_to_refundTo() public {
        uint256 nativeRefund = 0.25 ether;
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        uint256 before = customer.balance;

        vm.expectEmit(true, true, true, true, address(router));
        emit ResidueRefunded(INTENT, address(0), customer, nativeRefund);

        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapDataWithRefund(120e6, nativeRefund));

        assertEq(before - customer.balance, 1 ether - nativeRefund, "unspent native came back");
        assertEq(address(router).balance, 0, "nothing rests");
    }

    function test_payERC20_partial_fill_input_residue_refunded() public {
        uint256 inputAmount = 1 ether; // WETH
        uint256 consumed = 0.6 ether; // the route fills against less liquidity
        fund(address(weth), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(weth), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);

        vm.expectEmit(true, true, true, true, address(router));
        emit ResidueRefunded(INTENT, address(weth), customer, inputAmount - consumed);

        vm.prank(customer);
        router.payERC20(
            o, encodePermit(p), sig, address(dex), ercPartialSwapData(address(weth), consumed, 120e6)
        );

        assertEq(weth.balanceOf(customer), inputAmount - consumed, "unconsumed input returned");
        assertEq(weth.balanceOf(address(router)), 0, "no input rests");
        assertEq(usdc.balanceOf(merchant), 99e6, "merchant settled");
        assertEq(usdc.balanceOf(address(router)), 0, "no settlement rests");
    }

    // ------------------------------------------------------------------
    // receive() is bounded
    // ------------------------------------------------------------------

    function test_receive_accepts_only_whitelisted_router() public {
        vm.deal(address(dex), 1 ether);
        vm.prank(address(dex));
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertTrue(ok, "whitelisted router may hand native back");
        assertEq(address(router).balance, 1 ether);
    }

    function test_receive_rejects_arbitrary_sender() public {
        vm.prank(customer);
        (bool ok, bytes memory ret) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "casual donation rejected");
        assertEq(bytes4(ret), PaymentRouter.UnexpectedNative.selector);
    }
}
