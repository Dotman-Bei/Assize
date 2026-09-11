# Demo script

PRD §23: two to three minutes, five beats in the official order, real testnet interaction.
PRD §24 requires the video for G12, and `pnpm submission:check` will not pass without it.

**Every number below was re-read from chain on 2026-09-11 and is checkable while the camera
runs.** Nothing here needs a rehearsed cache, which is §23's cold-start requirement.

## Read this before recording

Two things about this run constrain how it may be narrated, and both come from PRD §21 — a claim
may not outrun its evidence. A video is the place that rule is hardest to keep and easiest to
break, because the audience cannot check anything in real time.

**1. The run is finished. Do not narrate it in the present tense.** Sampling ran from block
484439389 to 484519171 and stopped when the chain removed the subscription (D-032). The window
then closed at 484837694. So §23 beat 3 as written — "samples arrive, the coverage state changes
in front of the viewer" — **cannot be performed live.** Show the recorded stream and say it is a
completed run. Saying "watch the samples come in" over a closed window would be false in the one
place nobody can verify it.

**2. Beat 4 is now performable as written, and has its own limit to state.** Settlement shipped
(D-047): a witnessed trader claimed a forfeited bond in full and the transaction is on chain. What
still has to be said out loud is who a payout can reach — **traders the chain saw filling inside the
window, and nobody else.** Someone who held the position and lost money without trading is owed
nothing here. The sentence you use goes into `submission.json` as
`demo.beat4LimitationStatement`, and the gate checks it is there.

---

## Beat 1 — Problem (0:00–0:20)

**Show.** A DreamDEX market page with a quoted price.

> A market shows you a price. That price is a claim about a book you cannot see — and nothing
> checks it. A maker can quote tight, and widen or vanish the instant it matters. Today the only
> evidence you get is your own fill.

## Beat 2 — Solution (0:20–0:50)

**Show.** The commitment on the app's market page, and the bond beside it.

> So a maker publishes a commitment first, and bonds it. This one says: maximum spread fifteen
> thousand raw price units, minimum size one hundred million, over a fixed window of blocks. One
> STT behind it.
>
> The envelope is on chain before the window opens. It is not a promise anyone has to take on
> trust — it is a statement that can be checked against what the book actually did.

| | |
|---|---|
| Registry | `0xa43d71fff5ecedc577a0623421a16c2d11dc6b61` |
| Max spread | 15000 · Min size 100000000 · Bond 1 STT |
| Window | blocks 484437694 → 484837694 |

## Beat 3 — Product (0:50–1:30)

**Show.** The sample stream, grouped by instant. Then the callback transaction in the explorer.

> Somnia's reactivity precompile does the sampling. Every log the market emits triggers a callback
> that reads the book at that instant and writes a sample — block number, both sides, both sizes,
> pinned to the block.
>
> **This is a completed run, not a live feed.** It recorded twenty-nine thousand five hundred and
> forty-one samples across one thousand eight hundred and ninety-nine distinct blocks. The envelope
> held at a hundred and ten of those instants and failed at the rest. Both are recorded. The chain
> says which.

**Show the callback transaction** — this is the beat's strongest thirty seconds, because it proves
we did not write these samples ourselves:

```
0x98023141362bab2255dbf6f73342912b3929facfff7091129edcdd7e88de3adf
from   0x2c07CB635C20E89Bdc8A10BD85C4f20F8b5a92F0
to     0x2c07CB635C20E89Bdc8A10BD85C4f20F8b5a92F0
nonce  8127578846003207
```

> From and to are both the subscriber, and that nonce is the block-unique reactivity nonce. No
> account of ours sent this. Validators delivered it.

## Beat 4 — Demonstration (1:30–2:20)

**Show.** Breach 0, then the sample behind it, then the terminal running the verify command.

> The maker's book went to bid six hundred and eighty-six thousand against ask seven hundred and
> fourteen thousand. That is a spread of twenty-eight thousand, against a committed maximum of
> fifteen thousand. Breach.

**Run this on camera.** It re-derives the verdict from the stored sample in a fresh clone against
a public RPC — no account, no key, no access to anything of ours:

```bash
pnpm assize verify 0
```

> The bond is forfeited. And then it is paid — to the trader the registry saw filling while the
> commitment did not hold.

**Show the claim transaction**
`0xec831878e0c0e94c8c7bdec3bb6411a6fe4739cc3402d52dd0d13186ae3a1d25` — 1 STT, the whole bond, to the
sole witness.

> Being witnessed is not something you assert about yourself. One pool log says who placed an order;
> another says what that order filled. The registry joins them, and refuses a claim on an order you
> did not place.
>
> So here is the limit, plainly: **a payout reaches traders the chain saw trading inside that
> window, and nobody else.** If you held the position and lost money without trading, this pays you
> nothing.
>
> The other limit is just as real: this measures instants, not intervals. A sample is one reading
> at one block. It is not proof the book held between two samples, and we never count it as one.

## Beat 5 — Future vision (2:20–2:45)

> Make a commitment a listing requirement. Then a venue can advertise its coverage because it has
> been measured, not because it says so.
>
> The instrument is small. What changes is whether a liquidity claim has to survive contact with
> evidence.

---

## Checklist before you upload

- [ ] Beat 3 says "completed run", never "watch them arrive"
- [ ] Beat 4 says who a payout can reach, out loud, not on a slide
- [ ] Beat 4 says sampling happens at instants
- [ ] `pnpm assize verify 0` was run on camera and passed
- [ ] Total runtime between 2:00 and 3:00
- [ ] Then fill in `submission.json`: `videoUrl` and `demo.beat4LimitationStatement`
- [ ] `pnpm submission:check`
