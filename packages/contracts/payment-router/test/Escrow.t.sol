// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {MockERC20} from "./helpers/MockERC20.sol";

/// @title EscrowTest — conditional settlement (RFC #304)
contract EscrowTest is Test {
    EscrowFactory internal factory;
    MockERC20 internal usdc;

    address internal payer = makeAddr("payer");
    address internal payee = makeAddr("payee");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");

    uint64 internal constant HOLD_ENDS = 1_000_000;
    uint64 internal constant RESOLVE_BY = HOLD_ENDS + 7 days;
    uint256 internal constant AMOUNT = 25_000_000;

    function setUp() public {
        factory = new EscrowFactory();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vm.warp(HOLD_ENDS - 1 days);
    }

    function _terms(address arbiter_) internal view returns (EscrowFactory.Terms memory) {
        return EscrowFactory.Terms({
            intentId: keccak256("intent-1"),
            payer: payer,
            payee: payee,
            arbiter: arbiter_,
            releaseAfter: HOLD_ENDS,
            resolveBy: RESOLVE_BY
        });
    }

    /// @dev What PaymentRouter does: a plain transfer to the escrow address.
    function _fund(EscrowFactory.Terms memory terms) internal returns (address escrow) {
        escrow = factory.escrowAddress(terms);
        usdc.mint(escrow, AMOUNT);
    }

    // ------------------------------------------------------------------
    // Address derivation
    // ------------------------------------------------------------------

    function test_address_is_counterfactual_and_pure() public view {
        address escrow = factory.escrowAddress(_terms(arbiter));
        assertEq(escrow.code.length, 0);
        assertEq(escrow, factory.escrowAddress(_terms(arbiter)));
    }

    function test_every_term_changes_the_address() public view {
        EscrowFactory.Terms memory base = _terms(arbiter);
        address original = factory.escrowAddress(base);

        EscrowFactory.Terms memory t = _terms(arbiter);
        t.payee = stranger;
        assertTrue(factory.escrowAddress(t) != original, "payee");
        t = _terms(arbiter);
        t.payer = stranger;
        assertTrue(factory.escrowAddress(t) != original, "payer");
        t = _terms(address(0));
        assertTrue(factory.escrowAddress(t) != original, "arbiter");
        t = _terms(arbiter);
        t.releaseAfter = HOLD_ENDS + 1;
        assertTrue(factory.escrowAddress(t) != original, "releaseAfter");
        t = _terms(arbiter);
        t.resolveBy = RESOLVE_BY + 1;
        assertTrue(factory.escrowAddress(t) != original, "resolveBy");
        t = _terms(arbiter);
        t.intentId = keccak256("intent-2");
        assertTrue(factory.escrowAddress(t) != original, "intentId");
    }

    function test_init_code_hash_matches() public view {
        assertEq(factory.INIT_CODE_HASH(), keccak256(type(EscrowVault).creationCode));
    }

    // ------------------------------------------------------------------
    // Release
    // ------------------------------------------------------------------

    function test_payer_releases_before_the_hold_ends() public {
        EscrowFactory.Terms memory terms = _terms(address(0));
        address escrow = _fund(terms);

        vm.prank(payer);
        uint256 amount = factory.release(terms, IERC20(address(usdc)));

        assertEq(amount, AMOUNT);
        assertEq(usdc.balanceOf(payee), AMOUNT);
        assertEq(usdc.balanceOf(escrow), 0);
        assertEq(
            uint8(factory.outcome(factory.saltOf(terms))), uint8(EscrowFactory.Outcome.Released)
        );
    }

    function test_nobody_else_releases_before_the_hold_ends() public {
        EscrowFactory.Terms memory terms = _terms(arbiter);
        _fund(terms);

        for (uint256 i = 0; i < 3; ++i) {
            address caller = [payee, arbiter, stranger][i];
            vm.prank(caller);
            vm.expectRevert(EscrowFactory.NotAllowed.selector);
            factory.release(terms, IERC20(address(usdc)));
        }
    }

    function test_anyone_releases_once_the_hold_ends() public {
        EscrowFactory.Terms memory terms = _terms(address(0));
        _fund(terms);

        vm.warp(HOLD_ENDS);
        vm.prank(stranger);
        factory.release(terms, IERC20(address(usdc)));

        assertEq(usdc.balanceOf(payee), AMOUNT);
    }

    // ------------------------------------------------------------------
    // Refund
    // ------------------------------------------------------------------

    function test_payee_refunds_at_any_time() public {
        EscrowFactory.Terms memory terms = _terms(address(0));
        _fund(terms);

        vm.warp(HOLD_ENDS + 30 days);
        vm.prank(payee);
        factory.refund(terms, IERC20(address(usdc)));

        assertEq(usdc.balanceOf(payer), AMOUNT);
        assertEq(
            uint8(factory.outcome(factory.saltOf(terms))), uint8(EscrowFactory.Outcome.Refunded)
        );
    }

    function test_payer_cannot_refund_itself() public {
        EscrowFactory.Terms memory terms = _terms(arbiter);
        _fund(terms);

        vm.prank(payer);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.refund(terms, IERC20(address(usdc)));
    }

    function test_a_release_leaves_nothing_to_refund() public {
        EscrowFactory.Terms memory terms = _terms(address(0));
        _fund(terms);

        vm.prank(payer);
        factory.release(terms, IERC20(address(usdc)));
        vm.prank(payee);
        uint256 refunded = factory.refund(terms, IERC20(address(usdc)));

        assertEq(refunded, 0);
        assertEq(usdc.balanceOf(payee), AMOUNT);
        // An empty refund does not overwrite what actually happened.
        assertEq(
            uint8(factory.outcome(factory.saltOf(terms))), uint8(EscrowFactory.Outcome.Released)
        );
    }

    // ------------------------------------------------------------------
    // Dispute and arbiter
    // ------------------------------------------------------------------

    function test_dispute_blocks_the_timeout_release() public {
        EscrowFactory.Terms memory terms = _terms(arbiter);
        _fund(terms);

        vm.prank(payer);
        factory.dispute(terms);

        vm.warp(HOLD_ENDS + 1);
        vm.prank(stranger);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.release(terms, IERC20(address(usdc)));
    }

    function test_only_the_payer_disputes_and_only_before_the_hold_ends() public {
        EscrowFactory.Terms memory terms = _terms(arbiter);

        vm.prank(payee);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.dispute(terms);

        vm.warp(HOLD_ENDS);
        vm.prank(payer);
        vm.expectRevert(EscrowFactory.HoldEnded.selector);
        factory.dispute(terms);
    }

    function test_arbiter_decides_only_a_disputed_escrow() public {
        EscrowFactory.Terms memory terms = _terms(arbiter);
        _fund(terms);

        vm.prank(arbiter);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.refund(terms, IERC20(address(usdc)));

        vm.prank(payer);
        factory.dispute(terms);

        vm.prank(arbiter);
        factory.refund(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), AMOUNT);
    }

    function test_arbiter_can_release_a_disputed_escrow() public {
        EscrowFactory.Terms memory terms = _terms(arbiter);
        _fund(terms);

        vm.prank(payer);
        factory.dispute(terms);
        vm.prank(arbiter);
        factory.release(terms, IERC20(address(usdc)));

        assertEq(usdc.balanceOf(payee), AMOUNT);
    }

    function test_without_an_arbiter_a_dispute_waits_until_resolve_by() public {
        EscrowFactory.Terms memory terms = _terms(address(0));
        _fund(terms);

        vm.prank(payer);
        factory.dispute(terms);

        vm.warp(RESOLVE_BY - 1);
        vm.prank(stranger);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.refund(terms, IERC20(address(usdc)));
        vm.prank(stranger);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.release(terms, IERC20(address(usdc)));

        vm.warp(RESOLVE_BY);
        vm.prank(stranger);
        factory.refund(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), AMOUNT);
    }

    function test_an_unresolved_dispute_refunds_the_payer_by_default() public {
        EscrowFactory.Terms memory terms = _terms(arbiter);
        _fund(terms);
        vm.prank(payer);
        factory.dispute(terms);

        vm.warp(RESOLVE_BY);
        // The arbiter's window is over; the default is the buyer's.
        vm.prank(arbiter);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.release(terms, IERC20(address(usdc)));

        vm.prank(stranger);
        factory.refund(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), AMOUNT);
    }

    function test_the_payee_cannot_arbitrate_its_own_dispute() public {
        EscrowFactory.Terms memory terms = _terms(payee);
        _fund(terms);
        vm.prank(payer);
        factory.dispute(terms);

        // As payee it may still refund, but it cannot release a disputed escrow.
        vm.prank(payee);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.release(terms, IERC20(address(usdc)));
    }

    function test_the_payer_cannot_arbitrate_its_own_dispute() public {
        EscrowFactory.Terms memory terms = _terms(payer);
        _fund(terms);
        vm.prank(payer);
        factory.dispute(terms);

        vm.prank(payer);
        vm.expectRevert(EscrowFactory.NotAllowed.selector);
        factory.refund(terms, IERC20(address(usdc)));
    }

    // ------------------------------------------------------------------
    // Vault
    // ------------------------------------------------------------------

    function test_the_vault_obeys_only_its_factory() public {
        EscrowFactory.Terms memory terms = _terms(address(0));
        address escrow = _fund(terms);
        vm.prank(payer);
        factory.release(terms, IERC20(address(usdc)));

        usdc.mint(escrow, 1);
        vm.prank(stranger);
        vm.expectRevert(EscrowVault.NotFactory.selector);
        EscrowVault(escrow).transferAll(IERC20(address(usdc)), stranger);
    }

    function test_funds_arriving_after_deploy_are_still_governed() public {
        EscrowFactory.Terms memory terms = _terms(address(0));
        address escrow = _fund(terms);
        vm.prank(payer);
        factory.release(terms, IERC20(address(usdc)));

        usdc.mint(escrow, AMOUNT);
        vm.prank(payee);
        factory.refund(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), AMOUNT);
    }
}
