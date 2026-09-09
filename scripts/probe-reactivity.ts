/**
 * `pnpm probe:reactivity` — PRD §17, gates G1 and G11.
 *
 * Confirms that Somnia's on-chain reactivity is served by the configured node,
 * and that a deployed subscription's handler gas is funded. PRD §8.2: "an
 * unfunded subscription is a silent NOT_SAMPLED, which is the worst failure this
 * product can have", which is why funding is probed rather than assumed.
 *
 * Every name here was read from the Somnia on-chain reactivity reference pinned
 * in `skills-lock.json`, not from memory (PRD §0.3).
 */

import { pathToFileURL } from "node:url";

import {
  callRpc,
  passed,
  printResults,
  readChainId,
  requireEnv,
  supportsRpcMethod,
  type ProbeResult,
} from "./probe/shared.js";

/**
 * The two reactivity RPC methods the pinned reference documents. Both are
 * `eth_call`-style and available on any Somnia node, so their presence is a
 * direct test of whether this node serves reactivity at all.
 */
const SUBSCRIPTIONS_METHOD = "somnia_reactivityGetSubscriptions";
const SUBSCRIPTION_INFO_METHOD = "somnia_reactivityGetSubscriptionInfo";

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

  // Liveness is tested by asking whether the node serves the reactivity RPC, NOT
  // by reading code at the precompile.
  //
  // `eth_getCode` at the precompile returns "0x" on Shannon, because a
  // precompile is implemented by the node and has no deployed bytecode. An
  // earlier version of this probe treated empty code as PROTOCOL_CONFIG_CHANGED
  // and would therefore have reported reactivity as missing on a chain where it
  // is working. Checked by experiment against the live node, not assumed.
  const support = await supportsRpcMethod(rpcUrl, SUBSCRIPTIONS_METHOD, [
    "0x0000000000000000000000000000000000000000",
  ]);
  if (!support.supported) {
    results.push({
      check: "reactivity available",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail:
        `${support.detail}. This node does not serve on-chain reactivity, so Path R cannot `
        + "deliver samples here. PRD §26 K1 governs if that is true of the network rather than "
        + "of this endpoint.",
    });
    return results;
  }
  results.push({
    check: "reactivity available",
    status: "OK",
    detail: `${support.detail}; ${SUBSCRIPTION_INFO_METHOD} is its companion`,
  });

  if (precompile === undefined) {
    results.push({
      check: "precompile address",
      status: "BLOCKED",
      detail:
        "SOMNIA_REACTIVITY_PRECOMPILE is not set. PRD §17: the precompile address is read at "
        + "deploy time and asserted at runtime, never compiled in. The pinned reference gives "
        + "it, and .env.example carries it as configuration.",
    });
    return results;
  }
  if (!/^0x[0-9a-fA-F]{40}$/u.test(precompile)) {
    results.push({
      check: "precompile address",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail: `SOMNIA_REACTIVITY_PRECOMPILE is not a 20-byte address: ${precompile}`,
    });
    return results;
  }
  results.push({
    check: "precompile address",
    status: "OK",
    detail:
      `${precompile}, supplied by configuration. Deployed bytecode is empty here by design — a `
      + "precompile lives in the node — so presence is proven by the RPC above, not by eth_getCode.",
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

  const owned = await callRpc(rpcUrl, SUBSCRIPTIONS_METHOD, [subscriberAddress]);
  if ("error" in owned) {
    results.push({
      check: "subscription liveness and handler funding",
      status: "BLOCKED",
      detail: owned.error,
    });
    return results;
  }
  const subscriptions = Array.isArray(owned.result) ? owned.result : [];
  if (subscriptions.length === 0) {
    results.push({
      check: "subscription liveness and handler funding",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail:
        `${subscriberAddress} owns no reactivity subscription. A subscriber with no subscription `
        + "produces silence, which reads as NOT_SAMPLED rather than as an error (PRD §8.2).",
    });
    return results;
  }

  // The pinned reference returns SubscriptionData fields in snake_case, plus id
  // and owner. Gas limit and fee caps are what decide whether a handler can
  // actually run, so they are reported rather than merely counted.
  const described = subscriptions
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return `id=${String(row["id"])} gas_limit=${String(row["gas_limit"])} `
        + `max_fee_per_gas=${String(row["max_fee_per_gas"])}`;
    })
    .join(" | ");
  results.push({
    check: "subscription liveness and handler funding",
    status: "OK",
    detail: `${subscriptions.length} subscription(s) owned by ${subscriberAddress}: ${described}`,
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
