// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DepositForwarder} from "../src/DepositForwarder.sol";
import {DepositForwarderFactory} from "../src/DepositForwarderFactory.sol";
import {MockERC20} from "./helpers/MockERC20.sol";

/// @dev A destination that tries to re-enter the sweep while it is being paid.
contract ReenteringDestination {
    DepositForwarderFactory public factory;
    bytes32 public salt;
    uint256 public received;

    function arm(DepositForwarderFactory factory_, bytes32 salt_) external {
        factory = factory_;
        salt = salt_;
    }

    receive() external payable {
        received += msg.value;
        // The forwarder's balance is already zero here; a second sweep must find nothing.
        if (address(factory) != address(0)) factory.sweepNative(salt);
    }
}

/// @dev A destination that cannot accept native currency.
contract RejectingDestination {
    receive() external payable {
        revert("no native");
    }
}

/// @dev A token whose every call lies: balance is huge and transfer does nothing.
contract LyingToken {
    function balanceOf(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}

/// @title DepositForwarderAdversarialTest — what a hostile caller or destination can and cannot do
/// @notice Review of DepositForwarder / DepositForwarderFactory (SEC-06). These pin the
///         behaviours the contract's comments claim but the happy-path suite never attacks.
contract DepositForwarderAdversarialTest is Test {
    bytes32 internal constant SALT = keccak256("intent-adversarial");
    MockERC20 internal token;

    function setUp() public {
        token = new MockERC20("USD Coin", "USDC", 6);
    }

    function test_a_destination_that_re_enters_the_sweep_gets_the_funds_once() public {
        ReenteringDestination destination = new ReenteringDestination();
        DepositForwarderFactory factory = new DepositForwarderFactory(address(destination));
        destination.arm(factory, SALT);

        vm.deal(factory.forwarderAddress(SALT), 1 ether);
        factory.sweepNative(SALT);

        assertEq(address(destination).balance, 1 ether);
        assertEq(destination.received(), 1 ether);
    }

    function test_a_destination_that_rejects_native_makes_the_sweep_revert_and_keeps_the_funds()
        public
    {
        RejectingDestination destination = new RejectingDestination();
        DepositForwarderFactory factory = new DepositForwarderFactory(address(destination));
        address deposit = factory.forwarderAddress(SALT);
        vm.deal(deposit, 1 ether);

        vm.expectRevert(DepositForwarder.SweepFailed.selector);
        factory.sweepNative(SALT);

        // Nothing is lost by the failed sweep, but nothing can move either:
        // `destination` is immutable. A factory destination must be an address
        // that accepts native currency (a Safe does).
        assertEq(deposit.balance, 1 ether);
    }

    function test_a_token_argument_chosen_by_the_caller_cannot_move_anything_else() public {
        address operator = makeAddr("operator");
        DepositForwarderFactory factory = new DepositForwarderFactory(operator);
        address deposit = factory.forwarderAddress(SALT);
        vm.deal(deposit, 1 ether);
        token.mint(deposit, 500e6);

        // A hostile token claims an enormous balance and a successful transfer.
        // The forwarder only ever calls it; it cannot be made to move other assets.
        factory.sweepToken(SALT, IERC20(address(new LyingToken())));

        assertEq(deposit.balance, 1 ether);
        assertEq(token.balanceOf(deposit), 500e6);
        assertEq(operator.balance, 0);
        assertEq(token.balanceOf(operator), 0);
    }

    function test_the_forwarder_can_be_deployed_by_anyone_only_through_its_factory() public {
        address operator = makeAddr("operator");
        DepositForwarderFactory factory = new DepositForwarderFactory(operator);
        address attacker = makeAddr("attacker");

        // A forwarder deployed directly reads `destination` from its deployer. An
        // attacker's own contract can point one at itself, but that address is
        // unrelated to any address Mayarin showed a payer.
        vm.prank(attacker);
        vm.expectRevert();
        new DepositForwarder();

        assertTrue(factory.forwarderAddress(SALT) != address(0));
    }

    function testFuzz_a_sweep_never_leaves_value_behind_or_pays_anyone_else(
        uint96 native,
        uint96 tokens,
        address caller
    ) public {
        vm.assume(caller != address(0));
        address operator = makeAddr("operator");
        DepositForwarderFactory factory = new DepositForwarderFactory(operator);
        address deposit = factory.forwarderAddress(SALT);
        vm.deal(deposit, native);
        token.mint(deposit, tokens);

        vm.startPrank(caller);
        factory.sweepNative(SALT);
        factory.sweepToken(SALT, IERC20(address(token)));
        vm.stopPrank();

        assertEq(deposit.balance, 0);
        assertEq(token.balanceOf(deposit), 0);
        assertEq(operator.balance, native);
        assertEq(token.balanceOf(operator), tokens);
    }
}
