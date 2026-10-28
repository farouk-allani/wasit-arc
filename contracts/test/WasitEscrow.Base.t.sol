// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WasitEscrow} from "../WasitEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared fixture for all WasitEscrow test categories.
abstract contract WasitEscrowTestBase is Test {
    // ── Constants ──────────────────────────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint16 internal constant FEE_BPS = 100;

    // Milestone amounts (6-decimal USDC)
    uint256 internal constant M0 = 100_000_000; // 100 USDC
    uint256 internal constant M1 = 200_000_000; // 200 USDC
    uint256 internal constant M2 = 300_000_000; // 300 USDC
    uint128 internal constant TOTAL = 600_000_000; // 600 USDC

    // ── Actors ─────────────────────────────────────────────────────────────
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal buyer        = makeAddr("buyer");
    address internal seller       = makeAddr("seller");
    address internal inspector    = makeAddr("inspector");
    address internal arbiter      = makeAddr("arbiter");
    address internal forwarder    = makeAddr("forwarder");

    // ── Contracts under test ───────────────────────────────────────────────
    WasitEscrow internal escrow;
    MockERC20   internal usdc;

    // ── Setup ──────────────────────────────────────────────────────────────
    function setUp() public virtual {
        // 1. Deploy mock ERC-20 and etch it at the hardcoded USDC address.
        MockERC20 mockImpl = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mockImpl).code);
        usdc = MockERC20(USDC_ADDR);

        // 2. Deploy the escrow with valid params.
        escrow = new WasitEscrow(feeRecipient, FEE_BPS);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /// @dev Returns a valid 2-payee array: seller (8900 bps) + forwarder (1000 bps).
    /// With feeBps=100: 8900 + 1000 + 100 = 10_000.
    function _defaultPayees() internal view returns (WasitEscrow.Payee[] memory payees) {
        payees = new WasitEscrow.Payee[](2);
        payees[0] = WasitEscrow.Payee({addr: seller,    bps: 8900});
        payees[1] = WasitEscrow.Payee({addr: forwarder, bps: 1000});
    }

    /// @dev Returns [100e6, 200e6, 300e6].
    function _defaultMilestones() internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](3);
        amounts[0] = M0;
        amounts[1] = M1;
        amounts[2] = M2;
    }

    /// @dev Creates a valid deal as `buyer` and returns its dealId.
    function _defaultCreateDeal() internal returns (uint256 dealId) {
        vm.prank(buyer);
        dealId = escrow.createDeal(
            _defaultPayees(),
            inspector,
            arbiter,
            _defaultMilestones(),
            2 days,
            uint64(block.timestamp + 3 days)
        );
    }

    /// @dev Mints `TOTAL` USDC to buyer and approves escrow for the full amount.
    function _fundSetup() internal {
        usdc.mint(buyer, TOTAL);
        vm.prank(buyer);
        usdc.approve(address(escrow), TOTAL);
    }
}
