/**
 * The book read, probed against a live pool.
 *
 * Assize's whole measurement is the top of this book, so the shape of what
 * `getBookLevels` returns is the single most load-bearing protocol fact in the
 * product. The pinned starter template flags `OrderBookLevel` as the one struct
 * to confirm against a deployed pool before relying on it, and the pinned
 * `@somnia-chain/markets-sdk` agrees with it. Two documents agreeing is not the
 * same as a chain agreeing, so this reads a real pool and checks the layout.
 *
 * Signatures are taken from the pinned `IEventContracts.sol`, not from memory
 * (PRD §0.3). Nothing here writes.
 */

import { createPublicClient, http, type Address } from "viem";

import type { ProbeResult } from "./shared.js";

/** From the pinned `IEventContracts.sol`: the subset Assize reads. */
const POOL_ABI = [
  {
    type: "function",
    name: "getBookLevels",
    stateMutability: "view",
    inputs: [
      { name: "isBid", type: "bool" },
      { name: "numLevels", type: "uint64" },
    ],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "price", type: "uint256" },
          { name: "quantity", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getBinaryPoolParams",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "collateralToken", type: "address" },
          { name: "market", type: "address" },
          { name: "outcomeToken", type: "address" },
          { name: "yesId", type: "uint256" },
          { name: "noId", type: "uint256" },
          { name: "oneCollateral", type: "uint256" },
          { name: "setBacking", type: "uint256" },
          { name: "feeRecipient", type: "address" },
          { name: "makerFeeBpsTimes1k", type: "uint256" },
          { name: "takerFeeBpsTimes1k", type: "uint256" },
          { name: "maxBuilderFeeBpsTimes1k", type: "uint256" },
          { name: "settlementFeeBpsTimes1k", type: "uint256" },
          { name: "settlement", type: "address" },
          { name: "marketNonce", type: "uint64" },
          { name: "finalized", type: "bool" },
        ],
      },
    ],
  },
] as const;

interface Level {
  readonly price: bigint;
  readonly quantity: bigint;
}

/** Basis points of one whole contract, the way frontend.md renders a spread. */
function spreadBps(bid: bigint, ask: bigint, oneCollateral: bigint): bigint {
  return ((ask - bid) * 10_000n) / oneCollateral;
}

export async function probeBook(rpcUrl: string, pool: Address): Promise<ProbeResult[]> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const results: ProbeResult[] = [];

  let oneCollateral: bigint;
  try {
    const params = await client.readContract({
      address: pool,
      abi: POOL_ABI,
      functionName: "getBinaryPoolParams",
    });
    oneCollateral = params.oneCollateral;
  } catch (error) {
    results.push({
      check: "price scale",
      status: "BLOCKED",
      detail: `getBinaryPoolParams failed on ${pool}: ${(error as Error).message}`,
    });
    return results;
  }

  if (oneCollateral === 0n) {
    results.push({
      check: "price scale",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail: "oneCollateral is zero, so a price has no scale and a spread cannot be rendered",
    });
    return results;
  }
  // Read, never assumed. PRD §17 forbids compiling a scale in, and this is the
  // value every displayed spread is rendered against (DECISIONS.md D-011).
  results.push({
    check: "price scale",
    status: "OK",
    detail: `oneCollateral = ${oneCollateral}, read from the pool at runtime`,
  });

  let bids: readonly Level[];
  let asks: readonly Level[];
  try {
    [bids, asks] = await Promise.all([
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "getBookLevels", args: [true, 5n] }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "getBookLevels", args: [false, 5n] }),
    ]);
  } catch (error) {
    results.push({
      check: "book read",
      status: "BLOCKED",
      detail: `getBookLevels failed on ${pool}: ${(error as Error).message}`,
    });
    return results;
  }

  const problems: string[] = [];
  // A price is a probability, so it sits strictly inside (0, oneCollateral). A
  // quantity would not. That is what tells the two fields apart, and it is why
  // the field order can be confirmed rather than assumed.
  for (const [side, levels] of [["bid", bids], ["ask", asks]] as const) {
    levels.forEach((level, index) => {
      if (level.price === 0n || level.price >= oneCollateral) {
        problems.push(`${side}[${index}].price ${level.price} is not inside (0, ${oneCollateral})`);
      }
    });
  }
  // Best price first, on both sides.
  bids.forEach((level, index) => {
    const previous = bids[index - 1];
    if (previous !== undefined && level.price > previous.price) {
      problems.push(`bid[${index}] ${level.price} is better than bid[${index - 1}] ${previous.price}`);
    }
  });
  asks.forEach((level, index) => {
    const previous = asks[index - 1];
    if (previous !== undefined && level.price < previous.price) {
      problems.push(`ask[${index}] ${level.price} is better than ask[${index - 1}] ${previous.price}`);
    }
  });

  if (problems.length > 0) {
    results.push({
      check: "book layout",
      status: "PROTOCOL_CONFIG_CHANGED",
      detail:
        `getBookLevels does not return {price, quantity} best-first as the pinned sources `
        + `document: ${problems.join("; ")}. Assize samples the top of this book, so this is `
        + "the most load-bearing protocol fact in the product. Stop and re-inspect (PRD §17).",
    });
    return results;
  }

  const best = (levels: readonly Level[]): Level | undefined => levels[0];
  const bestBid = best(bids);
  const bestAsk = best(asks);
  if (bestBid === undefined || bestAsk === undefined) {
    // A one-sided book is a real state, not a failure. PRD §14 calls it pulling
    // a side, and the evaluator calls it ABSENT.
    results.push({
      check: "book layout",
      status: "OK",
      detail:
        `${bids.length} bid level(s), ${asks.length} ask level(s). One side is empty, which is a `
        + "real reading and evaluates to ABSENT, not an error.",
    });
    return results;
  }

  results.push({
    check: "book layout",
    status: "OK",
    detail:
      `{price, quantity} best-first, confirmed against a live pool. `
      + `best bid ${bestBid.price} x ${bestBid.quantity}, best ask ${bestAsk.price} x ${bestAsk.quantity}, `
      + `spread ${bestAsk.price - bestBid.price} raw = ${spreadBps(bestBid.price, bestAsk.price, oneCollateral)} bps of one contract`,
  });
  return results;
}
