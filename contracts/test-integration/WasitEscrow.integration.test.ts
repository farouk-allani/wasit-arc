/**
 * WasitEscrow end-to-end integration test
 * Runs a complete deal lifecycle on Arc Testnet against the live deployed contract.
 * Uses Circle developer-controlled wallets SDK for all transaction signing.
 *
 * Sequence: approve USDC → createDeal → fund → attest(0) → wait 65s →
 *           release(0) → attest(1) → approve(1) [escrow] → release(1)
 */

import crypto from 'node:crypto';
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import {
  initiateSmartContractPlatformClient,
} from '@circle-fin/smart-contract-platform';
import { createPublicClient, http, decodeEventLog, parseAbi } from 'viem';
import { arcTestnet } from 'viem/chains';

// ─── Configuration ────────────────────────────────────────────────────────────

const NETWORK = 'ARC-TESTNET';
const ESCROW_ADDRESS = '0x0e00f7d98be4c20f38552766fdf1ac4cd704e5be';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const DEPLOYER_WALLET_ID = '3c2464b2-8369-52e2-a782-800bbeca5396';
const DEPLOYER_ADDRESS = '0x5B12Ce46C7194aD57d143bC22847224047b1Ef42';

// Roles
const SELLER_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const FORWARDER_ADDRESS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const INSPECTOR_ADDRESS = DEPLOYER_ADDRESS; // buyer == inspector
const ARBITER_ADDRESS = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';

// Deal params
const PAYEES = [
  { addr: SELLER_ADDRESS, bps: 8000 },
  { addr: FORWARDER_ADDRESS, bps: 1200 },
  { addr: DEPLOYER_ADDRESS, bps: 600 },
] as const;

const MILESTONE_AMOUNTS = [4_000_000n, 6_000_000n]; // 4 USDC + 6 USDC = 10 USDC
const TOTAL_AMOUNT = 10_000_000n; // 10 USDC
const CHALLENGE_WINDOW = 60n; // 60 seconds
const EVIDENCE_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`;

// Expected payouts
const FEE_BPS = 200n;
const BPS_DENOM = 10_000n;

// ─── Types ────────────────────────────────────────────────────────────────────

type TestResult = {
  testName: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  detail?: string;
  txId?: string;
  txHash?: string;
  expected?: string;
  actual?: string;
  durationMs: number;
};

// ─── State ────────────────────────────────────────────────────────────────────

const results: TestResult[] = [];
let dealId: bigint = 0n;

// Transaction hashes collected during the run
const txHashes: Record<string, string> = {};

// Pre-run USDC balances (read before funding)
const preFundBalances: Record<string, bigint> = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(result: TestResult) {
  results.push(result);
  console.log(JSON.stringify(result));
}

const TERMINAL_STATES = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

async function waitForTerminal(
  walletsClient: ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  txId: string,
  timeoutMs = 180_000,
): Promise<{ state: string; txHash?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await walletsClient.getTransaction({ id: txId });
    const tx = resp.data?.transaction;
    const state = tx?.state ?? '';
    if (state && TERMINAL_STATES.has(state)) {
      const txHash = (tx as any)?.txHash ?? (tx as any)?.transactionHash ?? undefined;
      return { state, txHash };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Transaction ${txId} did not reach terminal state within ${timeoutMs}ms`);
}

async function sendTx(
  walletsClient: ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  label: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: string[],
): Promise<{ txId: string; txHash: string }> {
  const start = Date.now();
  const txResp = await walletsClient.createContractExecutionTransaction({
    walletId: DEPLOYER_WALLET_ID,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: crypto.randomUUID(),
  });

  const txId = txResp.data?.id;
  if (!txId) throw new Error(`[${label}] Failed to initiate transaction — no txId returned`);

  const { state, txHash } = await waitForTerminal(walletsClient, txId);
  const durationMs = Date.now() - start;

  if (state !== 'COMPLETE') {
    // Try to get error details
    const resp = await walletsClient.getTransaction({ id: txId });
    const errDetail = (resp.data?.transaction as any)?.errorDetails ?? state;
    log({
      testName: label,
      status: 'FAIL',
      detail: `Transaction ended in state ${state}: ${JSON.stringify(errDetail)}`,
      txId,
      txHash: txHash ?? 'unknown',
      durationMs,
    });
    throw new Error(`[${label}] Transaction ${txId} ended in ${state}`);
  }

  return { txId, txHash: txHash ?? 'unknown' };
}

async function readContract(
  scpClient: ReturnType<typeof initiateSmartContractPlatformClient>,
  address: string,
  abiFunctionSignature: string,
  abiParameters: string[] = [],
): Promise<any[]> {
  const result = await scpClient.queryContract({
    blockchain: NETWORK as any,
    address,
    abiFunctionSignature,
    abiParameters,
  });
  return result.data?.outputValues ?? [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Testnet guard ─────────────────────────────────────────────────────────────

if (!/(TESTNET|SEPOLIA|AMOY|FUJI|BLAZE|ALFAJORES|APOTHEM|DEVNET|HOLESKY)/.test(NETWORK)) {
  console.error(JSON.stringify({
    testName: 'testnet-guard',
    status: 'FAIL',
    detail: `refusing to run against non-testnet network: ${NETWORK}`,
    durationMs: 0,
  }));
  process.exit(1);
}

// ─── Clients ──────────────────────────────────────────────────────────────────

const apiKey = process.env.CIRCLE_DEVELOPER_CONTROLLED_API_KEY
  ?? process.env.CIRCLE_API_KEY
  ?? process.env.CIRCLE_SCP_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET
  ?? process.env.ENTITY_SECRET
  ?? process.env.CIRCLE_SCP_ENTITY_SECRET;

if (!apiKey || !entitySecret) {
  console.error(JSON.stringify({
    testName: 'credential-check',
    status: 'FAIL',
    detail: 'Missing CIRCLE_API_KEY / ENTITY_SECRET — cannot sign transactions. Provision credentials via the provision_credentials tool.',
    durationMs: 0,
  }));
  process.exit(1);
}

const walletsClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const scpClient = initiateSmartContractPlatformClient({ apiKey, entitySecret });

// Public viem client for reads that don't go through SCP (balance checks, event parsing)
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http('https://rpc.testnet.arc.io'),
});

// ─── ABI snippets for viem reads ──────────────────────────────────────────────

const usdcBalanceAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const escrowAbi = parseAbi([
  'event DealCreated(uint256 indexed dealId, address indexed buyer, address inspector, address arbiter, uint128 total, uint64 deadline)',
  'function nextDealId() view returns (uint256)',
  'function getDeal(uint256 dealId) view returns (address buyer, address inspector, address arbiter, uint8 state, uint64 challengeWindow, uint64 deadline, uint128 total)',
  'function getMilestone(uint256 dealId, uint256 i) view returns (uint128 amount, uint8 state)',
]);

// ─── Main test runner ─────────────────────────────────────────────────────────

async function main() {
  // ── Pre-run state snapshot ──────────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const nextId = await publicClient.readContract({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: escrowAbi,
        functionName: 'nextDealId',
      });
      dealId = BigInt(nextId.toString());

      // Record pre-fund balances
      for (const [label, addr] of [
        ['deployer', DEPLOYER_ADDRESS],
        ['seller', SELLER_ADDRESS],
        ['forwarder', FORWARDER_ADDRESS],
        ['escrow', ESCROW_ADDRESS],
      ] as [string, string][]) {
        const bal = await publicClient.readContract({
          address: USDC_ADDRESS as `0x${string}`,
          abi: usdcBalanceAbi,
          functionName: 'balanceOf',
          args: [addr as `0x${string}`],
        });
        preFundBalances[label] = BigInt(bal.toString());
      }

      log({
        testName: 'pre-run-snapshot',
        status: 'PASS',
        detail: `nextDealId=${dealId}, deployerUSDC=${preFundBalances['deployer']}, sellerUSDC=${preFundBalances['seller']}, forwarderUSDC=${preFundBalances['forwarder']}, escrowUSDC=${preFundBalances['escrow']}`,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'pre-run-snapshot', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 1: USDC approve ────────────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-1-usdc-approve',
        USDC_ADDRESS,
        'approve(address,uint256)',
        [ESCROW_ADDRESS, TOTAL_AMOUNT.toString()],
      );
      txHashes['step-1-usdc-approve'] = txHash;
      log({
        testName: 'step-1-usdc-approve',
        status: 'PASS',
        detail: `approve(escrow, ${TOTAL_AMOUNT}) confirmed`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-1-usdc-approve', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 2: createDeal ──────────────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);

      // Encode payees as tuple[] — each payee is "(address addr, uint16 bps)"
      // SCP SDK accepts arrays of encoded tuples as strings
      const payeesEncoded = PAYEES.map((p) => `${p.addr},${p.bps}`);

      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-2-createDeal',
        ESCROW_ADDRESS,
        'createDeal((address,uint16)[],address,address,uint256[],uint64,uint64)',
        [
          JSON.stringify(PAYEES.map((p) => [p.addr, p.bps])),
          INSPECTOR_ADDRESS,
          ARBITER_ADDRESS,
          JSON.stringify(MILESTONE_AMOUNTS.map((a) => a.toString())),
          CHALLENGE_WINDOW.toString(),
          deadline.toString(),
        ],
      );
      txHashes['step-2-createDeal'] = txHash;

      // Read nextDealId to confirm the deal was created
      const nextId = await publicClient.readContract({
        address: ESCROW_ADDRESS as `0x${string}`,
        abi: escrowAbi,
        functionName: 'nextDealId',
      });
      const newNextId = BigInt(nextId.toString());
      // dealId was read before createDeal, so the new deal is at dealId
      // and nextDealId should now be dealId + 1
      if (newNextId !== dealId + 1n) {
        throw new Error(`Expected nextDealId=${dealId + 1n} after createDeal, got ${newNextId}`);
      }

      log({
        testName: 'step-2-createDeal',
        status: 'PASS',
        detail: `dealId=${dealId}, deadline=${deadline}, nextDealId now ${newNextId}`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-2-createDeal', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 3: fund ───────────────────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-3-fund',
        ESCROW_ADDRESS,
        'fund(uint256)',
        [dealId.toString()],
      );
      txHashes['step-3-fund'] = txHash;

      // Verify escrow USDC balance increased by 10 USDC
      const escrowBal = await publicClient.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: usdcBalanceAbi,
        functionName: 'balanceOf',
        args: [ESCROW_ADDRESS as `0x${string}`],
      });
      const escrowBalBig = BigInt(escrowBal.toString());
      const expectedEscrowBal = preFundBalances['escrow'] + TOTAL_AMOUNT;

      if (escrowBalBig !== expectedEscrowBal) {
        throw new Error(`Escrow balance after fund: expected ${expectedEscrowBal}, got ${escrowBalBig}`);
      }

      log({
        testName: 'step-3-fund',
        status: 'PASS',
        detail: `Deal funded. Escrow USDC balance: ${escrowBalBig} (delta +${TOTAL_AMOUNT})`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-3-fund', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 4: attest milestone 0 ─────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-4-attest-0',
        ESCROW_ADDRESS,
        'attest(uint256,uint256,bytes32)',
        [dealId.toString(), '0', EVIDENCE_HASH],
      );
      txHashes['step-4-attest-0'] = txHash;

      // Verify milestone 0 state = Attested (1)
      const [, msState] = await readContract(scpClient, ESCROW_ADDRESS, 'getMilestone(uint256,uint256)', [dealId.toString(), '0']);
      if (Number(msState) !== 1) {
        throw new Error(`Milestone 0 state after attest: expected 1 (Attested), got ${msState}`);
      }

      log({
        testName: 'step-4-attest-milestone-0',
        status: 'PASS',
        detail: `Milestone 0 attested. State=${msState} (Attested)`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-4-attest-milestone-0', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 5: wait 65 seconds for challenge window to expire ─────────────────
  {
    const start = Date.now();
    console.log(JSON.stringify({ testName: 'step-5-wait-65s', status: 'PASS', detail: 'Waiting 65 seconds for 60s challenge window to expire...', durationMs: 0 }));
    await sleep(65_000);
    log({
      testName: 'step-5-wait-65s',
      status: 'PASS',
      detail: 'Challenge window expired (waited 65s)',
      durationMs: Date.now() - start,
    });
  }

  // ── Step 6: release milestone 0 ────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const sellerBefore = await publicClient.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: usdcBalanceAbi,
        functionName: 'balanceOf',
        args: [SELLER_ADDRESS as `0x${string}`],
      });

      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-6-release-0',
        ESCROW_ADDRESS,
        'release(uint256,uint256)',
        [dealId.toString(), '0'],
      );
      txHashes['step-6-release-0'] = txHash;

      // Verify milestone 0 state = Released (3)
      const [, msState] = await readContract(scpClient, ESCROW_ADDRESS, 'getMilestone(uint256,uint256)', [dealId.toString(), '0']);
      if (Number(msState) !== 3) {
        throw new Error(`Milestone 0 state after release: expected 3 (Released), got ${msState}`);
      }

      // Verify seller received 3,200,000 (80% of 4 USDC after fee)
      const sellerAfter = await publicClient.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: usdcBalanceAbi,
        functionName: 'balanceOf',
        args: [SELLER_ADDRESS as `0x${string}`],
      });
      const sellerDelta = BigInt(sellerAfter.toString()) - BigInt(sellerBefore.toString());
      const expectedSellerMs0 = 3_200_000n;
      if (sellerDelta !== expectedSellerMs0) {
        throw new Error(`Seller delta after release(0): expected ${expectedSellerMs0}, got ${sellerDelta}`);
      }

      log({
        testName: 'step-6-release-milestone-0',
        status: 'PASS',
        detail: `Milestone 0 released. State=3 (Released). Seller received +${sellerDelta} USDC units`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-6-release-milestone-0', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 7: attest milestone 1 ─────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-7-attest-1',
        ESCROW_ADDRESS,
        'attest(uint256,uint256,bytes32)',
        [dealId.toString(), '1', EVIDENCE_HASH],
      );
      txHashes['step-7-attest-1'] = txHash;

      const [, msState] = await readContract(scpClient, ESCROW_ADDRESS, 'getMilestone(uint256,uint256)', [dealId.toString(), '1']);
      if (Number(msState) !== 1) {
        throw new Error(`Milestone 1 state after attest: expected 1 (Attested), got ${msState}`);
      }

      log({
        testName: 'step-7-attest-milestone-1',
        status: 'PASS',
        detail: `Milestone 1 attested. State=${msState} (Attested)`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-7-attest-milestone-1', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 8: approve milestone 1 (escrow approve, not ERC-20) ───────────────
  {
    const start = Date.now();
    try {
      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-8-escrow-approve-1',
        ESCROW_ADDRESS,
        'approve(uint256,uint256)',
        [dealId.toString(), '1'],
      );
      txHashes['step-8-escrow-approve-1'] = txHash;

      const [, msState] = await readContract(scpClient, ESCROW_ADDRESS, 'getMilestone(uint256,uint256)', [dealId.toString(), '1']);
      if (Number(msState) !== 2) {
        throw new Error(`Milestone 1 state after escrow-approve: expected 2 (Approved), got ${msState}`);
      }

      log({
        testName: 'step-8-escrow-approve-milestone-1',
        status: 'PASS',
        detail: `Milestone 1 buyer-approved. State=${msState} (Approved)`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-8-escrow-approve-milestone-1', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Step 9: release milestone 1 ────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      const sellerBefore = await publicClient.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: usdcBalanceAbi,
        functionName: 'balanceOf',
        args: [SELLER_ADDRESS as `0x${string}`],
      });

      const { txId, txHash } = await sendTx(
        walletsClient,
        'step-9-release-1',
        ESCROW_ADDRESS,
        'release(uint256,uint256)',
        [dealId.toString(), '1'],
      );
      txHashes['step-9-release-1'] = txHash;

      const [, msState] = await readContract(scpClient, ESCROW_ADDRESS, 'getMilestone(uint256,uint256)', [dealId.toString(), '1']);
      if (Number(msState) !== 3) {
        throw new Error(`Milestone 1 state after release: expected 3 (Released), got ${msState}`);
      }

      // Verify seller received 4,800,000 (80% of 6 USDC after fee)
      const sellerAfter = await publicClient.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: usdcBalanceAbi,
        functionName: 'balanceOf',
        args: [SELLER_ADDRESS as `0x${string}`],
      });
      const sellerDelta = BigInt(sellerAfter.toString()) - BigInt(sellerBefore.toString());
      const expectedSellerMs1 = 4_800_000n;
      if (sellerDelta !== expectedSellerMs1) {
        throw new Error(`Seller delta after release(1): expected ${expectedSellerMs1}, got ${sellerDelta}`);
      }

      log({
        testName: 'step-9-release-milestone-1',
        status: 'PASS',
        detail: `Milestone 1 released. State=3 (Released). Seller received +${sellerDelta} USDC units`,
        txId,
        txHash,
        durationMs: Date.now() - start,
      });
    } catch (e: any) {
      log({ testName: 'step-9-release-milestone-1', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Final chain reads ───────────────────────────────────────────────────────
  {
    const start = Date.now();
    try {
      // Read final USDC balances
      const addresses: Array<[string, string]> = [
        ['seller', SELLER_ADDRESS],
        ['forwarder', FORWARDER_ADDRESS],
        ['deployer_wallet', DEPLOYER_ADDRESS],
        ['escrow', ESCROW_ADDRESS],
      ];

      const finalBalances: Record<string, bigint> = {};
      for (const [label, addr] of addresses) {
        const bal = await publicClient.readContract({
          address: USDC_ADDRESS as `0x${string}`,
          abi: usdcBalanceAbi,
          functionName: 'balanceOf',
          args: [addr as `0x${string}`],
        });
        finalBalances[label] = BigInt(bal.toString());
      }

      // Read deal state — expected Closed (2)
      const dealStateValues = await readContract(scpClient, ESCROW_ADDRESS, 'getDeal(uint256)', [dealId.toString()]);
      const dealState = Number(dealStateValues[3]); // index 3 = state

      // Read milestone states
      const [, ms0State] = await readContract(scpClient, ESCROW_ADDRESS, 'getMilestone(uint256,uint256)', [dealId.toString(), '0']);
      const [, ms1State] = await readContract(scpClient, ESCROW_ADDRESS, 'getMilestone(uint256,uint256)', [dealId.toString(), '1']);

      // Compute deltas relative to pre-fund snapshot
      const sellerDeltaTotal = finalBalances['seller'] - preFundBalances['seller'];
      const forwarderDeltaTotal = finalBalances['forwarder'] - preFundBalances['forwarder'];
      const deployerDeltaTotal = finalBalances['deployer_wallet'] - preFundBalances['deployer'];
      const escrowFinalBalance = finalBalances['escrow'];

      // Expected cumulative deltas
      const expectedSellerTotal = 8_000_000n;
      const expectedForwarderTotal = 1_200_000n;
      // Deployer receives inspector share (600 bps) + fee (200 bps) = 800 bps of 10 USDC
      // BUT also spent 10 USDC to fund → net delta = 800_000 - 10_000_000 = -9_200_000
      const expectedDeployerFeeAndInspector = 800_000n;
      const expectedDeployerNetDelta = expectedDeployerFeeAndInspector - TOTAL_AMOUNT; // -9_200_000
      const expectedEscrowFinalBalance = preFundBalances['escrow']; // back to original (0 or pre-existing)

      // Payout sum checks
      // MS0: 4_000_000
      const ms0Fee = 4_000_000n * FEE_BPS / BPS_DENOM; // 80_000
      const ms0Forwarder = 4_000_000n * 1200n / BPS_DENOM; // 480_000
      const ms0Inspector = 4_000_000n * 600n / BPS_DENOM; // 240_000
      const ms0Seller = 4_000_000n - ms0Fee - ms0Forwarder - ms0Inspector; // 3_200_000
      const ms0Sum = ms0Fee + ms0Forwarder + ms0Inspector + ms0Seller;

      // MS1: 6_000_000
      const ms1Fee = 6_000_000n * FEE_BPS / BPS_DENOM; // 120_000
      const ms1Forwarder = 6_000_000n * 1200n / BPS_DENOM; // 720_000
      const ms1Inspector = 6_000_000n * 600n / BPS_DENOM; // 360_000
      const ms1Seller = 6_000_000n - ms1Fee - ms1Forwarder - ms1Inspector; // 4_800_000
      const ms1Sum = ms1Fee + ms1Forwarder + ms1Inspector + ms1Seller;

      const payoutChecks = {
        ms0Sum: ms0Sum === 4_000_000n,
        ms1Sum: ms1Sum === 6_000_000n,
        sellerTotal: sellerDeltaTotal === expectedSellerTotal,
        forwarderTotal: forwarderDeltaTotal === expectedForwarderTotal,
        deployerNetDelta: deployerDeltaTotal === expectedDeployerNetDelta,
        escrowEmpty: escrowFinalBalance === expectedEscrowFinalBalance,
        dealClosed: dealState === 2,
        ms0Released: Number(ms0State) === 3,
        ms1Released: Number(ms1State) === 3,
      };

      const allChecksPass = Object.values(payoutChecks).every(Boolean);

      const detail = [
        `dealState=${dealState} (expected 2=Closed, ${dealState === 2 ? 'PASS' : 'FAIL'})`,
        `milestone0State=${ms0State} (expected 3=Released, ${Number(ms0State) === 3 ? 'PASS' : 'FAIL'})`,
        `milestone1State=${ms1State} (expected 3=Released, ${Number(ms1State) === 3 ? 'PASS' : 'FAIL'})`,
        '',
        '=== PAYOUT TABLE ===',
        `MS0 (4 USDC): fee=${ms0Fee} | seller=${ms0Seller} | forwarder=${ms0Forwarder} | inspector=${ms0Inspector} | sum=${ms0Sum} (${ms0Sum === 4_000_000n ? 'OK' : 'MISMATCH'})`,
        `MS1 (6 USDC): fee=${ms1Fee} | seller=${ms1Seller} | forwarder=${ms1Forwarder} | inspector=${ms1Inspector} | sum=${ms1Sum} (${ms1Sum === 6_000_000n ? 'OK' : 'MISMATCH'})`,
        '',
        '=== CUMULATIVE BALANCE DELTAS ===',
        `seller (${SELLER_ADDRESS}):        delta=${sellerDeltaTotal} (expected ${expectedSellerTotal}) ${sellerDeltaTotal === expectedSellerTotal ? 'PASS' : 'FAIL'}`,
        `forwarder (${FORWARDER_ADDRESS}): delta=${forwarderDeltaTotal} (expected ${expectedForwarderTotal}) ${forwarderDeltaTotal === expectedForwarderTotal ? 'PASS' : 'FAIL'}`,
        `deployer (${DEPLOYER_ADDRESS}):   delta=${deployerDeltaTotal} (expected ${expectedDeployerNetDelta} = +${expectedDeployerFeeAndInspector} received - ${TOTAL_AMOUNT} funded) ${deployerDeltaTotal === expectedDeployerNetDelta ? 'PASS' : 'FAIL'}`,
        `escrow (${ESCROW_ADDRESS}):        finalBal=${escrowFinalBalance} (expected ${expectedEscrowFinalBalance}) ${escrowFinalBalance === expectedEscrowFinalBalance ? 'PASS' : 'FAIL'}`,
        '',
        '=== FINAL ABSOLUTE BALANCES ===',
        `seller:    ${finalBalances['seller']}`,
        `forwarder: ${finalBalances['forwarder']}`,
        `deployer:  ${finalBalances['deployer_wallet']}`,
        `escrow:    ${finalBalances['escrow']}`,
      ].join('\n');

      log({
        testName: 'final-chain-verification',
        status: allChecksPass ? 'PASS' : 'FAIL',
        detail,
        durationMs: Date.now() - start,
      });

      if (!allChecksPass) {
        console.error('One or more payout/state checks FAILED. See final-chain-verification detail above.');
        process.exit(1);
      }
    } catch (e: any) {
      log({ testName: 'final-chain-verification', status: 'FAIL', detail: String(e?.message ?? e), durationMs: Date.now() - start });
      process.exit(1);
    }
  }

  // ── Transaction hash summary ────────────────────────────────────────────────
  console.log(JSON.stringify({
    testName: 'tx-hash-summary',
    status: 'PASS',
    detail: 'All transaction hashes',
    txHashes,
    durationMs: 0,
  }));

  // ── Final summary ───────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIPPED').length;

  console.log(JSON.stringify({
    testName: '__summary__',
    status: failed === 0 ? 'PASS' : 'FAIL',
    detail: `${passed} passed, ${failed} failed, ${skipped} skipped`,
    durationMs: 0,
  }));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: any) => {
  console.error(JSON.stringify({
    testName: '__unhandled__',
    status: 'FAIL',
    detail: String(e?.message ?? e),
    durationMs: 0,
  }));
  process.exit(1);
});
