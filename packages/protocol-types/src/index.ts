/**
 * @assize/protocol-types
 *
 * PRD §5.2: the sample struct, the commitment envelope, and the enumerated verdict
 * states. These are Assize's own structures. Nothing here encodes a DreamDEX or
 * Somnia protocol fact: no market id, no address, no event signature, no tick size
 * (PRD §17, AGENTS.md "Protocol facts").
 */

/* ------------------------------------------------------------------------- *
 * §5.2 Verdict states. Enumerated, exactly seven, in canonical order.
 * ------------------------------------------------------------------------- */

/**
 * §5.2: the seven states, and no others. `COVERED_AT_SAMPLE` is the strongest
 * positive state that exists. AGENTS.md: do not add a state, do not collapse two.
 *
 * The numeric order below is the wire encoding shared with Solidity. It is close
 * to, but not identical to, the evaluator's precedence order: `SAMPLER_FAILED`
 * is reached both before and after `ABSENT`, for two different causes
 * (DECISIONS.md D-004). `NOT_SAMPLED` is 0 so that an unwritten storage slot
 * reads as "nothing was observed here" rather than as a positive result.
 */
export const VERDICT_STATES = [
  "NOT_SAMPLED",
  "SAMPLER_FAILED",
  "WINDOW_CLOSED",
  "ABSENT",
  "SPREAD_BREACH",
  "DEPTH_BREACH",
  "COVERED_AT_SAMPLE",
] as const;

export type VerdictState = (typeof VERDICT_STATES)[number];

/** Numeric encoding shared with the Solidity `VerdictState` enum (G2). */
export const VERDICT_CODE: Readonly<Record<VerdictState, number>> = Object.freeze({
  NOT_SAMPLED: 0,
  SAMPLER_FAILED: 1,
  WINDOW_CLOSED: 2,
  ABSENT: 3,
  SPREAD_BREACH: 4,
  DEPTH_BREACH: 5,
  COVERED_AT_SAMPLE: 6,
});

/** Inverse of {@link VERDICT_CODE}. Total over the seven codes, and no others. */
export function verdictFromCode(code: number): VerdictState {
  const state = VERDICT_STATES[code];
  if (state === undefined) {
    throw new RangeError(`not a verdict code: ${code}`);
  }
  return state;
}

/**
 * The only positive state. Exported as a function rather than a set of "good"
 * states so that no caller can widen the notion of coverage by adding to a list.
 */
export function isCovered(verdict: VerdictState): boolean {
  return verdict === "COVERED_AT_SAMPLE";
}

/* ------------------------------------------------------------------------- *
 * §0.9 Sample provenance. Every sample carries its source label.
 * ------------------------------------------------------------------------- */

/**
 * PRD §8.2: Path R (`REACTIVITY`) is primary, Path K (`KEEPER`) is the labelled
 * fallback. `UNLABELLED` is the zero value: it is not a third path, it is the
 * shape a sample has when the label is missing. AGENTS.md: "A sample without a
 * source label is a bug, not a sample" — so the evaluator maps it to
 * `SAMPLER_FAILED` rather than letting it score as coverage.
 */
export const SAMPLE_SOURCES = ["UNLABELLED", "REACTIVITY", "KEEPER"] as const;
export type StoredSampleSource = (typeof SAMPLE_SOURCES)[number];

/** A source a correctly written sample may carry. `UNLABELLED` is excluded. */
export type SampleSource = Exclude<StoredSampleSource, "UNLABELLED">;

export const SAMPLE_SOURCE_CODE: Readonly<Record<StoredSampleSource, number>> = Object.freeze({
  UNLABELLED: 0,
  REACTIVITY: 1,
  KEEPER: 2,
});

export function sampleSourceFromCode(code: number): StoredSampleSource {
  const source = SAMPLE_SOURCES[code];
  if (source === undefined) {
    throw new RangeError(`not a sample source code: ${code}`);
  }
  return source;
}

/* ------------------------------------------------------------------------- *
 * Numeric domain. Mirrors the Solidity storage widths exactly (G2).
 * ------------------------------------------------------------------------- */

export const MAX_UINT128 = (1n << 128n) - 1n;
export const MAX_UINT64 = (1n << 64n) - 1n;
export const MAX_UINT32 = (1n << 32n) - 1n;

/** The all-zero bytes32, i.e. an unpinned sample (PRD §6, §12 reorg row). */
export const ZERO_BLOCK_HASH = `0x${"0".repeat(64)}` as const;

/* ------------------------------------------------------------------------- *
 * §5.2 The stored sample.
 * ------------------------------------------------------------------------- */

/**
 * PRD §5.2 fixes this field set exactly:
 *   `{ bid, ask, bidSize, askSize, blockNumber, blockHash, source }`
 * AGENTS.md / PRD §0.3 forbid inventing a struct layout or a field name, so no
 * field is added here — notably no timestamp, which is why a commitment window
 * is expressed in block numbers (DECISIONS.md D-003).
 *
 * Prices and sizes are raw integers in whatever unit the venue's book reports.
 * Assize never converts them, because a conversion needs a tick size and a tick
 * size is a protocol fact that may not be compiled in (PRD §17). The spread test
 * is a ratio, which is scale-invariant (DECISIONS.md D-005).
 */
export interface StoredSample {
  readonly bid: bigint;
  readonly ask: bigint;
  readonly bidSize: bigint;
  readonly askSize: bigint;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly source: StoredSampleSource;
}

/* ------------------------------------------------------------------------- *
 * §10 The commitment envelope.
 * ------------------------------------------------------------------------- */

/**
 * The verdict-relevant half of a commitment (PRD §10
 * `publishCommitment(marketId, maxSpread, minSize, start, end)`).
 *
 * `maxSpread` is the widest tolerated `ask - bid`, in the book's own raw price
 * units — an absolute bound, not a ratio (DECISIONS.md D-011, superseding D-005).
 * `minSize` is in the book's own size units and applies to each side
 * independently. `start` and `end` are block numbers, inclusive at both ends
 * (DECISIONS.md D-003).
 *
 * The maker, the bond and the market id are stored on the commitment but are not
 * inputs to the verdict: PRD §12 requires the verdict be computed from stored
 * samples only, never from maker input.
 */
export interface CommitmentEnvelope {
  readonly maxSpread: bigint;
  readonly minSize: bigint;
  readonly start: bigint;
  readonly end: bigint;
}
