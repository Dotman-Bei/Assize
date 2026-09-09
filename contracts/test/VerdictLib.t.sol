// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    CommitmentEnvelope, Sample, SampleSource, VerdictLib, VerdictState
} from "../src/VerdictLib.sol";

/// @notice PRD §13 property tests: `verdict()` is total over all sample shapes,
/// including zero size and crossed books.
contract VerdictLibTest is Test {
    bytes32 internal constant PIN = bytes32(uint256(0xabcd));

    function _envelope(uint32 maxSpread, uint128 minSize, uint64 start, uint64 end)
        internal
        pure
        returns (CommitmentEnvelope memory)
    {
        return CommitmentEnvelope({maxSpread: maxSpread, minSize: minSize, start: start, end: end});
    }

    /// @notice Totality. Any inhabitant of the two structs yields a verdict, and
    /// no input reverts. The bound on `source` is the enum's own domain: a value
    /// outside it cannot be constructed on chain, because the ABI decoder rejects
    /// it before any of this runs.
    function testFuzz_verdict_is_total(
        uint32 maxSpread,
        uint128 minSize,
        uint64 start,
        uint64 end,
        uint128 bid,
        uint128 ask,
        uint128 bidSize,
        uint128 askSize,
        uint64 blockNumber,
        bytes32 blockHash,
        uint8 source
    ) public pure {
        Sample memory sample = Sample({
            bid: bid,
            ask: ask,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: blockNumber,
            blockHash: blockHash,
            source: SampleSource(bound(source, 0, 2))
        });
        VerdictState state = VerdictLib.verdict(_envelope(maxSpread, minSize, start, end), sample);
        // Reaching this line at all is the property: the call returned.
        assertLe(uint256(state), uint256(VerdictState.COVERED_AT_SAMPLE));
        // isBreach is total over whatever verdict produced.
        VerdictLib.isBreach(state);
    }

    /// @notice PRD §13 names crossed books explicitly. With both sides quoted, a
    /// crossed book is our reading being wrong, not the maker's quote, so it is
    /// SAMPLER_FAILED and forfeits nothing (PRD §26 K6). A zero side is a
    /// different fact — a pulled side — and is covered by
    /// {testFuzz_zero_side_is_absent_not_sampler_failed}.
    function testFuzz_crossed_book_is_never_coverage(uint128 bid, uint128 ask, uint64 blockNumber)
        public
        pure
    {
        vm.assume(ask > 0);
        vm.assume(bid > ask);
        vm.assume(blockNumber > 0);
        Sample memory sample = Sample({
            bid: bid,
            ask: ask,
            bidSize: type(uint128).max,
            askSize: type(uint128).max,
            blockNumber: blockNumber,
            blockHash: PIN,
            source: SampleSource.REACTIVITY
        });
        VerdictState state =
            VerdictLib.verdict(_envelope(type(uint32).max, 0, 0, type(uint64).max), sample);
        assertEq(uint256(state), uint256(VerdictState.SAMPLER_FAILED));
    }

    /// @notice A maker who pulls one side entirely (PRD §14) must forfeit. The
    /// sampler writes a zero on the pulled side, which is arithmetically crossed
    /// against the remaining side; if the crossed test ran first this would read
    /// as SAMPLER_FAILED, which is not a breach, and the misbehaviour PRD §14
    /// runs on purpose would cost the maker nothing.
    function testFuzz_zero_side_is_absent_not_sampler_failed(uint128 quoted, uint64 blockNumber)
        public
        pure
    {
        vm.assume(quoted > 0);
        vm.assume(blockNumber > 0);
        CommitmentEnvelope memory envelope = _envelope(type(uint32).max, 0, 0, type(uint64).max);

        Sample memory askPulled = Sample({
            bid: quoted,
            ask: 0,
            bidSize: type(uint128).max,
            askSize: type(uint128).max,
            blockNumber: blockNumber,
            blockHash: PIN,
            source: SampleSource.REACTIVITY
        });
        VerdictState state = VerdictLib.verdict(envelope, askPulled);
        assertEq(uint256(state), uint256(VerdictState.ABSENT));
        assertTrue(VerdictLib.isBreach(state), "a pulled side must forfeit the bond");

        Sample memory bidPulled = askPulled;
        bidPulled.bid = 0;
        bidPulled.ask = quoted;
        state = VerdictLib.verdict(envelope, bidPulled);
        assertEq(uint256(state), uint256(VerdictState.ABSENT));
        assertTrue(VerdictLib.isBreach(state), "a pulled side must forfeit the bond");
    }

    /// @notice PRD §13 names zero size explicitly.
    function testFuzz_zero_size_is_absent(uint128 bid, uint128 ask, uint64 blockNumber) public pure {
        vm.assume(bid > 0 && ask > 0 && bid <= ask);
        vm.assume(blockNumber > 0);
        Sample memory sample = Sample({
            bid: bid,
            ask: ask,
            bidSize: 0,
            askSize: 1,
            blockNumber: blockNumber,
            blockHash: PIN,
            source: SampleSource.REACTIVITY
        });
        VerdictState state =
            VerdictLib.verdict(_envelope(type(uint32).max, 0, 0, type(uint64).max), sample);
        assertEq(uint256(state), uint256(VerdictState.ABSENT));
    }

    /// @notice An unlabelled sample is a bug, not a sample (AGENTS.md). It must
    /// never score as coverage, whatever the book looked like.
    function testFuzz_unlabelled_never_covers(uint128 bidSize, uint128 askSize) public pure {
        Sample memory sample = Sample({
            bid: 100,
            ask: 100,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: 50,
            blockHash: PIN,
            source: SampleSource.UNLABELLED
        });
        VerdictState state = VerdictLib.verdict(_envelope(0, 0, 0, type(uint64).max), sample);
        assertEq(uint256(state), uint256(VerdictState.SAMPLER_FAILED));
    }

    /// @notice The committed bound is inclusive, and the arithmetic does not
    /// overflow at the top of the uint128 range.
    function test_spread_bound_is_inclusive() public pure {
        CommitmentEnvelope memory envelope = _envelope(200, 0, 0, type(uint64).max);
        Sample memory atBound = Sample({
            bid: 4950,
            ask: 5050,
            bidSize: 1,
            askSize: 1,
            blockNumber: 1,
            blockHash: PIN,
            source: SampleSource.REACTIVITY
        });
        assertEq(uint256(VerdictLib.verdict(envelope, atBound)), uint256(VerdictState.COVERED_AT_SAMPLE));
        assertEq(VerdictLib.spreadBps(4950, 5050), 200);

        // Widest measurable spread, at the widths' extremes.
        assertEq(VerdictLib.spreadBps(1, type(uint128).max), 19_999);
    }

    /// @notice Only three states forfeit a bond (PRD §26 K6: never record a
    /// breach that did not occur).
    function test_only_maker_faults_are_breaches() public pure {
        assertTrue(VerdictLib.isBreach(VerdictState.SPREAD_BREACH));
        assertTrue(VerdictLib.isBreach(VerdictState.DEPTH_BREACH));
        assertTrue(VerdictLib.isBreach(VerdictState.ABSENT));
        assertFalse(VerdictLib.isBreach(VerdictState.NOT_SAMPLED));
        assertFalse(VerdictLib.isBreach(VerdictState.SAMPLER_FAILED));
        assertFalse(VerdictLib.isBreach(VerdictState.WINDOW_CLOSED));
        assertFalse(VerdictLib.isBreach(VerdictState.COVERED_AT_SAMPLE));
    }
}
