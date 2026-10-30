# Wasit on Arc

**Milestone escrow for small cross-border trade deals, in USDC on Arc.**

A buyer funds a deal once. Each milestone pays everyone at once — seller, freight forwarder,
inspector fee and platform fee — in a single atomic transaction. Disputes go to an arbiter
named when the deal is created. Milestones never attested refund the buyer after the deadline.

| | |
| --- | --- |
| **Live app** | https://wasit-arc.vercel.app |
| **Contract (Arc mainnet, chain 5042)** | [`0x18F7f2Fe911352C27176365A0Bdd19ddFA1B808F`](https://explorer.arc.io/address/0x18F7f2Fe911352C27176365A0Bdd19ddFA1B808F) |
| **Example release** | [`0x8d7a869a…c2f80efd`](https://explorer.arc.io/tx/0x8d7a869aec761435aa64cefb8370c2110a147dd0fbe776db06eceec6c2f80efd) — a milestone released after its challenge window elapsed, paying three parties in one transaction |
| **Built in Arc Studio** | https://studio.arc.io/app/55396917-2edf-4982-a334-07f07f46723a |

## The problem

A small importer pays a supplier abroad 30% up front. The goods do not exist yet. A
stablecoin payment cannot be pulled back. The bank alternative is a letter of credit: slow,
expensive, and often refused outright to small businesses. Meanwhile every intermediary — the
freight forwarder, the inspector — is paid separately and late.

## What Wasit does

One contract, `WasitEscrow`, holds many deals.

1. **Create.** The buyer names the payees and their shares in basis points, the milestones and
   their amounts, an inspector, an arbiter, a challenge window and a deadline. Every rule is
   checked on-chain at creation.
2. **Fund.** The buyer funds the whole deal once, in USDC.
3. **Attest.** The inspector attests that a milestone is done, with a hash of the supporting
   documents.
4. **Release.** Once the challenge window closes, anyone may release it — or the buyer may
   approve early. The release **splits atomically**: every payee and the platform fee are paid
   in one transaction.
5. **Or dispute.** Inside the window the buyer may dispute, and the named arbiter decides the
   split.

### The split

For a released milestone of `A`:

```
fee          = A * feeBps / 10000
payee[j>=1]  = A * bps_j / 10000
seller       = A - fee - sum(others)      <- all rounding dust lands here
```

The amounts always sum to exactly `A`. Fuzz-tested across amounts from 1 unit to 1,000,000
USDC and payee counts from 1 to 6.

### Two things we were careful about

**One bad payee cannot brick a release.** Arc reverts transfers to blocklisted addresses. Each
payout is a checked low-level call; if one fails, that payee's amount is credited to `owed[]`
and emitted as `PayoutCredited`, and everyone else is still paid. The credited payee withdraws
later. Tested against the real blocklisted address on Arc testnet.

**A dispute cannot freeze money forever.** If the named arbiter never rules, anyone may call
`releaseStalled` after a 14-day `ARBITRATION_WINDOW`. It settles to the **attested** outcome —
the inspector had already attested before the dispute — rather than refunding the buyer, which
would let a buyer dispute everything and wait out a silent arbiter to claw back delivered
goods.

## Arc specifics

- USDC is held and moved **only through the ERC-20 interface** at
  `0x3600000000000000000000000000000000000000` (6 decimals). The contract is non-payable and
  never touches `msg.value`, so native (18 dec) and ERC-20 (6 dec) amounts are never mixed.
- Every write transaction sets `maxFeePerGas` at or above Arc's 20 gwei floor. Below it, Arc
  drops transactions silently with no receipt.
- Arc's RPC rejects `eth_getLogs` ranges wider than about 5,000 blocks, so every log query is
  batched beneath that. At ~0.5s per block, a wide window is not a viable way to read history.

## How we used Arc Studio

The contract and the app were written by **Arc Studio**, driven from the terminal through the
Arc Studio CLI in **one app and one session** for the whole build, so the project URL above is
the complete record.

| Prompts | What Studio built |
| --- | --- |
| C1 | Data model, `createDeal` with the full validation set, `fund` |
| C2 | `attest` / `approve` / `release` / `withdraw`, the atomic split, credit-on-failure |
| C3 | `dispute`, arbiter `resolve`, `refundExpired` |
| C4 | Invariant and fuzz tests, plus a review against our checklist |
| C5 | Arbiter may not be a payee; `releaseStalled` for a silent arbiter; attest-after-deadline guard |
| A1–A4 | App shell and wallet, create-deal flow, deal page with role actions, deals list |
| A5 | Five-step create wizard with a read-only review before signing |
| F1–F4 | The fixes described below, and the mainnet `forge create` command |

Running at Studio's `max` preset, it dispatched two audit subagents plus Slither on every
contract turn and **found two real bugs in its own code**: `fund` discarding the `transferFrom`
return value, and the low-level payout call treating a zero-code address as a successful
transfer. Both were fixed before any deployment.

**Tests: 152 passing**, including 4 invariants over 12,800 random handler calls each.

Studio's deploy tool reaches testnets only, so Studio deployed and tested on Arc testnet and
produced the `forge create` command for mainnet, which we ran from our own wallet. The
deployed mainnet runtime bytecode was compared byte-for-byte against the build from this
source: both are 7,471 bytes and differ only inside the declared `immutableReference` slots
holding the constructor's `feeRecipient` and `feeBps`. Mainnet runs exactly this source.

## What testing found

Passing unit tests were not enough. We drove the real app in a headless browser against the
deployed contract, and that run found a defect no test had caught: **the normal release path
could never become available.**

`getMilestone` returned only `(amount, state)`, so `attestedAt` was unreadable on-chain and the
UI had to reconstruct it from event logs — over a block range Arc's RPC refuses. The buyer
would have been left with a funded escrow and a permanently disabled Release button, with only
the early-approval path working. The contract was widened to return `attestedAt`, `disputedAt`
and `buyerApproved`; the app now reads them from state.

The same run also caught a render loop that froze the deal page after funding, and an ABI that
carried none of the contract's 33 custom errors, so every revert surfaced to users as a raw
hex selector instead of a sentence.

All three were fixed before the mainnet deployment, which is why the contract address above is
the only one that has ever held real funds.

## Honest limits

- **Unaudited.** Studio's `max` review is best-effort, not a third-party audit. Nothing here
  has been audited by Arc or Circle.
- The transactions linked here are **demo deals between wallets we control**, with small
  amounts. There are no customers.
- `releaseStalled` protects against a silent arbiter, not a malicious one. Choosing an arbiter
  remains a trust decision the parties make off-chain.
- No KYB and no identity. Parties are addresses.
- The rotating globe on the landing page is **carried over from our earlier Wasit build**
  rather than generated by Arc Studio. It is decorative; everything that touches money was
  written and tested in Arc Studio.

## Prior work

Wasit began as a prototype on Mezo (MUSD with a Bitcoin bond) for the Mezo Buildathon. This
Arc version is a new build in Arc Studio with a different design — no bond, USDC milestone
splits. No contract or app code was reused, with the single exception of the landing globe
noted above. The brand and the video tooling are our own work, carried over. Not funded by any
Circle or Arc program.

## Where it goes next

KYB for parties, EURC deals, and Circle Wallets sign-in so a supplier needs no wallet of their
own — then a first real deal between parties we do not control.

## Run it

The repository uses a git submodule for `forge-std`, so clone recursively:

```bash
git clone --recursive https://github.com/farouk-allani/wasit-arc.git
cd wasit-arc
npm ci

npm run dev     # the app, on http://localhost:5173
forge test      # 152 contract tests
```

If you already cloned without `--recursive`, run `git submodule update --init` first.

## Licence

MIT. See [LICENSE](LICENSE).
