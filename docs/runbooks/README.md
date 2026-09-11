# Runbooks

PRD §15 names five ways this system fails in operation. Each has a page here.

| # | Failure | Page |
|---|---|---|
| 1 | The subscription runs out of gas mid-window | [subscription-out-of-gas.md](subscription-out-of-gas.md) |
| 2 | Precompile callbacks stop arriving | [callbacks-stopped.md](callbacks-stopped.md) |
| 3 | The RPC returns a stale book | [stale-book.md](stale-book.md) |
| 4 | The keeper falls behind its cadence | [keeper-behind-cadence.md](keeper-behind-cadence.md) |
| 5 | A claim fails after a bond is partly withdrawn | [claim-fails-mid-withdrawal.md](claim-fails-mid-withdrawal.md) |

Four of the five have happened here, and those pages are written from the incident
rather than from imagination — each cites the `DECISIONS.md` entry it came from and the
readings taken at the time. The fifth has not happened, but it became reachable when
settlement shipped in P3 (D-047): its page said the scenario was impossible while the
registry had no way to send ether at all, and was rewritten as a real runbook once a bond
was actually paid out.

## What every one of these has in common

**A gap in sampling is not coverage.** PRD §8.2 calls an unfunded subscription "a silent
`NOT_SAMPLED`, which is the worst failure this product can have". Every failure below
ends in samples not being written, and the danger in all five is identical: a window that
was never watched looks, to anyone reading a count of breaches, exactly like a window
where nothing went wrong. `NOT_SAMPLED` exists so those two are distinguishable. Nothing
in an incident response may make them less so.

So the first rule of all five: **never backfill.** A sample carries `blockNumber` and the
parent hash of that block (D-016). A sample written now for an instant that passed is not
a late reading, it is a fabricated one, and `AssizeRegistry` will accept it because the
pin will resolve. The protection is procedural, and this is where it is written down.

The second rule: **record the gap.** Note the first and last block of the outage in
`DECISIONS.md` with the readings that established them. A published coverage figure that
silently spans an outage is a claim above its evidence (PRD §21).

## Before you start

```bash
set -a; . ./.env.local; set +a     # never committed, mode 0600 (SECURITY.md)
pnpm preflight                     # balances against what each account needs
pnpm probe:reactivity              # does this node serve reactivity, is the subscription funded
pnpm probe:dreamdex                # is the book readable and shaped as expected
```

Every page below uses these three shell variables. Set them by reading the deployment
record — never by pasting an address, which is how a runbook ends up pointing at a
superseded deployment:

```bash
REC=$(ls deployments/*.json | head -1)
REGISTRY=$(node -p "JSON.parse(require('fs').readFileSync('$REC')).contracts.AssizeRegistry")
SUBSCRIBER=$(node -p "JSON.parse(require('fs').readFileSync('$REC')).contracts.CoverageSubscriber")
POOL=$(node -p "JSON.parse(require('fs').readFileSync('$REC')).measurement.dreamdexPool")
RPC=$SOMNIA_RPC_URL
```

The pool is in the record because it was *discovered* — `pnpm probe:dreamdex` resolves it
from `DREAMDEX_MARKET_ID` through the SDK, and PRD §17 keeps it out of source either way.
