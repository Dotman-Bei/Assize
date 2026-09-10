// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Raised when {VerdictLib.isBreach} meets a state outside the seven in
/// {VerdictState}. Unreachable today; it exists so that adding a state cannot be
/// scored as "no breach" by default (AGENTS.md hard block on swallowing defaults).
error UnenumeratedVerdictState(uint8 state);

/// @notice PRD §8.2: how a sample arrived. `UNLABELLED` is the zero value, not a
/// third path. AGENTS.md: "A sample without a source label is a bug, not a sample."
enum SampleSource {
    UNLABELLED,
    REACTIVITY,
    KEEPER
}

/// @notice PRD §5.2: the seven verdict states, and no others. `COVERED_AT_SAMPLE`
/// is the strongest positive state that exists, and PRD §5.2 defines no stronger
/// one. Declaration order is close to the evaluator's precedence order
/// (DECISIONS.md D-004), and `NOT_SAMPLED` is 0 so an unwritten slot reads as an
/// absence of observation rather than as a positive result.
enum VerdictState {
    NOT_SAMPLED,
    SAMPLER_FAILED,
    WINDOW_CLOSED,
    ABSENT,
    SPREAD_BREACH,
    DEPTH_BREACH,
    COVERED_AT_SAMPLE
}

/// @notice PRD §5.2 fixes this field set exactly. PRD §0.3 forbids inventing a
/// struct layout or a field name, so nothing is added — notably no timestamp,
/// which is why a window is expressed in block numbers (DECISIONS.md D-003).
/// @dev Prices and sizes are raw integers in the book's own units. Assize never
/// converts them, because a conversion needs a tick size and PRD §17 forbids
/// compiling one in. The spread test is a ratio, so it is scale-invariant.
struct Sample {
    uint128 bid;
    uint128 ask;
    uint128 bidSize;
    uint128 askSize;
    uint64 blockNumber;
    bytes32 blockHash;
    SampleSource source;
}

/// @notice The verdict-relevant half of a commitment (PRD §10).
/// @dev `maxSpread` is the widest tolerated `ask - bid`, in the book's own raw
/// price units — an absolute bound, not a ratio (DECISIONS.md D-011). `minSize`
/// is in the book's size units and applies to each side; `start` and `end` are
/// block numbers, inclusive.
struct CommitmentEnvelope {
    uint128 maxSpread;
    uint128 minSize;
    uint64 start;
    uint64 end;
}

/// @title VerdictLib
/// @notice The envelope evaluator. PRD §5.2: pure, total, enumerated.
/// @dev `packages/reference` is a second implementation of this function. CI runs
/// both over the same generated inputs and fails on any divergence (PRD §22 G2).
/// Neither is the authority; agreement between them is. Any edit here without the
/// matching edit there is caught by `pnpm test:differential`.
library VerdictLib {
    /// @notice The spread of a sample, in the book's own raw price units.
    /// @dev DECISIONS.md D-011: the committed bound is absolute rather than a
    /// ratio of mid. Both the sample's prices and the commitment's `maxSpread`
    /// are raw integers from the same book, so the comparison needs no scale
    /// factor and no tick size — which is what keeps PRD §17 satisfied.
    /// Rendering this in basis points for a reader needs the market's
    /// `oneCollateral`, which is not stored on a sample; that conversion is
    /// therefore done off chain, outside the evaluator (see `spreadBps` in
    /// packages/reference).
    /// Precondition: `bid <= ask`, established by evaluating ABSENT and the
    /// crossed-book test first in {verdict}. That ordering is what keeps the
    /// subtraction from underflowing.
    function absoluteSpread(uint128 bid, uint128 ask) internal pure returns (uint256) {
        return uint256(ask) - uint256(bid);
    }

    /// @notice PRD §5.2: verdict(commitment, sample). Reads a stored envelope and a
    /// stored sample and nothing else. PRD §12: never computed from maker input.
    /// @dev Total over every inhabitant of the two structs. There is no `default`
    /// that swallows an unknown shape (AGENTS.md hard block) because the function
    /// is a precedence ladder ending in an unconditional return.
    function verdict(CommitmentEnvelope memory envelope, Sample memory sample)
        internal
        pure
        returns (VerdictState)
    {
        // 0. NOT_SAMPLED. A zeroed slot is the absence of an observation, not a
        //    result. PRD §6: gaps are recorded, never smoothed over.
        if (sample.blockNumber == 0) {
            return VerdictState.NOT_SAMPLED;
        }

        // 1. SAMPLER_FAILED, structural. The record itself is unusable as
        //    evidence: unpinned, so no stranger could re-read the book and check
        //    it (PRD §6), or unlabelled, which AGENTS.md calls a bug.
        if (sample.blockHash == bytes32(0) || sample.source == SampleSource.UNLABELLED) {
            return VerdictState.SAMPLER_FAILED;
        }

        // 2. WINDOW_CLOSED. Inclusive at both ends. A reading from outside the
        //    window is not evidence about the commitment either way.
        if (sample.blockNumber < envelope.start || sample.blockNumber > envelope.end) {
            return VerdictState.WINDOW_CLOSED;
        }

        // 3. ABSENT. One side pulled or the book empty (PRD §14). Checked before
        //    spread and depth because an absent side has no spread to measure —
        //    this ordering is what keeps step 5 total.
        //
        //    It is also checked before the crossed test below, and that ordering
        //    is load-bearing. A sampler reading an empty ask side writes ask = 0,
        //    which is arithmetically "crossed" against any positive bid. Testing
        //    crossed first would classify a pulled side as SAMPLER_FAILED, which
        //    is not a breach — so a maker could pull one side entirely, the
        //    misbehaviour PRD §14 runs on purpose, and forfeit nothing.
        if (sample.bid == 0 || sample.ask == 0 || sample.bidSize == 0 || sample.askSize == 0) {
            return VerdictState.ABSENT;
        }

        // 4. SAMPLER_FAILED, crossed. Both sides quoted and the bid above the
        //    ask: not a book state a venue could produce, so our reading is
        //    wrong rather than the maker's quote. Charging a bond for it would
        //    record a breach that did not occur (PRD §26 K6).
        if (sample.bid > sample.ask) {
            return VerdictState.SAMPLER_FAILED;
        }

        // 5. SPREAD_BREACH. The committed bound is absolute, in the book's own
        //    price units, and inclusive: a spread exactly equal to `maxSpread`
        //    is inside the envelope (D-011).
        if (absoluteSpread(sample.bid, sample.ask) > uint256(envelope.maxSpread)) {
            return VerdictState.SPREAD_BREACH;
        }

        // 6. DEPTH_BREACH. Both sides must carry the committed minimum: a
        //    commitment is to quote a two-sided market, so one thin side breaches.
        if (sample.bidSize < envelope.minSize || sample.askSize < envelope.minSize) {
            return VerdictState.DEPTH_BREACH;
        }

        // 7. COVERED_AT_SAMPLE. The envelope held at this instant, and nothing
        //    more. WHAT_IS_MEASURED.md: one sample is one fact about one instant.
        return VerdictState.COVERED_AT_SAMPLE;
    }

    /// @notice Whether a verdict forfeits the maker's bond.
    /// @dev Only three states are the maker's doing: too wide, too thin, or not
    /// there. The others are deliberately not breaches. `NOT_SAMPLED` is a gap in
    /// our measurement and PRD §6 records gaps rather than charging for them.
    /// `WINDOW_CLOSED` is not evidence about the commitment. `SAMPLER_FAILED` is
    /// our failure, and charging a bond for a sample we know is unusable would be
    /// recording a breach that did not occur — the incident PRD §26 K6 exists to
    /// stop. Mirrored by `isBreach` in `packages/reference` and compared by G2.
    /// @dev Every state is listed explicitly. There is no `else` fallthrough, so
    /// adding a state to the enum surfaces here instead of silently reading as
    /// "not a breach" (AGENTS.md hard block).
    function isBreach(VerdictState state) internal pure returns (bool) {
        if (state == VerdictState.SPREAD_BREACH) return true;
        if (state == VerdictState.DEPTH_BREACH) return true;
        if (state == VerdictState.ABSENT) return true;
        if (state == VerdictState.NOT_SAMPLED) return false;
        if (state == VerdictState.SAMPLER_FAILED) return false;
        if (state == VerdictState.WINDOW_CLOSED) return false;
        if (state == VerdictState.COVERED_AT_SAMPLE) return false;
        // Unreachable while VerdictState has exactly the seven members above.
        // Reverting rather than returning false keeps a new state from being
        // scored as "no breach" by accident.
        revert UnenumeratedVerdictState(uint8(state));
    }
}
