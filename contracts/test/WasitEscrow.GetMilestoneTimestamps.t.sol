// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import "./WasitEscrow.Base.t.sol";

/// @notice Tests for the widened getMilestone() getter (fix #1).
///
/// Verifies that attestedAt, disputedAt, and buyerApproved are correctly
/// returned from the contract's storage and reflect live state transitions.
contract WasitEscrowGetMilestoneTimestampsTest is WasitEscrowTestBase {

    bytes32 internal constant EVIDENCE = keccak256("evidence");

    // ── Helpers ────────────────────────────────────────────────────────────

    /// @dev Creates, funds, and returns a deal in the Funded state.
    function _fundedDeal() internal returns (uint256 dealId) {
        dealId = _defaultCreateDeal();
        _fundSetup();
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ── 1. Zero values before any action ───────────────────────────────────

    function test_getMilestone_zeroBeforeAttestation() external {
        uint256 dealId = _fundedDeal();
        (uint128 amount, , uint64 attestedAt, uint64 disputedAt, bool buyerApproved)
            = escrow.getMilestone(dealId, 0);

        assertEq(amount, M0,    "amount mismatch");
        assertEq(attestedAt, 0, "attestedAt should be 0 before attestation");
        assertEq(disputedAt, 0, "disputedAt should be 0 before attestation");
        assertFalse(buyerApproved, "buyerApproved should be false before approval");
    }

    // ── 2. attestedAt is set to block.timestamp by attest() ────────────────

    function test_getMilestone_attestedAtSetOnAttest() external {
        uint256 dealId = _fundedDeal();
        uint64 ts = uint64(block.timestamp);

        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        (, , uint64 attestedAt, uint64 disputedAt, bool buyerApproved)
            = escrow.getMilestone(dealId, 0);

        assertEq(attestedAt, ts, "attestedAt must equal block.timestamp at attestation");
        assertEq(disputedAt, 0,  "disputedAt should still be 0 after attest");
        assertFalse(buyerApproved, "buyerApproved unchanged after attest");
    }

    // ── 3. attestedAt advances when block.timestamp advances ───────────────

    function test_getMilestone_attestedAtAdvancesWithTime() external {
        uint256 dealId = _fundedDeal();
        vm.warp(block.timestamp + 1 hours);
        uint64 ts = uint64(block.timestamp);

        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        (, , uint64 attestedAt, , ) = escrow.getMilestone(dealId, 0);
        assertEq(attestedAt, ts, "attestedAt must track the actual block timestamp");
    }

    // ── 4. disputedAt is set by dispute() ──────────────────────────────────

    function test_getMilestone_disputedAtSetOnDispute() external {
        uint256 dealId = _fundedDeal();
        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        vm.warp(block.timestamp + 1 hours);
        uint64 ts = uint64(block.timestamp);

        vm.prank(buyer);
        escrow.dispute(dealId, 0, "quality issue");

        (, , uint64 attestedAt, uint64 disputedAt, )
            = escrow.getMilestone(dealId, 0);

        assertGt(attestedAt, 0, "attestedAt should be non-zero after dispute");
        assertEq(disputedAt, ts, "disputedAt must equal block.timestamp at dispute");
    }

    // ── 5. buyerApproved flips on approve() ────────────────────────────────

    function test_getMilestone_buyerApprovedOnApprove() external {
        uint256 dealId = _fundedDeal();
        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        (, , , , bool beforeApprove) = escrow.getMilestone(dealId, 0);
        assertFalse(beforeApprove, "buyerApproved false before approve");

        vm.prank(buyer);
        escrow.approve(dealId, 0);

        (, , , , bool afterApprove) = escrow.getMilestone(dealId, 0);
        assertTrue(afterApprove, "buyerApproved must be true after approve");
    }

    // ── 6. Values survive a successful release ─────────────────────────────

    function test_getMilestone_timestampsSurviveRelease() external {
        uint256 dealId = _fundedDeal();

        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        // Read attestedAt right after attest (before any warp) as the ground truth.
        (, , uint64 attestedAtBeforeRelease, , ) = escrow.getMilestone(dealId, 0);
        assertGt(attestedAtBeforeRelease, 0, "attestedAt must be non-zero after attest");

        // Wait out the challenge window (2 days from Base fixture)
        vm.warp(block.timestamp + 2 days + 1);

        vm.prank(buyer);  // anyone can release once window passes
        escrow.release(dealId, 0);

        (, WasitEscrow.MilestoneState state, uint64 attestedAtAfterRelease, uint64 disputedAt, )
            = escrow.getMilestone(dealId, 0);

        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Released), "state must be Released");
        assertEq(attestedAtAfterRelease, attestedAtBeforeRelease, "attestedAt must survive release");
        assertEq(disputedAt, 0, "disputedAt remains 0 if never disputed");
    }

    // ── 7. Values survive arbiter resolve ──────────────────────────────────

    function test_getMilestone_timestampsSurviveResolve() external {
        uint256 dealId = _fundedDeal();
        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        vm.prank(buyer);
        escrow.dispute(dealId, 0, "bad goods");
        uint64 dispTs = uint64(block.timestamp);

        vm.prank(arbiter);
        escrow.resolve(dealId, 0, 5000);  // arbiter awards 50% to seller

        (, WasitEscrow.MilestoneState state, uint64 attestedAt, uint64 disputedAt, )
            = escrow.getMilestone(dealId, 0);

        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Resolved), "state must be Resolved");
        assertGt(attestedAt, 0, "attestedAt preserved after resolve");
        assertEq(disputedAt, dispTs, "disputedAt preserved after resolve");
    }

    // ── 8. getMilestone reverts for a non-existent deal ────────────────────

    function test_getMilestone_revertsForNonExistentDeal() external {
        vm.expectRevert();
        escrow.getMilestone(9999, 0);
    }

    // ── 9. buyerApproved is still true after the milestone is released ──────

    function test_getMilestone_buyerApprovedSurvivesRelease() external {
        uint256 dealId = _fundedDeal();
        vm.prank(inspector);
        escrow.attest(dealId, 0, EVIDENCE);

        vm.prank(buyer);
        escrow.approve(dealId, 0);

        // approve() puts milestone in Approved state — release it
        vm.prank(buyer);
        escrow.release(dealId, 0);

        (, , , , bool buyerApproved) = escrow.getMilestone(dealId, 0);
        assertTrue(buyerApproved, "buyerApproved must survive release");
    }
}
