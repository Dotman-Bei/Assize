/**
 * `pnpm probe:dreamdex` — PRD §17, part of gate G1.
 *
 * Reads live DreamDEX market metadata rather than trusting a compiled-in value.
 * PRD §0.4 requires the official SDK over a hand-rolled contract call, and
 * PRD §0.3 forbids inventing an event signature, a struct layout, an ABI or a
 * field name. So this probe resolves the SDK from configuration and reports what
 * it finds; where the SDK is not available it reports BLOCKED and stops, because
 * the alternative is guessing at an interface, which is the failure this whole
 * rule exists to prevent.
 */

import { pathToFileURL } from "node:url";

import { passed, printResults, readChainId, requireEnv, type ProbeResult } from "./probe/shared.js";

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

  if (sdkPackage === undefined) {
    results.push({
      check: "dreamdex sdk",
      status: "BLOCKED",
      detail:
        "DREAMDEX_SDK_PACKAGE is not set, so there is no SDK to read market metadata with. "
        + "PRD §0.2 requires the SDK be pinned in skills-lock.json by source, path and SHA-256 "
        + "before it is used.",
    });
    return results;
  }

  // Resolved by name from configuration rather than imported by a literal, so
  // that no package name is compiled in either.
  let sdk: Record<string, unknown>;
  try {
    sdk = (await import(sdkPackage)) as Record<string, unknown>;
  } catch (error) {
    results.push({
      check: "dreamdex sdk",
      status: "BLOCKED",
      detail: `cannot resolve "${sdkPackage}": ${(error as Error).message}`,
    });
    return results;
  }

  const exported = Object.keys(sdk).sort();
  results.push({
    check: "dreamdex sdk",
    status: "OK",
    detail: `resolved "${sdkPackage}", ${exported.length} export(s): ${exported.slice(0, 12).join(", ")}`,
  });

  // The market-metadata read is deliberately not written yet. Writing it means
  // choosing a method name, an argument shape and a return field, and PRD §0.3
  // forbids choosing any of those from memory. It is written against the pinned
  // SDK, in the same change that pins it.
  results.push({
    check: "market metadata",
    status: "BLOCKED",
    detail:
      `market ${marketId ?? "(DREAMDEX_MARKET_ID unset)"} not read: the call is written against `
      + "the pinned SDK, not from memory (PRD §0.2, §0.3).",
  });
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
