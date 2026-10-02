// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EscrowVault} from "./EscrowVault.sol";

/// @title EscrowFactory — conditional settlement (RFC #304)
/// @notice Programmable escrow for a payment. The signed `PaymentRouter` order
///         names `escrowAddress(terms)` as its `merchantSafe`, so the router
///         settles into escrow without knowing escrow exists. The funds then
///         move only when a condition holds:
///
///         - the **payer** releases them to the payee, at any time;
///         - **anyone** releases them to the payee once `releaseAfter` has
///           passed, unless the payer disputed before it;
///         - the **payee** refunds them to the payer, at any time;
///         - after a dispute, the **arbiter** (if the terms name one) releases
///           or refunds.
///
/// @dev The terms are the CREATE2 salt, so they are fixed by the address the
///      payer paid to: nobody — not Mayarin, not the merchant — can change who
///      is paid, who is refunded, who arbitrates, or when the hold ends. There is
///      no owner, no admin, no upgrade and no pause. The only state is the
///      dispute flag, which only the payer can set, and the last outcome, kept
///      so the backend reads an escrow's status in one call instead of a log
///      scan.
///
///      A release or refund moves the whole balance, so once one has run there
///      is nothing left for the other.
contract EscrowFactory {
    /// @notice Everything that defines one escrow. Hashed into the salt.
    struct Terms {
        /// @dev The PaymentRouter order's `intentId`.
        bytes32 intentId;
        /// @dev Refund destination and the party who may release or dispute.
        address payer;
        /// @dev The merchant's settlement address — where a release goes.
        address payee;
        /// @dev Decides a disputed escrow. `address(0)` = no arbiter: a
        ///      disputed escrow then moves only by payer release or payee refund.
        address arbiter;
        /// @dev Unix seconds after which an undisputed escrow may be released
        ///      by anyone.
        uint64 releaseAfter;
    }

    enum Outcome {
        Held,
        Released,
        Refunded
    }

    bytes32 public constant INIT_CODE_HASH = keccak256(type(EscrowVault).creationCode);

    /// @notice salt ⇒ the payer disputed before `releaseAfter`.
    mapping(bytes32 => bool) public disputed;
    /// @notice salt ⇒ where the funds last went. `Held` until a move carries value.
    mapping(bytes32 => Outcome) public outcome;

    event Released(
        bytes32 indexed intentId, address indexed token, address indexed to, uint256 amount
    );
    event Refunded(
        bytes32 indexed intentId, address indexed token, address indexed to, uint256 amount
    );
    event Disputed(bytes32 indexed intentId);

    error NotAllowed();
    error HoldEnded();

    function saltOf(Terms calldata terms) public pure returns (bytes32) {
        return keccak256(abi.encode(terms));
    }

    /// @notice The address a payment under these terms settles to. Answers
    ///         before anything is deployed there — the normal case.
    function escrowAddress(Terms calldata terms) public view returns (address) {
        return _vaultAddress(saltOf(terms));
    }

    /// @notice Moves the escrowed `token` to the payee.
    function release(Terms calldata terms, IERC20 token) external returns (uint256 amount) {
        bytes32 salt = saltOf(terms);
        bool isDisputed = disputed[salt];
        bool allowed = msg.sender == terms.payer
            || (isDisputed && terms.arbiter != address(0) && msg.sender == terms.arbiter)
            || (!isDisputed && block.timestamp >= terms.releaseAfter);
        if (!allowed) revert NotAllowed();

        amount = _vault(salt).transferAll(token, terms.payee);
        if (amount != 0) outcome[salt] = Outcome.Released;
        emit Released(terms.intentId, address(token), terms.payee, amount);
    }

    /// @notice Moves the escrowed `token` back to the payer.
    function refund(Terms calldata terms, IERC20 token) external returns (uint256 amount) {
        bytes32 salt = saltOf(terms);
        bool allowed = msg.sender == terms.payee
            || (disputed[salt] && terms.arbiter != address(0) && msg.sender == terms.arbiter);
        if (!allowed) revert NotAllowed();

        amount = _vault(salt).transferAll(token, terms.payer);
        if (amount != 0) outcome[salt] = Outcome.Refunded;
        emit Refunded(terms.intentId, address(token), terms.payer, amount);
    }

    /// @notice The payer stops the timeout release. Only before the hold ends.
    function dispute(Terms calldata terms) external {
        if (msg.sender != terms.payer) revert NotAllowed();
        if (block.timestamp >= terms.releaseAfter) revert HoldEnded();

        disputed[saltOf(terms)] = true;
        emit Disputed(terms.intentId);
    }

    function _vaultAddress(bytes32 salt) internal view returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, INIT_CODE_HASH))
                )
            )
        );
    }

    /// @dev Deploys on first use; a later call reuses the deployed vault.
    function _vault(bytes32 salt) internal returns (EscrowVault) {
        address vault = _vaultAddress(salt);
        if (vault.code.length == 0) {
            EscrowVault deployed = new EscrowVault{salt: salt}();
            assert(address(deployed) == vault);
        }
        return EscrowVault(vault);
    }
}
