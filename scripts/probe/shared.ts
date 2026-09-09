/**
 * Shared plumbing for the startup probes (PRD §17, §22 G1, §26).
 *
 * PRD §17: "No market id, contract address, event signature, precompile address,
 * tick size, or token address is compiled in. ... On mismatch the app enters
 * `PROTOCOL_CONFIG_CHANGED`, stops writing samples, and says so on screen rather
 * than guessing."
 *
 * Every value a probe needs therefore arrives from the environment. A probe that
 * cannot get one reports that plainly and exits non-zero. It never substitutes a
 * default, because a default here is an invented protocol fact.
 */

/** PRD §17 and §26. A probe reports one of these and nothing else. */
export type ProbeStatus =
  /** The fact was read from a live source and matches configuration. */
  | "OK"
  /** A live source disagrees with configuration. PRD §17: stop, do not guess. */
  | "PROTOCOL_CONFIG_CHANGED"
  /** A prerequisite is missing, so the fact could not be read at all. */
  | "BLOCKED"
  /** The check does not apply in the current phase. */
  | "NOT_APPLICABLE";

export interface ProbeResult {
  readonly check: string;
  readonly status: ProbeStatus;
  readonly detail: string;
}

/** A probe run passes only when every check is OK or explicitly not applicable. */
export function passed(results: readonly ProbeResult[]): boolean {
  return results.every((result) => result.status === "OK" || result.status === "NOT_APPLICABLE");
}

export function requireEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

export function printResults(title: string, results: readonly ProbeResult[]): void {
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
  for (const result of results) {
    process.stdout.write(`  [${result.status.padEnd(23)}] ${result.check}\n`);
    process.stdout.write(`      ${result.detail}\n`);
  }
}

/**
 * Reads the chain id from an RPC over plain JSON-RPC.
 *
 * Deliberately not an SDK call: this is the one read that has to work before we
 * trust anything else, and it uses only `eth_chainId`, which is part of the
 * Ethereum JSON-RPC specification rather than a DreamDEX or Somnia fact.
 */
export async function readChainId(rpcUrl: string): Promise<{ chainId: bigint } | { error: string }> {
  const response = await jsonRpc(rpcUrl, "eth_chainId", []);
  if (!response.ok) {
    return { error: response.error };
  }
  if (typeof response.result !== "string" || !/^0x[0-9a-fA-F]+$/u.test(response.result)) {
    return { error: `eth_chainId returned ${JSON.stringify(response.result)}` };
  }
  return { chainId: BigInt(response.result) };
}

/** Reads deployed bytecode at an address. Used to prove a precompile is present. */
export async function readCode(
  rpcUrl: string,
  address: string,
): Promise<{ code: string } | { error: string }> {
  // Checked here rather than trusted: a malformed address makes some nodes
  // answer with an error and others with something that merely looks like a
  // result, and a probe that cannot tell those apart reports a false OK.
  if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) {
    return { error: `not a 20-byte address: ${address}` };
  }
  const response = await jsonRpc(rpcUrl, "eth_getCode", [address, "latest"]);
  if (!response.ok) {
    return { error: response.error };
  }
  if (typeof response.result !== "string" || !/^0x([0-9a-fA-F]{2})*$/u.test(response.result)) {
    return { error: `eth_getCode returned ${JSON.stringify(response.result)}` };
  }
  return { code: response.result };
}

/**
 * A JSON-RPC result, or the reason there is not one.
 *
 * Deliberately a discriminated union rather than `unknown`: an error rendered as
 * a string is indistinguishable from a string result, and a probe that confuses
 * the two reports a fact it never actually read.
 */
type RpcResponse = { ok: true; result: unknown } | { ok: false; error: string };

async function jsonRpc(rpcUrl: string, method: string, params: unknown[]): Promise<RpcResponse> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { ok: false, error: `RPC responded ${response.status} ${response.statusText}` };
    }
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error !== undefined) {
      return { ok: false, error: `RPC error: ${body.error.message ?? JSON.stringify(body.error)}` };
    }
    return { ok: true, result: body.result };
  } catch (error) {
    // AGENTS.md forbids an empty catch. An unreachable RPC is a real result:
    // it means the probe could not read the fact, which is what gets reported.
    return { ok: false, error: `RPC unreachable: ${(error as Error).message}` };
  }
}
