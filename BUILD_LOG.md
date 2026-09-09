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
