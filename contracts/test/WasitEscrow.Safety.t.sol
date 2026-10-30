// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import "./WasitEscrow.Base.t.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Arc-style reverting blocklist mock (reused from ArcBlocklist tests concept)
// transfer() to the blocked address reverts, consuming gas, exactly as Arc USDC does.
// ─────────────────────────────────────────────────────────────────────────────
contract MockUSDCRevertBlocklist {
    string  public name     = "Mock USDC Revert BL";
    string  public symbol   = "mUSDCrbl";
    uint8   public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public blocked; // set via vm.store after etch

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20Blocked(address target);

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
        if (to == blocked) revert ERC20Blocked(to);
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
        if (to == blocked) revert ERC20Blocked(to);
        if (balanceOf[from] < amount)
            revert ERC20InsufficientBalance(from, balanceOf[from], amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety tests: Change 1 (arbiter-not-payee) + Change 2 (releaseStalled)
// ─────────────────────────────────────────────────────────────────────────────
contract WasitEscrowSafetyTest is WasitEscrowTestBase {

    // ── Additional actor ─────────────────────────────────────────────────────
    // `arbiter` is inherited from Base. `extraPayee` is someone not otherwise in the deal.
    address internal extraPayee = makeAddr("extraPayee");

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Creates + funds a 1-milestone deal (100 USDC) with a 2-day challenge window.
    /// Returns dealId.
    function _createAndFundSingle() internal returns (uint256 dealId) {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = M0; // 100 USDC

        vm.prank(buyer);
        dealId = escrow.createDeal(
            payees, inspector, arbiter, amounts,
            2 days,
            uint64(block.timestamp + 3 days)
        );

        usdc.mint(buyer, M0);
        vm.prank(buyer);
        usdc.approve(address(escrow), M0);
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    /// Attests milestone i and disputes it (buyer disputes inside the window).
    function _attestAndDispute(uint256 dealId, uint256 i) internal {
        vm.prank(inspector);
        escrow.attest(dealId, i, keccak256("evidence"));

        // dispute immediately after attest (inside the 2-day window)
        vm.prank(buyer);
        escrow.dispute(dealId, i, "test dispute");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHANGE 1: Arbiter-not-payee
    // ─────────────────────────────────────────────────────────────────────────

    function test_ArbiterPayee0_Reverts() public {
        // arbiter == seller (payees[0]) — already blocked by InvalidArbiter,
        // but also now caught by ArbiterIsPayee; whichever fires first is fine.
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](1);
        payees[0] = WasitEscrow.Payee({addr: seller, bps: 9900});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = M0;

        vm.prank(buyer);
        // arbiter == seller: InvalidArbiter fires before ArbiterIsPayee — that's fine.
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidArbiter.selector, seller)
        );
        escrow.createDeal(payees, inspector, seller, amounts, 0, uint64(block.timestamp + 1));
    }

    function test_ArbiterAsMiddlePayee_Reverts() public {
        // 3-payee deal: seller, arbiter (middle), forwarder.
        // feeBps=100; so payee bps must sum to 9900.
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](3);
        payees[0] = WasitEscrow.Payee({addr: seller,   bps: 7900});
        payees[1] = WasitEscrow.Payee({addr: arbiter,  bps: 1000}); // arbiter in the middle
        payees[2] = WasitEscrow.Payee({addr: forwarder, bps: 1000});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = M0;

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.ArbiterIsPayee.selector, arbiter)
        );
        escrow.createDeal(payees, inspector, arbiter, amounts, 0, uint64(block.timestamp + 1));
    }

    function test_ArbiterAsLastPayee_Reverts() public {
        // 2-payee deal: seller, then arbiter as the last payee.
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,  bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: arbiter, bps: 1000}); // arbiter as last payee

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = M0;

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.ArbiterIsPayee.selector, arbiter)
        );
        escrow.createDeal(payees, inspector, arbiter, amounts, 0, uint64(block.timestamp + 1));
    }

    function test_UnrelatedArbiter_Succeeds() public {
        // arbiter is unrelated to every payee — should succeed.
        address unrelatedArbiter = makeAddr("unrelatedArbiter");

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = M0;

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            payees, inspector, unrelatedArbiter, amounts,
            0, uint64(block.timestamp + 1)
        );
        assertEq(dealId, 0);
    }

    function test_ArbiterAsPayee_AllSixSlots_Reverts() public {
        // Check that the loop catches arbiter no matter which of the 6 slots they occupy.
        address localArbiter = makeAddr("la");

        address[6] memory addrs = [
            makeAddr("p0"), makeAddr("p1"), makeAddr("p2"),
            makeAddr("p3"), makeAddr("p4"), localArbiter   // arbiter at slot 5
        ];

        // feeBps=100; 6 payees must sum to 9900 bps
        uint16[6] memory bpsVals = [1500, 1500, 1500, 1500, 1500, 2400];

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](6);
        for (uint256 j; j < 6; ++j) {
            payees[j] = WasitEscrow.Payee({addr: addrs[j], bps: bpsVals[j]});
        }

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = M0;

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.ArbiterIsPayee.selector, localArbiter)
        );
        escrow.createDeal(payees, inspector, localArbiter, amounts, 0, uint64(block.timestamp + 1));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHANGE 2: releaseStalled
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Warp to exactly ARBITRATION_WINDOW after current timestamp.
    function _warpPastArbitrationWindow() internal {
        skip(escrow.ARBITRATION_WINDOW() + 1);
    }

    function test_ReleaseStalled_RevertsBeforeWindow() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);

        // Still inside the 14-day arbitration window
        skip(escrow.ARBITRATION_WINDOW() - 1);

        // Compute expected unlocksAt from the storage
        // We can't read disputedAt directly, but the dispute was just called so
        // disputedAt ~ block.timestamp - (ARBITRATION_WINDOW - 1).
        // Just assert it reverts with ArbiterWindowNotExpired.
        vm.expectRevert(); // any revert suffices; the exact error requires reading disputedAt
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_SucceedsAfterWindow() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);
        _warpPastArbitrationWindow();

        // Should succeed — callable by anyone
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        escrow.releaseStalled(dealId, 0);

        (, WasitEscrow.MilestoneState stateAfter, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint256(stateAfter), uint256(WasitEscrow.MilestoneState.Released));
    }

    function test_ReleaseStalled_PaysExactMilestoneAmount() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);
        _warpPastArbitrationWindow();

        uint256 sellerBefore     = usdc.balanceOf(seller);
        uint256 forwarderBefore  = usdc.balanceOf(forwarder);
        uint256 feeBefore        = usdc.balanceOf(feeRecipient);

        escrow.releaseStalled(dealId, 0);

        // Each recipient got paid or credited
        uint256 sellerGot    = (usdc.balanceOf(seller)       - sellerBefore)    + escrow.owed(seller);
        uint256 forwarderGot = (usdc.balanceOf(forwarder)    - forwarderBefore) + escrow.owed(forwarder);
        uint256 feeGot       = (usdc.balanceOf(feeRecipient) - feeBefore)       + escrow.owed(feeRecipient);

        // Split: seller 8900 bps, forwarder 1000 bps, fee 100 bps → fee=1, fwd=10, seller=89 (on 100 USDC)
        uint128 expectedFee      = uint128(uint256(M0) * FEE_BPS / 10_000);         // 1 USDC
        uint128 expectedFwd      = uint128(uint256(M0) * 1000    / 10_000);         // 10 USDC
        uint128 expectedSeller   = uint128(M0) - expectedFee - expectedFwd;          // 89 USDC

        assertEq(feeGot,       expectedFee,    "fee split wrong");
        assertEq(forwarderGot, expectedFwd,    "forwarder split wrong");
        assertEq(sellerGot,    expectedSeller, "seller split wrong");
        assertEq(sellerGot + forwarderGot + feeGot, M0, "total must equal milestone amount");
    }

    function test_ReleaseStalled_SameAsReleaseSplit() public {
        // Create two identical deals, settle one via release() and one via releaseStalled(),
        // and assert the payouts are identical.
        uint256 dealA = _createAndFundSingle();
        uint256 dealB = _createAndFundSingle();

        // Deal A: normal attestation + window-pass release
        vm.prank(inspector);
        escrow.attest(dealA, 0, keccak256("evA"));
        skip(2 days + 1); // past challenge window
        uint256 sellerB_A    = usdc.balanceOf(seller);
        uint256 forwarderB_A = usdc.balanceOf(forwarder);
        uint256 feeB_A       = usdc.balanceOf(feeRecipient);
        escrow.release(dealA, 0);
        uint256 sellerPaidA    = usdc.balanceOf(seller)       - sellerB_A;
        uint256 forwarderPaidA = usdc.balanceOf(forwarder)    - forwarderB_A;
        uint256 feePaidA       = usdc.balanceOf(feeRecipient) - feeB_A;

        // Deal B: attest → dispute → arbitration window expires → releaseStalled
        _attestAndDispute(dealB, 0);
        _warpPastArbitrationWindow();
        uint256 sellerB_B    = usdc.balanceOf(seller);
        uint256 forwarderB_B = usdc.balanceOf(forwarder);
        uint256 feeB_B       = usdc.balanceOf(feeRecipient);
        escrow.releaseStalled(dealB, 0);
        uint256 sellerPaidB    = usdc.balanceOf(seller)       - sellerB_B;
        uint256 forwarderPaidB = usdc.balanceOf(forwarder)    - forwarderB_B;
        uint256 feePaidB       = usdc.balanceOf(feeRecipient) - feeB_B;

        assertEq(sellerPaidA,    sellerPaidB,    "seller payout mismatch between release and releaseStalled");
        assertEq(forwarderPaidA, forwarderPaidB, "forwarder payout mismatch");
        assertEq(feePaidA,       feePaidB,       "fee payout mismatch");
    }

    /// @dev Uses a 2-milestone deal so the deal stays Funded after milestone 0 is settled,
    ///      allowing milestone 1 to exercise the MilestoneNotStalledDisputed guard.
    function test_ReleaseStalled_RevertsOnAttested_MultiMilestone() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = M0; amounts[1] = M1;

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(payees, inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days));
        usdc.mint(buyer, M0 + M1);
        vm.prank(buyer); usdc.approve(address(escrow), M0 + M1);
        vm.prank(buyer); escrow.fund(dealId);

        // Milestone 1: attested (not disputed) — MilestoneNotStalledDisputed should fire
        vm.prank(inspector);
        escrow.attest(dealId, 1, keccak256("ev1"));
        _warpPastArbitrationWindow();

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotStalledDisputed.selector,
                dealId, 1, WasitEscrow.MilestoneState.Attested
            )
        );
        escrow.releaseStalled(dealId, 1);
    }

    /// @dev Multi-milestone: after resolve() on milestone 0, deal stays Funded;
    ///      milestone 0 is Resolved — MilestoneNotStalledDisputed fires (not DealNotFunded).
    function test_ReleaseStalled_RevertsOnResolved_MultiMilestone() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = M0; amounts[1] = M1;

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(payees, inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days));
        usdc.mint(buyer, M0 + M1);
        vm.prank(buyer); usdc.approve(address(escrow), M0 + M1);
        vm.prank(buyer); escrow.fund(dealId);

        // Milestone 0: attest → dispute → resolve
        vm.prank(inspector); escrow.attest(dealId, 0, keccak256("ev0"));
        vm.prank(buyer);     escrow.dispute(dealId, 0, "d");
        vm.prank(arbiter);   escrow.resolve(dealId, 0, 10_000);

        _warpPastArbitrationWindow();

        // Deal is still Funded (milestone 1 is Pending)
        (, , , WasitEscrow.DealState ds, , ,) = escrow.getDeal(dealId);
        assertEq(uint256(ds), uint256(WasitEscrow.DealState.Funded));

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotStalledDisputed.selector,
                dealId, 0, WasitEscrow.MilestoneState.Resolved
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_RevertsOnAttested() public {
        uint256 dealId = _createAndFundSingle();
        vm.prank(inspector);
        escrow.attest(dealId, 0, keccak256("ev"));
        _warpPastArbitrationWindow();

        // Milestone is Attested, not Disputed — must revert
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotStalledDisputed.selector,
                dealId, 0, WasitEscrow.MilestoneState.Attested
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_RevertsOnPending() public {
        uint256 dealId = _createAndFundSingle();
        _warpPastArbitrationWindow();

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.MilestoneNotStalledDisputed.selector,
                dealId, 0, WasitEscrow.MilestoneState.Pending
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_RevertsOnReleased() public {
        uint256 dealId = _createAndFundSingle();
        // Approve + release normally first — this is a 1-milestone deal, so the deal
        // transitions to Closed immediately. releaseStalled fires DealNotFunded (Closed)
        // before it ever reaches the milestone-state check.
        vm.prank(buyer);
        escrow.approve(dealId, 0);
        escrow.release(dealId, 0);

        (, , , WasitEscrow.DealState ds, , ,) = escrow.getDeal(dealId);
        assertEq(uint256(ds), uint256(WasitEscrow.DealState.Closed));

        // DealNotFunded fires first (deal is Closed, not Funded)
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId, WasitEscrow.DealState.Closed
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_RevertsOnResolved() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);
        // Arbiter resolves before window expires — 1-milestone deal becomes Closed
        vm.prank(arbiter);
        escrow.resolve(dealId, 0, 10_000); // full seller
        _warpPastArbitrationWindow();

        (, , , WasitEscrow.DealState ds, , ,) = escrow.getDeal(dealId);
        assertEq(uint256(ds), uint256(WasitEscrow.DealState.Closed));

        // DealNotFunded fires first (deal is Closed)
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId, WasitEscrow.DealState.Closed
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_RevertsOnRefunded() public {
        uint256 dealId = _createAndFundSingle();
        // Let the deadline pass without attestation — 1-milestone deal becomes Closed
        skip(4 days); // past the 3-day deadline
        escrow.refundExpired(dealId, 0);

        (, , , WasitEscrow.DealState ds, , ,) = escrow.getDeal(dealId);
        assertEq(uint256(ds), uint256(WasitEscrow.DealState.Closed));

        // DealNotFunded fires first (deal is Closed)
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId, WasitEscrow.DealState.Closed
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_CannotRunTwice() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);
        _warpPastArbitrationWindow();

        escrow.releaseStalled(dealId, 0); // first call succeeds — deal becomes Closed

        (, , , WasitEscrow.DealState ds, , ,) = escrow.getDeal(dealId);
        assertEq(uint256(ds), uint256(WasitEscrow.DealState.Closed));

        // Second call: DealNotFunded fires first (deal is already Closed)
        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId, WasitEscrow.DealState.Closed
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ResolveBeforeWindowBlocksReleaseStalled() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);

        // Arbiter resolves inside the arbitration window — 1-milestone deal becomes Closed
        vm.prank(arbiter);
        escrow.resolve(dealId, 0, 5_000); // 50/50

        // Now warp past the arbitration window — deal is Closed, DealNotFunded fires first
        _warpPastArbitrationWindow();

        (, , , WasitEscrow.DealState ds, , ,) = escrow.getDeal(dealId);
        assertEq(uint256(ds), uint256(WasitEscrow.DealState.Closed));

        vm.expectRevert(
            abi.encodeWithSelector(
                WasitEscrow.DealNotFunded.selector,
                dealId, WasitEscrow.DealState.Closed
            )
        );
        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_EmitsBothEvents() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);
        _warpPastArbitrationWindow();

        // Expect MilestoneStalledReleased
        vm.expectEmit(true, true, false, true);
        emit WasitEscrow.MilestoneStalledReleased(dealId, 0, uint128(M0));

        // Expect MilestoneReleased
        vm.expectEmit(true, true, false, true);
        emit WasitEscrow.MilestoneReleased(dealId, 0, uint128(M0));

        escrow.releaseStalled(dealId, 0);
    }

    function test_ReleaseStalled_DealClosesWhenAllTerminal() public {
        // 1-milestone deal: after releaseStalled, deal should be Closed
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);
        _warpPastArbitrationWindow();

        escrow.releaseStalled(dealId, 0);

        (, , , WasitEscrow.DealState ds, , ,) = escrow.getDeal(dealId);
        assertEq(uint256(ds), uint256(WasitEscrow.DealState.Closed), "deal should be Closed");
    }

    function test_ReleaseStalled_CallableByAnyone() public {
        uint256 dealId = _createAndFundSingle();
        _attestAndDispute(dealId, 0);
        _warpPastArbitrationWindow();

        // Called by a completely unrelated address — must succeed
        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        escrow.releaseStalled(dealId, 0);

        (, WasitEscrow.MilestoneState st, , ,) = escrow.getMilestone(dealId, 0);
        assertEq(uint256(st), uint256(WasitEscrow.MilestoneState.Released));
    }

    function test_ReleaseStalled_BlocklistedPayeeCredited() public {
        // Etch Arc-style reverting blocklist mock at USDC_ADDR
        MockUSDCRevertBlocklist blImpl = new MockUSDCRevertBlocklist();
        vm.etch(USDC_ADDR, address(blImpl).code);
        MockUSDCRevertBlocklist blUsdc = MockUSDCRevertBlocklist(USDC_ADDR);

        // Block the seller
        // Storage slot 6 = blocked address (matches struct layout: name=0, symbol=1,
        // decimals=2, totalSupply=3, balanceOf=4, allowance=5, blocked=6)
        vm.store(USDC_ADDR, bytes32(uint256(6)), bytes32(uint256(uint160(seller))));

        WasitEscrow freshEscrow = new WasitEscrow(feeRecipient, FEE_BPS);

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = M0;

        vm.prank(buyer);
        uint256 dealId = freshEscrow.createDeal(
            payees, inspector, arbiter, amounts,
            2 days,
            uint64(block.timestamp + 3 days)
        );

        blUsdc.mint(buyer, M0);
        vm.prank(buyer);
        blUsdc.approve(address(freshEscrow), M0);
        vm.prank(buyer);
        freshEscrow.fund(dealId);

        // attest + dispute
        vm.prank(inspector);
        freshEscrow.attest(dealId, 0, keccak256("ev"));
        vm.prank(buyer);
        freshEscrow.dispute(dealId, 0, "dispute");

        // warp past arbitration window
        skip(freshEscrow.ARBITRATION_WINDOW() + 1);

        // releaseStalled must succeed despite seller being blocklisted
        freshEscrow.releaseStalled(dealId, 0);

        // Seller transfer reverted → owed[seller] > 0
        assertGt(freshEscrow.owed(seller), 0, "seller should be credited to owed");

        // Forwarder and fee were NOT blocklisted — they should have been paid directly
        uint256 fwdBal = blUsdc.balanceOf(forwarder);
        uint256 feeBal = blUsdc.balanceOf(feeRecipient);
        assertGt(fwdBal, 0, "forwarder should have been paid");
        assertGt(feeBal, 0, "feeRecipient should have been paid");

        // Total: seller owed + forwarder paid + fee paid == M0
        assertEq(
            freshEscrow.owed(seller) + fwdBal + feeBal,
            M0,
            "total payout must equal M0"
        );

        // Solvency: escrow balance == seller's owed (only uncollected portion left)
        assertEq(
            blUsdc.balanceOf(address(freshEscrow)),
            freshEscrow.owed(seller),
            "escrow balance must equal uncollected seller owed"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz: releaseStalled always pays exactly the milestone amount
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_ReleaseStalled_SplitSumsToA(uint128 amount, uint16 sellerBps) public {
        amount    = uint128(bound(uint256(amount),    1,       1_000_000_000_000));
        sellerBps = uint16(bound(uint256(sellerBps),  1,       9899));
        uint16 fwdBps = 9900 - sellerBps; // + feeBps(100) == 10_000

        WasitEscrow freshEscrow = new WasitEscrow(feeRecipient, 100);

        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: sellerBps});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: fwdBps});

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        vm.prank(buyer);
        uint256 dealId = freshEscrow.createDeal(
            payees, inspector, arbiter, amounts,
            2 days,
            uint64(block.timestamp + 3 days)
        );

        usdc.mint(buyer, amount);
        vm.prank(buyer);
        usdc.approve(address(freshEscrow), amount);
        vm.prank(buyer);
        freshEscrow.fund(dealId);

        vm.prank(inspector);
        freshEscrow.attest(dealId, 0, keccak256("ev"));
        vm.prank(buyer);
        freshEscrow.dispute(dealId, 0, "dispute");

        skip(freshEscrow.ARBITRATION_WINDOW() + 1);

        uint256 sellerBefore  = usdc.balanceOf(seller);
        uint256 fwdBefore     = usdc.balanceOf(forwarder);
        uint256 feeBefore     = usdc.balanceOf(feeRecipient);

        freshEscrow.releaseStalled(dealId, 0);

        uint256 sellerGot  = (usdc.balanceOf(seller)       - sellerBefore)  + freshEscrow.owed(seller);
        uint256 fwdGot     = (usdc.balanceOf(forwarder)    - fwdBefore)     + freshEscrow.owed(forwarder);
        uint256 feeGot     = (usdc.balanceOf(feeRecipient) - feeBefore)     + freshEscrow.owed(feeRecipient);

        assertEq(sellerGot + fwdGot + feeGot, amount, "split must sum to A exactly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Unpacks only the scalar deal fields we need for checking.
    function _dealScalars(uint256 dealId)
        internal
        view
        returns (address dBuyer, uint64 cw, uint64 dl, uint128 total)
    {
        (dBuyer, , , , cw, dl, total) = escrow.getDeal(dealId);
    }
}
