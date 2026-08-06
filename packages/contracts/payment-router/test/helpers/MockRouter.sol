// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Stand-in for a whitelisted DEX router. The Execution Engine (#5) builds
///      `data` that encodes one of the swap functions below; the router pulls the
///      input from the PaymentRouter (which approved it) and delivers the settlement
///      token to the PaymentRouter. Output is test-controlled so we can drive the
///      `minOut` boundary, the shortfall-revert, and the reentrancy attempt.
///
///      Reentrancy: `setReenter` arms a callback into `target` with `payload` after
///      the swap completes. A nonReentrant PaymentRouter rejects the callback; the
///      bubble-up reverts the whole payment — funds never move twice.
contract MockRouter {
    address public reenterTarget;
    bytes public reenterPayload;
    bool public reenterArmed;

    function setReenter(address target, bytes calldata payload) external {
        reenterTarget = target;
        reenterPayload = payload;
        reenterArmed = true;
    }

    /// @dev ERC-20 → settlement token swap. Pulls `inputAmount` from the caller.
    function swap(address inputToken, uint256 inputAmount, address outputToken, uint256 outputAmount, address recipient)
        external
    {
        IERC20(inputToken).transferFrom(msg.sender, address(this), inputAmount);
        IERC20(outputToken).transfer(recipient, outputAmount);
        _maybeReenter();
    }

    /// @dev Native → settlement token swap. Consumes msg.value, delivers output.
    function swapFromETH(address outputToken, uint256 outputAmount, address recipient) external payable {
        // msg.value is the "input"; the router keeps it. No refund to the caller,
        // so the PaymentRouter's native zero-resting-balance check holds.
        IERC20(outputToken).transfer(recipient, outputAmount);
        _maybeReenter();
    }

    /// @dev Exact-output native swap: keeps what it needed and hands the unspent
    ///      remainder back to `msg.sender` mid-call, the way Uniswap's `refundETH`
    ///      does. Exercises the PaymentRouter's `receive()` + native-residue path.
    function swapFromETHWithRefund(
        address outputToken,
        uint256 outputAmount,
        address recipient,
        uint256 refundAmount
    ) external payable {
        IERC20(outputToken).transfer(recipient, outputAmount);
        (bool ok,) = msg.sender.call{value: refundAmount}("");
        require(ok, "mock: refund rejected");
        _maybeReenter();
    }

    /// @dev Partial fill: pulls only `consumeAmount` of what the caller approved
    ///      and holds, leaving the remainder stranded in the caller. Aggregators
    ///      do this when a route fills against less liquidity than quoted.
    function partialSwap(
        address inputToken,
        uint256 consumeAmount,
        address outputToken,
        uint256 outputAmount,
        address recipient
    ) external {
        IERC20(inputToken).transferFrom(msg.sender, address(this), consumeAmount);
        IERC20(outputToken).transfer(recipient, outputAmount);
        _maybeReenter();
    }

    /// @dev Always reverts — exercises the revert-reason bubble-up path. The
    ///      non-payable variant is for the ERC-20 path (value == 0); the payable
    ///      variant is for the native path (the compiler's nonpayable guard would
    ///      otherwise revert with empty data before the body runs).
    function revertingSwap() external pure {
        revert("mock: bad swap");
    }

    function revertingSwapPayable() external payable {
        revert("mock: bad swap");
    }

    function _maybeReenter() internal {
        if (reenterArmed) {
            reenterArmed = false; // one-shot
            (bool ok, bytes memory ret) = reenterTarget.call(reenterPayload);
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}