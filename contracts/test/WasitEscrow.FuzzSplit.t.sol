// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {WasitEscrowTestBase} from "./WasitEscrow.Base.t.sol";

/// @dev Fuzz tests for milestone payout split arithmetic.
///      Every test creates a fresh WasitEscrow so bps configuration can vary freely.
contract WasitEscrowFuzzSplitTest is WasitEscrowTestBase {

    // ── helpers ─────────────────────────────────────────────────────────────

    /// @dev Deploy a fresh escrow with feeBps=100, etch the USDC mock (setUp already
    ///      etched it at USDC_ADDR so we can reuse the same address safely).
    function _freshEscrow() internal returns (WasitEscrow e) {
        e = new WasitEscrow(feeRecipient, 100);
    }

    // ── Test 1: two payees, fuzz amount + seller bps ─────────────────────────

    /// @notice Release split over a 2-payee deal must sum exactly to the milestone amount.
    /// @dev seller bps ∈ [1, 9899], forwarder gets 9900 - sellerBps, fee gets 100.
    function testFuzz_ReleaseSplit_TwoPayees(uint128 amount, uint16 sellerBps) public {
        amount   = uint128(bound(uint256(amount),   1,    1_000_000_000_000)); // up to 1M USDC (6 dec)
        sellerBps = uint16(bound(uint256(sellerBps), 1,    9899));
        uint16 forwarderBps = 9900 - sellerBps; // sellerBps + forwarderBps + 100 feeBps == 10_000

        WasitEscrow freshEscrow = _freshEscrow();

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: sellerBps});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: forwarderBps});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        vm.prank(buyer);
        uint256 dealId = freshEscrow.createDeal(
            payees, inspector, arbiter, amounts,
            0, uint64(block.timestamp + 1)
        );

        usdc.mint(buyer, amount);
        vm.prank(buyer);
        usdc.approve(address(freshEscrow), amount);
        vm.prank(buyer);
        freshEscrow.fund(dealId);

        // buyer approves → immediate release (no window wait)
        vm.prank(buyer);
        freshEscrow.approve(dealId, 0);

        uint256 escrowBefore = usdc.balanceOf(address(freshEscrow));

        freshEscrow.release(dealId, 0);

        uint256 escrowAfter = usdc.balanceOf(address(freshEscrow));

        // After release the escrow must have disbursed exactly `amount`.
        // Any portion that failed to transfer stays as _owed; net out of escrow = amount.
        uint256 owedSeller     = freshEscrow.owed(seller);
        uint256 owedForwarder  = freshEscrow.owed(forwarder);
        uint256 owedFee        = freshEscrow.owed(feeRecipient);

        // Escrow balance dropped by (amount - total_owed), the rest sits as owed.
        assertEq(
            escrowBefore - escrowAfter + owedSeller + owedForwarder + owedFee,
            amount,
            "Two-payee split must sum to milestone amount"
        );
    }

    // ── Test 2: six payees, fuzz amount + non-seller bps allocations ─────────

    /// @notice Release split over up to 6 payees must sum exactly to milestone amount.
    function testFuzz_ReleaseSplit_SixPayees(
        uint128 amount,
        uint16[5] memory nonSellerBps
    ) public {
        amount = uint128(bound(uint256(amount), 1, 1_000_000_000_000));

        // Build 6 payee addresses — make them unique per test run.
        address[6] memory payeeAddrs = [
            makeAddr("p0"), makeAddr("p1"), makeAddr("p2"),
            makeAddr("p3"), makeAddr("p4"), makeAddr("p5")
        ];

        // Distribute up to 9900 bps across payees[1..5], seller gets remainder.
        // Each slot i gets a fair share of what's left, guaranteeing total <= 9900.
        uint16 remaining = 9900;
        uint16[6] memory bpsArr;
        uint16 othersTotal = 0;
        for (uint256 j = 1; j <= 5; ++j) {
            // max share for slot j: divide remaining equally among slots still to fill
            uint16 maxShare = remaining / uint16(7 - j); // slots left: 6-j+1 = 7-j
            uint16 share    = uint16(bound(uint256(nonSellerBps[j - 1]), 0, maxShare));
            bpsArr[j]   = share;
            othersTotal += share;
            remaining   -= share;
        }
        uint16 sellerBps = 9900 - othersTotal;
        // Contract requires seller bps > 0; skip if rounding pushed it to 0.
        vm.assume(sellerBps > 0);
        bpsArr[0] = sellerBps;

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](6);
        for (uint256 j = 0; j < 6; ++j) {
            payees[j] = WasitEscrow.Payee({addr: payeeAddrs[j], bps: bpsArr[j]});
        }

        // inspector / arbiter must be distinct from payees[0] (seller)
        // Using pre-defined addresses from base: inspector & arbiter are not in payeeAddrs.

        WasitEscrow freshEscrow = _freshEscrow();
        uint256[] memory milestoneAmounts = new uint256[](1);
        milestoneAmounts[0] = amount;

        vm.prank(buyer);
        uint256 dealId = freshEscrow.createDeal(
            payees, inspector, arbiter, milestoneAmounts,
            0, uint64(block.timestamp + 1)
        );

        usdc.mint(buyer, amount);
        vm.prank(buyer);
        usdc.approve(address(freshEscrow), amount);
        vm.prank(buyer);
        freshEscrow.fund(dealId);

        vm.prank(buyer);
        freshEscrow.approve(dealId, 0);

        uint256 escrowBefore = usdc.balanceOf(address(freshEscrow));

        freshEscrow.release(dealId, 0);

        uint256 escrowAfter = usdc.balanceOf(address(freshEscrow));

        // Sum all owed balances for the 6 payees + feeRecipient
        uint256 totalOwed = freshEscrow.owed(feeRecipient);
        for (uint256 j = 0; j < 6; ++j) {
            totalOwed += freshEscrow.owed(payeeAddrs[j]);
        }

        assertEq(
            escrowBefore - escrowAfter + totalOwed,
            amount,
            "Six-payee split must sum to milestone amount"
        );
    }

    // ── Test 3: resolve split (dispute → resolve) ─────────────────────────────

    /// @notice After resolve, buyer refund + seller payout must sum to milestone amount.
    function testFuzz_ResolveSplit(
        uint128 amount,
        uint16 sellerShareBps,
        uint16 sellerBps
    ) public {
        amount         = uint128(bound(uint256(amount),         1, 1_000_000_000_000));
        sellerShareBps = uint16(bound(uint256(sellerShareBps),  0, 10_000));
        sellerBps      = uint16(bound(uint256(sellerBps),        1, 9899));
        uint16 forwarderBps = 9900 - sellerBps;

        WasitEscrow freshEscrow = _freshEscrow();

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: sellerBps});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: forwarderBps});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        // challengeWindow must be > 0 so we can dispute before it expires
        vm.prank(buyer);
        uint256 dealId = freshEscrow.createDeal(
            payees, inspector, arbiter, amounts,
            1 days,                          // challengeWindow
            uint64(block.timestamp + 2 days) // deadline > now + window
        );

        usdc.mint(buyer, amount);
        vm.prank(buyer);
        usdc.approve(address(freshEscrow), amount);
        vm.prank(buyer);
        freshEscrow.fund(dealId);

        // attest (milestone 0: Pending → Attested)
        vm.prank(inspector);
        freshEscrow.attest(dealId, 0, keccak256("evidence"));

        // dispute must be inside challenge window (we're still at attestation block)
        vm.prank(buyer);
        freshEscrow.dispute(dealId, 0, "dispute");

        uint256 escrowBefore = usdc.balanceOf(address(freshEscrow));

        // resolve
        vm.prank(arbiter);
        freshEscrow.resolve(dealId, 0, sellerShareBps);

        uint256 escrowAfter = usdc.balanceOf(address(freshEscrow));

        // Sum all parties' owed balances
        uint256 totalOwed =
            freshEscrow.owed(seller)       +
            freshEscrow.owed(forwarder)    +
            freshEscrow.owed(feeRecipient) +
            freshEscrow.owed(buyer);

        assertEq(
            escrowBefore - escrowAfter + totalOwed,
            amount,
            "Resolve split must sum to milestone amount"
        );
    }

    // ── Test 4: refund expired sums to milestone amount ───────────────────────

    /// @notice RefundExpired must credit exactly the milestone amount back to buyer.
    function testFuzz_RefundExpired_SumsToAmount(uint128 amount) public {
        amount = uint128(bound(uint256(amount), 1, 1_000_000_000_000));

        WasitEscrow freshEscrow = _freshEscrow();

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](1);
        payees[0] = WasitEscrow.Payee({addr: seller, bps: 9900});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        vm.prank(buyer);
        uint256 dealId = freshEscrow.createDeal(
            payees, inspector, arbiter, amounts,
            0,
            uint64(block.timestamp + 1 days)
        );

        usdc.mint(buyer, amount);
        vm.prank(buyer);
        usdc.approve(address(freshEscrow), amount);
        vm.prank(buyer);
        freshEscrow.fund(dealId);

        // warp past deadline
        vm.warp(block.timestamp + 1 days + 1);

        uint256 escrowBefore = usdc.balanceOf(address(freshEscrow));

        freshEscrow.refundExpired(dealId, 0);

        uint256 escrowAfter = usdc.balanceOf(address(freshEscrow));
        uint256 owedBuyer   = freshEscrow.owed(buyer);

        assertEq(
            escrowBefore - escrowAfter + owedBuyer,
            amount,
            "RefundExpired must credit exactly milestone amount to buyer"
        );
    }

    // ── Test 5: multi-milestone deal total payout ─────────────────────────────

    /// @notice Sum of all released milestone payouts must equal deal.total.
    function testFuzz_MultiMilestone_TotalPayout(
        uint128 m0,
        uint128 m1,
        uint128 m2
    ) public {
        m0 = uint128(bound(uint256(m0), 1, 333_000_000_000));
        m1 = uint128(bound(uint256(m1), 1, 333_000_000_000));
        m2 = uint128(bound(uint256(m2), 1, 333_000_000_000));

        // guard against overflow (uint128 total)
        vm.assume(uint256(m0) + m1 + m2 <= type(uint128).max);

        WasitEscrow freshEscrow = _freshEscrow();

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](1);
        payees[0] = WasitEscrow.Payee({addr: seller, bps: 9900});

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = m0;
        amounts[1] = m1;
        amounts[2] = m2;
        uint128 total = m0 + m1 + m2;

        vm.prank(buyer);
        uint256 dealId = freshEscrow.createDeal(
            payees, inspector, arbiter, amounts,
            0, uint64(block.timestamp + 1)
        );

        usdc.mint(buyer, total);
        vm.prank(buyer);
        usdc.approve(address(freshEscrow), total);
        vm.prank(buyer);
        freshEscrow.fund(dealId);

        // approve and release all 3 milestones
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(buyer);
            freshEscrow.approve(dealId, i);
            freshEscrow.release(dealId, i);
        }

        // All funds are out (or in owed); escrow should hold 0 real balance
        // plus all owed balances.
        uint256 escrowBalance = usdc.balanceOf(address(freshEscrow));
        uint256 owedTotal =
            freshEscrow.owed(seller)       +
            freshEscrow.owed(feeRecipient);

        assertEq(
            escrowBalance,
            owedTotal,
            "Escrow balance must equal sum of unclaimed owed after full release"
        );
    }
}
