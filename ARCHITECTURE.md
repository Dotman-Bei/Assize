# Architecture

Every file in this repository serves one link in this chain. A change that serves none of them is
scope creep.

```
commitment  ->  sample  ->  verdict  ->  breach record  ->  payout
                                                            (cut, K10)
```

## The two evaluators

The verdict function exists twice, on purpose.

```
contracts/src/VerdictLib.sol   the evaluator the chain runs
packages/reference/            the same function in TypeScript
```

Neither is the authority. **Agreement between them is.** `pnpm test:differential` generates 10,000
commitment-and-sample pairs from a fixed seed, evaluates each with both, and fails on any divergence.
It also compares the breach classification, since that is what decides whether a bond is forfeited.

This is what lets a stranger re-derive a verdict without running our contract: `pnpm claim:verify`
reads stored samples from a public RPC and evaluates them with the TypeScript side.

What it does not do is prove either side correct. Both implementations once shared a mistake — a
maker who pulled one side entirely was classified `SAMPLER_FAILED`, which is not a breach — and the
differential agreed with itself throughout. A unit test caught it. See `DECISIONS.md` D-004.

## The verdict ladder

The first condition that holds decides the verdict:

```
1  NOT_SAMPLED        blockNumber == 0                    nothing was observed
2  SAMPLER_FAILED     unpinned, or unlabelled             the record is unusable
3  WINDOW_CLOSED      outside [start, end]                not evidence about this commitment
4  ABSENT             any of bid/ask/bidSize/askSize is 0 no two-sided quote to measure
5  SAMPLER_FAILED     bid > ask, both sides quoted        our reading is wrong, not their quote
6  SPREAD_BREACH      ask - bid > maxSpread
7  DEPTH_BREACH       either side below minSize
8  COVERED_AT_SAMPLE  otherwise
```

Rung 4 sits above rung 5 deliberately. A sampler reading an empty ask side writes `ask = 0`, which is
arithmetically crossed against any positive bid — so testing crossed first would classify a pulled
side as `SAMPLER_FAILED`, which forfeits nothing, and a maker could pull a side for free.

Only `SPREAD_BREACH`, `DEPTH_BREACH` and `ABSENT` forfeit a bond. `SAMPLER_FAILED` is our failure and
`NOT_SAMPLED` is a gap in our measurement; charging a maker for either would be recording a breach
that did not occur.

## Measurement paths

**Path R, primary.** `CoverageSubscriber` inherits `SomniaEventHandler` from Somnia's reactivity
package and subscribes to one DreamDEX pool. Validators invoke `onEvent`; the handler reads the top
of book and writes a sample labelled `REACTIVITY`.

The subscription's filter is pinned to the pool's address, and that is a safety property rather than
a detail: logs emitted by reactive transactions are themselves matched against subscriptions, so a
filter that could match the registry's own `SampleRecorded` event would feed itself until the prefund
was gone. `_assertFilterCannotMatchUs` refuses such a filter.

**Path K, fallback.** A keeper submitting block-pinned samples labelled `KEEPER`, used only if the
reactivity path proves unavailable. Not in use.

Both paths write the same struct and go through the same evaluator. Nothing downstream can tell them
apart except by reading the label.

## Protocol facts

None are compiled in. Venue addresses come from `@somnia-chain/markets-sdk` at runtime, the market is
environment configuration, the precompile address is configuration, and the price scale
(`oneCollateral`) is read from the pool. `pnpm check:no-address-literals` fails the build on a
20-byte hex literal in `apps/`, `packages/` or `contracts/src`.

Upstream is pinned in `skills-lock.json` by source, version and hash. Nothing here is written from
memory about the SDK, the pool interface, or the reactivity precompile.

## Why the spread bound is absolute

`maxSpread` is a raw price difference in the book's own units, not a ratio of mid. Both the sample's
prices and the bound come from the same book, so the comparison needs no scale factor — which is what
keeps a tick size out of the source. Rendering a spread in basis points for a reader does need the
market's `oneCollateral`, so that conversion lives outside the evaluator. See D-011.

## What is not here

`claim(breachId)`, witnessed volume, and the web surfaces. Payout was cut under K10 when the
submission window got short. The registry has no settlement function at all, which means a forfeited
bond stays where it is.
