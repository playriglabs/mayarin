// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {MockPermit2} from "./helpers/MockPermit2.sol";
import {Harness} from "./helpers/Harness.sol";

/// @dev #26 — payERC20 via Permit2, input-asset whitelist, same-asset no-op.
///      The caller is the token owner (the customer); `msg.sender` is the Permit2
///      `owner`, so the customer's signed permit binds to themselves — a relayer
///      cannot reuse it (gas-abstraction/relayer support is a later phase).
contract PayERC20Test is Harness {
    bytes32 internal constant INTENT = keccak256("intent-erc20");
    uint48 internal constant NONCE = 1;

    function setUp() public override {
        super.setUp();
        // Mock router needs settlement tokens to deliver on a cross-asset swap.
        usdc.mint(address(dex), 1_000_000e6);
    }

    function _crossAssetOrder(uint256 minOut, uint256 fee)
        internal
        returns (IPaymentRouter.Order memory, bytes memory, bytes memory, uint256)
    {
        uint256 inputAmount = 1 ether; // 1e18 WETH
        // Customer holds WETH and has approved Permit2 to pull.
        fund(address(weth), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(weth), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, minOut, fee, deadlineIn(3600));
        bytes memory sig = sign(o);
        return (o, sig, encodePermit(p), inputAmount);
    }

    // ------------------------------------------------------------------
    // Cross-asset swap path (18-dec WETH → 6-dec USDC)
    // ------------------------------------------------------------------

    function test_payERC20_crossAsset_happy_path() public {
        uint256 minOut = 100e6; // USDC minor units (6 dec)
        uint256 fee = 1e6;
        uint256 output = 120e6;
        (IPaymentRouter.Order memory o, bytes memory sig, bytes memory permitData, uint256 inputAmount) =
            _crossAssetOrder(minOut, fee);

        uint256 m0 = usdc.balanceOf(merchant);
        uint256 t0 = usdc.balanceOf(treasury);
        uint256 c0 = usdc.balanceOf(customer);

        vm.prank(customer);
        router.payERC20(o, permitData, sig, address(dex), ercSwapData(address(weth), inputAmount, output));

        assertEq(usdc.balanceOf(merchant) - m0, minOut - fee, "merchant");
        assertEq(usdc.balanceOf(treasury) - t0, fee, "treasury");
        assertEq(usdc.balanceOf(customer) - c0, output - minOut, "refund");
        assertEq(weth.balanceOf(customer), 0, "payer fully spent");
        assertEq(weth.balanceOf(address(dex)), inputAmount, "router received input");
        assertTrue(router.consumed(INTENT));
        assertEq(address(router).balance, 0, "native resting");
        assertEq(usdc.balanceOf(address(router)), 0, "token resting");
    }

    function test_payERC20_decimal_18_to_6_no_decimal_math() public {
        // WETH is 18-dec, USDC is 6-dec. The contract moves raw uint256 minor
        // units and compares only in settlement-asset terms after the swap. The
        // 18→6 conversion is the router's job; the contract never scales.
        uint256 inputAmount = 0.5 ether; // 5e17 WETH
        uint256 minOut = 1500e6; // USDC
        fund(address(weth), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(weth), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, minOut, 5e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        uint256 output = 1600e6;
        vm.prank(customer);
        router.payERC20(o, encodePermit(p), sig, address(dex), ercSwapData(address(weth), inputAmount, output));
        assertEq(usdc.balanceOf(merchant), minOut - 5e6, "merchant gets USDC minor units");
        assertEq(usdc.balanceOf(customer), output - minOut, "excess in USDC minor units");
    }

    function test_payERC20_minOut_miss_reverts() public {
        uint256 minOut = 100e6;
        (IPaymentRouter.Order memory o, bytes memory sig, bytes memory permitData, uint256 inputAmount) =
            _crossAssetOrder(minOut, 1e6);
        uint256 shortOutput = 99e6;
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.MinOutNotMet.selector, shortOutput, minOut));
        router.payERC20(o, permitData, sig, address(dex), ercSwapData(address(weth), inputAmount, shortOutput));
        assertFalse(router.consumed(INTENT), "revert undoes consume");
    }

    function test_payERC20_nonWhitelisted_asset_reverts() public {
        MockERC20 doge = new MockERC20("Dogecoin", "DOGE", 8);
        fund(address(doge), customer, 1_000e8);
        IPermit2.PermitSingle memory p = buildPermit(address(doge), 1_000e8, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.AssetNotWhitelisted.selector, address(doge)));
        router.payERC20(o, encodePermit(p), sig, address(dex), ercSwapData(address(doge), 1_000e8, 100e6));
    }

    function test_payERC20_nonWhitelisted_router_reverts() public {
        uint256 minOut = 100e6;
        (IPaymentRouter.Order memory o, bytes memory sig, bytes memory permitData, uint256 inputAmount) =
            _crossAssetOrder(minOut, 1e6);
        usdc.mint(address(badDex), 1_000_000e6);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.RouterNotWhitelisted.selector, address(badDex)));
        router.payERC20(o, permitData, sig, address(badDex), ercSwapData(address(weth), inputAmount, 100e6));
    }

    function test_payERC20_replay_rejected() public {
        uint256 minOut = 100e6;
        (IPaymentRouter.Order memory o, bytes memory sig, bytes memory permitData, uint256 inputAmount) =
            _crossAssetOrder(minOut, 1e6);
        vm.prank(customer);
        router.payERC20(o, permitData, sig, address(dex), ercSwapData(address(weth), inputAmount, 100e6));
        // Second attempt: same intentId, fresh permit (new nonce) — still rejected.
        fund(address(weth), customer, inputAmount);
        IPermit2.PermitSingle memory p2 = buildPermit(address(weth), inputAmount, NONCE + 1);
        vm.prank(customer);
        vm.expectRevert(PaymentRouter.AlreadyConsumed.selector);
        router.payERC20(o, encodePermit(p2), sig, address(dex), ercSwapData(address(weth), inputAmount, 100e6));
    }

    function test_payERC20_reverts_when_paused() public {
        uint256 minOut = 100e6;
        (IPaymentRouter.Order memory o, bytes memory sig, bytes memory permitData, uint256 inputAmount) =
            _crossAssetOrder(minOut, 1e6);
        vm.prank(admin);
        router.pause();
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        router.payERC20(o, permitData, sig, address(dex), ercSwapData(address(weth), inputAmount, 100e6));
    }

    function test_payERC20_router_revert_bubbles() public {
        uint256 minOut = 100e6;
        (IPaymentRouter.Order memory o, bytes memory sig, bytes memory permitData, uint256 inputAmount) =
            _crossAssetOrder(minOut, 1e6);
        // revertingSwap ignores its calldata and reverts; carrying `inputAmount`
        // keeps the call shaped like a real swap attempt.
        bytes memory data = abi.encodeWithSelector(dex.revertingSwap.selector, inputAmount);
        vm.prank(customer);
        vm.expectRevert("mock: bad swap");
        router.payERC20(o, permitData, sig, address(dex), data);
    }

    // ------------------------------------------------------------------
    // Permit2 surface (structural — real sig crypto is fork-tested)
    // ------------------------------------------------------------------

    function test_payERC20_expired_permit_sigDeadline_reverts() public {
        uint256 inputAmount = 1 ether;
        fund(address(weth), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(weth), inputAmount, NONCE);
        p.sigDeadline = uint48(block.timestamp - 1); // expired sig
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.prank(customer);
        vm.expectRevert(MockPermit2.SigExpired.selector);
        router.payERC20(o, encodePermit(p), sig, address(dex), ercSwapData(address(weth), inputAmount, 100e6));
    }

    function test_payERC20_wrong_spender_reverts() public {
        uint256 inputAmount = 1 ether;
        fund(address(weth), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(weth), inputAmount, NONCE);
        p.spender = makeAddr("not-the-router"); // allowance goes to the wrong spender
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.prank(customer);
        vm.expectRevert(MockPermit2.InsufficientAllowance.selector);
        router.payERC20(o, encodePermit(p), sig, address(dex), ercSwapData(address(weth), inputAmount, 100e6));
    }

    function test_payERC20_permit_nonce_reuse_reverts() public {
        uint256 inputAmount = 1 ether;
        fund(address(weth), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(weth), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.prank(customer);
        router.payERC20(o, encodePermit(p), sig, address(dex), ercSwapData(address(weth), inputAmount, 120e6));
        // Reuse the same nonce with a fresh intent — Permit2 rejects the nonce.
        fund(address(weth), customer, inputAmount);
        bytes32 intent2 = keccak256("intent-erc20-2");
        IPaymentRouter.Order memory o2 = order(intent2, 100e6, 1e6, deadlineIn(3600));
        // Sign BEFORE expectRevert: sign() calls router.domainSeparatorV4(), a real
        // external call that would otherwise consume the revert expectation.
        bytes memory sig2 = sign(o2);
        vm.prank(customer);
        vm.expectRevert(MockPermit2.NonceAlreadyUsed.selector);
        router.payERC20(o2, encodePermit(p), sig2, address(dex), ercSwapData(address(weth), inputAmount, 120e6));
    }

    // ------------------------------------------------------------------
    // Same-asset no-op (input == settlement → no router call)
    // ------------------------------------------------------------------

    function test_payERC20_sameAsset_noop_no_router() public {
        uint256 inputAmount = 200e6; // USDC in, USDC settle
        uint256 minOut = 150e6;
        uint256 fee = 5e6;
        fund(address(usdc), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(usdc), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, minOut, fee, deadlineIn(3600));
        bytes memory sig = sign(o);

        uint256 dexBefore = usdc.balanceOf(address(dex));
        uint256 m0 = usdc.balanceOf(merchant);
        uint256 t0 = usdc.balanceOf(treasury);

        // router=0, data="" allowed for the same-asset no-op path.
        vm.prank(customer);
        router.payERC20(o, encodePermit(p), sig, address(0), "");

        assertEq(usdc.balanceOf(address(dex)) - dexBefore, 0, "router never called");
        assertEq(usdc.balanceOf(merchant) - m0, minOut - fee, "merchant");
        assertEq(usdc.balanceOf(treasury) - t0, fee, "treasury");
        // Customer paid in `inputAmount` and got back `inputAmount - minOut` as
        // refund, so their final balance equals the refund (== input − minOut).
        assertEq(usdc.balanceOf(customer), inputAmount - minOut, "customer holds the refund");
        assertTrue(router.consumed(INTENT));
        assertEq(usdc.balanceOf(address(router)), 0, "zero resting");
    }

    function test_payERC20_sameAsset_minOut_miss_reverts() public {
        uint256 inputAmount = 100e6;
        uint256 minOut = 150e6; // > input → output (==input) < minOut
        fund(address(usdc), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(usdc), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, minOut, 5e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.MinOutNotMet.selector, inputAmount, minOut));
        router.payERC20(o, encodePermit(p), sig, address(0), "");
    }

    function test_payERC20_sameAsset_exact_minOut_no_refund() public {
        uint256 inputAmount = 150e6;
        uint256 minOut = 150e6;
        uint256 fee = 10e6;
        fund(address(usdc), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(usdc), inputAmount, NONCE);
        IPaymentRouter.Order memory o = order(INTENT, minOut, fee, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.prank(customer);
        router.payERC20(o, encodePermit(p), sig, address(0), "");
        assertEq(usdc.balanceOf(merchant), minOut - fee, "merchant");
        assertEq(usdc.balanceOf(treasury), fee, "treasury");
        // No refund (output == minOut) → customer fully spent, final balance 0.
        assertEq(usdc.balanceOf(customer), 0, "no refund");
    }
}