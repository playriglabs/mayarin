// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PayoutBatcher — pay many recipients from any wallet in one transaction (#295)
/// @notice The caller approves this contract once per token, then `payout` moves
///         every row straight from the caller to its recipient with
///         `transferFrom`. Each row is its own ERC-20 `Transfer(caller → recipient)`,
///         which is what the backend reads back to record the batch.
///
/// @dev Deliberately the smallest thing that works:
///      - **Holds nothing.** Tokens never rest here: every transfer is caller →
///        recipient, so there is no balance to drain and no sweep function.
///      - **No owner, no admin, no upgrade, no pause.** Nothing about it can be
///        changed after deploy, so there is nobody to trust.
///      - **Only `msg.sender`'s funds.** A row can only spend the allowance its
///        caller granted; an approval to this contract lets nobody but the
///        approver move their tokens through it.
///      Deployed with CREATE2 through the canonical deterministic deployer, so it
///      has the same address on every chain.
contract PayoutBatcher {
    using SafeERC20 for IERC20;

    error LengthMismatch();
    error EmptyBatch();

    /// @notice One per batch, after every transfer succeeded.
    event Payout(address indexed payer, uint256 count);

    /// @param tokens    ERC-20 per row (rows may mix tokens)
    /// @param recipients recipient per row
    /// @param amounts   amount per row, in the token's minor units
    function payout(
        IERC20[] calldata tokens,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        uint256 count = recipients.length;
        if (count == 0) revert EmptyBatch();
        if (tokens.length != count || amounts.length != count) revert LengthMismatch();

        for (uint256 i = 0; i < count; ++i) {
            tokens[i].safeTransferFrom(msg.sender, recipients[i], amounts[i]);
        }
        emit Payout(msg.sender, count);
    }
}
