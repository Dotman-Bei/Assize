/**
 * Re-derives a recorded verdict from chain.
 *
 * PRD §11: "runnable with a public RPC, no account, no API key, and no access to
 * our deployment beyond its address. If verification requires us, it is not
 * verification." So this module reads storage and computes; it never asks the
 * registry what it thinks the answer is and then believes it.
 *
 * The comparison that matters is between two independent implementations: the
 * Solidity evaluator that ran on chain, and `packages/reference` running here.
 * Agreement is the evidence. `verdictOf` alone would only prove the contract
 * agrees with itself.
 */

import { createPublicClient, http, type Abi, type Address, type PublicClient } from "viem";

import { VERDICT_STATES, sampleSourceFromCode, type StoredSample } from "@assize/protocol-types";
import { isBreach, verdict as reference } from "@assize/reference";

export const registryAbi = [
  { type: "function", name: "sampleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "breachCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "verdictOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "breachAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "commitmentId", type: "uint256" }, { name: "sampleId", type: "uint256" }] }] },
  { type: "function", name: "sampleAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "commitmentId", type: "uint256" },
      { name: "sample", type: "tuple", components: [
        { name: "bid", type: "uint128" }, { name: "ask", type: "uint128" },
        { name: "bidSize", type: "uint128" }, { name: "askSize", type: "uint128" },
        { name: "blockNumber", type: "uint64" }, { name: "blockHash", type: "bytes32" },
        { name: "source", type: "uint8" }] }] }] },
  { type: "function", name: "commitmentAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [
      { name: "maker", type: "address" }, { name: "marketId", type: "bytes32" },
      { name: "maxSpread", type: "uint128" }, { name: "minSize", type: "uint128" },
      { name: "start", type: "uint64" }, { name: "end", type: "uint64" },
      { name: "bond", type: "uint256" }, { name: "forfeitedAtBreachIdPlusOne", type: "uint256" }] }] },
  // PRD §27 Phase P3. A verifier has to be able to re-derive a payout from
  // storage, not just a verdict: the share is `bond * fillVolumeOf / witnessedVolume`
  // and every term in that is readable here.
  { type: "function", name: "witnessedVolume", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paidOut", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "orderOwner", stateMutability: "view", inputs: [{ type: "uint128" }], outputs: [{ type: "address" }] },
  { type: "function", name: "fillVolumeOf", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint128" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "orderSettled", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint128" }], outputs: [{ type: "bool" }] },
  // Deliberately not `as const`: every read goes through one generic helper, and
  // literal-narrowed types would force a cast at each call site instead of one here.
] satisfies Abi;

export interface VerifyRequest {
  readonly rpcUrl: string;
  readonly registry: Address;
  /** A breach id, or a sample id when `by` is "sample". */
  readonly id: bigint;
  readonly by: "breach" | "sample";
}

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface VerifyResult {
  readonly checks: readonly Check[];
  readonly passed: boolean;
  readonly sampleId: bigint;
  readonly derived: string;
  readonly onChain: string;
}

/**
 * Every step is reported, passing or failing, so a reader can see what was
 * actually checked rather than only the conclusion.
 */
export async function verify(request: VerifyRequest, client?: PublicClient): Promise<VerifyResult> {
  const rpc = client ?? createPublicClient({ transport: http(request.rpcUrl) });
  const read = <T>(functionName: string, args: unknown[]): Promise<T> =>
    rpc.readContract({ address: request.registry, abi: registryAbi, functionName, args }) as Promise<T>;

  const checks: Check[] = [];
  const chainId = await rpc.getChainId();
  checks.push({ name: "rpc reachable", ok: true, detail: `chain ${chainId} at ${request.rpcUrl}` });

  // Resolve the sample the verdict is about.
  let sampleId = request.id;
  if (request.by === "breach") {
    const total = await read<bigint>("breachCount", []);
    if (request.id >= total) {
      checks.push({ name: "breach exists", ok: false, detail: `breach ${request.id} does not exist; the registry has recorded ${total}` });
      return { checks, passed: false, sampleId: 0n, derived: "", onChain: "" };
    }
    const breach = await read<{ commitmentId: bigint; sampleId: bigint }>("breachAt", [request.id]);
    sampleId = breach.sampleId;
    checks.push({ name: "breach exists", ok: true, detail: `breach ${request.id} names sample ${sampleId} on commitment ${breach.commitmentId}` });
  }

  const record = await read<{ commitmentId: bigint; sample: {
    bid: bigint; ask: bigint; bidSize: bigint; askSize: bigint;
    blockNumber: bigint; blockHash: `0x${string}`; source: number;
  } }>("sampleAt", [sampleId]);

  if (record.sample.blockNumber === 0n) {
    checks.push({ name: "sample stored", ok: false, detail: `no sample ${sampleId} is stored; a zeroed slot reads as NOT_SAMPLED` });
    return { checks, passed: false, sampleId, derived: "NOT_SAMPLED", onChain: "NOT_SAMPLED" };
  }
  const s = record.sample;
  checks.push({
    name: "sample stored", ok: true,
    detail: `sample ${sampleId}: bid ${s.bid} ask ${s.ask} sizes ${s.bidSize}/${s.askSize} at block ${s.blockNumber}`,
  });

  const commitment = await read<{
    maker: Address; marketId: `0x${string}`; maxSpread: bigint; minSize: bigint;
    start: bigint; end: bigint; bond: bigint; forfeitedAtBreachIdPlusOne: bigint;
  }>("commitmentAt", [record.commitmentId]);
  checks.push({
    name: "commitment stored", ok: true,
    detail: `commitment ${record.commitmentId}: max spread ${commitment.maxSpread}, min size ${commitment.minSize}, blocks ${commitment.start} to ${commitment.end}`,
  });

  // The block pin. A contract cannot observe the hash of the block it runs in,
  // so a sample stores block N alongside the hash of N-1. Checking this as a
  // block hash rather than a parent hash rejects every honest sample.
  try {
    const block = await rpc.getBlock({ blockNumber: s.blockNumber });
    const pinned = block.parentHash.toLowerCase() === s.blockHash.toLowerCase();
    checks.push({
      name: "block pin resolves", ok: pinned,
      detail: pinned
        ? `block ${s.blockNumber} has parent ${s.blockHash}, matching the pin`
        : `block ${s.blockNumber} has parent ${block.parentHash}, which is NOT the pinned ${s.blockHash}`,
    });
  } catch (error) {
    checks.push({ name: "block pin resolves", ok: false, detail: `block ${s.blockNumber} could not be read: ${(error as Error).message}` });
  }

  const sample: StoredSample = {
    bid: s.bid, ask: s.ask, bidSize: s.bidSize, askSize: s.askSize,
    blockNumber: s.blockNumber, blockHash: s.blockHash,
    source: sampleSourceFromCode(Number(s.source)),
  };
  const derived = reference(
    { maxSpread: commitment.maxSpread, minSize: commitment.minSize, start: commitment.start, end: commitment.end },
    sample,
  );
  const onChain = VERDICT_STATES[Number(await read<number>("verdictOf", [sampleId]))] ?? "?";

  checks.push({ name: "re-derived locally", ok: true, detail: `packages/reference computes ${derived} from the stored sample and commitment` });
  checks.push({
    name: "verdicts agree", ok: derived === onChain,
    detail: derived === onChain
      ? `the chain also says ${onChain}`
      : `the chain says ${onChain} but this re-derivation says ${derived}`,
  });

  if (request.by === "breach") {
    checks.push({
      name: "verdict is a breach", ok: isBreach(derived),
      detail: isBreach(derived)
        ? `${derived} forfeits a bond, so recording a breach against it is correct`
        : `${derived} does not forfeit a bond, yet a breach was recorded against it`,
    });
  }

  return { checks, passed: checks.every((c) => c.ok), sampleId, derived, onChain };
}
