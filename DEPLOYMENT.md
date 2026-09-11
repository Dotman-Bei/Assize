# Deployment

Somnia Shannon testnet, chain id **50312**, RPC `https://dream-rpc.somnia.network`.
Testnet only. No mainnet, no real money, no token (PRD §25).

## Live contracts

Phase **P3**, deployed 2026-09-11. These carry settlement.

| Contract | Address |
|---|---|
| `AssizeRegistry` | `0x829465c447eD558b108001d472B5190424DCBfCc` |
| `CoverageSubscriber` | `0x6aFa0c42ed5462aDdEd9739B0D8b54b0a78Dddc2` |

| | |
|---|---|
| DreamDEX pool under measurement | `0x279Ff833DD608B3fFdBB7cA679A43D173Ee14c1A` |
| Market id | `0x0000000000000000000000000000000000000000000000000000000000018bb8` |
| Collateral (tUSDC, 6dp) | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |
| Reactivity subscription | `18103719` |
| Commitment | id `0`, window blocks `485293207` to `485302207` |
| Committed envelope | max spread `15000` raw price units, min size `10000000` |
| Bond | 1 STT, posted by the maker, **forfeited and paid out in full** |

### The completed run, and what it cost

| | |
|---|---|
| Samples | **6,028** |
| Breaches | **1,396** (frozen once the window closed — later samples are `WINDOW_CLOSED`) |
| Cost per sample | **0.002823 STT**, measured |
| Subscription closed | `0x85afa5701bd32547414f91be567d33cf3e510c0d71255ce0f256f37a721565ad` |
| Prefund recovered | `0x7067ee2eb78e05ae1fe23115bad5142f95bb68f4197bd3a190ff1b4f707ba6d1` |

Measured, not estimated (the rule D-043 earned): 33 STT funded, 15.981404136 swept back, 6,028
samples written. The P2 handler cost **0.001286**; this one costs more because each callback now
decodes `OrderPlaced` and `OrderFilled` as well as reading the book.

Closing the subscription emitted `SubscriptionCleared(18103719, acknowledged: true)`, and that is
D-044 exercised on chain with its own control. The same call against the superseded subscriber still
reverts `AlreadySubscribed` and can never be cleared; this one cleared, and now refuses only with
`InsufficientBalance` — it would subscribe again if funded.

### The payout

| | |
|---|---|
| Witnessed trader | `0xF3F0C3fB033e97F6f09BAe7F52329a8825167054` |
| Taker order | `368934881474191136278` |
| Witnessed volume | `5000000` (5 tUSDC) |
| Fill transaction | `0xc507f85b170a8646ae613e0675e055193117aee43ae7400d8c11d240ac60a11a` |
| Claim transaction | `0xec831878e0c0e94c8c7bdec3bb6411a6fe4739cc3402d52dd0d13186ae3a1d25` |
| Paid out | `1000000000000000000` wei — the whole bond, to the sole witness |

Being witnessed is not a claim anyone makes about themselves. `OrderPlaced` names who placed an
order and `OrderFilled` names what that order filled; the subscriber forwarded both halves and the
registry joined them on order id at claim time. `claim` checks every order named against
`orderOwner` before paying, so an order you did not place reverts rather than being skipped.

**The breach was not staged.** The live third-party book sat around 22000 wide against a committed
maximum of 15000 for the whole window. The commitment was wrong about the book it described. The
maker never withdrew anything.

### Superseded: the P1/P2 deployment

| Contract | Address |
|---|---|
| `AssizeRegistry` | `0xa43d71fff5ecedc577a0623421a16c2d11dc6b61` |
| `CoverageSubscriber` | `0x2c07cb635c20e89bdc8a10bd85c4f20f8b5a92f0` |

Still on chain and still verifiable. Its completed run — **29,541 samples across 1,899 distinct
blocks**, blocks 484439389 to 484519171 — is the evidence behind the coverage measurement, so the
addresses stay published rather than being deleted. Superseded because the registry's subscriber and
the subscriber's commitment are both immutable, so adding settlement meant deploying the pair again
(`DECISIONS.md` D-047). Its subscriber is also permanently wedged (D-044).

## Accounts

| Role | Address |
|---|---|
| Deployer / registry owner | `0xF3F0C3fB033e97F6f09BAe7F52329a8825167054` |
| Maker (`PROJECT_BASELINE`) | `0x62Ec9c9410c1b59647749D4d3005c75b9F380F38` |

Two accounts, not one. The registry's owner can register a keeper and a registered keeper can write
samples directly, so a single key holding both roles could fabricate the samples judging its own
commitment. See `DECISIONS.md` D-019.

## Verify it yourself

No account, no API key, and no access to our systems — a public RPC is enough.

```sh
RPC=https://dream-rpc.somnia.network

# The commitment the maker published, and the bond behind it.
cast call 0xa43d71fff5ecedc577a0623421a16c2d11dc6b61 \
  "commitmentAt(uint256)((address,bytes32,uint128,uint128,uint64,uint64,uint256,uint256))" 0 --rpc-url $RPC

# The stored sample that caused breach 0, with its block pin.
cast call 0xa43d71fff5ecedc577a0623421a16c2d11dc6b61 \
  "sampleAt(uint256)((uint256,(uint128,uint128,uint128,uint128,uint64,bytes32,uint8)))" 0 --rpc-url $RPC

# The verdict, re-derived from that stored sample by the contract itself.
# 4 is SPREAD_BREACH. 6 is COVERED_AT_SAMPLE, the strongest positive state there is.
cast call 0xa43d71fff5ecedc577a0623421a16c2d11dc6b61 "verdictOf(uint256)(uint8)" 0 --rpc-url $RPC

# The bond is recorded as forfeited, and which breach did it.
cast call 0xa43d71fff5ecedc577a0623421a16c2d11dc6b61 "forfeitureOf(uint256)(bool,uint256)" 0 --rpc-url $RPC

# A callback transaction. from and to are both the subscriber, and the nonce is
# the block-unique reactivity nonce: this was delivered by validators, not by us.
cast tx 0x98023141362bab2255dbf6f73342912b3929facfff7091129edcdd7e88de3adf --rpc-url $RPC
```

## Deployment steps

`forge script` does not work against this RPC: it simulates against a fork, and the node serves
neither `eth_getProof` nor EIP-1898 block-hash parameters (`DECISIONS.md` D-018). The contracts were
deployed with `cast send` instead.

1. Predict the subscriber's address: `cast compute-address <deployer> --nonce <n+1>`. The registry
   takes its subscriber as an immutable and the subscriber takes its registry, so one address must be
   known before it exists. Neither is settable afterwards, because a settable subscriber would be an
   admin path to redirect who may write samples (D-017).
2. Deploy `AssizeRegistry(predictedSubscriber)` from the deployer.
3. Publish the commitment from the **maker**, with the bond as `msg.value`. Give the window real
   headroom: Somnia produces blocks every 100ms, so a start only a few hundred blocks ahead can be in
   the past by the time the transaction lands.
4. Deploy `CoverageSubscriber(pool, registry, commitmentId)` from the deployer. Assert the predicted
   address matched.
5. Fund the subscriber by transfer. It must hold `SUBSCRIPTION_OWNER_MINIMUM_BALANCE` before
   `subscribe()` will succeed.
6. Call `subscribe(topics, options)`. **Size `gasLimit` from a measurement against the real pool**,
   not against a test fixture — see below.

## What this deployment cost, and what it taught

- **Handler gas: 2,730,154** against the live pool, measured with `cast estimate`. The same handler
  costs 254,574 against a test fixture, because a fixture returns a one-element array where a real
  `getBookLevels` walks an order book. A `gasLimit` of 1,000,000 — set from the fixture number — made
  every callback run out of gas, be charged for, and write nothing. Sampling looked dead while the
  prefund drained. G11 requires publishing the cost per sample. **Measured over the completed run:
  0.001286 STT.** That is 38 STT funded, 0.0033 left when the subscription was removed, 29,541 samples
  written. An earlier figure of 0.016 STT was published here; it was the theoretical worst case, the
  whole `gasLimit` at the documented minimum base fee, and it overstated the real cost by twelve
  times. The number that belongs in a published claim is the one divided out of an actual run.
- **The subscription's `gasLimit` is a funding floor.** The owner's balance is tested against the
  whole `gasLimit` at every firing, and falling below it removes the subscription rather than
  skipping an invocation (D-020).
