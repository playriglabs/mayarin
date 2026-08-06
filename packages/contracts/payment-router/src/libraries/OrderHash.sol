// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title OrderHash — EIP-712 typed-data hashing for `Order`
/// @notice Keeps the primary type string and the struct hash in one place so the
///         Quote Engine (#6) and the test vectors can reproduce them off-chain.
///         The domain separator lives on the contract (OZ `EIP712`); this library
///         only produces the `structHash` that the contract feeds to
///         `_hashTypedDataV4`.
library OrderHash {
    /// @dev Primary type. Field order MUST match `IPaymentRouter.Order` exactly;
    ///      changing either side without the other breaks signature verification.
    string internal constant ORDER_TYPE =
        "Order(bytes32 intentId,address settlementToken,uint256 minOut,uint256 fee,address merchantSafe,address refundTo,uint256 deadline)";

    bytes32 internal constant ORDER_TYPEHASH = keccak256(bytes(ORDER_TYPE));

    /// @dev The EIP-712 `structHash` (pre-domain-separation). `abi.encode` pads
    ///      addresses to 32 bytes, which is what EIP-712 requires. `memory` so it
    ///      is callable from both the contract (calldata order, copied) and tests.
    function structHash(IPaymentRouter.Order memory order) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.intentId,
                order.settlementToken,
                order.minOut,
                order.fee,
                order.merchantSafe,
                order.refundTo,
                order.deadline
            )
        );
    }
}