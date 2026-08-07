// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DepositForwarder} from "./DepositForwarder.sol";

/// @title DepositForwarderFactory — deterministic deposit addresses (RFC #69)
/// @notice Deploys a `DepositForwarder` at an address derived from a salt, so
///         the address can be computed off-chain — from the payment intent
///         alone, with no key and no transaction — long before any code exists
///         there. The payer sends to it; the executor deploys and sweeps later.
///
/// @dev This replaces HD-derived EOAs behind the existing `DepositAddressDeriver`
///      port rather than changing it: both answer "what address does this
///      payment deposit to", and both are watch-only in the sense that the API
///      derives without holding anything that can spend.
///
///      The property that makes it work: `forwarderAddress(salt)` is a pure
///      function of `(this, salt, INIT_CODE_HASH)`. `DepositForwarder` takes no
///      constructor arguments precisely so that `INIT_CODE_HASH` is a constant —
///      an argument would fold into the init code and make each address depend
///      on it, and an address that cannot be derived from the salt alone cannot
///      be shown to a payer before it is funded.
contract DepositForwarderFactory {
    /// @notice Where every forwarder sweeps to. Immutable: a mutable destination
    ///         would mean the operator (or anyone who compromised it) could
    ///         redirect funds that payers have already been told to send, with
    ///         no timelock and nothing on-chain to notice.
    address public immutable destination;

    /// @dev Constant, because `DepositForwarder` has no constructor arguments.
    ///      Exposed so the off-chain deriver can assert it matches the value it
    ///      computes rather than trusting a hardcoded constant to stay in sync.
    bytes32 public constant INIT_CODE_HASH = keccak256(type(DepositForwarder).creationCode);

    event ForwarderDeployed(bytes32 indexed salt, address indexed forwarder);

    error ZeroDestination();

    constructor(address destination_) {
        if (destination_ == address(0)) revert ZeroDestination();
        destination = destination_;
    }

    /// @notice The address a payment with this salt deposits to.
    /// @dev Answers for a salt that has never been deployed — which is the
    ///      normal case, since the address is handed to the payer first.
    function forwarderAddress(bytes32 salt) public view returns (address) {
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, INIT_CODE_HASH)))
            )
        );
    }

    /// @notice Deploys the forwarder for `salt` and sweeps the native balance.
    /// @dev Idempotent against the deploy: once deployed, the address holds code
    ///      and CREATE2 would revert, so a resumed step sweeps the already
    ///      deployed forwarder instead of failing. That matters because the
    ///      executor is resumable and a retry must not be a special case.
    function sweepNative(bytes32 salt) external returns (address forwarder) {
        forwarder = _ensureDeployed(salt);
        DepositForwarder(payable(forwarder)).sweepNative();
    }

    /// @notice Deploys the forwarder for `salt` and sweeps an ERC-20 balance.
    function sweepToken(bytes32 salt, IERC20 token) external returns (address forwarder) {
        forwarder = _ensureDeployed(salt);
        DepositForwarder(payable(forwarder)).sweepToken(token);
    }

    function _ensureDeployed(bytes32 salt) internal returns (address forwarder) {
        forwarder = forwarderAddress(salt);
        if (forwarder.code.length != 0) return forwarder;

        DepositForwarder deployed = new DepositForwarder{salt: salt}();
        // Defensive: a mismatch means `INIT_CODE_HASH` and the deployed bytecode
        // have diverged, which would mean payers were shown addresses this
        // factory can never deploy to. Cheap to check, catastrophic to miss.
        assert(address(deployed) == forwarder);
        emit ForwarderDeployed(salt, forwarder);
    }
}
