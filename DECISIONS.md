# DECISIONS

Append-only. Entries are never edited. When a decision is superseded, the old entry stays and the new
one says so. Every entry records what was decided, what evidence forced it, and what it costs.

---

## D-001: Measurement is delivered by the Somnia reactivity precompile, with a keeper as a labelled fallback

**Date:** draft, before first code
**Status:** accepted, unproven. Proving it is gate G3.

**Evidence.** Somnia exposes a reactivity precompile that lets a contract subscribe to another
contract's events and be invoked by validators when they fire. DreamDEX's own spot stop orders are
built on exactly this pattern: a registry subscribes to the pool's price update event, the precompile
invokes its handler, the caller is restricted to the precompile address, and handler gas is prefunded
by the user. That is the shape Assize needs, pointed at a different question.

**Cost.** Sampling becomes event-driven, so resolution is whatever the market emits, and a
subscription that runs out of gas produces silence rather than an error. We therefore owe the user an
explicit unfunded state, a visible `NOT_SAMPLED` count, and a published cost per sample. If the event
contract markets emit nothing subscribable, K1 fires and every claim about validator-delivered
measurement is deleted rather than softened.

---

## D-002: The registry never places orders on behalf of users

**Date:** draft, before first code
**Status:** accepted

**Evidence.** Placing orders for arbitrary users on the DreamDEX book requires membership of an
owner-managed approved-contracts allow-list. A hackathon project has no path onto that list, and
designing around a permission we cannot obtain is how a build dies in its last 48 hours.

**Cost.** Assize cannot force a maker to quote. It can only measure and penalise. That weakens the
pitch from "liquidity you can rely on", which we could not have honestly claimed anyway, to
"liquidity with a measured penalty", which is what the evidence can carry. Our baseline maker runs as
an ordinary account and is labelled `PROJECT_BASELINE` everywhere it appears.

---

## D-003: A commitment window is expressed in block numbers, not timestamps

**Date:** 2026-09-10, Phase P1
**Status:** accepted

**Evidence.** PRD §5.2 fixes the sample struct exactly:
`{ bid, ask, bidSize, askSize, blockNumber, blockHash, source }`, and states that the verdict "may
only be computed from a stored sample and a stored commitment". PRD §0.3 forbids inventing a struct
layout or a field name, so no timestamp field may be added to carry a wall-clock reading. That
leaves `blockNumber` as the only temporal field a verdict is allowed to read, so `start` and `end`
are block numbers, inclusive at both ends.

**Cost.** `frontend.md` §3.6 describes the publisher form as "Window Duration (Start timestamp to
End timestamp)". That remains a presentation concern: the form converts a duration the maker
understands into the block range the contract stores, and the conversion depends on block cadence,
so a window will not land on an exact wall-clock boundary. The UI must show the block range it is
about to commit to rather than only the time, or a maker will believe they bought a window they did
not. Flagged for Phase P4.

---

## D-004: The verdict precedence ladder, and why ABSENT is decided before a crossed book

**Date:** 2026-09-10, Phase P1
**Status:** accepted. Superseded once during P1, see below.

**Evidence.** PRD §5.2 enumerates seven states but does not order them, and a sample can satisfy
several conditions at once. One sample yields one state, so an order is required and must be
identical in both implementations. The ladder is:

```
1 NOT_SAMPLED        blockNumber == 0
2 SAMPLER_FAILED     unpinned, or unlabelled          (structural)
3 WINDOW_CLOSED      outside [start, end]
4 ABSENT             any of bid, ask, bidSize, askSize is zero
5 SAMPLER_FAILED     bid > ask, both sides quoted     (crossed)
6 SPREAD_BREACH      spread bps > maxSpread
7 DEPTH_BREACH       either side below minSize
8 COVERED_AT_SAMPLE  otherwise
```

**The correction.** The ladder first written during P1 tested for a crossed book at rung 2, alongside
the other reasons a record is unusable. A unit test then showed the consequence: a sampler that reads
an empty ask side writes `ask = 0`, which is arithmetically crossed against any positive bid, so a
maker who pulled one side entirely was classified `SAMPLER_FAILED`. That state is not a breach, so
the bond did not forfeit — and "pull one side entirely" is one of the five misbehaviours PRD §14
instructs the campaign to perform on purpose. The crossed test therefore moved below ABSENT, where it
is reachable only with both sides quoted, which is the only case in which a crossed reading really is
our failure rather than the maker's quote.

Both implementations shared the mistake, so `pnpm test:differential` passed throughout: the two
evaluators agreed with each other and were both wrong. G2 proves agreement, not correctness. This is
recorded because it is the specific limitation of a differential gate, and it will recur.

**Cost.** `SAMPLER_FAILED` occupies two rungs, so verdict precedence is no longer identical to the
numeric enum order. The wire encoding in `VERDICT_CODE` is unchanged and remains shared with Solidity.

---

## D-005: Spread is measured in basis points of mid, so no tick size is compiled in

**Date:** 2026-09-10, Phase P1
**Status:** accepted

**Evidence.** PRD §17 forbids compiling in a tick size, and prices arrive from the venue's book in
the venue's own units. Measuring spread as a ratio makes the test invariant to that scale:

```
bps = (ask - bid) * 20000 / (ask + bid)      [floored, mid = (ask + bid) / 2]
```

The same relative spread yields the same number at any price scale, so Assize measures spread
without ever learning what a tick is worth. Prices and sizes are stored as the raw integers that
were read, and are never converted.

**Cost.** The result is floored, so a spread is reported to whole basis points and a sub-basis-point
breach is not visible. The committed bound is inclusive, which `frontend.md` §3.2 corroborates
("Committed: <= 200 bps"). `minSize` is compared in the book's own size units, so a commitment's
depth figure is only meaningful next to the market it was published against.

---

## D-006: Phase P1 stops at the breach record; the registry escrows bonds it cannot yet pay out

**Date:** 2026-09-10, Phase P1
**Status:** accepted, deliberately temporary. Removed by Phase P3.

**Evidence.** `docs/phase.md` lists payouts as explicitly out of scope for P1, and PRD §27 forbids
implementing a later phase's breadth before the current phase's gate passes. `AssizeRegistry.sol`
therefore implements `commitment -> sample -> verdict -> breach record` and stops. There is no
`claim()`, no witnessed volume, and no path by which ETH leaves the contract — including for the
owner, whose only power is registering a fallback keeper.

**Cost.** The contract holds bonds it cannot release, so it is not deployable as it stands. That is
consistent with P1, whose stop boundary deploys nothing at all, but it is a real constraint and not
a detail: were this deployed today, an honest maker whose window closed clean could not recover their
bond. Foundry's `locked-ether` lint reports exactly this; the finding is suppressed in `foundry.toml`
with a comment pointing here rather than silently, and the suppression is removed when P3 lands
settlement. `test_no_settlement_path_exists_in_phase_p1` asserts the current state so the deferral is
visible in the test output rather than implied.

---

## D-007: The forbidden vocabulary is enforced as seven words, and the rulebook is exempt from the rule

**Date:** 2026-09-10, Phase P1
**Status:** accepted

**Evidence.** AGENTS.md lists seven forbidden words. PRD §5.2 and `frontend.md` §1.6 list the first
six, omitting the seventh. AGENTS.md states that it overrides anything inferred from surrounding
files, and `packages/claim-ledger/data/claims.json` independently lists all seven in its `rules`
array, so the union of seven is what `pnpm check:vocabulary` enforces.

The check scans source and comments under `apps/`, `packages/`, `scripts/`, `contracts/src` and
`contracts/test`, the claim text in `claims.json`, and the user-facing documents at the repository
root. It does not scan the documents that define the rule — `PRD.md`, `AGENTS.md`,
`WHAT_IS_MEASURED.md`, `frontend.md`, `DECISIONS.md`, `docs/kill-criteria.md` — nor the `rules` array
in `claims.json`, nor `packages/protocol-types/src/vocabulary.ts`, which holds the list. Each of
those has to name the words in order to forbid them.

**Cost.** The rule is mechanical, so it also catches ordinary engineering English. On first run it
found eight occurrences in this repository's own source, including "guaranteed by" in a precondition
comment and "safe from underflow" in an arithmetic note. All eight were rewritten rather than
exempted: a mechanical backstop with a carve-out for "but I used it correctly" is no longer
mechanical, and PRD §5.2 wants the words gone precisely so that nobody has to make that judgement.

---

## D-008: Vocabulary matching is on word boundaries

**Date:** 2026-09-10, Phase P1
**Status:** accepted

**Evidence.** Substring matching is unusable in both directions. It would reject "liquidity", which
`frontend.md` §3.1 mandates in the product's own headline ("Liquidity is a quoting commitment backed
by an on-chain bond"), and it would reject `safeParse`, an ordinary library call. Word-boundary
matching still catches every bare word the rule is aimed at.

**Cost.** A compound that carries the same overclaim in a different form would pass — "ultra-liquid"
matches, but a coinage like "liquidness" would not. The check is a backstop against writing one of
these words by accident, not a substitute for reading the copy.

---

## D-009: The repository was laid out to the PRD §8.1 paths, and `frontend.txt` was renamed

**Date:** 2026-09-10, Phase P1
**Status:** accepted

**Evidence.** Every governance file sat at the repository root, while PRD §8.1, AGENTS.md and
`docs/phase.md` all refer to them by nested paths. `phase.md` moved to `docs/phase.md`,
`kill-criteria.md` to `docs/kill-criteria.md`, `claims.json` to
`packages/claim-ledger/data/claims.json`, `ci.yml` to `.github/workflows/ci.yml`, and `env.example`
to `.env.example`. `frontend.txt` was renamed to `frontend.md`: every reference in PRD.md and
AGENTS.md names `frontend.md`, and the file's own header declares itself as
"frontend.txt / frontend.md". The repository was also not under version control; `git init` was run,
since AGENTS.md requires a claim and its evidence to land in the same commit.

**Cost.** None to content. Any external link to the old paths breaks.

---

## D-010: G1's live half cannot run in the current environment, and G1 is not claimed as passed

**Date:** 2026-09-10, Phase P1
**Status:** blocked, recorded per PRD §26

**Evidence.** Two inputs G1 needs are unavailable here, established by direct check rather than
assumption:

1. **No DreamDEX SDK.** `@dreamdex/markets-sdk`, `@dreamdex/bot-kit`, `@dreamdex/sdk`, `dreamdex`
   and `dreamdex-sdk` all return 404 from the npm registry, and a registry keyword search for
   "dreamdex" returns zero packages. AGENTS.md §0.2 requires the SDK be pinned by source, path and
   SHA-256 before use, and §0.3 forbids inventing a method name, an argument shape or a return field.
   The market-metadata read in `scripts/probe-dreamdex.ts` is therefore left unwritten and reports
   `BLOCKED`, rather than being hand-rolled against a guessed interface.
2. **No route to Shannon.** `dream-rpc.shannon.somnia.network` does not resolve from this
   environment, so no live chain read is possible. The probe machinery itself was verified against a
   reachable public RPC: it reads a chain id, distinguishes an address with code from one without,
   rejects a malformed address, and reports an RPC error as `BLOCKED` rather than as a result.

**Effect.** G2 passes. G1's static half passes. G1 as a whole does **not** pass, `pnpm probe:all`
exits non-zero, and `docs/phase.md` keeps Phase P1 open. No claim in `claims.json` was raised, and
nothing states that protocol facts are read from a live source. PRD §26: record the blocker, keep
building what still stands, and do not hide it behind a substitute.

**Cost.** Phase P2 cannot begin. Unblocking needs either network access to Shannon and the DreamDEX
SDK, or the owner's decision under K9 about whether this build continues at all.

---

## D-011: Committed spread is an absolute bound in the book's price units, not a ratio of mid

**Date:** 2026-09-10, Phase P1
**Status:** accepted. **Supersedes D-005**, which stays above as the record of what was tried.

**Evidence.** D-005 measured spread as basis points of mid, chosen when no price semantics were
available and scale-invariance was the only way to avoid compiling in a tick size (PRD §17). With
`frontend.md` read against real numbers, that formula contradicts the design authority twice:

| `frontend.md` | ask − bid | the document says | bps of mid (D-005) | bps of one contract |
|---|---|---|---|---|
| §3.2 `0.4920 / 0.5080` | 0.0160 | 160 bps | 320 | **160** |
| §3.7 `0.4700 / 0.5350` | 0.0650 | 650 bps | 1293 | **650** |

Both worked examples render spread against one whole contract, not against mid. Upstream corroborates
the scale: pinned `IEventContracts.sol` documents `price` as "probability in 1e6 units (900000 =
0.90)" and `oneCollateral` as "1e6 on testnet — one whole contract".

**What changed.** `maxSpread` is now the widest tolerated `ask - bid`, expressed in the book's own raw
price units, and the test is `ask - bid > maxSpread`. Both the sample's prices and the bound come from
the same book, so the comparison needs no scale factor at all — which satisfies PRD §17 more
directly than D-005 did, rather than less. `maxSpread` widened from `uint32` to `uint128` to match the
price width it is now compared against.

Rendering a spread in basis points for a reader does need the market's `oneCollateral`, which is not
a field of the stored sample. PRD §5.2 allows a verdict to read stored data only, so that conversion
lives outside the evaluator, in `spreadBps(bid, ask, priceScale)` in `packages/reference`, marked
display-only and covered by a test that reproduces both of the numbers in the table above.

**Cost.** An absolute bound treats a 0.02 spread the same at a 0.05 market and a 0.50 market, where
the ratio rule would have called the first far worse. For a probability book that is the right
behaviour — a trader crossing a 2-cent spread pays 2 cents either way — but it is a real difference
in what a commitment means, and it is the design authority's choice rather than ours. Makers should
be shown the bound in both forms in Phase P4.

---

## D-012: What the pinned upstream settles — K1 and K3 both stand down

**Date:** 2026-09-10, Phase P1
**Status:** accepted

**Evidence.** The owner supplied the Bot Kit, the Event Contracts documentation and the starter
template. All are now pinned in `skills-lock.json`, along with `@somnia-chain/markets-sdk@0.29.0`,
which is the real SDK — every earlier search failed because it was guessed as `@dreamdex/*`, which
does not exist. Reading them settles four open questions:

1. **K1 does not fire.** The order book emits `OrderPlaced`, `OrderRested`, `OrderFilled`,
   `OrderCancelled`, `OrderExpired`, `OrderReduced` and more (`orderBookEventsAbi`). There is an
   event to subscribe to, so Path R remains the primary measurement path. The SDK also ships
   `spotStopRegistryEventsAbi` and `spotStopRegistryWriteAbi` — the spot stop-order registry that
   D-001 cites as the pattern Path R copies, now confirmed to exist rather than recalled.
2. **K3 does not fire.** `OrderFilled` carries only order ids, but `OrderPlaced` carries
   `placedOrder.owner`. Witnessing per-address fills is therefore possible by correlating the two,
   at the cost of an on-chain `orderId -> owner` map. One real limitation follows: the registry can
   only attribute a fill whose `OrderPlaced` it witnessed, so an order resting from before the
   subscription began fills to an unknown owner. That is narrower than K3's failure but it is not
   nothing, and it belongs in `WHAT_IS_MEASURED.md` when payouts land in Phase P3.
3. **The book read is `getBookLevels(bool isBid, uint64 numLevels)`**, returning
   `{ price, quantity }` levels. The pinned template flags that struct as the one thing to confirm
   against the live ABI; the pinned SDK's own `BookLevel` interface has the same two fields in the
   same order, so two independent pinned sources agree. Assize samples the top level of each side.
4. **Somnia caps `eth_getLogs` at 1000 blocks per call.** Discovery walks backwards in windows.
   This is not guessable and is now honoured in `scripts/probe-dreamdex.ts`, which counts failed
   windows rather than swallowing them: "no markets found" and "we could not look" are different
   answers.

**Also established, by running against the live chain rather than by reading.** Shannon testnet is
chain 50312 at `https://dream-rpc.somnia.network`. `pnpm probe:dreamdex` exits zero against it,
discovering 38 `MarketCreated` logs and 6 live markets, and confirming a configured market id.

**Cost.** The SDK does not list `./dist/eventsAbi.js` in its `exports` map, so `marketCreatorEventsAbi`
— which carries `MarketCreated`, the only place a `marketId` is published — has to be reached by
resolving the package root first. The pinned template does the same thing by relative path. Recorded
as friction for the SDK feedback report (PRD §20).

---

## D-013: `frontend.md` names an RPC hostname that does not resolve

**Date:** 2026-09-10, Phase P1
**Status:** open. **`OWNER DECISION`** — the design authority is not ours to edit.

**Evidence.** `frontend.md` §3.7 specifies the stranger-verification command as copyable UI copy:

```
assize verify --breach 0x9c3e2... --rpc https://dream-rpc.shannon.somnia.network
```

`dream-rpc.shannon.somnia.network` does not resolve. The endpoint that does, named in the pinned
starter template's `.env.example` and confirmed by a live `eth_chainId` returning 50312, is
`https://dream-rpc.somnia.network`.

**Why this is not fixed silently.** `frontend.md` is the sole design authority and this is a piece of
copy it specifies exactly. But it is copy a judge would paste, and it would fail — G7 is a stranger
reaching the live app and re-deriving a breach using only the README, so a command that cannot
connect fails a gate rather than merely reading oddly.

**Recommendation.** Correct `frontend.md` §3.7 to `https://dream-rpc.somnia.network`. Until the owner
does, no surface has been built that carries the string — the breach page is Phase P4 — so nothing is
shipped either way. Assize's own configuration takes the endpoint from `SOMNIA_RPC_URL` and never
from a literal (PRD §17), so this affects the displayed command only.

---

## D-014: G1's last blocker is the Somnia reactivity reference, and nothing else

**Date:** 2026-09-10, Phase P1
**Status:** blocked, recorded per PRD §26. **Supersedes D-010**, which is now out of date in both of
its parts.

**What D-010 said, and what changed.** D-010 recorded two blockers: no DreamDEX SDK, and no route to
Shannon. Both are gone.

- The SDK exists as `@somnia-chain/markets-sdk`, now pinned at 0.29.0. The earlier 404s were the
  consequence of guessing `@dreamdex/*`, which is not the package. Guessing a package name is the
  same error as guessing an ABI, and it produced the same result: a confident, wrong answer that
  looked like evidence of absence.
- Shannon is reachable at `https://dream-rpc.somnia.network`, chain 50312. The hostname in
  `frontend.md` §3.7 does not resolve (D-013).

`pnpm probe:dreamdex` now exits zero against the live chain.

**What is still blocked.** `pnpm probe:reactivity` needs the reactivity precompile's address, and
that address is in none of the pinned sources. It is not in `SOMNIA_TESTNET_ADDRESSES`, not in the
Bot Kit, and not in the starter template. The SDK ships `spotStopRegistryEventsAbi` and
`spotStopRegistryWriteAbi`, which prove the spot stop-order registry exists, but the registry is the
precompile's *caller*, not the precompile, and its calling convention is not published in anything
inspected so far.

The Somnia reactivity reference is the fourth item in AGENTS.md §0.2's pinning list and the only one
not supplied. PRD §0.3 forbids inventing a precompile calling convention, so `probe-reactivity.ts`
reports `BLOCKED` and `CoverageSubscriber.sol` is not written.

**Effect.** G2 passes. G1's static half passes, and its DreamDEX half now passes against the live
chain. G1 as a whole does not pass, `pnpm probe:all` exits non-zero, and Phase P1 stays open. No
claim in `claims.json` was raised.

**What would unblock it.** The Somnia reactivity documentation — the precompile address on Shannon
and the `onEvent` handler convention. With it, `probe:reactivity` completes, G1 closes, and P2 can
begin. Without it, the fallback is PRD §26 K1: switch to Path K, label every sample `KEEPER`, delete
every claim about validator-delivered measurement, and publish the cadence and its trust cost. K1 is
not fired here, because the blocker is a missing document rather than a missing capability — the
markets do emit subscribable events (D-012).

---

## D-015: G1 passes. Phase P1 is complete, and the reactivity path is confirmed to exist

**Date:** 2026-09-10, Phase P1
**Status:** accepted. **Supersedes D-014**, whose blocker is resolved.

**Evidence.** The Somnia reactivity reference is published at
`https://docs.somnia.network/developer/reactivity/reactivity-onchain.md`, and GitBook serves every
page as raw Markdown by appending `.md` — which is how it was read, the HTML being a client-rendered
shell with no content in it. It is now pinned in `skills-lock.json`, alongside
`@somnia-chain/reactivity-contracts@0.2.1`, which is pinned but deliberately not installed: P1
deploys nothing and writes no subscriber.

What it settles, all of it read rather than recalled:

- The precompile is at `0x0100`, exposed in Solidity as
  `SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS`.
- A handler inherits `SomniaEventHandler` and overrides
  `_onEvent(address emitter, bytes32[] eventTopics, bytes data)`.
- **Inside a reactive call, `msg.sender` is `0x0100`.** That is precisely the access control PRD §12's
  spoofed-callback row requires, and it is now a fact rather than an assumption.
- The subscription owner pays gas per invocation; the balance floor is enforced only at creation, and
  a subscription keeps firing until the owner cannot pay an individual invocation.
- Two JSON-RPC methods, `somnia_reactivityGetSubscriptions` and
  `somnia_reactivityGetSubscriptionInfo`, expose subscription state including `gas_limit` and
  `max_fee_per_gas`. These are what gate G11 will read.

**One finding that would have made the probe lie.** `eth_getCode` at `0x0100` on Shannon returns
`0x`. A precompile is implemented by the node and has no deployed bytecode. The previous
`probe-reactivity.ts` treated empty code as `PROTOCOL_CONFIG_CHANGED`, so it would have reported
reactivity as missing on a chain where it works — a false negative in the one direction this product
cannot afford, since it would have argued for firing K1 and abandoning Path R. Liveness is now proven
by the RPC method's presence instead, distinguishing `-32601` (method absent) from `-32602` (method
present, arguments rejected). Established by experiment against the live node, not by reading.

**Result.** `pnpm probe:all` exits zero: 10 checks, none blocked. **G1 and G2 both pass, so Phase P1's
stop boundary is met.**

**What this does not establish.** That reactivity exists on Shannon is not evidence that Assize has
delivered a sample by it. That is claim C-003 and gate G3, and it belongs to Phase P2. No claim was
raised on the strength of the probe, and evidence attached to C-003 was removed for saying more about
the network than about this product.

**Cost.** The reference warns that a subscription's logs are themselves matched against
subscriptions, so "a subscription can provoke a recursive explosion, unstoppably draining the owner's
balance". Assize's subscriber writes samples, and writing a sample emits `SampleRecorded`. If that
event ever matches Assize's own filter the loop is self-feeding and drains the handler prefund. The
P2 filter must exclude the registry's own address, and a test must prove it. Recorded here so that
P2 meets it as a requirement rather than as an incident.

---

## D-016: A reactivity sample pins its block's parent hash, because no contract can see its own

**Date:** 2026-09-10, Phase P2
**Status:** accepted

**Evidence.** PRD §6 rests the whole trust argument on block pinning: "a stranger can re-read the
book at that block and check the values we wrote", and PRD §12's reorg row rejects a sample whose pin
no longer resolves. `AssizeRegistry` enforces it by refusing a sample whose `blockHash` is zero.

A handler running inside block N cannot obtain block N's hash — the hash does not exist until the
block is sealed, and `blockhash(block.number)` returns zero. So a `REACTIVITY` sample cannot pin its
own block's hash, and the choice is between pinning something else or not pinning at all.

`CoverageSubscriber` stores `blockNumber = N` and `blockHash = blockhash(N - 1)`, the parent hash. A
verifier checks `getBlock(blockNumber).parentHash == sample.blockHash`. That identifies block N on
the canonical chain exactly as tightly as its own hash would: a reorg that replaces block N replaces
its parent linkage too, so the check fails in the same cases.

**Cost, and it is real.** Two things a reader could reasonably assume are not true.

First, the field is named `blockHash` and holds a parent hash. PRD §5.2 fixes the field name and
PRD §0.3 forbids changing a struct layout, so it cannot be renamed. Any surface that shows it must
label it for what it is, and `packages/verifier` must check it as a parent hash. Wrong on this point
and the verifier rejects every honest sample.

Second, the handler runs as a synthetic transaction after the block's user transactions, so the book
it reads is block N's state at that moment. A verifier calling `getBookLevels` at block N reads block
N's *final* state. Those agree unless another reactive transaction in the same block moved the book
between the two. Assize never trades, so it cannot cause that itself, but it cannot rule it out for
others. This belongs in `WHAT_IS_MEASURED.md` before any breach is published: a sample is a reading
at a position inside a block, not a reading of the block's closing state.

---

## D-017: Registry and subscriber are wired by address prediction, not by a setter

**Date:** 2026-09-10, Phase P2
**Status:** accepted

**Evidence.** `AssizeRegistry` takes its subscriber in the constructor as an immutable, and
`CoverageSubscriber` takes its registry the same way. Each needs the other's address, so one must be
known before it exists.

The alternative was a setter on one of them. It was rejected: PRD §10 allows the owner to register a
keeper "and nothing else", and a settable subscriber is an admin path to redirect who may write
samples — which is the authority the whole measurement rests on. Better to make deployment slightly
awkward than to leave a lever that can move sampling after the fact.

So the deploy script computes the subscriber's address before deploying the registry, which `CREATE`
makes deterministic from the deployer and its nonce, and then asserts the prediction held.
A mis-prediction fails the deployment instead of producing a registry no subscriber can write to.

**A funding requirement found by test, not by deployment.** The pinned library refuses to subscribe
unless the subscription owner already holds `SUBSCRIPTION_OWNER_MINIMUM_BALANCE`, and the owner is
the subscriber contract itself. So the subscriber must be funded from the faucet before it can
subscribe at all, and funded again to pay per-callback gas afterwards — the reference is explicit
that the minimum is checked only at creation and is not an escrow. This surfaced as
`InsufficientBalance()` in a test rather than as a failed testnet transaction, and
`test_subscribing_requires_the_minimum_owner_balance` now holds it in place.

**Cost.** The deployer needs meaningful testnet funds before anything can be measured: the bond, the
subscriber's minimum balance, and a per-callback gas budget, on top of ordinary deployment gas.
PRD §26 K8 governs if the faucet cannot supply it — shrink the window, publish exactly what the
funding bought, and never present a shortened window as a full one.

---

## D-018: The book layout is confirmed against a live pool; fork testing is not available

**Date:** 2026-09-10, Phase P2
**Status:** accepted

**Why this needed settling.** Assize's entire measurement is the top of a DreamDEX book, so the shape
of what `getBookLevels` returns is the most load-bearing protocol fact in the product. The pinned
starter template flags `OrderBookLevel` as the one struct to confirm against a deployed pool before
relying on it. D-012 recorded that the pinned SDK's `BookLevel` agrees with it — but two documents
agreeing is not a chain agreeing, and PRD §17 wants protocol facts read at runtime.

**Confirmed, against a live pool on Shannon.** `getBookLevels(bool,uint64)` returns
`(uint256 price, uint256 quantity)[]`, best price first on both sides. Prices are probabilities in
the pool's own units: a real book read at the time of writing showed a best bid of 457000 and a best
ask of 482000, with `getBinaryPoolParams().oneCollateral` reading 1000000 — so 0.457 against 0.482,
and a spread of 25000 raw, which renders as 250 basis points of one whole contract exactly the way
`frontend.md` §3.2 renders one. That is independent confirmation of D-011's absolute-spread rule from
the chain rather than from the document that prompted it.

This is not a one-off command. `scripts/probe/book.ts` performs the check, `pnpm probe:dreamdex` runs
it whenever a market is configured, and it is therefore covered by gate G1. It asserts what
distinguishes the two fields — a price is a probability and so lies strictly inside
`(0, oneCollateral)`, where a quantity does not — so a swapped field order is detected rather than
assumed away. `oneCollateral` is read from the pool every time and never compiled in.

**Fork testing is not available on Shannon's public RPC.** `contracts/test/ForkSampling.t.sol` would
have sampled a real book end to end through `CoverageSubscriber`. It cannot run, because both
published endpoints:

- return `method not found` (-32601) for `eth_getProof`;
- reject EIP-1898 block-hash parameters (-32602), which is what forge uses to pin a fork;
- answer `eth_getStorageAt` with a bare `0x` instead of a 32-byte word;
- reject a block parameter sent as a JSON number rather than a hex string.

Each was tested directly against both `dream-rpc.somnia.network` and
`api.infra.testnet.somnia.network`. Historical state itself is retained — balances resolve 10,000
blocks back — so this is a JSON-RPC surface limitation, not a pruning one.

The test is kept, skipping, rather than deleted. AGENTS.md forbids deleting or skipping a failing
test to make CI pass, and the spirit of that rule is about tests that reveal defects; this one fails
on an endpoint's capabilities, not on anything in this repository, and it will work unchanged against
an archive node. Deleting it would also lose the record of why it cannot run.

**Cost.** Path R is not yet exercised end to end against real chain state. The layout it depends on
is confirmed live, and the handler's logic is covered by fixtures, but the join between them is
proven only by deployment — which is gate G3, and which needs the funds and key the owner holds.
Recorded for the SDK and documentation feedback report (PRD §20), alongside the SDK's unexported
`dist/eventsAbi.js`.

---

## D-019: Use two wallets, not one — the owner role can forge samples if it is also the maker

**Date:** 2026-09-10, Phase P2
**Status:** accepted. Affects who funds what, so it is settled before the faucet is claimed.

**Evidence.** `AssizeRegistry` gives its owner exactly one power: `registerKeeper`. That looked
harmless when written, because PRD §10 permits it and the owner cannot touch a bond. It is not
harmless if the owner and the maker are the same account.

A registered keeper may call `recordSample` directly. So a single key that is both owner and maker
could register itself as keeper and write samples of its own choosing against its own commitment —
showing `COVERED_AT_SAMPLE` on a book that was empty, and never forfeiting the bond it posted.

Block pinning makes that **detectable**: PRD §6 rests the keeper path's trust on exactly this, a
stranger re-reading the book at the pinned block and comparing. But detection is not prevention, and
the product's claim is that a verdict can be re-derived rather than that our conduct can be audited
after the fact. A verifier who sees one key holding both roles has to take our word for something,
which is the thing this repository is organised to avoid.

**Decision.** The deployer/owner and the maker are separate accounts, with separate keys. The maker
posts bonds and quotes; the owner deploys and holds the keeper power it is not expected to use. With
the roles split, no single key can both stand behind a commitment and fabricate the samples that
judge it, and that is true structurally rather than by our restraint.

**Cost.** Two faucet claims instead of one, and two keys in `.env.local`. Cheap. The alternative
costs a sentence of trust in every claim the project makes.

---

## D-020: The subscription's `gasLimit` is a funding floor, not a ceiling

**Date:** 2026-09-10, Phase P2
**Status:** accepted

**Evidence.** The pinned reactivity reference, under Automatic removal: a subscription is removed
when "the owner's balance doesn't cover the subscription's `gasLimit` when it fires, i.e. it's less
than `(execution price per gas + priorityFeePerGas) * gasLimit`".

The balance is tested against the **whole `gasLimit`**, not against the gas the handler actually
uses. And the consequence is removal, not a skipped invocation — the subscription is gone, and
sampling stops silently. That is precisely the failure PRD §8.2 calls "a silent `NOT_SAMPLED`, which
is the worst failure this product can have", and it is worse than assumed: not a gap, an ending.

`SomniaExtensions.DEFAULT_HANDLER_GAS_LIMIT` is 10,000,000. At the reference's
`MINIMUM_BASE_FEE_PER_GAS` of 6 gwei, taking the default would require 0.06 STT free at every single
firing, for a handler measured at roughly a quarter of a million gas.

**Decision.** Do not take the default. Set `gasLimit` from measurement — `onEvent` costs at most
254,574 gas against a fixture pool, so a real pool read plus headroom sits near 1,000,000 — and fund
the subscriber well above `gasLimit * price` rather than near it.

**Cost.** A `gasLimit` set too tight fails the handler mid-execution, which does not remove the
subscription but does lose the sample. Too loose and the balance floor rises. The number must be
re-measured against a real pool once G3 has produced one invocation, and published as the cost per
sample that gate G11 requires.

---

## D-021: K9 resolved — the window is open. K10 fires — scope is cut.

**Date:** 2026-09-10, Phase P2
**Status:** accepted. Resolves the `OWNER DECISION` that has been open since D-010.

**Evidence.** The owner supplied a screenshot of the hackathon's own channel: "Final submissions is
on — 5,000 USD prize pool, closes in 1d 17h", linking dorahacks.io/hackathon/event-contracts. The
window PRD §2 recorded as closed is open. K9 resolves to continue.

**K10 fires in the same moment.** "G4 has not passed with 48 hours left in the window → Cut payouts,
cut multi-market, cut the claim flow. Protect G3, G4, G7, G9, and G12 in that order." At the time of
that message G4 had not passed and roughly 41 hours remained. The cut is therefore mandatory, not a
judgement call.

**Cut, as K10 directs:**

- **Payouts and the claim flow.** `claim(breachId)`, witnessed volume, and the trader claim surface
  in `frontend.md` §3.8. Claim C-005 stays at R0 and its gate G5 is abandoned for this submission.
  The registry already had no settlement path (D-006); that deferral is now permanent for this cycle.
- **Multi-market.** One market, as PRD §27 already scoped P2.

**Protected, in K10's order:** G3, G4, G7, G9, G12.

**Cost, stated plainly.** Assize will demonstrate measurement and penalty recording but **not
settlement**. A bond is recorded as forfeited and no trader is paid, because the code that would pay
them is cut. Every surface and every claim must say so: the product measures and records, and the
payout half exists in the design and not in the deployment. Anything that implies a trader was made
whole would be false.

---

## D-022: A gas limit measured against a fixture is not a measurement

**Date:** 2026-09-10, Phase P2
**Status:** accepted

**Evidence.** `CoverageSubscriber.onEvent` costs **254,574 gas** against the test fixture pool and
**2,730,154 gas** against a live DreamDEX pool — an order of magnitude more. A fixture returns a
one-element array; a real `getBookLevels` walks an order book.

The first subscription was configured with `gasLimit = 1,000,000`, chosen from the fixture number and
recorded in D-020 as measured. Every callback then ran out of gas. The reactive transactions fired,
were charged, and wrote nothing. From outside it looked exactly like a subscription that was not
firing at all: sample count frozen at zero while the prefund drained. The only signal that anything
was happening was the subscriber's balance falling.

**What found it.** Not a test. `cast estimate` against the deployed handler and the real pool, run
because the balance was dropping while the sample count was not. The unit tests could not have caught
it — they measure the fixture, which is the thing that was wrong.

**Decision.** Handler gas limits are set from an estimate against the live pool, and re-estimated
whenever the pool changes. The current subscription uses 6,000,000. G11 requires publishing the cost
per sample; at 6 gwei it is roughly 0.016 STT.

**Cost.** `scripts/preflight.ts` and `contracts/test/FundingConstants.t.sol` carry a recommended
limit that was derived from the fixture and is wrong by 10x. Both are corrected in this change. More
generally: any number this repository derives from a fixture and calls a measurement deserves the
same suspicion.

---

## D-023: The subscriber could not be funded, and the tests could not have known

**Date:** 2026-09-10, Phase P2
**Status:** accepted

**Evidence.** The first `CoverageSubscriber` had no `receive()` function. The plain transfer meant to
fund it reverted, so it could never hold the balance a subscription owner is required to hold, and
could never have fired a callback.

Fifteen tests passed against that contract, including one asserting that subscribing requires the
minimum owner balance. They all funded it with `vm.deal`, which writes a balance directly into state
and performs no transfer. They proved the contract could **hold** a balance. Nobody had asked whether
it could **be given** one.

**Decision.** `receive()` added, and `test_can_be_funded_by_a_plain_transfer` asserts the property
that was actually missing by making a real call. A `sweep(to)` restricted to the funder was added
alongside it, so a superseded deployment's prefund can be recovered — which matters because testnet
funds are rate limited to one claim a day, and the first deployment stranded its bond.

**Cost.** The registry's `subscriber` is immutable, so fixing the subscriber meant redeploying the
registry too, and the 1 STT bond in the first registry is stranded permanently — there is no
settlement path to release it (D-006). That is the honest price of the bug: it is recorded rather
than quietly re-funded, and it is why `evidence/` counts start from the second deployment.

---

## D-024: A wildcard topic filter samples the same instant many times

**Date:** 2026-09-10, Phase P2
**Status:** accepted, with a correction owed

**Evidence.** The subscription filters on the pool's address with all four topics zero, so every log
the pool emits triggers one callback. A block containing many pool events produces many samples that
read the same book at the same instant. The first live run recorded **1132 samples across 84 distinct
blocks** — roughly thirteen samples per observed instant.

None is fabricated. Each is a real callback that really read the book. But they are redundant, and
quoting 1132 as a count of how often coverage was observed would overstate the measurement by an
order of magnitude — the same kind of overstatement PRD §14 forbids when it says `NOT_SAMPLED` may
never be folded into coverage.

**Decision.** `evidence/live-run.txt` reports both numbers and says in plain words which one means
what. No published figure quotes the sample count without the distinct-block count beside it.

**Owed.** The filter should narrow to a topic that marks a book-changing event, so that one
observation corresponds to one instant. That reduces gas roughly thirteenfold as well. It is not done
in this change because K10 protects G3, G4, G7, G9 and G12 in that order and the honest reporting
closes the correctness gap; it is the first thing to fix if the campaign is extended.

---

## D-025: The frontend was not cut by K10, and treating it as cut was my error

**Date:** 2026-09-10, Phase P4
**Status:** accepted, correcting an earlier misreading

**Evidence.** K10 says: "Cut payouts, cut multi-market, cut the claim flow. Protect G3, G4, G7, G9,
and G12 in that order." I read that as settling the absence of a web app. It does not. It cuts one
surface — the claim portal in `frontend.md` §3.8 — and the three gates it protects all need an app:
G7 says "a stranger reaches the live app", G9 is a first-time user completing the core action, and
PRD §24 makes "Working prototype on Shannon testnet — Live URL" a hard submission requirement.

So the app was a gap, not a cut, and it was recorded as a cut for several commits.

**Decision.** `apps/web` is built: a static page with no server and no database, reading the chain
directly through a public RPC. That is the product's own claim applied to its interface — a page that
had to be trusted would break the thesis. The claim portal is genuinely absent, because payouts are
genuinely cut and a surface for claiming what nobody can claim would be a lie.

**Cost.** Late. Had this been read correctly when K10 fired, the app would have had the hours that
went to the feedback report instead.

---

## D-026: The sample stream shows one row per instant, not one per sample

**Date:** 2026-09-10, Phase P4
**Status:** accepted

**Evidence.** The first render of the live stream listed forty rows that were, in substance, three
readings: the wildcard topic filter fires the handler on every pool log, so a block emitting thirteen
logs produces thirteen samples of one instant. Every row was true and the table as a whole was
misleading — it made the measurement look an order of magnitude richer than it is, which is the
overstatement D-024 identified and the same defect PRD §14 forbids when it says a gap may never be
folded into coverage.

**Decision.** Consecutive samples reading the same book at the same block collapse to one row
carrying a `×N` count. The count of distinct blocks leads the table header; the sample count follows
it. Nothing is dropped and nothing is hidden — the repetition is stated as a number instead of
performed as rows.

**Cost.** A visitor cannot see each individual callback in the table. That is the right trade: the
individual callbacks are on chain for anyone who wants them, and the table's job is to say how often
the book was actually observed.

---

## D-027: `COVERED_AT_SAMPLE` now occurs on chain, and a README claim went stale

**Date:** 2026-09-10, Phase P4
**Status:** accepted

**Evidence.** The README's misleading-results section said "Every sample in this run is a breach …
`COVERED_AT_SAMPLE` does not appear on chain yet." True when written. It stopped being true while the
app was being built: the book tightened to a 14000 spread against a committed 15000, and the chain
now records 110 `COVERED_AT_SAMPLE` against 8554 `SPREAD_BREACH` across 599 distinct blocks.

This is the better outcome — the same commitment held at some instants and not at others, which is
the measurement doing its job rather than a one-sided result — but it means a published claim was
wrong for as long as it took to notice.

**Decision.** The README now states which states have occurred and which have not, and says plainly
that reaching all seven is shown by the differential rather than by this run.

**Cost.** A general one, worth writing down: every number in a document about a live system has a
shelf life. `pnpm evidence:report` regenerates the counts from chain, and any figure quoted by hand
should be re-read from it before submission rather than trusted because it was true once.

---

## D-028: The app ships as one self-contained file as well as a served bundle

**Date:** 2026-09-10, Phase P4
**Status:** accepted

**Evidence.** A dev server on `localhost` is reachable only from the machine running it. For anyone
who is not on that machine — a judge, a reviewer, the owner of this project — it is not a way to see
anything, and offering it as one wastes their time.

Somnia's RPC answers with `access-control-allow-origin: *` on both the call and the preflight, which
means a page loaded from a `file://` origin can read the chain directly. So `pnpm --filter
@assize/web build:single` inlines the stylesheet, the bundle and the deployment record into one HTML
file that works by double-clicking, with no server and no install.

That is not a fallback. It is the strongest form of the product's own argument: the page has no
backend to trust, and now visibly cannot have one.

**Cost.** The single file is around 320KB, most of it the bundled RPC client, and it must be rebuilt
when the deployment record changes because the record is inlined. The served build remains for
development.

**A bug worth recording.** The first single-file build silently kept its `<script src>` tag and three
copies of it. `String.prototype.replace` interprets `$&` and `$'` inside a replacement *string*, and
a minified bundle is full of both — so the bundle's own text re-inserted the tag it was replacing.
Passing the replacement as a function disables that interpretation. The symptom was a page that
looked built and rendered nothing, and the console error named CORS rather than the real cause.

---

## D-029: The spacing scale is derived from frontend.md's vocabulary, not invented beside it

**Date:** 2026-09-10, Phase P4
**Status:** accepted

**Evidence.** An audit of the first web build against `frontend.md` found two distinct problems.

Thirteen specified components were simply missing: the Connect Wallet button, the
"Publish Maker Commitment" CTA, Box 2's copyable terminal, the whole Market Registry Directory
(§3.4), the Handler Gas Gauge, the depth chart, the Stored Sample Inspector and the `NOT_SAMPLED`
explainer row (§3.5), the whole Maker Commitment Publisher (§3.6), the breach page's explorer link,
and the Lucide icon set. None of those needed a decision. They needed building, and they are built.

The second problem is the one worth recording. `frontend.md` fixes every colour, type size, weight
and tracking, and it fixes the 56px nav and the 680px measure. It fixes no spacing, padding, radius
or gap scale — and the first build invented one: a 14px card radius, 18px padding, a 56px section
rhythm, all numbers chosen by hand. It also shipped a single breakpoint at 900px where §6 asks for
390, 768 and 1440.

**Decision.** `frontend.md` is written in Tailwind's vocabulary from end to end — `backdrop-blur-xl`,
`rounded-lg`, `bg-cyan-950/40`, `border-white/[0.06]`, `hover:bg-zinc-200`, `tracking-wider`,
`font-bold`. That is an implied system rather than a silence. The stylesheet now declares Tailwind's
default spacing and radius scales as named tokens at the top and uses only those, so every value is
traceable to the document's own idiom instead of to taste. Breakpoints are §6's three.

**Cost.** It is a reading, not an instruction, and it is recorded here as one so it can be overruled
cheaply: the tokens sit in one block at the top of `styles.css`, and a different scale would be a
find-and-replace rather than a rewrite.

**A rule for later.** The icons make the point smaller and sharper. §5.1 says Lucide or Phosphor; the
first build hand-drew an SVG glyph instead, which is a visual decision invented where one was
specified. They are now extracted verbatim from the `lucide-static` package at build time. When the
document names a source, use that source.

---

## D-030: The new frontend.md defines five verdict colours; the enumeration has seven

**Date:** 2026-09-10, Phase P4
**Status:** **open. `OWNER DECISION` — the design authority is not ours to extend.**

**Evidence.** The replacement `frontend.md` §1 defines semantic badge colours for
`COVERED_AT_SAMPLE`, `SPREAD_BREACH`, `DEPTH_BREACH`, `ABSENT` and `NOT_SAMPLED`. PRD §5.2 enumerates
seven states. `WINDOW_CLOSED` appears once in the document, in Page 2A's badge list, with no colour.
`SAMPLER_FAILED` does not appear at all.

AGENTS.md is explicit: "Do not add a state. Do not collapse two states into one because the UI is
easier that way." Both of those are exactly what a missing colour tempts.

**What was done, pending a decision.** Neither state got a new hex value — inventing one is the thing
this repository forbids. Both render using tokens the document already defines: `--text-muted` on a
muted ground. They are told apart from each other by border treatment, `WINDOW_CLOSED` taking
`--border-subtle` and `SAMPLER_FAILED` a dashed `--border-focus`.

**Why this is not good enough.** Two of the seven states now look more like each other than any other
pair does, and `SAMPLER_FAILED` — which means our own measurement is unusable — reads as quietly as
`WINDOW_CLOSED`, which is unremarkable. If a sampler ever does fail, the UI will underplay it.

**What is needed.** Two hex values from the design authority, or permission to derive them.

---

## D-031: The new frontend.md describes payouts that this deployment cannot make

**Date:** 2026-09-10, Phase P4
**Status:** accepted, with the conflict surfaced rather than resolved silently

**Evidence.** The replacement `frontend.md` specifies a full settlement path: a `/claim` portal with
`[Claim Payout]` calling `claim(breachId)`, telemetry reading "Total STT forfeited **and
distributed**", a breach dossier line reading "Forfeited Collateral: 500 STT (Transferred to claimant
pool)", and hero copy saying the bond "forfeits directly to witnessed traders".

None of it exists on chain. K10 cut payouts and the claim flow when the submission window got short
(D-021), and `AssizeRegistry` has no settlement function at all.

**Decision.** The surfaces are built, because the document specifies them and a missing page is a
worse answer than an honest one. Every one of them states plainly that the mechanism is designed and
not deployed: the telemetry box reads "1 STT forfeited · 0 STT distributed"; the breach dossier says
"Forfeited, not transferred. There is no claimant pool"; the lifecycle's fifth step is labelled "Not
deployed"; and `/claim` opens by saying it cannot pay anyone.

Where the document's copy would assert something untrue, the copy is not used. The hero subtext is
kept verbatim because it describes the mechanism rather than this deployment, and the boundaries
section immediately below it corrects the impression.

**Cost.** The site says "not deployed" in five places, which is repetitive and slightly deflating —
and correct. PRD §0.8 forbids claiming functionality that has not been executed, and no amount of
design authority overrides that.

---

## D-032: The subscription ran out of gas and was removed. The predicted failure happened.

**Date:** 2026-09-10, Phase P2 evidence
**Status:** recorded

**Evidence.** `somnia_reactivityGetSubscriptions` now returns an empty list for the subscriber, whose
balance is 0.0033 STT against a per-firing floor of 0.036 STT. Sampling stopped at **29,541 samples**.

This is precisely what D-020 described from the pinned reference: the owner's balance is tested
against the whole `gasLimit` at every firing, and falling below it **removes** the subscription rather
than skipping an invocation. It was written down as the worst failure this product can have, and then
it happened.

**What it cost, and what it did not.** Nothing recorded on chain is affected: 29,541 samples, the
recorded breaches, the forfeited bond and the callback transaction are permanent, and G3 and G4 stand
on them. What stopped is new measurement.

**Why this is, in a narrow sense, good evidence.** The interface surfaced it correctly and
immediately: the handler gas gauge reads zero projected callbacks in red, and says the subscription is
removed rather than skipped. The failure mode PRD §8.2 calls silent was not silent here, because the
gauge was built to say so. That is the anti-dashboard claim doing its job on the product's own
infrastructure.

**Restarting it is blocked.** `SUBSCRIPTION_OWNER_MINIMUM_BALANCE` is 32 STT and is checked at
creation, so re-subscribing needs the subscriber funded above 32 STT. The deployer holds 6.36 STT and
the faucet allows one claim per 24 hours. Sampling cannot resume until the next claim. PRD §26 K8
governs: publish exactly what the funding bought, and never present a shortened window as a full one.

---

## D-033: The nav's Faucet link and "+ Post Commitment" button are removed, against §2

**Date:** 2026-09-10, Phase P4
**Status:** accepted, on the owner's instruction

**Evidence.** `frontend.md` §2 specifies three items under "Actions (Right aligned)": a Faucet link,
a "+ Post Commitment" primary white button routing to `/publish`, and the wallet pill. The owner
asked for the first two to be removed. Only the wallet pill remains.

This is a deliberate departure from the design authority, recorded here rather than left to be
discovered as drift. The document and the build now disagree on one line of §2, and this entry is
the reason why.

**Checked before removing.** Neither was load-bearing. `/publish` is still reachable from the Publish
tab and from the hero's "Post a Commitment" CTA, both verified. The faucet is still offered where it
is actually needed — the insufficient-funds state on the commitment studio, which §3 Page 3 and §4
both require and which carries its own [Open Shannon Faucet] and [Join Somnia Telegram Community]
buttons. Nothing is orphaned.

**Cost.** A first-time user with an empty wallet no longer meets the faucet until they reach the
publish form. That is later than §2 intended, and it is worth watching in the G9 user test: if
someone stalls for want of testnet funds before they get that far, the link should come back
somewhere earlier.
