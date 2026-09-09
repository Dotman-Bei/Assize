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
