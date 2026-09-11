# A claim fails after a bond is partly withdrawn

**This page used to say the scenario could not happen.** That was true while settlement was cut
under K10: the deployed registry had no `CALL` opcode anywhere in its runtime, so no sequence of
transactions could move ether out of it. P3 shipped settlement (DECISIONS.md D-047), a bond has been
paid out, and the scenario is now reachable. This is a real runbook.

## What partial withdrawal means here

A bond is paid **pro-rata**, `bond × yourVolume ÷ witnessedVolume`, and several traders can claim
separately. So a bond is routinely part-paid: one claimant takes their share, the rest stays in the
registry waiting for the others. That state is normal, not an incident.

The incident is a claim that **should** succeed and does not, while the bond is already part spent.

## Confirm the state before touching anything

```bash
REC=$(ls deployments/*.json | head -1)
REGISTRY=$(node -p "JSON.parse(require('fs').readFileSync('$REC')).contracts.AssizeRegistry")
RPC=$SOMNIA_RPC_URL

cast call "$REGISTRY" "commitmentAt(uint256)" 0 --rpc-url "$RPC"      # bond, and whether forfeited
cast call "$REGISTRY" "paidOut(uint256)(uint256)" 0 --rpc-url "$RPC"
cast call "$REGISTRY" "witnessedVolume(uint256)(uint256)" 0 --rpc-url "$RPC"
cast balance "$REGISTRY" --rpc-url "$RPC"
```

`bond - paidOut` is what remains claimable for that commitment. The registry's balance covers every
commitment at once, so it is not the same number and should never be compared to one bond.

## Why a claim reverts, and what each one means

Ask before spending gas. Every one of these is a `cast call` away:

```bash
cast call "$REGISTRY" "claimableFor(uint256,uint128[])(uint256,uint256)" <breachId> "[<orderId>]" --rpc-url "$RPC"
```

| Revert | Meaning | What to do |
|---|---|---|
| `WindowStillOpen` | the window has not closed | wait. The share's denominator is still moving, and this is the guard that stops an early claimant being overpaid |
| `NotTheOrderOwner` | `orderOwner[orderId]` is not the caller | the claimant named an order they did not place, or the order was never attributed. Check `orderOwner` |
| `OrderAlreadySettled` | that order already paid | not a fault. Claim the orders that have not |
| `NothingToClaim` | zero volume, or a share that truncates to zero | the order never filled inside the window, or the share rounds below one wei |
| `NoWitnessedVolume` | nothing filled in the window at all | nobody is owed anything. The bond stays |
| `BondNotForfeited` | the commitment held | correct refusal |
| `PayoutExceedsBond` | **should be unreachable** | see below |

## The one that is an incident

`PayoutExceedsBond` means the shares summed past the bond. With the window closed the denominator
is fixed and they cannot, so this firing means an assumption has broken.

Do not work around it and do not raise the bound. Capture the state and record it:

```bash
cast call "$REGISTRY" "witnessedVolume(uint256)(uint256)" <commitmentId> --rpc-url "$RPC"
cast call "$REGISTRY" "paidOut(uint256)(uint256)" <commitmentId> --rpc-url "$RPC"
cast call "$REGISTRY" "fillVolumeOf(uint256,uint128)(uint256)" <commitmentId> <orderId> --rpc-url "$RPC"
```

Sum `fillVolumeOf` over every order that was witnessed. It must equal `witnessedVolume`. If it does
not, `witnessFill` accepted something it should not have, and that is the bug — not the bound that
caught it.

This is the guard that already earned its place once. The invariant run found the unbounded version
paying **12420 against a bond of 6214** before any of it was deployed, because the denominator grew
while the window was open.

## A failed send

`claim` reverts the whole transaction if the transfer fails, deliberately. A swallowed failure would
mark the orders settled while paying nothing, which is the one outcome a claimant cannot recover
from — so a reverted claim leaves the orders unsettled and claimable again.

The usual cause is a contract claimant whose `receive` reverts or runs out of gas. Claim to an EOA,
or fix the recipient.

## Do not

Do not add an admin path to move a stuck bond. The registry has exactly one function that sends
ether and it pays a witnessed trader; an owner override would make every bond discretionary, and the
bond is the only thing making a commitment cost anything.

Do not attribute an order by hand to make a claim work. `attributeOrder` is restricted to the
sampler and is write-once precisely so that a claim is never taken on anyone's word. An operator who
can name themselves the owner of another trader's order can take that trader's share.

Do not treat a part-paid bond as an incident. It is what pro-rata settlement looks like while the
other claimants have not come.
