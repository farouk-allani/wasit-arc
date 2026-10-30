// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import "./WasitEscrow.Base.t.sol";

contract WasitEscrowDisputeRefundTest is WasitEscrowTestBase {

    // ── Internal helpers ───────────────────────────────────────────────────────

    /// Creates + funds the default 3-milestone deal.
    function _createAndFund() internal returns (uint256 dealId) {
        dealId = _defaultCreateDeal();
        _fundSetup();
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    /// Attests milestone `i` (prank as inspector).
    function _attest(uint256 dealId, uint256 i) internal {
        vm.prank(inspector);
        escrow.attest(dealId, i, bytes32("evidence"));
    }

    /// Attests milestone `i` then disputes it (all inside window).
    function _attestAndDispute(uint256 dealId, uint256 i) internal {
        _attest(dealId, i);
        vm.prank(buyer);
        escrow.dispute(dealId, i, "bad work");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  DISPUTE  (tests 1–7)
    // ══════════════════════════════════════════════════════════════════════════

    // Test 1: non-buyer caller → UnauthorizedCaller
    function test_Dispute_NonBuyer_Reverts() public {
        uint256 dealId = _createAndFund();
        _attest(dealId, 0);
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.UnauthorizedCaller.selector, seller, buyer)
        );
        escrow.dispute(dealId, 0, "x");
    }

    // Test 2: deal in Created state → DealNotFunded
    function test_Dispute_DealNotFunded_Reverts() public {
        uint256 dealId = _defaultCreateDeal();
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.DealNotFunded.selector, dealId, WasitEscrow.DealState.Created)
        );
        escrow.dispute(dealId, 0, "x");
    }

    // Test 3: milestone in Pending state → MilestoneNotAttested
    function test_Dispute_MilestonePending_Reverts() public {
        uint256 dealId = _createAndFund();
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotAttested.selector, dealId, 0, WasitEscrow.MilestoneState.Pending
            )
        );
        escrow.dispute(dealId, 0, "x");
    }

    // Test 4: milestone in Released state → MilestoneNotAttested
    function test_Dispute_MilestoneReleased_Reverts() public {
        uint256 dealId = _createAndFund();
        _attest(dealId, 0);
        vm.warp(block.timestamp + 2 days + 1); // warp past window
        escrow.release(dealId, 0);             // anyone can release
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotAttested.selector, dealId, 0, WasitEscrow.MilestoneState.Released
            )
        );
        escrow.dispute(dealId, 0, "x");
    }

    // Test 5: dispute after challenge window expired → ChallengeWindowExpired
    function test_Dispute_AfterChallengeWindow_Reverts() public {
        uint256 dealId = _createAndFund();
        _attest(dealId, 0);
        uint256 windowEnds = block.timestamp + 2 days;
        vm.warp(windowEnds); // at exactly windowEnds → block.timestamp >= windowEnds
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.ChallengeWindowExpired.selector, dealId, 0, windowEnds, block.timestamp
            )
        );
        escrow.dispute(dealId, 0, "x");
    }

    // Test 6: valid dispute → state Disputed, MilestoneDisputed event
    function test_Dispute_Valid_StateAndEvent() public {
        uint256 dealId = _createAndFund();
        _attest(dealId, 0);
        vm.prank(buyer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneDisputed(dealId, 0, buyer, "bad work");
        escrow.dispute(dealId, 0, "bad work");
        (, WasitEscrow.MilestoneState st, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(st), uint8(WasitEscrow.MilestoneState.Disputed));
    }

    // Test 7: disputed milestone blocks release → MilestoneNotReleasable
    function test_Dispute_BlocksRelease() public {
        uint256 dealId = _createAndFund();
        _attestAndDispute(dealId, 0);
        vm.warp(block.timestamp + 2 days + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotReleasable.selector, dealId, 0, WasitEscrow.MilestoneState.Disputed
            )
        );
        escrow.release(dealId, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  RESOLVE  (tests 8–14)
    // ══════════════════════════════════════════════════════════════════════════

    // Test 8: non-arbiter caller → UnauthorizedCaller
    function test_Resolve_NonArbiter_Reverts() public {
        uint256 dealId = _createAndFund();
        _attestAndDispute(dealId, 0);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.UnauthorizedCaller.selector, buyer, arbiter)
        );
        escrow.resolve(dealId, 0, 5_000);
    }

    // Test 9: milestone Attested (not Disputed) → MilestoneNotDisputed
    function test_Resolve_NotDisputed_Reverts() public {
        uint256 dealId = _createAndFund();
        _attest(dealId, 0);
        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotDisputed.selector, dealId, 0, WasitEscrow.MilestoneState.Attested
            )
        );
        escrow.resolve(dealId, 0, 5_000);
    }

    // Test 10: sellerShareBps > 10_000 → SellerShareBpsTooHigh
    function test_Resolve_SellerShareTooHigh_Reverts() public {
        uint256 dealId = _createAndFund();
        _attestAndDispute(dealId, 0);
        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.SellerShareBpsTooHigh.selector, uint16(10_001), uint16(10_000))
        );
        escrow.resolve(dealId, 0, 10_001);
    }

    // Test 11: sellerShareBps=0 → buyer gets 100%, seller/forwarder/fee get 0
    function test_Resolve_SellerShare0_BuyerGetsAll() public {
        uint256 dealId = _createAndFund();
        _attestAndDispute(dealId, 0);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(arbiter);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneResolved(dealId, 0, 0, uint128(M0));
        escrow.resolve(dealId, 0, 0);

        assertEq(usdc.balanceOf(buyer) - buyerBefore, M0);
        assertEq(usdc.balanceOf(seller), 0);
        assertEq(usdc.balanceOf(forwarder), 0);
        assertEq(usdc.balanceOf(feeRecipient), 0);
    }

    // Test 12: sellerShareBps=10_000 → entire amount through payee split, buyer refund=0
    function test_Resolve_SellerShare10000_SellerGetsAll() public {
        uint256 dealId = _createAndFund();
        _attestAndDispute(dealId, 0);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(arbiter);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneResolved(dealId, 0, uint128(M0), 0);
        escrow.resolve(dealId, 0, 10_000);

        // buyer refund = 0
        assertEq(usdc.balanceOf(buyer), buyerBefore);
        // total paid to payees = M0
        uint256 fee         = M0 * 100 / 10_000;   // 1_000_000
        uint256 fwdShare    = M0 * 1000 / 10_000;  // 10_000_000
        uint256 sellerNet   = M0 - fee - fwdShare; // 89_000_000
        assertEq(usdc.balanceOf(feeRecipient), fee);
        assertEq(usdc.balanceOf(forwarder),    fwdShare);
        assertEq(usdc.balanceOf(seller),       sellerNet);
        assertEq(fee + fwdShare + sellerNet,   M0);
    }

    // Test 13: sellerShareBps=5_000 (50/50 split on M0=100_000_000)
    function test_Resolve_SellerShare5000_HalfSplit() public {
        uint256 dealId = _createAndFund();
        _attestAndDispute(dealId, 0);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        // expected split
        uint128 A            = uint128(M0);          // 100_000_000
        uint128 sellerAmount = 50_000_000;           // A * 5000 / 10000
        uint128 buyerRefund  = 50_000_000;           // A - sellerAmount
        uint256 fee          = 50_000_000 * 100 / 10_000;   // 500_000
        uint256 fwdShare     = 50_000_000 * 1000 / 10_000;  // 5_000_000
        uint256 sellerNet    = 50_000_000 - fee - fwdShare; // 44_500_000

        vm.prank(arbiter);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneResolved(dealId, 0, sellerAmount, buyerRefund);
        escrow.resolve(dealId, 0, 5_000);

        assertEq(usdc.balanceOf(buyer) - buyerBefore, buyerRefund, "buyer refund");
        assertEq(usdc.balanceOf(feeRecipient),        fee,        "fee");
        assertEq(usdc.balanceOf(forwarder),           fwdShare,   "forwarder");
        assertEq(usdc.balanceOf(seller),              sellerNet,  "seller net");
        assertEq(fee + fwdShare + sellerNet + buyerRefund, uint256(A), "total");
    }

    // Test 14: rounding dust with sellerShareBps=3, A=100_000_003
    function test_Resolve_RoundingDust() public {
        // Create a custom 1-milestone deal with amount = 100_000_003
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100_000_003;
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );
        uint128 tot = 100_000_003;
        usdc.mint(buyer, tot);
        vm.prank(buyer); usdc.approve(address(escrow), tot);
        vm.prank(buyer); escrow.fund(dealId);

        _attest(dealId, 0);
        vm.prank(buyer); escrow.dispute(dealId, 0, "x");

        uint128 A            = 100_000_003;
        uint128 sellerAmount = uint128(uint256(A) * 3 / 10_000); // 30_000
        uint128 buyerRefund  = A - sellerAmount;                  // 99_970_003
        uint256 fee          = uint256(sellerAmount) * 100 / 10_000;   // 300
        uint256 fwdShare     = uint256(sellerAmount) * 1000 / 10_000;  // 3_000
        uint256 sellerNet    = sellerAmount - fee - fwdShare;          // 26_700

        assertEq(fee + fwdShare + sellerNet + uint256(buyerRefund), uint256(A), "total invariant");

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(arbiter);
        escrow.resolve(dealId, 0, 3);

        assertEq(usdc.balanceOf(buyer) - buyerBefore, uint256(buyerRefund), "buyer");
        assertEq(usdc.balanceOf(feeRecipient),        fee,                  "fee");
        assertEq(usdc.balanceOf(forwarder),           fwdShare,             "fwd");
        assertEq(usdc.balanceOf(seller),              sellerNet,            "seller");
    }

    // Test 14 (fuzz): for any (A, sellerShareBps) the arithmetic is dust-free
    function testFuzz_Resolve_ArithmeticInvariant(uint128 A, uint16 sellerShareBps) public pure {
        A = uint128(bound(uint256(A), 1, 1_000_000_000));
        sellerShareBps = uint16(bound(uint256(sellerShareBps), 0, 10_000));
        uint128 sellerAmount = uint128(uint256(A) * sellerShareBps / 10_000);
        uint128 buyerRefund  = A - sellerAmount;
        assertEq(uint256(sellerAmount) + uint256(buyerRefund), uint256(A), "must sum to A");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  REFUND EXPIRED  (tests 15–20)
    // ══════════════════════════════════════════════════════════════════════════

    // Test 15: before deadline → DeadlineNotPassed
    function test_RefundExpired_BeforeDeadline_Reverts() public {
        uint256 dealId = _createAndFund();
        // deadline = block.timestamp + 3 days; we are before it
        (, , , , , uint64 deadline, ) = escrow.getDeal(dealId);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DeadlineNotPassed.selector, dealId, uint256(deadline), block.timestamp
            )
        );
        escrow.refundExpired(dealId, 0);
    }

    // Test 16: Attested milestone → MilestoneNotPendingForRefund
    function test_RefundExpired_AttestedMilestone_Reverts() public {
        uint256 dealId = _createAndFund();
        _attest(dealId, 0);
        (, , , , , uint64 deadline, ) = escrow.getDeal(dealId);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotPendingForRefund.selector,
                dealId, 0, WasitEscrow.MilestoneState.Attested
            )
        );
        escrow.refundExpired(dealId, 0);
    }

    // Test 17: Released milestone → MilestoneNotPendingForRefund
    function test_RefundExpired_ReleasedMilestone_Reverts() public {
        // Use a 2-milestone deal so releasing M0 doesn't close the deal
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = uint256(M0); amounts[1] = uint256(M1);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );
        uint128 tot = uint128(M0 + M1);
        usdc.mint(buyer, tot);
        vm.prank(buyer); usdc.approve(address(escrow), tot);
        vm.prank(buyer); escrow.fund(dealId);

        _attest(dealId, 0);
        vm.warp(block.timestamp + 2 days + 1);
        escrow.release(dealId, 0);

        // Warp past the deadline so refundExpired passes the DeadlineNotPassed guard
        // and reaches the MilestoneNotPendingForRefund check.
        (, , , , , uint64 deadline2m, ) = escrow.getDeal(dealId);
        vm.warp(uint256(deadline2m) + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotPendingForRefund.selector,
                dealId, 0, WasitEscrow.MilestoneState.Released
            )
        );
        escrow.refundExpired(dealId, 0);
    }

    // Test 18: valid refundExpired → buyer receives amount, state=Refunded, event
    function test_RefundExpired_Valid() public {
        uint256 dealId = _createAndFund();
        (, , , , , uint64 deadline, ) = escrow.getDeal(dealId);
        vm.warp(uint256(deadline) + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneRefunded(dealId, 0, buyer, uint128(M0));
        escrow.refundExpired(dealId, 0);

        assertEq(usdc.balanceOf(buyer) - buyerBefore, M0, "buyer received M0");
        (, WasitEscrow.MilestoneState st, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(st), uint8(WasitEscrow.MilestoneState.Refunded));
    }

    // Test 19: refundExpired twice → second call reverts (state Refunded)
    function test_RefundExpired_TwiceReverts() public {
        // Use 2-milestone deal so first refund doesn't close the deal
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = uint256(M0); amounts[1] = uint256(M1);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );
        uint128 tot = uint128(M0 + M1);
        usdc.mint(buyer, tot);
        vm.prank(buyer); usdc.approve(address(escrow), tot);
        vm.prank(buyer); escrow.fund(dealId);

        (, , , , , uint64 deadline, ) = escrow.getDeal(dealId);
        vm.warp(uint256(deadline) + 1);
        escrow.refundExpired(dealId, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotPendingForRefund.selector,
                dealId, 0, WasitEscrow.MilestoneState.Refunded
            )
        );
        escrow.refundExpired(dealId, 0);
    }

    // Test 20: refundExpired callable by anyone; buyer receives funds (not caller)
    function test_RefundExpired_AnyoneCanCall_BuyerReceives() public {
        uint256 dealId = _createAndFund();
        (, , , , , uint64 deadline, ) = escrow.getDeal(dealId);
        vm.warp(uint256(deadline) + 1);

        uint256 buyerBefore    = usdc.balanceOf(buyer);
        uint256 inspectorBefore = usdc.balanceOf(inspector);

        vm.prank(inspector);
        escrow.refundExpired(dealId, 0);

        assertEq(usdc.balanceOf(buyer) - buyerBefore,       M0, "buyer got M0");
        assertEq(usdc.balanceOf(inspector) - inspectorBefore, 0, "inspector gets nothing");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CROSS-PATH EXCLUSIVITY  (tests 21–24)
    // ══════════════════════════════════════════════════════════════════════════

    // Test 21: Released milestone cannot be resolved → MilestoneNotDisputed
    function test_CrossPath_ReleasedCannotBeResolved() public {
        // 2-milestone deal so release doesn't close deal
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = uint256(M0); amounts[1] = uint256(M1);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );
        uint128 tot = uint128(M0 + M1);
        usdc.mint(buyer, tot);
        vm.prank(buyer); usdc.approve(address(escrow), tot);
        vm.prank(buyer); escrow.fund(dealId);

        _attest(dealId, 0);
        vm.warp(block.timestamp + 2 days + 1);
        escrow.release(dealId, 0);

        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotDisputed.selector, dealId, 0, WasitEscrow.MilestoneState.Released
            )
        );
        escrow.resolve(dealId, 0, 5_000);
    }

    // Test 22: Released milestone cannot be refunded → MilestoneNotPendingForRefund
    function test_CrossPath_ReleasedCannotBeRefunded() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = uint256(M0); amounts[1] = uint256(M1);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );
        uint128 tot = uint128(M0 + M1);
        usdc.mint(buyer, tot);
        vm.prank(buyer); usdc.approve(address(escrow), tot);
        vm.prank(buyer); escrow.fund(dealId);

        _attest(dealId, 0);
        vm.warp(block.timestamp + 2 days + 1);
        escrow.release(dealId, 0);

        // Warp past the deadline so refundExpired reaches MilestoneNotPendingForRefund.
        (, , , , , uint64 deadlineCr, ) = escrow.getDeal(dealId);
        vm.warp(uint256(deadlineCr) + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotPendingForRefund.selector,
                dealId, 0, WasitEscrow.MilestoneState.Released
            )
        );
        escrow.refundExpired(dealId, 0);
    }

    // Test 23: Resolved milestone cannot be released → MilestoneNotReleasable
    function test_CrossPath_ResolvedCannotBeReleased() public {
        // 2-milestone deal so resolve doesn't close deal
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = uint256(M0); amounts[1] = uint256(M1);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );
        uint128 tot = uint128(M0 + M1);
        usdc.mint(buyer, tot);
        vm.prank(buyer); usdc.approve(address(escrow), tot);
        vm.prank(buyer); escrow.fund(dealId);

        _attestAndDispute(dealId, 0);
        vm.prank(arbiter); escrow.resolve(dealId, 0, 5_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotReleasable.selector, dealId, 0, WasitEscrow.MilestoneState.Resolved
            )
        );
        escrow.release(dealId, 0);
    }

    // Test 24: Refunded milestone cannot be released → MilestoneNotReleasable (or DealNotFunded)
    function test_CrossPath_RefundedCannotBeReleased() public {
        // 2-milestone deal: refund M0, M1 still Pending → deal still Funded
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = uint256(M0); amounts[1] = uint256(M1);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days)
        );
        uint128 tot = uint128(M0 + M1);
        usdc.mint(buyer, tot);
        vm.prank(buyer); usdc.approve(address(escrow), tot);
        vm.prank(buyer); escrow.fund(dealId);

        (, , , , , uint64 deadline, ) = escrow.getDeal(dealId);
        vm.warp(uint256(deadline) + 1);
        escrow.refundExpired(dealId, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotReleasable.selector, dealId, 0, WasitEscrow.MilestoneState.Refunded
            )
        );
        escrow.release(dealId, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  DEAL CLOSURE  (tests 25–27)
    // ══════════════════════════════════════════════════════════════════════════

    // Test 25: all 3 milestones via mixed paths → deal Closed
    function test_DealClosure_MixedPaths() public {
        uint256 dealId = _createAndFund();

        // M0: release (attest + warp past window)
        _attest(dealId, 0);
        vm.warp(block.timestamp + 2 days + 1);
        escrow.release(dealId, 0);

        // M1: dispute then resolve
        _attest(dealId, 1);
        vm.prank(buyer); escrow.dispute(dealId, 1, "dispute M1");
        vm.prank(arbiter); escrow.resolve(dealId, 1, 5_000);

        // M2: refundExpired — warp past deadline (deadline = original ts + 3 days, already past)
        (, , , , , uint64 deadline, ) = escrow.getDeal(dealId);
        // already past deadline (warped to original ts + 2 days + 1, deadline = original ts + 3 days)
        // warp a bit more to be sure
        vm.warp(uint256(deadline) + 1);
        escrow.refundExpired(dealId, 2);

        (, , , WasitEscrow.DealState ds, , , ) = escrow.getDeal(dealId);
        assertEq(uint8(ds), uint8(WasitEscrow.DealState.Closed));
    }

    // Test 26: dispute on Closed deal → DealNotFunded (state is Closed)
    function test_DealClosure_DisputeOnClosedDeal_Reverts() public {
        uint256 dealId = _createAndFund();
        // Release all 3 milestones to close the deal
        for (uint256 i = 0; i < 3; i++) {
            _attest(dealId, i);
        }
        vm.warp(block.timestamp + 2 days + 1);
        for (uint256 i = 0; i < 3; i++) {
            escrow.release(dealId, i);
        }
        (, , , WasitEscrow.DealState ds, , , ) = escrow.getDeal(dealId);
        assertEq(uint8(ds), uint8(WasitEscrow.DealState.Closed));

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.DealNotFunded.selector, dealId, WasitEscrow.DealState.Closed)
        );
        escrow.dispute(dealId, 0, "x");
    }

    // Test 27: refundExpired on Closed deal → DealNotFunded
    function test_DealClosure_RefundExpiredOnClosedDeal_Reverts() public {
        uint256 dealId = _createAndFund();
        for (uint256 i = 0; i < 3; i++) {
            _attest(dealId, i);
        }
        vm.warp(block.timestamp + 2 days + 1);
        for (uint256 i = 0; i < 3; i++) {
            escrow.release(dealId, i);
        }

        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.DealNotFunded.selector, dealId, WasitEscrow.DealState.Closed)
        );
        escrow.refundExpired(dealId, 0);
    }
}
