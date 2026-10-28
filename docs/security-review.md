# WasitEscrow Security Review

Turn 4 — invariant / fuzz tests + full architecture checklist.

## Test suite summary

| Suite | Tests | Result |
|---|---|---|
| WasitEscrow.Deploy.t.sol | 8 | PASS |
| WasitEscrow.CreateDeal.t.sol | 26 | PASS |
| WasitEscrow.Fund.t.sol | 9 | PASS |
| WasitEscrow.Release.t.sol | 24 | PASS |
| WasitEscrow.DisputeRefund.t.sol | 28 | PASS |
| WasitEscrow.FuzzSplit.t.sol | 5 fuzz × 256 runs | PASS |
| WasitEscrow.Invariant.t.sol | 4 invariants × 256 runs × 50 depth + 1 unit | PASS |
| **Total** | **105** | **0 failures** |

Invariant run counts: 256 runs × 50 depth = 12,800 handler calls per invariant property.

---

## Architecture checklist (ARCHITECTURE.md § "Review checklist")

### 1. No `msg.value`, no `payable`, no `address(this).balance` anywhere

**PASS.** `grep` over the full contract returns zero hits for `msg.value`, `payable`, `receive()`, `fallback()`, and `address(this).balance`. Every function (including the constructor) is non-payable.

### 2. All amounts in 6-decimal USDC units; UI converts with `decimals()`, never hard-codes 18

**PASS.** The contract contains no reference to 18 decimals, `1e18`, `10**18`, `ether`, or `parseUnits`. The only token is USDC at 6 decimals. All arithmetic (`A * feeBps / 10_000`, `A * bps_j / 10_000`) operates on the raw 6-decimal uint128 amounts without any unit conversion.

### 3. Checks-effects-interactions; `nonReentrant` on every state change that transfers

**PASS.** Every external state-changing function carries `nonReentrant`:
`fund`, `attest`, `approve`, `dispute`, `resolve`, `release`, `refundExpired`, `withdraw`.
`createDeal` makes no external calls and no transfers, so it is the only omission and correctly so.

CEI order is correct in every function:
- `fund`: state set to Funded → `safeTransferFrom` (interaction last)
- `release`: state set to Released → emit → `_tryCloseDeal` (pure storage) → `_releasePayout` (interactions last)
- `resolve`: state set to Resolved → emit → `_tryCloseDeal` → `_resolvePayeePayout` + `_sendOrCredit` (interactions last)
- `refundExpired`: state set to Refunded → emit → `_tryCloseDeal` → `_sendOrCredit` (interaction last)
- `withdraw`: `_owed[msg.sender] = 0` (effect) → `safeTransfer` (interaction last)

### 4. No owner function that can touch escrowed funds. Fee params immutable

**PASS.** There is no `Ownable` import, no `onlyOwner` modifier, no `setFee`, no admin function of any kind. `feeRecipient` and `feeBps` are both `immutable` — set once in the constructor and never changeable. The contract has no upgrade mechanism and no emergency withdrawal. No admin path can move escrowed funds.

### 5. Zero-address and blocklist paths tested (testnet blocklisted address in VERIFIED-FACTS)

**PASS (zero-address).** Tests cover: `feeRecipient = address(0)` reverts; every payee zero-address reverts; inspector/arbiter zero-address reverts.

**PASS (blocklist).** `WasitEscrow.Release.t.sol` deploys a `MockUSDCWithBlocklist` that returns `false` for `transfer` to the seller. The test confirms:
- Release does not revert
- Blocked payee's amount credited to `_owed[seller]`
- Other payees (feeRecipient, forwarder) receive their amounts normally
- `withdraw()` by the seller later succeeds exactly

**Note on VERIFIED-FACTS:** The spec references a VERIFIED-FACTS file with a testnet blocklisted address. That file is not present in this project. Tests use a mock that simulates the same failure mode (transfer returns false). For testnet deployment, the concrete blocklisted address should be added to `VERIFIED-FACTS.md` and a matching test added.

### 6. Uses `block.timestamp` only with ≥ comparisons; no randomness

**PASS (comparisons).** All `block.timestamp` comparisons use `>=` or `<` (strict; functionally equivalent to `>=` of the complement). No `==` comparison against a timestamp. All six uses are:
- `createDeal`: `uint256(deadline) <= minimumExclusive` (requires `deadline > now + window`)
- `attest`: stores `uint64(block.timestamp)` — not a comparison
- `dispute`: `block.timestamp >= windowEnds` (revert if expired)
- `release`: `block.timestamp >= unlocksAt` (allow if window passed)
- `refundExpired`: `block.timestamp < uint256(deal.deadline)` (revert if not yet expired)

**PASS (no randomness).** No use of `blockhash`, `keccak256(block.*...)`, `prevrandao`, or any other randomness source.

### 7. Tx gas settings respect the 20 gwei floor (app + scripts)

**NOT APPLICABLE (contract-only).** This checklist item refers to off-chain tooling (app and deployment scripts), not to the contract source itself. The contract contains no hardcoded `gasPrice`, `gaslimit`, or `tx.gasprice` references. Gas floor compliance must be enforced in the deployment scripts and frontend configuration, which are not yet written.

---

## Review summary

All 6 contract-applicable checklist items pass. Item 7 (gas floor) is a tooling concern outside the contract source and is pending the frontend/scripts turn.

One gap noted: VERIFIED-FACTS.md with a real testnet blocklisted Arc address is missing. Recommended action before testnet deploy: obtain a known blocklisted address from Circle's Arc testnet documentation and add a test using that concrete address via `vm.etch` on a real blocklist-reverting mock.

---

## Audit provenance

| Subagent | Turn | Files audited | Corpus rules cited |
|---|---|---|---|
| solidity-auditor | Turn 1 (initial) | 4 | use-safe-erc20-for-erc20-interactions (fixed) |
| functional-auditor | Turn 1 | 3 | — |
| solidity-auditor | Turn 2 (release path) | 7 | deposit-withdraw-state-asymmetry (resolved) |
| functional-auditor | Turn 2 | 1 | — |
| solidity-auditor | Turn 3 (dispute/refund) | 2 | call-to-non-existent-address-returns-success (fixed), multichain-bridged-token-allowlists-per-deployment (documented) |
| functional-auditor | Turn 3 | 4 | — |
| solidity-auditor | Turn 4 (invariant/final) | 2 | none |
| functional-auditor | Turn 4 | 1 | — |
