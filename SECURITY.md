# Security

Testnet only. No mainnet, no real money, no token. Bonds are testnet STT.

## What is at stake

Maker bonds held by `AssizeRegistry`, handler gas prefund held by `CoverageSubscriber`, and the
integrity of the samples a verdict is computed from.

## Structural properties

- **No upgradeability, no pause, no admin withdrawal.** `AssizeRegistry` has exactly one owner-gated
  function, `registerKeeper`. There is no path by which the owner can move a bond.
- **Samples come from one address.** `recordSample` accepts the subscriber — set as an immutable at
  construction, so it cannot be redirected later — or a registered keeper in fallback mode.
- **The callback caller is checked by upstream.** `SomniaEventHandler.onEvent` requires `msg.sender`
  to be the reactivity precompile before the handler runs.
- **A verdict reads stored data only.** It is computed from a stored sample and a stored commitment,
  never from anything a maker supplies at the time.
- **Two keys, not one.** The registry owner can register a keeper, and a keeper can write samples. A
  single key holding both the owner and maker roles could fabricate the samples judging its own
  commitment. Deployer and maker are separate accounts. See `DECISIONS.md` D-019.

## Known limitations

- **A keeper, if ever registered, is trusted while it is used.** Its only defence is that every
  sample pins a block, so anyone can re-read the chain at that block and check what was written.
  That is a real defence against writing false values and a weak one against choosing moments.
- **The block pin is a parent hash**, because a contract cannot observe its own block's hash. Verify
  as `getBlock(n).parentHash == sample.blockHash`. See D-016.
- **The handler reads the top of book only.**
- **Bonds are currently unreleasable.** There is no settlement function: the payout path was cut
  under K10. A forfeited bond stays in the registry, and so does an honest maker's bond after a clean
  window. Do not deploy this expecting to recover a bond.

## Reporting

This is a hackathon project on a public testnet. Open an issue.
