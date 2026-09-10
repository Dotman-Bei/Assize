# Setup

Node 20 or newer, pnpm 9, and Foundry. Testnet only.

## Verify the live deployment — no setup beyond a clone

This needs no key, no funds and no account.

```sh
pnpm install
SOMNIA_RPC_URL=https://dream-rpc.somnia.network \
ASSIZE_REGISTRY_ADDRESS=<see DEPLOYMENT.md> \
  pnpm claim:verify
```

It reads every stored sample and commitment from the public RPC and re-derives each verdict locally
with `packages/reference`, then compares against the chain.

## Look at it

```sh
pnpm --filter @assize/web build:single    # one self-contained file
open apps/web/dist/assize.html            # or just double-click it
```

`assize.html` inlines its stylesheet, its bundle and the deployment record, so it needs no server at
all. It still reads the chain: Somnia's RPC sends `access-control-allow-origin: *` on both the call
and the preflight, so a page with a `file://` origin can query it.

`pnpm --filter @assize/web dev` serves the same thing on `localhost:5173` with a rebuild watcher —
useful when editing, useless for sharing.

## Run the checks

```sh
pnpm typecheck
pnpm test                        # the TypeScript evaluator and schemas
forge test                       # contracts: 53 tests
pnpm test:differential           # G2: both evaluators, 10,000 generated pairs
pnpm check:vocabulary            # G8: no forbidden word in code, copy or claims
pnpm check:no-address-literals   # G1: no protocol fact compiled into source
pnpm skills:verify               # pinned upstream still matches skills-lock.json
```

`forge test` skips two suites without network configuration, by design: a gate must pass on a fresh
clone, and a test that needs the internet cannot be one.

## Probe the live protocol

```sh
cp .env.example .env.local        # then fill it in
SOMNIA_RPC_URL=https://dream-rpc.somnia.network SOMNIA_CHAIN_ID=50312 pnpm probe:dreamdex
```

With no `DREAMDEX_MARKET_ID` set it lists the live markets and their pools. With one set it confirms
that market and checks the book layout against the live pool.

## Deploy your own

See `DEPLOYMENT.md`. You need two funded accounts — the separation is deliberate, see `DECISIONS.md`
D-019 — and roughly 36 STT, most of which is a subscription barrier that is not consumed. Faucet: the
Somnia Telegram community, faucet topic.

`pnpm preflight` tells you whether the accounts are funded well enough before you start.

**Never commit `.env.local`.** It is gitignored, and no key appears in any tracked file.
