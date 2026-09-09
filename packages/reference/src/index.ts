/**
 * @assize/reference — the reference envelope evaluator.
 *
 * PRD §10: this is a second implementation of the evaluator, mirroring
 * `contracts/src/VerdictLib.sol` exactly. CI runs both over the same generated
 * inputs and fails on any divergence (PRD §22 G2). Neither implementation is
 * the authority: agreement between them is.
 *
 * PRD §5.2: `verdict(commitment, sample)` is pure, total and enumerated. It reads
 * a stored commitment and a stored sample and nothing else. Anything the sampler
 * knew but did not store is not an input.
 */

import type {
  CommitmentEnvelope,
  StoredSample,
  VerdictState,
} from "@assize/protocol-types";
import { MAX_UINT64, MAX_UINT128, ZERO_BLOCK_HASH } from "@assize/protocol-types";

/** Basis points per whole unit of probability. Display only — see {@link spreadBps}. */
const BPS_PER_UNIT = 10_000n;

/**
 * The spread of a sample, in the book's own raw price units.
 *
 * DECISIONS.md D-011: the committed bound is absolute, not a ratio of mid. Both
 * the sample's prices and the commitment's `maxSpread` are raw integers from the
 * same book, so the comparison needs no scale factor and no tick size, which is
 * what keeps PRD §17 satisfied.
 *
 * Precondition: `bid <= ask`. The caller establishes this by evaluating ABSENT
 * and the crossed-book test first (see {@link verdict}); that ordering is what
 * keeps the subtraction from underflowing in the Solidity mirror.
 */
export function absoluteSpread(bid: bigint, ask: bigint): bigint {
  return ask - bid;
}

/**
 * The same spread rendered in basis points of one whole contract, for display.
 *
 * NOT an input to any verdict. `priceScale` is the market's `oneCollateral` —
 * the raw value of one whole contract, read from the pool at runtime and never
 * compiled in (PRD §17). The verdict is computed from stored data alone
 * (PRD §5.2), and this needs a value that is not stored on the sample, which is
 * exactly why it lives outside the evaluator.
 *
 * `frontend.md` §3.2 and §3.7 both render spread this way: a 0.0160 spread reads
 * as 160 bps, and a 0.0650 spread as 650 bps.
 */
export function spreadBps(bid: bigint, ask: bigint, priceScale: bigint): bigint {
  if (priceScale <= 0n) {
    throw new RangeError("priceScale must be positive: it is the value of one whole contract");
  }
  return (absoluteSpread(bid, ask) * BPS_PER_UNIT) / priceScale;
}

/**
 * True when every field of `sample` fits the storage width its Solidity
 * counterpart declares. The Solidity evaluator gets this for free from its
 * types; TypeScript's `bigint` is unbounded, so callers handling untrusted
 * input check it here (or with `storedSampleSchema`) before evaluating.
 */
export function isSampleInDomain(sample: StoredSample): boolean {
  return (
    sample.bid >= 0n &&
    sample.bid <= MAX_UINT128 &&
    sample.ask >= 0n &&
    sample.ask <= MAX_UINT128 &&
    sample.bidSize >= 0n &&
    sample.bidSize <= MAX_UINT128 &&
    sample.askSize >= 0n &&
    sample.askSize <= MAX_UINT128 &&
    sample.blockNumber >= 0n &&
    sample.blockNumber <= MAX_UINT64
  );
}

/** As {@link isSampleInDomain}, for the commitment envelope. */
export function isEnvelopeInDomain(envelope: CommitmentEnvelope): boolean {
  return (
    envelope.maxSpread >= 0n &&
    envelope.maxSpread <= MAX_UINT128 &&
    envelope.minSize >= 0n &&
    envelope.minSize <= MAX_UINT128 &&
    envelope.start >= 0n &&
    envelope.start <= MAX_UINT64 &&
    envelope.end >= 0n &&
    envelope.end <= MAX_UINT64
  );
}

/**
 * The verdict function. Pure, total, enumerated (PRD §5.2).
 *
 * Precedence is fixed and identical in both implementations (DECISIONS.md
 * D-004). The verdict is the first state below whose condition holds:
 *
 *   1 NOT_SAMPLED        nothing was observed at all
 *   2 SAMPLER_FAILED     the record is structurally unusable: unpinned, or unlabelled
 *   3 WINDOW_CLOSED      the reading is outside the committed window
 *   4 ABSENT             there is no two-sided quote to measure
 *   5 SAMPLER_FAILED     both sides quoted, but crossed: our reading is wrong
 *   6 SPREAD_BREACH      ask - bid exceeds the committed absolute bound
 *   7 DEPTH_BREACH       the quote is thinner than committed
 *   8 COVERED_AT_SAMPLE  the envelope held at this instant, and nothing more
 *
 * SAMPLER_FAILED appears at two rungs because it has two causes that sit on
 * opposite sides of ABSENT. See rung 4 for why that ordering matters.
 *
 * A sample can breach spread and depth at once. It reports SPREAD_BREACH,
 * because one sample yields one state and the states may not be collapsed
 * (AGENTS.md). The breach record stores the sample, so the other condition
 * remains re-derivable by anyone (PRD §5.2, C-002).
 *
 * Domain: `sample` satisfies {@link isSampleInDomain} and `envelope` satisfies
 * {@link isEnvelopeInDomain}. Within it this function never throws.
 */
export function verdict(
  envelope: CommitmentEnvelope,
  sample: StoredSample,
): VerdictState {
  // 0. NOT_SAMPLED. A zeroed slot is the absence of an observation, not a
  //    result. PRD §6: gaps are recorded, never smoothed over.
  if (sample.blockNumber === 0n) {
    return "NOT_SAMPLED";
  }

  // 1. SAMPLER_FAILED, structural. The record itself is unusable as evidence:
  //    unpinned, so no stranger could re-read the book and check it (PRD §6);
  //    or unlabelled, which AGENTS.md calls a bug rather than a sample.
  if (sample.blockHash === ZERO_BLOCK_HASH || sample.source === "UNLABELLED") {
    return "SAMPLER_FAILED";
  }

  // 2. WINDOW_CLOSED. Inclusive at both ends. A reading from outside the window
  //    says nothing about the commitment, so it is not evidence either way.
  if (sample.blockNumber < envelope.start || sample.blockNumber > envelope.end) {
    return "WINDOW_CLOSED";
  }

  // 3. ABSENT. One side pulled or the book empty (PRD §14 "pull one side
  //    entirely"). Checked before spread and depth because an absent side has
  //    no spread to measure — this ordering is what keeps step 5 total.
  //
  //    It is also checked before the crossed-book test below, and that ordering
  //    is load-bearing. A sampler that reads an empty ask side writes ask = 0,
  //    which is arithmetically "crossed" against any positive bid. Testing for
  //    crossed first would classify a pulled side as SAMPLER_FAILED, which is
  //    not a breach — so a maker could pull one side entirely, which is the
  //    misbehaviour PRD §14 runs on purpose, and forfeit nothing.
  if (
    sample.bid === 0n ||
    sample.ask === 0n ||
    sample.bidSize === 0n ||
    sample.askSize === 0n
  ) {
    return "ABSENT";
  }

  // 4. SAMPLER_FAILED, crossed. Both sides are quoted, and the bid is above the
  //    ask: not a book state a venue could produce, so it is our reading that is
  //    wrong, not the maker's quote. Charging a bond for it would be recording a
  //    breach that did not occur (PRD §26 K6).
  if (sample.bid > sample.ask) {
    return "SAMPLER_FAILED";
  }

  // 5. SPREAD_BREACH. The committed bound is absolute, in the book's own price
  //    units, and inclusive: a spread exactly equal to `maxSpread` is within the
  //    envelope (D-011). Comparing raw integers from the same book needs no
  //    scale factor, so no tick size is read here (PRD §17).
  if (absoluteSpread(sample.bid, sample.ask) > envelope.maxSpread) {
    return "SPREAD_BREACH";
  }

  // 6. DEPTH_BREACH. Both sides must carry the committed minimum. A commitment
  //    is to quote a two-sided market, so one thin side breaches it.
  if (sample.bidSize < envelope.minSize || sample.askSize < envelope.minSize) {
    return "DEPTH_BREACH";
  }

  // 7. COVERED_AT_SAMPLE. The envelope held at this instant. WHAT_IS_MEASURED.md:
  //    this is one fact about one instant, and it is not a statement about the
  //    interval before or after it.
  return "COVERED_AT_SAMPLE";
}

/**
 * Whether a verdict forfeits the maker's bond.
 *
 * Only three states are the maker's doing: the quote was too wide, too thin, or
 * not there. The rest are deliberately not breaches:
 *
 *  - `NOT_SAMPLED` is a gap in our measurement, and PRD §6 records gaps rather
 *    than charging anyone for them. PRD §12's griefing row handles the case
 *    where a maker starves the subscription; that is a settlement rule at window
 *    close (Phase P3), not a per-sample verdict.
 *  - `WINDOW_CLOSED` is a reading from outside the commitment. It is not evidence.
 *  - `SAMPLER_FAILED` is our failure, not the maker's. Charging a bond for a
 *    sample we know is unusable would be recording a breach that did not occur,
 *    which is exactly the incident PRD §26 K6 exists to stop.
 *  - `COVERED_AT_SAMPLE` held.
 *
 * Mirrored by `VerdictLib.isBreach`. The switch is exhaustive with no `default`,
 * so adding a state to the enumeration fails the build rather than defaulting to
 * "not a breach" (AGENTS.md hard block).
 */
export function isBreach(state: VerdictState): boolean {
  switch (state) {
    case "SPREAD_BREACH":
    case "DEPTH_BREACH":
    case "ABSENT":
      return true;
    case "NOT_SAMPLED":
    case "SAMPLER_FAILED":
    case "WINDOW_CLOSED":
    case "COVERED_AT_SAMPLE":
      return false;
  }
}
