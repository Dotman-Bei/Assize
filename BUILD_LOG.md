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

---

## 2026-09-10 — Phase P2 code: the reactivity handler, written and tested, not deployed

**Outcome.** `CoverageSubscriber.sol` and its deploy script exist and pass 13 tests. **Nothing has
been deployed and no sample has been written.** The deployment is not blocked on code; it is blocked
on K9, a funded key, and testnet funds — all of which are the owner's to supply (AGENTS.md §0.6).

### Files

```
contracts/src/CoverageSubscriber.sol          the reactivity handler (Path R)
contracts/src/interfaces/IBinaryPool.sol      only what Assize reads: getBookLevels
contracts/script/Deploy.s.sol                 P2 deployment, not run
contracts/test/CoverageSubscriber.t.sol       13 tests
foundry.toml                                  solc 0.8.30, remappings, allow_paths
```

`solc` moved 0.8.28 to 0.8.30: the pinned `@somnia-chain/reactivity-contracts` declares
`pragma solidity 0.8.30` exactly, so `SomniaEventHandler` will not compile under 0.8.28.

### The access control is inherited, and that is the point

`SomniaEventHandler.onEvent` requires `msg.sender == SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS` before it
calls `_onEvent`, and the pinned reference confirms a reactive transaction executes with exactly that
`msg.sender`. PRD §12's spoofed-callback row is satisfied by upstream's own check rather than by one
written here — which is what §0.4 asks for. It is asserted anyway, because it is the property the
whole path rests on.

### Two things found by testing rather than by deploying

1. **The subscriber needs a minimum balance before it can subscribe at all.** The pinned library
   refuses below `SUBSCRIPTION_OWNER_MINIMUM_BALANCE`, and the owner is the subscriber contract
   itself. This appeared as `InsufficientBalance()` in a test. It is a real operational cost for P2 —
   funding to subscribe, then more funding to pay per-callback gas — and it is now held in place by
   `test_subscribing_requires_the_minimum_owner_balance`.
2. **A first attempt at the filter test asserted nothing.** It built a `SubscriptionFilter` locally
   and made assertions about that, never about what the contract sent. `vm.etch` cannot stand a
   recorder at the precompile — foundry refuses addresses in that range — so the test now uses
   `vm.expectCall` with the exact `SubscriptionData`, which is stricter than recording: any deviation
   in any field fails it.

### Negative controls

- **Wildcard emitter injected** (the recursion the reference warns about, where a handler's own logs
  feed its subscription and drain the prefund): caught by the contract's own guard,
  `FilterWouldMatchOurselves()`, before the assertion was even reached.
- **Truncation instead of revert on an oversized book value**: caught. Reverting beats truncating
  here — a truncated size is a silently wrong sample, and a wrong sample recorded as a breach is the
  incident K6 exists to stop. A revert is a missing sample, which is `NOT_SAMPLED`: visible, counted,
  never mistaken for coverage.

### Commands

```
forge build                  exit 0
forge test                   exit 0   50 passed, 1 skipped, 6 suites
pnpm test:differential (G2)  exit 0   unchanged
pnpm probe:all         (G1)  exit 0   unchanged, against live Shannon
pnpm check:vocabulary        exit 1 -> exit 0 after rewording one comment ("safe")
```

### Design decisions this forced

- **D-016**: a reactivity sample pins its block's *parent* hash, because no contract can observe its
  own block's hash. The verifier must check `getBlock(n).parentHash == sample.blockHash`, and the
  field named `blockHash` therefore holds a parent hash — a naming trap that PRD §5.2 prevents fixing.
- **D-017**: registry and subscriber are wired by address prediction rather than a setter, because a
  settable subscriber would be an admin path to redirect who may write samples.

### Not done

No subscription created, no sample written, no breach recorded against a live market. G3, G4 and G11
are all untouched.

---

## 2026-09-10 — The book layout, confirmed against a live pool

**Outcome.** The most load-bearing protocol fact in the product is now checked against the chain on
every probe run, rather than inferred from documents. Fork testing turned out to be unavailable on
Shannon's public RPC; that is recorded rather than worked around.

### What was confirmed, and why it needed confirming

Assize samples the top of a DreamDEX book, so the shape of `getBookLevels` is what everything else
rests on. The pinned template flags `OrderBookLevel` as the one struct to confirm against a deployed
pool. D-012 noted the pinned SDK agrees with it — but two documents agreeing is not a chain agreeing.

Read from a live pool:

```
getBookLevels(true, 5)  -> [(485000, 200000000), (474000, 330000000), (463000, 460000000)]
getBookLevels(false, 5) -> [(514000, 200000000), (525000, 330000000), (536000, 460000000)]
getBinaryPoolParams().oneCollateral -> 1000000
```

`(price, quantity)`, best price first on both sides, prices as probabilities in 1e6 units — 0.485
against 0.514. The spread of 29000 raw renders as 290 basis points of one whole contract, which is
`frontend.md` §3.2's convention exactly. That is the chain independently confirming D-011's
absolute-spread rule, which had been derived from the document that prompted it.

This is not a command someone once ran. `scripts/probe/book.ts` performs the check, `pnpm
probe:dreamdex` runs it whenever a market is configured, and gate G1 therefore covers it. It asserts
the property that tells the two fields apart — a price is a probability and lies strictly inside
`(0, oneCollateral)`, a quantity does not — so a swapped field order is caught rather than assumed
away. `oneCollateral` is read every run and never compiled in.

### Fork testing: four findings, all against both endpoints

`contracts/test/ForkSampling.t.sol` would have sampled a real book end to end through
`CoverageSubscriber`. It cannot run. Both `dream-rpc.somnia.network` and
`api.infra.testnet.somnia.network`:

| call | result |
|---|---|
| `eth_getProof` | `method not found` (-32601) |
| EIP-1898 `{"blockHash": …}` block param | `invalid parameters` (-32602) |
| `eth_getStorageAt` | returns a bare `0x`, not a 32-byte word |
| block param as a JSON number | `invalid parameters` (-32602) |

forge's fork backend needs those, and fails in `setUp` with "failed to get account". Historical state
itself is retained — balances resolve 10,000 blocks back — so this is a JSON-RPC surface limitation
rather than pruning. Diagnosed by testing each call directly rather than by guessing at the error.

The test is kept, skipping, not deleted. AGENTS.md forbids deleting or skipping a failing test to
make CI pass; that rule is about tests revealing defects, and this one fails on an endpoint's
capabilities rather than on anything here. It will work unchanged against an archive node, and
deleting it would lose the record of why it cannot run.

### Commands

```
cast call <pool> "getBookLevels(bool,uint64)((uint256,uint256)[])" true 5    live read
pnpm probe:dreamdex   (with a market configured)   exit 0   book layout confirmed
forge test                                          exit 0   50 passed, 3 skipped, 7 suites
pnpm typecheck / check:vocabulary                   exit 0
```

### For the feedback report (PRD §20)

Two items now: the SDK does not list `dist/eventsAbi.js` in its `exports`, so `marketCreatorEventsAbi`
— which carries the only publication of a `marketId` — must be reached by resolving the package root;
and the public RPC's missing `eth_getProof` / EIP-1898 support makes `forge test --fork-url`
unusable against Shannon.

---

## 2026-09-10 — Live on Shannon. G3 and G4 pass.

**Outcome. Assize measured a real DreamDEX market, recorded a real breach, and forfeited a real
bond.** G1, G2, G3, G4 pass. K9 resolved (window open); K10 fired and its cut is recorded.

| | |
|---|---|
| `AssizeRegistry` | `0xa43d71fff5ecedc577a0623421a16c2d11dc6b61` |
| `CoverageSubscriber` | `0x2c07cb635c20e89bdc8a10bd85c4f20f8b5a92f0` |
| Market | `0x0000000000000000000000000000000000000000000000000000000000018bb8` on pool `0x279Ff833DD608B3fFdBB7cA679A43D173Ee14c1A` |
| Commitment | max spread 15000 raw, min size 1e8, 1 STT bond, **forfeited** |
| Callback tx | `0x98023141362bab2255dbf6f73342912b3929facfff7091129edcdd7e88de3adf` |

From `evidence/live-run.txt`, read back from chain:

```
samples observed:        1132
distinct blocks sampled:   84
  SPREAD_BREACH         1132        REACTIVITY  1132
  every other state        0        KEEPER         0
```

### Three bugs, none of which a test could have caught

**1. The subscriber could not be funded.** No `receive()`. The transfer meant to fund it reverted, so
it could never have held the balance a subscription owner must hold. Fifteen tests passed against it,
all funding with `vm.deal` — which writes a balance and performs no transfer. They proved it could
*hold* a balance; nobody asked whether it could *be given* one. Fixed, and
`test_can_be_funded_by_a_plain_transfer` now asserts the property that was missing. Cost: the
registry's subscriber is immutable, so the fix meant redeploying both, and 1 STT is stranded in the
abandoned registry with no settlement path to release it. D-023.

**2. The commitment silently failed to publish.** `start = block + 15` is **1.5 seconds** on a chain
with 100ms blocks. The transaction landed after its own window had opened and reverted with
`WindowStartsInThePast`. It went unnoticed because that step's output was piped to `/dev/null`. The
handler then reverted `NoSuchCommitment(0)` on every callback.

**3. The gas limit was measured against a fixture.** `onEvent` costs 254,574 gas against the test
fixture and **2,730,154** against a live pool: a fixture returns a one-element array, a real
`getBookLevels` walks a book. With `gasLimit = 1,000,000` every callback ran out of gas, was charged,
and wrote nothing. From outside it was indistinguishable from a subscription that never fired —
sample count frozen at zero while the prefund drained. Found by `cast estimate` against the live
pool, run only because the balance was falling while the count was not. D-022.

Bug 3 is the one worth remembering. The unit tests could not have found it: they measure the fixture,
and the fixture was the thing that was wrong.

### An overstatement caught before it was published

The subscription uses a wildcard topic filter, so every pool log triggers a callback and a busy block
yields many samples reading the same book at the same instant — 1132 samples across 84 blocks.
None is fabricated, but quoting 1132 as "how often coverage was observed" would overstate the
measurement roughly thirteenfold. `evidence/live-run.txt` prints both numbers and says which one
means what. Narrowing the filter is owed. D-024.

### K10's cut

Payouts, the claim flow and multi-market are cut. Assize demonstrates measurement and penalty
recording, **not settlement**: a bond is recorded forfeited and no trader is paid, because the code
that would pay them is cut. C-005 stays at R0 and G5 is abandoned for this cycle.

### Claims moved, with evidence in the same commit

C-003 R0→R2, C-004 R0→**R2, its target**, C-001 R1→R2. C-002, C-005, C-006, C-007 unmoved.

### Commands

```
cast send --create ...                    registry, subscriber deployed
cast send ... publishCommitment            commitment 0, 1 STT bond
cast send ... subscribe(...)               subscription 17611580, gasLimit 6,000,000
cast estimate ... onEvent                  2,730,154 gas against the live pool
pnpm evidence:report                       exit 0  read back from chain
pnpm claim:verify -- --offline              exit 0  every claim at or below its evidence
forge test                                  exit 0
```

---

## 2026-09-10 — G7: the documents, and a clean-room test that actually ran

**Outcome. G7's re-derivation half passes, tested rather than assumed. Its "live app" half does not
exist and is recorded as not existing.**

### Files

`README.md` (five beats, mechanism block, live evidence, verification, limitations), `SETUP.md`,
`SECURITY.md`, `ARCHITECTURE.md`, `LICENSE`. `DEPLOYMENT.md` already existed.

### The clean-room test

A real `git clone` into a scratch directory, `pnpm install`, then only the commands the README
prints — nothing from this working tree, no environment carried over.

```
commitmentAt(0)   maker, market, maxSpread 15000, minSize 1e8, bond 1 STT, forfeited flag set
sampleAt(0)       bid 686000, ask 714000, sizes 2e8, block 484439389, pin 0x2b8acbba…, source 1
verdictOf(0)      4  (SPREAD_BREACH)
forfeitureOf(0)   true, breach 0
cast tx …         from and to both the subscriber; the reactivity nonce
claim:verify      re-derived 25/25 stored samples with packages/reference; all agree with the chain
```

All of it from a public RPC, with no account and no API key.

### One thing the test caught

The README claimed the block pin could be checked as `getBlock(n).parentHash == sample.blockHash`
but gave no command for it. Writing one exposed that `cast block --json` wraps its output in
`{data:{…}}`, so the obvious `.parentHash` read returns `undefined` — which looks exactly like a pin
that does not resolve. The pin was correct all along; the check was wrong.

That is the failure mode this gate exists to find, and it was found in a script rather than by a
judge. The README now prints `cast block <n> --field parentHash`, which needs no JSON handling, and
the misleading-results section warns that a verifier treating the field as a block hash rather than a
parent hash will reject every honest sample.

### G7, stated precisely

Passes: a stranger can re-derive a recorded verdict from a fresh clone using only the README.
Does not pass: "a stranger reaches the live app". There is no web app. K10 protects G7, G9 and G12
over building one, so this is recorded as partly met rather than claimed.

### Commands

```
git clone … && pnpm install                 exit 0
<the five README commands>                  all resolve
pnpm claim:verify (from the clone)          exit 0   25/25 re-derived
pnpm check:vocabulary                        exit 0
```

---

## 2026-09-10 — The SDK and documentation feedback report

`FEEDBACK.md`. PRD §20 treats this as required rather than optional and demands real friction with
reproducible steps, exact versions, and payloads. Eight findings, all re-captured from a live node
while writing rather than quoted from notes:

1. `marketCreatorEventsAbi` cannot be imported by subpath — and it carries `MarketCreated`, the only
   publication of a `marketId`. The official template hits this too and works around it with a
   relative path that does not survive a pnpm workspace.
2. `eth_getProof` is not served, so `forge script` and `forge test --fork-url` do not work. The
   surfaced error names neither the method nor the reason.
3. EIP-1898 block-hash parameters rejected; `-32602` is used both for "unsupported shape" and "bad
   arguments", which is why 2 took so long to diagnose.
4. `eth_getStorageAt` returns a bare `0x` rather than a 32-byte word, on an address that has code.
5. `DEFAULT_HANDLER_GAS_LIMIT` of 10,000,000 against the automatic-removal rule means a 0.06 STT
   balance floor at every firing. Documented in two places that never reference each other.
6. A handler that runs out of gas is charged, writes nothing, and is indistinguishable from a
   subscription that never fired. **The expensive one — it cost us a deployment.**
7. `OrderBookLevel` is flagged unconfirmed upstream; we confirmed it live and published the reading.
8. The 1000-block `eth_getLogs` cap appears only in a code comment in the starter template.

The report also records what worked, in specific terms rather than politely: the reactivity reference
documents its own failure modes, including that a subscription can feed itself and drain its owner —
one sentence that became a tested guard in `CoverageSubscriber`.

Linked from the README. Filing it wherever the organisers asked is an owner action.
