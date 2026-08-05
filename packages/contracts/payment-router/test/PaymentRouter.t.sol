// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {OrderHash} from "../src/libraries/OrderHash.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {Harness} from "./helpers/Harness.sol";

/// @dev #24 (EIP-712 Order, quote-signer verification, PaymentCompleted event) and
///      #25 (payEth: atomic receive→swap→settle, fee split, hard revert, intentId
///      idempotency, zero resting balance).
contract PaymentRouterTest is Harness {
    bytes32 internal constant INTENT = keccak256("intent-1");

    function setUp() public override {
        super.setUp();
        // The test contract pays native; give it ETH.
        vm.deal(address(this), 100 ether);
        // Fund the mock router with settlement tokens it can deliver on a swap.
        usdc.mint(address(dex), 1_000_000e6);
    }

    // ------------------------------------------------------------------
    // #24 — Order domain, signature verification, event
    // ------------------------------------------------------------------

    function test_order_hash_vectors() public {
        // Stable test vectors: the typehash and a canonical struct hash. Run with
        // `forge test -vvv --match-test test_order_hash_vectors` to export them.
        assertEq(
            OrderHash.ORDER_TYPEHASH,
            keccak256(
                "Order(bytes32 intentId,uint256 minOut,uint256 fee,address merchantSafe,address refundTo,uint256 deadline)"
            ),
            "typehash must match the documented primary type"
        );
        IPaymentRouter.Order memory o =
            makeOrder(bytes32(uint256(0x1)), 100e6, 1e6, address(0xBEEF), address(0xCAFE), 0xDEAD);
        bytes32 sh = OrderHash.structHash(o);
        bytes32 domain = router.domainSeparatorV4();
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domain, sh));
        console2.log("domainSeparator:");
        console2.logBytes32(domain);
        console2.log("structHash:");
        console2.logBytes32(sh);
        console2.log("digest:");
        console2.logBytes32(digest);
        // Determinism: re-computing yields the same digest.
        assertEq(digest, orderDigest(address(router), o));
    }

    function test_reverts_wrong_signer() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        uint256 otherPk = 0x1234;
        bytes memory sig = signOrder(address(router), o, otherPk); // not the configured signer
        vm.expectRevert(PaymentRouter.InvalidSigner.selector);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(100e6));
    }

    function test_reverts_expired_deadline() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, block.timestamp - 1); // past → expired
        bytes memory sig = sign(o);
        vm.expectRevert(PaymentRouter.ExpiredOrder.selector);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(100e6));
    }

    function test_reverts_malformed_signature() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory badSig = new bytes(64); // wrong length → ECDSA rejects
        vm.expectRevert(); // OZ ECDSAInvalidSignature bubbles up
        router.payEth{value: 1 ether}(o, badSig, address(dex), ethSwapData(100e6));
    }

    function test_reverts_fee_exceeds_settlement() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 100e6, deadlineIn(3600)); // fee == minOut
        bytes memory sig = sign(o);
        vm.expectRevert(PaymentRouter.FeeExceedsSettlement.selector);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(100e6));
    }

    function test_reverts_invalid_order_zero_minOut() public {
        IPaymentRouter.Order memory o = order(INTENT, 0, 0, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.expectRevert(PaymentRouter.InvalidOrder.selector);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(0));
    }

    function test_reverts_no_route_native() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.expectRevert(PaymentRouter.NoRoute.selector);
        router.payEth{value: 1 ether}(o, sig, address(0), "");
    }

    // ------------------------------------------------------------------
    // #25 — payEth atomic path
    // ------------------------------------------------------------------

    function test_payEth_happy_path() public {
        uint256 minOut = 100e6;
        uint256 fee = 1e6;
        uint256 inputAmount = 1 ether;
        uint256 output = 120e6; // > minOut → excess refund
        IPaymentRouter.Order memory o = order(INTENT, minOut, fee, deadlineIn(3600));
        bytes memory sig = sign(o);

        uint256 merchantBefore = usdc.balanceOf(merchant);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 customerBefore = usdc.balanceOf(customer);

        vm.expectEmit(true, true, true, true, address(router));
        emit PaymentCompleted({
            intentId: INTENT,
            merchantSafe: merchant,
            refundTo: customer,
            inputAsset: address(0),
            settlementAsset: address(usdc),
            inputAmount: inputAmount,
            settledAmount: minOut - fee,
            fee: fee,
            refundAmount: output - minOut,
            deadline: o.deadline
        });

        router.payEth{value: inputAmount}(o, sig, address(dex), ethSwapData(output));

        // Fee split + excess refund, exact.
        assertEq(usdc.balanceOf(merchant) - merchantBefore, minOut - fee, "merchant");
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, fee, "treasury");
        assertEq(usdc.balanceOf(customer) - customerBefore, output - minOut, "refund");
        // Idempotency.
        assertTrue(router.consumed(INTENT));
        // Zero resting balance.
        assertEq(address(router).balance, 0, "native resting");
        assertEq(usdc.balanceOf(address(router)), 0, "token resting");
    }

    function test_payEth_minOut_miss_reverts() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        uint256 shortOutput = 99e6; // < minOut
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.MinOutNotMet.selector, shortOutput, 100e6));
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(shortOutput));
        // Revert undoes the consume — the order is retryable.
        assertFalse(router.consumed(INTENT));
    }

    function test_payEth_replay_rejected() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(100e6));
        vm.expectRevert(PaymentRouter.AlreadyConsumed.selector);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(100e6));
    }

    function test_payEth_exact_minOut_no_refund() public {
        uint256 minOut = 100e6;
        uint256 fee = 2e6;
        IPaymentRouter.Order memory o = order(INTENT, minOut, fee, deadlineIn(3600));
        bytes memory sig = sign(o);
        uint256 customerBefore = usdc.balanceOf(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(minOut)); // output == minOut
        assertEq(usdc.balanceOf(merchant), minOut - fee, "merchant");
        assertEq(usdc.balanceOf(treasury), fee, "treasury");
        assertEq(usdc.balanceOf(customer) - customerBefore, 0, "no refund when output==minOut");
    }

    function test_payEth_nonWhitelisted_router_reverts() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        usdc.mint(address(badDex), 1_000_000e6);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.RouterNotWhitelisted.selector, address(badDex)));
        router.payEth{value: 1 ether}(o, sig, address(badDex), ethSwapData(100e6));
    }

    function test_payEth_router_revert_bubbles() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        bytes memory data = abi.encodeWithSelector(dex.revertingSwapPayable.selector);
        vm.expectRevert("mock: bad swap");
        router.payEth{value: 1 ether}(o, sig, address(dex), data);
        assertFalse(router.consumed(INTENT), "revert undoes consume");
    }

    function test_payEth_reverts_when_paused() public {
        IPaymentRouter.Order memory o = order(INTENT, 100e6, 1e6, deadlineIn(3600));
        bytes memory sig = sign(o);
        vm.prank(admin); // admin holds GUARDIAN_ROLE
        router.pause();
        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(100e6));
    }

    function test_zero_resting_balance_after_success() public {
        // Run two distinct intents back-to-back; the contract must never accrue.
        for (uint256 i = 1; i <= 2; i++) {
            bytes32 id = keccak256(abi.encode("intent", i));
            IPaymentRouter.Order memory o = order(id, 100e6, 1e6, deadlineIn(3600));
            bytes memory sig = sign(o);
            router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(150e6));
            assertEq(address(router).balance, 0, "native resting after run");
            assertEq(usdc.balanceOf(address(router)), 0, "token resting after run");
        }
    }
}