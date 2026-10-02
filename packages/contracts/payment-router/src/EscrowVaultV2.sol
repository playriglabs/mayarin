// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EscrowVaultV2 — holds one escrowed payment and its dispute bond (RFC #315)
/// @notice `EscrowVault` with one more move: a part of the balance, so an
///         arbiter's split can pay both parties. A separate contract rather
///         than a change to `EscrowVault`, whose init code hash v1 escrow
///         addresses are derived from.
///
/// @dev Decides nothing; obeys only the factory that deployed it. No
///      constructor arguments, so its init code hash is a constant.
contract EscrowVaultV2 {
    using SafeERC20 for IERC20;

    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    /// @notice Moves `amount` of `token` to `to`.
    function transfer(IERC20 token, address to, uint256 amount) external {
        if (msg.sender != factory) revert NotFactory();
        if (amount != 0) token.safeTransfer(to, amount);
    }
}
