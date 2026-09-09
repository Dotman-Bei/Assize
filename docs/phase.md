# Current phase

**Phase: P1. Status: in progress. G2 closed, G1 open.**

Updated 2026-09-10. G2 passes. G1 does not, and the phase stays open because of it. This file is not
marked passed on thin evidence: the reason G1 is open is written below rather than deferred.

## Stop boundary

Nothing is deployed and nothing calls a live market until G1 and G2 pass.

- **G1**, no compiled-in protocol facts: `pnpm probe:all` exits zero and the address-literal check
  finds nothing in `apps/` or `packages/`.
  **Status: NOT PASSED.** The static half passes — `pnpm check:no-address-literals` finds nothing in
  `apps/`, `packages/` or `contracts/src`. The live half cannot run here: the DreamDEX SDK is not
  resolvable from the npm registry under any candidate name, and `dream-rpc.shannon.somnia.network`
  does not resolve from this environment. `pnpm probe:all` exits 1 and names both. The probe
  machinery itself was verified against a reachable public RPC. See DECISIONS.md D-010.
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

1. Network access to Somnia Shannon, so a probe can read a live chain.
2. The DreamDEX SDK, pinned in `skills-lock.json` by source, path and SHA-256 (AGENTS.md §0.2). The
   market-metadata read in `scripts/probe-dreamdex.ts` is written against the pinned SDK, in the same
   change that pins it — not from memory (PRD §0.3).

Until both exist, G1 cannot pass and P2 cannot begin. Separately, K9 (`OWNER DECISION`) governs
whether the submission path continues at all; P1 is identical under either branch.
