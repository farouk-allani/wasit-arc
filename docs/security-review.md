# WasitEscrow — Final Security Review

**Contract:** `contracts/WasitEscrow.sol`  
**Deployment:** `0x0e00f7d98be4c20f38552766fdf1ac4cd704e5be` (Arc Testnet, chain 5042002)  
**Review date:** 2026-10-29 (updated 2026-10-29 — Medium finding fixed)  
**Preset:** max  
**Scope:** full contract including the two features added in turn 5 — arbiter-not-payee rule
and `releaseStalled()` — which had not previously had a full review pass.

---

## Summary

**All findings resolved. Contract is ready for mainnet deployment.**

143 tests pass (8 new deadline-guard tests added). Both the rule-corpus auditor and the
functional auditor were run at max severity. One Medium finding emerged and has been fixed:
`attest()` now rejects attestation at or after `deal.deadline` with a dedicated
`AttestAfterDeadline` error. `approve()` deliberately has no deadline guard — the NatSpec
documents the asymmetry. No Critical or High findings. Every other check is clean.

The shared-custody freeze risk (Circle blocklisting the contract address) is a known,
documented architectural limitation — not a new finding. It is re-stated here for
completeness.

---

## Findings

### Medium — `attest()` does not check the deal deadline — **FIXED**

**Location:** `WasitEscrow.attest()`, lines 270–289 (post-fix)  
**Auditor:** functional-auditor (confirmed by manual review)  
**Status:** Fixed. `AttestAfterDeadline` error added; guard live in current source.

**Description.** `refundExpired()` can only refund a `Pending` milestone after `deadline`.
`attest()` has no corresponding deadline guard. An inspector can therefore call `attest()`
after `deadline`, converting the milestone from `Pending` to `Attested` and making
`refundExpired()` revert (`MilestoneNotPendingForRefund`). The buyer's expected "deadline
refund" path is gone.

**Impact.** The buyer is not permanently locked out of funds. From `Attested` the buyer
retains `dispute()` (within the new challenge window), and after the window anyone can call
`release()`. But the buyer receives the attested split rather than a full refund — losing
their dispute lever — unless they dispute within the new window. An inspector who is also a
payee has a direct financial incentive to do this.

**Severity:** Medium (funds not unreachable, but a party can be forced into a worse outcome
than the contract's stated semantics promise).

**Fix applied.** Guard added at the top of `attest()`:

```solidity
if (block.timestamp >= uint256(deal.deadline)) {
    revert AttestAfterDeadline(dealId, deal.deadline, block.timestamp);
}
```

Custom error added:

```solidity
/// @notice Thrown by attest() when block.timestamp >= deal.deadline.
error AttestAfterDeadline(uint256 dealId, uint64 deadline, uint256 now_);
```

`approve()` intentionally has no matching guard — the buyer may voluntarily pay a late
seller. The NatSpec on `approve()` documents this asymmetry explicitly.

**Tests added** (`contracts/test/WasitEscrow.DeadlineGuard.t.sol`, 8 tests):
1. `test_attest_justBeforeDeadline_succeeds` — attest at `deadline - 1` succeeds
2. `test_attest_atExactDeadline_reverts` — attest at `deadline` reverts with `AttestAfterDeadline`
3. `test_attest_afterDeadline_reverts` — attest at `deadline + 1 day` reverts
4. `test_refundExpired_afterDeadline_pendingMilestone` — `refundExpired` works on Pending after deadline
5. `test_approve_afterDeadline_pendingMilestone_succeeds` — buyer `approve()` works after deadline
6. `test_approve_afterDeadline_thenRelease_correctSplit` — approved post-deadline milestone releases with exact split
7. `test_attestBeforeDeadline_windowExpiresAfterDeadline_releaseSucceeds` — attested before deadline, window ends after, release still works
8. `test_refundExpired_rejectsAttestedMilestone` — `refundExpired` rejects a timely-attested milestone

Two pre-existing tests in `WasitEscrow.Release.t.sol` that looped over 3 milestones were
updated to use a `30 day` deadline (instead of `3 days`) so the test sequence does not
collide with the new guard. Their logic is unchanged.

**Full suite result after fix:** 143/143 pass, 0 fail.

---

### Informational — `_owed` credits are permanently unwithdrawable for blocklisted addresses

**Location:** `_sendOrCredit()` / `withdraw()`, lines 567–611  
**Auditor:** functional-auditor (re-confirmed; pre-existing known limitation)

**Description.** If a payee, the buyer, or the fee recipient is blocklisted by Circle, their
share is credited to `_owed[address]`. `withdraw()` calls `safeTransfer` to that address,
which also fails for a blocklisted address, so the credited amount is permanently trapped.

**Impact.** The amount remains in the contract indefinitely, not recoverable by the affected
party or anyone else (there is no admin sweep). This is the individual-payee instance of the
shared-custody risk and is already documented in the contract-level NatSpec.

**Severity:** Informational (known limitation, documented, no new attack surface).

**Fix / mitigation:** Pre-deployment: screen all payee/buyer/inspector addresses against
the USDC blocklist before funding. Operational: the UI should warn users that a blocked
address cannot withdraw their credits. No contract change is needed for mainnet, but the
operational guidance is important.

---

### Informational — Shared-custody contract-level freeze

**Location:** `WasitEscrow` (contract header NatSpec), line 13  
**Auditor:** rule-corpus auditor (pre-existing known limitation)

**Description.** All deal funds live at one address. If Circle blocklists the contract
itself, all outbound transfers fail simultaneously across all active deals. The
`_sendOrCredit` fallback does not help here because `withdraw()` would also fail.

**Impact.** Protocol-wide liveness failure; no deal can release or refund until the freeze
is lifted (which requires Circle action). This is inherent to single-contract shared-custody
stablecoin escrow and is disclosed in the contract header.

**Severity:** Informational (architectural property, documented, not a code defect).

**Mitigation:** Accept and disclose; consider per-deal isolated custody in a future version.

---

## Focused Question Answers

### 1. `releaseStalled()` — double-settlement and front-run safety

**Can it settle an already-settled milestone?**  
No. The function requires `m.state == Disputed`. Every other settlement path writes a
different terminal state before returning: `resolve()` writes `Resolved`, `release()` writes
`Released`, `refundExpired()` writes `Refunded`. Once any of these has fired, `releaseStalled`
reverts at the state guard.

**Can it front-run `resolve()`?**  
Not profitably. If `releaseStalled` and `resolve` race in the same block, exactly one
executes successfully (whichever is included first); the second reverts on the state guard.
`NonReentrant` prevents any inter-call re-entry. No double-pay is possible.

**Is `disputedAt` set and read correctly?**  
Yes. `dispute()` sets `m.disputedAt = uint64(block.timestamp)` (line 332) as an effect
before emitting the event. `releaseStalled()` reads it at line 473 to compute
`unlocksAt = disputedAt + ARBITRATION_WINDOW`. Correct.

**Can a buyer reset the `disputedAt` clock by re-disputing?**  
No. `dispute()` requires `m.state == Attested`. Once `Disputed`, the milestone state can
only change to `Resolved` (arbiter) or `Released` (releaseStalled). There is no path back to
`Attested` from `Disputed`. The clock cannot be reset.

### 2. At-most-once across all four settlement paths

Each path requires a distinct non-terminal input state:

| Path | Required state | Sets state to |
|---|---|---|
| `release()` | `Approved` or `Attested` | `Released` |
| `resolve()` | `Disputed` | `Resolved` |
| `refundExpired()` | `Pending` | `Refunded` |
| `releaseStalled()` | `Disputed` | `Released` |

`release` and `releaseStalled` both set `Released` but require different input states
(`Attested`/`Approved` vs `Disputed`). A milestone cannot be in both `Attested` and
`Disputed` simultaneously — `Attested → Disputed` is a one-way transition via `dispute()`.
At-most-once is airtight.

### 3. State-machine reachability — full table

Every milestone state has at least one exit path that eventually gets funds out.

| State | How funds escape | Dead end? |
|---|---|---|
| **Pending** | (a) `attest()` → Attested, then see below; (b) `approve()` → Approved → `release()`; (c) `refundExpired()` after deadline → Refunded → buyer | No |
| **Attested** | (a) `release()` after challenge window → Released; (b) `approve()` → Approved → `release()`; (c) `dispute()` within window → Disputed → see below | No |
| **Approved** | `release()` by anyone, immediately → Released | No |
| **Disputed** | (a) `resolve()` by arbiter → Resolved; (b) `releaseStalled()` by anyone after 14 d → Released | No — 14-day hard cap |
| **Released** | Terminal. Funds paid out or in `_owed`. `withdraw()` pulls `_owed` (unless blocklisted — known limitation). | No† |
| **Resolved** | Terminal. Same as Released. | No† |
| **Refunded** | Terminal. Buyer paid or `_owed[buyer]`. | No† |

† The only remaining risk at terminal states is the blocklisted-recipient `_owed` credit
(Informational above). Funds are not lost to the protocol; they are credited and
unwithdrawable only to the blocked address.

**Special case — Pending after deadline (post-deadline attestation):**  
An inspector can attest after deadline (the Medium finding). If they do, the milestone
transitions to `Attested` post-deadline. The buyer can still `dispute()` within the new
challenge window, and anyone can `release()` after it. Funds are not permanently locked —
the buyer simply cannot use `refundExpired()` and must interact via the challenge-window
path instead.

**Special case — deal Created, never funded:**  
No USDC enters the contract. Milestones remain `Pending` forever but carry no funds. Zero
risk.

**Special case — arbiter is a dead address / lost key:**  
A `Disputed` milestone with a dead arbiter resolves via `releaseStalled()` after 14 days.
No fund lock possible beyond 14 days.

### 4. Arithmetic

**`_releasePayout(A)`:** `fee = A*feeBps/10000`. Each payee j≥1: `A*bps_j/10000`. Seller
gets `A - distributed`. All integer floor divisions; dust accumulates on seller (payee 0).
Sum = A exactly.

**`_resolvePayeePayout(sellerAmount)`:** Same structure but base is `sellerAmount` not `A`.
Sum of this path = `sellerAmount` exactly. `buyerRefund = A - sellerAmount`. Total paid out
= `sellerAmount + buyerRefund = A`. Exact.

**`resolve()` overflow:** Intermediate `uint256(A) * sellerShareBps` where A ≤ uint128.max
and sellerShareBps ≤ 10000. Max intermediate = ~3.4×10^38 × 10^4, safely within uint256.
Down-cast to uint128 is safe because result ≤ A ≤ uint128.max.

No arithmetic path can pay out more or less than A.

### 5. Griefing and economic abuse

**Inspector never attests.** Buyer recovers all funds via `refundExpired()` after deadline.
Maximum exposure is the time until deadline (set at deal creation, must be > now +
challengeWindow). No fund lock. Liveness grief only.

**Inspector attests after deadline (new, see Medium finding above).** Buyer loses the
clean `refundExpired()` path and must go through the dispute or challenge-window path. Funds
remain recoverable. Inspector must be a payee to have financial motive for this.

**Buyer never funds.** No USDC enters the contract. Seller's exposure is zero.

**Payee always reverts (blocklisted).** `_sendOrCredit` handles it: credits `_owed[payee]`,
continues with all other payees. Release still succeeds. No deal-wide impact.

**Buyer disputes every milestone.** After 14 days `releaseStalled()` pays the attested
split. Buyer receives no benefit — same cost as normal release. Rational buyer would not
do this. The only effect is a 14-day delay for the seller.

**Hostile deal parameters.** `createDeal` validates all structural constraints. A caller
cannot create a deal that traps another party's funds — the buyer is always `msg.sender`
and they are the only one who can `fund()` it.

**Corrupt inspector-payee.** As noted in §1, the inspector can be a payee. There is no rule
preventing this (unlike the arbiter-not-payee rule). A corrupt inspector-payee can attest
worthless work (or refuse to attest and force the buyer past deadline) in exchange for their
share. This is a pre-existing design choice: the inspector's bps share is their economic
incentive to attest honestly. It is an off-chain trust decision.

### 6. Review checklist — final state

| Item | Status | Notes |
|---|---|---|
| No `msg.value`, `payable`, `address(this).balance` | PASS | Confirmed absent throughout |
| All amounts in 6-decimal USDC units; UI reads `decimals()` | PASS | `useUsdcDecimals` hook reads from contract |
| Checks-effects-interactions; `nonReentrant` on every state change | PASS | All 9 state-changing functions |
| No owner function that can touch escrowed funds; fee params immutable | PASS | `feeRecipient` and `feeBps` are `immutable`; no admin functions |
| Zero-address and blocklist paths tested | PASS | `WasitEscrow.ArcBlocklist.t.sol`; 7 tests with real blocklisted address |
| `block.timestamp` used only with `>=` / `<` comparisons; no randomness | PASS | All 6 timestamp comparisons use `>=` or `<` |
| 20 gwei gas floor in app + scripts | PASS | `GAS_FLOOR = parseGwei('20')` in `src/lib/wasit-config.ts` |

All 7 checklist items pass.

---

## New features reviewed

### Arbiter-not-payee rule

Added to `createDeal()` at lines 194–196. Loops all payees and reverts with `ArbiterIsPayee`
if any payee address equals `arbiter`. This is correctly placed after the arbiter ≠ buyer
and arbiter ≠ seller checks (line 190) and after the duplicate-payee check (lines 180–183),
so there is no way to construct a bypass. The check is complete.

### `releaseStalled()`

Analysed fully in §1 and §2 above. The function is correctly guarded, CEI-ordered,
emits both `MilestoneStalledReleased` and `MilestoneReleased` (so existing event indexers
see a `MilestoneReleased` event regardless of which settlement path fired), and uses the
same `_releasePayout` as `release()`.

---

## Recommendation before mainnet

**Fix the Medium finding** (`attest()` post-deadline guard) before deploying to mainnet.
It is a one-line change, one error declaration, and one test case. No other code changes
are needed.

The two Informational findings (blocklisted-recipient `_owed` credits; shared-custody
freeze) are architectural properties inherent to single-contract USDC escrow. They are
documented in the contract and should be disclosed to users in the app UI.
