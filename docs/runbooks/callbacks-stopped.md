# Precompile callbacks stop arriving

The symptom is identical to [running out of gas](subscription-out-of-gas.md) — `sampleCount`
stops climbing — but the causes are different and so are the fixes. **This page is the
triage.** Work down it; the first check that fails is the diagnosis.

Nothing here is a guess about what a node might do. Each step reads a fact.

## 1. Is the subscription still there?

```bash
cast rpc somnia_reactivityGetSubscriptions "$SUBSCRIBER" --rpc-url "$RPC"
```

Empty list → it was removed. Go to [subscription-out-of-gas.md](subscription-out-of-gas.md).
This is the common case and it has happened here (D-032).

## 2. Is the pool still emitting anything to match?

A subscription only fires on a log from its pinned emitter. No trading, no logs, no
samples — and that is correct behaviour, not an outage.

```bash
cast logs --from-block $(($(cast block-number --rpc-url "$RPC") - 300)) \
  --address "$POOL" --rpc-url "$RPC" | grep -c "blockNumber"
```

Zero over a few hundred blocks on a 100ms chain means the market is quiet. **A quiet
market is `NOT_SAMPLED`, and `NOT_SAMPLED` is not coverage.** Do not present a window with
no events as a window that held.

## 3. Is the subscription funded but the *handler* reverting?

A callback that reverts is delivered, charged, and writes nothing. The subscription stays
alive, so step 1 looks healthy while no samples appear.

```bash
cast call "$SUBSCRIBER" "commitmentId()(uint256)" --rpc-url "$RPC"
cast call "$REGISTRY" "subscriber()(address)" --rpc-url "$RPC"
```

The three reverts `_onEvent` can reach, and what each means:

| Revert | Cause | Fix |
|---|---|---|
| `EmitterNotThePool` | the filter is scoped to something other than the pool | unsubscribe, re-subscribe with the right emitter |
| `BookValueTooWide` | a book level exceeds `uint128` | not recoverable by configuration; the sample is refused rather than truncated, on purpose |
| `NotSampler` from the registry | this subscriber is not the registry's `subscriber` and is not its keeper | wiring error — the pair must be deployed together (`registry.subscriber()` must equal the subscriber address) |

The wiring error is the one to expect after a redeploy. `AssizeRegistry.subscriber` is
immutable and set in its constructor, so a registry points at exactly one
subscriber and a mismatched pair can never write a sample.

## 4. Is the gas limit large enough for *this* pool?

D-022: a limit sized from a local fixture was 254,574; the live pool needed 2,730,154.
Every callback ran out of gas and wrote nothing, while being paid for. Measure against
the live pool:

```bash
cast estimate "$SUBSCRIBER" "onEvent(address,bytes32[],bytes)" \
  "$POOL" "[]" "0x" \
  --from 0x0000000000000000000000000000000000000100 --rpc-url "$RPC"
```

If the configured limit is below this, callbacks are burning money to produce silence.
Re-subscribe with a limit above it — and re-read
[subscription-out-of-gas.md](subscription-out-of-gas.md), because raising the limit raises
the balance floor with it.

## 5. Is the node serving reactivity at all?

```bash
pnpm probe:reactivity
```

If `somnia_reactivityGetSubscriptions` and `somnia_reactivityGetSubscriptionInfo` are not
served, this endpoint cannot answer the question and every reading above was worthless.
Change `SOMNIA_RPC_URL` and start again at step 1.

## If none of the five explain it

Then the callbacks are being dropped upstream, which is not something this repository can
fix or diagnose further. Two things follow, in order.

**Record the gap.** First and last block, with the readings that establish them.

**Consider the keeper.** PRD §26 K1 exists for exactly this: sampling by a keeper on a
cadence instead of by reactivity. `AssizeRegistry.registerKeeper` is the owner's only
power, and every keeper sample is labelled `KEEPER` in storage and on screen so a reader
can tell the two paths apart without being told. Switching paths is a decision that goes
in `DECISIONS.md` with the evidence that reactivity stopped — not a quiet failover. K1
stood down once already (the book does emit events), so re-opening it needs a reason of
its own.
