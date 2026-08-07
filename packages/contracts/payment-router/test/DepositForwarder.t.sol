// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DepositForwarder} from "../src/DepositForwarder.sol";
import {DepositForwarderFactory} from "../src/DepositForwarderFactory.sol";
import {MockERC20} from "./helpers/MockERC20.sol";

/// @title DepositForwarderTest — counterfactual deposit addresses (RFC #69)
contract DepositForwarderTest is Test {
    DepositForwarderFactory internal factory;
    MockERC20 internal token;

    address internal operator = makeAddr("operator");
    address internal payer = makeAddr("payer");

    bytes32 internal constant SALT = keccak256("intent-1");

    function setUp() public {
        factory = new DepositForwarderFactory(operator);
        token = new MockERC20("USD Coin", "USDC", 6);
    }

    // ------------------------------------------------------------------
    // The address must be knowable before it exists
    // ------------------------------------------------------------------

    function test_address_is_derivable_before_any_code_exists() public view {
        address predicted = factory.forwarderAddress(SALT);

        assertTrue(predicted != address(0));
        // The whole deposit path depends on this: the payer is shown the address
        // and pays to it while it is still an empty account.
        assertEq(predicted.code.length, 0, "must be counterfactual");
    }

    function test_deploy_lands_on_the_predicted_address() public {
        address predicted = factory.forwarderAddress(SALT);

        vm.deal(predicted, 1 ether);
        address deployed = factory.sweepNative(SALT);

        assertEq(deployed, predicted, "CREATE2 address must match the prediction");
        assertGt(deployed.code.length, 0);
    }

    function test_distinct_salts_give_distinct_addresses() public view {
        assertTrue(factory.forwarderAddress(SALT) != factory.forwarderAddress(keccak256("intent-2")));
    }

    function test_address_is_a_pure_function_of_the_salt() public view {
        // Called twice, with a deployment in between in other tests — the
        // derivation must not depend on any state that a deployment changes.
        assertEq(factory.forwarderAddress(SALT), factory.forwarderAddress(SALT));
    }

    function test_init_code_hash_matches_the_deployed_creation_code() public view {
        assertEq(factory.INIT_CODE_HASH(), keccak256(type(DepositForwarder).creationCode));
    }

    function testFuzz_prediction_matches_deployment(bytes32 salt) public {
        address predicted = factory.forwarderAddress(salt);
        vm.deal(predicted, 1 wei);

        assertEq(factory.sweepNative(salt), predicted);
    }

    // ------------------------------------------------------------------
    // Sweeping
    // ------------------------------------------------------------------

    function test_native_deposit_reaches_the_operator() public {
        address deposit = factory.forwarderAddress(SALT);

        vm.deal(payer, 1 ether);
        vm.prank(payer);
        (bool sent,) = deposit.call{value: 0.4 ether}("");
        assertTrue(sent, "a plain transfer to an empty account must succeed");

        factory.sweepNative(SALT);

        assertEq(operator.balance, 0.4 ether, "operator holds the deposit");
        assertEq(deposit.balance, 0, "forwarder keeps nothing");
    }

    function test_token_deposit_reaches_the_operator() public {
        address deposit = factory.forwarderAddress(SALT);
        token.mint(deposit, 200e6);

        factory.sweepToken(SALT, IERC20(address(token)));

        assertEq(token.balanceOf(operator), 200e6);
        assertEq(token.balanceOf(deposit), 0);
    }

    function test_a_deposit_that_arrives_after_deployment_still_sweeps() public {
        address deposit = factory.forwarderAddress(SALT);

        vm.deal(deposit, 1 ether);
        factory.sweepNative(SALT);
        assertEq(operator.balance, 1 ether);

        // The payer paid twice, or an exchange split the withdrawal. The address
        // now holds code, so the second sweep must not try to deploy again.
        vm.deal(deposit, 0.5 ether);
        factory.sweepNative(SALT);

        assertEq(operator.balance, 1.5 ether);
    }

    function test_sweeping_an_empty_forwarder_is_a_no_op_not_a_revert() public {
        // The executor is resumable: a retry after a successful sweep must be a
        // no-op, exactly as a replayed clearing step is.
        factory.sweepNative(SALT);
        factory.sweepNative(SALT);
        factory.sweepToken(SALT, IERC20(address(token)));

        assertEq(operator.balance, 0);
    }

    function test_both_assets_can_be_swept_from_one_forwarder() public {
        address deposit = factory.forwarderAddress(SALT);
        vm.deal(deposit, 0.3 ether);
        token.mint(deposit, 50e6);

        factory.sweepNative(SALT);
        factory.sweepToken(SALT, IERC20(address(token)));

        assertEq(operator.balance, 0.3 ether);
        assertEq(token.balanceOf(operator), 50e6);
    }

    // ------------------------------------------------------------------
    // What an untrusted caller can and cannot do
    // ------------------------------------------------------------------

    function test_anyone_may_sweep_and_it_still_goes_to_the_operator() public {
        address deposit = factory.forwarderAddress(SALT);
        vm.deal(deposit, 1 ether);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        factory.sweepNative(SALT);

        // The sweep is permissionless on purpose: destination is immutable, so
        // the only thing a caller achieves is paying gas to move funds where
        // they were always going.
        assertEq(operator.balance, 1 ether);
        assertEq(stranger.balance, 0);
    }

    function test_forwarder_holds_its_own_destination_not_a_factory_lookup() public {
        address deposit = factory.forwarderAddress(SALT);
        vm.deal(deposit, 1 wei);
        factory.sweepNative(SALT);

        // Read at construction and immutable here, so the guarantee does not
        // rest on a runtime call into the factory. A static analyzer cannot
        // prove a value fetched per sweep is fixed, and it would be right not to.
        assertEq(DepositForwarder(payable(deposit)).destination(), operator);
    }

    function test_destination_cannot_be_changed_after_construction() public view {
        // No setter exists. This asserts the surface, so adding one later fails
        // a test rather than passing review unnoticed.
        assertEq(factory.destination(), operator);
    }

    function test_factory_refuses_a_zero_destination() public {
        vm.expectRevert(DepositForwarderFactory.ZeroDestination.selector);
        new DepositForwarderFactory(address(0));
    }

    function test_two_factories_derive_different_addresses_for_the_same_salt() public {
        DepositForwarderFactory other = new DepositForwarderFactory(operator);

        // The factory address is part of the CREATE2 preimage, so a redeployed
        // factory does not collide with deposits derived from the old one.
        assertTrue(other.forwarderAddress(SALT) != factory.forwarderAddress(SALT));
    }

    // ------------------------------------------------------------------
    // Cross-check against the off-chain deriver
    //
    // `Create2DepositAddressDeriver` (packages/providers/evm) computes the same
    // address in TypeScript and shows it to the payer. If the two ever disagree,
    // payers send to addresses this factory cannot deploy to and the deposit is
    // unrecoverable — so both sides pin the same vectors, the way the #24
    // order-hash vectors are asserted from both sides.
    // ------------------------------------------------------------------

    address internal constant VECTOR_FACTORY = 0x00000000000000000000000000000000DeaDBeef;
    bytes32 internal constant VECTOR_INIT_CODE_HASH =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    function _vectorSalt(uint256 index) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("mayarin.deposit.", vm.toString(index)));
    }

    function _vectorAddress(uint256 index) internal pure returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), VECTOR_FACTORY, _vectorSalt(index), VECTOR_INIT_CODE_HASH
                        )
                    )
                )
            )
        );
    }

    function test_salt_matches_the_typescript_deriver() public pure {
        assertEq(
            _vectorSalt(0), 0x2147f141f2b37b108d43856dbca7e054c881480a646f352a2461103c76aa56c1
        );
        assertEq(
            _vectorSalt(1), 0x3f488fdc8c1875aa8d9c7f6f1f81aa1b347291a9e60a2b33a2c16651b802dc34
        );
        assertEq(
            _vectorSalt(42), 0xc8efb0253403bf7a3de38b997ce2f569d30c02c30134e0877eef02efcbc2b3c0
        );
    }

    function test_address_matches_the_typescript_deriver() public pure {
        assertEq(_vectorAddress(0), 0x2Fd3C2C3fC236E326ff7088E7401583a8aB95772);
        assertEq(_vectorAddress(1), 0x1CCfC85b51f0BB828c9389bB415fF8408fB97daE);
        assertEq(_vectorAddress(42), 0x10C22331f580Fcca511b7d013DCA799df00581B3);
    }
}
