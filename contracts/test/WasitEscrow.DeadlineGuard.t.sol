// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import "./WasitEscrow.Base.t.sol";

/// @notice Tests for the attest() deadline guard (Medium finding fix).
///
/// The guard rejects attestation at or after deal.deadline, protecting
/// the buyer's refundExpired right against an inspector-payee who has a
/// financial incentive to attest late.
///
/// approve() intentionally has NO deadline guard — the buyer may voluntarily
/// pay a late seller. All tests here confirm that asymmetry is preserved.
contract WasitEscrowDeadlineGuardTest is WasitEscrowTestBase {

    // ── Helpers ────────────────────────────────────────────────────────────

    uint64 internal constant WINDOW  = 1 hours;
    uint64 internal constant HORIZON = 2 hours; // deadline = block.timestamp + HORIZON

    bytes32 internal constant EVIDENCE = keccak256("evidence");

    /// @dev Creates a deal with a 1-hour challenge window and a 2-hour deadline.
    ///      Returns (dealId, createdAt, deadline).
    function _tightDeal()
        internal
        returns (uint256 dealId, uint64 createdAt, uint64 deadline_)
    {
        createdAt  = uint64(block.timestamp);
        deadline_  = createdAt + HORIZON;
        vm.prank(buyer);
        dealId = escrow.createDeal(
            _defaultPayees(),
            inspector,
            arbiter,
            _defaultMilestones(),
            WINDOW,
            deadline_
        );
    }

    /// @dev Creates a tight deal, mints/approves USDC, and funds it.
    ///      Returns (dealId, createdAt, deadline).
    function _tightFundedDeal()
        internal
        returns (uint256 dealId, uint64 createdAt, uint64 deadline_)
    {
        (dealId, createdAt, deadline_) = _tightDeal();
        usdc.mint(buyer, TOTAL);
        vm.prank(buyer);
        usdc.approve(address(escrow), TOTAL);
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ── 1. Attest just before deadline succeeds ────────────────────────────

    function test_attest_justBeforeDeadline_succeeds() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        // Warp to one second before the deadline.
        vm.warp(uint256(deadline_) - 1);

        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE); // must not revert

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Attested));
    }

    // ── 2. Attest AT the deadline reverts ─────────────────────────────────

    function test_attest_atExactDeadline_reverts() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        vm.warp(uint256(deadline_)); // block.timestamp == deadline

        vm.prank(inspector);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.AttestAfterDeadline.selector,
                dealId,
                deadline_,
                uint256(deadline_)
            )
        );
        escrow.attest(dealId, 0, EVIDENCE);
    }

    // ── 3. Attest AFTER the deadline reverts ──────────────────────────────

    function test_attest_afterDeadline_reverts() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        vm.warp(uint256(deadline_) + 1 days); // well past deadline

        vm.prank(inspector);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.AttestAfterDeadline.selector,
                dealId,
                deadline_,
                uint256(deadline_) + 1 days
            )
        );
        escrow.attest(dealId, 0, EVIDENCE);
    }

    // ── 4. refundExpired still works after deadline on Pending milestone ──

    function test_refundExpired_afterDeadline_pendingMilestone() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        // Pass the deadline without attesting.
        vm.warp(uint256(deadline_) + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        // Anyone can call refundExpired — use a random address.
        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        escrow.refundExpired(dealId, 0);

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Refunded), "state != Refunded");
        assertEq(usdc.balanceOf(buyer), buyerBefore + M0, "buyer did not receive refund");
    }

    // ── 5. Buyer can still approve() a Pending milestone after the deadline ─

    function test_approve_afterDeadline_pendingMilestone_succeeds() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        // Pass the deadline without the inspector attesting.
        vm.warp(uint256(deadline_) + 1);

        // Buyer voluntarily approves — must succeed (no deadline guard on approve).
        vm.prank(buyer);
        escrow.approve(dealId, 0);

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Approved), "state != Approved");
    }

    // ── 6. Approved post-deadline milestone releases with correct split ───

    function test_approve_afterDeadline_thenRelease_correctSplit() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        vm.warp(uint256(deadline_) + 1);

        vm.prank(buyer);
        escrow.approve(dealId, 0);

        uint256 sellerBefore    = usdc.balanceOf(seller);
        uint256 forwarderBefore = usdc.balanceOf(forwarder);
        uint256 feeBefore       = usdc.balanceOf(feeRecipient);

        // release is callable by anyone once Approved
        vm.prank(makeAddr("caller"));
        escrow.release(dealId, 0);

        // Expected split for M0 = 100e6, feeBps=100, seller=8900, forwarder=1000
        // fee      = 100e6 * 100 / 10_000 = 1_000_000
        // forwarder= 100e6 * 1000 / 10_000 = 10_000_000
        // seller   = 100e6 - 1_000_000 - 10_000_000 = 89_000_000
        uint128 expectedFee      = 1_000_000;
        uint128 expectedForwarder= 10_000_000;
        uint128 expectedSeller   = 89_000_000;

        assertEq(usdc.balanceOf(feeRecipient) - feeBefore,       expectedFee,       "fee wrong");
        assertEq(usdc.balanceOf(forwarder)    - forwarderBefore,  expectedForwarder, "forwarder wrong");
        assertEq(usdc.balanceOf(seller)       - sellerBefore,     expectedSeller,    "seller wrong");

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Released), "state != Released");
    }

    // ── 7. Attest just before deadline; challenge window ends after deadline;
    //       release still works normally ──────────────────────────────────────
    //
    //       Timeline: deadline=2h, attest at t=1h59m, window=1h → unlocks at t=2h59m.
    //       The deadline passes AFTER attestation — release must still work.

    function test_attestBeforeDeadline_windowExpiresAfterDeadline_releaseSucceeds() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        // Attest at one minute before the deadline.
        uint256 attestTime = uint256(deadline_) - 1 minutes;
        vm.warp(attestTime);

        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        // Warp past the challenge window (attestTime + WINDOW = deadline - 1min + 1h).
        uint256 unlocksAt = attestTime + uint256(WINDOW);
        vm.warp(unlocksAt);

        // release must succeed even though we're past the deadline
        vm.prank(makeAddr("caller"));
        escrow.release(dealId, 0); // must not revert

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Released), "state != Released");
    }

    // ── 8. refundExpired rejects a milestone that was attested in time ────

    function test_refundExpired_rejectsAttestedMilestone() public {
        (uint256 dealId,, uint64 deadline_) = _tightFundedDeal();

        // Attest milestone 0 before the deadline.
        vm.warp(uint256(deadline_) - 1 hours);
        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        // Pass the deadline.
        vm.warp(uint256(deadline_) + 1);

        // refundExpired must revert because milestone 0 is Attested, not Pending.
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotPendingForRefund.selector,
                dealId,
                0,
                WasitEscrow.MilestoneState.Attested
            )
        );
        escrow.refundExpired(dealId, 0);
    }
}
