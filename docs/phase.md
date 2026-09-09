# Current phase

**Phase: P1. Status: COMPLETE. G1 and G2 both pass.**

Updated 2026-09-10. Both gates in P1's stop boundary are met, so nothing in P1 blocks a move to P2.

P2 is not started. Its first act is a deployment, and PRD §26 K9 is an open `OWNER DECISION` about
whether the submission path continues at all. Deploying is cheap to do and awkward to undo, so the
phase advances on the owner's word rather than on this file's.

## Stop boundary

Nothing is deployed and nothing calls a live market until G1 and G2 pass. **Both now pass.** Nothing
has been deployed.

- **G1**, no compiled-in protocol facts: `pnpm probe:all` exits zero and the address-literal check
  finds nothing in `apps/` or `packages/`.
  **Status: PASSED**, 2026-09-10. `pnpm probe:all` exits zero: 10 checks, none blocked. Its parts:
  - static: `pnpm check:no-address-literals` finds nothing in `apps/`, `packages/`, `contracts/src`;
  - live market metadata: `pnpm probe:dreamdex` exits zero against Shannon testnet (chain 50312 at
    `https://dream-rpc.somnia.network`), discovering markets from `MarketCreated` logs through the
    pinned `@somnia-chain/markets-sdk@0.29.0` and confirming a configured market id;
  - venue addresses: read from the SDK at runtime, none compiled in.

  - reactivity: `pnpm probe:reactivity` confirms Shannon serves on-chain reactivity, via
    `somnia_reactivityGetSubscriptions`. Note that `eth_getCode` at the precompile returns `0x` by
    design — a precompile lives in the node — so presence is proven by the RPC, never by reading
    code. See DECISIONS.md D-015, which supersedes D-014.

  All four items in AGENTS.md §0.2's pinning list are pinned in `skills-lock.json`.
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

## What P1 established, and what it did not

Established: the two evaluators agree; the registry stores what it is given and re-derives verdicts
from storage; no protocol fact is compiled in; live market metadata reads from Shannon; and the
reactivity path exists on Shannon.

**Not established: that Assize has measured anything.** No sample has been written by Assize, no
breach recorded against a live market, no bond forfeited. Those are C-003 to C-005 and gates G3 to
G6, and they belong to P2 and P3. That reactivity exists on the network says nothing about whether
this product has used it, and no claim was raised on the strength of the probe.

## Before P2 begins

1. **K9 (`OWNER DECISION`).** P2's first act is a deployment. Do not deploy into a closed submission
   path without the owner's decision.
2. **A recursion guard, as a requirement rather than an incident.** The pinned reactivity reference
   warns that a handler's own logs are matched against subscriptions, so a subscription can feed
   itself and drain the owner's balance. Assize's subscriber emits `SampleRecorded` when it writes a
   sample. The P2 filter must exclude the registry's own address, and a test must prove it. D-015.
3. **STT for handler gas**, from the faucet in the Somnia Telegram community.
