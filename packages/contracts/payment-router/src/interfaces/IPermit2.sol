// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPermit2 — minimal slice of Uniswap Permit2 (IAllowanceTransfer)
/// @notice Only the surface PaymentRouter calls: `permit` (set allowance from a
///         payer's off-chain signature) and `transferFrom` (pull under that
///         allowance). The canonical Permit2 lives at
///         `0x0000000000001fF3684F28c67538d4D072C22734` on every chain we deploy to.
/// @dev Field order and types match Uniswap's IAllowanceTransfer exactly so the
///      real Permit2 accepts these calls on a fork. No Uniswap source dependency.
interface IPermit2 {
    struct PermitDetails {
        address token; // the ERC-20 being permitted
        uint160 amount; // max amount the spender may pull (also what we pull)
        uint48 expiration; // allowance expiration
        uint48 nonce; // single-use; Permit2 rejects reuse
    }

    struct PermitSingle {
        PermitDetails details;
        address spender; // must be this contract
        uint256 sigDeadline; // signature deadline (distinct from allowance expiration)
    }

    /// @dev Sets the allowance described by `permitSingle` from `owner`'s sig.
    ///      Single-use nonce; replay rejected by Permit2.
    function permit(address owner, PermitSingle calldata permitSingle, bytes calldata signature) external;

    /// @dev Pulls `amount` of `token` from `from` to `to` under the allowance set
    ///      by `permit`. Returns the amount actually transferred.
    function transferFrom(address from, address to, uint160 amount, address token) external returns (uint160);
}