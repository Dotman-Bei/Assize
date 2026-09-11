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

---

## 2026-09-10 — The web surface, and a correction

**Outcome.** `apps/web` exists: a static page, no server and no database, reading Shannon directly
through a public RPC. Verified in a headless browser against the live deployment.

### The correction

I had treated the absence of a web app as settled by K10. It was not. K10 cuts payouts, multi-market
and the **claim flow** — one surface — and the three gates it protects all need an app: G7 says "a
stranger reaches the live app", G9 is a first-time user completing the core action, and PRD §24 makes
a live URL a hard submission requirement. The app was a gap recorded as a cut for several commits.
D-025.

### What was built

Tokens, type scale, badge palette and layout are `frontend.md` §1 to §4 verbatim. Surfaces: hero with
the anchor badge and the real latest on-chain sample; the verdict function running locally on numbers
the visitor chooses, labelled as not being chain data; the bento; live coverage with the commitment
and sample stream; breach evidence; generated verification commands; the documentation surface; and
the footer status bar. The claim portal from §3.8 is absent, because payouts are cut and a surface
for claiming what nobody can claim would be a lie.

No address appears anywhere under `apps/`. The page fetches the deployment record at runtime, so
`pnpm check:no-address-literals` passes over the app as it does over everything else.

### What the browser test found

Two things worth fixing, both found by looking rather than by reasoning:

1. **Forty rows that were three readings.** The first render listed every sample, and the wildcard
   filter fires the handler on every pool log — so a block emitting thirteen logs produced thirteen
   identical rows. Each row was true and the table was misleading. Consecutive samples at the same
   block and book now collapse to one row with a `×N` count, and the distinct-block count leads the
   header. D-026.
2. **The headline wrapped to five lines** at a 15ch measure. Widened.

### And one claim went stale while I worked

The README said "Every sample in this run is a breach … `COVERED_AT_SAMPLE` does not appear on chain
yet." True when written; false an hour later. The book tightened to a 14000 spread against a
committed 15000, and the chain now records:

```
samples 8664 · distinct blocks 599
  SPREAD_BREACH      8554
  COVERED_AT_SAMPLE   110
  every other state     0
```

Both states on the same commitment, as the book moved — the measurement doing its job rather than a
one-sided result. The README is corrected, and D-027 records the general lesson: every number in a
document about a live system has a shelf life, and `pnpm evidence:report` is what re-reads them.

### Commands

```
pnpm --filter @assize/web build     exit 0   dist/app.js 296K, no runtime CDN
headless chromium against localhost  console errors: none
pnpm check:no-address-literals       exit 0   over apps/ too
pnpm check:vocabulary                exit 0
```

### Not done

The app is not hosted. A public URL needs a hosting account, which is the owner's to supply.

---

## 2026-09-10 — A build anyone can actually open

`localhost:5173` is reachable only from the machine running it, which is not the owner's machine.
Offering it was useless.

`pnpm --filter @assize/web build:single` now inlines the stylesheet, the bundle and the deployment
record into one HTML file that works by double-clicking. Somnia's RPC sends
`access-control-allow-origin: *` on the call and the preflight, so a `file://` origin still reads the
chain — verified in headless Chromium against `file:///…/assize.html`:

```
gas    : handler prefund: 13.39 STT
latest : bid 405,000 · ask 434,000 · spread 29,000 raw · 290 bps · SPREAD_BREACH
stream : 3 distinct blocks from the 40 most recent of 13,804 samples
errors : none
```

### The bug in the inliner

The first attempt produced a file that still loaded `./app.js` — three times. `String.replace`
interprets `$&` and `$'` inside a replacement **string**, and a minified bundle contains plenty of
both, so the bundle's own text kept re-inserting the tag being replaced. Passing the replacement as a
function disables the interpretation.

Worth remembering for the symptom as much as the cause: the page looked built, rendered nothing, and
the console blamed CORS. D-028.

---

## 2026-09-10 — The web surface, rebuilt against frontend.md

**Outcome.** All thirteen specified-but-missing components built. The spacing scale is now derived
from the document rather than invented. Verified in a headless browser at all three widths §6 names.

### The audit that prompted it

Absent and specified: Connect Wallet (§2.1); the "Publish Maker Commitment" CTA (§3.1); Box 2's
copyable terminal (§3.3); the entire Market Registry Directory — search toolbar, five filter pills,
six-column table, empty state (§3.4); the Handler Gas Gauge, the depth chart, the Stored Sample
Inspector and the `NOT_SAMPLED` explainer row (§3.5); the entire Maker Commitment Publisher including
the insufficient-STT state (§3.6); the breach page's explorer link (§3.7); and the Lucide icon set
(§5.1), which the first build replaced with a hand-drawn glyph.

Invented where the document is silent: card radius, padding, section rhythm, gaps — and one
breakpoint at 900px where §6 asks for 390, 768, 1440.

### What changed

`frontend.md` speaks Tailwind throughout, so the stylesheet now declares Tailwind's default spacing
and radius scales as named tokens and uses only those. Icons are extracted verbatim from
`lucide-static` at build time. Breakpoints are §6's three, and none of them overflows horizontally.

The publisher's step 3 dry-runs the envelope through `packages/reference` exactly as §3.6 asks, which
turns out to be the most useful thing on the page: it tells a maker their proposed envelope would
breach immediately against the current book, before they post a bond.

### Two things the browser caught

1. **The gas gauge was a meter that only moved at the end.** It divided the balance by the per-firing
   floor and clamped to 100%, so it read full until the subscription was nearly dead. It now measures
   callbacks the prefund can still pay for against a stated 1,000-callback budget, and says so.
2. **Box 3, "Witnessed Volume Settle", describes a mechanism that is cut.** Rather than delete the
   box and break the grid, it carries its specified title and states plainly that the mechanism is in
   the design and not in this deployment, and that no bond has been split.

### Commands

```
pnpm --filter @assize/web build          exit 0
pnpm --filter @assize/web build:single   exit 0
headless chromium, file:// origin        console errors: none
  inspector renders                      true
  pin verification confirms canonical    true
  horizontal overflow at 390/768/1440    none
pnpm check:vocabulary / no-address-literals / paths   exit 0
```

---

## 2026-09-10 — Frontend rebuilt against the replacement frontend.md

The design authority was replaced with a Midday.ai minimal dark monochromatic system: six routes, a
new palette, pill-and-dot badges, a pinned 48px footer bar. The previous surface was discarded and
rebuilt against it.

**Built:** Overview with the centred hero, the four-box live telemetry bento, problem-versus-mechanism
cards, the interactive five-step lifecycle, the breach proof teaser and the boundaries box · Markets
directory with filter chips and the live coverage terminal, handler gas gauge and sample ledger with
a slide-out inspect drawer · Commitment studio at 640px with the economic summary, tick validator and
insufficient-funds state · Breach audit terminal with the incident log and proof dossier · Trader
settlement portal · Verification playground with a working in-browser verifier.

The in-browser verifier is the piece worth pointing at. It reads the stored sample and commitment from
a public RPC, checks the block pin against the block's parent hash, re-derives the verdict with
`packages/reference`, and prints PASS or FAIL against what the chain says. Verified live: it reads
sample #0, confirms the pin matches, and both sides agree on `SPREAD_BREACH`.

**Two gaps in the new document, neither invented around.** It defines five verdict colours for seven
states — `WINDOW_CLOSED` has none and `SAMPLER_FAILED` is absent entirely (D-030, owner decision
pending). And it specifies a settlement path K10 cut: `/claim`, `claim(breachId)`, "forfeited **and
distributed**", "Transferred to claimant pool". Those surfaces are built and each says plainly that
the mechanism is designed and not deployed (D-031).

**And the predicted failure arrived while this was being built.** The subscription ran out of gas and
was **removed**, not skipped, exactly as D-020 described. Sampling stopped at 29,541 samples. The
gauge caught it immediately — zero projected callbacks, in red — which is the anti-dashboard claim
working on the product's own infrastructure. Nothing on chain is affected; what stopped is new
measurement. Restarting needs 32 STT in the subscriber and the faucet allows one claim a day (D-032).

```
forge test / typecheck / G2 / vocabulary / addresses / paths / claims   all exit 0
headless chromium, file:// origin, six routes                           console errors: none
horizontal overflow at 390 / 768 / 1440                                 none
in-browser verifier against sample #0                                   PASS
```

---

## 2026-09-10 — Nav actions removed on request

Removed the Faucet link and the "+ Post Commitment" button from the right of the nav, leaving the
wallet pill. This departs from `frontend.md` §2, which specifies all three, and is recorded as D-033
so the document and the build do not drift apart silently.

Checked first that neither was load-bearing: `/publish` is still reachable from the Publish tab and
the hero CTA, and the faucet still appears in the insufficient-funds state on the commitment studio,
where §3 Page 3 and §4 both require it. Verified in the browser — both gone, both routes still work,
no console errors, no overflow at 390, 768 or 1440.

---

## 2026-09-10 — Wordmark reveal, adapted rather than integrated

A React hover-text component was proposed for integration. It was not integrated as written: the
stack it assumes does not exist here (no React, Tailwind, shadcn or `.tsx` anywhere in `apps/web`),
its five-hue gradient contradicts §1's monochrome system — and one of those hues, `#ef4444`, is
`--verdict-absent`, so using it decoratively would drain a semantic colour of meaning. Its demo also
carried another company's name, email, phone number and copyright, which was not pasted anywhere.

The effect was carried across instead: a pointer-tracked stroke reveal on the wordmark, forty lines
of vanilla SVG, CSS and JS, no dependency added, every colour a §1 token. Easing is a lerp on
requestAnimationFrame; the draw-on runs once when the element first scrolls into view and is disabled
under `prefers-reduced-motion`.

Verified in the browser against the running dev server: the mask centre moves from `150,50` at rest
to `90,50` under the pointer, the draw-on completes, no console errors, no overflow at 390, 768 or
1440. First pass read too faint to look deliberate, so the mask holds full luminance to 52% before
falling away and the lit stroke widened — tuning inside the same tokens. D-034.

---

## 2026-09-10 — Typeface, nav structure, em dashes

Three changes against a reference screenshot the owner supplied.

**The font was never loading.** §1 names Geist Sans / Inter and Geist Mono / JetBrains Mono, and none
was ever fetched, so the app rendered in the system default. That is the whole reason it did not look
like the document. Inter and JetBrains Mono now load from Google Fonts, both named in §1.

**Nav restructured** to brand left, tabs centred, status and action right. §2 lists these elements
without placing them; measured at 1440px the nav centre and bar centre now agree to the pixel. The
wallet control is a solid white pill, matching the reference.

**Em dashes removed from every app string** — twenty-nine, each replaced for its own sentence rather
than swapped mechanically. Verified zero remain in the rendered DOM.

```
Inter loaded                       true
tabs centred                       bar 720px, nav 720px, off by 0px
em dashes in rendered DOM          0
console errors                     none
overflow at 390 / 768 / 1440       none
```

D-035, including the cost: the page now depends on fonts.googleapis.com, so the single file is no
longer quite self-contained. It falls back to the system face offline, where it cannot read the chain
anyway. Repository documents still use em dashes; only `apps/web` was cleared.

---

## 2026-09-10 — Card structure, and a verification method that was lying to me

**Cards** now follow the supplied reference: heading, body at a narrow measure, wrapped tag chips, a
flex spacer holding footers level, and a footer link with a circular arrow. Columns abut inside one
outer border, dividers drawn by the container's background through a 1px grid gap. Telemetry tiles
and lifecycle steps share the same frame. Verified against the built file: 2 arrow glyphs, 8 chips,
4 telemetry cells, 5 lifecycle cells, both footer links at y=998, no console errors, no overflow at
390/768/1440.

The reference's serif headings were **not** adopted. §1 names a sans and a mono and no serif; the
request was for structure, and a third family is a bigger change than that. D-036, owner decision.

**And the method was broken.** The icon module had stopped being imported when `main.js` was rewritten
for the new `frontend.md`. Every browser check since had run against the dev server, whose esbuild
watcher held a graph from before the rewrite and kept serving a bundle that no longer matched the
source. `paintIcons` was calling an `icon` that did not exist, and `boot`'s own catch swallowed the
ReferenceError so it never reached the console.

So three earlier entries here that say "console errors: none" were true of what the watcher served
and not of the source. D-037 records that rather than quietly amending them. Verification now runs
against `dist/assize.html`, the artefact actually shipped. The dev server is for editing; it is not
evidence.

---

## 2026-09-10 — Footer rebuilt as a site footer

Replaced §2's pinned 48px bar with the supplied reference structure: brand column with descriptive
copy, three link columns under uppercase headings (App, Network, Product), external-link arrows, a
hairline, and a bottom row carrying the hackathon line left and a monospace verification line right.
Third instructed departure from the document, after D-033 and D-036. D-038.

All three strings §2 put in the bar survive. The disclosure was corrected on the way: §2 says
"Payouts reach witnessed volume only", which implies payouts happen and none do. It now reads
"No payout path is deployed: a forfeited bond is recorded, not distributed."

Verified against the built file:

```
footer columns    App / Network / Product
links per column  6, 4, 5
external arrows   4
verified line     verified on Somnia Shannon · chain 50312
dead links        none
position          static, in document flow
console errors    none
overflow          none at 390 / 768 / 1440
```

The verification line degrades honestly: with the RPC unreachable it reads "Shannon unreachable,
nothing verified this load" instead of continuing to claim a chain nobody reached.

One cost worth noting: the disclosure was pinned in view on every screen and now sits at the end of
the document. The Overview boundaries box carries the same points, so nothing is lost, but it is less
insistent than §2 made it.

---

## 2026-09-10 — "How it works", and a heading scale that was too small

Replaced the lifecycle section with the supplied compact strip: bold label over a muted qualifier,
five cells, hairline dividers. Section headings across the app take that heading's size, `h2` moving
15px/500 to 22px/600 — they had been smaller than the body copy they introduced, which read as an
error rather than as restraint.

The fifth cell is the reason this needed care. "Settlement" carries "not deployed in this build", its
label muted rather than white and its qualifier in the amber token, with the full explanation in a
note beneath. Without that the strip would imply a five-step process that completes, which is the one
thing this page must not imply.

Verified against the built file: h2 computes to 22px/600, five cells render with the expected label
and qualifier pairs, the fifth is flagged, no console errors, no overflow at 390/768/1440. D-039.

The per-step detail panel is gone with the interaction, and that is a real loss recorded in D-039:
four steps had sentences explaining what they do and do not do, and those are no longer on the page.

---

## 2026-09-10 — Wallet control hidden on Overview

Toggled by route rather than deleted: hidden on `/`, present on the five other routes. Verified in
both directions including the return to Overview, and the health indicator stays put on every route.

The change surfaced a quiet defect. `.hidden` existed only as `.page.hidden`, scoped to page
sections, so toggling that class on a button did nothing — no error, no effect, and a first
implementation that looked right. A generic `.hidden` utility now exists. A class that reads like a
utility but is scoped to one selector fails silently every time it is reused, which is worth
remembering. D-040.

---

## 2026-09-10 — Section spacing, and a second silent CSS failure

Section headings now carry 112px above them, up from the 20px to 40px that seven inline
`style="margin-top:…"` attributes had drifted to. Those attributes are gone; the rhythm lives in one
rule, with `h2:first-child` at zero and headings inside a card taking a smaller 32px step, since a
heading inside a card follows content in the same container rather than opening a new section.

Measured on the built file rather than eyeballed: every visible section heading computes to a 112px
margin and a 112px actual gap from the element above it.

**The first attempt silently did nothing**, for the second time today. `--s-28` was written into the
`h2` rule before it existed as a token, because the replacement that was supposed to add it did not
match: the token line has no spaces after its colons and the pattern assumed there were. An undefined
custom property makes the whole `margin` declaration invalid, so it computed to `0` rather than
erroring.

That is the same shape as the `.hidden` defect an hour earlier: CSS that is wrong does not fail, it
just quietly does nothing, and a change that "looks applied" in the source can have no effect on the
page. Both were caught by measuring the rendered result instead of trusting the diff, which is worth
keeping as the habit.

---

## 2026-09-10 — Wordmark reveal repositioned and scaled

Moved below "Hard protocol boundaries" so it closes the Overview page rather than separating the
disclosures from the sections they qualify. Drawn at background scale: about 891 by 291 pixels
rendered at 1440px wide, against roughly a third of that before, at 0.85 opacity with the resting
stroke still on `--border-subtle`.

Verified on the built file: the reveal now sits below the boundaries card (y 2486 against 1953), the
container measures 300px, the pointer reveal still tracks (mask centre moves to 114 under the
cursor), no console errors, no overflow at 390/768/1440. D-041 amends the placement in D-034.

It is now the tallest element on the page and carries no information, which is a real cost recorded
in D-041: 300px of scroll between the last disclosure and the footer, halved below 768px.

---

## 2026-09-10 — G10 passes: every state reachable

`pnpm test:e2e` drives the built artefact through all six states G10 names and asserts each on the
rendered page.

```
ok  loading            page reports it is reading the chain before data arrives
ok  empty              directory shows its empty state
ok  error              failure to read the chain is reported on screen, not swallowed
ok  insufficient STT   warning shown, 2 faucet links, submit disabled
ok  not sampled        4 NOT_SAMPLED badges, with the gap explained on screen
ok  window closed      5 WINDOW_CLOSED badges rendered
G10 PASSED: all 6 states reachable.
```

Four of those states have never occurred on chain, so the test serves crafted RPC responses from
`scripts/e2e/chain-double.mjs`. That double is loaded only by this command, never bundled into
`apps/web`, and makes no claim about chain data — every claim about the chain still comes from
`verify:testnet` and `assize verify`, which read the real one. D-042.

Negative-controlled: removing the empty-state copy and the faucet links failed exactly those two
checks and left the other four passing.

It runs against `dist/assize.html` rather than the dev server, for the reason in D-037.

**Correction to the entry above.** That commit landed with `check:paths` failing. `scripts/e2e.mjs`
carried `/root/.cache/ms-playwright/…` as the browser path, which AGENTS.md forbids in any tracked
file and which would have worked on exactly one machine. The gate caught it; I committed before
reading the gate output, which is the actual mistake. The browser is now discovered from the home
directory, with `CHROME_PATH` as an override and Playwright's own resolution as the fallback.

## 2026-09-10 — The published cost per sample was twelve times too high

`DEPLOYMENT.md` and `docs/phase.md` both carried "roughly 0.016 STT" per sample. It was never
measured. It was `gasLimit` × the documented 6 gwei floor — the worst a firing could cost, not what
one did.

The completed run divides out: 38 STT funded, 0.0033 left when the subscription was removed, 29,541
samples. **0.001286 STT per sample.** A handler is charged for gas used, not the limit it reserves,
and the observed price on the callback was 1.8 gwei rather than 6.

The error was in our own disfavour, which does not make it acceptable. G11 asks for the cost to be
*published*, and an estimate published where a measurement was available is the same defect as a
claim above its rung. D-043.

## 2026-09-11 — The subscriber was wedged, and `unsubscribe` was the untested function

50 STT landed on the deployed subscriber and it could not be restarted.

```
subscribe()    -> AlreadySubscribed   (0x5fd8a132)
unsubscribe()  -> UnsubscribeFailed   (0x13e7ce5d)
```

The chain had removed the subscription itself when the prefund ran out (D-032) without telling the
contract, so `subscriptionId` still held `17611580`. `unsubscribe` set it to zero and *then* called
the precompile; the precompile rejects an id it no longer knows, and that revert rolled the reset
back with it. A funded contract with no reachable state where it samples again. `sweep(to)` was the
only function still working, which is the only reason the 50 STT was not lost with it.

The mistake was treating a refusal as failure. Being asked to stop something already stopped is the
goal reached another way, and a contract's own state should not need a counterparty's agreement to a
removal that counterparty performed unilaterally.

`unsubscribe` now clears the id either way and emits `SubscriptionCleared(id, acknowledged)`, so a
declined removal is on the log rather than swallowed. Two griefing holes beside it are closed: both
`subscribe` and `unsubscribe` were callable by anyone, and `subscribe`'s caller picks the `gasLimit`
and `maxFeePerGas` that every callback spends from this contract's prefund.

**`unsubscribe` had no test of any kind** — the one function nothing exercised, and the one that
wedged the deployment. It has five now. The regression test was verified to fail against the old
behaviour before being trusted. D-044.

### Commands

```
forge test                    58 passed, 0 failed, 3 skipped
cast send ... "sweep(address)"   status 1, 50.003261984200000000 STT recovered
```

## 2026-09-11 — G12 gate, the §15 runbooks, and a blank that beat the record

`pnpm submission:check` now exists, splitting the package where it actually splits: what the
repository holds, and what the owner holds. Required files, the README's five beats in order,
`DEPLOYMENT.md` agreeing with `deployments/` on every address, a clean tree — against a live URL, a
video, beat 4's wording, and the feedback filing. Owner-held facts are declared in `submission.json`
and none is taken at its word: a URL written there is fetched, a repository said to be public is
asked unauthenticated whether it is, and the local tip is compared against the tip GitHub serves.

Every check was verified to fail — a wrong address in `DEPLOYMENT.md`, a beat removed, the beats
reordered, six phrasings through the beat 4 predicate. OUTSTANDING is reported separately from FAIL,
because unfinished work and a broken repository are not the same problem.

`docs/runbooks/` covers the five failures §15 names. Four have happened here and are written from
the incident; the fifth cannot happen, and its page proves the absence with a bytecode selector scan
carrying a positive control rather than rehearsing a procedure for absent code.

Every command in every page was run against the live chain first, which is how two were found wrong:
`cast interface` does not take `--rpc-url` on a chain with no Etherscan, and the pool address is
discovered from `DREAMDEX_MARKET_ID` rather than being an environment variable at all.

That turned up D-045. `.env.example` defines every address key empty, because naming the keys is
what it is for. An empty value is a string, so it passed `=== undefined` guards and — worse — won an
`??` chain against the deployment record in the verifier CLI, the command the app puts in front of a
stranger. A blank env var read as an empty address while a correct record sat unused beside it.
Fixed at all three raw call sites; `probe/shared.ts` already had it right.

## 2026-09-11 — The run is finished, and every surface now says so

The recovered 50 STT arrived about forty minutes after the window closed, and sampling had stopped
long before that. Restoring live coverage needed a fresh registry and subscriber, both immutably
wired. Put to the owner, who chose to keep the finished run. Nothing further is deployed.

```
blocks 484439389 -> 484519171    29541 samples, 1899 distinct blocks
  SPREAD_BREACH     29227        source: REACTIVITY 29541, KEEPER 0
  DEPTH_BREACH        204        0 log windows failed
  COVERED_AT_SAMPLE   110
```

That scan reproduces `sampleCount` and `breachCount` exactly (29,227 + 204 = 29,431) from events
rather than from either counter, so the two agree without being derived from each other.

The risk was then tense, not data. A finished run in a live-sounding voice misleads even when every
number is right, because a reader takes the tense as part of the claim.

- `README.md` carried mid-run counts — 8,664 samples, two states. Now the final figures, the command
  that reproduces them, and the fact that sampling ended *before* the window did, leaving instants
  that are `NOT_SAMPLED` and are not counted as coverage.
- `apps/web` told a maker composing an envelope "It would hold right now", from the latest *stored*
  sample. The newest sample that exists is not a current one. It names the block it read.
- `pnpm evidence:report` could only scan backwards from the head, so it reported zero samples for a
  run of 29,541 — a completed run was undescribable by the tool meant to describe runs. It takes
  `--from` and `--to`, and an explicit range is labelled as covering only those blocks.

D-046.

## 2026-09-11 — Demo script written, and two beats that could not be shot as written

PRD §23 beat 3 is "samples arrive, the coverage state changes in front of the viewer". There is no
open window, so it cannot be performed. `docs/demo-script.md` shows the recorded stream and names it
a completed run, because narrating a closed window in the present tense would be false in the one
place an audience cannot check anything.

Beat 4 ends, in §23, with a witnessed trader claiming the bond. There is no settlement function. The
script says nobody was paid, out loud and not on a slide, and the wording carries into
`submission.json` where the gate checks it is there.

Every figure was re-read from chain before being written down, and the command the script says to
run on camera was run first: `pnpm assize verify 0`, 8 checks, exit 0.

## 2026-09-11 — Hosted, and a browser sent to prove it

`vercel.json` builds the static surface with the repo's own two commands, so the deployed bytes come
from source rather than from a file copied by hand. **No environment variables**, and that is §17
rather than a hosting convenience: no address is compiled into `apps/`, so the RPC URL, chain id and
both contracts arrive through `deployment.json`. Nothing is left for a dashboard to supply. Routing
is by hash, so no rewrite rules.

Live at **https://assize.vercel.app**.

`pnpm submission:check` asks whether the URL answers 200 and mentions Assize. Right question for a
submission gate, not enough to know the thing works — a page that loads and then fails to read the
chain answers 200 with an empty shell. So `pnpm check:live` drives the deployed page in a browser:

```
ok  sample count from chain    29541, matching sampleCount
ok  breach count from chain    29431, matching breachCount
ok  breach rows listed         25 row(s)
ok  dossier opens on click     registry address, block pin, verify command
ok  no console errors          none
LIVE CHECK PASSED
```

The dossier check clicks a row, because that is the core action and it sits behind a click rather
than a URL. A route-only check never reaches it. **G7 is met.**

Two faults in that script, both mine, both found by running it. It printed `FAIL` on a line and then
exited 0, because the exit code consulted only the console-error count — a gate reporting a failure
and passing anyway. And it carried a *copy* of `e2e.mjs`'s browser finder which had dropped
`chrome-linux64`, the only layout on this machine; the copy could not launch a browser while the
original kept passing. Both now import `scripts/find-chromium.mjs`, so there is one implementation
to be wrong.

## 2026-09-11 — Finding 9, and the half of §20 that needs no account

`FEEDBACK.md` gains finding 9: `SomniaExtensions.unsubscribe` reverts on a subscription the chain has
already removed, which permanently wedges the handler. Not a restatement of 5 or 6 — those are about
a subscription being removed and a handler running out of gas. This is the recovery path being
closed, and the wedge is latent in every contract built on the helper rather than a mistake in ours.

`README.md` now *links* `FEEDBACK.md` rather than naming it, which is §20's second half and the part
that needs no account. `submission.json` carries beat 4's wording, so that gate item passes.

`feedbackFiledAt` stays null. It feeds a gate, and filling it in before the report is filed would
make that gate assert something untrue.

`docs/filing-feedback.md` holds a paste-ready issue for the Bot Kit, which has issues enabled;
`@somnia-chain/reactivity-contracts` has no public repository, so finding 9 has no tracker of its own.

## 2026-09-11 — A bond was forfeited, and paid to the trader it failed

P3 shipped and settled on Shannon. D-047 has the decision; this is what the live run cost.

```
registry   0x829465c447eD558b108001d472B5190424DCBfCc
claim tx   0xec831878e0c0e94c8c7bdec3bb6411a6fe4739cc3402d52dd0d13186ae3a1d25
BondClaimed(commitment 0, breach 0, claimant <deployer>, volume 5000000, amount 1e18)
registry balance after: 0
```

**Four things the live run corrected that no test could have.**

`SUBSCRIPTION_OWNER_MINIMUM_BALANCE` is **32 ether**, checked at subscribe time. The deploy script
funded 20 and was refused `InsufficientBalance` (`0xf4d678b8`). The floor is now read out of the
pinned package rather than typed as a number.

The failure also truncated the state file, because `>` truncates before the command that fills it
can fail, and a later line referenced an out-of-scope variable under `set -u`. Addresses are written
immediately after deploying now — a deployed contract whose address exists only in a terminal
scrollback is a contract you can lose.

`placeOrder` reverts **`UseBinaryPlacement`** on this pool. Binary markets take `placeBinaryOrder`,
different signature, different argument order. And the maker cannot rest an ask at all: `SELL_YES`
reverts `InsufficientPermission` without YES inventory.

Quotes were hardcoded from a book reading taken ten minutes earlier. By the time the window opened
the book had moved from 839000/863000 to 900000/922000, which put the maker's "ask" below the best
bid — a `POST_ONLY` order that cannot rest without taking, so the pool refuses it. Prices are derived
from the live book at placement time now.

**And one design error, which was mine.** The witness does not have to fill against our own maker. A
witnessed trader is anyone who took liquidity inside the window, so the deployer crossing a third
party's resting ask is exactly as real — arguably more so, being genuine market liquidity rather than
our own quote on both sides. Half the choreography above was unnecessary.

**The breach was not staged.** The live book sat around 22000 wide against a committed 15000 for the
whole window. The commitment was simply wrong about the book it described.

## 2026-09-11 — Two invariants were passing without running

`afterInvariant` gained a check that a claim actually succeeded, and it failed immediately:

```
no claim ever succeeded, so the settlement invariants proved nothing: 0 <= 0
```

**I had reported those invariants as passing. They were passing vacuously**, across 8192 calls, with
`claim` never once executed. Three separate causes, each found by keeping the revert reason instead
of discarding it:

- `claim` refuses until the window closes, and the handler published windows up to 100_000 blocks
  long. No sequence could ever settle one.
- A breach and an order were picked independently, so the order was almost always witnessed against
  a different commitment than the breach belonged to — `NothingToClaim`.
- `attributeOrder` is write-once. When the fuzzer reused an order id with a different trader the
  registry kept the first, while the harness recorded the latest, and claimed as the wrong address —
  `NotTheOrderOwner`, which is the contract being right.

Shortening windows then made the run **seed-dependent**: a uniformly random uint64 sample block is
outside every window, so breaches stopped being recorded and the suite passed under one seed and
failed under the next. Samples are aimed inside the window now, with one in eight outside to keep
`WINDOW_CLOSED` exercised. Verified across four seeds: 75 passed, 0 failed.

A flaky invariant is worse than a missing one, because it teaches you to rerun.

## 2026-09-11 — `check:done` stopped holding its own answer

Two of §28's items were decided by text inside `check:done` rather than by the world.

Item 3 was hardcoded `unmeetable`, and that was right while settlement was cut: no deployed code
could perform a payout, so no run could satisfy it. P3 shipped one, and the checklist kept its old
answer — the exact drift this command was written to stop, reappearing inside the command itself. It
now shells out to `verify:testnet` for C-004 and C-005, which read the sample, the breach, `paidOut`,
`witnessedVolume` and the bond from chain. Item 1's summary line still read "G5 cut under K10" for
the same reason.

The command also read `demo.beat4NobodyWasPaidStatement`, the field that was renamed when that
statement stopped being true.

**Item 10 then failed, correctly**, because those two commits touched `scripts/` and nothing had been
written here. The rule it enforces is that a commit changing `contracts/`, `packages/`, `apps/` or
`scripts/` is work a reader of this log should be able to find — which means the log entry belongs in
the same commit as the change, not the one after it. This entry is that correction.

  pnpm check:done    7 of 11 met, outstanding 1, 5, 8, 9

## 2026-09-11 — `check:live` was agreeing with a reading, not with the chain

The gate asserted the page showed 29541 samples and 29431 breaches. Those were literals, copied from
a run that the deployment record had since superseded, so it passed against a stale deployment and
told us the live app was fine when it was serving contracts we had replaced.

That is the third time in one day the same mistake shipped: stale quotes hardcoded into the P3 run
script, stale counts left in the README, and now stale counts inside the gate meant to catch stale
pages. The rule that follows is narrow and worth keeping — **a check does not write down a number it
could ask for.**

It now reads `sampleCount` and `breachCount` from the registry named in the deployment record, at
check time, and asserts the page agrees. The dossier's registry assertion comes from the record too,
rather than matching a hardcoded prefix.

Run immediately after, against the live site, it failed exactly as it should:

```
FAIL  sample count matches chain    registry says 1714
FAIL  breach count matches chain    registry says 1396
FAIL  registry address shown        expected 0x829465c447eD558b108001d472B5190424DCBfCc
```

The deployed page is still the P2 build. The source and the local artefact carry P3; the hosting has
not been redeployed. That gap is now visible from a command instead of from remembering.

## 2026-09-11 — The live gate was racing a counter that moves

After the P3 build went live, `check:live` failed on the sample count: the page showed 1714 and the
chain said 4058. Both were true. The subscription is still firing, so the counter moved between the
page reading it and the gate reading it — the gate was comparing a live number against a snapshot
taken later and calling the difference a defect.

It now brackets instead: the chain is read **before** the page loads and again after, and the page
passes if the number it shows falls inside that range. Anything in the bracket is a number the page
could honestly have read; anything outside it is stale or invented.

```
ok  sample count matches chain   page shows 4,102, chain moved 4102 -> 4109 while it loaded
ok  breach count matches chain   page shows 1,396, chain moved 1396 -> 1396 while it loaded
```

Breaches are frozen because the window closed and every new sample is `WINDOW_CLOSED`, which is not
a breach. Two readings of the same counter differing is the normal state of a live system, and a
check that treats it as failure is a check that cannot be trusted when it does fail.

## 2026-09-11 — D-044 proved on chain, with its own control

The P3 subscription was closed and its prefund recovered. Both transactions matter as evidence, not
just housekeeping.

```
unsubscribe  0x85afa5701bd32547414f91be567d33cf3e510c0d71255ce0f256f37a721565ad
  SubscriptionCleared(18103719, acknowledged: true)
sweep        0x7067ee2eb78e05ae1fe23115bad5142f95bb68f4197bd3a190ff1b4f707ba6d1
  15.981404136 STT recovered
```

D-044 fixed an `unsubscribe` that reverted when the chain had already removed a subscription, taking
its own state reset down with it and leaving the contract unable to ever subscribe again. That fix
now has a live demonstration **and a control**, from the same call by the same caller against two
contracts:

```
P3 subscriber (fixed)   -> InsufficientBalance   holds 0 STT; fund it and it subscribes again
P2 subscriber (wedged)  -> AlreadySubscribed     permanently unrecoverable
```

`somnia_reactivityGetSubscriptions` returns `[]` for the P3 subscriber and its `subscriptionId` reads
`0`. The wedged one still reads `17611580` and always will.

**Cost per sample, measured: 0.002823 STT.** 33 STT funded, 15.981404136 swept back, 6,028 samples —
arithmetic on two balances and a counter, all readable from chain, which is the rule D-043 earned.
The P2 handler cost **0.001286**; this one does more per callback, decoding `OrderPlaced` and
`OrderFilled` as well as reading the book. G11 asks for the figure to be published, so both are, and
the difference is explained rather than averaged away.

Breaches stop at 1,396 while samples reach 6,028: once the window closed every further sample is
`WINDOW_CLOSED`, which is neither a breach nor coverage. The gap between those two numbers is the
protocol working.

## 2026-09-11 — The app told a wallet on the right network to switch to it

Reported from a Rabby wallet already on Somnia Shannon: the connect flow showed "Wrong network,
please switch to Somnia Shannon (Chain ID: 50312)".

The check was `parseInt(chainId, 16) !== 50312`. EIP-1193 says `eth_chainId` returns a hex string and
MetaMask does, so that is right for `"0xc488"`. Rabby returns a number, or a decimal string, and
`parseInt(50312, 16)` is **328466** — never equal to 50312, so the wallet was refused for being on
exactly the network it was on.

```
ok         parseInt("0xc488", 16) =  50312   hex string
WRONG NET  parseInt(50312, 16)    = 328466   number (Rabby)
WRONG NET  parseInt("50312", 16)  = 328466   decimal string
```

`chainIdOf` now normalises whatever arrives — number, hex string, decimal string, padded or
uppercase — and returns null rather than a wrong number when it cannot read one. Seven shapes
covered, including the two garbage cases.

The modal also shows what the wallet reported. The old one asserted the network was wrong and gave a
user no way to see why, which is what made this take a bug report rather than a glance.

**Two compiled-in protocol facts went with it.** The expected chain id was a literal in the
comparison, and the explorer URL and the footer's "Chain 50312" were literals too. PRD §17 says the
app compiles in no protocol fact; all three now come from the deployment record, which gained
`explorerUrl`. `pnpm test:e2e` still passes all six states.

This one is worth noting for G9: it would have failed the first tester who used anything but
MetaMask, and it would have looked like their wallet's fault.

## 2026-09-11 — An empty Market dropdown on the publish form

Reported from the live app: the Market select on Publish was blank, with nothing to choose.

`renderPublish()` is called from `route()` and nowhere else, and its options come from
`S.commitments`, which `loadChain()` fills asynchronously. A visitor already standing on Publish when
that resolved kept the form built before any chain data arrived — permanently, because nothing
re-rendered it. The only recovery was a reload, and nothing on screen suggested one.

`loadChain()` now re-renders the form if Publish is the page on screen, and a market list that is
genuinely empty says so rather than presenting an empty box: *"Still reading the registry. The list
is queried from chain, never a hardcoded string, so it is empty until that returns."*

`pnpm test:e2e` still passes all six states.

## 2026-09-11 — The publish form asked for 39 STT to spend 1

`doPublish` sends the bond and nothing else, while the Economic Summary added a 38 STT handler
prefund into `Total Required` and disabled the button below it. A maker holding 38 STT was refused,
to spend 1.

Faithful to `frontend.md`, which specifies exactly that summary and that disabled state — and
unimplementable as written, because a maker publishing here gets no handler to prefund. One
subscriber exists and it is immutably wired to one commitment.

The prefund stays visible as the figure it is, labelled `not collected here`; the last summary row
now says what the transaction sends. The balance check covers the bond plus fee headroom. D-048
records the departure, because `frontend.md` is the design authority and this is a departure from it.

`pnpm test:e2e` then failed, correctly: the chain double returned 2 STT, which sat below the old
39 STT threshold and above the new one, so G10's insufficient-balance state was no longer reachable.
The fixture returns 0.5 STT now and all six states pass again.

## 2026-09-11 — "No chain was provided to the request"

Reported from the live app, on pressing Post Commitment:

```
Not posted. No chain was provided to the request. Please provide a chain with the
`chain` argument on the Action, or by supplying a `chain` to WalletClient.
```

`createWalletClient({ transport: custom(globalThis.ethereum) })` was built without a `chain`, and
viem refuses to send a transaction without one. The form caught the error and displayed it, which is
the only reason it was legible at all — but to a user it was a failed action with nothing they could
do about it.

The chain is now assembled from the deployment record: id, display name, native currency, RPC and
explorer. Not written in the source, per PRD §17 — a different network means a different record
rather than an edit to `main.js`. The record gained `displayName` and `nativeCurrency` alongside the
`explorerUrl` added earlier today.

**This is a coverage gap, not just a bug.** `pnpm test:e2e` drives the app through six states with a
chain double and passes, and it has never once exercised the publish *submit* path, because the
double has no wallet. Three defects have now been found on that path by hand — the chain id check,
the phantom prefund, and this — and the gate that covers the app found none of them.

## 2026-09-11 — A successful publish, then an empty failure

Reported as "it failed". It had not: commitment 1 was on chain, bonded 1 STT, maker
`0x5e3cC65c…27fe6`. What failed was the obvious next thing — pressing Post Commitment again — and
PRD §10 allows one active commitment per maker per market, so the registry refused it.

The refusal arrived as `The contract function "publishCommitment" reverted`, with nothing after it.
A wallet's gas estimation drops custom-error data, so `CommitmentAlreadyActive(1)` lost its name and
its argument on the way out. The user had done the right thing, been told nothing, and had no way to
learn that their first attempt had worked.

Two fixes, because one is not enough:

- **Asked before the button.** `activeCommitmentOf(maker, market)` is queried as the form is filled,
  and a maker who holds one sees which commitment, the block it runs to, and roughly how long that
  is. The button reads "One Active Commitment Per Market" rather than being pressable into a revert.
- **Decoded when it happens anyway.** `simulateContract` runs before signing and recovers the error
  name and arguments, which `publishError` turns into a sentence. An error it does not recognise
  falls through to whatever viem said — a wrong explanation is worse than a raw one.

Verified against the deployed registry with the address that actually hit it: `errorName
CommitmentAlreadyActive, args 1`.

**And a wrong conclusion on the way to that.** The first check reported the error as undecodable, and
the reading was nearly published as "this node strips revert data". It does not: the MAKER account
holds 0.96 STT and the simulation sent 1, so it failed on funds, which really does carry no data.
Testing all four refusals is what caught it. A negative result from a single case is a single case.

An empty market id was also accepted: the registry stores whatever bytes32 it is given, so a blank
dropdown would have created a commitment against a market that does not exist. The form now refuses
to submit without one.

**Correction to the entry above.** That commit landed with `pnpm test:e2e` failing, 5 of 6 states.
The gate reported it and I committed anyway, which is the same mistake recorded against the G10
commit on 2026-09-10 — the second time, so it is a habit rather than a slip.

The cause was the new pre-check. `activeCommitmentOf` is not in the chain double's ABI, so the double
returned `"0x"`, viem threw decoding it, and `refreshPublish` died before reaching the funding
branch. The insufficient-balance state was not broken; it had become unreachable because an earlier
line now threw.

Fixed in two places, because either alone leaves a real hole:

- The double answers `activeCommitmentOf` with `(false, 0)`.
- **The app no longer loses the form when that read fails.** The pre-check is a courtesy — the
  registry enforces §10 regardless — so an RPC that cannot answer it now logs and leaves the button
  usable, and the refusal, if it comes, is decoded. Before this, one failing read blanked the publish
  form for a user whose wallet was fine.

The second fix is the one that mattered: a judge on a flaky RPC would have hit it.

## 2026-09-11 — `pnpm audit:ui`, and four controls that did nothing

Reported from the live app: "the details button, nothing happens on click", and "the claims and
verifier tabs, nothing works there". Both right, and neither caught by any gate — `check:live` asks
whether the page reads the chain, and `test:e2e` asks whether six states render. Neither asks whether
a control does anything when pressed.

`pnpm audit:ui` now clicks every tab, row, chip and button on the deployed app and reports any that
leaves the page unchanged. A dead control is otherwise indistinguishable from a working one with
nothing to do: no error, no movement, nothing.

First run, seven findings. One was the audit's own fault — it clicked breach row 0, which is already
rendered on load, so a working control looked dead. **A negative result from a single case is a
single case**, the same lesson as the revert-data reading earlier today. It clicks row 1 now.

The rest were real:

- **Market rows carried `data-nav="/markets"`** — clicking "Details" navigated to the page you were
  already on. `renderMarketDetail` existed and was only ever called with `S.commitments[0]`, so the
  panel below the table showed the first commitment and no other. Rows carry `data-market` now and
  open their own.
- **Every maker was labelled `PROJECT_BASELINE`**, including third parties. That label is our own
  baseline maker and calling someone else's commitment ours is the opposite of the disclosure it
  exists for. It is now compared against the record's maker address.
- **The Claim page was hardcoded**, with a permanently disabled button and four statements the
  deployment had falsified the day before: "the registry witnesses no fills in this deployment", "no
  wallet did", "not deployed here", "would strictly enforce". I corrected the panel's top note when
  P3 shipped and missed the body underneath it.

The Verifier tab turned out to work, and to be the best thing in the app: it reads a stored sample,
re-derives the verdict with `packages/reference` in the browser, and compares it to the chain. The
audit ran it and got `PASS. Verdicts match and the pin resolves.`

The Claim page now reads chain — witnessed volume, paid out, and for a connected wallet the orders
the registry attributed to it, their unsettled volume and what `claimableFor` says they are owed,
with a button that claims it. A wallet owed nothing is told so in those terms rather than by a
disabled button with no explanation. The `OrderAttributed` scan states the range it covered, because
"no orders found" and "the scan failed" must not look alike.

## 2026-09-11 — The wordmark's dead space, and a tightening that clipped it

Asked to cut the space above and below the wordmark drastically. Most of it was not margin at all:
the glyphs are 80 units inside a viewBox that was 100 tall, and a `height: 300px` container magnified
every empty unit threefold.

Tightening the viewBox to 68 and scaling the container to 204 kept the rendered size identical — the
scale factor is 300/100 and 204/68, both exactly 3 — and the arithmetic said the footprint fell from
332px to 172px.

**And it clipped the tops off every letter.** `getBBox` on a `<text>` returns the font's
ascent-to-descent box rather than visible ink, so it could not tell me: it reported the box
overflowing in both directions when ASSIZE, being all caps, has no descenders at all. Only a
screenshot showed the truth, and the truth was that `dominant-baseline="middle"` does not put caps
where "middle" suggests.

Fixed by placing the baseline explicitly — `y="67"` in a 76-unit box — rather than centring on an
assumption. Verified by looking at the rendered element, twice: once to find the clipping and once to
confirm it was gone.

Footprint 332px to 196px, glyph size unchanged. **The measurement that mattered was a picture**, which
is the same lesson as D-037, D-040 and D-041 and the fourth time this repository has learned it.
