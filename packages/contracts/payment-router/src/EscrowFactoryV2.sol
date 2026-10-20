// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EscrowVaultV2} from "./EscrowVaultV2.sol";

/// @title EscrowFactoryV2 — escrow with a dispute bond and split resolution (RFC #315)
/// @notice `EscrowFactory` (#304) with two rules it lacks:
///
///         - **Dispute bond.** Disputing costs the payer `terms.bond` of the
///           settlement token, pulled into the escrow. A claim that holds gets
///           it back; a claim that fails pays it to the merchant. With
///           `bond == 0` disputing is free, as in v1.
///         - **Split resolution.** The arbiter may divide the payment instead
///           of choosing all-or-nothing — for "arrived, but damaged".
///
///         Everything else is v1: the payer releases any time; anyone releases
///         an undisputed escrow once `releaseAfter` passes; the payee refunds
///         any time; after a dispute the arbiter decides until `resolveBy`;
///         a dispute still open at `resolveBy` refunds the payer, bond
///         included — an absent arbiter is not the payer's fault.
///
///         Where the bond goes:
///
///         | Move                         | Payment            | Bond                 |
///         | ---------------------------- | ------------------ | -------------------- |
///         | `release` (anyone allowed)   | payee              | payee                |
///         | `refund` (anyone allowed)    | payer              | payer                |
///         | `resolve(payeeBps)`          | split by `payeeBps`| the majority; payer at 50/50 |
///
///         A payer who disputes and then releases has conceded the claim, so
///         the bond follows the payment to the payee.
///
/// @dev No owner, admin, upgrade or pause. Terms — bond included — are the
///      CREATE2 salt, fixed by the address the payer paid to. State is the
///      dispute flag (payer only, once) and the last outcome.
contract EscrowFactoryV2 {
    using SafeERC20 for IERC20;

    struct Terms {
        bytes32 intentId;
        address payer;
        address payee;
        /// @dev `address(0)`, or one equal to a party, means no arbiter.
        address arbiter;
        uint64 releaseAfter;
        uint64 resolveBy;
        /// @dev Settlement-token units the payer posts to dispute. 0: free.
        uint256 bond;
    }

    enum Outcome {
        Held,
        Released,
        Refunded,
        Split
    }

    uint16 public constant BPS = 10_000;

    bytes32 public constant INIT_CODE_HASH = keccak256(type(EscrowVaultV2).creationCode);

    /// @notice salt ⇒ the payer disputed (and posted the bond) before `releaseAfter`.
    mapping(bytes32 => bool) public disputed;
    /// @notice salt ⇒ where the funds last went. `Held` until a move carries value.
    mapping(bytes32 => Outcome) public outcome;

    event Released(
        bytes32 indexed intentId, address indexed token, address indexed to, uint256 amount
    );
    event Refunded(
        bytes32 indexed intentId, address indexed token, address indexed to, uint256 amount
    );
    event Resolved(
        bytes32 indexed intentId, address indexed token, uint256 toPayee, uint256 toPayer
    );
    event Disputed(bytes32 indexed intentId, uint256 bond);

    error NotAllowed();
    error HoldEnded();
    error AlreadyDisputed();
    error Closed();
    error InvalidSplit();

    function saltOf(Terms calldata terms) public pure returns (bytes32) {
        return keccak256(abi.encode(terms));
    }

    function escrowAddress(Terms calldata terms) public view returns (address) {
        return _vaultAddress(saltOf(terms));
    }

    /// @notice Moves everything the escrow holds of `token` to the payee.
    function release(Terms calldata terms, IERC20 token) external returns (uint256 amount) {
        bytes32 salt = saltOf(terms);
        bool isDisputed = disputed[salt];
        bool allowed = msg.sender == terms.payer
            || (isDisputed && _arbitrates(terms) && block.timestamp < terms.resolveBy)
            || (!isDisputed && block.timestamp >= terms.releaseAfter);
        if (!allowed) revert NotAllowed();

        amount = _moveAll(salt, token, terms.payee);
        if (amount != 0) outcome[salt] = Outcome.Released;
        emit Released(terms.intentId, address(token), terms.payee, amount);
    }

    /// @notice Moves everything the escrow holds of `token` back to the payer.
    function refund(Terms calldata terms, IERC20 token) external returns (uint256 amount) {
        bytes32 salt = saltOf(terms);
        bool isDisputed = disputed[salt];
        bool allowed = msg.sender == terms.payee
            || (isDisputed && _arbitrates(terms) && block.timestamp < terms.resolveBy)
            || (isDisputed && block.timestamp >= terms.resolveBy);
        if (!allowed) revert NotAllowed();

        amount = _moveAll(salt, token, terms.payer);
        if (amount != 0) outcome[salt] = Outcome.Refunded;
        emit Refunded(terms.intentId, address(token), terms.payer, amount);
    }

    /// @notice The arbiter splits a disputed payment: `payeeBps` of it to the
    ///         payee, the rest to the payer. The bond goes to whichever side
    ///         got more, and back to the payer at an even split.
    function resolve(Terms calldata terms, IERC20 token, uint16 payeeBps)
        external
        returns (uint256 toPayee, uint256 toPayer)
    {
        bytes32 salt = saltOf(terms);
        if (!(disputed[salt] && _arbitrates(terms) && block.timestamp < terms.resolveBy)) {
            revert NotAllowed();
        }
        if (payeeBps > BPS) revert InvalidSplit();

        address vault = _vaultAddress(salt);
        uint256 balance = token.balanceOf(vault);
        // The bond sits in the same token; it is not part of what is split.
        uint256 bond = terms.bond < balance ? terms.bond : balance;
        uint256 payment = balance - bond;

        toPayee = payment * payeeBps / BPS;
        toPayer = payment - toPayee;
        if (payeeBps * 2 > BPS) toPayee += bond;
        else toPayer += bond;

        EscrowVaultV2 deployed = _vault(salt);
        deployed.transfer(token, terms.payee, toPayee);
        deployed.transfer(token, terms.payer, toPayer);
        if (balance != 0) outcome[salt] = Outcome.Split;
        emit Resolved(terms.intentId, address(token), toPayee, toPayer);
    }

    /// @notice The payer stops the timeout release and posts the bond. Once,
    ///         before the hold ends, while the escrow is still held. The payer
    ///         must have approved `terms.bond` of `token` to this factory.
    function dispute(Terms calldata terms, IERC20 token) external {
        if (msg.sender != terms.payer) revert NotAllowed();
        if (block.timestamp >= terms.releaseAfter) revert HoldEnded();
        bytes32 salt = saltOf(terms);
        if (disputed[salt]) revert AlreadyDisputed();
        if (outcome[salt] != Outcome.Held) revert Closed();

        disputed[salt] = true;
        if (terms.bond != 0) token.safeTransferFrom(msg.sender, _vaultAddress(salt), terms.bond);
        emit Disputed(terms.intentId, terms.bond);
    }

    function _moveAll(bytes32 salt, IERC20 token, address to) internal returns (uint256 amount) {
        amount = token.balanceOf(_vaultAddress(salt));
        if (amount != 0) _vault(salt).transfer(token, to, amount);
    }

    /// @dev The caller is the terms' arbiter, and the arbiter is neither party.
    function _arbitrates(Terms calldata terms) internal view returns (bool) {
        return msg.sender == terms.arbiter && terms.arbiter != address(0)
            && terms.arbiter != terms.payer && terms.arbiter != terms.payee;
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

    function _vault(bytes32 salt) internal returns (EscrowVaultV2) {
        address vault = _vaultAddress(salt);
        if (vault.code.length == 0) {
            EscrowVaultV2 deployed = new EscrowVaultV2{salt: salt}();
            assert(address(deployed) == vault);
        }
        return EscrowVaultV2(vault);
    }
}
