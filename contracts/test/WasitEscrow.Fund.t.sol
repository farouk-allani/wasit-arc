// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WasitEscrowTestBase} from "./WasitEscrow.Base.t.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev fund() happy-path and revert tests.
contract WasitEscrowFundTest is WasitEscrowTestBase {

    // ─────────────────────────────────────────────────────────────────────
    // Happy path
    // ─────────────────────────────────────────────────────────────────────

    function test_Fund_StateChangesToFunded() public {
        uint256 dealId = _defaultCreateDeal();
        _fundSetup();

        vm.prank(buyer);
        escrow.fund(dealId);

        (, , , WasitEscrow.DealState state, , ,) = escrow.getDeal(dealId);
        assertEq(uint8(state), uint8(WasitEscrow.DealState.Funded));
    }

    function test_Fund_TransfersUsdcToEscrow() public {
        uint256 dealId = _defaultCreateDeal();
        _fundSetup();

        uint256 buyerBefore  = usdc.balanceOf(buyer);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(buyer);
        escrow.fund(dealId);

        assertEq(usdc.balanceOf(address(escrow)), escrowBefore + TOTAL, "escrow balance");
        assertEq(usdc.balanceOf(buyer),           buyerBefore  - TOTAL, "buyer balance");
    }

    function test_Fund_EmitsDealFundedEvent() public {
        uint256 dealId = _defaultCreateDeal();
        _fundSetup();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.DealFunded(dealId, buyer, TOTAL);

        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: deal not found
    // ─────────────────────────────────────────────────────────────────────

    function test_Fund_RevertOnNonExistentDeal() public {
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.DealNotFound.selector, uint256(999))
        );
        vm.prank(buyer);
        escrow.fund(999);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: unauthorized caller
    // ─────────────────────────────────────────────────────────────────────

    function test_Fund_RevertOnNonBuyerCaller() public {
        uint256 dealId = _defaultCreateDeal();

        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.UnauthorizedCaller.selector, seller, buyer)
        );
        vm.prank(seller);
        escrow.fund(dealId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: insufficient allowance
    // ─────────────────────────────────────────────────────────────────────

    function test_Fund_RevertOnInsufficientAllowance() public {
        uint256 dealId = _defaultCreateDeal();
        // Mint tokens to buyer but give ZERO approval → SafeERC20 / transferFrom reverts
        usdc.mint(buyer, TOTAL);
        // No approve call — allowance remains 0

        // SafeERC20 wraps the revert; expect any revert (the mock raises ERC20InsufficientAllowance)
        vm.expectRevert(
            abi.encodeWithSelector(
                MockERC20.ERC20InsufficientAllowance.selector,
                address(escrow),
                uint256(0),
                uint256(TOTAL)
            )
        );
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: fund twice (InvalidDealState)
    // ─────────────────────────────────────────────────────────────────────

    function test_Fund_RevertOnDoubleFund() public {
        uint256 dealId = _defaultCreateDeal();
        _fundSetup();

        vm.prank(buyer);
        escrow.fund(dealId);

        // Second fund: deal is now Funded, not Created
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.InvalidDealState.selector,
                dealId,
                WasitEscrow.DealState.Funded,
                WasitEscrow.DealState.Created
            )
        );
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // getDeal — DealNotFound guard
    // ─────────────────────────────────────────────────────────────────────

    function test_GetDeal_RevertOnNonExistentDeal() public {
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.DealNotFound.selector, uint256(0))
        );
        escrow.getDeal(0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fuzz: fund amount matches total stored in deal
    // ─────────────────────────────────────────────────────────────────────

    function testFuzz_Fund_EscrowBalanceMatchesDealTotal(uint128 m0, uint128 m1) public {
        // Keep each piece in [1, 1e30] so their sum never overflows uint128.
        m0 = uint128(bound(m0, 1, 1e30));
        m1 = uint128(bound(m1, 1, 1e30));

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = m0;
        amounts[1] = m1;

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );

        uint128 expectedTotal = uint128(m0) + uint128(m1);
        usdc.mint(buyer, expectedTotal);
        vm.prank(buyer);
        usdc.approve(address(escrow), expectedTotal);

        vm.prank(buyer);
        escrow.fund(dealId);

        assertEq(usdc.balanceOf(address(escrow)), expectedTotal);
        (, , , , , , uint128 storedTotal) = escrow.getDeal(dealId);
        assertEq(storedTotal, expectedTotal);
    }
}
