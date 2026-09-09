/**
 * `pnpm probe:reactivity` — PRD §17, gates G1 and G11.
 *
 * Confirms the Somnia reactivity precompile is present at the configured address
 * and, once a subscription exists, that its handler gas is funded. PRD §8.2:
 * "an unfunded subscription is a silent NOT_SAMPLED, which is the worst failure
 * this product can have", which is why funding is probed rather than assumed.
 */

import { pathToFileURL } from "node:url";

import { passed, printResults, readChainId, readCode, requireEnv, type ProbeResult } from "./probe/shared.js";

export async function probeReactivity(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  const rpcUrl = requireEnv("SOMNIA_RPC_URL");
  const precompile = requireEnv("SOMNIA_REACTIVITY_PRECOMPILE");
  const subscriberAddress = requireEnv("ASSIZE_SUBSCRIBER_ADDRESS");

  if (rpcUrl === undefined) {
    results.push({
      check: "configuration",
      status: "BLOCKED",
      detail: "SOMNIA_RPC_URL is not set. See .env.example; PRD §17 keeps it out of source.",
    });
    return results;
  }

  const chain = await readChainId(rpcUrl);
  if ("error" in chain) {
    results.push({ check: "rpc reachable", status: "BLOCKED", detail: chain.error });
    return results;
  }
  results.push({ check: "rpc reachable", status: "OK", detail: `chain ${chain.chainId}` });

  if (precompile === undefined) {
    results.push({
      check: "reactivity precompile",
      status: "BLOCKED",
      detail:
        "SOMNIA_REACTIVITY_PRECOMPILE is not set. PRD §17: the precompile address is read at "
        + "deploy time and asserted at runtime, never compiled in.",
    });
    return results;
  }

  // Presence is checked with eth_getCode, which needs no ABI and so invents
  // nothing. It answers the one question P1 can answer honestly: is anything
  // deployed at the address configuration claims the precompile lives at.
  const code = await readCode(rpcUrl, precompile);
  if ("error" in code) {
    results.push({ check: "reactivity precompile", status: "BLOCKED", detail: code.error });
    return results;
  }
  if (code.code === "0x" || code.code === "") {
    results.push({
      check: "reactivity precompile",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail:
        `no code at ${precompile}. Either the address moved or the chain is wrong. `
        + "PRD §26 K1 governs if the precompile is genuinely unavailable.",
    });
    return results;
  }
  results.push({
    check: "reactivity precompile",
    status: "OK",
    detail: `code present at ${precompile} (${(code.code.length - 2) / 2} bytes of bytecode)`,
  });

  if (subscriberAddress === undefined) {
    // Phase P1 deploys nothing (docs/phase.md), so there is no subscription to
    // probe. That is the expected state, not a failure.
    results.push({
      check: "subscription liveness and handler funding",
      status: "NOT_APPLICABLE",
      detail:
        "ASSIZE_SUBSCRIBER_ADDRESS is unset: nothing is deployed. Phase P1 deploys nothing; "
        + "this check becomes live in P2 and is gate G11.",
    });
    return results;
  }

  const subscriberCode = await readCode(rpcUrl, subscriberAddress);
  if ("error" in subscriberCode) {
    results.push({
      check: "subscription liveness and handler funding",
      status: "BLOCKED",
      detail: subscriberCode.error,
    });
    return results;
  }
  if (subscriberCode.code === "0x" || subscriberCode.code === "") {
    results.push({
      check: "subscription liveness and handler funding",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail: `ASSIZE_SUBSCRIBER_ADDRESS ${subscriberAddress} has no code on chain ${chain.chainId}`,
    });
    return results;
  }

  // Reading the subscription's funding needs the precompile's own interface,
  // which PRD §0.3 forbids inventing. It is written against the pinned Somnia
  // reactivity reference, in the same change that pins it (Phase P2, gate G11).
  results.push({
    check: "subscription liveness and handler funding",
    status: "BLOCKED",
    detail:
      "subscriber is deployed, but its subscription state is read through the reactivity "
      + "precompile interface, which is written against the pinned reference rather than from "
      + "memory (PRD §0.2, §0.3). Gate G11.",
  });
  return results;
}

async function main(): Promise<void> {
  const results = await probeReactivity();
  printResults("probe:reactivity (PRD §17, gates G1 and G11)", results);
  process.exit(passed(results) ? 0 : 1);
}

/** Run only when invoked directly, so `probe:all` can import the function. */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
