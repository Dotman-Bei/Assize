# SDK and documentation feedback

Filed from building **Assize** for the Somnia × DreamDEX Event Contracts hackathon. Every item below
cost real time during a real build, and each is reproducible from a clean environment. Nothing here
is a style preference.

**Environment.** `@somnia-chain/markets-sdk@0.29.0`, `@somnia-chain/reactivity-contracts@0.2.1`,
Foundry 1.8.1 (`forge` 982849d, 2026-08-28), Node 20.20.2, Somnia Shannon testnet chain 50312 via
`https://dream-rpc.somnia.network`. Behaviour below was identical on
`https://api.infra.testnet.somnia.network`.

---

## 1. `marketCreatorEventsAbi` cannot be imported by subpath

**Severity: high.** It blocks market discovery, which every project needs on day one.

`MarketCreated` is the only place a market's `marketId` is published — `getBinaryPoolParams()` does
not return it, as the starter template's `IEventContracts.sol` says. The ABI lives in
`dist/eventsAbi.js` and is not re-exported from the package entry, and the subpath is not in
`exports`:

```
$ node -e 'require("@somnia-chain/markets-sdk/dist/eventsAbi.js")'
ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './dist/eventsAbi.js' is not defined
by "exports" in .../@somnia-chain/markets-sdk/package.json
```

The official starter template hits this too and works around it with a relative path:

```js
// typescript/src/discover.mjs, with its own comment explaining why
import { marketCreatorEventsAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js";
```

That workaround does not survive a pnpm workspace, where the package is a symlink into a virtual
store. We resolve the package root with `createRequire(...).resolve()` and build a file URL from it —
about fifteen lines to import an ABI.

**Suggestion.** Re-export `marketCreatorEventsAbi` from the entry point, or add `"./dist/*"` to
`exports`. The first is better: discovery is a first-run task and it should not require knowing the
package's internal file layout.

---

## 2. `eth_getProof` is not served, so `forge script` and fork tests do not work

**Severity: high.** It removes Foundry's normal deployment and integration-test paths.

```json
→ {"jsonrpc":"2.0","id":1,"method":"eth_getProof","params":["0x3ecC694Cef705358864a646142ac17A90E29e388",[],"latest"]}
← {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found","data":null}}
```

Foundry's fork backend needs it. Both `forge script --broadcast` and `forge test --fork-url` fail,
and `--skip-simulation` does not help because the simulation host is what fails. The surfaced error
names neither the method nor the reason:

```
Error: server returned an error response: error code -32602: invalid parameters, data: null
```

and inside a fork test:

```
[FAIL: EVM error; database error: failed to get account for 0x0000…0000:
 server returned an error response: error code -32602: invalid parameters]
```

We spent a while assuming the node had pruned state. It has not — `eth_getBalance` resolves 10,000
blocks back. It is a JSON-RPC surface gap, not a retention one. We deployed with `cast send --create`
and address prediction instead, and our fork-based integration test is committed but permanently
skipped.

**Suggestion.** Implement `eth_getProof`, or state plainly in the network docs that Foundry scripting
and fork testing are unavailable and that `cast` is the supported path. Either would have saved the
time; the second costs a paragraph.

---

## 3. EIP-1898 block-hash parameters are rejected

**Severity: medium.** This is the specific call behind finding 2.

```json
→ {"method":"eth_getBalance","params":["0x3ecC…","{\"blockHash\":\"0xb3c3…\"}"]}
← {"error":{"code":-32602,"message":"invalid parameters","data":null}}
```

A hex block number works; `{"blockHash": …}` does not. A block number sent as a JSON number rather
than a hex string is also rejected with `-32602`. Since `-32602` is used for both "I do not support
this parameter shape" and "your arguments are wrong", a caller cannot tell them apart, which is why
finding 2 took as long as it did to diagnose.

**Suggestion.** Support EIP-1898, or return `-32601`-style "unsupported parameter" with a message
naming the parameter.

---

## 4. `eth_getStorageAt` returns a bare `0x` instead of a 32-byte word

**Severity: medium.**

```json
→ {"method":"eth_getStorageAt","params":["0x3ecC694Cef705358864a646142ac17A90E29e388","0x0","latest"]}
← {"jsonrpc":"2.0","id":1,"result":"0x"}
```

That address has code — `eth_getCode` returns `0x60806040527f360894…` — so this is not an empty
account. The spec returns a 32-byte value. Clients that decode a fixed-width word get an error rather
than zero.

**Suggestion.** Return `0x` + 64 hex characters.

---

## 5. `DEFAULT_HANDLER_GAS_LIMIT` and the automatic-removal rule interact badly

**Severity: medium.** Documentation, not code.

The reactivity reference documents both of these, in different sections, and does not connect them:

- a subscription is removed when the owner's balance is "less than
  `(execution price per gas + priorityFeePerGas) * gasLimit`" at firing time;
- `SomniaExtensions.DEFAULT_HANDLER_GAS_LIMIT` is `10_000_000`.

Together, taking the default means the owner must keep **0.06 STT free at every single firing** (at
the documented 6 gwei minimum base fee) regardless of what the handler actually uses, or the
subscription is *removed* — not skipped. For a handler using a few hundred thousand gas that is a
large and invisible floor, and the failure is silent: sampling simply stops.

**Suggestion.** Say so where the default is defined: "the balance floor is `gasLimit × price`, so set
`gasLimit` from a measurement rather than taking this default." One sentence next to the constant.

---

## 6. A handler that runs out of gas is indistinguishable from one that never fired

**Severity: high, and the most expensive item here.**

We configured `gasLimit = 1_000_000`, measured against a local test fixture. Against a real pool the
same handler needs **2,730,154** gas, because a fixture returns a one-element array where a real
`getBookLevels` walks an order book.

Every callback then fired, consumed gas, ran out, and wrote nothing. What we could observe was: the
subscription present in `somnia_reactivityGetSubscriptions`, the sample count frozen at zero, and the
owner's balance falling. There is no event, no receipt we could find, and no RPC field distinguishing
"handler reverted", "handler ran out of gas", and "no match fired". We eventually found it with
`cast estimate` against the deployed handler and the live pool — run on a hunch, because the balance
was dropping while the count was not.

**Suggestion.** Either surface reactive-transaction outcomes (an event, or a `status` in
`somnia_reactivityGetSubscriptionInfo` such as a last-invocation result and a failure counter), or
document the diagnosis path explicitly: "if your handler is not producing effects, compare
`cast estimate` against your `gasLimit`". The "Why isn't your handler getting invoked?" section is
the natural home and does not currently cover the case where it *is* being invoked and failing.

---

## 7. `OrderBookLevel` is flagged unconfirmed; we confirmed it

**Severity: low.** A documentation fix that removes a doubt for everyone.

`IEventContracts.sol` says of `OrderBookLevel`: *"CONFIRM against the deployed pool's ABI before you
rely on it."* That is honest and we appreciated it — but it sits on the one struct every
book-reading project needs.

We confirmed it against a live pool. `getBookLevels(bool,uint64)` returns
`(uint256 price, uint256 quantity)[]`, best price first on both sides:

```
bids → [(485000, 200000000), (474000, 330000000), (463000, 460000000)]
asks → [(514000, 200000000), (525000, 330000000), (536000, 460000000)]
getBinaryPoolParams().oneCollateral → 1000000
```

The SDK's own `BookLevel` interface declares the same two fields in the same order.

**Suggestion.** Drop the caveat and state the layout as confirmed, or say which deployment it was
verified against and when.

---

## 8. The 1000-block `eth_getLogs` cap is documented only in a code comment

**Severity: low.**

Discovery must window backwards in 1000-block spans. We found this in a comment in the starter
template's `discover.mjs`, not in the network documentation. On a chain with 100 ms blocks, a naive
"scan the last hour" is 36,000 blocks and fails.

**Suggestion.** Put the cap in the JSON-RPC reference next to `eth_getLogs`.

---

## What worked well

Worth saying, because it shaped the build:

- **The on-chain reactivity reference is unusually good.** It documents the failure modes rather than
  only the happy path — including that a handler's own logs are matched against subscriptions, so a
  subscription can feed itself and drain its owner. We designed a guard against exactly that on the
  strength of one sentence, and the guard is tested.
- **`SomniaEventHandler` gets the access control right for you.** Requiring `msg.sender` to be the
  precompile before dispatching means projects cannot get the most security-critical part wrong.
- **`SOMNIA_TESTNET_ADDRESSES` from the SDK** made it straightforward to keep every venue address out
  of source and read at runtime.
- **The starter template's `discover.mjs` was decisive.** It deliberately does not depend on the
  indexer and says why. The 1000-block cap, the collateral filter, and the note that `MarketCreated`
  is the only publication of `marketId` are all things we would otherwise have learned slowly.
- **Blocks every 100 ms are genuinely different to build against**, and the reactivity model makes
  that speed usable rather than merely fast.

## The one thing we would change first

Finding 6. Everything else cost us hours; that one cost us a deployment and looked, throughout, like
the feature was not working at all.
