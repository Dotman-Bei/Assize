# Current phase

**Phase: P1. Status: in progress. G2 closed, G1 open.**

Updated 2026-09-10, twice. G2 passes. G1 does not, and the phase stays open because of it. This file
is not marked passed on thin evidence: the reason G1 is open is written below rather than deferred.

The second update narrowed G1's blocker considerably. `pnpm probe:dreamdex` now runs against live
Shannon testnet and exits zero. One input is still missing, named below.

## Stop boundary

Nothing is deployed and nothing calls a live market until G1 and G2 pass.

- **G1**, no compiled-in protocol facts: `pnpm probe:all` exits zero and the address-literal check
  finds nothing in `apps/` or `packages/`.
  **Status: NOT PASSED, one blocker left.** Three of its four parts pass:
  - static: `pnpm check:no-address-literals` finds nothing in `apps/`, `packages/`, `contracts/src`;
  - live market metadata: `pnpm probe:dreamdex` exits zero against Shannon testnet (chain 50312 at
    `https://dream-rpc.somnia.network`), discovering markets from `MarketCreated` logs through the
    pinned `@somnia-chain/markets-sdk@0.29.0` and confirming a configured market id;
  - venue addresses: read from the SDK at runtime, none compiled in.

  The remaining part is `pnpm probe:reactivity`, which needs the Somnia reactivity precompile's
  address. That address is in none of the pinned sources, and PRD §0.3 forbids inventing a
  precompile calling convention. See DECISIONS.md D-014, which supersedes D-010.
- **G2**, evaluator agreement: the Solidity evaluator and `packages/reference` agree on 10,000
  generated commitment and sample pairs, zero divergence.
  **Status: PASSED**, 2026-09-10. `pnpm test:differential`, seed `0xa551235`, 10,000 pairs, zero
  divergence, all seven states reached by the corpus. The gate also compares the breach
  classification, since that is what decides whether a bond forfeits. Verified to fail on an injected
  one-character change before being trusted.

## In scope for P1

`packages/protocol-types`, `packages/reference`, `contracts/src/AssizeRegistry.sol`, the differential
harness, `scripts/probe-dreamdex.ts`, `scripts/probe-reactivity.ts`.

All present. `AssizeRegistry.sol` implements `commitment -> sample -> verdict -> breach record` and
stops there: payout is P3, so the contract escrows bonds it has no path to release and is not
deployable as it stands (DECISIONS.md D-006). That is consistent with this phase, which deploys
nothing.

## Explicitly out of scope for P1

Deployment, subscriptions, the web app, the SDK, payouts, the campaign. Building any of these before
the two evaluators agree means building on an unproven seam, which is the failure mode this
repository is organised to prevent.

## Phase order

| Phase | Contents | Boundary |
|---|---|---|
| P1 | types, reference evaluator, registry contract, differential harness, probes | G1, G2 |
| P2 | deploy, subscribe, first live sample, first recorded breach | G3, G4, G11 |
| P3 | payout, witnessed volume, campaign, verifier CLI | G5, G6 |
| P4 | web surfaces per `frontend.md`, SDK, user testing, submission | G7 to G10, G12 |

Update this file in the commit that closes a gate. Do not mark a phase passed on thin evidence. If
the evidence is thin, write here why, and leave the phase open.

## What P1 needs before it closes

**One thing: the Somnia reactivity reference.** The precompile's address on Shannon and its `onEvent`
handler convention. It is the fourth item in AGENTS.md §0.2's pinning list and the only one not
supplied. With it, `probe:reactivity` completes, G1 closes, and P2 can begin. See D-014.

If it turns out the reactivity precompile is genuinely unavailable rather than merely undocumented,
PRD §26 K1 governs: switch to Path K, label every sample `KEEPER`, and delete every claim about
validator-delivered measurement. K1 is not fired today — the markets do emit subscribable events
(D-012), so the capability exists; only the document is missing.

Separately, K9 (`OWNER DECISION`) governs whether the submission path continues at all; P1 is
identical under either branch.
