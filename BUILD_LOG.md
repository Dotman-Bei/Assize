# Build log

Running log of work done, in order. AGENTS.md: a completion report cites the exact files changed and
the exact commands run, with outcomes. "Tests pass" is not a report.

---

## 2026-09-10 — Phase P1: types, reference evaluator, registry, differential harness, probes

**Outcome. G2 passes. G1 does not.** Phase P1 stays open.

### Gates

| Gate | Command | Result |
|---|---|---|
| G2, evaluator agreement | `pnpm test:differential` | **PASS.** 10,000 pairs, zero divergence, seed `0xa551235` |
| G1, no compiled-in protocol facts | `pnpm probe:all` | **NOT PASSED.** Static half passes; live half blocked, see D-010 |

G2's corpus, every state on its own line (PRD §14's reporting rule applied to the corpus — a state
the corpus never reaches is a state the gate did not test):

```
NOT_SAMPLED           949
SAMPLER_FAILED       1199
WINDOW_CLOSED        2386
ABSENT               2667
SPREAD_BREACH         619
DEPTH_BREACH         1043
COVERED_AT_SAMPLE    1137
```

### Commands run, with outcomes

```
pnpm install                      exit 0
pnpm typecheck                    exit 0
pnpm test                         exit 0    21 tests, 1 file
forge build --sizes               exit 0    AssizeRegistry 5,777 B runtime (24,576 limit)
forge test                        exit 0    31 tests across 3 suites
forge lint contracts/src          exit 0    no findings
pnpm test:differential            exit 0    G2 PASSED
pnpm check:no-address-literals    exit 0    G1 static half
pnpm check:vocabulary             exit 0    after 8 violations in our own source were rewritten
pnpm check:paths                  exit 0
pnpm claim:verify -- --offline    exit 0    7 claims, all R0, none above its evidence
pnpm probe:all                    exit 1    G1 NOT PASSED, 2 checks BLOCKED
```

### Negative controls

A gate that cannot fail is not a gate. Each was deliberately broken and confirmed to fail, then
restored:

- **G2.** Changed one character in `VerdictLib.verdict` (`>` to `>=` on the spread bound). Caught at
  pair 18, the handcrafted case where spread equals the committed bound exactly. The failure message
  carries the whole pair, so it reproduces from a CI log alone.
- **claim:verify.** Raised C-001 to R2 with no evidence, and put two forbidden words in C-002's text.
  Both rejected, by id.
- **check:vocabulary.** Found 8 real violations in this repository's own source on first run.
- **probe.** A malformed address, an address with no code, and an RPC error each reported correctly
  rather than as a false OK.

### One real bug found, and how

`verdict()` classified a maker who pulled one side entirely as `SAMPLER_FAILED`, which is not a
breach, so the bond did not forfeit. That is one of the five misbehaviours PRD §14 runs on purpose.

Both implementations shared the mistake, so the differential passed throughout — the two evaluators
agreed with each other and were both wrong. A unit test in `packages/reference` caught it. Recorded
as D-004, because it is the specific limitation of a differential gate.

A second bug was found in `scripts/probe/shared.ts`: RPC errors were returned as plain strings and
were indistinguishable from string results, so an RPC error was reported as "code present". Fixed by
making the RPC response a discriminated union.

### Blocked, per PRD §26

- **No DreamDEX SDK.** Every candidate package name returns 404 from npm; a keyword search returns
  zero results. The market-metadata read is left unwritten and reports `BLOCKED` rather than being
  hand-rolled against a guessed interface (PRD §0.3).
- **No route to Shannon.** `dream-rpc.shannon.somnia.network` does not resolve from this environment.

Both recorded as D-010. No claim was raised on either.

### Open for the owner

- **K9.** PRD §2 records the submission window as 25 Aug to 8 Sep and states it has closed. Marked
  `OWNER DECISION`. P1 is identical under either branch of K9, so it did not block this work, but
  nothing on the submission path should be built until it is answered.

---

## 2026-09-10 — Phase P1: closing the gap between G2 and what the registry stores

**Outcome.** 37 contract tests, up from 31. No gate status changed: G2 still passes, G1 still does
not. This work hardened what P1 already had rather than extending it, because P1's named scope was
complete and its remaining gate is blocked on inputs this environment does not have (D-010).

### The gap

G2 proves `VerdictLib` agrees with `packages/reference` over 10,000 pairs, calling the library
directly with values in memory. The registry does something G2 never exercises: it writes a sample
into packed storage and re-derives the verdict by reading that storage back. A truncation, a
mis-ordered field or a lost enum value in that round-trip would leave G2 green while the path that
actually runs disagreed with the evaluator both implementations were checked against.

`contracts/test/RegistryFidelity.t.sol` closes it, so the chain runs unbroken:

```
packages/reference  ==(G2)==  VerdictLib  ==(fidelity)==  what the registry stores
```

### Files changed

```
contracts/test/RegistryFidelity.t.sol    new, 5 fuzz tests
contracts/test/BondConservation.t.sol    new, 5 invariants + a non-vacuity check
foundry.toml                             added [invariant] runs=64 depth=128
contracts/test/BondConservation.t.sol    one comment reworded, check:vocabulary hit "always"
```

### Commands

```
forge test                       exit 0   37 tests, 5 suites
forge test --match-path BondConservation.t.sol
                                 exit 0   64 runs, 8192 calls, 0 reverts
pnpm test:differential           exit 0   G2 unchanged
pnpm check:vocabulary            exit 1 -> exit 0 after rewording one comment
pnpm probe:all                   exit 1   G1 unchanged, still blocked per D-010
```

### What the negative controls taught

Each new test was verified to fail before being trusted. Two findings worth keeping:

1. **The first corruption I injected — truncating a stored `uint128` size to `uint64` — was caught by
   the byte-for-byte field test and passed straight through the verdict test.** Truncating a huge
   size to another huge size rarely crosses the `minSize` boundary, so the derived verdict does not
   move. The two tests are complementary rather than redundant: one checks the fields survive
   storage, the other checks the derivation reads what survived.

2. **A fuzz test can be discriminating on paper and vacuous in practice.** Drawing `bid` and `ask`
   independently across the whole uint128 range means roughly half the samples cross and most of the
   rest are wider than any committed spread, so the ladder stops at rung 2 or 6 and the depth
   comparison is almost never reached. `testFuzz_stored_verdict_matches_the_evaluator_on_a_coherent_book`
   builds the book from a mid and a half-spread so the envelope comparisons are actually exercised.
   `afterInvariant()` asserts the same thing for the invariant run: a sequence that never records a
   breach satisfies every breach invariant vacuously.

### A note on the vocabulary rule

`check:vocabulary` flagged "always" in a doc comment and did not flag it inside the identifier
`invariant_forfeiture_always_names_a_real_breach`, because `_` is a word character. That is the
word-boundary rule in D-008 behaving as specified — the same mechanism that lets `safeParse` and
"liquidity" through — but it is worth knowing that a snake_case identifier will not be caught.

---

## 2026-09-10 — Upstream arrives: pinning, one correction, and G1 down to a single blocker

**Outcome.** `pnpm probe:dreamdex` exits zero against live Shannon testnet. G1's blocker is now one
missing document rather than two missing capabilities. G2 still passes. Phase P1 stays open.

The owner supplied the Bot Kit, the Event Contracts docs and the starter template. All are pinned in
`skills-lock.json`, together with `@somnia-chain/markets-sdk@0.29.0` — the real SDK. Every earlier
search failed because the name was guessed as `@dreamdex/*`. Guessing a package name turned out to be
the same error as guessing an ABI, and it produced the same result: a confident, wrong answer that
looked like evidence of absence. D-010 recorded that absence as a blocker; D-014 supersedes it.

### The correction

`frontend.md` gives two worked spread examples, and D-005's ratio-of-mid formula contradicts both:

| `frontend.md` | ask − bid | says | bps of mid | bps of one contract |
|---|---|---|---|---|
| §3.2 `0.4920 / 0.5080` | 0.0160 | 160 bps | 320 | **160** |
| §3.7 `0.4700 / 0.5350` | 0.0650 | 650 bps | 1293 | **650** |

Spread is an absolute bound, not a ratio. Pinned `IEventContracts.sol` corroborates the scale: price
is "probability in 1e6 units", `oneCollateral` is "1e6 on testnet — one whole contract". Both
evaluators changed, `maxSpread` widened `uint32 -> uint128`, and a display-only `spreadBps(bid, ask,
priceScale)` now reproduces both numbers in the table under test. D-011 supersedes D-005.

### What upstream settled

- **K1 does not fire.** The book emits `OrderPlaced`, `OrderFilled`, `OrderRested`, `OrderCancelled`
  and more. There is an event to subscribe to.
- **K3 does not fire.** `OrderFilled` carries only order ids, but `OrderPlaced` carries
  `placedOrder.owner`, so per-address attribution is possible by correlating the two.
- **The book read is `getBookLevels(bool isBid, uint64 numLevels)`** returning `{price, quantity}`.
  The template flags that struct as the one to confirm; the SDK's own `BookLevel` has the same two
  fields in the same order, so two pinned sources agree.
- **Somnia caps `eth_getLogs` at 1000 blocks.** Not guessable. Discovery now walks backwards in
  windows and counts failed ones rather than swallowing them.

### Commands

```
pnpm skills:verify                       exit 0   4 pinned, 0 mismatched
pnpm probe:dreamdex   (live Shannon)     exit 0   chain 50312, 38 markets, 6 live
pnpm probe:reactivity                    exit 1   BLOCKED, precompile address unknown
pnpm probe:all        (G1)               exit 1   G1 still open
pnpm test:differential (G2)              exit 0   10,000 pairs, zero divergence
pnpm test                                exit 0   22 tests
forge test                               exit 0   37 passed, 1 skipped
```

Live probe output, verbatim:

```
[OK] chain id            RPC reports chain 50312
[OK] venue addresses     read from the pinned SDK at runtime
[OK] market discovery    38 MarketCreated log(s) across 40000 blocks, 6 still live
[OK] configured market   BTC pool=0x0957C6...8517 expiry=1788998400 interval=3600s live
```

### A trap closed for good

The stale-fixture hazard bit twice — once after the ABSENT precedence fix, once after the spread
correction. Both times a bare `forge test` reported a "divergence" that was only an old expectation
replayed against new code. `pnpm test:differential` now deletes its vectors in a `finally`, so they
exist only inside the run that made them and `forge test` skips honestly.

### Still open

- **G1**: the Somnia reactivity reference — the precompile address on Shannon and its `onEvent`
  convention. The one item in AGENTS.md §0.2's pinning list not supplied. D-014.
- **D-013** (`OWNER DECISION`): `frontend.md` §3.7 specifies a copyable verification command using
  `dream-rpc.shannon.somnia.network`, which does not resolve. The working endpoint is
  `dream-rpc.somnia.network`. Not edited — the design authority is not ours to change.
- **K9** (`OWNER DECISION`): the submission window.

---

## 2026-09-10 — G1 passes. Phase P1 complete.

**Outcome. G1 and G2 both pass. P1's stop boundary is met.** Nothing has been deployed, and P2 is not
started: its first act is a deployment, and K9 is an open `OWNER DECISION`.

### How the last blocker fell

The Somnia reactivity reference is published, at
`docs.somnia.network/developer/reactivity/reactivity-onchain.md`. The HTML is a client-rendered shell
with no content in it; GitBook serves every page as raw Markdown by appending `.md`, which is how it
was read. Both pages and `@somnia-chain/reactivity-contracts@0.2.1` are now pinned. All four items in
AGENTS.md §0.2's list are pinned.

It settles: the precompile is at `0x0100`; a handler inherits `SomniaEventHandler` and overrides
`_onEvent(address, bytes32[], bytes)`; **`msg.sender` inside a reactive call is `0x0100`**, which is
exactly the access control PRD §12 requires; and `somnia_reactivityGetSubscriptions` /
`somnia_reactivityGetSubscriptionInfo` expose subscription state including `gas_limit` and
`max_fee_per_gas`, which is what G11 will read.

### The finding that mattered most

`eth_getCode` at `0x0100` returns `0x`. A precompile is implemented by the node and has no deployed
bytecode. The previous `probe-reactivity.ts` treated empty code as `PROTOCOL_CONFIG_CHANGED`, so it
would have reported reactivity as **missing on a chain where it works** — and that false negative
argues for firing K1 and abandoning Path R, which is the product's whole thesis. Liveness is now
proven by the RPC method's presence, distinguishing `-32601` (absent) from `-32602` (present,
arguments rejected). Found by testing against the live node, not by reading.

### Commands

```
pnpm probe:all        (G1)   exit 0   10 checks, 0 blocked   <- PASSES
pnpm test:differential (G2)  exit 0   10,000 pairs, zero divergence
pnpm skills:verify           exit 0   7 pinned, 0 mismatched
pnpm claim:verify --offline  exit 0   C-001 and C-006 now R1
pnpm test                    exit 0   22 tests
forge test                   exit 0   37 passed, 1 skipped
```

G1 output against live Shannon, verbatim:

```
[OK] no compiled-in address literals
[OK] chain id                    RPC reports chain 50312
[OK] venue addresses             read from the pinned SDK at runtime
[OK] market discovery            36 MarketCreated log(s), 6 still live
[OK] configured market           ETH pool=0x8EB893...B404 interval=3600s live
[OK] reactivity available        somnia_reactivityGetSubscriptions answered
[OK] precompile address          0x...0100, presence proven by RPC not eth_getCode
[NOT_APPLICABLE] subscription liveness and handler funding   (P1 deploys nothing)
G1 PASSED: 10 check(s), 0 blocked.
```

### Claims moved, and one deliberately not

C-001 and C-006 moved R0 to R1, with their evidence in the same commit (§21). C-003 briefly carried
evidence from the reactivity probe; it was removed. The probe shows the path exists **on Shannon**,
which is a fact about the network, not about this product. C-003 claims Assize delivered samples by
it — that is G3, and it belongs to P2.

### What P1 did not establish

No sample has been written by Assize, no breach recorded against a live market, no bond forfeited.

### Carried into P2 as a requirement

The reactivity reference warns that a handler's own logs are matched against subscriptions, so a
subscription can feed itself and drain the owner's balance. Assize's subscriber emits
`SampleRecorded` when it writes a sample. The P2 filter must exclude the registry's own address, and
a test must prove it. Written down now so P2 meets it as a requirement rather than as an incident.
