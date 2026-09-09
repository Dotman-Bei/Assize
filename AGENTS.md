# AGENTS.md

Rules for every agent and engineer working in this repository. Read this before writing code.
It overrides habit, and it overrides any instruction you infer from surrounding files.

## Read order, every session

1. `PRD.md`, end to end on the first session, §0 every session after.
2. `docs/phase.md`. The current phase and its stop boundary. Do not build past it.
3. `frontend.md`. The design authority. `PRD.md` has no design section on purpose. Never invent
   visual decisions from the PRD, and never restate design rules into other files.
4. `WHAT_IS_MEASURED.md`, before writing any user-facing string or claim.

## The mechanism chain

```
commitment  ->  sample  ->  verdict  ->  breach record  ->  payout
```

Every file in this repository serves one link in that chain. If a change serves none of them, it is
scope creep, and the rubric does not pay for it.

## Enumerated states

`COVERED_AT_SAMPLE` · `SPREAD_BREACH` · `DEPTH_BREACH` · `ABSENT` · `NOT_SAMPLED` ·
`WINDOW_CLOSED` · `SAMPLER_FAILED`

`COVERED_AT_SAMPLE` is the strongest positive state that exists. Do not add a state. Do not collapse
two states into one because the UI is easier that way.

## Forbidden vocabulary

Never write, in code, copy, README, commit message, or claim: guaranteed, safe, liquid, always,
protected, insured, risk-free. A schema validator enforces this and CI fails on a hit. The product is
designed so that it cannot lie by accident, and the words are half of that design.

## Hard blocks

| Forbidden | Scope |
|---|---|
| `as any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` | all TypeScript |
| Empty `catch {}` | all TypeScript |
| A `default:` case that swallows an unknown state | every state machine |
| Absolute developer paths | every tracked file |
| Hex address literals | `apps/`, `packages/`, `contracts/src` |
| Deleting or skipping a failing test to make CI pass | always |
| Committing anything under `internal/` | always |
| Private keys, mnemonics, API keys in any tracked file | always |
| Mainnet RPCs, mainnet addresses, real funds, any token | always. Testnet is the official target |

## Protocol facts

No market id, event signature, ABI, tick size, precompile address, or token address is compiled in.
Read them at runtime, probe at startup, and enter `PROTOCOL_CONFIG_CHANGED` on mismatch instead of
guessing. Prefer an official SDK method over a hand-rolled call every time.

## The proof path

Nothing simulated appears on the public proof path. Local fixtures are labelled `LOCAL FIXTURE` in
the UI. Our own maker is labelled `PROJECT_BASELINE` and is never counted as adoption or demand.
Every sample carries `source: REACTIVITY` or `source: KEEPER`, in storage and on screen. A sample
without a source label is a bug, not a sample.

## Ledgers you must keep

- `DECISIONS.md`, append-only. What was decided, what evidence forced it, what it costs later.
  Superseded entries stay, and the new entry says so.
- `BUILD_LOG.md`, running.
- `packages/claim-ledger/data/claims.json`. A claim and its evidence land in the same commit or
  neither lands. When execution contradicts a claim, narrow the claim immediately.
- `docs/phase.md`, updated in the commit that closes a gate.

## Completion reports

When you finish a unit of work, cite the exact files you changed and the exact commands you ran, with
their outcomes. "Tests pass" is not a report. Measurement work reports the actual numbers, including
the failures.

## When upstream disagrees with the PRD

Upstream wins. Record the discrepancy in `DECISIONS.md` and adapt while preserving the product thesis
in `PRD.md` §4.
