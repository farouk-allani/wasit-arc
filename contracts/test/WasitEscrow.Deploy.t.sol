// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {WasitEscrowTestBase} from "./WasitEscrow.Base.t.sol";
import {WasitEscrow} from "../WasitEscrow.sol";

/// @dev Constructor / deployment tests.
contract WasitEscrowDeployTest is WasitEscrowTestBase {

    // ── Revert: zero feeRecipient ──────────────────────────────────────────

    function test_Constructor_RevertsOnZeroFeeRecipient() public {
        vm.expectRevert(WasitEscrow.ZeroAddress.selector);
        new WasitEscrow(address(0), 100);
    }

    // ── Revert: feeBps > 200 ──────────────────────────────────────────────

    function test_Constructor_RevertsFeeBpsTooHigh() public {
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.FeeBpsTooHigh.selector, uint16(201), uint16(200))
        );
        new WasitEscrow(feeRecipient, 201);
    }

    function test_Constructor_RevertsFeeBpsTooHigh_MaxPlusOne() public {
        vm.expectRevert(
            abi.encodeWithSelector(WasitEscrow.FeeBpsTooHigh.selector, uint16(65535), uint16(200))
        );
        new WasitEscrow(feeRecipient, type(uint16).max);
    }

    // ── Happy path: immutable state stored correctly ───────────────────────

    function test_Constructor_StoresFeeRecipient() public view {
        assertEq(escrow.feeRecipient(), feeRecipient);
    }

    function test_Constructor_StoresFeeBps() public view {
        assertEq(escrow.feeBps(), FEE_BPS);
    }

    function test_Constructor_AcceptsFeeBpsOfZero() public {
        WasitEscrow e = new WasitEscrow(feeRecipient, 0);
        assertEq(e.feeBps(), 0);
    }

    function test_Constructor_AcceptsMaxFeeBps() public {
        WasitEscrow e = new WasitEscrow(feeRecipient, 200);
        assertEq(e.feeBps(), 200);
    }

    function test_Constructor_NextDealIdStartsAtZero() public view {
        assertEq(escrow.nextDealId(), 0);
    }
}
