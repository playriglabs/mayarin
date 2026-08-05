// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

contract PaymentRouterScaffoldTest is Test {
    function test_deploys_with_version() public {
        PaymentRouter router = new PaymentRouter();
        assertEq(router.VERSION(), "0.0.0");
    }
}
