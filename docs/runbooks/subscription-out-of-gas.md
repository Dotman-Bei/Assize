# The subscription runs out of gas mid-window

**This has happened.** DECISIONS.md D-032. Sampling stopped at 29,541 samples with the
window still open, and D-020 had predicted the mechanism before it fired.

## What it looks like

`sampleCount` stops climbing while the window is open and the pool is still trading. No
revert, no event, no error anywhere — the callbacks simply stop. `SampleRecorded` was the
only signal that sampling was alive, so its absence is the whole symptom.

## Confirm it in one command

```bash
pnpm probe:reactivity
```

The subscription is gone when `somnia_reactivityGetSubscriptions` returns an empty list
for the subscriber address. That is the diagnosis: **removed, not paused.**

By hand:

```bash
cast rpc somnia_reactivityGetSubscriptions "$SUBSCRIBER" --rpc-url "$RPC"
cast balance "$SUBSCRIBER" --rpc-url "$RPC"
cast call "$REGISTRY" "sampleCount()(uint256)" --rpc-url "$RPC"
```

## Why it happens

D-020: **the `gasLimit` is a funding floor, not a ceiling.** The subscriber's balance is
tested against the whole configured `gasLimit` at every firing, not against gas used. At
6,000,000 gas and a 6 gwei floor that is 0.036 STT which must stay free at all times. Fall
below it and the chain **removes** the subscription rather than skipping one callback.

There is no warning between "funded" and "removed", and removal is not reversible by
topping up.

## Recovery

1. **Top up first.** The contract takes a plain transfer (`receive()`, added after D-023,
   when the first deployment could not be funded at all).

   ```bash
   cast send "$SUBSCRIBER" --value 10ether \
     --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC"
   ```

2. **Clear the dead subscription id before re-subscribing.** The chain removed the
   subscription without telling the contract, so `subscriptionId` still holds the removed
   id and `subscribe` refuses with `AlreadySubscribed`.

   ```bash
   cast send "$SUBSCRIBER" "unsubscribe()" \
     --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC"
   ```

   `SubscriptionCleared(id, acknowledged)` is emitted with `acknowledged: false` when the
   chain had already removed it. That is the expected reading here, and it is success.

   > **On a subscriber deployed before D-044 this step is impossible and the contract is
   > unrecoverable.** The old `unsubscribe` reverted `UnsubscribeFailed` when the
   > precompile rejected an id it no longer knew, and the state reset shared that
   > transaction, so it rolled back too. Nothing clears the id. `sweep(to)` still works —
   > recover the balance with it and redeploy. Because `AssizeRegistry.subscriber` is
   > immutable, the registry is redeployed with it.

3. **Re-subscribe**, then confirm the count moves.

4. **Record the gap.** First and last block of the outage into `DECISIONS.md`, with the
   readings. Samples resume at the current block; the missing instants stay `NOT_SAMPLED`
   for good.

## Prevention

`pnpm preflight` computes the floor and reports SHORT before a run rather than after.
Run it before every window. The measured cost is 0.001286 STT per sample (D-043), so
funding is sized from that figure and the expected event rate — but the **floor** is
sized from `gasLimit`, and it is the floor that removes the subscription.

## Do not

Do not backfill the gap. Do not lower `gasLimit` to stretch a balance without re-measuring
against the live pool: D-022 records a limit sized from a fixture at 254,574 when the live
pool needed 2,730,154, and every callback then ran out of gas, was charged for, and wrote
nothing. An underfunded limit is worse than an unfunded subscription, because it spends
money to produce silence.
