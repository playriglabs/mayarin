// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPermit2} from "../../src/interfaces/IPermit2.sol";

/// @dev Structural mock of Permit2. Enforces the rules the PaymentRouter relies
///      on — spender binding, sig deadline, allowance expiration, single-use nonce,
///      and the actual token pull — but does NOT re-verify the payer's EIP-712
///      signature (the canonical Permit2's cryptography is exercised by the gated
///      fork test against the real contract, not here).
contract MockPermit2 is IPermit2 {
    struct Allowance {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    /// @dev allowance[owner][spender][token]
    mapping(address => mapping(address => mapping(address => Allowance))) internal _allowance;
    /// @dev consumed nonces — single use, as in real Permit2.
    mapping(address => mapping(uint48 => bool)) internal _nonceUsed;

    error SigExpired();
    error NonceAlreadyUsed();
    error AllowanceExpired();
    error InsufficientAllowance();
    error WrongSpender();

    function permit(address owner, PermitSingle calldata permitSingle, bytes calldata /*signature*/) external {
        if (block.timestamp > permitSingle.sigDeadline) revert SigExpired();
        uint48 nonce = permitSingle.details.nonce;
        if (_nonceUsed[owner][nonce]) revert NonceAlreadyUsed();
        _nonceUsed[owner][nonce] = true;
        // The spender the payer authorized must be the caller that will pull. We
        // store the allowance under (owner, spender, token); if `spender` is not
        // this contract's caller, the later `transferFrom` finds no allowance.
        _allowance[owner][permitSingle.spender][permitSingle.details.token] = Allowance({
            amount: permitSingle.details.amount,
            expiration: permitSingle.details.expiration,
            nonce: nonce
        });
    }

    function transferFrom(address from, address to, uint160 amount, address token) external returns (uint160) {
        Allowance memory a = _allowance[from][msg.sender][token];
        // Order mirrors canonical Permit2: a never-set (or wrong-spender) allowance
        // has amount 0, so InsufficientAllowance surfaces before the expiration
        // check would fire on the zeroed expiration field.
        if (a.amount < amount) revert InsufficientAllowance();
        if (block.timestamp > a.expiration) revert AllowanceExpired();
        _allowance[from][msg.sender][token].amount = a.amount - amount;
        // Permit2 pulls via the token's own transferFrom; the owner must have
        // approved this mock (as owners approve the canonical Permit2 on-chain).
        IERC20(token).transferFrom(from, to, amount);
        return amount;
    }
}