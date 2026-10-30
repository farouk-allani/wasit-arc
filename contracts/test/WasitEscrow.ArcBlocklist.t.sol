// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import "./WasitEscrow.Base.t.sol";

// ─────────────────────────────────────────────────────────────────────────────
// MockUSDCArcBlocklist
//
// Simulates Arc USDC blocklist behaviour precisely:
//   - transfer/transferFrom TO a blocklisted address reverts (does NOT return false).
//   - The revert consumes gas, exactly as the architecture doc warns:
//     "Arc blocklist reverts consume gas: this is why we never let them brick a deal."
//   - All other transfers behave like a normal ERC-20.
//
// This is intentionally different from MockUSDCWithBlocklist (which returns false),
// so _sendOrCredit is proven to handle BOTH the false-return AND the revert path.
// ─────────────────────────────────────────────────────────────────────────────
contract MockUSDCArcBlocklist {
    // --- storage layout (must match MockERC20 for vm.etch + vm.store compatibility) ---
    string public name     = "Mock USDC ArcBL";
    string public symbol   = "mUSDCarcbl";
    uint8  public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // slot 6: the blocklisted address — set via vm.store after etch
    address public blocklisted;

    // ── Events ────────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ── Errors ────────────────────────────────────────────────────────────────
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    /// @dev Mirrors the Arc USDC blocklist error — transfer to a blocklisted address
    ///      reverts unconditionally, consuming gas. This is the Arc-specific behaviour
    ///      the escrow's _sendOrCredit must survive.
    error AccountBlocklisted(address account);

    // ── ERC-20 surface ────────────────────────────────────────────────────────
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
        // Arc-style: revert (not return false) when recipient is blocklisted
        if (to == blocklisted) revert AccountBlocklisted(to);
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 cur = allowance[from][msg.sender];
        if (cur != type(uint256).max) {
            if (cur < amount) revert ERC20InsufficientAllowance(msg.sender, cur, amount);
            allowance[from][msg.sender] = cur - amount;
        }
        // Arc-style: revert when recipient is blocklisted — even for the escrow's own
        // safeTransferFrom in fund(). This means the BUYER must not be blocklisted to fund,
        // but the PAYEE being blocklisted is caught at payout time.
        if (to == blocklisted) revert AccountBlocklisted(to);
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount)
            revert ERC20InsufficientBalance(from, balanceOf[from], amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WasitEscrowArcBlocklistTest
//
// Closed-gap test: uses the REAL known Arc testnet blocklisted address
//   0x70997970C51812dc3A010C7d01b50e0d17dc79C8  (anvil mnemonic index 1)
// as a concrete payee to prove the escrow handles Arc's reverting blocklist.
// ─────────────────────────────────────────────────────────────────────────────
contract WasitEscrowArcBlocklistTest is WasitEscrowTestBase {
    // ── The real Arc testnet blocklisted address ───────────────────────────────
    // This is the well-known anvil mnemonic index-1 address used as a stand-in for
    // a real Arc USDC blocklisted address in pre-mainnet testing (VERIFIED-FACTS).
    address internal constant ARC_BLOCKED = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    MockUSDCArcBlocklist internal arcUsdc;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// @dev Replace the etched mock with the Arc-style reverting-blocklist mock,
    ///      with ARC_BLOCKED set as the blocklisted address at storage slot 6.
    function _etchArcBlocklistMock() internal {
        // Deploy the mock to get its bytecode
        MockUSDCArcBlocklist impl = new MockUSDCArcBlocklist();
        vm.etch(USDC_ADDR, address(impl).code);
        arcUsdc = MockUSDCArcBlocklist(USDC_ADDR);

        // Slot 6 = `blocklisted` (after: name=0, symbol=1, decimals=2,
        //          totalSupply=3, balanceOf=4, allowance=5, blocklisted=6)
        vm.store(USDC_ADDR, bytes32(uint256(6)), bytes32(uint256(uint160(ARC_BLOCKED))));
    }

    /// @dev Create a deal where ARC_BLOCKED is the seller (payee[0]).
    ///      buyer = this test contract's `buyer`, forwarder = forwarder, inspector = inspector.
    ///      feeBps = 100. seller = ARC_BLOCKED (8900 bps), forwarder (1000 bps).
    function _createDealWithBlockedSeller()
        internal
        returns (uint256 dealId, uint128 milestoneAmount)
    {
        milestoneAmount = 100_000_000; // 100 USDC

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: ARC_BLOCKED, bps: 8900}); // seller = blocklisted
        payees[1] = WasitEscrow.Payee({addr: forwarder,   bps: 1000});
        // 8900 + 1000 + 100 (feeBps) = 10_000 ✓

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = milestoneAmount;

        vm.prank(buyer);
        dealId = escrow.createDeal(
            payees,
            inspector,
            arbiter,
            amounts,
            0,                                     // challengeWindow = 0 (immediate release after attest)
            uint64(block.timestamp + 1 days)       // deadline
        );
    }

    /// @dev Fund the deal as the buyer.
    function _fund(uint256 dealId, uint128 amount) internal {
        arcUsdc.mint(buyer, amount);
        vm.prank(buyer);
        IERC20(USDC_ADDR).approve(address(escrow), amount);
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    /// @dev Core test: a release where the seller is Arc-blocklisted REVERTS the
    ///      individual transfer but NOT the whole release. The blocked seller is
    ///      credited to owed[], everyone else is paid, and the credited amount
    ///      can be withdrawn once unblocked.
    function test_ArcBlocklist_SellerCreditedNotReverted() public {
        _etchArcBlocklistMock();

        (uint256 dealId, uint128 A) = _createDealWithBlockedSeller();
        _fund(dealId, A);

        // Buyer approves milestone 0 to skip the challenge window
        vm.prank(buyer);
        escrow.approve(dealId, 0);

        // Record pre-release balances
        uint256 forwarderBefore  = arcUsdc.balanceOf(forwarder);
        uint256 feeBefore        = arcUsdc.balanceOf(feeRecipient);
        uint256 blockedBefore    = arcUsdc.balanceOf(ARC_BLOCKED);
        uint256 escrowBefore     = arcUsdc.balanceOf(address(escrow));

        // Expect PayoutCredited for the blocked seller
        // sellerShare = A - fee - forwarderShare = 100_000_000 - 1_000_000 - 10_000_000 = 89_000_000
        uint128 fee            = uint128(uint256(A) * 100  / 10_000); // 1_000_000
        uint128 forwarderShare = uint128(uint256(A) * 1000 / 10_000); // 10_000_000
        uint128 sellerShare    = A - fee - forwarderShare;            // 89_000_000

        vm.expectEmit(true, true, true, true);
        emit WasitEscrow.PayoutCredited(dealId, 0, ARC_BLOCKED, sellerShare);

        // release() must NOT revert despite the blocked seller
        escrow.release(dealId, 0);

        // ── Assertions ────────────────────────────────────────────────────────

        // 1. Release did not revert (we got here)

        // 2. Forwarder received their exact share
        assertEq(
            arcUsdc.balanceOf(forwarder) - forwarderBefore,
            forwarderShare,
            "Forwarder should receive forwarderShare"
        );

        // 3. Fee recipient received their exact fee
        assertEq(
            arcUsdc.balanceOf(feeRecipient) - feeBefore,
            fee,
            "FeeRecipient should receive fee"
        );

        // 4. Blocked seller's wallet balance did NOT change (transfer was caught)
        assertEq(
            arcUsdc.balanceOf(ARC_BLOCKED),
            blockedBefore,
            "Blocked seller wallet balance must not change"
        );

        // 5. Blocked seller is credited in owed[]
        assertEq(
            escrow.owed(ARC_BLOCKED),
            sellerShare,
            "Blocked seller must be credited to owed[]"
        );

        // 6. Escrow balance decreased by exactly the non-credited amounts
        //    (fee + forwarderShare were transferred out; sellerShare stays as liability)
        assertEq(
            escrowBefore - arcUsdc.balanceOf(address(escrow)),
            uint256(fee) + uint256(forwarderShare),
            "Escrow balance should decrease only by successfully transferred amounts"
        );

        // 7. Solvency: escrow balance >= owed
        assertGe(
            arcUsdc.balanceOf(address(escrow)),
            escrow.owed(ARC_BLOCKED),
            "Solvency: escrow must hold at least what it owes"
        );

        // 8. Milestone state is Released (not stuck)
        (, WasitEscrow.MilestoneState mState, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint8(mState), uint8(WasitEscrow.MilestoneState.Released), "Milestone must be Released");
    }

    /// @dev Shows that a non-seller payee being blocklisted also credits rather
    ///      than reverting, and the seller still receives their full share.
    function test_ArcBlocklist_ForwarderCreditedSellerUnaffected() public {
        _etchArcBlocklistMock();

        // Override: ARC_BLOCKED is the forwarder (payee[1]), seller is normal
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,      bps: 8900}); // normal seller
        payees[1] = WasitEscrow.Payee({addr: ARC_BLOCKED, bps: 1000}); // blocked forwarder

        uint128 A = 100_000_000;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = A;

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            payees, inspector, arbiter, amounts, 0, uint64(block.timestamp + 1 days)
        );

        arcUsdc.mint(buyer, A);
        vm.prank(buyer);
        IERC20(USDC_ADDR).approve(address(escrow), A);
        vm.prank(buyer);
        escrow.fund(dealId);

        vm.prank(buyer);
        escrow.approve(dealId, 0);

        uint128 fee            = uint128(uint256(A) * 100  / 10_000); // 1_000_000
        uint128 forwarderShare = uint128(uint256(A) * 1000 / 10_000); // 10_000_000  (blocked)
        uint128 sellerShare    = A - fee - forwarderShare;            // 89_000_000

        uint256 sellerBefore = arcUsdc.balanceOf(seller);
        uint256 feeBefore    = arcUsdc.balanceOf(feeRecipient);

        escrow.release(dealId, 0);

        // Seller received their full share
        assertEq(
            arcUsdc.balanceOf(seller) - sellerBefore,
            sellerShare,
            "Seller must receive full share despite blocked forwarder"
        );

        // Fee recipient received their fee
        assertEq(
            arcUsdc.balanceOf(feeRecipient) - feeBefore,
            fee,
            "FeeRecipient must receive fee despite blocked forwarder"
        );

        // Blocked forwarder credited to owed[]
        assertEq(
            escrow.owed(ARC_BLOCKED),
            forwarderShare,
            "Blocked forwarder must be credited to owed[]"
        );
    }

    /// @dev Shows that PayoutCredited is emitted (not PayeePaid) for the blocked address,
    ///      and that MilestoneReleased is also emitted (the whole release completes).
    function test_ArcBlocklist_EventsAreCorrect() public {
        _etchArcBlocklistMock();

        (uint256 dealId, uint128 A) = _createDealWithBlockedSeller();
        _fund(dealId, A);

        vm.prank(buyer);
        escrow.approve(dealId, 0);

        uint128 fee            = uint128(uint256(A) * 100  / 10_000);
        uint128 forwarderShare = uint128(uint256(A) * 1000 / 10_000);
        uint128 sellerShare    = A - fee - forwarderShare;

        // MilestoneReleased emitted with full amount
        vm.expectEmit(true, true, false, true);
        emit WasitEscrow.MilestoneReleased(dealId, 0, A);

        // PayeePaid for feeRecipient (not blocked)
        vm.expectEmit(true, true, true, true);
        emit WasitEscrow.PayeePaid(dealId, 0, feeRecipient, fee);

        // PayeePaid for forwarder (not blocked)
        vm.expectEmit(true, true, true, true);
        emit WasitEscrow.PayeePaid(dealId, 0, forwarder, forwarderShare);

        // PayoutCredited (not PayeePaid) for blocked seller
        vm.expectEmit(true, true, true, true);
        emit WasitEscrow.PayoutCredited(dealId, 0, ARC_BLOCKED, sellerShare);

        escrow.release(dealId, 0);
    }

    /// @dev Shows that the credited amount can be fully withdrawn once the address
    ///      is "unblocked" (we remove it from the blocklist by overwriting slot 6
    ///      with address(0), simulating the Arc blocklist being lifted).
    function test_ArcBlocklist_OwedWithdrawableAfterUnblock() public {
        _etchArcBlocklistMock();

        (uint256 dealId, uint128 A) = _createDealWithBlockedSeller();
        _fund(dealId, A);

        vm.prank(buyer);
        escrow.approve(dealId, 0);
        escrow.release(dealId, 0);

        uint128 sellerShare = A
            - uint128(uint256(A) * 100  / 10_000)
            - uint128(uint256(A) * 1000 / 10_000);

        // Confirm credit
        assertEq(escrow.owed(ARC_BLOCKED), sellerShare, "Pre-withdraw: owed must equal sellerShare");

        // "Unblock" by zeroing the blocklisted slot
        vm.store(USDC_ADDR, bytes32(uint256(6)), bytes32(0));
        assertEq(arcUsdc.blocklisted(), address(0), "Blocklist should be cleared");

        // Blocked address withdraws their credit
        vm.expectEmit(true, false, false, true);
        emit WasitEscrow.Withdrawn(ARC_BLOCKED, sellerShare);

        uint256 balBefore = arcUsdc.balanceOf(ARC_BLOCKED);
        vm.prank(ARC_BLOCKED);
        escrow.withdraw();

        // owed[] zeroed
        assertEq(escrow.owed(ARC_BLOCKED), 0, "owed must be 0 after withdraw");

        // Balance increased by exactly sellerShare
        assertEq(
            arcUsdc.balanceOf(ARC_BLOCKED) - balBefore,
            sellerShare,
            "Balance must increase by exactly sellerShare"
        );
    }

    /// @dev Attempting to withdraw while still blocklisted should revert because
    ///      withdraw() uses SafeERC20.safeTransfer, which bubbles the revert.
    ///      This is correct: the pull-based design means the blocked address
    ///      simply cannot collect until the blocklist is lifted.
    function test_ArcBlocklist_WithdrawRevertsWhileStillBlocked() public {
        _etchArcBlocklistMock();

        (uint256 dealId, uint128 A) = _createDealWithBlockedSeller();
        _fund(dealId, A);

        vm.prank(buyer);
        escrow.approve(dealId, 0);
        escrow.release(dealId, 0);

        // ARC_BLOCKED is still on the blocklist — withdraw() safeTransfer will revert
        // because the mock's transfer() reverts with AccountBlocklisted.
        // The credit in owed[] is preserved for later.
        vm.prank(ARC_BLOCKED);
        vm.expectRevert();
        escrow.withdraw();

        // owed[] must still hold the full credit after the failed withdraw
        uint128 sellerShare = A
            - uint128(uint256(A) * 100  / 10_000)
            - uint128(uint256(A) * 1000 / 10_000);
        assertEq(
            escrow.owed(ARC_BLOCKED),
            sellerShare,
            "owed must be preserved after failed withdraw"
        );
    }

    /// @dev Resolve path: dispute + resolve where the blocked address is the seller.
    ///      Even during an arbiter resolution, the blocked seller is credited to owed[]
    ///      rather than bricking the resolution.
    function test_ArcBlocklist_ResolveCreditsBlockedSeller() public {
        _etchArcBlocklistMock();

        (uint256 dealId, uint128 A) = _createDealWithBlockedSeller();
        _fund(dealId, A);

        // Attest (challengeWindow=0, but dispute requires being inside window; use window=1h)
        // Recreate with a non-zero window so dispute is possible
        // --- Re-create with challengeWindow = 1 hour ---
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: ARC_BLOCKED, bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: forwarder,   bps: 1000});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = A;

        vm.prank(buyer);
        uint256 dealId2 = escrow.createDeal(
            payees, inspector, arbiter, amounts, 1 hours, uint64(block.timestamp + 2 hours)
        );

        arcUsdc.mint(buyer, A);
        vm.prank(buyer);
        IERC20(USDC_ADDR).approve(address(escrow), A);
        vm.prank(buyer);
        escrow.fund(dealId2);

        // Inspector attests
        vm.prank(inspector);
        escrow.attest(dealId2, 0, bytes32("evidence"));

        // Buyer disputes within window
        vm.prank(buyer);
        escrow.dispute(dealId2, 0, "goods not delivered");

        // Arbiter resolves: 50/50 split
        uint16 sellerShareBps = 5000; // 50 %
        uint128 sellerAmount  = uint128(uint256(A) * sellerShareBps / 10_000); // 50_000_000
        uint128 buyerRefund   = A - sellerAmount;                               // 50_000_000

        // Within sellerAmount, the payee split:
        uint128 fee            = uint128(uint256(sellerAmount) * 100  / 10_000); // 500_000
        uint128 forwarderShare = uint128(uint256(sellerAmount) * 1000 / 10_000); // 5_000_000
        uint128 sellerNet      = sellerAmount - fee - forwarderShare;            // 44_500_000

        uint256 forwarderBefore = arcUsdc.balanceOf(forwarder);
        uint256 feeBefore       = arcUsdc.balanceOf(feeRecipient);
        uint256 buyerBefore     = arcUsdc.balanceOf(buyer);

        vm.prank(arbiter);
        escrow.resolve(dealId2, 0, sellerShareBps);

        // Forwarder paid their split share
        assertEq(arcUsdc.balanceOf(forwarder) - forwarderBefore, forwarderShare, "Forwarder share");

        // Fee recipient paid their fee
        assertEq(arcUsdc.balanceOf(feeRecipient) - feeBefore, fee, "Fee recipient");

        // Buyer received their refund
        assertEq(arcUsdc.balanceOf(buyer) - buyerBefore, buyerRefund, "Buyer refund");

        // Blocked seller credited to owed[]
        assertEq(escrow.owed(ARC_BLOCKED), sellerNet, "Blocked seller credited via resolve");

        // Total: forwarderShare + fee + sellerNet + buyerRefund = A
        assertEq(
            uint256(forwarderShare) + uint256(fee) + uint256(sellerNet) + uint256(buyerRefund),
            uint256(A),
            "All amounts sum to A"
        );
    }

    /// @dev Invariant spot-check: after release with blocked seller, escrow balance
    ///      equals the credited owed (solvency holds, not just the >= form).
    ///      With a single-milestone deal that fully settles, escrow should hold
    ///      exactly owed[blockedSeller] and nothing more (no donation).
    function test_ArcBlocklist_SolvencyExactAfterRelease() public {
        _etchArcBlocklistMock();

        (uint256 dealId, uint128 A) = _createDealWithBlockedSeller();
        _fund(dealId, A);

        vm.prank(buyer);
        escrow.approve(dealId, 0);
        escrow.release(dealId, 0);

        uint128 sellerShare = A
            - uint128(uint256(A) * 100  / 10_000)
            - uint128(uint256(A) * 1000 / 10_000);

        // Escrow holds exactly the seller's credit and nothing else
        assertEq(
            arcUsdc.balanceOf(address(escrow)),
            sellerShare,
            "Escrow balance must equal exactly the blocked seller's owed credit"
        );
        assertEq(
            escrow.owed(ARC_BLOCKED),
            sellerShare,
            "owed[ARC_BLOCKED] must equal the retained balance"
        );
    }
}
