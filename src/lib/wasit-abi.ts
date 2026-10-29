/**
 * WasitEscrow ABI — extracted from the Foundry artifact.
 * Only the fragments used by the frontend are included; the full
 * artifact lives at contracts/out/WasitEscrow.sol/WasitEscrow.json.
 */
export const WASIT_ESCROW_ABI = [
  // ── Read ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'feeBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feeRecipient',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextDealId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDeal',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [
      { name: 'buyer', type: 'address' },
      { name: 'inspector', type: 'address' },
      { name: 'arbiter', type: 'address' },
      { name: 'state', type: 'uint8' },
      { name: 'challengeWindow', type: 'uint64' },
      { name: 'deadline', type: 'uint64' },
      { name: 'total', type: 'uint128' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getMilestone',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
    ],
    outputs: [
      { name: 'amount', type: 'uint128' },
      { name: 'state', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owed',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
  },
  // ── Write ─────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'createDeal',
    inputs: [
      {
        name: 'payees',
        type: 'tuple[]',
        components: [
          { name: 'addr', type: 'address' },
          { name: 'bps', type: 'uint16' },
        ],
      },
      { name: 'inspector', type: 'address' },
      { name: 'arbiter', type: 'address' },
      { name: 'milestoneAmounts', type: 'uint256[]' },
      { name: 'challengeWindow', type: 'uint64' },
      { name: 'deadline', type: 'uint64' },
    ],
    outputs: [{ name: 'dealId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'fund',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'attest',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'release',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'dispute',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resolve',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
      { name: 'sellerShareBps', type: 'uint16' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'refundExpired',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'releaseStalled',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'i', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ARBITRATION_WINDOW',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'DealCreated',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'inspector', type: 'address', indexed: false },
      { name: 'arbiter', type: 'address', indexed: false },
      { name: 'total', type: 'uint128', indexed: false },
      { name: 'deadline', type: 'uint64', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PayeePaid',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'i', type: 'uint256', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PayoutCredited',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'i', type: 'uint256', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MilestoneRefunded',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'i', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: false },
      { name: 'amount', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MilestoneAttested',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'i', type: 'uint256', indexed: true },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
      { name: 'attestedAt', type: 'uint64', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MilestoneDisputed',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'i', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: false },
      { name: 'reason', type: 'string', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MilestoneReleased',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'i', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MilestoneResolved',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'i', type: 'uint256', indexed: true },
      { name: 'sellerAmount', type: 'uint128', indexed: false },
      { name: 'buyerRefund', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DealFunded',
    inputs: [
      { name: 'dealId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'total', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
] as const
