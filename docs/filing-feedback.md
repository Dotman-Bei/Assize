# Filing the feedback report

PRD §20: *"File it where the organisers asked, and link it from the README."* The README link is
done — [`FEEDBACK.md`](../FEEDBACK.md) is linked from its *Feedback to the organisers* section.
Filing is the half that needs an account, so it is here rather than done.

Set `submission.json` → `feedbackFiledAt` **only once it is actually filed**, to wherever it landed.
The field feeds `pnpm submission:check`, so filling it in early makes the gate assert something
untrue.

## Where

| Destination | What goes there | Why |
|---|---|---|
| **DoraHacks submission** | a link to `FEEDBACK.md` on GitHub | the organisers' own channel, and the one that scores |
| **[somnia-chain/dreamdex-bot-kit](https://github.com/somnia-chain/dreamdex-bot-kit/issues)** | finding 9, as its own issue | issues are enabled, 25 open; it is a code bug with a fix |

`@somnia-chain/reactivity-contracts` has no public repository, so finding 9 has no upstream tracker
of its own. The Bot Kit is the closest maintained surface.

The canonical link, once pushed:
`https://github.com/Dotman-Bei/Assize/blob/main/FEEDBACK.md`

## Paste-ready issue for the Bot Kit

Finding 9 is the one worth filing separately: it is a code-level bug, it has a reproduction on
Shannon, and it permanently bricks a contract rather than merely inconveniencing a developer.

---

**Title:** `SomniaExtensions.unsubscribe` reverts on a chain-removed subscription, permanently wedging the handler

**Body:**

Package: `@somnia-chain/reactivity-contracts@0.2.1` — `contracts/interfaces/SomniaExtensions.sol`, lines 148-154.

```solidity
function unsubscribe(uint256 subscriptionId) internal {
    (bool success, ) = SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS.call(
        abi.encodeWithSelector(ISomniaReactivityPrecompile.unsubscribe.selector, subscriptionId)
    );
    if (!success) revert UnsubscribeFailed();
}
```

The chain removes a subscription on its own when the owner's balance falls below
`(price + priorityFeePerGas) * gasLimit`. That is documented. What is not documented is that the
removal leaves the owning contract holding an id the precompile no longer recognises — and that this
helper then reverts when asked to clear it.

A handler that guards `subscribe` against double-subscription stores the id and clears it in
`unsubscribe`. After the chain removes the subscription:

- `subscribe` refuses, because the stored id is non-zero
- `unsubscribe` reverts `UnsubscribeFailed` (`0x13e7ce5d`), because the precompile rejects the id
- the state reset in `unsubscribe` is in that same transaction, so **the revert rolls it back too**

There is no third call. The contract can never subscribe again.

**Reproduction on Shannon (chain 50312).** Subscriber `0x2c07cb635c20e89bdc8a10bd85c4f20f8b5a92f0`,
subscription `17611580`, removed by the chain after its prefund ran out:

```
$ cast rpc somnia_reactivityGetSubscriptions 0x2c07cb635c20e89bdc8a10bd85c4f20f8b5a92f0
[]

$ cast call $SUB "subscribe(bytes32[4],(uint64,uint64,uint64))(uint256)" ...
Error: execution reverted: AlreadySubscribed   (0x5fd8a132 — our guard)

$ cast call $SUB "unsubscribe()"
Error: execution reverted: UnsubscribeFailed   (0x13e7ce5d — yours)
```

The contract held 50 STT at that point. It was recoverable only because we had added a `sweep`
function for unrelated reasons. Without one the balance is stranded with the contract.

**Suggested fix, in preference order:**

1. Do not treat the precompile's refusal as failure — being asked to cancel something already
   cancelled is the goal reached another way. Return `bool` rather than reverting, or add
   `unsubscribeIfPresent` alongside, so a caller can clear its own state unconditionally.
2. Failing that, document it beside the removal rule: *a subscription removed by the chain leaves
   your stored id set, and `unsubscribe` will revert on it — clear your state before calling, not
   after.*

The general shape is worth stating because it will bite others: **a library helper that reverts when
the counterparty has already done the thing makes the caller's own state unlockable by a third
party.** The chain removes subscriptions unilaterally and by design, so every contract built on this
helper has the wedge latent in it.

Full write-up with eight other findings:
https://github.com/Dotman-Bei/Assize/blob/main/FEEDBACK.md
