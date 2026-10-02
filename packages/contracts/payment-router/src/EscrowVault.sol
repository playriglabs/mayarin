// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EscrowVault — holds one escrowed payment (RFC #304)
/// @notice A per-payment escrow address that is a **counterfactual contract**,
///         the same pattern as `DepositForwarder`: `PaymentRouter` settles to the
///         address before any code exists there, and `EscrowFactory` deploys this
///         contract only when the funds move on.
///
/// @dev This contract never decides anything. Who may move the funds, and where,
///      is `EscrowFactory`'s job; the vault only obeys its deployer. No
///      constructor arguments, so `INIT_CODE_HASH` is a constant and the address
///      is a pure function of the salt.
contract EscrowVault {
    using SafeERC20 for IERC20;

    /// @dev The factory that deployed this vault — the only caller it obeys.
    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    /// @notice Moves the whole balance of `token` to `to`.
    function transferAll(IERC20 token, address to) external returns (uint256 amount) {
        if (msg.sender != factory) revert NotFactory();
        amount = token.balanceOf(address(this));
        if (amount != 0) token.safeTransfer(to, amount);
    }
}
