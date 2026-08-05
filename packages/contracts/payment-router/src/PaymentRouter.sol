// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title PaymentRouter — stateless, atomic receive → swap → settle
/// @notice Skeleton only (#23). The EIP-712 order domain (#24), pay paths
///         (#25/#26), and bounded admin (#27) land separately; the invariants —
///         hard revert on `minOut` miss, zero resting balance, `intentId`
///         idempotency, no admin path to funds — are specified in RFC #4.
contract PaymentRouter {
    string public constant VERSION = "0.0.0";
}
