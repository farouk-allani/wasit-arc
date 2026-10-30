// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WasitEscrowTestBase} from "./WasitEscrow.Base.t.sol";
import {WasitEscrow} from "../WasitEscrow.sol";

/// @dev createDeal validation-revert and happy-path tests.
contract WasitEscrowCreateDealTest is WasitEscrowTestBase {

    // ─────────────────────────────────────────────────────────────────────
    // Revert: payee count
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnZeroPayees() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](0);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidPayeeCount.selector, uint256(0), uint256(1), uint256(6))
        );
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    function test_CreateDeal_RevertOnSevenPayees() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](7);
        for (uint256 i = 0; i < 7; i++) {
            payees[i] = WasitEscrow.Payee({addr: makeAddr(string(abi.encode(i))), bps: 0});
        }
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidPayeeCount.selector, uint256(7), uint256(1), uint256(6))
        );
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: milestone count
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnZeroMilestones() public {
        uint256[] memory amounts = new uint256[](0);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidMilestoneCount.selector, uint256(0), uint256(1), uint256(5))
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days));
    }

    function test_CreateDeal_RevertOnSixMilestones() public {
        uint256[] memory amounts = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) amounts[i] = 1e6;
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidMilestoneCount.selector, uint256(6), uint256(1), uint256(5))
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: zero addresses
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnZeroAddressPayee0() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](1);
        payees[0] = WasitEscrow.Payee({addr: address(0), bps: 9900});
        vm.expectRevert(WasitEscrow.ZeroAddress.selector);
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    function test_CreateDeal_RevertOnZeroAddressPayee1() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,      bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: address(0),  bps: 1000});
        vm.expectRevert(WasitEscrow.ZeroAddress.selector);
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    function test_CreateDeal_RevertOnZeroInspector() public {
        vm.expectRevert(WasitEscrow.ZeroAddress.selector);
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), address(0), arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    function test_CreateDeal_RevertOnZeroArbiter() public {
        vm.expectRevert(WasitEscrow.ZeroAddress.selector);
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, address(0), _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: duplicate payee
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnDuplicatePayee() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller, bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: seller, bps: 1000}); // duplicate
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.DuplicatePayee.selector, seller)
        );
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: seller bps == 0
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnZeroSellerBps() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 0});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 9900});
        vm.expectRevert(WasitEscrow.SellerShareMustBePositive.selector);
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: bps sum incorrect
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnBpsSumTooLow() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8000}); // 8000+800+100=8900 != 10000
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 800});
        // actual totalBps = 8000 + 800 + 100 (feeBps) = 8900
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidBpsSum.selector, uint256(10_000), uint256(8900))
        );
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    function test_CreateDeal_RevertOnBpsSumTooHigh() public {
        WasitEscrow.Payee[] memory payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 9000}); // 9000+1000+100=10100 != 10000
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidBpsSum.selector, uint256(10_000), uint256(10_100))
        );
        vm.prank(buyer);
        escrow.createDeal(payees, inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: zero milestone amount
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnZeroMilestoneAmount() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 0; // index 0 is zero
        amounts[1] = 100_000_000;
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.MilestoneAmountMustBePositive.selector, uint256(0))
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: total amount overflow
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertOnTotalAmountOverflow() public {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = type(uint128).max;
        amounts[1] = 1; // would overflow uint128
        vm.expectRevert(WasitEscrow.TotalAmountOverflow.selector);
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, amounts, 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: invalid arbiter
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertArbiterIsBuyer() public {
        // arbiter == msg.sender (buyer)
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidArbiter.selector, buyer)
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, buyer, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    function test_CreateDeal_RevertArbiterIsSeller() public {
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidArbiter.selector, seller)
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, seller, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: invalid inspector
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertInspectorIsSeller() public {
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidInspector.selector, seller)
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), seller, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Revert: challenge window / deadline
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_RevertChallengeWindowTooLong() public {
        uint64 tooLong = uint64(7 days) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.ChallengeWindowTooLong.selector, tooLong, uint64(7 days))
        );
        vm.prank(buyer);
        escrow.createDeal(
            _defaultPayees(), inspector, arbiter, _defaultMilestones(),
            tooLong, uint64(block.timestamp + 8 days + 1)
        );
    }

    function test_CreateDeal_RevertDeadlineEqualsChallengeWindowPlusNow() public {
        // deadline == block.timestamp + challengeWindow → not strictly greater
        uint64 cw = uint64(2 days);
        uint64 deadline = uint64(block.timestamp + 2 days); // equals, not greater
        uint256 minimumExclusive = block.timestamp + uint256(cw);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidDeadline.selector, deadline, minimumExclusive)
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, _defaultMilestones(), cw, deadline);
    }

    function test_CreateDeal_RevertDeadlineLessThanChallengeWindow() public {
        uint64 cw = uint64(2 days);
        uint64 deadline = uint64(block.timestamp + 1 days); // less than now + 2 days
        uint256 minimumExclusive = block.timestamp + uint256(cw);
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidDeadline.selector, deadline, minimumExclusive)
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, _defaultMilestones(), cw, deadline);
    }

    function test_CreateDeal_RevertDeadlineEqualsNow_ZeroWindow() public {
        // challengeWindow = 0, deadline == block.timestamp → not strictly greater than timestamp+0
        uint64 cw = 0;
        uint64 deadline = uint64(block.timestamp);
        uint256 minimumExclusive = block.timestamp + 0;
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.InvalidDeadline.selector, deadline, minimumExclusive)
        );
        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, _defaultMilestones(), cw, deadline);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Happy path: valid deal stored exactly
    // ─────────────────────────────────────────────────────────────────────

    function test_CreateDeal_StoresDealCorrectly() public {
        uint64 cw = 2 days;
        uint64 dl = uint64(block.timestamp + 3 days);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, _defaultMilestones(), cw, dl
        );

        (
            address gotBuyer,
            address gotInspector,
            address gotArbiter,
            WasitEscrow.DealState gotState,
            uint64 gotCw,
            uint64 gotDl,
            uint128 gotTotal
        ) = escrow.getDeal(dealId);

        assertEq(gotBuyer,     buyer,                    "buyer");
        assertEq(gotInspector, inspector,                "inspector");
        assertEq(gotArbiter,   arbiter,                  "arbiter");
        assertEq(uint8(gotState), uint8(WasitEscrow.DealState.Created), "state");
        assertEq(gotCw,        cw,                       "challengeWindow");
        assertEq(gotDl,        dl,                       "deadline");
        assertEq(gotTotal,     TOTAL,                    "total");
    }

    function test_CreateDeal_StoresMilestonesCorrectly() public {
        uint256 dealId = _defaultCreateDeal();

        (uint128 a0, WasitEscrow.MilestoneState s0, , ,) = escrow.getMilestone(dealId, 0);
        (uint128 a1, WasitEscrow.MilestoneState s1, , ,) = escrow.getMilestone(dealId, 1);
        (uint128 a2, WasitEscrow.MilestoneState s2, , ,) = escrow.getMilestone(dealId, 2);

        assertEq(a0, uint128(M0));
        assertEq(a1, uint128(M1));
        assertEq(a2, uint128(M2));

        assertEq(uint8(s0), uint8(WasitEscrow.MilestoneState.Pending));
        assertEq(uint8(s1), uint8(WasitEscrow.MilestoneState.Pending));
        assertEq(uint8(s2), uint8(WasitEscrow.MilestoneState.Pending));
    }

    function test_CreateDeal_IncrementsNextDealId() public {
        assertEq(escrow.nextDealId(), 0);
        _defaultCreateDeal();
        assertEq(escrow.nextDealId(), 1);
        _defaultCreateDeal();
        assertEq(escrow.nextDealId(), 2);
    }

    function test_CreateDeal_EmitsDealCreatedEvent() public {
        uint64 cw = 2 days;
        uint64 dl = uint64(block.timestamp + 3 days);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WasitEscrow.DealCreated(0, buyer, inspector, arbiter, TOTAL, dl);

        vm.prank(buyer);
        escrow.createDeal(_defaultPayees(), inspector, arbiter, _defaultMilestones(), cw, dl);
    }

    function test_CreateDeal_ReturnsCorrectDealId() public {
        vm.prank(buyer);
        uint256 id0 = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days)
        );
        assertEq(id0, 0);

        vm.prank(buyer);
        uint256 id1 = escrow.createDeal(
            _defaultPayees(), inspector, arbiter, _defaultMilestones(), 2 days, uint64(block.timestamp + 3 days)
        );
        assertEq(id1, 1);
    }
}
