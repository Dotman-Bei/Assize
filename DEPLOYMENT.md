# Deployment

Somnia Shannon testnet, chain id **50312**, RPC `https://dream-rpc.somnia.network`.
Testnet only. No mainnet, no real money, no token (PRD §25).

## Live contracts

| Contract | Address |
|---|---|
| `AssizeRegistry` | `0xa43d71fff5ecedc577a0623421a16c2d11dc6b61` |
| `CoverageSubscriber` | `0x2c07cb635c20e89bdc8a10bd85c4f20f8b5a92f0` |

| | |
|---|---|
| DreamDEX pool under measurement | `0x279Ff833DD608B3fFdBB7cA679A43D173Ee14c1A` |
| Market id | `0x0000000000000000000000000000000000000000000000000000000000018bb8` |
| Reactivity subscription | `17611580` |
| Commitment | id `0`, window blocks `484437694` to `484837694` |
| Committed envelope | max spread `15000` raw price units, min size `100000000` |
| Bond | 1 STT, posted by the maker, **forfeited** |

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
  prefund drained. G11 requires publishing the cost per sample: at 6 gwei it is roughly 0.016 STT.
- **The subscription's `gasLimit` is a funding floor.** The owner's balance is tested against the
  whole `gasLimit` at every firing, and falling below it removes the subscription rather than
  skipping an invocation (D-020).
