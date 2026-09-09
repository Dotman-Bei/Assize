/**
 * Unit and property tests for the reference evaluator (PRD §13).
 *
 * These check the TypeScript side on its own. Agreement with the Solidity side
 * is a separate gate (G2, `pnpm test:differential`), because a test that only
 * ever asks one implementation what it thinks cannot detect a shared mistake.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_UINT128,
  MAX_UINT64,
  VERDICT_STATES,
  ZERO_BLOCK_HASH,
  type CommitmentEnvelope,
  type StoredSample,
  type StoredSampleSource,
} from "@assize/protocol-types";
import { storedSampleSchema, writableSampleSchema } from "@assize/protocol-types/schemas";

import { isBreach, isSampleInDomain, spreadBps, verdict } from "./index.js";

const PIN = `0x${"ab".repeat(32)}` as const;

const envelope = (
  over: Partial<CommitmentEnvelope> = {},
): CommitmentEnvelope => ({
  maxSpread: 200n,
  minSize: 1000n,
  start: 100n,
  end: 200n,
  ...over,
});

const sample = (over: Partial<StoredSample> = {}): StoredSample => ({
  bid: 4990n,
  ask: 5010n,
  bidSize: 5000n,
  askSize: 5000n,
  blockNumber: 150n,
  blockHash: PIN,
  source: "REACTIVITY",
  ...over,
});

describe("verdict precedence (DECISIONS.md D-004)", () => {
  it("reports NOT_SAMPLED for a zeroed slot", () => {
    expect(verdict(envelope(), sample({ blockNumber: 0n }))).toBe("NOT_SAMPLED");
  });

  it("reports SAMPLER_FAILED for an unpinned, unlabelled or crossed sample", () => {
    expect(verdict(envelope(), sample({ blockHash: ZERO_BLOCK_HASH }))).toBe("SAMPLER_FAILED");
    expect(verdict(envelope(), sample({ source: "UNLABELLED" }))).toBe("SAMPLER_FAILED");
    expect(verdict(envelope(), sample({ bid: 5100n, ask: 4900n }))).toBe("SAMPLER_FAILED");
  });

  it("puts a structurally unusable record ahead of the window test", () => {
    // A record we cannot trust says nothing, whether or not it is in the window.
    expect(verdict(envelope(), sample({ blockHash: ZERO_BLOCK_HASH, blockNumber: 999n })))
      .toBe("SAMPLER_FAILED");
    // A crossed book, by contrast, is only reached inside the window.
    expect(verdict(envelope(), sample({ bid: 5100n, ask: 4900n, blockNumber: 999n })))
      .toBe("WINDOW_CLOSED");
  });

  it("treats the window as inclusive at both ends", () => {
    expect(verdict(envelope(), sample({ blockNumber: 99n }))).toBe("WINDOW_CLOSED");
    expect(verdict(envelope(), sample({ blockNumber: 100n }))).toBe("COVERED_AT_SAMPLE");
    expect(verdict(envelope(), sample({ blockNumber: 200n }))).toBe("COVERED_AT_SAMPLE");
    expect(verdict(envelope(), sample({ blockNumber: 201n }))).toBe("WINDOW_CLOSED");
  });

  it("puts ABSENT ahead of the crossed test, so a pulled side is a breach", () => {
    // A sampler reading an empty ask side writes ask = 0, which is
    // arithmetically crossed against a positive bid. If crossed were tested
    // first this would be SAMPLER_FAILED, which forfeits nothing, and PRD §14's
    // "pull one side entirely" would go unpunished.
    expect(verdict(envelope(), sample({ ask: 0n }))).toBe("ABSENT");
    expect(isBreach(verdict(envelope(), sample({ ask: 0n })))).toBe(true);
    expect(verdict(envelope(), sample({ bid: 0n }))).toBe("ABSENT");
    // A genuinely crossed book, both sides quoted, is still our failure.
    expect(verdict(envelope(), sample({ bid: 5100n, ask: 4900n }))).toBe("SAMPLER_FAILED");
  });

  it("puts ABSENT ahead of spread and depth", () => {
    // With no bid there is no spread to measure, so ABSENT is the only honest
    // answer even though this sample also fails the depth test.
    expect(verdict(envelope(), sample({ bid: 0n, bidSize: 0n }))).toBe("ABSENT");
    expect(verdict(envelope(), sample({ bidSize: 0n }))).toBe("ABSENT");
    expect(verdict(envelope(), sample({ askSize: 0n }))).toBe("ABSENT");
  });

  it("puts SPREAD_BREACH ahead of DEPTH_BREACH when both hold", () => {
    expect(verdict(envelope(), sample({ bid: 1000n, ask: 9000n, bidSize: 1n, askSize: 1n })))
      .toBe("SPREAD_BREACH");
  });

  it("treats the committed spread bound as inclusive", () => {
    // 4950/5050 is exactly 200 bps of mid.
    expect(verdict(envelope(), sample({ bid: 4950n, ask: 5050n }))).toBe("COVERED_AT_SAMPLE");
    expect(verdict(envelope(), sample({ bid: 4949n, ask: 5051n }))).toBe("SPREAD_BREACH");
  });

  it("requires the committed depth on both sides", () => {
    expect(verdict(envelope(), sample({ bidSize: 1000n, askSize: 1000n }))).toBe("COVERED_AT_SAMPLE");
    expect(verdict(envelope(), sample({ bidSize: 999n }))).toBe("DEPTH_BREACH");
    expect(verdict(envelope(), sample({ askSize: 999n }))).toBe("DEPTH_BREACH");
  });

  it("returns the one positive state only when the envelope held", () => {
    expect(verdict(envelope(), sample())).toBe("COVERED_AT_SAMPLE");
  });

  it("evaluates a KEEPER sample exactly as a REACTIVITY one", () => {
    // The label is provenance (PRD §8.2). It is not a modifier on the verdict.
    for (const source of ["REACTIVITY", "KEEPER"] satisfies StoredSampleSource[]) {
      expect(verdict(envelope(), sample({ source }))).toBe("COVERED_AT_SAMPLE");
      expect(verdict(envelope(), sample({ source, bid: 1000n, ask: 9000n }))).toBe("SPREAD_BREACH");
    }
  });
});

describe("spreadBps", () => {
  it("is scale invariant, which is what lets it work without a tick size", () => {
    // PRD §17 forbids compiling in a tick size. The same relative spread must
    // measure the same at any price scale (DECISIONS.md D-005).
    expect(spreadBps(99n, 101n)).toBe(spreadBps(9_900n, 10_100n));
    expect(spreadBps(99n, 101n)).toBe(spreadBps(990_000n, 1_010_000n));
  });

  it("floors, and does not overflow at the top of the width", () => {
    expect(spreadBps(9_999n, 10_000n)).toBe(1n); // 20000/19999 floors to 1
    expect(spreadBps(100_000n, 100_001n)).toBe(0n); // 20000/200001 floors to 0
    expect(spreadBps(4_950n, 5_050n)).toBe(200n);
    expect(spreadBps(1n, MAX_UINT128)).toBe(19_999n);
  });

  it("is zero for a locked market", () => {
    expect(spreadBps(5_000n, 5_000n)).toBe(0n);
  });
});

describe("isBreach", () => {
  it("forfeits a bond only for the three states that are the maker's doing", () => {
    expect(VERDICT_STATES.filter(isBreach)).toEqual(["ABSENT", "SPREAD_BREACH", "DEPTH_BREACH"]);
  });

  it("never charges a maker for our own failure or for a gap", () => {
    // PRD §26 K6: a breach that did not occur is an incident, not a datum.
    expect(isBreach("SAMPLER_FAILED")).toBe(false);
    expect(isBreach("NOT_SAMPLED")).toBe(false);
    expect(isBreach("WINDOW_CLOSED")).toBe(false);
  });
});

describe("totality (PRD §13)", () => {
  it("returns one of the seven states for every shape it is handed", () => {
    const values = [0n, 1n, 999n, 1000n, 5000n, MAX_UINT128];
    const blocks = [0n, 99n, 100n, 150n, 200n, 201n, MAX_UINT64];
    const sources: StoredSampleSource[] = ["UNLABELLED", "REACTIVITY", "KEEPER"];
    let checked = 0;
    for (const bid of values) {
      for (const ask of values) {
        for (const size of values) {
          for (const blockNumber of blocks) {
            for (const source of sources) {
              for (const blockHash of [PIN, ZERO_BLOCK_HASH] as const) {
                const s = sample({ bid, ask, bidSize: size, askSize: size, blockNumber, source, blockHash });
                expect(isSampleInDomain(s)).toBe(true);
                expect(VERDICT_STATES).toContain(verdict(envelope(), s));
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(values.length ** 3 * blocks.length * sources.length * 2);
  });

  it("never divides by zero, because ABSENT is decided first", () => {
    expect(verdict(envelope({ maxSpread: 0n, minSize: 0n }), sample({ bid: 0n, ask: 0n })))
      .toBe("ABSENT");
  });
});

describe("schemas", () => {
  it("accepts a stored sample that is defective, because storage may hold one", () => {
    const parsed = storedSampleSchema.safeParse({
      bid: 0n, ask: 0n, bidSize: 0n, askSize: 0n,
      blockNumber: 0n, blockHash: ZERO_BLOCK_HASH, source: "UNLABELLED",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses to write a sample that is unpinned or unlabelled", () => {
    const base = {
      bid: 4990n, ask: 5010n, bidSize: 5000n, askSize: 5000n,
      blockNumber: 150n, blockHash: PIN, source: "REACTIVITY" as const,
    };
    expect(writableSampleSchema.safeParse(base).success).toBe(true);
    expect(writableSampleSchema.safeParse({ ...base, blockNumber: 0n }).success).toBe(false);
    expect(writableSampleSchema.safeParse({ ...base, blockHash: ZERO_BLOCK_HASH }).success).toBe(false);
    expect(writableSampleSchema.safeParse({ ...base, source: "UNLABELLED" }).success).toBe(false);
  });

  it("rejects a value that would not fit its storage width", () => {
    const tooWide = {
      bid: MAX_UINT128 + 1n, ask: 5010n, bidSize: 5000n, askSize: 5000n,
      blockNumber: 150n, blockHash: PIN, source: "REACTIVITY" as const,
    };
    expect(storedSampleSchema.safeParse(tooWide).success).toBe(false);
  });
});
