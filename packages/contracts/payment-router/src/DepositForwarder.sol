// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDepositForwarderFactory {
    function destination() external view returns (address);
}

/// @title DepositForwarder — sweeps one payment's deposit to the operator (RFC #69)
/// @notice A per-payment deposit address that is a **counterfactual contract**:
///         the payer sends to an address derived off-chain, before any code
///         exists there. The executor deploys this contract at that address only
///         once funds have arrived, and sweeps them in the same transaction.
///
/// @dev Why this exists at all. The deposit path's addresses were HD-derived
///      EOAs, which means a deposit address receives *exactly* the quoted amount
///      and therefore cannot also pay the gas to move it. Pre-funding every
///      address costs a transaction per payment before the payment; grossing the
///      quote up hides Mayarin's operating cost in the payer's price. A
///      counterfactual contract removes the problem instead of paying for it:
///      the operator submits the transaction and pays the gas, and there is one
///      operator key rather than one key per address.
///
///      **No access control on the sweeps, by design.** `destination` is fixed
///      by the factory and cannot be changed, so the only thing a caller can do
///      is move funds to where they were always going, at their own gas expense.
///      Adding an owner check would buy nothing and add a way to be wrong.
///
///      **This contract never decides anything.** It does not know about orders,
///      routes, `minOut`, or the router. It moves what arrived to one immutable
///      address. Everything that requires judgement happens off-chain in the
///      executor, and everything that requires atomicity happens in
///      `PaymentRouter`. That separation is what keeps the fund-touching surface
///      here to two transfers.
contract DepositForwarder {
    using SafeERC20 for IERC20;

    /// @dev Where this forwarder sweeps to, read once from the deploying factory
    ///      and then immutable in this contract's own bytecode.
    ///
    ///      Read at construction rather than at sweep time so the destination is
    ///      fixed here rather than merely fixed on the factory. Reading it per
    ///      sweep would leave the guarantee resting on a runtime external call —
    ///      true today, but not provable from this contract alone, and a static
    ///      analyzer is right to flag a value fetched that way as arbitrary.
    ///
    ///      Taken from `msg.sender` rather than as a constructor argument:
    ///      constructor arguments are part of the init code, and the CREATE2
    ///      address derives from the init code hash. An argument would make every
    ///      forwarder's address depend on it, which is exactly what must not
    ///      happen — the address has to be a pure function of the salt so it can
    ///      be derived off-chain from the payment intent alone.
    address public immutable destination;

    error SweepFailed();

    constructor() {
        destination = IDepositForwarderFactory(msg.sender).destination();
    }

    /// @dev Accepts the payer's native deposit. A plain transfer from any wallet
    ///      or exchange withdrawal lands here — that is the whole point of the
    ///      deposit path, and it must not revert.
    receive() external payable {}

    /// @notice Sweeps the native balance to the operator.
    function sweepNative() external {
        uint256 balance = address(this).balance;
        if (balance == 0) return;

        (bool ok,) = destination.call{value: balance}("");
        if (!ok) revert SweepFailed();
    }

    /// @notice Sweeps an ERC-20 balance to the operator.
    /// @dev `SafeERC20` because a deposit token is whatever the payer sent; a
    ///      non-standard token that returns nothing on transfer would otherwise
    ///      strand the deposit.
    function sweepToken(IERC20 token) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;

        token.safeTransfer(destination, balance);
    }
}
