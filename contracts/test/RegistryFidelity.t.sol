// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssizeRegistry} from "../src/AssizeRegistry.sol";
import {
    CommitmentEnvelope, Sample, SampleSource, VerdictLib, VerdictState
} from "../src/VerdictLib.sol";

/// @notice Storage round-trip fidelity.
///
/// @dev G2 (`pnpm test:differential`) proves `VerdictLib` agrees with
/// `packages/reference` over 10,000 pairs. It calls the library directly with
/// values held in memory. The registry does something G2 never exercises: it
/// writes a sample into packed storage, then re-derives the verdict by reading
/// that storage back through {AssizeRegistry.verdictOf}.
///
/// A truncation, a mis-ordered struct field or a lost enum value in that
/// round-trip would leave G2 green while the deployed path disagreed with the
/// evaluator both implementations were checked against. These tests close that
/// gap, so the chain of trust runs unbroken:
///
///     packages/reference  ==(G2)==  VerdictLib  ==(here)==  what the registry stores
///
/// PRD §5.2 requires the verdict be computable from a stored sample and a stored
/// commitment. This is the test that the stored versions are the ones that were
/// handed in.
contract RegistryFidelityTest is Test {
    AssizeRegistry internal registry;

    address internal subscriber = makeAddr("subscriber");
    address internal maker = makeAddr("maker");
    bytes32 internal constant MARKET = keccak256("market-under-test");

    /// @dev Fuzz inputs arrive as one struct rather than eleven parameters: the
    /// evaluator reads every field of both structures, so a test that names them
    /// all individually exhausts the stack before it can call anything.
    struct FuzzInput {
        uint128 maxSpread;
        uint128 minSize;
        uint64 start;
        uint64 windowLength;
        uint128 bid;
        uint128 ask;
        uint128 bidSize;
        uint128 askSize;
        uint64 blockNumber;
        bytes32 blockHash;
        uint8 sourceSeed;
    }

    function setUp() public {
        registry = new AssizeRegistry(subscriber);
        vm.deal(maker, 1_000 ether);
        vm.roll(1);
    }

    /// @notice A sample written through the registry re-derives to exactly the
    /// verdict the evaluator gives for the same inputs held in memory.
    function testFuzz_stored_verdict_matches_the_evaluator(FuzzInput memory input) public {
        CommitmentEnvelope memory envelope = _publishableEnvelope(input);
        Sample memory sample = _writableSample(input);

        vm.prank(maker);
        uint256 commitmentId = registry.publishCommitment{value: 1 wei}(
            MARKET, envelope.maxSpread, envelope.minSize, envelope.start, envelope.end
        );

        vm.prank(subscriber);
        (uint256 sampleId, VerdictState returned) = registry.recordSample(commitmentId, sample);

        VerdictState expected = VerdictLib.verdict(envelope, sample);

        // The value recordSample returned.
        assertEq(uint256(returned), uint256(expected), "returned verdict differs from evaluator");
        // The value re-derived from storage afterwards, which is what a verifier
        // reads and what PRD §10 requires verdictOf to mirror.
        assertEq(
            uint256(registry.verdictOf(sampleId)),
            uint256(expected),
            "verdict re-derived from storage differs from evaluator"
        );
    }

    /// @dev publishCommitment refuses a backdated or inverted window, so the
    /// envelope is bound to a publishable one. The sample's own block number is
    /// left alone, which is what lets WINDOW_CLOSED still occur.
    ///
    /// `minSize` is drawn from the range the sample's own sizes occupy rather
    /// than from the whole uint128 space. Drawn uniformly, a random minSize sits
    /// astronomically far from a random size, so the depth comparison lands the
    /// same way on both sides of any corruption and the test stops discriminating.
    /// Injecting a truncation of `bidSize` demonstrated exactly that: this test
    /// passed through it while {testFuzz_stored_sample_is_byte_for_byte_what_was_written}
    /// caught it. The two are complementary — one checks the fields survive
    /// storage, the other checks the derivation reads what survived — and this
    /// binding is what stops the second from being vacuous.
    function _publishableEnvelope(FuzzInput memory input)
        private
        view
        returns (CommitmentEnvelope memory)
    {
        uint64 start = uint64(bound(input.start, block.number, type(uint64).max / 2));
        uint64 end = uint64(bound(input.windowLength, 0, type(uint64).max / 2)) + start;
        uint128 largerSide = input.bidSize > input.askSize ? input.bidSize : input.askSize;
        uint128 minSize = uint128(
            bound(input.minSize, 0, largerSide == type(uint128).max ? largerSide : largerSide + 1)
        );
        return CommitmentEnvelope({
            maxSpread: input.maxSpread,
            minSize: minSize,
            start: start,
            end: end
        });
    }

    /// @dev The registry's write guards require a pinned, labelled sample
    /// (PRD §6, AGENTS.md). Shapes it rejects are covered by the unit tests in
    /// AssizeRegistry.t.sol; this test is about what it accepts.
    function _writableSample(FuzzInput memory input) private pure returns (Sample memory) {
        return Sample({
            bid: input.bid,
            ask: input.ask,
            bidSize: input.bidSize,
            askSize: input.askSize,
            blockNumber: uint64(bound(input.blockNumber, 1, type(uint64).max)),
            blockHash: input.blockHash == bytes32(0) ? bytes32(uint256(1)) : input.blockHash,
            source: bound(input.sourceSeed, 0, 1) == 0 ? SampleSource.REACTIVITY : SampleSource.KEEPER
        });
    }

    /// @notice The same fidelity property, on a book that holds together.
    ///
    /// @dev {testFuzz_stored_verdict_matches_the_evaluator} draws bid and ask
    /// independently across the whole uint128 range. Roughly half of those cross,
    /// and most of the rest are wider than any committed spread, so the ladder
    /// stops at SAMPLER_FAILED or SPREAD_BREACH and the depth comparison is
    /// almost never reached. That makes the broad test excellent at shape
    /// coverage and blind to anything below rung 6.
    ///
    /// This one builds the book from a mid and a half-spread, so bid <= ask by
    /// construction and the spread lands in a range a real commitment might
    /// cover. The verdict then turns on the envelope comparisons the broad test
    /// skips past. Injecting a truncation of a stored size fails here and passes
    /// there, which is why both exist.
    function testFuzz_stored_verdict_matches_the_evaluator_on_a_coherent_book(
        FuzzInput memory input
    ) public {
        uint128 mid = uint128(bound(input.bid, 1, type(uint128).max / 2));
        uint128 halfSpread = uint128(bound(input.ask, 0, mid));
        uint128 bidSize = uint128(bound(input.bidSize, 0, 1_000_000));
        uint128 askSize = uint128(bound(input.askSize, 0, 1_000_000));
        uint128 largerSide = bidSize > askSize ? bidSize : askSize;

        CommitmentEnvelope memory envelope = CommitmentEnvelope({
            // Bound around the sample's own spread, so the committed bound
            // straddles it and the comparison is actually exercised.
            maxSpread: uint128(bound(input.maxSpread, 0, uint256(halfSpread) * 2 + 2)),
            minSize: uint128(bound(input.minSize, 0, largerSide + 1)),
            start: 1,
            end: 1_000_000
        });
        Sample memory sample = Sample({
            bid: mid - halfSpread,
            ask: mid + halfSpread,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: uint64(bound(input.blockNumber, 1, 1_000_000)),
            blockHash: input.blockHash == bytes32(0) ? bytes32(uint256(1)) : input.blockHash,
            source: bound(input.sourceSeed, 0, 1) == 0 ? SampleSource.REACTIVITY : SampleSource.KEEPER
        });

        vm.prank(maker);
        uint256 commitmentId = registry.publishCommitment{value: 1 wei}(
            MARKET, envelope.maxSpread, envelope.minSize, envelope.start, envelope.end
        );
        vm.prank(subscriber);
        (uint256 sampleId, VerdictState returned) = registry.recordSample(commitmentId, sample);

        VerdictState expected = VerdictLib.verdict(envelope, sample);
        assertEq(uint256(returned), uint256(expected), "returned verdict differs from evaluator");
        assertEq(
            uint256(registry.verdictOf(sampleId)),
            uint256(expected),
            "verdict re-derived from storage differs from evaluator"
        );
    }

    /// @notice Every field of a stored sample is the field that was handed in.
    /// @dev A verdict that matched while a field was corrupted would be a verdict
    /// that happened to agree, not a verdict derived from the sample on chain.
    function testFuzz_stored_sample_is_byte_for_byte_what_was_written(
        uint128 bid,
        uint128 ask,
        uint128 bidSize,
        uint128 askSize,
        uint64 blockNumber,
        bytes32 blockHash,
        uint8 sourceSeed
    ) public {
        blockNumber = uint64(bound(blockNumber, 1, type(uint64).max));
        if (blockHash == bytes32(0)) {
            blockHash = bytes32(uint256(1));
        }
        SampleSource source =
            bound(sourceSeed, 0, 1) == 0 ? SampleSource.REACTIVITY : SampleSource.KEEPER;

        vm.prank(maker);
        uint256 commitmentId = registry.publishCommitment{value: 1 wei}(MARKET, 200, 1000, 1, 1000);

        Sample memory sample = Sample({
            bid: bid,
            ask: ask,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: blockNumber,
            blockHash: blockHash,
            source: source
        });
        vm.prank(subscriber);
        (uint256 sampleId,) = registry.recordSample(commitmentId, sample);

        AssizeRegistry.SampleRecord memory stored = registry.sampleAt(sampleId);
        assertEq(stored.commitmentId, commitmentId, "commitmentId");
        assertEq(stored.sample.bid, bid, "bid");
        assertEq(stored.sample.ask, ask, "ask");
        assertEq(stored.sample.bidSize, bidSize, "bidSize");
        assertEq(stored.sample.askSize, askSize, "askSize");
        assertEq(stored.sample.blockNumber, blockNumber, "blockNumber");
        assertEq(stored.sample.blockHash, blockHash, "blockHash");
        assertEq(uint256(stored.sample.source), uint256(source), "source label");
    }

    /// @notice The stored envelope is the one that was published.
    function testFuzz_stored_envelope_is_what_was_published(
        uint128 maxSpread,
        uint128 minSize,
        uint64 start,
        uint64 windowLength
    ) public {
        start = uint64(bound(start, block.number, type(uint64).max / 2));
        uint64 end = uint64(bound(windowLength, 0, type(uint64).max / 2)) + start;

        vm.prank(maker);
        uint256 commitmentId =
            registry.publishCommitment{value: 1 wei}(MARKET, maxSpread, minSize, start, end);

        AssizeRegistry.Commitment memory stored = registry.commitmentAt(commitmentId);
        assertEq(stored.maxSpread, maxSpread, "maxSpread");
        assertEq(stored.minSize, minSize, "minSize");
        assertEq(stored.start, start, "start");
        assertEq(stored.end, end, "end");
        assertEq(stored.maker, maker, "maker");
        assertEq(stored.marketId, MARKET, "marketId");
        assertEq(stored.bond, 1 wei, "bond");
    }

    /// @notice A breach record points at the sample that caused it, and that
    /// sample still re-derives to a breach (PRD §5.2).
    function testFuzz_breach_record_points_at_a_sample_that_still_breaches(
        uint128 bid,
        uint128 ask,
        uint128 bidSize,
        uint128 askSize
    ) public {
        vm.prank(maker);
        uint256 commitmentId = registry.publishCommitment{value: 1 ether}(MARKET, 200, 1000, 1, 1000);

        Sample memory sample = Sample({
            bid: bid,
            ask: ask,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: 500,
            blockHash: bytes32(uint256(0xfeed)),
            source: SampleSource.REACTIVITY
        });
        vm.prank(subscriber);
        (uint256 sampleId, VerdictState state) = registry.recordSample(commitmentId, sample);

        (bool forfeited, uint256 forfeitedAt) = registry.forfeitureOf(commitmentId);
        if (!VerdictLib.isBreach(state)) {
            // No breach, so nothing may have been recorded and no bond forfeited.
            assertEq(registry.breachCount(), 0, "recorded a breach that did not occur");
            assertFalse(forfeited, "forfeited a bond without a breach");
            return;
        }

        assertEq(registry.breachCount(), 1, "a breach occurred but none was recorded");
        AssizeRegistry.Breach memory breach = registry.breachAt(0);
        assertEq(breach.sampleId, sampleId, "breach points at the wrong sample");
        assertEq(breach.commitmentId, commitmentId, "breach points at the wrong commitment");
        // PRD §5.2: the breach records the sample that caused it. Re-deriving
        // that sample must still produce a breach, or the record is not evidence.
        assertTrue(
            VerdictLib.isBreach(registry.verdictOf(breach.sampleId)),
            "breach record points at a sample that does not breach"
        );
        assertTrue(forfeited, "a breach was recorded but no bond forfeited");
        assertEq(forfeitedAt, 0, "forfeiture points at the wrong breach");
    }
}
