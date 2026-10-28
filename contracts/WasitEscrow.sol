// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WasitEscrow
/// @notice Milestone-based USDC escrow with fixed-fee split accounting.
contract WasitEscrow is ReentrancyGuard {
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    using SafeERC20 for IERC20;

    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint16 private constant MAX_FEE_BPS = 200;
    uint8 private constant MAX_PAYEES = 6;
    uint8 private constant MAX_MILESTONES = 5;
    uint64 private constant MAX_CHALLENGE_WINDOW = 7 days;

    struct Payee {
        address addr;
        uint16 bps;
    }

    struct Milestone {
        uint128 amount;
        MilestoneState state;
    }

    enum MilestoneState {
        Pending,
        Attested,
        Approved,
        Released,
        Disputed,
        Resolved,
        Refunded
    }

    enum DealState {
        Created,
        Funded,
        Closed
    }

    struct Deal {
        address buyer;
        address inspector;
        address arbiter;
        DealState state;
        uint64 challengeWindow;
        uint64 deadline;
        Payee[] payees;
        Milestone[] milestones;
        uint128 total;
    }

    error FeeBpsTooHigh(uint16 feeBps, uint16 maxFeeBps);
    error InvalidPayeeCount(uint256 length, uint256 min, uint256 max);
    error InvalidMilestoneCount(uint256 length, uint256 min, uint256 max);
    error ZeroAddress();
    error DuplicatePayee(address payee);
    error SellerShareMustBePositive();
    error InvalidBpsSum(uint256 expected, uint256 actual);
    error MilestoneAmountMustBePositive(uint256 index);
    error TotalAmountOverflow();
    error InvalidArbiter(address arbiter);
    error InvalidInspector(address inspector);
    error ChallengeWindowTooLong(uint64 provided, uint64 maxAllowed);
    error InvalidDeadline(uint64 deadline, uint256 minimumExclusive);
    error DealNotFound(uint256 dealId);
    error UnauthorizedCaller(address caller, address expected);
    error InvalidDealState(uint256 dealId, DealState current, DealState expected);

    event DealCreated(
        uint256 indexed dealId,
        address indexed buyer,
        address inspector,
        address arbiter,
        uint128 total,
        uint64 deadline
    );

    event DealFunded(uint256 indexed dealId, address indexed buyer, uint128 total);

    address public immutable feeRecipient;
    uint16 public immutable feeBps;

    uint256 public nextDealId;
    mapping(uint256 => Deal) private _deals;

    /// @notice Initializes immutable fee configuration for escrow deals.
    /// @param feeRecipient_ Recipient address for protocol fees.
    /// @param feeBps_ Protocol fee in basis points, capped at 200.
    constructor(address feeRecipient_, uint16 feeBps_) {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeBpsTooHigh(feeBps_, MAX_FEE_BPS);

        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    /// @notice Creates a new deal with payee splits and milestones.
    /// @param payees Payee list where index 0 is the seller.
    /// @param inspector Inspector address for attestations.
    /// @param arbiter Arbiter address for dispute resolution.
    /// @param milestoneAmounts Milestone amounts in 6-decimal USDC units.
    /// @param challengeWindow Challenge window in seconds, up to 7 days.
    /// @param deadline Unix timestamp strictly greater than block.timestamp + challengeWindow.
    /// @return dealId Newly created deal identifier.
    function createDeal(
        Payee[] calldata payees,
        address inspector,
        address arbiter,
        uint256[] calldata milestoneAmounts,
        uint64 challengeWindow,
        uint64 deadline
    ) external returns (uint256 dealId) {
        uint256 payeeLength = payees.length;
        if (payeeLength == 0 || payeeLength > MAX_PAYEES) {
            revert InvalidPayeeCount(payeeLength, 1, MAX_PAYEES);
        }

        uint256 milestoneLength = milestoneAmounts.length;
        if (milestoneLength == 0 || milestoneLength > MAX_MILESTONES) {
            revert InvalidMilestoneCount(milestoneLength, 1, MAX_MILESTONES);
        }

        if (inspector == address(0) || arbiter == address(0)) revert ZeroAddress();

        for (uint256 i; i < payeeLength; ++i) {
            address payeeAddr = payees[i].addr;
            if (payeeAddr == address(0)) revert ZeroAddress();

            for (uint256 j = i + 1; j < payeeLength; ++j) {
                if (payeeAddr == payees[j].addr) revert DuplicatePayee(payeeAddr);
            }
        }

        if (payees[0].bps == 0) revert SellerShareMustBePositive();

        _validateBps(payees);

        address seller = payees[0].addr;
        if (arbiter == msg.sender || arbiter == seller) revert InvalidArbiter(arbiter);
        if (inspector == seller) revert InvalidInspector(inspector);

        if (challengeWindow > MAX_CHALLENGE_WINDOW) {
            revert ChallengeWindowTooLong(challengeWindow, MAX_CHALLENGE_WINDOW);
        }

        uint256 minimumExclusive = block.timestamp + uint256(challengeWindow);
        if (uint256(deadline) <= minimumExclusive) {
            revert InvalidDeadline(deadline, minimumExclusive);
        }

        uint128 total = 0;
        for (uint256 i; i < milestoneLength; ++i) {
            uint256 amount = milestoneAmounts[i];
            if (amount == 0) revert MilestoneAmountMustBePositive(i);

            if (amount > type(uint128).max - total) revert TotalAmountOverflow();
            total += uint128(amount);
        }

        dealId = nextDealId;
        Deal storage deal = _deals[dealId];

        deal.buyer = msg.sender;
        deal.inspector = inspector;
        deal.arbiter = arbiter;
        deal.state = DealState.Created;
        deal.challengeWindow = challengeWindow;
        deal.deadline = deadline;
        deal.total = total;

        for (uint256 i; i < payeeLength; ++i) {
            deal.payees.push(Payee({addr: payees[i].addr, bps: payees[i].bps}));
        }

        for (uint256 i; i < milestoneLength; ++i) {
            deal.milestones.push(Milestone({amount: uint128(milestoneAmounts[i]), state: MilestoneState.Pending}));
        }

        nextDealId = dealId + 1;

        emit DealCreated(dealId, msg.sender, inspector, arbiter, total, deadline);
    }

    /// @notice Funds a created deal by transferring total USDC from the buyer.
    /// @param dealId Identifier of the deal to fund.
    function fund(uint256 dealId) external nonReentrant {
        _requireExistingDeal(dealId);

        Deal storage deal = _deals[dealId];
        if (msg.sender != deal.buyer) revert UnauthorizedCaller(msg.sender, deal.buyer);
        if (deal.state != DealState.Created) {
            revert InvalidDealState(dealId, deal.state, DealState.Created);
        }

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), deal.total);
        deal.state = DealState.Funded;

        emit DealFunded(dealId, msg.sender, deal.total);
    }

    /// @notice Returns scalar metadata for a deal.
    /// @param dealId Identifier of the deal.
    /// @return buyer Deal buyer.
    /// @return inspector Deal inspector.
    /// @return arbiter Deal arbiter.
    /// @return state Current deal state.
    /// @return challengeWindow Challenge window in seconds.
    /// @return deadline Deal deadline timestamp.
    /// @return total Total escrowed USDC amount.
    function getDeal(uint256 dealId)
        external
        view
        returns (
            address buyer,
            address inspector,
            address arbiter,
            DealState state,
            uint64 challengeWindow,
            uint64 deadline,
            uint128 total
        )
    {
        _requireExistingDeal(dealId);

        Deal storage deal = _deals[dealId];
        return (
            deal.buyer,
            deal.inspector,
            deal.arbiter,
            deal.state,
            deal.challengeWindow,
            deal.deadline,
            deal.total
        );
    }

    /// @notice Returns a milestone's amount and state.
    /// @param dealId Identifier of the deal.
    /// @param i Milestone index.
    /// @return amount Milestone amount in 6-decimal USDC units.
    /// @return state Current milestone state.
    function getMilestone(uint256 dealId, uint256 i)
        external
        view
        returns (uint128 amount, MilestoneState state)
    {
        _requireExistingDeal(dealId);

        Milestone storage milestone = _deals[dealId].milestones[i];
        return (milestone.amount, milestone.state);
    }

    /// @notice Validates that payee basis points plus fee basis points equal 10_000.
    /// @param payees Payee split configuration.
    function _validateBps(Payee[] calldata payees) internal view {
        uint256 sum = 0;
        uint256 length = payees.length;
        for (uint256 i; i < length; ++i) {
            sum += payees[i].bps;
        }

        uint256 totalBps = sum + feeBps;
        if (totalBps != BPS_DENOMINATOR) {
            revert InvalidBpsSum(BPS_DENOMINATOR, totalBps);
        }
    }

    /// @notice Reverts when dealId has not been created.
    /// @param dealId Identifier to validate.
    function _requireExistingDeal(uint256 dealId) internal view {
        if (dealId >= nextDealId) revert DealNotFound(dealId);
    }
}
