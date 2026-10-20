// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Harness} from "./helpers/Harness.sol";

/// @dev SEC-06 — the destination registry. Once enforced, an order settles only
///      to a Safe the registrar admitted, so a compromised quote signer alone can
///      no longer name a destination. Off by default, so a new router can be
///      backfilled before it starts refusing.
contract MerchantRegistryTest is Harness {
    bytes32 internal constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 internal constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 internal constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    address internal registrar;
    address internal guardian;
    address internal attacker;
    address internal stranger;

    function setUp() public override {
        super.setUp();
        registrar = makeAddr("registrar");
        guardian = makeAddr("guardian");
        attacker = makeAddr("attacker");
        stranger = makeAddr("stranger");

        // A router whose guardian is not the timelock, so "the guardian" and "the
        // timelock" are told apart.
        router = new PaymentRouter({
            timelock: admin,
            guardian: guardian,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementAssets: _oneSettlementAsset(address(usdc)),
            permit2_: address(permit2)
        });
        vm.startPrank(admin);
        router.addInputAsset(address(usdc));
        // The timelock (DEFAULT_ADMIN) is what names a registrar.
        router.grantRole(REGISTRAR_ROLE, registrar);
        vm.stopPrank();
    }

    function _pay(bytes32 intent, address safe) internal {
        _attempt(intent, safe, "");
    }

    /// @dev Everything is set up before `expectRevert`, which binds to the next call.
    function _attempt(bytes32 intent, address safe, bytes memory expected) internal {
        uint256 inputAmount = 200e6;
        fund(address(usdc), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(usdc), inputAmount, uint48(uint256(intent) % 1000));
        IPaymentRouter.Order memory o = makeOrder(intent, address(usdc), 150e6, 5e6, safe, customer, deadlineIn(3600));
        bytes memory sig = sign(o);
        bytes memory permitData = encodePermit(p);
        if (expected.length > 0) vm.expectRevert(expected);
        vm.prank(customer);
        router.payERC20(o, permitData, sig, address(0), "");
    }

    // ------------------------------------------------------------------
    // Off by default
    // ------------------------------------------------------------------

    function test_registry_is_off_at_deploy_so_a_new_router_can_be_backfilled() public {
        assertFalse(router.merchantRegistryEnforced());
        _pay(keccak256("a"), attacker); // anywhere: today's behaviour
        assertEq(usdc.balanceOf(attacker), 145e6);
    }

    // ------------------------------------------------------------------
    // Enforced
    // ------------------------------------------------------------------

    function test_enforced_an_unregistered_destination_cannot_be_paid() public {
        vm.prank(admin);
        router.setMerchantRegistryEnforced(true);

        // A compromised signer can sign an order to its own address; the router refuses.
        _attempt(
            keccak256("b"),
            attacker,
            abi.encodeWithSelector(PaymentRouter.MerchantSafeNotRegistered.selector, attacker)
        );
        assertEq(usdc.balanceOf(attacker), 0);
        assertFalse(router.consumed(keccak256("b")));
    }

    function test_enforced_a_registered_destination_is_paid() public {
        vm.prank(admin);
        router.setMerchantRegistryEnforced(true);
        vm.prank(registrar);
        router.registerMerchantSafe(merchant);

        _pay(keccak256("c"), merchant);
        assertEq(usdc.balanceOf(merchant), 145e6);
    }

    function test_the_signer_cannot_register_a_destination() public {
        vm.prank(signerAddr);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, signerAddr, REGISTRAR_ROLE)
        );
        router.registerMerchantSafe(attacker);
    }

    function test_only_the_registrar_registers() public {
        for (uint256 i = 0; i < 3; i++) {
            address who = i == 0 ? guardian : (i == 1 ? admin : stranger);
            vm.prank(who);
            vm.expectRevert(
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, REGISTRAR_ROLE)
            );
            router.registerMerchantSafe(merchant);
        }
        vm.prank(registrar);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        router.registerMerchantSafe(address(0));
    }

    function test_enforcement_is_a_timelocked_act() public {
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, CONFIG_ROLE)
        );
        router.setMerchantRegistryEnforced(true);
        vm.prank(registrar);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, CONFIG_ROLE)
        );
        router.setMerchantRegistryEnforced(true);
    }

    // ------------------------------------------------------------------
    // Revoking
    // ------------------------------------------------------------------

    function test_the_guardian_revokes_at_once_and_the_destination_stops_being_paid() public {
        vm.prank(admin);
        router.setMerchantRegistryEnforced(true);
        vm.prank(registrar);
        router.registerMerchantSafe(merchant);
        _pay(keccak256("d"), merchant);

        vm.prank(guardian);
        router.revokeMerchantSafe(merchant);

        assertFalse(router.isMerchantSafeRegistered(merchant));
        assertTrue(router.isMerchantSafeRevoked(merchant));
        _attempt(
            keccak256("e"),
            merchant,
            abi.encodeWithSelector(PaymentRouter.MerchantSafeNotRegistered.selector, merchant)
        );
    }

    function test_the_registrar_cannot_revoke_nor_bring_a_revoked_destination_back() public {
        vm.prank(registrar);
        router.registerMerchantSafe(merchant);
        vm.prank(guardian);
        router.revokeMerchantSafe(merchant);

        vm.prank(registrar);
        vm.expectRevert(PaymentRouter.NotRegistryAuthority.selector);
        router.revokeMerchantSafe(merchant);

        // The compromised-then-revoked address is not one key away from live.
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.MerchantSafeIsRevoked.selector, merchant));
        router.registerMerchantSafe(merchant);
    }

    function test_a_stranger_cannot_revoke() public {
        vm.prank(stranger);
        vm.expectRevert(PaymentRouter.NotRegistryAuthority.selector);
        router.revokeMerchantSafe(merchant);
    }

    function test_only_the_timelock_reinstates() public {
        vm.prank(registrar);
        router.registerMerchantSafe(merchant);
        vm.prank(guardian);
        router.revokeMerchantSafe(merchant);

        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, CONFIG_ROLE)
        );
        router.reinstateMerchantSafe(merchant);

        vm.prank(admin);
        router.reinstateMerchantSafe(merchant);
        assertTrue(router.isMerchantSafeRegistered(merchant));
        assertFalse(router.isMerchantSafeRevoked(merchant));
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    function test_events_say_who_did_what() public {
        vm.expectEmit(true, false, false, true);
        emit PaymentRouter.MerchantSafeRegistered(merchant);
        vm.prank(registrar);
        router.registerMerchantSafe(merchant);

        vm.expectEmit(true, true, false, true);
        emit PaymentRouter.MerchantSafeRevoked(merchant, guardian);
        vm.prank(guardian);
        router.revokeMerchantSafe(merchant);

        vm.expectEmit(false, false, false, true);
        emit PaymentRouter.MerchantRegistryEnforcementSet(true);
        vm.prank(admin);
        router.setMerchantRegistryEnforced(true);
    }

    // ------------------------------------------------------------------
    // Governance: both steps go through a real timelock
    // ------------------------------------------------------------------

    function test_the_timelock_names_the_registrar_then_turns_enforcement_on() public {
        address[] memory who = new address[](1);
        who[0] = admin;
        TimelockController tc = new TimelockController(100, who, who, address(0));
        PaymentRouter governed = new PaymentRouter({
            timelock: address(tc),
            guardian: guardian,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementAssets: _oneSettlementAsset(address(usdc)),
            permit2_: address(permit2)
        });

        // Tracked in a variable: under via_ir `block.timestamp` is not re-read after a warp.
        uint256 t = block.timestamp;
        bytes memory grant = abi.encodeCall(IAccessControl.grantRole, (REGISTRAR_ROLE, registrar));
        vm.startPrank(admin);
        tc.schedule(address(governed), 0, grant, bytes32(0), bytes32("g"), 100);
        vm.expectRevert(); // not ready
        tc.execute(address(governed), 0, grant, bytes32(0), bytes32("g"));
        vm.warp(t + 100);
        tc.execute(address(governed), 0, grant, bytes32(0), bytes32("g"));
        vm.stopPrank();
        assertTrue(governed.hasRole(REGISTRAR_ROLE, registrar));

        bytes memory enforce = abi.encodeCall(PaymentRouter.setMerchantRegistryEnforced, (true));
        vm.startPrank(admin);
        tc.schedule(address(governed), 0, enforce, bytes32(0), bytes32("e"), 100);
        vm.warp(t + 200);
        tc.execute(address(governed), 0, enforce, bytes32(0), bytes32("e"));
        vm.stopPrank();
        assertTrue(governed.merchantRegistryEnforced());
    }

    // ------------------------------------------------------------------
    // Invariant
    // ------------------------------------------------------------------

    /// @dev Whoever the signer names and whatever the registry holds, an enforced
    ///      router moves money only to a registered destination.
    function testFuzz_enforced_pays_only_registered_destinations(address safe, bool registered) public {
        vm.assume(safe != address(0) && safe.code.length == 0);
        vm.assume(safe != address(router) && safe != customer && safe != treasury);
        vm.prank(admin);
        router.setMerchantRegistryEnforced(true);
        if (registered) {
            vm.prank(registrar);
            router.registerMerchantSafe(safe);
        }

        uint256 before = usdc.balanceOf(safe);
        if (registered) {
            _pay(keccak256("fuzz"), safe);
            assertEq(usdc.balanceOf(safe) - before, 145e6);
        } else {
            _attempt(
                keccak256("fuzz"),
                safe,
                abi.encodeWithSelector(PaymentRouter.MerchantSafeNotRegistered.selector, safe)
            );
            assertEq(usdc.balanceOf(safe), before);
        }
    }
}
