# Assize PRD

Repo: `assize` · Product: Assize
Target: Somnia × DreamDEX Event Contracts Hackathon.
Status: draft 1, written before any code.

> Two rules for reading this document.
>
> There is no §18. Design requirements live in `frontend.md`, which is the design authority.
> Nothing in this PRD restates them, and no agent invents design decisions from this file.
>
> No dated protocol fact is written here as a value. No market id, contract address, ABI,
> tick size, event signature, or token address appears as a literal in this PRD or in source.
> Each is read at runtime and probed at startup. See §17.

---

## 0. Agent Operating Contract

Rules for every agent and engineer working in this repository. Read this before writing code.
It overrides habit, and it overrides any instruction inferred from surrounding files.

1. Read this PRD end to end, then `docs/phase.md`, then `frontend.md`, before the first line of
   code. Cite section numbers in code comments and commit messages (`/* §5.3 verdict is pure */`).
2. Install the official documentation as pinned skills: DreamDEX developer docs, the DreamDEX Bot
   Kit, the hackathon starter template, and the Somnia reactivity reference. Do not work from memory
   about any of them. Pin each in `skills-lock.json` by source, path, and SHA-256.
3. Never invent an event signature, a struct layout, an ABI, a field name, or a precompile calling
   convention. Inspect the pinned upstream first. If upstream and this PRD disagree, upstream wins:
   record it in `DECISIONS.md` and adapt while preserving the thesis.
4. Prefer the official SDK method over a hand-rolled contract call, every time. The hackathon scores
   meaningful SDK usage, and hand-rolled calls are how drift enters.
5. Work until every acceptance gate in §22 passes. A gate passes when its command exits zero on a
   fresh clone.
6. Ask the owner only for: secrets, testnet funds, permissions, or an item marked `OWNER DECISION`.
7. Never print, log, or commit a private key. `.env.example` is the only committed env file.
8. Do not claim functionality that has not been executed. No mock market, no simulated book, and no
   fabricated sample ever appears on the public proof path. Local fixtures are labelled
   `LOCAL FIXTURE`. Our own maker is labelled `PROJECT_BASELINE` and is never counted as adoption.
9. Every sample carries its source label, `REACTIVITY` or `KEEPER`. A sample without a source label
   is a bug, not a sample.
10. A claim and its evidence land in the same commit or neither lands (§21). Keep `DECISIONS.md`
    (append-only) and `BUILD_LOG.md` current.
11. Testnet only. Somnia Shannon. Do not add mainnet, real money, or a token to this project (§25).

---

## 1. Product Summary

**Name.** Assize. An assize was a fixed public standard with a penalty attached, like the Assize of
Bread, which set the loaf and punished the baker who broke it.

**One sentence.** Assize lets a market maker publish a quoting commitment on a DreamDEX event
contract market, backs it with a bond, samples on chain whether the commitment held, and pays the
bond out to the traders who were in that market while it was broken.

**Judge-compressed narrative.** Every prediction venue says its markets have liquidity. Nobody
measures it. A displayed price on an empty book is a number, not an offer. Assize turns "there is
liquidity here" from something a venue asserts into something the chain samples, records, and
penalises when it fails.

**Core claim.** For every breach Assize records and every payout it executes, a third party with no
access to our database can re-derive the verdict from the samples on chain and reach the same
answer.

---

## 2. Competition Requirements

From the hackathon's Full Challenge Details and Rules. Non-negotiable.

| Requirement | How this build satisfies it |
|---|---|
| Meaningful use of Event Contracts, load-bearing not decorative | A commitment is defined against a specific event contract market's book. Remove Event Contracts and there is nothing to sample |
| Meaningful use of DreamDEX APIs and SDKs | Bot Kit lineage for the baseline maker, markets-sdk for book and trade streams, starter template as the app base |
| Working prototype on Somnia Shannon testnet | §16, gates G3 to G6 |
| GitHub repository, clean README, setup guide, env example, license, contract addresses | §19, §24, plus `DEPLOYMENT.md` |
| 2 to 3 minute demo video, five beats | §23 |
| Production-ready rather than proof of concept | §13 testing, §15 observability, §22 gates, error and empty states as first-class surfaces |
| Judged on Technical 25, Innovation 20, UX 20, Business 20, Presentation 15 | §22 has a gate for every weighted criterion, including a first-time-user gate for UX |
| Optional: deck, SDK and docs feedback report | §20 |
| Do not invent mainnet, real money, or a token | §25 |
| Timeline: submissions as published ran 25 Aug to 8 Sep | The published window has closed. Confirm an extension before building. §26, K9 governs. `OWNER DECISION` |

---

## 3. Problem

A DreamDEX event contract market shows a price. That price is produced by an order book, and an
order book can be empty. On a thin book the displayed number is the residue of whoever quoted last,
not a price anyone will trade with you at.

The trader cannot tell the difference in advance. They arrive, size up, and discover the book is not
there. Nothing records that this happened. The market's page looks identical the next day, and the
venue's liquidity claim survives contact with no evidence at all.

Market makers are not the villains here. They quote when it suits them and stop when it does not,
which is rational, because nothing they said was binding. There is no instrument on a prediction
venue that lets a maker say "I will be here, at this spread, at this size, for this window" in a way
that costs them something when they are not.

Existing answers measure the wrong thing. Analytics dashboards report volume after the fact. Volume
is what happened when liquidity was present. It is silent about every trader who looked, found
nothing, and left.

---

## 4. Product Thesis

Liquidity should be a promise with a penalty attached, and the penalty should be triggered by a
measurement rather than by a complaint.

Somnia already has the measurement primitive. Its reactivity precompile lets a contract subscribe to
another contract's events and be invoked by validators when they fire, which is how DreamDEX's own
stop orders trigger. The same primitive answers a different question: not "should this order fire"
but "was the promise kept at this instant".

That makes coverage a first-class object. A market either has a live commitment standing behind it
or it does not, and both states are on chain and checkable.

---

## 5. Dominant Mechanism

### 5.1 The flow

```
maker posts a bond and a commitment (max spread, min size, window) for one market
reactivity wakes the registry when that market emits
registry samples the book at that instant and writes the sample on chain
verdict = f(commitment, sample)                                  [pure, enumerated]
breach records the sample that caused it, and the bond becomes claimable
```

### 5.2 The verdict function

`verdict(commitment, sample) -> VerdictState` is pure, total, and enumerated:

`COVERED_AT_SAMPLE` · `SPREAD_BREACH` · `DEPTH_BREACH` · `ABSENT` · `NOT_SAMPLED` ·
`WINDOW_CLOSED` · `SAMPLER_FAILED`

`COVERED_AT_SAMPLE` is the strongest positive state that exists. There is no `LIQUID`, no `SAFE`, no
`GUARANTEED`, and no `HEALTHY`. A schema validator rejects the words guaranteed, safe, liquid,
always, protected, and insured in any claim string or user-facing copy, as a backstop against the
product lying by accident.

A sample is `{ bid, ask, bidSize, askSize, blockNumber, blockHash, source }`. The verdict may only
be computed from a stored sample and a stored commitment. Anything the sampler knew but did not
store is not an input.

### 5.3 Payout

The registry witnesses the market's own trade events through the same subscription, so it can
accumulate traded notional per address inside a window using state it wrote itself. On a recorded
breach, the bond becomes claimable pro rata by the addresses the registry witnessed trading that
market during that window.

This is deliberately narrow. Assize pays the traders it saw. It cannot pay the trader who looked at
an empty book and left without placing an order, which is the very person the product is about.
That limitation is stated in `WHAT_IS_MEASURED.md`, in the README, and out loud in the demo video.

### 5.4 What Assize does not do

It never places an order for a user. Acting on behalf of arbitrary users on the DreamDEX book
requires being on an owner-managed approved-contracts allow-list, which this project has no path to
and does not need. Assize observes, records, and settles bonds. See `DECISIONS.md` D-002.

---

## 6. Trust Boundary

**On chain, and therefore checkable by anyone:** commitments, bonds, samples with their block pins,
verdicts, breach records, witnessed volume, payouts.

**Off chain, and therefore trusted while it is used:** the keeper sampler, in fallback mode only. A
keeper decides when to sample, so it could sample selectively. Mitigations: every keeper sample pins
`blockNumber` and `blockHash`, so a stranger can re-read the book at that block and check the values
we wrote; the cadence is published; and gaps are recorded as `NOT_SAMPLED` rather than smoothed over.

**Not claimed at all:** continuous coverage. Assize measures at instants. The claim is always "no
breach observed at sampled instants in this window", never "the book was covered".

---

## 7. Actors and Roles

| Actor | Does | Trusts | Can lose |
|---|---|---|---|
| Maker | Publishes a commitment, posts a bond, quotes the market | The registry's samples | The bond, on a recorded breach |
| Trader | Trades the market, sees coverage state before sizing up | The chain, and the block pins on each sample | Nothing to Assize |
| Registry contract | Stores commitments, samples, verdicts, bonds, witnessed volume | The reactivity precompile as sole callback caller | Nothing |
| Sampler | Delivers samples in fallback mode | Its RPC | Its own reputation, which is why it pins blocks |
| Verifier (any stranger) | Re-derives every verdict from chain | Only a public RPC | Nothing |

The verifier is the actor this product is designed for. If a stranger cannot check it, we built a
dashboard.

---

## 8. System Architecture

### 8.1 Repository layout

```
.
├── apps/
│   ├── web/                     # coverage surfaces, commitment flow, claim flow
│   ├── maker/                   # baseline maker, Bot Kit lineage, PROJECT_BASELINE
│   └── sampler/                 # fallback keeper, only when reactivity is unavailable
├── packages/
│   ├── assize-sdk/              # read coverage, publish a commitment, verify a breach
│   ├── protocol-types/          # zod schemas: commitment, sample, verdict, claim
│   ├── reference/               # reference envelope evaluator, mirrors the contract
│   ├── verifier/                # re-derives verdicts from chain, no app access
│   └── claim-ledger/            # claims.json and its verifier
├── contracts/
│   ├── src/AssizeRegistry.sol   # commitments, bonds, samples, verdicts, payouts
│   ├── src/CoverageSubscriber.sol  # onEvent handler for the reactivity precompile
│   ├── test/
│   └── script/                  # deployment scripts, DEPLOYMENT.md is generated from these
├── scripts/
│   ├── probe-dreamdex.ts        # read live market metadata and event signatures
│   ├── probe-reactivity.ts      # confirm subscription liveness and handler funding
│   ├── campaign.ts              # sustained coverage campaign (§14)
│   └── verify-testnet.ts        # re-derive every claim from chain
├── docs/
│   ├── phase.md
│   ├── claims.md                # generated, never hand-edited
│   ├── kill-criteria.md         # generated from §26
│   └── runbooks/
├── evidence/
├── deployments/
├── internal/                    # gitignored
└── .github/workflows/ci.yml
```

### 8.2 Measurement paths

**Path R, primary.** `CoverageSubscriber` subscribes to the market's events through the reactivity
precompile. Validators invoke `onEvent`, the handler reads the book and writes a sample. Handler gas
is prefunded per subscription and accounted for in the UI, because an unfunded subscription is a
silent `NOT_SAMPLED`, which is the worst failure this product can have.

**Path K, fallback.** `apps/sampler` submits block-pinned samples on a published cadence. Selected
only if K1 fires. Every sample it writes carries `source: KEEPER`, in storage and on screen.

The two paths write the same sample struct and go through the same verdict function. Nothing
downstream knows which path produced a sample except by reading its label.

### 8.3 DreamDEX surfaces used

markets-sdk for book and trade streams into the web surface. Bot Kit lineage for the baseline maker.
Starter template as the app base. Contract reads for the book state the handler samples. Name only
what is actually used in the README and the submission form.

---

## 9. Product Surfaces

UX is 20% of the score and the brief demands a first-time user succeed unaided, so every state below
is a designed state, not an afterthought. Visual specification lives in `frontend.md`.

| Surface | Purpose | Required states |
|---|---|---|
| Market list | Which markets have a live commitment behind them right now | live, expired, never covered, insufficient samples |
| Market page | The commitment, its window, the sample stream, breaches | covered at last sample, breach recorded, not sampled, window closed |
| Publish a commitment | A maker sets spread, size, window, bond, and prefunds handler gas | insufficient STT with a pointer to the faucet and the Telegram community, invalid envelope, confirmation pending |
| Breach page | The exact sample that caused it, its block pin, and the command to re-derive it | claimable, claimed, expired |
| Claim | A witnessed trader claims a share of a forfeited bond | eligible, not witnessed, already claimed |

Copy is written for a stranger with no crypto fluency. "Not sampled" is explained in a sentence
wherever it appears, because an unexplained gap reads as a bug and destroys trust in the number
above it.

---

## 10. Contract Requirements

`AssizeRegistry.sol`:

- `publishCommitment(marketId, maxSpread, minSize, start, end)` payable with bond, one active
  commitment per maker per market.
- `recordSample(...)` callable only by `CoverageSubscriber`, which is callable only by the
  reactivity precompile, or by the registered keeper in fallback mode.
- `verdictOf(sampleId)` view, mirroring `packages/reference` exactly.
- `claim(breachId)` pro rata against witnessed volume, with a per-address cap and self-match
  rejection (§12).
- Events for every state transition, since the verifier reads events, not our database.

Constraints: no upgradeability, no pause, no admin withdrawal of bonds, no token, no fee switch. The
owner role may register the keeper address in fallback mode and nothing else. If the contract needs
an admin to make a payout correct, the mechanism is wrong.

`packages/reference` is a second implementation of the envelope evaluator in TypeScript. CI runs both
against the same generated inputs and fails on any divergence.

---

## 11. Client and SDK Requirements

`@assize/sdk`, published to npm:

- `getCoverage(marketId)` returns the current commitment, the last sample, its verdict, and its age.
- `publishCommitment(...)` for makers, with envelope validation before the transaction.
- `verifyBreach(breachId)` re-reads the pinned block and re-derives the verdict client side.
- `assize verify <breachId>` CLI in `packages/verifier`, runnable with a public RPC, no account, no
  API key, and no access to our deployment beyond its address.

If verification requires us, it is not verification.

---

## 12. Security Model

**Assets.** Maker bonds. Handler gas prefunds. Sample integrity. The keeper key in fallback mode.

| Adversary | Attack | Required property |
|---|---|---|
| Dishonest maker | Quotes wide, claims coverage anyway | Verdict computed from stored samples only, never from maker input |
| Dishonest claimant | Wash trades inside a window to farm a forfeited bond | Self-match rejection, per-address share cap, and a minimum count of distinct counterparties before a bond is claimable |
| Dishonest sampler | Samples only when the book looks good | Block pins on every sample make selective sampling detectable by re-reading the chain, and gaps are recorded as `NOT_SAMPLED` |
| Spoofed callback | Something other than the precompile calls the handler | `CoverageSubscriber` accepts calls from the reactivity precompile address only, read at deploy time, asserted at runtime |
| Griefing maker | Publishes a commitment then starves handler gas so nothing is sampled | Unfunded subscriptions surface as an explicit unfunded state, and a window that goes unfunded pays the bond out rather than expiring clean |
| Reorg | A sample is written against a block that vanishes | Samples pin `blockHash`, and the verifier rejects a sample whose pin no longer resolves |

---

## 13. Testing Strategy

- Foundry for contracts, vitest for TypeScript, both strict. No `as any`, no `@ts-ignore`, no empty
  `catch {}`.
- Differential test: the Solidity evaluator and `packages/reference` produce identical verdicts over
  10,000 generated commitment and sample pairs. Any divergence fails CI.
- Property tests: `verdict()` total over all sample shapes, including zero size and crossed books.
- Invariants: bond conservation, one claim per address per breach, no payout without a stored breach.
- Access control tests: the handler rejects every caller except the precompile address.
- Reorg test: a sample whose `blockHash` no longer matches is rejected by the verifier.
- Playwright over the market page, the claim flow, and the insufficient-STT state.
- Fixtures live in unit tests only and never reach the public proof path.

The hackathon asks for at least a verification script proving contract interactions work. That is
`scripts/verify-testnet.ts`, and it is a gate, not a nicety.

---

## 14. Adversarial Evidence Campaign

Run `scripts/campaign.ts` against at least one live market with the baseline maker under instruction
to behave badly on purpose:

- widen past the committed spread,
- pull one side entirely,
- thin the size below the committed minimum,
- stop quoting for the rest of a window,
- fund the subscription too thinly and let samples lapse.

Reported output, failures included, in this shape:

```
campaign S2: 412 samples / 361 COVERED_AT_SAMPLE / 44 breaches / 7 NOT_SAMPLED
  SPREAD_BREACH 21 · DEPTH_BREACH 15 · ABSENT 8
  payouts: 3 bonds forfeited to 11 witnessed addresses
  infrastructure: 2 RPC failures, retried, no sample loss
```

`NOT_SAMPLED` is reported on its own line forever. It is never folded into coverage, and never
dropped from the denominator.

---

## 15. Observability and Run Reporting

Every breach page links the sample that caused it, its block pin, and the transaction that wrote it.
Every campaign run writes a dated summary into `evidence/`. `docs/runbooks/` covers: subscription
runs out of gas mid-window, precompile callbacks stop arriving, RPC returns a stale book, keeper
falls behind its cadence, and a claim fails after a bond is already partly withdrawn.

Completion report rule: when a unit of work is finished, cite the exact files changed and the exact
commands run with their outcomes. "Tests pass" is not a report.

---

## 16. Testnet Evidence Plan

Network: Somnia Shannon testnet. STT from the official faucet via the hackathon Telegram community.
Testnet is the official target, and no part of this project touches mainnet or real funds (§25).

Evidence produced, all landing in `evidence/`, `DEPLOYMENT.md`, `claims.json`, and the README table:

1. Deployed registry and subscriber addresses, with deployment transactions.
2. First sample written by the reactivity path, with its callback transaction.
3. First recorded breach, with the sample, its block pin, and the re-derivation command.
4. First payout, with the claimant set and the pro rata arithmetic re-derivable from chain.
5. Sustained campaign totals per §14, including `NOT_SAMPLED`.
6. One recorded infrastructure failure and its recovery.

---

## 17. Protocol Facts and Configuration

No market id, contract address, event signature, precompile address, tick size, or token address is
compiled in. Market metadata comes from the SDK at runtime. The precompile address is read at deploy
time and asserted at runtime. Which market to cover is env configuration, not a constant.

`scripts/probe-dreamdex.ts` and `scripts/probe-reactivity.ts` run at startup and on a CI schedule. On
mismatch the app enters `PROTOCOL_CONFIG_CHANGED`, stops writing samples, and says so on screen
rather than guessing. A CI check fails the build if a hex address literal appears in `apps/` or
`packages/`.

---

## 19. Documentation Requirements

`README.md` opens with the five official beats in text: problem, solution, product, demonstration,
future vision. Then: an ASCII mechanism block, the links line (testnet app, demo video, repo, npm),
why this needs to exist and why the obvious fix fails, the live evidence table with real transaction
hashes, "how could this result be misleading", verify it yourself with copy-pasteable commands that
work from a clean clone with no account, repository layout, and limitations.

Also required at root: `DEPLOYMENT.md` with contract addresses, chain id, and deployment steps.
`SETUP.md`, `.env.example`, `LICENSE`, `SECURITY.md`, `ARCHITECTURE.md`.

The limitations section is written before the demo video is recorded, and it names at minimum:
sampling happens at instants and not continuously; payouts reach witnessed traders only; the keeper
path, if used, is a trusted observer whose only defence is block pinning.

---

## 20. Open-Source Contribution Requirement

The hackathon lists an SDK and documentation feedback report as optional and score-relevant. Treat it
as required. It must come from real friction, with reproducible steps, exact SDK versions, request
and response payloads, and the specific documentation pages that were wrong or missing. File it where
the organisers asked, and link it from the README.

If `packages/assize-sdk` produces something generally useful for Bot Kit users, offer it upstream.

---

## 21. Claim and Evidence Ledger

`packages/claim-ledger/data/claims.json` is the source of truth. `docs/claims.md` is generated from
it. `pnpm claim:verify` re-reads every claim from chain.

**Proof ladder.** A claim may not state a rung its evidence does not reach.

| Rung | Meaning |
|---|---|
| R0 | Asserted in a document |
| R1 | Covered by a passing test, including the Solidity and TypeScript differential |
| R2 | Executed once against a live DreamDEX market on Shannon, transaction recorded |
| R3 | Executed repeatedly across a sustained window, failures included in the published count |
| R4 | Re-derived by `packages/verifier` from a fresh clone against a public RPC |

**Seed claims:**

| id | Claim | Target rung |
|---|---|---|
| C-001 | A breach is recorded only from a stored, block-pinned sample | R4 |
| C-002 | Any stranger can re-derive a recorded verdict from chain alone | R4 |
| C-003 | Samples were delivered by the Somnia reactivity path on a live market | R3 |
| C-004 | A real quoting breach was recorded against a live market | R2 |
| C-005 | A forfeited bond was paid to witnessed traders, pro rata, on chain | R2 |
| C-006 | Sampling gaps are recorded as `NOT_SAMPLED` and never counted as coverage | R3 |
| C-007 | A first-time user published a commitment unaided from the live app | R2 |

---

## 22. Acceptance Gates

A gate passes when its command exits zero on a fresh clone. There is one gate for every weighted
criterion, because the score is the specification.

| # | Gate | Command | Passes when | Serves |
|---|---|---|---|---|
| G1 | No compiled-in protocol facts | `pnpm probe:all` | Probes read live metadata and the address-literal check finds nothing in `apps/` or `packages/` | Technical |
| G2 | Evaluator agreement | `pnpm test:differential` | Solidity and `packages/reference` agree on 10,000 generated pairs, zero divergence | Technical |
| G3 | Live reactivity sample | `pnpm verify:testnet -- C-003` | At least one sample written by a precompile callback on a live market, callback transaction resolving, `source: REACTIVITY` | Technical |
| G4 | Recorded breach | `pnpm verify:testnet -- C-004` | A breach recorded against a live market, with the sample and its block pin, re-derivable | Innovation, Technical |
| G5 | Payout executed | `pnpm verify:testnet -- C-005` | A forfeited bond paid to witnessed addresses, arithmetic re-derivable from chain | Business |
| G6 | Sustained campaign | `pnpm campaign -- --min-samples 300 --window 24h` | 300 or more samples across at least 24 hours on a live market, totals published including `NOT_SAMPLED` | Business, Technical |
| G7 | Clean-room reproduction | fresh clone, README only | A stranger reaches the live app, reads coverage, and re-derives one breach using only the README | Technical, Presentation |
| G8 | Vocabulary and ledger | `pnpm claim:verify` | No forbidden word in any claim or UI string, and no claim above its evidence rung | Presentation |
| G9 | First-time user | `pnpm ux:report` | Three strangers each completed the core action unaided, timed, with their failure points recorded verbatim and either fixed or documented | UX |
| G10 | Every state reachable | `pnpm test:e2e` | Loading, empty, error, insufficient STT with faucet pointer, not sampled, and window closed are all reachable in the deployed app | UX |
| G11 | Handler funding | `pnpm probe:reactivity` | Subscription funding, consumption, and the unfunded state are proven on chain, with the cost per sample published | Technical |
| G12 | Submission package | `pnpm submission:check` | Testnet app live, repo public with `DEPLOYMENT.md` and `LICENSE`, video recorded to the five beats, feedback report filed | Presentation |

---

## 23. Demo Script Requirements

Two to three minutes, five beats in the official order, showing the working testnet app.

1. **Problem.** A market page with a price on a book that is not there. Ten seconds, no jargon.
2. **Solution.** A maker publishes a commitment and posts a bond. The envelope is legible on screen.
3. **Product.** Samples arrive. The coverage state changes in front of the viewer.
4. **Demonstration.** The maker breaks the commitment on purpose. The breach is recorded, the sample
   that caused it is opened, a witnessed trader claims the bond, and the transaction is shown. Then
   the limitation is said out loud: sampling happens at instants, and payouts reach witnessed traders
   only.
5. **Future vision.** Commitments as a listing requirement for new markets, and coverage as something
   a venue can advertise because it is measured rather than asserted.

Judges may drive the deployed app. Every beat must survive a cold start with no rehearsed cache.

---

## 24. Submission Package

| Artifact | Requirement |
|---|---|
| Working prototype on Shannon testnet | Live URL, cold start, core flow completes on chain |
| GitHub repository | Public, README with the five beats, `SETUP.md`, `.env.example`, `LICENSE`, `DEPLOYMENT.md` with contract addresses |
| Demo video | 2 to 3 minutes, five beats, real testnet interaction |
| Presentation deck, optional | Same five beats |
| SDK and docs feedback report, optional | Filed per §20 |

Nothing is submitted before G12 passes, and no artifact is produced for the first time on the last
day.

---

## 25. Non-Goals

- No mainnet, no real money, no token. Testnet is the official target, and inventing more is a rule
  violation rather than ambition.
- Not a market maker. The baseline maker exists to be measured and to misbehave on cue.
- Not an insurance product. A bond is forfeited on a measured breach, not underwritten against loss.
- Not an analytics dashboard. Volume charts are somebody else's build.
- Not a continuous liquidity oracle. Instants only, always said out loud.
- No order placement on behalf of users (§5.4).
- No multi-market breadth before the single-market seam is proven (§27).

---

## 26. Kill Criteria and Escalation

If any condition below becomes true, stop claiming the affected capability, record it with status
`failed` or `unavailable` and a plain-language blocker, print it in the build report, and keep
building everything that still stands. Do not hide a blocked capability behind a substitute. Do not
soften the wording to keep the claim alive.

| # | Condition | Claims affected | Action |
|---|---|---|---|
| K1 | Event contract markets emit no event the reactivity precompile can subscribe to | C-003, Path R | Switch to Path K, label every sample `KEEPER`, delete every claim about validator-delivered measurement, and publish the cadence and its trust cost |
| K2 | Handler gas per sample makes a useful window unaffordable at faucet rates | C-003, C-006 | Reduce cadence to the coarsest event that still moves the book, publish the cost per sample and the resolution it buys, and never describe the result as continuous |
| K3 | The registry cannot witness per-address fills | C-005, §5.3 | Narrow payouts to traders who registered before the window, drop C-005 to R1, and say plainly that most affected traders cannot be reached |
| K4 | The book read exposes no size at the committed depth | C-001, C-004 | Measure spread only, remove `DEPTH_BREACH` from the product and the UI, and state that depth is unmeasured |
| K5 | No third-party maker posts a bond | adoption claims | Run the baseline maker, label it `PROJECT_BASELINE` everywhere, and count nothing as adoption or demand |
| K6 | A breach is recorded that did not occur | C-001, C-004, all of §14 | Stop the campaign, publish the incident with the bad sample and the true book state, ship the fix, restart counts from zero. Prior totals are not reused |
| K7 | A bond is drained by wash claims | C-005 | Suspend payouts, ship self-match rejection and per-address caps, publish the incident and the addresses involved |
| K8 | STT funding cannot cover the campaign | C-006, G6 | Shrink the window and the number of markets, publish the exact funding available and what it bought, and never present a shortened window as a full one |
| K9 | The hackathon window is closed and no extension is announced | the entire submission path | `OWNER DECISION`. Either stop, or continue as an independent ship targeting the next Somnia programme. Do not submit to a closed hackathon, do not backdate a repository, and do not restate the deadline as something it was not |
| K10 | G4 has not passed with 48 hours left in the window | scope | Cut payouts, cut multi-market, cut the claim flow. Protect G3, G4, G7, G9, and G12 in that order. Record the cut and its cost in `DECISIONS.md` |
| K11 | A published verdict cannot be re-derived by a stranger | C-002, all R4 targets | Drop every affected claim to R2, delete "independently checkable" from all copy, and publish exactly which input is missing |

---

## 27. Phases and Stop Boundaries

Phases are gate-bounded, not calendar-bounded. Do not implement a later phase's breadth before the
current phase's gate passes. Building on an unproven seam is the failure mode this repository is
organised to prevent.

| Phase | Contents | Stop boundary |
|---|---|---|
| P1 | `protocol-types`, `reference`, registry contract, differential harness, probes | G1 and G2 pass. Nothing is deployed before both evaluators agree |
| P2 | Deploy, subscribe, first live sample, first recorded breach | G3, G4 and G11 pass. One market only. No UI beyond a raw sample list |
| P3 | Payout, witnessed volume, campaign, verifier CLI | G5 and G6 pass |
| P4 | Web surfaces per `frontend.md`, SDK publication, user testing, submission | G7 to G10 and G12 pass |

`docs/phase.md` names the current phase and its boundary, is read at the start of every session, and
is updated in the commit that closes a gate.

---

## 28. Definition of Done

- [ ] Every gate in §22 passes on a fresh clone
- [ ] Every claim in §21 states a rung its evidence reaches, and `pnpm claim:verify` exits zero
- [ ] A live sample, a real breach, and a real payout, all on Shannon, all linked and re-derivable
- [ ] Campaign totals published with `NOT_SAMPLED` on its own line
- [ ] Three strangers completed the core action unaided, and what tripped them is fixed or written down
- [ ] README opens with the five beats, and the limitations section is specific
- [ ] `DEPLOYMENT.md`, `SETUP.md`, `.env.example`, `LICENSE`, `SECURITY.md`, `ARCHITECTURE.md` present
- [ ] Demo video recorded, 2 to 3 minutes, showing the breach before the fix
- [ ] SDK and documentation feedback report filed
- [ ] `DECISIONS.md` and `BUILD_LOG.md` current, every cut recorded and costed
- [ ] No forbidden vocabulary, no address literal in source, no mainnet anywhere
