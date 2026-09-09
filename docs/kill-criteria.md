# Kill criteria

Generated from `PRD.md` §26. Do not hand-edit. If a criterion is wrong, fix §26 and regenerate.

If any condition below becomes true: stop claiming the affected capability, record it with status
`failed` or `unavailable` and a plain-language blocker, print it in the build report, and keep
building everything that still stands. Do not hide a blocked capability behind a substitute. Do not
soften the wording to keep the claim alive.

| # | Condition | Claims affected | Action |
|---|---|---|---|
| K1 | Markets emit no event the reactivity precompile can subscribe to | C-003, Path R | Switch to the keeper path, label every sample `KEEPER`, delete claims about validator-delivered measurement, publish the cadence and its trust cost |
| K2 | Handler gas per sample makes a useful window unaffordable | C-003, C-006 | Coarsen the cadence, publish cost per sample and the resolution it buys, never call the result continuous |
| K3 | The registry cannot witness per-address fills | C-005 | Narrow payouts to pre-registered traders, drop C-005 to R1, say plainly who cannot be reached |
| K4 | The book read exposes no size at the committed depth | C-001, C-004 | Measure spread only, remove `DEPTH_BREACH` from product and UI, state that depth is unmeasured |
| K5 | No third-party maker posts a bond | adoption claims | Run the baseline maker labelled `PROJECT_BASELINE`, count nothing as adoption |
| K6 | A breach is recorded that did not occur | C-001, C-004, campaign | Stop the campaign, publish the incident with the bad sample and the true book state, fix, restart counts from zero |
| K7 | A bond is drained by wash claims | C-005 | Suspend payouts, ship self-match rejection and per-address caps, publish the incident |
| K8 | STT funding cannot cover the campaign | C-006, G6 | Shrink window and markets, publish exact funding and what it bought, never present a short window as a full one |
| K9 | The hackathon window is closed with no extension | submission path | OWNER DECISION: stop, or continue as an independent ship. Never submit to a closed hackathon, never backdate a repository |
| K10 | G4 not passed with 48 hours left | scope | Cut payouts, multi-market, claim flow. Protect G3, G4, G7, G9, G12 in that order. Record the cut and its cost |
| K11 | A published verdict cannot be re-derived by a stranger | C-002, R4 targets | Drop affected claims to R2, delete "independently checkable" from all copy, publish which input is missing |
