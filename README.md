# Assize

**A market maker publishes a quoting commitment, backs it with a bond, and the chain samples
whether the commitment held.**

Somnia Shannon testnet. Chain 50312. Testnet only — no mainnet, no real money, no token.

---

## Problem

A DreamDEX event contract market shows a price. That price comes from an order book, and an order
book can be empty. On a thin book the displayed number is the residue of whoever quoted last, not a
price anyone will trade with you at.

The trader cannot tell the difference in advance. They arrive, size up, and discover the book is not
there. Nothing records that this happened. The market's page looks identical the next day.

Market makers are not the villains. They quote when it suits them and stop when it does not, which
is rational, because nothing they said was binding. There is no instrument on a prediction venue
that lets a maker say *"I will be here, at this spread, at this size, for this window"* in a way that
costs them something when they are not.

## Solution

Make the promise binding, and make a measurement trigger the penalty rather than a complaint.

Somnia's reactivity precompile lets a contract subscribe to another contract's events and be invoked
by validators when they fire. Assize points that at a different question: not *"should this order
fire"* but *"was the promise kept at this instant"*.

## Product

```
maker posts a bond and a commitment (max spread, min size, window) for one market
        |
        v
reactivity wakes the registry when that market emits
        |
        v
registry samples the book at that instant and writes the sample on chain
        |
        v
verdict = f(commitment, sample)                          [pure, total, enumerated]
        |
        v
breach records the sample that caused it, and the bond is forfeited
```

Seven verdict states, and no others:

`COVERED_AT_SAMPLE` · `SPREAD_BREACH` · `DEPTH_BREACH` · `ABSENT` · `NOT_SAMPLED` ·
`WINDOW_CLOSED` · `SAMPLER_FAILED`

`COVERED_AT_SAMPLE` is the strongest positive state that exists. There is deliberately no state
above it, because there is nothing stronger that the evidence could carry.

## Demonstration

Live on Shannon. Every number below was read back from the chain, not from our database.

| | |
|---|---|
| `AssizeRegistry` | `0xa43d71fff5ecedc577a0623421a16c2d11dc6b61` |
| `CoverageSubscriber` | `0x2c07cb635c20e89bdc8a10bd85c4f20f8b5a92f0` |
| DreamDEX market | `0x0000000000000000000000000000000000000000000000000000000000018bb8` |
| Callback transaction | `0x98023141362bab2255dbf6f73342912b3929facfff7091129edcdd7e88de3adf` |

A maker committed to a maximum spread of **15000** raw price units on that market and posted a
**1 STT** bond. The sampled book showed bid **686000** against ask **714000** — a spread of
**28000**. The stored sample re-derives to **`SPREAD_BREACH`**, and the bond is recorded as
**forfeited**.

```
samples observed:        5144        SPREAD_BREACH      5144
distinct blocks sampled:  351        every other state     0
                                     source: REACTIVITY 5144
```

Read those two counts together. See *How this could mislead you*.

## Future vision

Commitments as a listing requirement for new markets, so a venue can advertise coverage because it
is measured rather than asserted. The instrument is small; what it changes is whether a venue's
liquidity claim survives contact with evidence.

---

## Why this needs to exist, and why the obvious fix fails

The obvious fix is an analytics dashboard: chart the volume, chart the spread, publish it.

Volume is what happened when liquidity was present. It is silent about every trader who looked,
found nothing, and left. A spread chart has the same problem in a subtler form — it is drawn from
the moments the venue chose to record, and nothing binds anyone to it.

Assize is not an improvement on that measurement. It is a different object: a promise with a penalty,
where the penalty is triggered by something a stranger can check.

## Verify it yourself

No account. No API key. No access to anything of ours. A public RPC is enough.

```sh
RPC=https://dream-rpc.somnia.network
REG=0xa43d71fff5ecedc577a0623421a16c2d11dc6b61

# The commitment, and the bond behind it.
cast call $REG "commitmentAt(uint256)((address,bytes32,uint128,uint128,uint64,uint64,uint256,uint256))" 0 --rpc-url $RPC

# The stored sample that caused breach 0, with its block pin.
cast call $REG "sampleAt(uint256)((uint256,(uint128,uint128,uint128,uint128,uint64,bytes32,uint8)))" 0 --rpc-url $RPC

# The verdict, re-derived from that stored sample. 4 is SPREAD_BREACH.
cast call $REG "verdictOf(uint256)(uint8)" 0 --rpc-url $RPC

# The bond is forfeited, and this is the breach that did it.
cast call $REG "forfeitureOf(uint256)(bool,uint256)" 0 --rpc-url $RPC

# The callback. from and to are both the subscriber, and the nonce is the
# block-unique reactivity nonce: validators delivered this, we did not.
cast tx 0x98023141362bab2255dbf6f73342912b3929facfff7091129edcdd7e88de3adf --rpc-url $RPC
```

**Do not take the registry's word for it.** From a clean clone, this re-derives every verdict with
`packages/reference` — a second implementation of the evaluator, in TypeScript, running on your
machine — and compares it against what the chain says:

```sh
git clone <this repo> && cd assize
pnpm install
SOMNIA_RPC_URL=https://dream-rpc.somnia.network ASSIZE_REGISTRY_ADDRESS=0xa43d71fff5ecedc577a0623421a16c2d11dc6b61 pnpm claim:verify
```

It reads the stored samples and commitments from the RPC and computes the verdicts itself. Asking
`verdictOf` alone would only prove the contract agrees with itself.

```sh
pnpm test:differential   # the same evaluator, both languages, 10,000 generated pairs
pnpm evidence:report     # the table above, regenerated from chain
```

## How this could mislead you

Read this section before quoting any number above.

**5144 samples is not 5144 observations.** The subscription matches every log the pool emits, so a
block with many pool events produces many samples that read the same book at the same instant. None
is fabricated — each is a real callback that really read the book — but they are redundant. The
honest measure of how often the book was observed is **351 distinct blocks**. Both numbers are
printed; neither is dropped.

**Assize measures at instants, not continuously.** A sample is one reading at one block. It is not a
window, not an average, and not proof that the book held between two samples. No claim here says
otherwise.

**Every sample in this run is a breach.** The book never came back inside the committed envelope
while the window ran, so `COVERED_AT_SAMPLE` does not appear on chain yet. That the evaluator can
distinguish the states is shown by `pnpm test:differential`, which agrees across 10,000 generated
pairs and reaches all seven — not by this run, which reached one.

**Nobody was paid.** Assize records that a bond is forfeited. It does not distribute it. The payout
and claim path were cut under the project's own kill criteria (K10) when the submission window got
short, and the contract has no settlement function at all. A forfeited bond currently stays in the
registry. Anything implying a trader was made whole would be false.

**The maker is us.** It is labelled `PROJECT_BASELINE` everywhere. It is not a third party, not
adoption, and not demand. It published a commitment it did not keep, which is what it exists to do.

**The block pin is a parent hash.** A contract cannot observe the hash of the block it is executing
in, so a sample stores block *N* alongside the hash of *N-1*. Verify it as
`getBlock(n).parentHash == sample.blockHash`. It pins the sample to one block on one chain just as
tightly, but it is not what the field name suggests.

## Limitations

- Sampling happens at instants, not continuously.
- No payout exists in this deployment. Measurement and penalty recording only.
- One market. One maker, and that maker is ours.
- The handler reads the top of the book only — best bid and best ask.
- Somnia's public RPC serves neither `eth_getProof` nor EIP-1898 block-hash parameters, so
  `forge script` and `forge test --fork-url` do not work against it. Deployment used `cast send`.

## Repository layout

```
contracts/src/       AssizeRegistry, CoverageSubscriber, VerdictLib, the pool interface
packages/
  protocol-types/    the seven states, the sample struct, zod schemas, the forbidden vocabulary
  reference/         the evaluator again, in TypeScript — G2 proves the two agree
  claim-ledger/      claims.json and the verifier that re-reads it from chain
scripts/             probes, the differential harness, hygiene checks, evidence reporting
docs/phase.md        which phase this is in, and what is not done
DECISIONS.md         every decision, what forced it, and what it costs. Append-only.
BUILD_LOG.md         what was run, what it printed, and what broke
evidence/            run output, read back from chain
```

## Status

| Gate | | |
|---|---|---|
| G1 | no compiled-in protocol facts | **pass** |
| G2 | the two evaluators agree, 10,000 pairs | **pass** |
| G3 | a live sample delivered by the reactivity path | **pass** |
| G4 | a real breach recorded against a live market | **pass** |
| G5 | a payout executed | **cut under K10** |
| G6 | a sustained 24h campaign | not attempted |
| G11 | handler funding proven on chain | partly — cost per sample measured, no UI state |

The rest are documented in `docs/phase.md`, including the ones that are not done.

## Licence

MIT. See `LICENSE`.
