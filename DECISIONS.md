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
