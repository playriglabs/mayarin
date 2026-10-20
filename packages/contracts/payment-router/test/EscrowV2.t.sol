// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowFactoryV2} from "../src/EscrowFactoryV2.sol";
import {EscrowVaultV2} from "../src/EscrowVaultV2.sol";
import {MockERC20} from "./helpers/MockERC20.sol";

/// @title EscrowV2Test — dispute bond and split resolution (RFC #315)
contract EscrowV2Test is Test {
    EscrowFactoryV2 internal factory;
    MockERC20 internal usdc;

    address internal payer = makeAddr("payer");
    address internal payee = makeAddr("payee");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");

    uint64 internal constant HOLD_ENDS = 1_000_000;
    uint64 internal constant RESOLVE_BY = HOLD_ENDS + 7 days;
    uint256 internal constant AMOUNT = 100_000_000;
    uint256 internal constant BOND = 5_000_000;

    function setUp() public {
        factory = new EscrowFactoryV2();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vm.warp(HOLD_ENDS - 1 days);
        usdc.mint(payer, BOND * 3);
        vm.prank(payer);
        usdc.approve(address(factory), type(uint256).max);
    }

    function _terms(uint256 bond) internal view returns (EscrowFactoryV2.Terms memory) {
        return EscrowFactoryV2.Terms({
            intentId: keccak256("intent-1"),
            payer: payer,
            payee: payee,
            arbiter: arbiter,
            releaseAfter: HOLD_ENDS,
            resolveBy: RESOLVE_BY,
            bond: bond
        });
    }

    function _fund(EscrowFactoryV2.Terms memory terms) internal returns (address escrow) {
        escrow = factory.escrowAddress(terms);
        usdc.mint(escrow, AMOUNT);
    }

    function _disputed() internal returns (EscrowFactoryV2.Terms memory terms) {
        terms = _terms(BOND);
        _fund(terms);
        vm.prank(payer);
        factory.dispute(terms, IERC20(address(usdc)));
    }

    // ------------------------------------------------------------------
    // Address
    // ------------------------------------------------------------------

    function test_the_bond_is_part_of_the_address() public view {
        assertTrue(factory.escrowAddress(_terms(BOND)) != factory.escrowAddress(_terms(0)));
    }

    function test_init_code_hash_is_the_v2_vault() public view {
        assertEq(factory.INIT_CODE_HASH(), keccak256(type(EscrowVaultV2).creationCode));
    }

    // ------------------------------------------------------------------
    // Dispute and bond
    // ------------------------------------------------------------------

    function test_dispute_pulls_the_bond_into_the_escrow() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        assertTrue(factory.disputed(factory.saltOf(terms)));
        assertEq(usdc.balanceOf(factory.escrowAddress(terms)), AMOUNT + BOND);
        assertEq(usdc.balanceOf(payer), BOND * 2);
    }

    function test_dispute_without_the_bond_reverts() public {
        EscrowFactoryV2.Terms memory terms = _terms(BOND * 10);
        _fund(terms);
        vm.prank(payer);
        vm.expectRevert();
        factory.dispute(terms, IERC20(address(usdc)));
    }

    function test_a_zero_bond_dispute_moves_nothing() public {
        EscrowFactoryV2.Terms memory terms = _terms(0);
        _fund(terms);
        vm.prank(payer);
        factory.dispute(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), BOND * 3);
    }

    function test_only_the_payer_disputes_once_before_the_hold_ends() public {
        EscrowFactoryV2.Terms memory terms = _terms(BOND);
        _fund(terms);

        vm.prank(stranger);
        vm.expectRevert(EscrowFactoryV2.NotAllowed.selector);
        factory.dispute(terms, IERC20(address(usdc)));

        vm.prank(payer);
        factory.dispute(terms, IERC20(address(usdc)));
        vm.prank(payer);
        vm.expectRevert(EscrowFactoryV2.AlreadyDisputed.selector);
        factory.dispute(terms, IERC20(address(usdc)));

        EscrowFactoryV2.Terms memory late = _terms(0);
        vm.warp(HOLD_ENDS);
        vm.prank(payer);
        vm.expectRevert(EscrowFactoryV2.HoldEnded.selector);
        factory.dispute(late, IERC20(address(usdc)));
    }

    function test_a_closed_escrow_cannot_be_disputed() public {
        EscrowFactoryV2.Terms memory terms = _terms(BOND);
        _fund(terms);
        vm.prank(payee);
        factory.refund(terms, IERC20(address(usdc)));

        vm.prank(payer);
        vm.expectRevert(EscrowFactoryV2.Closed.selector);
        factory.dispute(terms, IERC20(address(usdc)));
    }

    // ------------------------------------------------------------------
    // Where the bond goes
    // ------------------------------------------------------------------

    function test_arbiter_release_pays_payment_and_bond_to_the_payee() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(arbiter);
        factory.release(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payee), AMOUNT + BOND);
        assertEq(
            uint8(factory.outcome(factory.saltOf(terms))), uint8(EscrowFactoryV2.Outcome.Released)
        );
    }

    function test_arbiter_refund_returns_payment_and_bond_to_the_payer() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(arbiter);
        factory.refund(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), BOND * 3 + AMOUNT);
    }

    function test_payee_refund_returns_the_bond_too() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(payee);
        factory.refund(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), BOND * 3 + AMOUNT);
    }

    function test_an_undecided_dispute_refunds_payment_and_bond_at_resolve_by() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.warp(RESOLVE_BY);
        vm.prank(stranger);
        factory.refund(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payer), BOND * 3 + AMOUNT);
    }

    function test_a_payer_who_concedes_pays_the_bond_to_the_payee() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(payer);
        factory.release(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payee), AMOUNT + BOND);
    }

    // ------------------------------------------------------------------
    // Split resolution
    // ------------------------------------------------------------------

    function test_resolve_splits_the_payment_and_the_bond_follows_the_majority() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(arbiter);
        (uint256 toPayee, uint256 toPayer) = factory.resolve(terms, IERC20(address(usdc)), 7_000);

        assertEq(toPayee, AMOUNT * 70 / 100 + BOND);
        assertEq(toPayer, AMOUNT * 30 / 100);
        assertEq(usdc.balanceOf(payee), toPayee);
        assertEq(usdc.balanceOf(payer), BOND * 2 + toPayer);
        assertEq(usdc.balanceOf(factory.escrowAddress(terms)), 0);
        assertEq(
            uint8(factory.outcome(factory.saltOf(terms))), uint8(EscrowFactoryV2.Outcome.Split)
        );
    }

    function test_an_even_split_returns_the_bond_to_the_payer() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(arbiter);
        (uint256 toPayee, uint256 toPayer) = factory.resolve(terms, IERC20(address(usdc)), 5_000);
        assertEq(toPayee, AMOUNT / 2);
        assertEq(toPayer, AMOUNT / 2 + BOND);
    }

    function test_a_payer_majority_split_returns_the_bond_to_the_payer() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(arbiter);
        (uint256 toPayee, uint256 toPayer) = factory.resolve(terms, IERC20(address(usdc)), 2_500);
        assertEq(toPayee, AMOUNT / 4);
        assertEq(toPayer, AMOUNT * 3 / 4 + BOND);
    }

    function test_rounding_never_leaves_dust() public {
        EscrowFactoryV2.Terms memory terms = _terms(7);
        address escrow = factory.escrowAddress(terms);
        usdc.mint(escrow, 1_000_003);
        vm.prank(payer);
        factory.dispute(terms, IERC20(address(usdc)));
        vm.prank(arbiter);
        factory.resolve(terms, IERC20(address(usdc)), 3_333);
        assertEq(usdc.balanceOf(escrow), 0);
    }

    function test_only_the_arbiter_resolves_a_disputed_escrow_in_time() public {
        EscrowFactoryV2.Terms memory undisputed = _terms(0);
        _fund(undisputed);
        vm.prank(arbiter);
        vm.expectRevert(EscrowFactoryV2.NotAllowed.selector);
        factory.resolve(undisputed, IERC20(address(usdc)), 5_000);

        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.prank(payee);
        vm.expectRevert(EscrowFactoryV2.NotAllowed.selector);
        factory.resolve(terms, IERC20(address(usdc)), 10_000);

        vm.prank(arbiter);
        vm.expectRevert(EscrowFactoryV2.InvalidSplit.selector);
        factory.resolve(terms, IERC20(address(usdc)), 10_001);

        vm.warp(RESOLVE_BY);
        vm.prank(arbiter);
        vm.expectRevert(EscrowFactoryV2.NotAllowed.selector);
        factory.resolve(terms, IERC20(address(usdc)), 5_000);
    }

    function test_an_arbiter_who_is_a_party_cannot_resolve() public {
        EscrowFactoryV2.Terms memory terms = _terms(BOND);
        terms.arbiter = payee;
        _fund(terms);
        vm.prank(payer);
        factory.dispute(terms, IERC20(address(usdc)));
        vm.prank(payee);
        vm.expectRevert(EscrowFactoryV2.NotAllowed.selector);
        factory.resolve(terms, IERC20(address(usdc)), 10_000);
    }

    // ------------------------------------------------------------------
    // v1 behaviour kept
    // ------------------------------------------------------------------

    function test_anyone_releases_an_undisputed_escrow_after_the_hold() public {
        EscrowFactoryV2.Terms memory terms = _terms(BOND);
        _fund(terms);
        vm.prank(stranger);
        vm.expectRevert(EscrowFactoryV2.NotAllowed.selector);
        factory.release(terms, IERC20(address(usdc)));

        vm.warp(HOLD_ENDS);
        vm.prank(stranger);
        factory.release(terms, IERC20(address(usdc)));
        assertEq(usdc.balanceOf(payee), AMOUNT);
    }

    function test_a_disputed_escrow_is_not_released_by_the_clock() public {
        EscrowFactoryV2.Terms memory terms = _disputed();
        vm.warp(HOLD_ENDS + 1 days);
        vm.prank(stranger);
        vm.expectRevert(EscrowFactoryV2.NotAllowed.selector);
        factory.release(terms, IERC20(address(usdc)));
    }

    function testFuzz_resolve_conserves_every_unit(uint96 amount, uint64 bond, uint16 payeeBps)
        public
    {
        payeeBps = uint16(bound(payeeBps, 0, 10_000));
        EscrowFactoryV2.Terms memory terms = _terms(bond);
        address escrow = factory.escrowAddress(terms);
        usdc.mint(escrow, amount);
        usdc.mint(payer, bond);
        vm.prank(payer);
        factory.dispute(terms, IERC20(address(usdc)));

        uint256 before = usdc.balanceOf(payee) + usdc.balanceOf(payer);
        vm.prank(arbiter);
        (uint256 toPayee, uint256 toPayer) = factory.resolve(terms, IERC20(address(usdc)), payeeBps);
        assertEq(toPayee + toPayer, uint256(amount) + bond);
        assertEq(usdc.balanceOf(payee) + usdc.balanceOf(payer), before + uint256(amount) + bond);
        assertEq(usdc.balanceOf(escrow), 0);
    }
}
