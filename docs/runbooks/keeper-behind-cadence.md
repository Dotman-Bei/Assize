# The keeper falls behind its cadence

## Read this first

**The keeper path is not in use.** PRD §26 K1 is the criterion that would select it, and
K1 **stood down**: the DreamDEX book emits events, so the reactivity path works and is the
one deployed. `AssizeRegistry.keeper` currently reads the zero address:

```bash
cast call "$REGISTRY" "keeper()(address)" --rpc-url "$RPC"
# 0x0000000000000000000000000000000000000000
```

While it is zero, `onlySampler` admits the subscriber and nothing else, and this page
describes a path no address can currently take. It is written because §15 requires it and
because K1 can still fire — not because a keeper is running.

## What falling behind means here

A keeper samples on a wall-clock cadence rather than on events. Behind cadence means the
interval between consecutive `KEEPER`-labelled samples exceeds `KEEPER_CADENCE_SECONDS`.

**Nothing on chain enforces a cadence, and nothing can.** A contract cannot observe a
sample that was not taken. A keeper that stops produces no evidence of stopping — the gap
is only visible by comparing what arrived against what was promised, off chain. This is
the structural reason PRD §8.2 prefers the reactivity path, and it is why the keeper's
samples are labelled differently rather than being made to look the same.

## Detect it

Sample density over a known block range, from stored samples:

```bash
pnpm evidence:report
```

By hand, the spacing between the last samples:

```bash
N=$(cast call "$REGISTRY" "sampleCount()(uint256)" --rpc-url "$RPC")
for i in 3 2 1; do
  cast call "$REGISTRY" "sampleAt(uint256)" $((N - i)) --rpc-url "$RPC"
done
```

Blocks are 100ms, so an expected interval in blocks is `KEEPER_CADENCE_SECONDS × 10`.
Spacing materially above that is the gap.

## Recovery

1. **Diagnose before restarting**, because restarting destroys the evidence of why it
   stopped. Keeper balance, then process:

   ```bash
   cast balance "$KEEPER_ADDRESS" --rpc-url "$RPC"
   ```

   An out-of-funds keeper and a crashed keeper look identical from chain and are fixed
   differently.

2. **Restart, and let it resume at the current block.**

3. **Record the gap** in `DECISIONS.md` — first and last block, with the readings.

4. **Publish coverage with the gap included, not spanned.** A density figure computed over
   a range containing an outage overstates coverage. PRD §21: a claim may not outrun its
   evidence, and the instants nobody sampled are evidence of nothing.

## Do not

Do not backfill. This is the failure mode where backfilling is most tempting — the keeper
is our own process, the missing instants are recent, and the book history is readable, so
the samples *could* be reconstructed and would pass their pin check. That is exactly what
makes it dangerous. A reconstructed sample is indistinguishable from a real one on chain
and is not a measurement of anything; it would put a fabricated reading behind a bond
forfeiture. The registry cannot stop it. This sentence is the control.

Do not relabel keeper samples as `REACTIVITY`. The label is what lets a reader weigh the
two paths differently, and PRD §6 rests the entire keeper trust argument on the two being
told apart. `recordSample` rejects `UNLABELLED` but takes the caller's word for which of
the other two it is — so this, too, is procedural.

Do not register a keeper to work around a reactivity outage without recording the decision
and the evidence that reactivity stopped. See
[callbacks-stopped.md](callbacks-stopped.md).
