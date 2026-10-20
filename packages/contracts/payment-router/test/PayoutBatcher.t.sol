// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PayoutBatcher} from "../src/PayoutBatcher.sol";
import {MockERC20} from "./helpers/MockERC20.sol";

contract PayoutBatcherTest is Test {
    PayoutBatcher internal batcher;
    MockERC20 internal usdc;
    MockERC20 internal usdg;

    address internal payer = makeAddr("payer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal thief = makeAddr("thief");

    function setUp() public {
        batcher = new PayoutBatcher();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        usdc.mint(payer, 100e6);
        usdg.mint(payer, 100e6);
        vm.startPrank(payer);
        usdc.approve(address(batcher), type(uint256).max);
        usdg.approve(address(batcher), type(uint256).max);
        vm.stopPrank();
    }

    function _batch(uint256 count)
        internal
        pure
        returns (IERC20[] memory tokens, address[] memory to, uint256[] memory amounts)
    {
        tokens = new IERC20[](count);
        to = new address[](count);
        amounts = new uint256[](count);
    }

    function test_pays_every_row_from_the_caller_mixing_tokens() public {
        (IERC20[] memory tokens, address[] memory to, uint256[] memory amounts) = _batch(3);
        (tokens[0], to[0], amounts[0]) = (IERC20(address(usdc)), alice, 12.5e6);
        (tokens[1], to[1], amounts[1]) = (IERC20(address(usdg)), bob, 3e6);
        (tokens[2], to[2], amounts[2]) = (IERC20(address(usdc)), alice, 1e6);

        vm.expectEmit(true, false, false, true, address(batcher));
        emit PayoutBatcher.Payout(payer, 3);
        vm.prank(payer);
        batcher.payout(tokens, to, amounts);

        assertEq(usdc.balanceOf(alice), 13.5e6);
        assertEq(usdg.balanceOf(bob), 3e6);
        assertEq(usdc.balanceOf(payer), 86.5e6);
        assertEq(usdc.balanceOf(address(batcher)), 0, "holds nothing");
    }

    function test_cannot_spend_someone_elses_approval() public {
        (IERC20[] memory tokens, address[] memory to, uint256[] memory amounts) = _batch(1);
        (tokens[0], to[0], amounts[0]) = (IERC20(address(usdc)), thief, 1e6);

        // The payer approved the batcher; the thief calling it spends the
        // thief's own (absent) balance, never the payer's.
        vm.prank(thief);
        vm.expectRevert();
        batcher.payout(tokens, to, amounts);
        assertEq(usdc.balanceOf(payer), 100e6);
    }

    function test_one_failing_row_reverts_the_whole_batch() public {
        (IERC20[] memory tokens, address[] memory to, uint256[] memory amounts) = _batch(2);
        (tokens[0], to[0], amounts[0]) = (IERC20(address(usdc)), alice, 1e6);
        (tokens[1], to[1], amounts[1]) = (IERC20(address(usdc)), bob, 1_000e6);

        vm.prank(payer);
        vm.expectRevert();
        batcher.payout(tokens, to, amounts);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_rejects_empty_and_mismatched_batches() public {
        (IERC20[] memory tokens, address[] memory to, uint256[] memory amounts) = _batch(0);
        vm.expectRevert(PayoutBatcher.EmptyBatch.selector);
        batcher.payout(tokens, to, amounts);

        (tokens, to, amounts) = _batch(2);
        amounts = new uint256[](1);
        vm.expectRevert(PayoutBatcher.LengthMismatch.selector);
        batcher.payout(tokens, to, amounts);
    }
}
