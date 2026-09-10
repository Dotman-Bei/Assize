# A claim fails after a bond is partly withdrawn

## This cannot happen, and that is the whole page

PRD §15 names it because a protocol that pays out has to answer it. **This one does not
pay out.** The settlement path was cut under PRD §26 K10 when the submission window got
short (DECISIONS.md D-021), and it was cut rather than stubbed.

`AssizeRegistry` has no `claim`, no `settle`, no `withdraw`, and no admin path to move a
bond. It holds one `payable` function — `publishCommitment`, which takes the bond in — and
no code anywhere that sends value out. A partial withdrawal is not a state this contract
can be in, so there is no procedure to follow, and writing one would be pretending
otherwise.

Check it rather than believing it:

```bash
# Ask the deployed bytecode directly whether it dispatches on any of these.
CODE=$(cast code "$REGISTRY" --rpc-url "$RPC")
for sig in "claim(uint256)" "settle(uint256)" "withdraw()" "withdraw(uint256)" \
           "publishCommitment(bytes32,uint128,uint128,uint64,uint64)"; do
  SEL=$(cast sig "$sig" | sed 's/^0x//')
  echo "$CODE" | grep -qi "$SEL" && echo "PRESENT $sig" || echo "absent  $sig"
done
```

```
absent  claim(uint256)
absent  settle(uint256)
absent  withdraw()
absent  withdraw(uint256)
PRESENT publishCommitment(bytes32,uint128,uint128,uint64,uint64)
```

The last line is the point of including it: it is the positive control. Without a selector
the scan *does* find, four "absent" results would be equally consistent with a scan that
cannot find anything. Never publish an absence test without one.

The suite asserts it as a property, over 8,192 random calls across 64 runs:

```
forge test --match-contract BondConservation
  invariant_no_ether_ever_leaves     "ether left the registry, which has no path to send any"
  invariant_every_bond_is_still_held
```

And the gate reports it as cut rather than passed, which is the behaviour PRD §26 requires
of a blocked capability:

```bash
pnpm verify:testnet -- C-005
# C-005: CUT. Not passing, by design.   (exit 1)
```

## What a bonded breach does instead

A forfeit is **recorded**, not paid. `forfeitedAtBreachIdPlusOne` is written on the first
breach in a window and `BondForfeited` is emitted. The bond stays in the contract. Later
breaches are still recorded — each is evidence a verifier can re-derive — but a second
bond does not forfeit.

So the honest sentence, which belongs in the demo and in any description of this system:
**a bond was forfeited, and nobody was paid.** Both halves are true and the second half is
not a caveat, it is the state of the code.

## If settlement is ever built

It is P3, and this page becomes real work rather than a statement. The failure §15 is
pointing at is a claim that reverts after value has already left — a bond partly paid out,
a claimant partly satisfied, and storage disagreeing with the balance. The things to get
right, recorded now while the shape is still free:

- **Settle in one transaction or none.** A withdrawal split across calls is the state this
  page exists to prevent, and it is prevented by design, not by a runbook.
- **Effects before interactions.** Mark the bond spent before sending, so a reverting
  recipient cannot re-enter a bond that storage still shows as available.
- **A failed send must revert the accounting**, never be swallowed. AGENTS.md forbids the
  empty `catch {}` that would hide it.
- **Keep `invariant_no_ether_ever_leaves`** by replacing it with the invariant that
  succeeds it: the registry's balance equals bonds held plus payouts owed, at every step.
  The invariant should change shape, not be deleted, and a deleted invariant is the thing
  AGENTS.md names as never acceptable to make a suite pass.

Until then, PRD §21 governs: the claim flow does not exist, so nothing may be said about
it in any tense but this one.
