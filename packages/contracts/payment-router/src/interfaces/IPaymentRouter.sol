// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPaymentRouter — public interface of PaymentRouter (RFC #4)
/// @notice Consumed off-chain by the Execution Engine (#5, calldata target), the
///         Quote Engine (#6, signs the `Order`), and the Indexer (#8, ingests
///         `PaymentCompleted`). Treat this interface as a public contract: the
///         `Order` field order and the `PaymentCompleted` event shape are stable.
interface IPaymentRouter {
    /// @dev Backend-signed EIP-712 order. The route/calldata and the input asset
    ///      are intentionally NOT signed — they are caller-supplied. The contract
    ///      enforces `minOut` with a hard revert, so an unsigned route can never
    ///      settle below the lock; it can only cause a revert (payer loses gas,
    ///      never funds). All amounts are raw minor units (no decimal math here).
    struct Order {
        bytes32 intentId; // backend-issued, globally unique per intent
        uint256 minOut; // hard-locked settlement-asset amount (minor units)
        uint256 fee; // treasury take (minor units); must be < minOut so merchant > 0
        address merchantSafe; // receives `minOut − fee`
        address refundTo; // receives `output − minOut` (execution excess)
        uint256 deadline; // order TTL; `block.timestamp` must be `<= deadline`
    }

    /// @dev Emitted on successful settlement. The Indexer's idempotency key is
    ///      `(chain, txHash, logIndex)` — those come from the log envelope, not
    ///      the event fields. `intentId`/`merchantSafe`/`refundTo` are indexed for
    ///      filtering. `inputAsset`/`settlementAsset` are `address(0)` for native.
    ///      Conservation: `settledAmount + fee + refundAmount == output == input`
    ///      for the same-asset path, and `== swap output` for the cross-asset path.
    event PaymentCompleted(
        bytes32 indexed intentId,
        address indexed merchantSafe,
        address indexed refundTo,
        address inputAsset,
        address settlementAsset,
        uint256 inputAmount,
        uint256 settledAmount,
        uint256 fee,
        uint256 refundAmount,
        uint256 deadline
    );

    /// @notice Pay with native value. The contract forwards `msg.value` to a
    ///         whitelisted `router` executing `data`, which must deliver `>= minOut`
    ///         of the settlement token to this contract or the whole call reverts.
    /// @param order    Backend-signed order.
    /// @param signature EIP-712 signature over `order` from the backend signer.
    /// @param router    Whitelisted DEX router (address(0) not allowed for native).
    /// @param data      Calldata that performs the swap, recipient = this contract.
    function payEth(
        Order calldata order,
        bytes calldata signature,
        address router,
        bytes calldata data
    ) external payable;

    /// @notice Pay with an ERC-20 via Permit2. Pulls `permit`'s amount of the
    ///         whitelisted input asset from the payer, then swaps (unless the
    ///         input asset is the settlement asset — then a no-op) and settles.
    /// @param order      Backend-signed order.
    /// @param permitData abi.encode(PermitSingle, signature) — payer's Permit2 auth.
    /// @param signature  EIP-712 signature over `order` from the backend signer.
    /// @param router     Whitelisted DEX router; address(0) allowed only for the
    ///                   same-asset no-op path.
    /// @param data       Swap calldata, recipient = this contract; empty for no-op.
    function payERC20(
        Order calldata order,
        bytes calldata permitData,
        bytes calldata signature,
        address router,
        bytes calldata data
    ) external;
}