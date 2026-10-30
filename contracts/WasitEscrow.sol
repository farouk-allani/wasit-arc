// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WasitEscrow
/// @notice Milestone-based USDC escrow with fixed-fee split accounting.
/// @dev CUSTODY RISK: This contract holds USDC on behalf of all active deals in a single
///      address. If the USDC issuer (Circle) were to blocklist this contract address, all
///      outbound transfers — including `release`, `resolve`, `refundExpired`, and `withdraw`
///      — would fail for every deal simultaneously. The individual-payee send-or-credit
///      fallback (`_owed`) does NOT protect against a whole-contract freeze because
///      `withdraw()` itself requires a successful transfer from the frozen address. This
///      is an inherent limitation of shared-custody stablecoin escrow; operators and users
///      should be aware of this centralised-stablecoin risk before using the contract in
///      production.
contract WasitEscrow is ReentrancyGuard {
    /// @dev Arc-specific USDC address (0x3600…). This contract is Arc-only; do not
    ///      deploy on other chains without updating this constant.
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    using SafeERC20 for IERC20;

    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint16 private constant MAX_FEE_BPS = 200;
    uint8 private constant MAX_PAYEES = 6;
    uint8 private constant MAX_MILESTONES = 5;
    uint64 private constant MAX_CHALLENGE_WINDOW = 7 days;
    /// @notice After this window elapses from disputedAt, anyone may call releaseStalled().
    uint64 public constant ARBITRATION_WINDOW = 14 days;

    struct Payee {
        address addr;
        uint16 bps;
    }

    struct Milestone {
        uint128 amount;
        MilestoneState state;
        uint64 attestedAt;
        uint64 disputedAt;
        bool buyerApproved;
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
    error MilestoneNotPending(uint256 dealId, uint256 i, MilestoneState current);
    error MilestoneNotReleasable(uint256 dealId, uint256 i, MilestoneState current);
    error ChallengeWindowNotExpired(uint256 dealId, uint256 i, uint256 unlocksAt, uint256 now_);
    error DealNotFunded(uint256 dealId, DealState current);
    error NothingToWithdraw(address caller);
    error MilestoneNotDisputed(uint256 dealId, uint256 i, MilestoneState current);
    error MilestoneNotAttested(uint256 dealId, uint256 i, MilestoneState current);
    error ChallengeWindowExpired(uint256 dealId, uint256 i, uint256 expiredAt, uint256 now_);
    error SellerShareBpsTooHigh(uint16 provided, uint16 max);
    error DeadlineNotPassed(uint256 dealId, uint256 deadline, uint256 now_);
    error MilestoneNotPendingForRefund(uint256 dealId, uint256 i, MilestoneState current);
    error ArbiterIsPayee(address arbiter);
    error ArbiterWindowNotExpired(uint256 dealId, uint256 i, uint256 unlocksAt, uint256 now_);
    error MilestoneNotStalledDisputed(uint256 dealId, uint256 i, MilestoneState current);
    /// @notice Thrown by attest() when block.timestamp >= deal.deadline.
    /// @dev An inspector who is also a payee receives their share on release but nothing on
    ///      refundExpired, giving them an incentive to attest after the deadline and destroy
    ///      the buyer's right to a clean refund. The guard prevents this.
    error AttestAfterDeadline(uint256 dealId, uint64 deadline, uint256 now_);

    event DealCreated(
        uint256 indexed dealId,
        address indexed buyer,
        address inspector,
        address arbiter,
        uint128 total,
        uint64 deadline
    );

    event DealFunded(uint256 indexed dealId, address indexed buyer, uint128 total);
    event MilestoneAttested(uint256 indexed dealId, uint256 indexed i, bytes32 evidenceHash, uint64 attestedAt);
    event MilestoneApproved(uint256 indexed dealId, uint256 indexed i, address buyer);
    event MilestoneReleased(uint256 indexed dealId, uint256 indexed i, uint128 amount);
    event PayeePaid(uint256 indexed dealId, uint256 indexed i, address indexed to, uint128 amount);
    event PayoutCredited(uint256 indexed dealId, uint256 indexed i, address indexed to, uint128 amount);
    event Withdrawn(address indexed to, uint128 amount);
    event MilestoneDisputed(uint256 indexed dealId, uint256 indexed i, address buyer, string reason);
    event MilestoneResolved(uint256 indexed dealId, uint256 indexed i, uint128 sellerAmount, uint128 buyerRefund);
    event MilestoneRefunded(uint256 indexed dealId, uint256 indexed i, address buyer, uint128 amount);
    /// @notice Emitted by releaseStalled() when a disputed milestone is settled via the
    ///         arbitration timeout rather than by the arbiter calling resolve().
    event MilestoneStalledReleased(uint256 indexed dealId, uint256 indexed i, uint128 amount);

    address public immutable feeRecipient;
    uint16 public immutable feeBps;

    uint256 public nextDealId;
    mapping(uint256 => Deal) private _deals;

    /// @notice Accumulated USDC owed to each address from failed payout attempts.
    mapping(address => uint128) private _owed;

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

        // Arbiter must not hold any share of the split (financial stake corrupts impartiality).
        for (uint256 i; i < payeeLength; ++i) {
            if (payees[i].addr == arbiter) revert ArbiterIsPayee(arbiter);
        }

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
            deal.milestones.push(
                Milestone({
                    amount: uint128(milestoneAmounts[i]),
                    state: MilestoneState.Pending,
                    attestedAt: 0,
                    disputedAt: 0,
                    buyerApproved: false
                })
            );
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

        deal.state = DealState.Funded;
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), deal.total);

        emit DealFunded(dealId, msg.sender, deal.total);
    }

    /// @notice Inspector attests that milestone i is complete.
    /// @dev Attestation is blocked once block.timestamp >= deal.deadline. An inspector who
    ///      is also a payee is paid when a milestone releases but not when it refunds, so
    ///      without this guard they could attest after the deadline and destroy the buyer's
    ///      refundExpired right. The guard ensures the deadline is a hard cut-off: if work
    ///      was not attested in time, the buyer can recover via refundExpired.
    /// @param dealId Deal identifier.
    /// @param i Milestone index.
    /// @param evidenceHash Keccak256 hash of off-chain evidence documents.
    function attest(uint256 dealId, uint256 i, bytes32 evidenceHash) external nonReentrant {
        _requireExistingDeal(dealId);
        Deal storage deal = _deals[dealId];

        if (deal.state != DealState.Funded) revert DealNotFunded(dealId, deal.state);
        if (msg.sender != deal.inspector) revert UnauthorizedCaller(msg.sender, deal.inspector);

        // Deadline guard: block attestation once the deal deadline has passed.
        if (block.timestamp >= uint256(deal.deadline)) {
            revert AttestAfterDeadline(dealId, deal.deadline, block.timestamp);
        }

        Milestone storage m = deal.milestones[i];
        if (m.state != MilestoneState.Pending) revert MilestoneNotPending(dealId, i, m.state);

        // effects
        m.state = MilestoneState.Attested;
        m.attestedAt = uint64(block.timestamp);

        emit MilestoneAttested(dealId, i, evidenceHash, m.attestedAt);
    }

    /// @notice Buyer approves milestone i for immediate release, skipping the challenge window.
    /// @dev Works on both Pending and Attested milestones. Intentionally has NO deadline
    ///      guard: an honest buyer must be able to approve a Pending milestone after the
    ///      deadline if they choose to pay a late seller. This asymmetry is deliberate —
    ///      attest() is blocked after the deadline to protect the buyer from a self-interested
    ///      inspector-payee, but approve() is the buyer's own voluntary choice and must
    ///      remain available.
    /// @param dealId Deal identifier.
    /// @param i Milestone index.
    function approve(uint256 dealId, uint256 i) external nonReentrant {
        _requireExistingDeal(dealId);
        Deal storage deal = _deals[dealId];

        if (deal.state != DealState.Funded) revert DealNotFunded(dealId, deal.state);
        if (msg.sender != deal.buyer) revert UnauthorizedCaller(msg.sender, deal.buyer);

        Milestone storage m = deal.milestones[i];
        if (m.state != MilestoneState.Pending && m.state != MilestoneState.Attested) {
            revert MilestoneNotPending(dealId, i, m.state);
        }

        // effects
        m.state = MilestoneState.Approved;
        m.buyerApproved = true;

        emit MilestoneApproved(dealId, i, msg.sender);
    }

    /// @notice Buyer disputes milestone i while it is Attested and inside the challenge window.
    /// @dev Once disputed, release() is blocked until the arbiter resolves it.
    /// @param dealId Deal identifier.
    /// @param i Milestone index.
    /// @param reason Human-readable dispute reason, stored in the event log only.
    function dispute(uint256 dealId, uint256 i, string calldata reason) external nonReentrant {
        _requireExistingDeal(dealId);
        Deal storage deal = _deals[dealId];

        if (deal.state != DealState.Funded) revert DealNotFunded(dealId, deal.state);
        if (msg.sender != deal.buyer) revert UnauthorizedCaller(msg.sender, deal.buyer);

        Milestone storage m = deal.milestones[i];
        if (m.state != MilestoneState.Attested) revert MilestoneNotAttested(dealId, i, m.state);

        // Must still be inside the challenge window
        uint256 windowEnds = uint256(m.attestedAt) + uint256(deal.challengeWindow);
        if (block.timestamp >= windowEnds) {
            revert ChallengeWindowExpired(dealId, i, windowEnds, block.timestamp);
        }

        // effects
        m.state = MilestoneState.Disputed;
        m.disputedAt = uint64(block.timestamp);

        emit MilestoneDisputed(dealId, i, msg.sender, reason);
    }

    /// @notice Arbiter resolves a disputed milestone by splitting it between seller and buyer.
    /// @dev sellerShare = A * sellerShareBps / 10_000 goes through the normal payee split
    ///      (fee and payees j>=1 scaled to sellerShare, seller gets remainder so dust stays
    ///      with the seller). buyerRefund = A - sellerShare goes directly to the buyer via
    ///      send-or-credit. Both sides use the same low-level fallback as release().
    /// @param dealId Deal identifier.
    /// @param i Milestone index.
    /// @param sellerShareBps Seller's share in basis points (0..10_000 inclusive).
    function resolve(uint256 dealId, uint256 i, uint16 sellerShareBps) external nonReentrant {
        _requireExistingDeal(dealId);
        Deal storage deal = _deals[dealId];

        if (deal.state != DealState.Funded) revert DealNotFunded(dealId, deal.state);
        if (msg.sender != deal.arbiter) revert UnauthorizedCaller(msg.sender, deal.arbiter);

        Milestone storage m = deal.milestones[i];
        if (m.state != MilestoneState.Disputed) revert MilestoneNotDisputed(dealId, i, m.state);

        if (sellerShareBps > BPS_DENOMINATOR) revert SellerShareBpsTooHigh(sellerShareBps, BPS_DENOMINATOR);

        uint128 A = m.amount;
        uint128 sellerAmount = uint128(uint256(A) * sellerShareBps / BPS_DENOMINATOR);
        uint128 buyerRefund = A - sellerAmount;

        // effects — mark Resolved before any external calls (CEI)
        m.state = MilestoneState.Resolved;
        emit MilestoneResolved(dealId, i, sellerAmount, buyerRefund);
        _tryCloseDeal(deal);

        // interactions
        if (sellerAmount > 0) {
            _resolvePayeePayout(dealId, i, deal, sellerAmount);
        }
        if (buyerRefund > 0) {
            _sendOrCredit(dealId, i, deal.buyer, buyerRefund);
        }
    }

    /// @notice Releases milestone i. Callable by anyone once:
    ///   - the milestone is Attested AND block.timestamp >= attestedAt + challengeWindow, OR
    ///   - the buyer has approved it (state == Approved).
    /// @dev Uses low-level USDC.transfer for each payout so a single blocklisted
    ///      recipient cannot revert the entire release. Failed payouts are credited
    ///      to _owed[recipient] and emitted as PayoutCredited.
    /// @param dealId Deal identifier.
    /// @param i Milestone index.
    function release(uint256 dealId, uint256 i) external nonReentrant {
        _requireExistingDeal(dealId);
        Deal storage deal = _deals[dealId];

        if (deal.state != DealState.Funded) revert DealNotFunded(dealId, deal.state);

        Milestone storage m = deal.milestones[i];

        // Determine releasability
        bool releasable = false;
        if (m.state == MilestoneState.Approved) {
            releasable = true;
        } else if (m.state == MilestoneState.Attested) {
            uint256 unlocksAt = uint256(m.attestedAt) + uint256(deal.challengeWindow);
            if (block.timestamp >= unlocksAt) {
                releasable = true;
            } else {
                revert ChallengeWindowNotExpired(dealId, i, unlocksAt, block.timestamp);
            }
        } else {
            revert MilestoneNotReleasable(dealId, i, m.state);
        }

        if (!releasable) revert MilestoneNotReleasable(dealId, i, m.state);

        uint128 A = m.amount;

        // effects — mark Released before any external calls (CEI)
        m.state = MilestoneState.Released;

        emit MilestoneReleased(dealId, i, A);
        _tryCloseDeal(deal);

        // interactions — _payout handles individual transfer failures gracefully
        _releasePayout(dealId, i, deal, A);
    }

    /// @notice Refunds a Pending milestone to the buyer once the deal deadline has passed.
    /// @dev Callable by anyone. Only applies to milestones that were never attested.
    /// @param dealId Deal identifier.
    /// @param i Milestone index.
    function refundExpired(uint256 dealId, uint256 i) external nonReentrant {
        _requireExistingDeal(dealId);
        Deal storage deal = _deals[dealId];

        if (deal.state != DealState.Funded) revert DealNotFunded(dealId, deal.state);

        if (block.timestamp < uint256(deal.deadline)) {
            revert DeadlineNotPassed(dealId, deal.deadline, block.timestamp);
        }

        Milestone storage m = deal.milestones[i];
        if (m.state != MilestoneState.Pending) {
            revert MilestoneNotPendingForRefund(dealId, i, m.state);
        }

        uint128 A = m.amount;

        // effects — mark Refunded before any external calls (CEI)
        m.state = MilestoneState.Refunded;
        emit MilestoneRefunded(dealId, i, deal.buyer, A);
        _tryCloseDeal(deal);

        // interaction — refund to buyer via send-or-credit fallback
        _sendOrCredit(dealId, i, deal.buyer, A);
    }

    /// @notice Settles a Disputed milestone via the attested-outcome default once the
    ///         arbitration window has elapsed without the arbiter calling resolve().
    /// @dev Settles using the SAME payee split as release() — the inspector had already
    ///      attested the work before the buyer raised the dispute, so the attested outcome
    ///      is the correct default. Defaulting to a buyer refund instead would let a buyer
    ///      dispute everything, wait for a silent arbiter, and claw back delivered goods.
    ///      The arbiter resolving normally always takes priority: once Resolved, this
    ///      function reverts. Milestone is marked Released (not a new terminal state),
    ///      satisfying the at-most-once rule alongside release(), resolve() and
    ///      refundExpired().
    /// @param dealId Deal identifier.
    /// @param i Milestone index.
    function releaseStalled(uint256 dealId, uint256 i) external nonReentrant {
        _requireExistingDeal(dealId);
        Deal storage deal = _deals[dealId];

        if (deal.state != DealState.Funded) revert DealNotFunded(dealId, deal.state);

        Milestone storage m = deal.milestones[i];
        if (m.state != MilestoneState.Disputed) {
            revert MilestoneNotStalledDisputed(dealId, i, m.state);
        }

        uint256 unlocksAt = uint256(m.disputedAt) + uint256(ARBITRATION_WINDOW);
        if (block.timestamp < unlocksAt) {
            revert ArbiterWindowNotExpired(dealId, i, unlocksAt, block.timestamp);
        }

        uint128 A = m.amount;

        // effects — CEI: mark Released before any external calls
        m.state = MilestoneState.Released;

        emit MilestoneStalledReleased(dealId, i, A);
        emit MilestoneReleased(dealId, i, A);
        _tryCloseDeal(deal);

        // interactions — same split as release(); send-or-credit fallback preserves solvency
        _releasePayout(dealId, i, deal, A);
    }

    /// @dev Computes and dispatches the split for a released milestone.
    ///      Uses low-level calls so a single failed transfer never reverts the release.
    /// @param dealId Deal identifier (for event indexing only).
    /// @param milestoneIdx Milestone index (for event indexing only).
    /// @param deal Storage pointer to the deal.
    /// @param A Total milestone amount to distribute.
    function _releasePayout(
        uint256 dealId,
        uint256 milestoneIdx,
        Deal storage deal,
        uint128 A
    ) internal {
        uint256 payeeLen = deal.payees.length;

        // fee and non-seller payees
        uint128 distributed = 0;

        // platform fee
        {
            uint128 fee = uint128(uint256(A) * feeBps / BPS_DENOMINATOR);
            _sendOrCredit(dealId, milestoneIdx, feeRecipient, fee);
            distributed += fee;
        }

        // payees j >= 1
        for (uint256 j = 1; j < payeeLen; ++j) {
            uint128 share = uint128(uint256(A) * deal.payees[j].bps / BPS_DENOMINATOR);
            _sendOrCredit(dealId, milestoneIdx, deal.payees[j].addr, share);
            distributed += share;
        }

        // seller (payee 0) gets remainder — all rounding dust goes here
        uint128 sellerShare = A - distributed;
        _sendOrCredit(dealId, milestoneIdx, deal.payees[0].addr, sellerShare);
    }

    /// @dev Distributes sellerAmount through the normal payee split (fee + payees j>=1
    ///      scaled to sellerAmount, seller gets remainder so dust goes to seller).
    ///      Used by resolve() for the seller's portion of a disputed milestone.
    /// @param dealId Deal identifier (for event indexing).
    /// @param milestoneIdx Milestone index (for event indexing).
    /// @param deal Storage pointer to the deal.
    /// @param sellerAmount Amount to distribute through the payee split.
    function _resolvePayeePayout(
        uint256 dealId,
        uint256 milestoneIdx,
        Deal storage deal,
        uint128 sellerAmount
    ) internal {
        uint256 payeeLen = deal.payees.length;
        uint128 distributed = 0;

        // platform fee on sellerAmount
        {
            uint128 fee = uint128(uint256(sellerAmount) * feeBps / BPS_DENOMINATOR);
            _sendOrCredit(dealId, milestoneIdx, feeRecipient, fee);
            distributed += fee;
        }

        // payees j >= 1
        for (uint256 j = 1; j < payeeLen; ++j) {
            uint128 share = uint128(uint256(sellerAmount) * deal.payees[j].bps / BPS_DENOMINATOR);
            _sendOrCredit(dealId, milestoneIdx, deal.payees[j].addr, share);
            distributed += share;
        }

        // seller gets remainder — dust stays with seller
        uint128 sellerNet = sellerAmount - distributed;
        _sendOrCredit(dealId, milestoneIdx, deal.payees[0].addr, sellerNet);
    }

    /// @dev Attempts a low-level USDC.transfer to `to`. On failure, credits _owed[to].
    /// @param dealId Deal identifier (for events).
    /// @param milestoneIdx Milestone index (for events).
    /// @param to Recipient address.
    /// @param amount Amount in 6-decimal USDC units.
    function _sendOrCredit(
        uint256 dealId,
        uint256 milestoneIdx,
        address to,
        uint128 amount
    ) internal {
        if (amount == 0) return;

        // Guard: a zero-code address returns (true, "") from any .call, which would be
        // misread as success. Fail fast when USDC has no deployed code.
        if (USDC.code.length == 0) {
            _owed[to] += amount;
            emit PayoutCredited(dealId, milestoneIdx, to, amount);
            return;
        }

        // low-level call: encode transfer(address,uint256)
        (bool ok, bytes memory data) = USDC.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, uint256(amount))
        );

        // success: ok == true AND (no return data OR return data decodes to true)
        bool success = ok && (data.length == 0 || (data.length == 32 && abi.decode(data, (bool))));

        if (success) {
            emit PayeePaid(dealId, milestoneIdx, to, amount);
        } else {
            _owed[to] += amount;
            emit PayoutCredited(dealId, milestoneIdx, to, amount);
        }
    }

    /// @notice Pulls any USDC credited to msg.sender from failed payout attempts.
    function withdraw() external nonReentrant {
        uint128 amount = _owed[msg.sender];
        if (amount == 0) revert NothingToWithdraw(msg.sender);

        // effects first
        _owed[msg.sender] = 0;

        // interaction — use SafeERC20 here because this is an explicit pull; revert is correct
        IERC20(USDC).safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Returns the amount of USDC credited but not yet withdrawn by `account`.
    /// @param account Address to query.
    /// @return Amount in 6-decimal USDC units.
    function owed(address account) external view returns (uint128) {
        return _owed[account];
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

    /// @notice Returns a milestone's full state including timestamps.
    /// @param dealId Identifier of the deal.
    /// @param i Milestone index.
    /// @return amount      Milestone amount in 6-decimal USDC units.
    /// @return state       Current milestone state.
    /// @return attestedAt  Unix timestamp when the inspector attested; 0 if not yet attested.
    /// @return disputedAt  Unix timestamp when the buyer disputed; 0 if not yet disputed.
    /// @return buyerApproved True if the buyer called approve() on this milestone.
    function getMilestone(uint256 dealId, uint256 i)
        external
        view
        returns (
            uint128 amount,
            MilestoneState state,
            uint64 attestedAt,
            uint64 disputedAt,
            bool buyerApproved
        )
    {
        _requireExistingDeal(dealId);

        Milestone storage milestone = _deals[dealId].milestones[i];
        return (
            milestone.amount,
            milestone.state,
            milestone.attestedAt,
            milestone.disputedAt,
            milestone.buyerApproved
        );
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

    /// @notice Closes the deal if every milestone has reached a terminal state.
    /// @dev Terminal states: Released, Resolved, Refunded.
    ///      Called after any milestone state transition.
    /// @param deal Storage pointer to the deal.
    function _tryCloseDeal(Deal storage deal) internal {
        uint256 len = deal.milestones.length;
        for (uint256 k = 0; k < len; ++k) {
            MilestoneState ms = deal.milestones[k].state;
            // terminal states (will grow with future turns)
            if (
                ms != MilestoneState.Released &&
                ms != MilestoneState.Resolved &&
                ms != MilestoneState.Refunded
            ) {
                return; // at least one milestone is not yet terminal
            }
        }
        deal.state = DealState.Closed;
    }
}
