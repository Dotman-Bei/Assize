/**
 * Deterministic generator for the G2 differential vectors (PRD §22 G2, §13).
 *
 * PRD §13 requires 10,000 generated commitment and sample pairs, and the gate
 * must pass "on a fresh clone" — so generation is seeded and reproducible rather
 * than randomised per run. A divergence found in CI is reproducible locally from
 * the same seed.
 *
 * The corpus is handcrafted edge cases first, then seeded pseudo-random shapes
 * chosen so that all seven states occur. PRD §13 names the shapes that matter:
 * zero size and crossed books.
 */

import type { CommitmentEnvelope, StoredSample } from "@assize/protocol-types";
import { MAX_UINT128, MAX_UINT64 } from "@assize/protocol-types";

export interface DifferentialCase {
  readonly envelope: CommitmentEnvelope;
  readonly sample: StoredSample;
}

/** mulberry32, a small deterministic PRNG. Reproducibility is the requirement. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PINNED = `0x${"ab".repeat(32)}` as const;
const UNPINNED = `0x${"0".repeat(64)}` as const;

function envelope(
  maxSpread: bigint,
  minSize: bigint,
  start: bigint,
  end: bigint,
): CommitmentEnvelope {
  return { maxSpread, minSize, start, end };
}

function sample(
  bid: bigint,
  ask: bigint,
  bidSize: bigint,
  askSize: bigint,
  blockNumber: bigint,
  blockHash: `0x${string}` = PINNED,
  source: StoredSample["source"] = "REACTIVITY",
): StoredSample {
  return { bid, ask, bidSize, askSize, blockNumber, blockHash, source };
}

/**
 * Cases chosen to sit exactly on a boundary, where two implementations are most
 * likely to disagree: inclusive window ends, a spread exactly equal to the
 * committed bound, floor division, and the extremes of each storage width.
 */
function edgeCases(): DifferentialCase[] {
  const e = envelope(200n, 1000n, 100n, 200n);
  const cases: DifferentialCase[] = [
    // NOT_SAMPLED: a zeroed slot, and a zero block number with data around it.
    { envelope: e, sample: sample(0n, 0n, 0n, 0n, 0n, UNPINNED, "UNLABELLED") },
    { envelope: e, sample: sample(4900n, 5100n, 5000n, 5000n, 0n) },

    // SAMPLER_FAILED: unpinned, unlabelled, crossed. Each alone and combined.
    { envelope: e, sample: sample(4900n, 5100n, 5000n, 5000n, 150n, UNPINNED) },
    { envelope: e, sample: sample(4900n, 5100n, 5000n, 5000n, 150n, PINNED, "UNLABELLED") },
    { envelope: e, sample: sample(5100n, 4900n, 5000n, 5000n, 150n) },
    { envelope: e, sample: sample(1n, 0n, 5000n, 5000n, 150n) },
    // Crossed outranks the window test: precedence must agree, not just the state.
    { envelope: e, sample: sample(5100n, 4900n, 5000n, 5000n, 999n) },
    // Unpinned outranks an otherwise clean covered sample.
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 5000n, 150n, UNPINNED) },

    // WINDOW_CLOSED: inclusive at both ends, so 99 and 201 close, 100 and 200 open.
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 5000n, 99n) },
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 5000n, 100n) },
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 5000n, 200n) },
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 5000n, 201n) },
    // A single-block window.
    { envelope: envelope(200n, 0n, 42n, 42n), sample: sample(1n, 1n, 1n, 1n, 42n) },

    // ABSENT: each of the four ways a two-sided quote can be missing.
    { envelope: e, sample: sample(0n, 5010n, 5000n, 5000n, 150n) },
    { envelope: e, sample: sample(4990n, 0n, 5000n, 5000n, 150n) },
    { envelope: e, sample: sample(4990n, 5010n, 0n, 5000n, 150n) },
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 0n, 150n) },
    // ABSENT outranks a spread that would also breach: no side, no spread.
    { envelope: e, sample: sample(0n, 9000n, 0n, 0n, 150n) },

    // SPREAD_BREACH boundary. The bound is absolute: spread = ask - bid (D-011).
    // 4900/5100 -> spread exactly 200, the bound, inside it.
    { envelope: e, sample: sample(4900n, 5100n, 5000n, 5000n, 150n) },
    // 4899/5101 -> spread 202 > 200.
    { envelope: e, sample: sample(4899n, 5101n, 5000n, 5000n, 150n) },
    // A one-unit spread against a one-unit bound, and against a zero bound.
    { envelope: envelope(1n, 0n, 1n, 1000n), sample: sample(9999n, 10000n, 1n, 1n, 500n) },
    { envelope: envelope(0n, 0n, 1n, 1000n), sample: sample(9999n, 10000n, 1n, 1n, 500n) },
    // The same spread at a very different price level must judge the same way.
    // Under the superseded ratio rule (D-005) these two disagreed.
    { envelope: envelope(200n, 0n, 1n, 1000n), sample: sample(9_900n, 10_100n, 1n, 1n, 500n) },
    { envelope: envelope(200n, 0n, 1n, 1000n), sample: sample(99_900n, 100_100n, 1n, 1n, 500n) },
    // Zero committed spread: only a locked market is inside it.
    { envelope: envelope(0n, 0n, 1n, 1000n), sample: sample(5000n, 5000n, 1n, 1n, 500n) },
    { envelope: envelope(0n, 0n, 1n, 1000n), sample: sample(4999n, 5000n, 1n, 1n, 500n) },
    // Spread outranks depth when both breach.
    { envelope: e, sample: sample(1000n, 9000n, 1n, 1n, 150n) },

    // DEPTH_BREACH: each side alone, and exactly at the minimum.
    { envelope: e, sample: sample(4990n, 5010n, 999n, 5000n, 150n) },
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 999n, 150n) },
    { envelope: e, sample: sample(4990n, 5010n, 1000n, 1000n, 150n) },
    { envelope: e, sample: sample(4990n, 5010n, 999n, 999n, 150n) },

    // COVERED_AT_SAMPLE: a locked market, and a zero-minimum envelope.
    { envelope: e, sample: sample(5000n, 5000n, 5000n, 5000n, 150n) },
    { envelope: envelope(0n, 0n, 0n, MAX_UINT64), sample: sample(1n, 1n, 1n, 1n, 1n) },

    // Width extremes. Spread arithmetic must not overflow at uint128 maxima.
    {
      envelope: envelope(0n, MAX_UINT128, 0n, MAX_UINT64),
      sample: sample(MAX_UINT128, MAX_UINT128, MAX_UINT128, MAX_UINT128, MAX_UINT64),
    },
    {
      envelope: envelope(20000n, 0n, 0n, MAX_UINT64),
      sample: sample(1n, MAX_UINT128, 1n, 1n, MAX_UINT64),
    },
    // The widest spread the widths allow, against a bound that tolerates it and
    // a bound that does not.
    {
      envelope: envelope(MAX_UINT128, 0n, 0n, MAX_UINT64),
      sample: sample(0n + 1n, MAX_UINT128, 1n, 1n, 1n),
    },
    {
      envelope: envelope(MAX_UINT128 - 2n, 0n, 0n, MAX_UINT64),
      sample: sample(1n, MAX_UINT128, 1n, 1n, 1n),
    },
    { envelope: envelope(0n, 0n, 0n, 0n), sample: sample(0n, 0n, 0n, 0n, 0n, UNPINNED, "UNLABELLED") },
    // KEEPER-sourced samples evaluate identically to REACTIVITY ones: the label
    // is provenance, not a modifier on the verdict (PRD §8.2).
    { envelope: e, sample: sample(4990n, 5010n, 5000n, 5000n, 150n, PINNED, "KEEPER") },
    { envelope: e, sample: sample(1000n, 9000n, 5000n, 5000n, 150n, PINNED, "KEEPER") },
  ];
  return cases;
}

/** Seeded pseudo-random cases, shaped so that every state occurs in volume. */
function randomCases(count: number, seed: number): DifferentialCase[] {
  const rng = makeRng(seed);
  const pick = <T,>(items: readonly T[]): T => {
    const index = Math.floor(rng() * items.length);
    const item = items[Math.min(index, items.length - 1)];
    if (item === undefined) {
      throw new Error("empty choice list");
    }
    return item;
  };
  const between = (lo: bigint, hi: bigint): bigint => {
    if (hi <= lo) {
      return lo;
    }
    const span = hi - lo + 1n;
    // Two draws give enough entropy to reach across a uint128 span.
    const draw = (BigInt(Math.floor(rng() * 0x100000000)) << 32n)
      | BigInt(Math.floor(rng() * 0x100000000));
    return lo + (draw % span);
  };

  const out: DifferentialCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = between(0n, 1_000_000n);
    const end = start + between(0n, 10_000n);
    const env = envelope(
      // Absolute bounds, drawn to straddle the spreads the book below produces.
      pick([0n, 1n, 2n, 50n, 200n, 500n, 2000n, 40000n, between(0n, 40000n), MAX_UINT128]),
      pick([0n, 1n, 1000n, between(0n, 100000n), MAX_UINT128]),
      start,
      end,
    );

    // Prices are drawn from a mid so that spreads land near the committed bound
    // often enough to exercise the comparison, not only far from it.
    const mid = pick([1n, 2n, 5000n, 10_000n, between(1n, 1_000_000n), MAX_UINT128 / 2n]);
    const halfSpread = pick([0n, 1n, 2n, 25n, 100n, between(0n, mid)]);
    let bid = mid > halfSpread ? mid - halfSpread : 0n;
    let ask = mid + halfSpread <= MAX_UINT128 ? mid + halfSpread : MAX_UINT128;
    // A minority of cases cross the book on purpose (PRD §13).
    if (rng() < 0.05) {
      const crossed = bid;
      bid = ask;
      ask = crossed;
    }
    // A minority zero a side on purpose (PRD §13).
    if (rng() < 0.05) {
      bid = 0n;
    }
    if (rng() < 0.05) {
      ask = 0n;
    }

    const sizes = [0n, 1n, 999n, 1000n, 5000n, between(0n, 200000n), MAX_UINT128] as const;
    // Weighted toward in-window blocks. Every pair stopped early by an
    // out-of-window block is a pair that never reaches the spread and depth
    // comparisons, which are the ones G2 exists to check.
    const blockNumber = pick([
      0n,
      start > 0n ? start - 1n : 0n,
      start,
      between(start, end),
      between(start, end),
      between(start, end),
      between(start, end),
      between(start, end),
      end,
      end + 1n,
      between(0n, MAX_UINT64),
    ]);

    out.push({
      envelope: env,
      sample: sample(
        bid,
        ask,
        pick(sizes),
        pick(sizes),
        blockNumber,
        rng() < 0.03 ? UNPINNED : PINNED,
        pick([
          "REACTIVITY",
          "REACTIVITY",
          "REACTIVITY",
          "REACTIVITY",
          "REACTIVITY",
          "REACTIVITY",
          "REACTIVITY",
          "KEEPER",
          "KEEPER",
          "UNLABELLED",
        ] as const),
      ),
    });
  }
  return out;
}

/** The full corpus. `total` is the number of pairs the gate requires (§22 G2). */
export function buildVectors(total: number, seed: number): DifferentialCase[] {
  const edges = edgeCases();
  if (edges.length >= total) {
    return edges.slice(0, total);
  }
  return [...edges, ...randomCases(total - edges.length, seed)];
}
