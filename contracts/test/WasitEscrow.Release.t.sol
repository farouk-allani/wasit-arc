// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import "./WasitEscrow.Base.t.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Blocklist mock: standalone ERC-20 where transfer TO `blocked` returns false.
// Etched at USDC_ADDR for the failed-payout tests.
// Slot layout (for vm.store after etch):
//   slot 0: name (string)
//   slot 1: symbol (string)
//   slot 2: decimals (uint8)
//   slot 3: totalSupply
//   slot 4: balanceOf mapping
//   slot 5: allowance mapping
//   slot 6: blocked (address)
// ─────────────────────────────────────────────────────────────────────────────
contract MockUSDCWithBlocklist {
    string public name     = "Mock USDC BL";
    string public symbol   = "mUSDCbl";
    uint8  public decimals = 6;
    // Constructor required for deployment; blocked is set post-etch via vm.store.

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public blocked; // slot 6

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == blocked) return false;
        if (balanceOf[msg.sender] < amount)
            revert ERC20InsufficientBalance(msg.sender, balanceOf[msg.sender], amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 cur = allowance[from][msg.sender];
        if (cur != type(uint256).max) {
            if (cur < amount) revert ERC20InsufficientAllowance(msg.sender, cur, amount);
            allowance[from][msg.sender] = cur - amount;
        }
        if (to == blocked) return false;
        if (balanceOf[from] < amount)
            revert ERC20InsufficientBalance(from, balanceOf[from], amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main test contract: inherits WasitEscrowTestBase
// ─────────────────────────────────────────────────────────────────────────────
contract WasitEscrowReleaseTest is WasitEscrowTestBase {

    // ── internal helpers ─────────────────────────────────────────────────────

    /// Creates + funds a default (3-milestone) deal. Returns dealId.
    function _createAndFund() internal returns (uint256 dealId) {
        dealId = _defaultCreateDeal();
        _fundSetup();
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    /// Attests milestone i and warps past challenge window.
    function _attestAndWarp(uint256 dealId, uint256 i) internal {
        bytes32 h = keccak256("evidence");
        vm.prank(inspector);
        escrow.attest(dealId, i, h);
        vm.warp(block.timestamp + 2 days + 1);
    }

    /// Creates a 2-milestone deal (amounts a0, a1) and funds it.
    function _create2MilestoneDeal(uint128 a0, uint128 a1)
        internal returns (uint256 dealId)
    {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = a0;
        amounts[1] = a1;
        vm.prank(buyer);
        dealId = escrow.createDeal(
            _defaultPayees(),
            inspector,
            arbiter,
            amounts,
            2 days,
            uint64(block.timestamp + 3 days)
        );
        uint128 tot = a0 + a1;
        usdc.mint(buyer, tot);
        vm.prank(buyer);
        usdc.approve(address(escrow), tot);
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ATTEST tests (1–4)
    // ══════════════════════════════════════════════════════════════════════════

    /// Test 1: non-inspector caller → UnauthorizedCaller
    function test_Attest_NonInspector_Reverts() public {
        uint256 dealId = _createAndFund();
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.UnauthorizedCaller.selector,
                buyer,
                inspector
            )
        );
        escrow.attest(dealId, 0, bytes32(0));
    }

    /// Test 2: deal not Funded (Created state) → DealNotFunded
    function test_Attest_DealNotFunded_Reverts() public {
        uint256 dealId = _defaultCreateDeal(); // Created, not Funded
        vm.prank(inspector);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId,
                WasitEscrow.DealState.Created
            )
        );
        escrow.attest(dealId, 0, bytes32(0));
    }

    /// Test 3: milestone already Attested → MilestoneNotPending
    function test_Attest_AlreadyAttested_Reverts() public {
        uint256 dealId = _createAndFund();
        bytes32 h = keccak256("ev");
        vm.prank(inspector);
        escrow.attest(dealId, 0, h);
        // second attest on same milestone
        vm.prank(inspector);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotPending.selector,
                dealId,
                0,
                WasitEscrow.MilestoneState.Attested
            )
        );
        escrow.attest(dealId, 0, h);
    }

    /// Test 4: valid attest → state Attested, attestedAt set, event emitted
    function test_Attest_Valid_StateAndEvent() public {
        uint256 dealId = _createAndFund();
        bytes32 h = keccak256("evidence-doc");
        uint64 ts = uint64(block.timestamp);

        vm.prank(inspector);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneAttested(dealId, 0, h, ts);
        escrow.attest(dealId, 0, h);

        (uint128 amount, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Attested));
        assertEq(amount, uint128(M0));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  APPROVE tests (5–8)
    // ══════════════════════════════════════════════════════════════════════════

    /// Test 5: non-buyer caller → UnauthorizedCaller
    function test_Approve_NonBuyer_Reverts() public {
        uint256 dealId = _createAndFund();
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.UnauthorizedCaller.selector,
                seller,
                buyer
            )
        );
        escrow.approve(dealId, 0);
    }

    /// Test 6: deal not Funded → DealNotFunded
    function test_Approve_DealNotFunded_Reverts() public {
        uint256 dealId = _defaultCreateDeal();
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId,
                WasitEscrow.DealState.Created
            )
        );
        escrow.approve(dealId, 0);
    }

    /// Test 7: milestone already Released → MilestoneNotPending
    function test_Approve_AlreadyReleased_Reverts() public {
        // Use 2-milestone deal: release M0, try to approve M0 (deal stays Funded)
        uint256 dealId = _create2MilestoneDeal(100_000_000, 200_000_000);
        _attestAndWarp(dealId, 0);
        escrow.release(dealId, 0);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotPending.selector,
                dealId,
                0,
                WasitEscrow.MilestoneState.Released
            )
        );
        escrow.approve(dealId, 0);
    }

    /// Test 8: valid approve from Pending → state Approved, buyerApproved=true, event
    function test_Approve_Valid_StateAndEvent() public {
        uint256 dealId = _createAndFund();

        vm.prank(buyer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneApproved(dealId, 0, buyer);
        escrow.approve(dealId, 0);

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Approved));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  RELEASE via attest + window (9–12)
    // ══════════════════════════════════════════════════════════════════════════

    /// Test 9: Attested but challenge window not yet expired → ChallengeWindowNotExpired
    function test_Release_ChallengeWindowNotExpired_Reverts() public {
        uint256 dealId = _createAndFund();
        bytes32 h = keccak256("ev");
        vm.prank(inspector);
        escrow.attest(dealId, 0, h);

        uint256 attestedAt = block.timestamp;
        uint256 unlocksAt = attestedAt + 2 days;
        // warp to 1 second BEFORE unlock
        vm.warp(unlocksAt - 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.ChallengeWindowNotExpired.selector,
                dealId,
                0,
                unlocksAt,
                block.timestamp
            )
        );
        escrow.release(dealId, 0);
    }

    /// Test 10: Attested, warp past window → succeeds, balances correct
    function test_Release_AfterWindow_Succeeds() public {
        uint256 dealId = _createAndFund();
        _attestAndWarp(dealId, 0);

        uint128 A = uint128(M0);
        uint128 expectedFee      = uint128(uint256(A) * 100 / 10_000);           // 1_000_000
        uint128 expectedForwarder = uint128(uint256(A) * 1000 / 10_000);         // 10_000_000
        uint128 expectedSeller   = A - expectedFee - expectedForwarder;          // 89_000_000

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneReleased(dealId, 0, A);

        escrow.release(dealId, 0);

        assertEq(usdc.balanceOf(seller),       expectedSeller);
        assertEq(usdc.balanceOf(forwarder),    expectedForwarder);
        assertEq(usdc.balanceOf(feeRecipient), expectedFee);

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Released));
    }

    /// Test 11: Pending milestone → MilestoneNotReleasable
    function test_Release_PendingMilestone_Reverts() public {
        uint256 dealId = _createAndFund();
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotReleasable.selector,
                dealId,
                0,
                WasitEscrow.MilestoneState.Pending
            )
        );
        escrow.release(dealId, 0);
    }

    /// Test 12: release twice on same milestone in a 2-milestone deal (deal stays Funded)
    /// Second attempt on already-Released M0 → MilestoneNotReleasable (deal is still Funded)
    function test_Release_Twice_SameMilestone_Reverts() public {
        uint256 dealId = _create2MilestoneDeal(100_000_000, 200_000_000);
        _attestAndWarp(dealId, 0);
        escrow.release(dealId, 0); // first release succeeds; deal stays Funded (M1 not done)

        // second release on same (now Released) milestone
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotReleasable.selector,
                dealId,
                0,
                WasitEscrow.MilestoneState.Released
            )
        );
        escrow.release(dealId, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  RELEASE via buyer approve (13–14)
    // ══════════════════════════════════════════════════════════════════════════

    /// Test 13: buyer approves (Pending) → anyone can release immediately (no warp)
    function test_Release_BuyerApprove_NoWarpNeeded() public {
        uint256 dealId = _createAndFund();
        vm.prank(buyer);
        escrow.approve(dealId, 0);

        uint128 A = uint128(M0);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneReleased(dealId, 0, A);
        escrow.release(dealId, 0);

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Released));
    }

    /// Test 14: buyer approves an already-Attested milestone → release immediately
    function test_Release_BuyerApprove_AfterAttest_NoWarp() public {
        uint256 dealId = _createAndFund();
        bytes32 h = keccak256("ev");
        vm.prank(inspector);
        escrow.attest(dealId, 0, h);

        // buyer approves without waiting
        vm.prank(buyer);
        escrow.approve(dealId, 0);

        uint128 A = uint128(M0);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.MilestoneReleased(dealId, 0, A);
        escrow.release(dealId, 0);

        (, WasitEscrow.MilestoneState state, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(state), uint8(WasitEscrow.MilestoneState.Released));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  EXACT SPLIT ARITHMETIC (15–16)
    // ══════════════════════════════════════════════════════════════════════════

    // Internal helper: create+fund a single-milestone deal with custom amount.
    function _singleMilestoneDeal(uint128 amount) internal returns (uint256 dealId) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        vm.prank(buyer);
        dealId = escrow.createDeal(
            _defaultPayees(),
            inspector,
            arbiter,
            amounts,
            2 days,
            uint64(block.timestamp + 3 days)
        );
        usdc.mint(buyer, amount);
        vm.prank(buyer);
        usdc.approve(address(escrow), amount);
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // Helper: release single milestone via attest+warp, then assert exact split.
    function _checkSplit(uint128 A) internal {
        uint256 dealId = _singleMilestoneDeal(A);
        _attestAndWarp(dealId, 0);

        uint256 selBefore  = usdc.balanceOf(seller);
        uint256 fwdBefore  = usdc.balanceOf(forwarder);
        uint256 feeBefore  = usdc.balanceOf(feeRecipient);

        escrow.release(dealId, 0);

        uint256 selGot  = usdc.balanceOf(seller)       - selBefore;
        uint256 fwdGot  = usdc.balanceOf(forwarder)    - fwdBefore;
        uint256 feeGot  = usdc.balanceOf(feeRecipient) - feeBefore;

        // Invariant: sum == A exactly (no dust lost, no inflation)
        assertEq(selGot + fwdGot + feeGot, A, "split sum != A");
    }

    /// Test 15a: amount=7 micro-USDC (fee=0, forwarder=0, seller=7)
    function test_Split_DustAmount7() public {
        _checkSplit(7);
        // explicit spot-check
        // fee   = 7*100/10000 = 0
        // fwd   = 7*1000/10000 = 0
        // seller = 7 - 0 - 0 = 7
    }

    /// Test 15b: amount=1_000_003
    function test_Split_Amount1_000_003() public {
        // fee=10000, forwarder=100000, seller=890003, sum=1_000_003
        uint128 A = 1_000_003;
        uint256 dealId = _singleMilestoneDeal(A);
        _attestAndWarp(dealId, 0);

        escrow.release(dealId, 0);

        uint128 expectedFee      = uint128(uint256(A) * 100  / 10_000); // 10000
        uint128 expectedForwarder = uint128(uint256(A) * 1000 / 10_000); // 100000
        uint128 expectedSeller   = A - expectedFee - expectedForwarder; // 890003

        assertEq(usdc.balanceOf(feeRecipient), expectedFee);
        assertEq(usdc.balanceOf(forwarder),    expectedForwarder);
        assertEq(usdc.balanceOf(seller),       expectedSeller);
        assertEq(usdc.balanceOf(feeRecipient) + usdc.balanceOf(forwarder) + usdc.balanceOf(seller), A);
    }

    /// Test 15c: amount=9 (odd dust)
    function test_Split_DustAmount9() public {
        _checkSplit(9);
    }

    /// Test 15d: fuzz — split sum always equals A for any amount in [1, 1_000_000_000]
    function testFuzz_Split_SumEqualsAmount(uint128 A) public {
        A = uint128(bound(uint256(A), 1, 1_000_000_000));
        _checkSplit(A);
    }

    /// Test 16: 3-payee deal (seller=8000, forwarder=1000, other=900, fee=100)
    /// amount=11: fee=0, forwarder=1, other=0, seller=10, sum=11
    function test_Split_3Payee_DustAmount11() public {
        address other = makeAddr("other");

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](3);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8000});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});
        payees[2] = WasitEscrow.Payee({addr: other,     bps: 900});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 11;

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            payees, inspector, arbiter, amounts,
            2 days, uint64(block.timestamp + 3 days)
        );
        usdc.mint(buyer, 11);
        vm.prank(buyer);
        usdc.approve(address(escrow), 11);
        vm.prank(buyer);
        escrow.fund(dealId);

        _attestAndWarp(dealId, 0);
        escrow.release(dealId, 0);

        // fee=0, forwarder=1, other=0, seller=10
        assertEq(usdc.balanceOf(feeRecipient), 0,  "fee != 0");
        assertEq(usdc.balanceOf(forwarder),    1,  "forwarder != 1");
        assertEq(usdc.balanceOf(other),        0,  "other != 0");
        assertEq(usdc.balanceOf(seller),       10, "seller != 10");
        assertEq(
            usdc.balanceOf(feeRecipient) + usdc.balanceOf(forwarder) +
            usdc.balanceOf(other) + usdc.balanceOf(seller),
            11,
            "sum != 11"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FAILED PAYOUT / CREDIT / WITHDRAW (17–19)
    // ══════════════════════════════════════════════════════════════════════════

    // Helper: set up blocklist mock at USDC_ADDR and return the deal.
    // The seller is blocklisted; feeRecipient & forwarder are not.
    function _setupBlocklistAndFund()
        internal returns (uint256 dealId, MockUSDCWithBlocklist blMock)
    {
        // Deploy blocklist mock at a throwaway address to capture its bytecode.
        blMock = new MockUSDCWithBlocklist();
        vm.etch(USDC_ADDR, address(blMock).code);
        blMock = MockUSDCWithBlocklist(USDC_ADDR); // rebind to canonical address

        // vm.etch copies bytecode only; storage at USDC_ADDR is empty.
        // Set `blocked` (slot 6) to seller via vm.store.
        // Slot layout: name(0), symbol(1), decimals(2), totalSupply(3),
        //              balanceOf mapping(4), allowance mapping(5), blocked(6).
        vm.store(
            USDC_ADDR,
            bytes32(uint256(6)),
            bytes32(uint256(uint160(seller)))
        );

        // Create & fund single milestone deal of 100e6
        uint256[] memory amts = new uint256[](1);
        amts[0] = 100_000_000;
        vm.prank(buyer);
        dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, amts,
            2 days, uint64(block.timestamp + 3 days)
        );
        // mint via the blocklist mock (seller is only blocked from *receiving*, not minting)
        blMock.mint(buyer, 100_000_000);
        vm.prank(buyer);
        blMock.approve(address(escrow), 100_000_000);
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    /// Test 17: PayoutCredited for blocklisted seller; others receive normally
    function test_FailedPayout_Credits_Seller() public {
        (uint256 dealId, MockUSDCWithBlocklist blMock) = _setupBlocklistAndFund();
        _attestAndWarp(dealId, 0);

        uint128 A = 100_000_000;
        uint128 feeAmt      = uint128(uint256(A) * 100  / 10_000); // 1_000_000
        uint128 fwdAmt      = uint128(uint256(A) * 1000 / 10_000); // 10_000_000
        uint128 sellerShare = A - feeAmt - fwdAmt;                   // 89_000_000

        // Expect PayoutCredited for seller (transfer returns false)
        vm.expectEmit(true, true, true, true, address(escrow));
        emit WasitEscrow.PayoutCredited(dealId, 0, seller, sellerShare);

        escrow.release(dealId, 0); // must NOT revert

        // seller: credited, not paid
        assertEq(escrow.owed(seller), sellerShare, "owed(seller) wrong");
        assertEq(blMock.balanceOf(seller), 0,       "seller USDC balance should be 0");

        // feeRecipient and forwarder: paid normally
        assertEq(blMock.balanceOf(feeRecipient), feeAmt, "feeRecipient not paid");
        assertEq(blMock.balanceOf(forwarder),    fwdAmt, "forwarder not paid");
    }

    /// Test 18: withdraw after credit → succeeds, emits Withdrawn, balance updated
    function test_Withdraw_AfterCredit_Succeeds() public {
        (uint256 dealId, MockUSDCWithBlocklist blMock) = _setupBlocklistAndFund();
        _attestAndWarp(dealId, 0);
        escrow.release(dealId, 0);

        uint128 sellerShare = escrow.owed(seller);
        assertGt(sellerShare, 0, "precondition: owed > 0");

        // Now unblock seller to let withdraw succeed
        // We must update the `blocked` slot to address(0) so transfer passes
        vm.store(USDC_ADDR, bytes32(uint256(6)), bytes32(0));

        vm.prank(seller);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit WasitEscrow.Withdrawn(seller, sellerShare);
        escrow.withdraw();

        assertEq(blMock.balanceOf(seller), sellerShare, "seller USDC balance wrong after withdraw");
        assertEq(escrow.owed(seller), 0,               "owed(seller) not cleared");
    }

    /// Test 19: withdraw when nothing owed → NothingToWithdraw
    function test_Withdraw_NothingOwed_Reverts() public {
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.NothingToWithdraw.selector,
                seller
            )
        );
        escrow.withdraw();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  DEAL STATE / CLOSURE (20–21)
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev Creates a 3-milestone deal with a deadline large enough to survive
    ///      3 consecutive _attestAndWarp calls (each advances 2 days+1).
    ///      challengeWindow=2 days, deadline=now+30 days satisfies > now+challengeWindow.
    function _createAndFundLongDeadline() internal returns (uint256 dealId) {
        vm.prank(buyer);
        dealId = escrow.createDeal(
            _defaultPayees(),
            inspector,
            arbiter,
            _defaultMilestones(),
            2 days,
            uint64(block.timestamp + 30 days)
        );
        _fundSetup();
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    /// Test 20: after all milestones Released, getDeal returns DealState.Closed
    function test_DealClosed_AfterAllMilestonesReleased() public {
        uint256 dealId = _createAndFundLongDeadline();

        for (uint256 i = 0; i < 3; ++i) {
            _attestAndWarp(dealId, i);
            escrow.release(dealId, i);
        }

        (, , , WasitEscrow.DealState state, , ,) = escrow.getDeal(dealId);
        assertEq(uint8(state), uint8(WasitEscrow.DealState.Closed));
    }

    /// Test 21: after deal Closed, release on already-released milestone → DealNotFunded
    function test_Release_OnClosedDeal_Reverts() public {
        uint256 dealId = _createAndFundLongDeadline();

        for (uint256 i = 0; i < 3; ++i) {
            _attestAndWarp(dealId, i);
            escrow.release(dealId, i);
        }

        // deal is now Closed; any further release → DealNotFunded
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId,
                WasitEscrow.DealState.Closed
            )
        );
        escrow.release(dealId, 0);
    }
}
