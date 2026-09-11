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
  measured: **0.001286 STT per sample**, divided out of a completed run of 29,541 samples rather
  than estimated from the gas limit. The unfunded state is now surfaced by the handler gas gauge on
  the Markets page, which reads zero callbacks remaining in red when the prefund is exhausted.

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

   G7 as written also says "a stranger reaches the live app". That is now true:
   **https://assize.vercel.app**, a static page reading the chain directly, with no server, no
   database and no environment variables — the addresses come from `deployments/` via
   `deployment.json`, which is why §17 leaves nothing for a hosting dashboard to supply.

   Asserted rather than assumed. `pnpm check:live` drives the deployed page in a real browser and
   requires numbers that can only have come from chain, because a page that loads and then fails to
   read the chain still answers 200:

   ```
   ok  sample count from chain    29541, matching sampleCount
   ok  breach count from chain    29431, matching breachCount
   ok  breach rows listed         25 row(s)
   ok  dossier opens on click     registry address, block pin, verify command
   ok  no console errors          none
   LIVE CHECK PASSED
   ```

   The dossier check clicks a row, because that is the core action and it is behind a click rather
   than a URL — a route-only check would never have reached it. **G7 is met.**

   Treating the app as cut by K10 was an error, corrected in D-025: K10 cuts the claim flow, not the
   frontend, and the gates it protects need one.
2. **G9** — three first-time users completing the core action unaided. Needs a UI, and needs people.
3. **G12** — submission package. The gate command PRD §22 names now exists:
   **`pnpm submission:check`**. It splits the package in two, because the halves fail differently.

   *In the repository, and passing:* the nine required files present and non-empty, the README's
   five beats in the official order, `DEPLOYMENT.md` agreeing with `deployments/` on every contract
   address, and a clean working tree. The address check is the one that earns its place — it is what
   catches a redeploy that left the published addresses pointing at a dead contract.

   *Owner-held, and outstanding:* a live public URL for the app, the demo video, the words beat 4
   uses to say that nobody was paid, and filing `FEEDBACK.md` with the organisers. These are
   declared in `submission.json`, and no declaration is taken at its word — a URL written there is
   fetched, and a repository said to be public is asked, unauthenticated, whether it is.

   The repository **is** public (`Dotman-Bei/Assize`, MIT detected by GitHub), so that item is now
   met and the gate confirms it. The gate also compares the local tip against the tip GitHub serves,
   because work that is committed but unpushed does not exist for a judge.

   `pnpm submission:check` currently exits 1, and PRD §24 governs: nothing is submitted before G12
   passes.

4. **§15 runbooks** — written, in `docs/runbooks/`. Five pages for the five failures §15 names.
   Four of them have happened here and are written from the incident and its readings rather than
   from imagination; the fifth cannot happen, because the settlement code it needs was cut, and its
   page proves the absence with a bytecode selector scan instead of rehearsing a procedure for code
   that is not there. Every command in every page was executed against the live chain before being
   published — which is how two of them were found to be wrong and fixed.

Not attempted, and not to be claimed: G5 (payout) and G6 (a sustained 24h campaign).

## The measurement run is closed

D-046: the owner chose to keep the finished run rather than redeploy for a fresh window. Sampling
ran blocks 484439389 to 484519171 — **29,541 samples across 1,899 distinct blocks**, all
`REACTIVITY`, with 29,227 `SPREAD_BREACH`, 204 `DEPTH_BREACH` and 110 `COVERED_AT_SAMPLE`.
Reproduce it with `pnpm evidence:report -- --from 484439389 --to 484519171`; its totals match the
registry's `sampleCount` and `breachCount` exactly, from events rather than from those counters.

Sampling stopped **before** the window closed, because the chain removed the subscription when the
prefund ran out (D-032). Those unobserved instants are `NOT_SAMPLED` and are not counted as
coverage. The subscriber could not be restarted afterwards; D-044 has the mechanism and the fix.

Consequence for the demo: **PRD §23 beat 3 cannot be performed live.** "Samples arrive, the coverage
state changes in front of the viewer" needs an open window, and there is not one. The video shows a
finished run and has to say so — narrating a closed run in the present tense is the §21 failure in
the one place an audience cannot check it.

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
