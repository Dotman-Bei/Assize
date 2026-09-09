/**
 * Access to the pinned DreamDEX SDK, and to the one ABI it does not re-export.
 *
 * PRD §0.2: the SDK is pinned in `skills-lock.json` by source, version and
 * integrity hash. PRD §0.4: prefer an official SDK method over a hand-rolled
 * contract call. PRD §0.3: nothing here is written from memory — every name
 * below was read from the pinned package at version 0.29.0.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `marketCreatorEventsAbi` carries `MarketCreated`, which is the only place a
 * market's `marketId` is published — `getBinaryPoolParams()` does not return it
 * (pinned `IEventContracts.sol`). The SDK does not list `./dist/eventsAbi.js`
 * in its `exports` map, so a subpath import fails with ERR_PACKAGE_PATH_NOT_EXPORTED
 * and the package root has to be resolved first. The pinned starter template
 * does the same thing by relative path; resolving it is the same manoeuvre made
 * to work from inside a workspace.
 *
 * Recorded as friction for the SDK feedback report (PRD §20).
 */
export async function loadMarketCreatorEventsAbi(): Promise<readonly unknown[]> {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@somnia-chain/markets-sdk");
  const module_ = (await import(
    pathToFileURL(join(dirname(entry), "eventsAbi.js")).href
  )) as { marketCreatorEventsAbi?: readonly unknown[] };
  const abi = module_.marketCreatorEventsAbi;
  if (abi === undefined) {
    throw new Error(
      "the pinned SDK no longer exports marketCreatorEventsAbi from dist/eventsAbi.js. "
        + "Upstream moved: re-inspect and record it in DECISIONS.md (AGENTS.md).",
    );
  }
  return abi;
}

/** The shape of a `MarketCreated` log's arguments, as read from the pinned ABI. */
export interface MarketCreatedArgs {
  readonly marketId: `0x${string}`;
  readonly market: `0x${string}`;
  readonly pool: `0x${string}`;
  readonly collateral: `0x${string}`;
  readonly asset: string;
  readonly question: string;
  readonly expiry: bigint;
  readonly tradingStart: bigint;
  readonly intervalSec: bigint;
}

/**
 * Somnia caps `eth_getLogs` at 1000 blocks per call, so a scan walks backwards
 * in windows. Taken from the pinned starter template's `discover.mjs`, which
 * says so in a comment and does exactly this.
 */
export const GET_LOGS_MAX_SPAN = 1000n;
