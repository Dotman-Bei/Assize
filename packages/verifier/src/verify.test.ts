/**
 * Tests for the verifier.
 *
 * The point of this package is that it disagrees with the chain when the chain
 * is wrong, so the tests that matter are the ones where it must fail. A verifier
 * that passes unconditionally is worse than no verifier: it launders a bad record.
 */
import { describe, expect, it, vi } from "vitest";

import { verify } from "./verify.js";

const PIN = `0x${"ab".repeat(32)}` as const;
const PARENT = PIN;

/** A stand-in registry, so the failure paths can be driven without a chain. */
function fakeClient(over: Record<string, unknown> = {}) {
  const state = {
    breachCount: 1n,
    breach: { commitmentId: 0n, sampleId: 7n },
    sample: {
      commitmentId: 0n,
      sample: { bid: 1000n, ask: 9000n, bidSize: 5000n, askSize: 5000n, blockNumber: 500n, blockHash: PIN, source: 1 },
    },
    commitment: { maker: "0x0", marketId: "0x0", maxSpread: 200n, minSize: 1000n, start: 0n, end: 100000n, bond: 1n, forfeitedAtBreachIdPlusOne: 1n },
    verdictOf: 4,            // SPREAD_BREACH
    parentHash: PARENT,
    ...over,
  };
  return {
    getChainId: vi.fn(async () => 50312),
    getBlock: vi.fn(async () => ({ parentHash: state.parentHash })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "breachCount") return state.breachCount;
      if (functionName === "breachAt") return state.breach;
      if (functionName === "sampleAt") return state.sample;
      if (functionName === "commitmentAt") return state.commitment;
      if (functionName === "verdictOf") return state.verdictOf;
      throw new Error(`unexpected call ${functionName}`);
    }),
  } as never;
}

const request = { rpcUrl: "http://local", registry: "0x0" as `0x${string}`, id: 0n, by: "breach" as const };

describe("verify", () => {
  it("passes when the chain and the reference agree and the pin resolves", async () => {
    const result = await verify(request, fakeClient());
    expect(result.derived).toBe("SPREAD_BREACH");
    expect(result.onChain).toBe("SPREAD_BREACH");
    expect(result.passed).toBe(true);
  });

  it("fails when the chain claims a verdict the reference does not reach", async () => {
    // The chain says COVERED_AT_SAMPLE for a book whose spread is 8000 against a
    // committed 200. This is the case the whole package exists to catch.
    const result = await verify(request, fakeClient({ verdictOf: 6 }));
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "verdicts agree")?.ok).toBe(false);
    expect(result.derived).toBe("SPREAD_BREACH");
    expect(result.onChain).toBe("COVERED_AT_SAMPLE");
  });

  it("fails when the block pin does not resolve", async () => {
    const result = await verify(request, fakeClient({ parentHash: `0x${"cd".repeat(32)}` }));
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "block pin resolves")?.ok).toBe(false);
  });

  it("fails when a breach names a sample that does not breach", async () => {
    // A covered book, recorded as a breach: the bond would have been forfeited
    // for nothing, which is the incident PRD §26 K6 exists to stop.
    const covered = {
      commitmentId: 0n,
      sample: { bid: 4990n, ask: 5010n, bidSize: 5000n, askSize: 5000n, blockNumber: 500n, blockHash: PIN, source: 1 },
    };
    const result = await verify(request, fakeClient({ sample: covered, verdictOf: 6 }));
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "verdict is a breach")?.ok).toBe(false);
  });

  it("reports a missing breach rather than inventing one", async () => {
    const result = await verify(request, fakeClient({ breachCount: 0n }));
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "breach exists")?.ok).toBe(false);
  });

  it("reads an unwritten sample as NOT_SAMPLED", async () => {
    const empty = { commitmentId: 0n, sample: { bid: 0n, ask: 0n, bidSize: 0n, askSize: 0n, blockNumber: 0n, blockHash: `0x${"0".repeat(64)}`, source: 0 } };
    const result = await verify({ ...request, by: "sample", id: 999n }, fakeClient({ sample: empty }));
    expect(result.passed).toBe(false);
    expect(result.derived).toBe("NOT_SAMPLED");
  });
});
