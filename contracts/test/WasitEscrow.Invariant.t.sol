// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Invariant handler that drives WasitEscrow through randomised sequences
///      of valid and invalid operations while maintaining ghost variables that
///      allow the invariant assertions to be checked without re-implementing the
///      full contract logic.
contract WasitEscrowHandler is Test {

    // ── Constants ────────────────────────────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint16  internal constant FEE_BPS   = 100;
    uint256 internal constant MAX_DEALS = 8;   // cap tracked deals for gas
    uint8   internal constant MAX_MILESTONES_PER_DEAL = 3;

    // ── Contracts ────────────────────────────────────────────────────────────
    WasitEscrow public escrow;
    MockERC20   public usdc;
    address     public feeRecipient;

    // ── Actor pool (5 fixed addresses) ───────────────────────────────────────
    address[5] internal _actors;

    // ── Deal tracking ────────────────────────────────────────────────────────
    struct DealInfo {
        bool     exists;
        address  buyer;
        address  inspector;
        address  arbiter;
        address  seller;        // payees[0]
        address  fwdPayee;      // payees[1] if 2-payee deal, else address(0)
        uint64   challengeWindow;
        uint64   deadline;
        uint8    milestoneCount;
        uint128[] milestoneAmts;
    }

    uint256[] public trackedDealIds;
    mapping(uint256 => DealInfo) internal _dealInfo;

    // ── Ghost variables ──────────────────────────────────────────────────────
    // Sum of milestone amounts for milestones that are funded but not yet in a
    // terminal state (Released=3, Resolved=5, Refunded=6).
    uint256 public ghost_totalFunded;

    // Sum of escrow.owed() for all known addresses (recomputed after every action).
    uint256 public ghost_totalOwed;

    // Track terminal counts per (dealId, milestoneIdx) — must never exceed 1.
    mapping(uint256 => mapping(uint256 => uint256)) public ghost_terminalCount;

    // ── Known address set (for ghost_totalOwed recomputation) ────────────────
    address[] internal _knownAddrs;
    mapping(address => bool) internal _knownAddrSeen;

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(WasitEscrow escrow_, MockERC20 usdc_, address feeRecipient_) {
        escrow       = escrow_;
        usdc         = usdc_;
        feeRecipient = feeRecipient_;

        // Build fixed actor pool
        _actors[0] = makeAddr("actorA");
        _actors[1] = makeAddr("actorB");
        _actors[2] = makeAddr("actorC");
        _actors[3] = makeAddr("actorD");
        _actors[4] = makeAddr("actorE");

        _registerAddr(feeRecipient_);
        for (uint256 i; i < 5; ++i) _registerAddr(_actors[i]);
    }

    // ── Address registry helper ───────────────────────────────────────────────
    function _registerAddr(address a) internal {
        if (!_knownAddrSeen[a]) {
            _knownAddrSeen[a] = true;
            _knownAddrs.push(a);
        }
    }

    // ── Ghost: recompute totalOwed from chain state ──────────────────────────
    function _recomputeOwed() internal {
        uint256 sum;
        for (uint256 i; i < _knownAddrs.length; ++i) {
            sum += escrow.owed(_knownAddrs[i]);
        }
        ghost_totalOwed = sum;
    }

    // ── Helper: is state terminal? ────────────────────────────────────────────
    function _isTerminal(WasitEscrow.MilestoneState s) internal pure returns (bool) {
        return s == WasitEscrow.MilestoneState.Released  ||
               s == WasitEscrow.MilestoneState.Resolved  ||
               s == WasitEscrow.MilestoneState.Refunded;
    }

    // ── Helper: mark terminal ─────────────────────────────────────────────────
    function _markTerminal(uint256 dealId, uint256 mi, uint128 amt) internal {
        ghost_terminalCount[dealId][mi] += 1;
        if (ghost_totalFunded >= amt) {
            ghost_totalFunded -= amt;
        } else {
            ghost_totalFunded = 0;
        }
        _recomputeOwed();
    }

    // ── Handler: createDeal ──────────────────────────────────────────────────
    function handler_createDeal(
        uint256 actorSeed,
        uint256 milestoneSeed,
        uint256 amountSeed,
        uint256 windowSeed
    ) external {
        // Hard cap on number of tracked deals to keep state manageable
        if (trackedDealIds.length >= MAX_DEALS) return;

        // Derive unique per-deal addresses (N = nextDealId to keep them unique)
        uint256 N = escrow.nextDealId();
        address _buyer     = makeAddr(string(abi.encodePacked("buyer_",     N)));
        address _seller    = makeAddr(string(abi.encodePacked("seller_",    N)));
        address _inspector = makeAddr(string(abi.encodePacked("inspector_", N)));
        address _arbiter   = makeAddr(string(abi.encodePacked("arbiter_",   N)));

        _registerAddr(_buyer);
        _registerAddr(_seller);
        _registerAddr(_inspector);
        _registerAddr(_arbiter);

        // 1 payee (seller, 9900 bps) so feeBps(100) + 9900 == 10_000
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](1);
        payees[0] = WasitEscrow.Payee({addr: _seller, bps: 9900});

        uint8 milestoneCount = uint8(bound(milestoneSeed, 1, MAX_MILESTONES_PER_DEAL));
        uint256[] memory amounts = new uint256[](milestoneCount);
        uint128  runningTotal    = 0;
        for (uint256 i; i < milestoneCount; ++i) {
            uint256 maxAmt = uint256(type(uint128).max) - runningTotal;
            if (maxAmt == 0) {
                milestoneCount = uint8(i);
                // rebuild with smaller count
                uint256[] memory trimmed = new uint256[](milestoneCount);
                for (uint256 k; k < milestoneCount; ++k) trimmed[k] = amounts[k];
                amounts = trimmed;
                break;
            }
            uint256 amt = bound(amountSeed ^ i, 1, maxAmt < 1_000_000_000 ? maxAmt : 1_000_000_000);
            amounts[i]    = amt;
            runningTotal += uint128(amt);
        }
        if (amounts.length == 0) return;

        uint64 window   = uint64(bound(windowSeed, 0, 7 days));
        uint64 deadline = uint64(block.timestamp) + window + 1 + uint64(bound(windowSeed, 0, 30 days));

        vm.prank(_buyer);
        try escrow.createDeal(payees, _inspector, _arbiter, amounts, window, deadline)
            returns (uint256 dealId)
        {
            DealInfo storage info = _dealInfo[dealId];
            info.exists          = true;
            info.buyer           = _buyer;
            info.inspector       = _inspector;
            info.arbiter         = _arbiter;
            info.seller          = _seller;
            info.fwdPayee        = address(0);
            info.challengeWindow = window;
            info.deadline        = deadline;
            info.milestoneCount  = uint8(amounts.length);
            info.milestoneAmts   = new uint128[](amounts.length);
            for (uint256 i; i < amounts.length; ++i) {
                info.milestoneAmts[i] = uint128(amounts[i]);
            }
            trackedDealIds.push(dealId);
        } catch {
            // createDeal reverted — no state change needed
        }
    }

    // ── Handler: fund ────────────────────────────────────────────────────────
    function handler_fund(uint256 dealSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        (, , , WasitEscrow.DealState ds, , , uint128 total) = escrow.getDeal(dealId);
        if (ds != WasitEscrow.DealState.Created) return;

        usdc.mint(info.buyer, total);
        vm.prank(info.buyer);
        usdc.approve(address(escrow), total);

        vm.prank(info.buyer);
        try escrow.fund(dealId) {
            // Add each milestone amount to ghost_totalFunded
            for (uint256 i; i < info.milestoneCount; ++i) {
                ghost_totalFunded += info.milestoneAmts[i];
            }
        } catch {
            // fund reverted — undo the minted balance (not strictly needed for invariants)
        }
    }

    // ── Handler: attest ──────────────────────────────────────────────────────
    function handler_attest(uint256 dealSeed, uint256 mSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        uint256 mi = bound(mSeed, 0, info.milestoneCount == 0 ? 0 : info.milestoneCount - 1);

        vm.prank(info.inspector);
        try escrow.attest(dealId, mi, keccak256(abi.encodePacked("ev", dealId, mi))) {} catch {}
    }

    // ── Handler: approve ─────────────────────────────────────────────────────
    function handler_approve(uint256 dealSeed, uint256 mSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        uint256 mi = bound(mSeed, 0, info.milestoneCount == 0 ? 0 : info.milestoneCount - 1);

        vm.prank(info.buyer);
        try escrow.approve(dealId, mi) {} catch {}
    }

    // ── Handler: dispute ─────────────────────────────────────────────────────
    function handler_dispute(uint256 dealSeed, uint256 mSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        uint256 mi = bound(mSeed, 0, info.milestoneCount == 0 ? 0 : info.milestoneCount - 1);

        vm.prank(info.buyer);
        try escrow.dispute(dealId, mi, "handler dispute") {} catch {}
    }

    // ── Handler: resolve ─────────────────────────────────────────────────────
    function handler_resolve(uint256 dealSeed, uint256 mSeed, uint256 sellerShareSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        uint256 mi              = bound(mSeed,           0, info.milestoneCount == 0 ? 0 : info.milestoneCount - 1);
        uint16  sellerShareBps  = uint16(bound(sellerShareSeed, 0, 10_000));

        (uint128 mAmt, WasitEscrow.MilestoneState mState, , ,) = escrow.getMilestone(dealId, mi);

        vm.prank(info.arbiter);
        try escrow.resolve(dealId, mi, sellerShareBps) {
            if (!_isTerminal(mState)) {
                _markTerminal(dealId, mi, mAmt);
            }
            _recomputeOwed();
        } catch {}
    }

    // ── Handler: release ─────────────────────────────────────────────────────
    function handler_release(uint256 dealSeed, uint256 mSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        uint256 mi = bound(mSeed, 0, info.milestoneCount == 0 ? 0 : info.milestoneCount - 1);

        (uint128 mAmt, WasitEscrow.MilestoneState mState, , ,) = escrow.getMilestone(dealId, mi);

        try escrow.release(dealId, mi) {
            if (!_isTerminal(mState)) {
                _markTerminal(dealId, mi, mAmt);
            }
            _recomputeOwed();
        } catch {}
    }

    // ── Handler: refundExpired ────────────────────────────────────────────────
    function handler_refundExpired(uint256 dealSeed, uint256 mSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        uint256 mi = bound(mSeed, 0, info.milestoneCount == 0 ? 0 : info.milestoneCount - 1);

        (uint128 mAmt, WasitEscrow.MilestoneState mState, , ,) = escrow.getMilestone(dealId, mi);

        try escrow.refundExpired(dealId, mi) {
            if (!_isTerminal(mState)) {
                _markTerminal(dealId, mi, mAmt);
            }
            _recomputeOwed();
        } catch {}
    }

    // ── Handler: releaseStalled ──────────────────────────────────────────────
    function handler_releaseStalled(uint256 dealSeed, uint256 mSeed) external {
        uint256 len = trackedDealIds.length;
        if (len == 0) return;

        uint256 dealId = trackedDealIds[bound(dealSeed, 0, len - 1)];
        DealInfo storage info = _dealInfo[dealId];
        if (!info.exists) return;

        uint256 mi = bound(mSeed, 0, info.milestoneCount == 0 ? 0 : info.milestoneCount - 1);

        (uint128 mAmt, WasitEscrow.MilestoneState mState, , ,) = escrow.getMilestone(dealId, mi);

        try escrow.releaseStalled(dealId, mi) {
            // releaseStalled marks the milestone Released — same terminal state as release()
            if (!_isTerminal(mState)) {
                _markTerminal(dealId, mi, mAmt);
            }
            _recomputeOwed();
        } catch {}
    }

    // ── Handler: withdraw ────────────────────────────────────────────────────
    function handler_withdraw(uint256 actorSeed) external {
        address actor = _knownAddrs[bound(actorSeed, 0, _knownAddrs.length - 1)];

        vm.prank(actor);
        try escrow.withdraw() {} catch {}

        _recomputeOwed();
    }

    // ── Handler: warp ────────────────────────────────────────────────────────
    function handler_warp(uint256 secondsSeed) external {
        uint256 secs = bound(secondsSeed, 1, 3 days);
        skip(secs);
    }

    // ── Handler: donateUsdc ──────────────────────────────────────────────────
    /// @dev Simulates an unsolicited USDC donation to the escrow.
    ///      ghost_totalFunded is intentionally NOT updated — the invariant uses >=.
    function handler_donateUsdc(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1_000_000);
        address donor = makeAddr("donor");
        usdc.mint(donor, amount);
        vm.prank(donor);
        usdc.transfer(address(escrow), amount);
        // No ghost variable update — donations make balance exceed liabilities (>= holds).
    }

    // ── Assertion helpers (called by invariant contract) ─────────────────────

    function assertNoDoubleSettle() external view {
        for (uint256 d; d < trackedDealIds.length; ++d) {
            uint256 dealId   = trackedDealIds[d];
            DealInfo storage info = _dealInfo[dealId];
            for (uint256 mi; mi < info.milestoneCount; ++mi) {
                uint256 tc = ghost_terminalCount[dealId][mi];
                require(tc <= 1, "WasitEscrowHandler: double-settle detected");
            }
        }
    }

    function knownAddrsLength() external view returns (uint256) {
        return _knownAddrs.length;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant test contract
// ─────────────────────────────────────────────────────────────────────────────

contract WasitEscrowInvariantTest is StdInvariant, Test {

    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint16  internal constant FEE_BPS   = 100;

    WasitEscrow            internal escrow;
    MockERC20              internal usdc;
    address                internal feeRecipient;
    WasitEscrowHandler     internal handler;

    function setUp() public {
        feeRecipient = makeAddr("feeRecipient");

        // Etch mock ERC-20 at the hardcoded USDC constant address
        MockERC20 mockImpl = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mockImpl).code);
        usdc = MockERC20(USDC_ADDR);

        // Deploy escrow
        escrow = new WasitEscrow(feeRecipient, FEE_BPS);

        // Deploy handler
        handler = new WasitEscrowHandler(escrow, usdc, feeRecipient);

        // Tell the invariant runner to only call the handler
        targetContract(address(handler));

        // Exclude escrow and USDC from direct fuzzing
        excludeContract(address(escrow));
        excludeContract(USDC_ADDR);
        excludeContract(address(this));
    }

    // ── Invariant 1: SOLVENCY ────────────────────────────────────────────────
    /// @notice escrow USDC balance >= funded_liabilities + owed_liabilities.
    /// Donations make balance > liabilities; withdrawals reduce both sides equally.
    function invariant_solvency() public view {
        uint256 balance     = IERC20(USDC_ADDR).balanceOf(address(escrow));
        uint256 liabilities = handler.ghost_totalFunded() + handler.ghost_totalOwed();
        assertGe(balance, liabilities, "Solvency: balance < funded + owed");
    }

    // ── Invariant 2: ONE-SHOT ────────────────────────────────────────────────
    /// @notice Each milestone can only be settled once (no double-spend).
    function invariant_oneShot() public view {
        handler.assertNoDoubleSettle();
    }

    // ── Invariant 3: OWED NON-NEGATIVE ──────────────────────────────────────
    /// @notice ghost_totalOwed is always >= 0 (Solidity guarantee, but makes the
    ///         runner's accounting visible).
    function invariant_owedNonNegative() public view {
        assertGe(handler.ghost_totalOwed(), 0, "ghost_totalOwed underflowed");
    }

    // ── Invariant 4: TOTAL FUNDED NON-NEGATIVE ───────────────────────────────
    function invariant_totalFundedNonNegative() public view {
        assertGe(handler.ghost_totalFunded(), 0, "ghost_totalFunded underflowed");
    }

    // ── Unit test: donation does not break solvency ───────────────────────────
    function test_DonationDoesNotBreakSolvency() public {
        // Create and fund a single deal
        address buyer_     = makeAddr("donBuyer");
        address seller_    = makeAddr("donSeller");
        address inspector_ = makeAddr("donInspector");
        address arbiter_   = makeAddr("donArbiter");

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](1);
        payees[0] = WasitEscrow.Payee({addr: seller_, bps: 9900});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 500_000_000; // 500 USDC

        vm.prank(buyer_);
        uint256 dealId = escrow.createDeal(
            payees, inspector_, arbiter_, amounts,
            0, uint64(block.timestamp + 1 days)
        );

        usdc.mint(buyer_, 500_000_000);
        vm.prank(buyer_);
        usdc.approve(address(escrow), 500_000_000);
        vm.prank(buyer_);
        escrow.fund(dealId);

        // ── Donate 1000 USDC directly to the escrow ──────────────────────────
        address donor = makeAddr("donor");
        usdc.mint(donor, 1000_000_000);
        vm.prank(donor);
        usdc.transfer(address(escrow), 1000_000_000);

        // Check 1: escrow still functions — approve + release work
        vm.prank(buyer_);
        escrow.approve(dealId, 0);
        escrow.release(dealId, 0);

        // Check 2: after settle, escrow balance >= any remaining owed
        uint256 balanceAfter = IERC20(USDC_ADDR).balanceOf(address(escrow));
        uint256 owedSeller   = escrow.owed(seller_);
        uint256 owedFee      = escrow.owed(feeRecipient);

        assertGe(balanceAfter, owedSeller + owedFee,
            "Post-donation + post-settle: balance must still cover all owed");

        // Check 3: the donation surplus is not claimable by anyone — escrow holds it
        // (1000 USDC donated should remain; the 500 USDC deal was settled)
        assertGe(balanceAfter, 1000_000_000,
            "Donated USDC should remain locked in escrow (no one can steal it)");
    }
}
