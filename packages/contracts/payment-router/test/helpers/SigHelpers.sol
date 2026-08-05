// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";
import {OrderHash} from "../../src/libraries/OrderHash.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";

/// @dev Off-chain EIP-712 signing for tests. Mirrors exactly what the Quote
///      Engine (#6) must produce: the digest is `keccak256("\x19\x01" ‖
///      domainSeparator ‖ structHash)`, signed into a 65-byte `r ‖ s ‖ v` blob.
abstract contract SigHelpers is Test {
    /// @dev The EIP-712 digest the contract verifies, for test-vector export.
    function orderDigest(address router, IPaymentRouter.Order memory order) public view returns (bytes32) {
        bytes32 domainSeparator = PaymentRouter(router).domainSeparatorV4();
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, OrderHash.structHash(order)));
    }

    /// @dev Signs `order` with `pk` and returns the 65-byte `r ‖ s ‖ v` blob the
    ///      contract expects in `signature`.
    function signOrder(address router, IPaymentRouter.Order memory order, uint256 pk)
        public
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, orderDigest(router, order));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Builds an `Order` with sensible defaults; tests override fields.
    function makeOrder(
        bytes32 intentId,
        uint256 minOut,
        uint256 fee,
        address merchantSafe,
        address refundTo,
        uint256 deadline
    ) public pure returns (IPaymentRouter.Order memory) {
        return IPaymentRouter.Order({
            intentId: intentId,
            minOut: minOut,
            fee: fee,
            merchantSafe: merchantSafe,
            refundTo: refundTo,
            deadline: deadline
        });
    }
}