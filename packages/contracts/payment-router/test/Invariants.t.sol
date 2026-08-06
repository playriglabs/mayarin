// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {MockPermit2} from "./helpers/MockPermit2.sol";
import {MockRouter} from "./helpers/MockRouter.sol";
import {SigHelpers} from "./helpers/SigHelpers.sol";

/// @dev #28 — invariants, fuzz, reentrancy.
///      - Stateful invariant: the router never custodies value (zero resting
///        balance) across every exercised path — native payEth, ERC-20 Permit2
///        cross-asset swap, and same-asset no-op. Success sends all output out;
///        reverts roll back; either way the balance is zero.
///      - Fuzz: `minOut` boundary (exact == no refund; one-below == revert),
///        replay rejection, and the manipulated-route-still-reverts property.
///      - Reentrancy: a swap that reenters `payEth`/`payERC20` mid-flight is
///        blocked by `nonReentrant`; the whole payment reverts and funds return.
contract InvariantsTest is Test, SigHelpers {
    PaymentRouter public router;
    MockERC20 public usdc;
    MockERC20 public weth;
    MockPermit2 public permit2;
    MockRouter public dex;
    address public admin;
    address public guardian;
    address public treasury;
    address public merchant;
    address public customer;
    uint256 public signerPk;
    address public signerAddr;

    PayHandler public handler;

    function setUp() public {
        admin = makeAddr("admin");
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

        router = new PaymentRouter({
            timelock: admin,
            guardian: guardian,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementToken_: address(usdc),
            permit2_: address(permit2)
        });

        vm.startPrank(admin); // admin holds CONFIG_ROLE in this suite
        router.addRouter(address(dex));
        router.addInputAsset(address(weth));
        router.addInputAsset(address(usdc));
        vm.stopPrank();

        // Ample settlement liquidity so the dex can deliver across many calls.
        usdc.mint(address(dex), 1_000_000_000e6);

        handler = new PayHandler(router, usdc, weth, permit2, dex, merchant, customer, signerAddr, signerPk);
        targetContract(address(handler));
    }

    // ------------------------------------------------------------------
    // Stateful invariant
    // ------------------------------------------------------------------

    /// @dev The contract never custodies value it was not simply given. Holds
    ///      after every handler op because a successful pay sends all measured
    ///      `output` out (split merchant/treasury/refund sums to `output`),
    ///      returns any unconsumed input, and a reverted pay rolls its state back.
    ///
    ///      Donations are the one balance the contract can hold, and the handler
    ///      makes them: a third party can move tokens to any address and can
    ///      force-send ETH with `SELFDESTRUCT`, so "always exactly zero" is not a
    ///      property any contract can have. What it can have — and what this
    ///      asserts — is that donated value is inert: it is never consumed, never
    ///      counted as swap output, and never blocks a payment. Anything above the
    ///      donated total would be custody.
    function invariant_no_custody_beyond_donations() public view {
        assertEq(address(router).balance, handler.donatedNative(), "native custody");
        assertEq(
            usdc.balanceOf(address(router)), handler.donatedSettlement(), "settlement custody"
        );
        assertEq(weth.balanceOf(address(router)), 0, "input custody");
    }

    // ------------------------------------------------------------------
    // Fuzz: minOut boundary, replay, manipulated route
    // ------------------------------------------------------------------

    function test_fuzz_minOut_exact_no_refund(uint256 minOut) public {
        minOut = bound(minOut, 2e6, 10_000e6);
        uint256 fee = 1e6;
        bytes32 id = keccak256(abi.encode("exact", minOut));
        IPaymentRouter.Order memory o = makeOrder(id, minOut, fee, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        vm.deal(customer, 100 ether);
        uint256 customerBefore = customer.balance;
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), _ethData(minOut)); // output == minOut
        assertEq(usdc.balanceOf(merchant), minOut - fee, "merchant");
        assertEq(usdc.balanceOf(treasury), fee, "treasury");
        assertEq(customer.balance, customerBefore - 1 ether, "no USDC refund (refund was 0)");
        assertEq(usdc.balanceOf(customer), 0, "no settlement refund");
        assertTrue(router.consumed(id));
    }

    function test_fuzz_minOut_one_below_reverts(uint256 minOut) public {
        minOut = bound(minOut, 2e6, 10_000e6);
        uint256 output = minOut - 1; // exactly one minor unit short
        bytes32 id = keccak256(abi.encode("miss", minOut));
        IPaymentRouter.Order memory o = makeOrder(id, minOut, 1e6, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        vm.deal(customer, 100 ether);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.MinOutNotMet.selector, output, minOut));
        router.payEth{value: 1 ether}(o, sig, address(dex), _ethData(output));
        assertFalse(router.consumed(id), "revert undoes consume");
        assertEq(address(router).balance, 0, "native resting after revert");
        assertEq(usdc.balanceOf(address(router)), 0, "token resting after revert");
    }

    function test_fuzz_replay_rejected(uint256 seed) public {
        bytes32 id = keccak256(abi.encode("replay", seed));
        uint256 minOut = 100e6;
        IPaymentRouter.Order memory o = makeOrder(id, minOut, 1e6, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        vm.deal(customer, 100 ether);
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), _ethData(120e6));
        assertTrue(router.consumed(id));
        // Reuse the same signed order: rejected regardless of how it's re-routed.
        vm.deal(customer, 100 ether);
        vm.prank(customer);
        vm.expectRevert(PaymentRouter.AlreadyConsumed.selector);
        router.payEth{value: 1 ether}(o, sig, address(dex), _ethData(200e6));
        assertTrue(router.consumed(id), "still consumed once");
    }

    function test_fuzz_manipulated_route_cannot_settle_below_minOut(uint256 minOut, uint256 output) public {
        minOut = bound(minOut, 2e6, 10_000e6);
        output = bound(output, 0, minOut - 1); // a bad/manipulated route delivers below minOut
        bytes32 id = keccak256(abi.encode("manip", minOut, output));
        IPaymentRouter.Order memory o = makeOrder(id, minOut, 1e6, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        vm.deal(customer, 100 ether);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PaymentRouter.MinOutNotMet.selector, output, minOut));
        router.payEth{value: 1 ether}(o, sig, address(dex), _ethData(output));
        // Merchant never received anything; intent not consumed.
        assertEq(usdc.balanceOf(merchant), 0, "merchant untouched");
        assertFalse(router.consumed(id));
    }

    // ------------------------------------------------------------------
    // Reentrancy
    // ------------------------------------------------------------------

    function test_reentrancy_payEth_reverts_funds_safe() public {
        bytes32 id = keccak256("reenter-eth");
        uint256 minOut = 100e6;
        uint256 fee = 1e6;
        uint256 output = 120e6;
        IPaymentRouter.Order memory o = makeOrder(id, minOut, fee, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        bytes memory swapData = _ethData(output);

        // Arm the dex to reenter router.payEth mid-swap with the SAME signed
        // order. nonReentrant blocks the inner call; the bubble-up reverts the
        // whole payment — no double settle, no trapped value.
        bytes memory reenterData =
            abi.encodeWithSelector(router.payEth.selector, o, sig, address(dex), swapData);
        dex.setReenter(address(router), reenterData);

        vm.deal(customer, 100 ether);
        uint256 customerBefore = customer.balance;
        vm.prank(customer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        router.payEth{value: 1 ether}(o, sig, address(dex), swapData);

        assertEq(customer.balance, customerBefore, "native returned to payer");
        assertEq(address(router).balance, 0, "router holds no native");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds no settlement");
        assertEq(usdc.balanceOf(merchant), 0, "merchant never paid");
        assertFalse(router.consumed(id), "consume rolled back");
    }

    function test_reentrancy_payERC20_reverts_funds_safe() public {
        bytes32 id = keccak256("reenter-erc");
        uint256 minOut = 100e6;
        uint256 fee = 1e6;
        uint256 output = 120e6;
        uint256 inputAmount = 1 ether;

        weth.mint(customer, inputAmount);
        vm.prank(customer);
        weth.approve(address(permit2), type(uint256).max);
        IPermit2.PermitSingle memory p = _permit(address(weth), inputAmount, 0);
        IPaymentRouter.Order memory o = makeOrder(id, minOut, fee, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        bytes memory swapData = _ercData(inputAmount, output);

        // Reenter router.payERC20 mid-swap; nonReentrant blocks it.
        bytes memory reenterData =
            abi.encodeWithSelector(router.payERC20.selector, o, abi.encode(p, ""), sig, address(dex), swapData);
        dex.setReenter(address(router), reenterData);

        uint256 customerWethBefore = weth.balanceOf(customer);
        vm.prank(customer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        router.payERC20(o, abi.encode(p, ""), sig, address(dex), swapData);

        assertEq(weth.balanceOf(customer), customerWethBefore, "input returned to payer");
        assertEq(weth.balanceOf(address(router)), 0, "router holds no input");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds no settlement");
        assertEq(usdc.balanceOf(merchant), 0, "merchant never paid");
        assertFalse(router.consumed(id), "consume rolled back");
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _ethData(uint256 output) internal view returns (bytes memory) {
        return abi.encodeWithSelector(dex.swapFromETH.selector, address(usdc), output, address(router));
    }

    function _ercData(uint256 inputAmount, uint256 output) internal view returns (bytes memory) {
        return abi.encodeWithSelector(dex.swap.selector, address(weth), inputAmount, address(usdc), output, address(router));
    }

    function _permit(address token, uint256 amount, uint48 nonce) internal view returns (IPermit2.PermitSingle memory) {
        return IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({token: token, amount: uint160(amount), expiration: type(uint48).max, nonce: nonce}),
            spender: address(router),
            sigDeadline: type(uint48).max
        });
    }
}

/// @dev Fuzz target for the stateful invariant. Each function drives one pay
///      path with bounded, mostly-successful parameters; `try/catch` swallows
///      the expected reverts (replay, minOut-miss when reuse lands on a consumed
///      intent). Because success sends all output out and reverts roll back,
///      the zero-resting-balance invariant holds after every call.
contract PayHandler is Test, SigHelpers {
    PaymentRouter public immutable router;
    MockERC20 public immutable usdc;
    MockERC20 public immutable weth;
    MockPermit2 public immutable permit2;
    MockRouter public immutable dex;
    address public immutable merchant;
    address public immutable customer;
    address public immutable signerAddr;
    uint256 public immutable signerPk;

    uint256 public nonceCounter;
    bytes32 public lastIntent;
    uint48 public permitNonce;

    /// @dev Running total of what the handler has donated to the router, so the
    ///      invariant can tell an inert donation apart from actual custody.
    uint256 public donatedSettlement;
    uint256 public donatedNative;

    constructor(
        PaymentRouter router_,
        MockERC20 usdc_,
        MockERC20 weth_,
        MockPermit2 permit2_,
        MockRouter dex_,
        address merchant_,
        address customer_,
        address signerAddr_,
        uint256 signerPk_
    ) {
        router = router_;
        usdc = usdc_;
        weth = weth_;
        permit2 = permit2_;
        dex = dex_;
        merchant = merchant_;
        customer = customer_;
        signerAddr = signerAddr_;
        signerPk = signerPk_;
    }

    function payEth(uint256 intentSeed, uint256 minOut, uint256 feeBps, uint256 outputDelta, bool reuse) external {
        uint256 minOut_ = bound(minOut, 2e6, 10_000e6);
        uint256 fee = (minOut_ * bound(feeBps, 0, 9_999)) / 10_000; // fee < minOut
        uint256 output = minOut_ + bound(outputDelta, 0, 5_000e6); // output >= minOut (success path)
        bytes32 intentId = (reuse && lastIntent != 0) ? lastIntent : keccak256(abi.encode("eth", intentSeed, nonceCounter));
        lastIntent = intentId;
        nonceCounter++;

        IPaymentRouter.Order memory o =
            makeOrder(intentId, minOut_, fee, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        vm.deal(customer, 100 ether);
        vm.prank(customer);
        try router.payEth{value: 1 ether}(
            o, sig, address(dex),
            abi.encodeWithSelector(dex.swapFromETH.selector, address(usdc), output, address(router))
        ) {} catch {}
    }

    function payERC20Cross(uint256 intentSeed, uint256 minOut, uint256 feeBps, uint256 outputDelta, bool reuse) external {
        uint256 minOut_ = bound(minOut, 2e6, 10_000e6);
        uint256 fee = (minOut_ * bound(feeBps, 0, 9_999)) / 10_000;
        uint256 output = minOut_ + bound(outputDelta, 0, 5_000e6);
        uint256 inputAmount = 1 ether;
        bytes32 intentId = (reuse && lastIntent != 0) ? lastIntent : keccak256(abi.encode("erc", intentSeed, nonceCounter));
        lastIntent = intentId;
        nonceCounter++;

        weth.mint(customer, inputAmount);
        vm.prank(customer);
        weth.approve(address(permit2), type(uint256).max);
        IPermit2.PermitSingle memory p = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token: address(weth), amount: uint160(inputAmount), expiration: type(uint48).max, nonce: permitNonce
            }),
            spender: address(router),
            sigDeadline: type(uint48).max
        });
        permitNonce++;
        IPaymentRouter.Order memory o =
            makeOrder(intentId, minOut_, fee, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        vm.prank(customer);
        try router.payERC20(
            o, abi.encode(p, ""), sig, address(dex),
            abi.encodeWithSelector(dex.swap.selector, address(weth), inputAmount, address(usdc), output, address(router))
        ) {} catch {}
    }

    function payERC20Same(uint256 intentSeed, uint256 minOut, uint256 feeBps, uint256 outputDelta, bool reuse) external {
        uint256 minOut_ = bound(minOut, 2e6, 10_000e6);
        uint256 fee = (minOut_ * bound(feeBps, 0, 9_999)) / 10_000;
        uint256 inputAmount = minOut_ + bound(outputDelta, 0, 5_000e6); // input(==output) >= minOut
        bytes32 intentId = (reuse && lastIntent != 0) ? lastIntent : keccak256(abi.encode("same", intentSeed, nonceCounter));
        lastIntent = intentId;
        nonceCounter++;

        usdc.mint(customer, inputAmount);
        vm.prank(customer);
        usdc.approve(address(permit2), type(uint256).max);
        IPermit2.PermitSingle memory p = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token: address(usdc), amount: uint160(inputAmount), expiration: type(uint48).max, nonce: permitNonce
            }),
            spender: address(router),
            sigDeadline: type(uint48).max
        });
        permitNonce++;
        IPaymentRouter.Order memory o =
            makeOrder(intentId, minOut_, fee, merchant, customer, block.timestamp + 3600);
        bytes memory sig = signOrder(address(router), o, signerPk);
        vm.prank(customer);
        try router.payERC20(o, abi.encode(p, ""), sig, address(0), "") {} catch {}
    }

    /// @dev The griefing move, interleaved with real payments: donate settlement
    ///      tokens and force-send native. Neither goes through `receive()` — a
    ///      token transfer needs no consent and `vm.deal` models `SELFDESTRUCT` —
    ///      so no access check can stop it. Against an absolute-zero resting
    ///      check this would have bricked every later call in the sequence.
    function donate(uint256 tokenDust, uint256 nativeDust) external {
        uint256 tokens = bound(tokenDust, 1, 1_000e6);
        uint256 native = bound(nativeDust, 1, 1 ether);
        usdc.mint(address(router), tokens);
        vm.deal(address(router), address(router).balance + native);
        donatedSettlement += tokens;
        donatedNative += native;
    }
}