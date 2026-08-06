// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";
import {IPermit2} from "./interfaces/IPermit2.sol";
import {OrderHash} from "./libraries/OrderHash.sol";

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PaymentRouter — stateless, atomic receive → swap → settle (RFC #4)
/// @notice The Phase 3 keystone. Receives the payer's asset, swaps through a
///         whitelisted DEX router when the assets differ, and settles
///         `minOut − fee` to the merchant Safe in one transaction. Hard revert on
///         `minOut` miss; zero resting balance; `intentId` consumed on success.
///
/// @dev Invariants (spec'd in RFC #4, enforced + tested in #28):
///      - **Hard revert on `minOut` miss** — no top-up, no partial settle. This
///        is what makes "merchant always receives the settlement asset" safe
///        without a treasury FX book.
///      - **Zero resting balance** — the contract never custodies value. Every
///        path sends all swap output out, returns unconsumed input and
///        router-refunded native to `refundTo`, and then asserts its balances are
///        exactly what they were when the call began. The assertion is against
///        that per-call baseline, not against absolute zero: a third party can
///        donate tokens or force-send ETH to any address, and an absolute-zero
///        assertion would let 1 wei brick every pay path permanently. Donated
///        dust stays stuck (there is no sweep, by design) but cannot block a
///        payment.
///      - **Idempotent** — `intentId` is consumed (effect) before any external
///        call; a replay reverts. Cross-chain replay is blocked by the EIP-712
///        domain (`verifyingContract` + `chainId`).
///      - **Bounded admin** — config changes (router/input-asset whitelist, fee
///        recipient, signer) are `onlyRole(CONFIG_ROLE)`, held by an external
///        OZ `TimelockController`. A `GUARDIAN_ROLE` can pause instantly (pause
///        never moves funds, so it needs no delay). There is no code path — admin
///        or otherwise — by which funds can be redirected.
contract PaymentRouter is IPaymentRouter, AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using OrderHash for IPaymentRouter.Order;

    /// @dev Contract version (mirrors the EIP-712 `version` field).
    string public constant VERSION = "1.0.0";

    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    /// @dev Instant pause/unpause. Cannot move funds; cannot change config.
    bytes32 internal constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @dev Config surface (router/input-asset whitelist, feeRecipient, signer).
    ///      Held by the external TimelockController, so every config change is
    ///      delayed. The multisig governs the timelock (proposer/canceller).
    bytes32 internal constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    // ---------------------------------------------------------------------
    // Immutables
    // ---------------------------------------------------------------------

    /// @dev Canonical Uniswap Permit2; the contract pulls ERC-20 inputs through it.
    IPermit2 public immutable permit2;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @dev Backend quote-signing key (RFC #6 custody model: HSM/KMS, rotation,
    ///      multisig). Rotation is a timelocked `setSigner`.
    address public signer;
    /// @dev Treasury destination for `fee`.
    address public feeRecipient;

    /// @dev `intentId` ⇒ settled. The idempotency record.
    mapping(bytes32 => bool) public consumed;
    /// @dev Admissible DEX routers. The whitelist is the trust boundary for input
    ///      custody during a swap; `minOut` hard-revert is the settlement guarantee.
    mapping(address => bool) public isRouterWhitelisted;
    /// @dev Admissible ERC-20 input assets. Native is always admissible (payEth).
    mapping(address => bool) public isInputAssetWhitelisted;
    /// @dev Admissible settlement assets — what a merchant may be paid in. Each
    ///      order names one, so a single router serves merchants settling in
    ///      different stablecoins. Whitelisting bounds the signer: it can choose
    ///      among admitted assets, never introduce one.
    mapping(address => bool) public isSettlementAssetWhitelisted;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @dev `PaymentCompleted` is inherited from `IPaymentRouter` (the public
    ///      event the Indexer ingests).
    ///
    ///      Residue is value that arrived during the call and is not part of the
    ///      settlement split: input the router did not consume on a partial fill,
    ///      or native an exact-output route handed back. It goes to `refundTo`,
    ///      so it is a second, separate movement from `PaymentCompleted.refundAmount`
    ///      (which is always settlement-asset excess above `minOut`). Additive —
    ///      `PaymentCompleted`'s shape is unchanged for the Indexer (#8).
    event ResidueRefunded(
        bytes32 indexed intentId, address indexed asset, address indexed to, uint256 amount
    );

    /// @dev Admin observability.
    event RouterWhitelisted(address indexed router);
    event RouterRemoved(address indexed router);
    event InputAssetWhitelisted(address indexed asset);
    event InputAssetRemoved(address indexed asset);
    event SettlementAssetWhitelisted(address indexed asset);
    event SettlementAssetRemoved(address indexed asset);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event SignerUpdated(address indexed signer);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ExpiredOrder();
    error AlreadyConsumed();
    error InvalidOrder();
    error FeeExceedsSettlement();
    error InvalidSigner();
    error NoRoute();
    error RouterNotWhitelisted(address router);
    error AssetNotWhitelisted(address asset);
    error SettlementAssetNotWhitelisted(address asset);
    error MinOutNotMet(uint256 output, uint256 minOut);
    error RestingBalance(uint256 native, uint256 token);
    error NativeRefundFailed();
    error NoSettlementAsset();
    error UnexpectedNative();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @dev Balances held at the start of a pay call, before any value arrives.
    ///      Everything the contract measures afterwards is a delta against this,
    ///      so pre-existing donated dust neither counts as swap output nor trips
    ///      the resting-balance assertion.
    struct Baseline {
        uint256 native;
        uint256 settlement;
        /// @dev Input-asset balance before the Permit2 pull. Unused (0) on the
        ///      native and same-asset paths, where the input needs no separate
        ///      accounting.
        uint256 input;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param timelock         OZ TimelockController — receives DEFAULT_ADMIN_ROLE
    ///                         and CONFIG_ROLE. All role + config changes go through
    ///                         it (delayed). The multisig governs the timelock.
    /// @param guardian         Instant pause/unpause holder (multisig).
    /// @param feeRecipient_    Treasury.
    /// @param signer_          Backend quote-signing key.
    /// @param settlementAssets Stablecoins merchants may settle in, whitelisted at
    ///                         deploy. Bootstrap only: without at least one the
    ///                         router cannot serve any payment, and adding one
    ///                         later costs the full timelock delay. Everything
    ///                         after this goes through `addSettlementAsset`.
    /// @param permit2_         Canonical Permit2 address for this chain.
    constructor(
        address timelock,
        address guardian,
        address feeRecipient_,
        address signer_,
        address[] memory settlementAssets,
        address permit2_
    ) EIP712("Mayarin PaymentRouter", "1") {
        if (
            timelock == address(0) || guardian == address(0) || feeRecipient_ == address(0)
                || signer_ == address(0) || permit2_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (settlementAssets.length == 0) {
            revert NoSettlementAsset();
        }
        // Role management is itself delayed: DEFAULT_ADMIN lives on the timelock,
        // so granting a new guardian/config requires a timelock operation.
        _grantRole(DEFAULT_ADMIN_ROLE, timelock);
        _grantRole(GUARDIAN_ROLE, guardian);
        _grantRole(CONFIG_ROLE, timelock);
        for (uint256 index = 0; index < settlementAssets.length; index += 1) {
            address asset = settlementAssets[index];
            if (asset == address(0)) revert ZeroAddress();
            isSettlementAssetWhitelisted[asset] = true;
            emit SettlementAssetWhitelisted(asset);
        }
        permit2 = IPermit2(permit2_);
        feeRecipient = feeRecipient_;
        signer = signer_;
    }

    // ---------------------------------------------------------------------
    // Pay paths
    // ---------------------------------------------------------------------

    /// @dev Accepts native only from a whitelisted router. Exact-output routes
    ///      hand back the unspent remainder to `msg.sender` mid-swap (Uniswap's
    ///      `refundETH` is the canonical case); without this the whole payment
    ///      would revert inside the route. `_returnResidue` forwards whatever
    ///      arrives to `refundTo` in the same transaction, so this is a pass-through,
    ///      not a deposit. Every other sender is rejected, which keeps casual
    ///      donations out; a `SELFDESTRUCT` force-send bypasses this hook entirely,
    ///      which is exactly why the resting-balance check is baseline-relative.
    receive() external payable {
        if (!isRouterWhitelisted[msg.sender]) revert UnexpectedNative();
    }

    /// @dev Public EIP-712 domain separator (OZ `_domainSeparatorV4` is internal).
    ///      Exposed so the Quote Engine (#6) and tests can compute the exact digest
    ///      the contract verifies, and the indexer/TS side can cross-check.
    function domainSeparatorV4() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IPaymentRouter
    function payEth(
        Order calldata order,
        bytes calldata signature,
        address router,
        bytes calldata data
    ) external payable override nonReentrant whenNotPaused {
        // Native input always differs from the (ERC-20) settlement asset → swap.
        if (router == address(0) || data.length == 0) revert NoRoute();
        _prepare(order, signature);
        // `msg.value` is already in `address(this).balance`; subtract it to get
        // what the contract held before this call.
        Baseline memory baseline = Baseline({
            native: address(this).balance - msg.value,
            settlement: IERC20(order.settlementToken).balanceOf(address(this)),
            input: 0
        });
        _execute(order, address(0), msg.value, router, data, true, baseline);
    }

    /// @inheritdoc IPaymentRouter
    function payERC20(
        Order calldata order,
        bytes calldata permitData,
        bytes calldata signature,
        address router,
        bytes calldata data
    ) external override nonReentrant whenNotPaused {
        (IPermit2.PermitSingle memory permit, bytes memory permitSig) =
            abi.decode(permitData, (IPermit2.PermitSingle, bytes));
        address inputAsset = permit.details.token;
        uint256 inputAmount = permit.details.amount;
        if (!isInputAssetWhitelisted[inputAsset]) revert AssetNotWhitelisted(inputAsset);
        bool sameAsset = inputAsset == order.settlementToken;
        if (!sameAsset && (router == address(0) || data.length == 0)) revert NoRoute();

        // Effect before interactions: consume the intent first so a reentrant or
        // replayed call reverts (defense in depth on top of nonReentrant).
        _prepare(order, signature);

        // Measured before the pull, so the pulled input is a delta, not a balance.
        // Same-asset needs no separate input baseline: input == settlement there.
        Baseline memory baseline = Baseline({
            native: address(this).balance,
            settlement: IERC20(order.settlementToken).balanceOf(address(this)),
            input: sameAsset ? 0 : IERC20(inputAsset).balanceOf(address(this))
        });

        // Interaction: authorize via the payer's Permit2 sig, then pull the input.
        // The permit's `spender` must be this contract or `transferFrom` reverts.
        permit2.permit(msg.sender, permit, permitSig);
        permit2.transferFrom(msg.sender, address(this), uint160(inputAmount), inputAsset);

        _execute(order, inputAsset, inputAmount, router, data, false, baseline);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Verifies the signed order and marks `intentId` consumed. Pure +
    ///      storage reads only — no external call — so the effect (consume)
    ///      precedes every interaction (pull, swap, transfer).
    function _prepare(Order calldata order, bytes calldata signature) internal {
        if (block.timestamp > order.deadline) revert ExpiredOrder();
        if (order.minOut == 0 || order.merchantSafe == address(0) || order.refundTo == address(0)) {
            revert InvalidOrder();
        }
        if (order.fee >= order.minOut) revert FeeExceedsSettlement(); // merchant must be > 0
        if (!isSettlementAssetWhitelisted[order.settlementToken]) {
            revert SettlementAssetNotWhitelisted(order.settlementToken);
        }
        if (consumed[order.intentId]) revert AlreadyConsumed();
        consumed[order.intentId] = true;

        bytes32 digest = _hashTypedDataV4(order.structHash());
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != signer) revert InvalidSigner();
    }

    /// @dev Swap (or same-asset no-op) then settle. Splits the measured `output`
    ///      so the merchant gets the hard-locked `minOut − fee`, the treasury gets
    ///      `fee`, and the payer gets back `output − minOut`. Conservation:
    ///      `(minOut − fee) + fee + (output − minOut) == output`.
    function _execute(
        Order calldata order,
        address inputAsset,
        uint256 inputAmount,
        address router,
        bytes calldata data,
        bool isNative,
        Baseline memory baseline
    ) internal {
        bool sameAsset = !isNative && inputAsset == order.settlementToken;

        uint256 output;
        if (sameAsset) {
            // No router call: the pulled input IS the settlement asset.
            output = inputAmount;
        } else {
            if (!isRouterWhitelisted[router]) revert RouterNotWhitelisted(router);
            if (isNative) {
                _call(router, inputAmount, data);
            } else {
                // Exact approval, reset to 0 after — no lingering allowance.
                IERC20(inputAsset).forceApprove(router, inputAmount);
                _call(router, 0, data);
                IERC20(inputAsset).forceApprove(router, 0);
            }
            // The swap delivered into this contract; the settlement baseline is
            // its balance before the call (the Permit2 pull moved a different
            // token), so the delta is exactly what the route produced.
            output = IERC20(order.settlementToken).balanceOf(address(this)) - baseline.settlement;
        }

        if (output < order.minOut) revert MinOutNotMet(output, order.minOut);

        uint256 settled = order.minOut - order.fee;
        uint256 refund = output - order.minOut;

        // Send all output out — zero resting balance.
        IERC20 settlement = IERC20(order.settlementToken);
        settlement.safeTransfer(order.merchantSafe, settled);
        settlement.safeTransfer(feeRecipient, order.fee);
        if (refund > 0) {
            settlement.safeTransfer(order.refundTo, refund);
        }

        _returnResidue(order, inputAsset, isNative, sameAsset, baseline);

        emit PaymentCompleted({
            intentId: order.intentId,
            merchantSafe: order.merchantSafe,
            refundTo: order.refundTo,
            inputAsset: inputAsset,
            settlementAsset: order.settlementToken,
            inputAmount: inputAmount,
            settledAmount: settled,
            fee: order.fee,
            refundAmount: refund,
            deadline: order.deadline
        });
    }

    /// @dev Returns everything that arrived during this call and is not part of
    ///      the settlement split, then asserts the contract holds exactly what it
    ///      held when the call began.
    ///
    ///      Two residues are possible. A router that partially fills leaves
    ///      unconsumed input behind — the approval is already reset to 0, so it
    ///      would otherwise sit here forever with no way out. An exact-output
    ///      native route hands back the unspent remainder. Both belong to the
    ///      payer, so both go to `refundTo`.
    ///
    ///      The final check is delta-based on purpose. Asserting absolute zero
    ///      would mean anyone could permanently disable the contract by sending
    ///      it 1 wei of the settlement token or force-sending ETH: the donation
    ///      is not swap output, nothing distributes it, and there is no sweep —
    ///      so every subsequent payment would revert with no recovery short of
    ///      redeploying. Against a baseline, a donation is inert: it stays stuck
    ///      (still no sweep — `test_no_sweep_dust_cannot_be_extracted`) and
    ///      payments keep clearing.
    function _returnResidue(
        Order calldata order,
        address inputAsset,
        bool isNative,
        bool sameAsset,
        Baseline memory baseline
    ) internal {
        if (!isNative && !sameAsset) {
            uint256 inputNow = IERC20(inputAsset).balanceOf(address(this));
            if (inputNow > baseline.input) {
                uint256 residue = inputNow - baseline.input;
                IERC20(inputAsset).safeTransfer(order.refundTo, residue);
                emit ResidueRefunded(order.intentId, inputAsset, order.refundTo, residue);
            }
        }

        uint256 nativeNow = address(this).balance;
        if (nativeNow > baseline.native) {
            uint256 residue = nativeNow - baseline.native;
            // Last movement of the call, behind `nonReentrant`, with the intent
            // already consumed — a reentrant `refundTo` cannot re-enter a pay path.
            (bool ok,) = order.refundTo.call{value: residue}("");
            if (!ok) revert NativeRefundFailed();
            emit ResidueRefunded(order.intentId, address(0), order.refundTo, residue);
        }

        uint256 nativeBal = address(this).balance;
        uint256 tokenBal = IERC20(order.settlementToken).balanceOf(address(this));
        if (nativeBal != baseline.native || tokenBal != baseline.settlement) {
            revert RestingBalance(nativeBal, tokenBal);
        }
    }

    /// @dev Low-level call to `router` with optional native value; bubbles the
    ///      router's revert reason up so a failing swap fails the whole payment.
    function _call(address router, uint256 value, bytes calldata data) internal {
        (bool ok, bytes memory ret) = router.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    // ---------------------------------------------------------------------
    // Admin — onlyRole(CONFIG_ROLE) (held by the TimelockController)
    // ---------------------------------------------------------------------

    function addRouter(address router) external onlyRole(CONFIG_ROLE) {
        if (router == address(0)) revert ZeroAddress();
        isRouterWhitelisted[router] = true;
        emit RouterWhitelisted(router);
    }

    function removeRouter(address router) external onlyRole(CONFIG_ROLE) {
        isRouterWhitelisted[router] = false;
        emit RouterRemoved(router);
    }

    function addInputAsset(address asset) external onlyRole(CONFIG_ROLE) {
        if (asset == address(0)) revert ZeroAddress();
        isInputAssetWhitelisted[asset] = true;
        emit InputAssetWhitelisted(asset);
    }

    function removeInputAsset(address asset) external onlyRole(CONFIG_ROLE) {
        isInputAssetWhitelisted[asset] = false;
        emit InputAssetRemoved(asset);
    }

    function addSettlementAsset(address asset) external onlyRole(CONFIG_ROLE) {
        if (asset == address(0)) revert ZeroAddress();
        isSettlementAssetWhitelisted[asset] = true;
        emit SettlementAssetWhitelisted(asset);
    }

    function removeSettlementAsset(address asset) external onlyRole(CONFIG_ROLE) {
        isSettlementAssetWhitelisted[asset] = false;
        emit SettlementAssetRemoved(asset);
    }

    function setFeeRecipient(address recipient) external onlyRole(CONFIG_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    function setSigner(address newSigner) external onlyRole(CONFIG_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        signer = newSigner;
        emit SignerUpdated(newSigner);
    }

    // ---------------------------------------------------------------------
    // Guardian — instant pause. Unpause is also instant: pause never traps
    // value (zero resting balance), so a rogue guardian can only DoS (recoverable
    // via the multisig rotating the guardian through the timelock).
    // ---------------------------------------------------------------------

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }
}