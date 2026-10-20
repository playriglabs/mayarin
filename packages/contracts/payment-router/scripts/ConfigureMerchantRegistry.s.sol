// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

/// @title ConfigureMerchantRegistry — name a registrar, then turn enforcement on (SEC-06)
/// @notice The destination registry has two steps, deliberately apart, because
///         turning enforcement on before the merchants are registered makes every
///         payment revert:
///
///           1. `REGISTRAR=0x…`  grants `REGISTRAR_ROLE` (a timelock operation,
///              since `DEFAULT_ADMIN_ROLE` lives on the timelock). The registrar is
///              a key that is **not** the quote signer. Then register every
///              merchant Safe (`scripts/register-merchant-safe.ts`).
///           2. `ENFORCE=true`   sets `merchantRegistryEnforced` (a second timelock
///              operation), once the merchants are registered.
///
///         Escrow orders settle to a per-payment vault address, which is not a
///         registered Safe: do not enforce on a chain that serves escrow until the
///         registry learns to recognise a registered factory's vaults.
///
/// @dev One operation per run, with its own salt so the two do not collide. With a
///      zero delay (testnet) it schedules and executes in one run; with a real
///      delay it schedules and says to come back.
///
///      forge script scripts/ConfigureMerchantRegistry.s.sol:ConfigureMerchantRegistry \
///        --rpc-url $RPC --broadcast --sender $MULTISIG
///
///      Env: TIMELOCK, PAYMENT_ROUTER, and one of REGISTRAR / ENFORCE=true.
contract ConfigureMerchantRegistry is Script {
    bytes32 internal constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 internal constant SALT_GRANT = keccak256("mayarin.merchant-registry.grant.v1");
    bytes32 internal constant SALT_ENFORCE = keccak256("mayarin.merchant-registry.enforce.v1");

    function run() external {
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK")));
        address router = vm.envAddress("PAYMENT_ROUTER");
        address registrar = vm.envOr("REGISTRAR", address(0));
        bool enforce = vm.envOr("ENFORCE", false);

        if ((registrar == address(0)) == !enforce) {
            revert("set exactly one of REGISTRAR=0x... or ENFORCE=true");
        }

        bytes memory payload;
        bytes32 salt;
        if (registrar != address(0)) {
            payload = abi.encodeCall(IAccessControl.grantRole, (REGISTRAR_ROLE, registrar));
            salt = SALT_GRANT;
        } else {
            payload = abi.encodeCall(PaymentRouter.setMerchantRegistryEnforced, (true));
            salt = SALT_ENFORCE;
        }

        uint256 delay = timelock.getMinDelay();
        vm.startBroadcast();
        timelock.schedule(router, 0, payload, bytes32(0), salt, delay);
        if (delay == 0) timelock.execute(router, 0, payload, bytes32(0), salt);
        vm.stopBroadcast();

        console2.log("Timelock delay:", delay);
        console2.log(delay == 0 ? "Executed immediately (zero delay)." : "Scheduled; execute after the delay.");
        if (registrar != address(0)) console2.log("Registrar:", registrar);
        else console2.log("Enforcement: on");
    }
}
