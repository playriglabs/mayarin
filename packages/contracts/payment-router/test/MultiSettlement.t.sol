// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {Harness} from "./helpers/Harness.sol";

/// @dev One router, many settlement assets.
///
///      Each merchant chooses the stablecoin they settle in, so `settlementToken`
///      is a signed field of the order rather than a deployment-wide immutable.
///      That makes two things load-bearing, and this suite pins both:
///
///      - It is **signed**, so a payer cannot redirect settlement to a token of
///        their choosing and still satisfy `minOut`.
///      - It is **whitelisted**, so the quote signer can pick among assets
///        governance admitted but can never introduce one. A compromised signer
///        must not be able to settle a merchant into a worthless token.
contract MultiSettlementTest is Harness {
    MockERC20 internal idrx; // a second settlement asset, 2 decimals

    function setUp() public override {
        super.setUp();
        idrx = new MockERC20("IDRX", "IDRX", 2);
        usdc.mint(address(dex), 1_000_000e6);
        idrx.mint(address(dex), 1_000_000_00);
        vm.startPrank(admin);
        router.addSettlementAsset(address(idrx));
        router.addInputAsset(address(idrx));
        vm.stopPrank();
    }

    function _order(address settlementToken, uint256 minOut, uint256 fee)
        internal
        view
        returns (IPaymentRouter.Order memory)
    {
        return makeOrder(
            keccak256(abi.encode("multi", settlementToken)),
            settlementToken,
            minOut,
            fee,
            merchant,
            customer,
            deadlineIn(3600)
        );
    }

    // ------------------------------------------------------------------
    // Two merchants, two stablecoins, one router
    // ------------------------------------------------------------------

    function test_settles_usdc_and_idrx_from_the_same_router() public {
        // Merchant settling in USDC.
        IPaymentRouter.Order memory usdcOrder = _order(address(usdc), 100e6, 1e6);
        vm.deal(customer, 10 ether);
        bytes memory usdcSig = sign(usdcOrder);
        vm.prank(customer);
        router.payEth{value: 1 ether}(usdcOrder, usdcSig, address(dex), ethSwapData(120e6));

        assertEq(usdc.balanceOf(merchant), 99e6, "merchant settled in USDC");

        // Merchant settling in IDRX, same router, same block.
        IPaymentRouter.Order memory idrxOrder = _order(address(idrx), 100_00, 1_00);
        bytes memory idrxSwap = abi.encodeWithSelector(
            dex.swapFromETH.selector, address(idrx), uint256(120_00), address(router)
        );
        bytes memory idrxSig = sign(idrxOrder);
        vm.prank(customer);
        router.payEth{value: 1 ether}(idrxOrder, idrxSig, address(dex), idrxSwap);

        assertEq(idrx.balanceOf(merchant), 99_00, "merchant settled in IDRX");
        assertEq(usdc.balanceOf(address(router)), 0, "no USDC rests");
        assertEq(idrx.balanceOf(address(router)), 0, "no IDRX rests");
    }

    /// @dev Decimals differ per settlement asset (6 vs 2) and the contract never
    ///      converts — `minOut` and `fee` are already in the asset's minor units.
    function test_each_settlement_asset_keeps_its_own_minor_units() public {
        IPaymentRouter.Order memory o = _order(address(idrx), 35_000_00, 350_00);
        bytes memory swap = abi.encodeWithSelector(
            dex.swapFromETH.selector, address(idrx), uint256(35_000_00), address(router)
        );
        bytes memory sig = sign(o);
        vm.deal(customer, 10 ether);
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), swap);

        assertEq(idrx.balanceOf(merchant), 34_650_00, "35_000.00 IDRX less a 350.00 fee");
        assertEq(idrx.balanceOf(treasury), 350_00, "treasury");
    }

    // ------------------------------------------------------------------
    // The whitelist bounds the signer
    // ------------------------------------------------------------------

    function test_reverts_when_the_settlement_asset_is_not_whitelisted() public {
        MockERC20 rogue = new MockERC20("Rogue", "RGE", 18);
        IPaymentRouter.Order memory o = _order(address(rogue), 100e18, 1e18);
        // Signed up front: `sign` calls `domainSeparatorV4()`, and letting that
        // land inside the argument list would consume the prank and the
        // expectRevert before the payment call ever happens.
        bytes memory sig = sign(o);

        vm.deal(customer, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                PaymentRouter.SettlementAssetNotWhitelisted.selector, address(rogue)
            )
        );
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(120e6));
    }

    /// @dev A validly signed order for a de-listed asset stops working the moment
    ///      governance removes it — the whitelist is checked at execution, not at
    ///      signing.
    function test_removing_a_settlement_asset_rejects_orders_already_signed() public {
        IPaymentRouter.Order memory o = _order(address(idrx), 100_00, 1_00);
        bytes memory sig = sign(o);

        vm.prank(admin);
        router.removeSettlementAsset(address(idrx));

        vm.deal(customer, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                PaymentRouter.SettlementAssetNotWhitelisted.selector, address(idrx)
            )
        );
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(120_00));
    }

    /// @dev Changing `settlementToken` after signing invalidates the signature —
    ///      it is part of the EIP-712 struct, not a caller-supplied argument.
    function test_settlement_token_is_covered_by_the_signature() public {
        IPaymentRouter.Order memory o = _order(address(usdc), 100e6, 1e6);
        bytes memory sig = sign(o);

        o.settlementToken = address(idrx); // payer tampers after signing

        vm.deal(customer, 1 ether);
        vm.expectRevert(PaymentRouter.InvalidSigner.selector);
        vm.prank(customer);
        router.payEth{value: 1 ether}(o, sig, address(dex), ethSwapData(120_00));
    }

    // ------------------------------------------------------------------
    // Same-asset no-op is per order, not per deployment
    // ------------------------------------------------------------------

    function test_sameAsset_noop_resolves_against_the_order_not_a_global_token() public {
        // Paying IDRX into an IDRX order is the no-op path even though the
        // harness's default settlement asset is USDC.
        uint256 inputAmount = 150_00;
        fund(address(idrx), customer, inputAmount);
        IPermit2.PermitSingle memory p = buildPermit(address(idrx), inputAmount, 1);
        IPaymentRouter.Order memory o = _order(address(idrx), 100_00, 1_00);
        bytes memory sig = sign(o);

        vm.prank(customer);
        router.payERC20(o, encodePermit(p), sig, address(0), "");

        assertEq(idrx.balanceOf(merchant), 99_00, "merchant settled");
        assertEq(idrx.balanceOf(customer), 50_00, "excess refunded in IDRX");
    }

    // ------------------------------------------------------------------
    // Bootstrap
    // ------------------------------------------------------------------

    function test_constructor_requires_at_least_one_settlement_asset() public {
        address[] memory none = new address[](0);
        vm.expectRevert(PaymentRouter.NoSettlementAsset.selector);
        new PaymentRouter({
            timelock: admin,
            guardian: admin,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementAssets: none,
            permit2_: address(permit2)
        });
    }

    function test_constructor_rejects_a_zero_settlement_asset() public {
        address[] memory withZero = new address[](2);
        withZero[0] = address(usdc);
        withZero[1] = address(0);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        new PaymentRouter({
            timelock: admin,
            guardian: admin,
            feeRecipient_: treasury,
            signer_: signerAddr,
            settlementAssets: withZero,
            permit2_: address(permit2)
        });
    }
}
