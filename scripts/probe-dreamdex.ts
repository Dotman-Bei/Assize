/**
 * `pnpm probe:dreamdex` — PRD §17, part of gate G1.
 *
 * Reads live DreamDEX market metadata rather than trusting a compiled-in value.
 * PRD §0.4 requires the official SDK over a hand-rolled contract call, and
 * PRD §0.3 forbids inventing an event signature, a struct layout, an ABI or a
 * field name — so every name used here was read from the SDK and the starter
 * template pinned in `skills-lock.json`, at the versions recorded there.
 *
 * PRD §17: no market id and no address is compiled in. The venue's addresses
 * come from the SDK's `SOMNIA_TESTNET_ADDRESSES` at runtime, and which market to
 * cover is `DREAMDEX_MARKET_ID` in the environment.
 */

import { pathToFileURL } from "node:url";

import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, type AbiEvent } from "viem";

import { probeBook } from "./probe/book.js";
import { GET_LOGS_MAX_SPAN, loadMarketCreatorEventsAbi, type MarketCreatedArgs } from "./probe/dreamdex-sdk.js";
import { passed, printResults, readChainId, requireEnv, type ProbeResult } from "./probe/shared.js";

/** How far back to scan for live markets, in 1000-block windows. */
const SCAN_WINDOWS = 40;

export async function probeDreamdex(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  const rpcUrl = requireEnv("SOMNIA_RPC_URL");
  const marketId = requireEnv("DREAMDEX_MARKET_ID");
  const sdkPackage = requireEnv("DREAMDEX_SDK_PACKAGE");
  const expectedChainId = requireEnv("SOMNIA_CHAIN_ID");

  if (rpcUrl === undefined) {
    results.push({
      check: "configuration",
      status: "BLOCKED",
      detail: "SOMNIA_RPC_URL is not set. See .env.example; PRD §17 keeps it out of source.",
    });
    return results;
  }
  results.push({
    check: "configuration",
    status: "OK",
    detail: `RPC endpoint supplied by environment${marketId === undefined ? ", DREAMDEX_MARKET_ID unset" : ""}`,
  });

  const chain = await readChainId(rpcUrl);
  if ("error" in chain) {
    results.push({ check: "rpc reachable", status: "BLOCKED", detail: chain.error });
    return results;
  }
  if (expectedChainId !== undefined && BigInt(expectedChainId) !== chain.chainId) {
    results.push({
      check: "chain id",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail:
        `RPC reports chain ${chain.chainId}, configuration expects ${expectedChainId}. `
        + "PRD §17: stop and say so rather than guessing.",
    });
    return results;
  }
  results.push({
    check: "chain id",
    status: "OK",
    detail: `RPC reports chain ${chain.chainId}`,
  });

  // PRD §17: addresses arrive from the SDK at runtime, never as a literal here.
  const venue = SOMNIA_TESTNET_ADDRESSES;
  results.push({
    check: "venue addresses",
    status: "OK",
    detail:
      `read from the pinned SDK at runtime: marketCreator, binaryModule, collateral `
      + `and ${Object.keys(venue).length - 3} more`,
  });

  let marketCreatedEvent: AbiEvent;
  try {
    const abi = await loadMarketCreatorEventsAbi();
    const found = (abi as AbiEvent[]).find((entry) => entry.name === "MarketCreated");
    if (found === undefined) {
      throw new Error("MarketCreated is absent from the pinned marketCreatorEventsAbi");
    }
    marketCreatedEvent = found;
  } catch (error) {
    results.push({
      check: "market discovery",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail: `${(error as Error).message}. Upstream moved; re-inspect and record it (AGENTS.md).`,
    });
    return results;
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  let head: bigint;
  try {
    head = await client.getBlockNumber();
  } catch (error) {
    results.push({ check: "market discovery", status: "BLOCKED", detail: (error as Error).message });
    return results;
  }

  // Somnia caps eth_getLogs at 1000 blocks per call, so the scan walks backwards
  // in windows. A window that fails is counted rather than swallowed: a scan
  // that silently lost half its range would under-report live markets, and
  // "no markets found" and "we could not look" are different answers.
  const markets: MarketCreatedArgs[] = [];
  let failedWindows = 0;
  for (let index = 0; index < SCAN_WINDOWS; index += 1) {
    const toBlock = head - BigInt(index) * GET_LOGS_MAX_SPAN;
    if (toBlock <= 0n) {
      break;
    }
    const fromBlock = toBlock > GET_LOGS_MAX_SPAN ? toBlock - (GET_LOGS_MAX_SPAN - 1n) : 0n;
    try {
      const logs = await client.getLogs({ event: marketCreatedEvent, fromBlock, toBlock });
      for (const log of logs) {
        markets.push(log.args as unknown as MarketCreatedArgs);
      }
    } catch (error) {
      failedWindows += 1;
      if (failedWindows > SCAN_WINDOWS / 4) {
        results.push({
          check: "market discovery",
          status: "BLOCKED",
          detail:
            `${failedWindows} of ${index + 1} log windows failed, most recently `
            + `${(error as Error).message}. The scan cannot be trusted to have seen the range.`,
        });
        return results;
      }
    }
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const live = markets.filter((market) => market.expiry > nowSeconds);
  results.push({
    check: "market discovery",
    status: "OK",
    detail:
      `${markets.length} MarketCreated log(s) across ${SCAN_WINDOWS * Number(GET_LOGS_MAX_SPAN)} `
      + `blocks to head ${head}, ${live.length} still live`
      + (failedWindows > 0 ? `, ${failedWindows} window(s) failed and were retried past` : ""),
  });

  if (marketId === undefined) {
    // Listed rather than merely counted: PRD §17 makes which market to cover
    // configuration, and configuration nobody can discover is not usable.
    const soonestFirst = [...live].sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
    const listing = soonestFirst
      .slice(0, 8)
      .map((market) => {
        const minutes = Number(market.expiry - nowSeconds) / 60;
        return `\n        ${market.marketId}  ${market.asset} `
          + `window=${Number(market.intervalSec) / 60}min expires in ${minutes.toFixed(0)}min `
          + `pool=${market.pool}`;
      })
      .join("");
    results.push({
      check: "configured market",
      status: "BLOCKED",
      detail:
        "DREAMDEX_MARKET_ID is unset, so there is no market to confirm. Live markets now:"
        + (listing === "" ? " none" : listing),
    });
    return results;
  }

  const target = markets.find(
    (market) => market.marketId.toLowerCase() === marketId.toLowerCase(),
  );
  if (target === undefined) {
    results.push({
      check: "configured market",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail:
        `DREAMDEX_MARKET_ID ${marketId} was not found in the scanned range. Either it is older `
        + "than the scan, or it does not exist on this chain. PRD §17: stop, do not guess.",
    });
    return results;
  }

  const stillLive = target.expiry > nowSeconds;
  results.push({
    check: "configured market",
    status: stillLive ? "OK" : "PROTOCOL_CONFIG_CHANGED",
    detail:
      `${target.asset} pool=${target.pool} expiry=${target.expiry} `
      + `interval=${target.intervalSec}s ${stillLive ? "live" : "EXPIRED"}`,
  });
  if (!stillLive) {
    return results;
  }

  // The book read is what Assize actually samples, so its shape is confirmed
  // against the live pool rather than taken from the documents that describe it.
  results.push(...(await probeBook(rpcUrl, target.pool)));
  return results;
}

async function main(): Promise<void> {
  const results = await probeDreamdex();
  printResults("probe:dreamdex (PRD §17, gate G1)", results);
  process.exit(passed(results) ? 0 : 1);
}

/** Run only when invoked directly, so `probe:all` can import the function. */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
