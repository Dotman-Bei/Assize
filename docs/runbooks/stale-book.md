# The RPC returns a stale book

The most dangerous of the five, because it does not stop anything. Samples keep arriving,
the counter keeps climbing, the app keeps drawing states. They are just wrong — and a
wrong sample recorded as a breach forfeits a bond that should not have been forfeited.
That is the incident PRD §26 K6 exists to stop.

## Where it can and cannot happen

**It cannot happen on the reactivity path**, and the reason is structural rather than
lucky. `_onEvent` calls `pool.getBookLevels` from inside the transaction the validator is
executing, at the block the log was committed in. There is no RPC between the book and the
sample — the read is the same EVM state the log came from. A stale book is not reachable
there, and no procedure below applies to it.

**It can happen everywhere a book is read over JSON-RPC**: the keeper path (K1), the web
app, and anything using `packages/verifier`. The exposure is reading and display, not
sampling.

## Confirm it

A stale endpoint reports an old head, or a head that does not move.

```bash
cast block-number --rpc-url "$RPC"; sleep 3
cast block-number --rpc-url "$RPC"
```

Blocks are 100ms. Three seconds is ~30 blocks. A head that moved by a handful, or not at
all, is a lagging node.

Compare two endpoints at one block, which is the direct test:

```bash
B=$(cast block-number --rpc-url "$RPC")
cast call "$POOL" "getBookLevels(bool,uint64)((uint256,uint256)[])" true 1 \
  --block "$B" --rpc-url "$RPC"
cast call "$POOL" "getBookLevels(bool,uint64)((uint256,uint256)[])" true 1 \
  --block "$B" --rpc-url "$SECOND_RPC_URL"
```

Two answers for one block number means at least one endpoint is wrong. They cannot both be
right, and this test says so without needing to know which is which.

## Why stored samples survive it

Every sample stores `blockNumber` and `blockHash`, and `blockHash` is the **parent** hash —
a contract cannot observe the hash of the block it is running in (D-016). So a verifier
checks:

```
getBlock(sample.blockNumber).parentHash == sample.blockHash
```

A sample taken against a forked or stale view fails that check against a healthy endpoint.
This is what `pnpm assize verify <breachId>` does first, from a fresh clone against a
public RPC, before it re-derives anything:

```bash
pnpm assize verify 0
```

**A stale RPC cannot forge a passing verification**, because the pin is checked against
whatever endpoint the verifier chose, not the one that wrote the sample. That is the whole
reason the pin exists.

## Recovery

1. **Point at a healthy endpoint.** Change `SOMNIA_RPC_URL`, re-run the head test.
2. **Re-verify anything read while it was stale.** `pnpm assize verify <breachId>` for each
   breach recorded in the affected range. The pin check is the one that matters.
3. **If a sample fails its pin**, it was written against a view that is not the canonical
   chain. Record it in `DECISIONS.md` with the block and both readings. It stays in storage
   — the registry has no delete, deliberately — so the correction is published, not erased.
4. **If a keeper wrote samples while lagging**, K6 governs. Stop the keeper first, then
   assess.

## Do not

Do not "refresh" a stale reading by writing a new sample for the old instant. That is
backfilling, and it converts an endpoint problem into a fabricated measurement. The old
instant stays as it is; sampling resumes at the current block.

Do not trust an endpoint that agrees with itself. Two reads from one lagging node are
consistent and both wrong — the test above is deliberately across two endpoints.
