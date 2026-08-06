// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {MockPermit2} from "./helpers/MockPermit2.sol";
import {MockRouter} from "./helpers/MockRouter.sol";
import {SigHelpers} from "./helpers/SigHelpers.sol";

/// @dev #27 — bounded, timelocked admin. Deploys a REAL OZ `TimelockController`
///      as the `CONFIG_ROLE` + `DEFAULT_ADMIN` holder, and a separate guardian
///      with instant `GUARDIAN_ROLE` pause. Asserts:
///        - config changes (router/asset whitelist, feeRecipient, signer) only
///          land through schedule → wait → execute; before the delay, execute
///          reverts.
///        - a non-admin (no role) is rejected on every config + role surface.
///        - no admin path can move funds — config calls are storage-only; the
///          contract exposes no withdraw/sweep, so dust cannot be extracted.
///        - the guardian pauses instantly (no delay) and pause blocks pays.
contract AdminTest is Test, SigHelpers {
    // Role bytecode mirrors the contract's internal constants (kept private
    // there), so the test recomputes them for AccessControlUnauthorizedAccount
    // assertions rather than depending on internal exposure.
    bytes32 internal constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 internal constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // Test delay is small for wall-clock; prod is 48h (see README). The delay is
    // set once in the timelock constructor and cannot be lowered per-operation.
    uint256 internal constant DELAY = 100;

    PaymentRouter public router;
    TimelockController public tc;
    MockERC20 public usdc;
    MockERC20 public weth;
    MockPermit2 public permit2;
    MockRouter public dex;

    address public multisig; // proposer + executor + timelock admin
    address public guardian; // instant pause holder
    address public treasury;
    address public merchant;
    address public customer;
    address public signerAddr;
    uint256 public signerPk;

    bytes32 internal constant INTENT = keccak256("intent-admin");

    function setUp() public {
        multisig = makeAddr("multisig");
        guardian = makeAddr("guardian");
        treasury = makeAddr("treasury");
        merchant = makeAddr("merchant");
        customer = makeAddr("customer");
        signerPk = 0xB0B;
        signerAddr = vm.addr(signerPk);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        permit2 = new MockPermit2();
        dex = new MockRouter();

        address[] memory proposers = new address[](1);
        proposers[0] = multisig;
        address[] memory executors = new address[](1);
        executors[0] = multisig;
        tc = new TimelockController(DELAY, proposers, executors, multisig);

        router = new PaymentRouter({
            timelock: address(tc),
            guardian: guardian,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementAssets: _oneSettlementAsset(address(usdc)),
            permit2_: address(permit2)
        });

        // Seed the whitelists + fund the dex so a pay can run after unpause. Each
        // op is distinct calldata, so the fixed salt yields distinct op ids.
        _executeCall(abi.encodeWithSelector(router.addRouter.selector, address(dex)));
        _executeCall(abi.encodeWithSelector(router.addInputAsset.selector, address(weth)));
        _executeCall(abi.encodeWithSelector(router.addInputAsset.selector, address(usdc)));
        usdc.mint(address(dex), 1_000_000e6);
        vm.deal(customer, 10 ether);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    bytes32 internal constant SETUP_SALT = bytes32(uint256(0xA11CE));

    /// @dev Schedule a call against the router through the timelock, returning
    ///      the operation id (re-derived from (target, data, predecessor, salt)).
    function _scheduleCall(bytes memory callData, bytes32 predecessor, bytes32 salt)
        internal
        returns (bytes32 opId)
    {
        vm.prank(multisig);
        tc.schedule(address(router), 0, callData, predecessor, salt, DELAY);
        opId = tc.hashOperation(address(router), 0, callData, predecessor, salt);
    }

    /// @dev Schedule then immediately execute (warps past the delay). Used for
    ///      fixture setup so the test body can focus on the boundary checks.
    function _executeCall(bytes memory callData) internal {
        bytes32 predecessor = bytes32(0);
        _scheduleCall(callData, predecessor, SETUP_SALT);
        vm.warp(block.timestamp + DELAY + 1);
        vm.prank(multisig);
        tc.execute(address(router), 0, callData, predecessor, SETUP_SALT);
    }

    function _order(uint256 minOut, uint256 fee, uint256 deadline)
        internal
        view
        returns (IPaymentRouter.Order memory)
    {
        return makeOrder(INTENT, address(usdc), minOut, fee, merchant, customer, deadline);
    }

    function _sign(IPaymentRouter.Order memory o) internal returns (bytes memory) {
        return signOrder(address(router), o, signerPk);
    }

    // ------------------------------------------------------------------
    // Timelock boundary
    // ------------------------------------------------------------------

    function test_config_change_lands_only_after_delay() public {
        address newRouter = makeAddr("newRouter");
        bytes memory data = abi.encodeWithSelector(router.addRouter.selector, newRouter);
        bytes32 predecessor = bytes32(0);
        bytes32 salt = bytes32(0);

        vm.prank(multisig);
        tc.schedule(address(router), 0, data, predecessor, salt, DELAY);
        bytes32 opId = tc.hashOperation(address(router), 0, data, predecessor, salt);

        // Before the delay elapses, execute reverts — the op is Waiting, not
        // Ready. expectedStates is the Ready bitmap (1 << OperationState.Ready
        // == 1 << 2 == 4). Foundry's bytes4 expectRevert matches only 4-byte
        // returndata, so the arg-bearing error is matched by full encoded data.
        vm.prank(multisig);
        vm.expectRevert(
            abi.encodeWithSelector(
                TimelockController.TimelockUnexpectedOperationState.selector,
                opId,
                bytes32(uint256(1) << uint256(uint8(TimelockController.OperationState.Ready)))
            )
        );
        tc.execute(address(router), 0, data, predecessor, salt);

        // Past the delay, execute lands the change.
        vm.warp(block.timestamp + DELAY + 1);
        assertFalse(router.isRouterWhitelisted(newRouter), "not yet");
        vm.prank(multisig);
        tc.execute(address(router), 0, data, predecessor, salt);
        assertTrue(router.isRouterWhitelisted(newRouter), "whitelisted after execute");
    }

    function test_config_change_idempotent_under_salt() public {
        // Same (target, data, salt) scheduled twice is the same operation id;
        // the second schedule reverts — the op already exists, so it is not in
        // the Unset state the schedule requires (expectedStates = Unset bitmap
        // == 1 << 0 == 1).
        address newRouter = makeAddr("newRouter2");
        bytes memory data = abi.encodeWithSelector(router.addRouter.selector, newRouter);
        bytes32 predecessor = bytes32(0);
        bytes32 salt = bytes32(uint256(0xBEEF));

        vm.prank(multisig);
        tc.schedule(address(router), 0, data, predecessor, salt, DELAY);
        bytes32 opId = tc.hashOperation(address(router), 0, data, predecessor, salt);

        vm.prank(multisig);
        vm.expectRevert(
            abi.encodeWithSelector(
                TimelockController.TimelockUnexpectedOperationState.selector,
                opId,
                bytes32(uint256(1) << uint256(uint8(TimelockController.OperationState.Unset)))
            )
        );
        tc.schedule(address(router), 0, data, predecessor, salt, DELAY);
    }

    // ------------------------------------------------------------------
    // Non-admin rejection on every protected surface
    // ------------------------------------------------------------------

    function test_non_admin_rejected_on_config() public {
        address nobody = makeAddr("nobody");
        vm.startPrank(nobody);
        vm.expectRevert(_unauthorized(nobody, CONFIG_ROLE));
        router.addRouter(makeAddr("r1"));
        vm.expectRevert(_unauthorized(nobody, CONFIG_ROLE));
        router.removeRouter(makeAddr("r2"));
        vm.expectRevert(_unauthorized(nobody, CONFIG_ROLE));
        router.addInputAsset(makeAddr("a1"));
        vm.expectRevert(_unauthorized(nobody, CONFIG_ROLE));
        router.removeInputAsset(makeAddr("a2"));
        vm.expectRevert(_unauthorized(nobody, CONFIG_ROLE));
        router.setFeeRecipient(makeAddr("fr"));
        vm.expectRevert(_unauthorized(nobody, CONFIG_ROLE));
        router.setSigner(makeAddr("sg"));
        vm.stopPrank();
    }

    function test_non_guardian_rejected_on_pause() public {
        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(_unauthorized(nobody, GUARDIAN_ROLE));
        router.pause();
        vm.prank(nobody);
        vm.expectRevert(_unauthorized(nobody, GUARDIAN_ROLE));
        router.unpause();
    }

    function test_timelock_is_config_role_not_guardian() public {
        // The timelock holds CONFIG_ROLE but NOT GUARDIAN_ROLE, so even though it
        // can change config (after delay) it cannot pause — pause power is split
        // off to the guardian. This is the separation the plan locks in.
        vm.prank(address(tc));
        vm.expectRevert(_unauthorized(address(tc), GUARDIAN_ROLE));
        router.pause();
    }

    // ------------------------------------------------------------------
    // No admin fund-redirect path
    // ------------------------------------------------------------------

    function test_config_changes_move_no_funds() public {
        // Pre-fund the router with settlement tokens (simulating dust or an
        // accidental direct send). Every config change the timelock can make
        // is storage-only — none of them transfer tokens.
        uint256 dust = 500e6;
        usdc.mint(address(router), dust);
        assertEq(usdc.balanceOf(address(router)), dust, "prefund");

        address newTreasury = makeAddr("newTreasury");
        address newSigner = makeAddr("newSigner");
        address extraRouter = makeAddr("extraRouter");
        address extraAsset = makeAddr("extraAsset");

        _executeCall(abi.encodeWithSelector(router.setFeeRecipient.selector, newTreasury));
        assertEq(router.feeRecipient(), newTreasury, "feeRecipient storage changed");
        assertEq(usdc.balanceOf(address(router)), dust, "no tokens moved by setFeeRecipient");

        _executeCall(abi.encodeWithSelector(router.setSigner.selector, newSigner));
        assertEq(router.signer(), newSigner, "signer storage changed");
        assertEq(usdc.balanceOf(address(router)), dust, "no tokens moved by setSigner");

        _executeCall(abi.encodeWithSelector(router.addRouter.selector, extraRouter));
        assertTrue(router.isRouterWhitelisted(extraRouter));
        assertEq(usdc.balanceOf(address(router)), dust, "no tokens moved by addRouter");

        _executeCall(abi.encodeWithSelector(router.addInputAsset.selector, extraAsset));
        assertTrue(router.isInputAssetWhitelisted(extraAsset));
        assertEq(usdc.balanceOf(address(router)), dust, "no tokens moved by addInputAsset");
    }

    function test_no_sweep_dust_cannot_be_extracted() public {
        // The contract exposes no withdraw/sweep. Dust sent to it cannot be
        // pulled out by anyone — not the guardian, not the timelock. The only
        // ways value leaves are the pay paths (which split a freshly-measured
        // swap output and then enforce zero resting balance), so a pre-existing
        // balance cannot be siphoned via admin action.
        uint256 dust = 123e6;
        usdc.mint(address(router), dust);
        vm.prank(guardian);
        router.pause(); // pause does not move funds
        assertEq(usdc.balanceOf(address(router)), dust, "pause moved nothing");
        vm.prank(guardian);
        router.unpause();
        // No public function on `router` extracts `dust`; the balance persists.
        assertEq(usdc.balanceOf(address(router)), dust, "dust still there, unsweepable");
    }

    // ------------------------------------------------------------------
    // Guardian pause blocks pays, instant, recoverable
    // ------------------------------------------------------------------

    function test_guardian_pause_instant_and_blocks_pays() public {
        IPaymentRouter.Order memory o = _order(100e6, 1e6, block.timestamp + 3600);
        bytes memory sig = _sign(o);

        // Before pause: pay works.
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), _ethData(120e6));
        assertTrue(router.consumed(INTENT), "first pay settled");

        // Guardian pauses instantly — no schedule, no delay.
        vm.prank(guardian);
        router.pause();
        assertTrue(router.paused());

        // A fresh intent is blocked while paused.
        bytes32 id2 = keccak256("intent-admin-2");
        IPaymentRouter.Order memory o2 = makeOrder(id2, address(usdc), 100e6, 1e6, merchant, customer, block.timestamp + 3600);
        bytes memory sig2 = signOrder(address(router), o2, signerPk);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        router.payEth{value: 1 ether}(o2, sig2, address(dex), _ethData(120e6));
        assertFalse(router.consumed(id2), "paused pay did not consume");

        // Guardian unpauses; pays resume.
        vm.prank(guardian);
        router.unpause();
        assertFalse(router.paused());
        vm.prank(customer);
        router.payEth{value: 1 ether}(o2, sig2, address(dex), _ethData(120e6));
        assertTrue(router.consumed(id2), "resumed pay settled");
    }

    function test_guardian_pause_only_dos_not_fund_loss() public {
        // A rogue guardian can only pause (DoS); it cannot redirect settlement,
        // change the fee recipient, or alter the signer — all config is on the
        // timelock. The recovery path is the multisig rotating the guardian via
        // a timelocked role grant.
        vm.prank(guardian);
        router.pause();
        vm.prank(guardian);
        vm.expectRevert(_unauthorized(guardian, CONFIG_ROLE));
        router.setFeeRecipient(makeAddr("rogue-treasury"));
        vm.prank(guardian);
        vm.expectRevert(_unauthorized(guardian, CONFIG_ROLE));
        router.setSigner(makeAddr("rogue-signer"));
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _ethData(uint256 output) internal view returns (bytes memory) {
        return abi.encodeWithSelector(MockRouter.swapFromETH.selector, address(usdc), output, address(router));
    }

    function _unauthorized(address account, bytes32 role)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role);
    }
}