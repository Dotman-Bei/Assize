# Current phase

**Phase: P2. Status: DEPLOYED AND MEASURING. G3 and G4 pass. G11 partly.**

P1 complete (G1, G2). Live on Shannon since 2026-09-10:

| | |
|---|---|
| `AssizeRegistry` | `0xa43d71fff5ecedc577a0623421a16c2d11dc6b61` |
| `CoverageSubscriber` | `0x2c07cb635c20e89bdc8a10bd85c4f20f8b5a92f0` |
| Market under measurement | `0x0000000000000000000000000000000000000000000000000000000000018bb8` |

- **G3 PASSED.** Validators invoked the handler; samples are written with `source: REACTIVITY` and a
  block pin. Callback tx `0x98023141362bab2255dbf6f73342912b3929facfff7091129edcdd7e88de3adf`, whose
  `from` and `to` are both the subscriber and whose nonce is the block-unique reactivity nonce.
- **G4 PASSED.** A real quoting breach recorded against a live market: committed max spread 15000,
  sampled book 686000/714000, spread 28000, verdict re-derives to `SPREAD_BREACH` from chain alone.
  The 1 STT bond is recorded as forfeited.
- **G11 partly.** Subscription funding and consumption are proven on chain and the cost per sample is
  measured (roughly 0.016 STT at 6 gwei). The explicit unfunded state is not yet surfaced in a UI.

**Cut by K10 (DECISIONS.md D-021):** payouts, the claim flow, multi-market. Assize demonstrates
measurement and penalty recording, **not settlement**. A bond is recorded forfeited and no trader is
paid, because the code that would pay them is cut. Nothing may imply otherwise.

Updated 2026-09-10. Both gates in P1's stop boundary are met, so nothing in P1 blocks a move to P2.

K9 resolved: the submission window is open and closes 2026-09-11. K10 fired at the same moment and
its cut is recorded in D-021.

## P2 stop boundary

G3, G4 and G11. G3 and G4 pass. G11 needs its unfunded state surfaced.

## What remains, in K10's protected order

1. **G7 — the re-derivation half passes; the app now exists but is not hosted.**
   Tested for real: a fresh `git clone`, `pnpm install`, and only the README's own commands. All five
   chain reads resolve, the block pin checks out against `cast block --field parentHash`, and
   `pnpm claim:verify` re-derived 25 of 25 stored samples with `packages/reference` and agreed with
   the chain every time — no account, no API key, no access to anything of ours.

   G7 as written also says "a stranger reaches the live app". `apps/web` is now built — a static
   page reading the chain directly, with the live commitment, the sample stream grouped by instant,
   the breach evidence and generated verification commands. It runs locally with
   `pnpm --filter @assize/web dev`. **It is not deployed to a public URL**, which needs a hosting
   account the owner holds. So G7 stays **partly met** until it is hosted.

   Treating the app as cut by K10 was an error, corrected in D-025: K10 cuts the claim flow, not the
   frontend, and the gates it protects need one.
2. **G9** — three first-time users completing the core action unaided. Needs a UI, and needs people.
3. **G12** — submission package. Done: README to the five beats, `DEPLOYMENT.md`, `SETUP.md`,
   `SECURITY.md`, `ARCHITECTURE.md`, `LICENSE`, `.env.example`, and the SDK and documentation
   feedback report (`FEEDBACK.md`, eight findings with reproductions and payloads).
   Outstanding and owner-held: the demo video, filing `FEEDBACK.md` wherever the organisers asked,
   and submitting. The repository must also be made public.

Not attempted, and not to be claimed: G5 (payout) and G6 (a sustained 24h campaign).

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
