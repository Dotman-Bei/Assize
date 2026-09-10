// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssizeRegistry} from "../src/AssizeRegistry.sol";
import {Sample, SampleSource, VerdictState} from "../src/VerdictLib.sol";

/// @notice PRD §13: access control, invariants, and the state transitions the
/// verifier reads. Phase P1 covers commitment, sample, verdict and breach record.
contract AssizeRegistryTest is Test {
    AssizeRegistry internal registry;

    address internal subscriber = makeAddr("subscriber");
    address internal keeper = makeAddr("keeper");
    address internal maker = makeAddr("maker");
    address internal stranger = makeAddr("stranger");
    address internal deployer = makeAddr("deployer");

    bytes32 internal constant MARKET = keccak256("market-under-test");
    bytes32 internal constant PIN = bytes32(uint256(0xfeed));

    function setUp() public {
        vm.prank(deployer);
        registry = new AssizeRegistry(subscriber);
        vm.deal(maker, 100 ether);
        vm.roll(1000);
    }

    function _sample(uint128 bid, uint128 ask, uint128 bidSize, uint128 askSize, uint64 blockNumber)
        internal
        pure
        returns (Sample memory)
    {
        return Sample({
            bid: bid,
            ask: ask,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: blockNumber,
            blockHash: PIN,
            source: SampleSource.REACTIVITY
        });
    }

    function _publish() internal returns (uint256) {
        vm.prank(maker);
        return registry.publishCommitment{value: 1 ether}(MARKET, 200, 1000, 1000, 2000);
    }

    /* ------------------------------ construction ------------------------- */

    function test_constructor_rejects_zero_subscriber() public {
        vm.expectRevert(AssizeRegistry.ZeroAddress.selector);
        new AssizeRegistry(address(0));
    }

    function test_subscriber_is_immutable_and_owner_is_deployer() public view {
        assertEq(registry.subscriber(), subscriber);
        assertEq(registry.owner(), deployer);
        assertEq(registry.keeper(), address(0));
    }

    /* ------------------------------ commitment --------------------------- */

    function test_publish_stores_the_envelope_and_escrows_the_bond() public {
        uint256 id = _publish();
        AssizeRegistry.Commitment memory c = registry.commitmentAt(id);
        assertEq(c.maker, maker);
        assertEq(c.marketId, MARKET);
        assertEq(c.maxSpread, 200);
        assertEq(c.minSize, 1000);
        assertEq(c.start, 1000);
        assertEq(c.end, 2000);
        assertEq(c.bond, 1 ether);
        assertEq(address(registry).balance, 1 ether);

        (bool found, uint256 activeId) = registry.activeCommitmentOf(maker, MARKET);
        assertTrue(found);
        assertEq(activeId, id);
    }

    function test_publish_requires_a_bond() public {
        vm.prank(maker);
        vm.expectRevert(AssizeRegistry.BondRequired.selector);
        registry.publishCommitment{value: 0}(MARKET, 200, 1000, 1000, 2000);
    }

    /// @dev A backdated window could cover an interval the maker had already
    /// watched go well, leaving the bond exposed to nothing at all.
    function test_publish_rejects_a_backdated_window() public {
        vm.prank(maker);
        vm.expectRevert(
            abi.encodeWithSelector(AssizeRegistry.WindowStartsInThePast.selector, uint64(999), 1000)
        );
        registry.publishCommitment{value: 1 ether}(MARKET, 200, 1000, 999, 2000);
    }

    function test_publish_rejects_an_inverted_window() public {
        vm.prank(maker);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssizeRegistry.WindowEndsBeforeItStarts.selector, uint64(2000), uint64(1999)
            )
        );
        registry.publishCommitment{value: 1 ether}(MARKET, 200, 1000, 2000, 1999);
    }

    /// @notice PRD §10: one active commitment per maker per market.
    function test_publish_rejects_a_second_active_commitment() public {
        uint256 first = _publish();
        vm.prank(maker);
        vm.expectRevert(
            abi.encodeWithSelector(AssizeRegistry.CommitmentAlreadyActive.selector, first)
        );
        registry.publishCommitment{value: 1 ether}(MARKET, 300, 500, 1500, 2500);
    }

    function test_publish_allows_a_new_commitment_once_the_window_closes() public {
        _publish();
        vm.roll(2001);
        vm.prank(maker);
        uint256 second = registry.publishCommitment{value: 2 ether}(MARKET, 300, 500, 2100, 3000);
        (, uint256 activeId) = registry.activeCommitmentOf(maker, MARKET);
        assertEq(activeId, second);
        // PRD §13 invariant: bond conservation. Both bonds are still held.
        assertEq(address(registry).balance, 3 ether);
    }

    function test_two_makers_may_cover_the_same_market() public {
        _publish();
        address other = makeAddr("other-maker");
        vm.deal(other, 10 ether);
        vm.prank(other);
        registry.publishCommitment{value: 1 ether}(MARKET, 200, 1000, 1000, 2000);
        assertEq(registry.commitmentCount(), 2);
        assertEq(address(registry).balance, 2 ether);
    }

    /* ------------------------------ access control ----------------------- */

    /// @notice PRD §12, spoofed-callback row: nothing but the sampler writes.
    function test_recordSample_rejects_every_other_caller() public {
        uint256 id = _publish();
        Sample memory s = _sample(4990, 5010, 5000, 5000, 1500);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotSampler.selector, stranger));
        registry.recordSample(id, s);

        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotSampler.selector, maker));
        registry.recordSample(id, s);

        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotSampler.selector, deployer));
        registry.recordSample(id, s);

        // An unregistered keeper is just another stranger.
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotSampler.selector, keeper));
        registry.recordSample(id, s);
    }

    function test_registered_keeper_may_sample_and_only_owner_may_register() public {
        uint256 id = _publish();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotOwner.selector, stranger));
        registry.registerKeeper(keeper);

        vm.prank(deployer);
        registry.registerKeeper(keeper);
        assertEq(registry.keeper(), keeper);

        vm.prank(keeper);
        (, VerdictState state) = registry.recordSample(id, _sample(4990, 5010, 5000, 5000, 1500));
        assertEq(uint256(state), uint256(VerdictState.COVERED_AT_SAMPLE));
    }

    /// @dev Registering the zero address is how the fallback path is switched off.
    function test_owner_can_disable_the_keeper() public {
        vm.startPrank(deployer);
        registry.registerKeeper(keeper);
        registry.registerKeeper(address(0));
        vm.stopPrank();

        uint256 id = _publish();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotSampler.selector, keeper));
        registry.recordSample(id, _sample(4990, 5010, 5000, 5000, 1500));
    }

    /* ------------------------------ sample validation -------------------- */

    function test_recordSample_rejects_an_unpinned_sample() public {
        uint256 id = _publish();
        Sample memory noBlock = _sample(4990, 5010, 5000, 5000, 0);
        vm.prank(subscriber);
        vm.expectRevert(AssizeRegistry.SampleNotPinned.selector);
        registry.recordSample(id, noBlock);

        Sample memory noHash = _sample(4990, 5010, 5000, 5000, 1500);
        noHash.blockHash = bytes32(0);
        vm.prank(subscriber);
        vm.expectRevert(AssizeRegistry.SampleNotPinned.selector);
        registry.recordSample(id, noHash);
    }

    function test_recordSample_rejects_an_unlabelled_sample() public {
        uint256 id = _publish();
        Sample memory s = _sample(4990, 5010, 5000, 5000, 1500);
        s.source = SampleSource.UNLABELLED;
        vm.prank(subscriber);
        vm.expectRevert(AssizeRegistry.SampleNotLabelled.selector);
        registry.recordSample(id, s);
    }

    function test_recordSample_rejects_an_unknown_commitment() public {
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NoSuchCommitment.selector, 7));
        registry.recordSample(7, _sample(4990, 5010, 5000, 5000, 1500));
    }

    /// @dev A crossed book is a real reading. It is stored and classified where a
    /// verifier can see it, rather than dropped.
    function test_crossed_book_is_stored_and_is_not_a_breach() public {
        uint256 id = _publish();
        vm.prank(subscriber);
        (uint256 sampleId, VerdictState state) =
            registry.recordSample(id, _sample(5100, 4900, 5000, 5000, 1500));
        assertEq(uint256(state), uint256(VerdictState.SAMPLER_FAILED));
        assertEq(registry.sampleCount(), 1);
        // PRD §26 K6: our failure is never charged to the maker.
        assertEq(registry.breachCount(), 0);
        (bool forfeited,) = registry.forfeitureOf(id);
        assertFalse(forfeited);
        assertEq(uint256(registry.verdictOf(sampleId)), uint256(VerdictState.SAMPLER_FAILED));
    }

    /* ------------------------------ verdict and breach ------------------- */

    function test_verdictOf_is_re_derived_from_storage() public {
        uint256 id = _publish();
        vm.prank(subscriber);
        (uint256 sampleId,) = registry.recordSample(id, _sample(4990, 5010, 5000, 5000, 1500));
        assertEq(uint256(registry.verdictOf(sampleId)), uint256(VerdictState.COVERED_AT_SAMPLE));

        AssizeRegistry.SampleRecord memory stored = registry.sampleAt(sampleId);
        assertEq(stored.commitmentId, id);
        assertEq(stored.sample.blockHash, PIN);
        assertEq(uint256(stored.sample.source), uint256(SampleSource.REACTIVITY));
    }

    /// @dev An unknown id reads a zeroed slot, which is `NOT_SAMPLED`: no sample
    /// by that id was observed. PRD §6: gaps are recorded, never smoothed over.
    function test_unknown_sample_is_not_sampled() public view {
        assertEq(uint256(registry.verdictOf(123_456)), uint256(VerdictState.NOT_SAMPLED));
    }

    function test_spread_breach_is_recorded_and_forfeits_the_bond_once() public {
        uint256 id = _publish();

        vm.prank(subscriber);
        (uint256 firstSample, VerdictState first) =
            registry.recordSample(id, _sample(1000, 9000, 5000, 5000, 1500));
        assertEq(uint256(first), uint256(VerdictState.SPREAD_BREACH));
        assertEq(registry.breachCount(), 1);

        AssizeRegistry.Breach memory breach = registry.breachAt(0);
        assertEq(breach.commitmentId, id);
        assertEq(breach.sampleId, firstSample);

        (bool forfeited, uint256 breachId) = registry.forfeitureOf(id);
        assertTrue(forfeited);
        assertEq(breachId, 0);

        // A second breach is still recorded as evidence, but forfeits nothing new.
        vm.prank(subscriber);
        registry.recordSample(id, _sample(4990, 5010, 1, 1, 1600));
        assertEq(registry.breachCount(), 2);
        (, uint256 stillFirst) = registry.forfeitureOf(id);
        assertEq(stillFirst, 0);

        // PRD §13 invariant: no bond leaves the contract in Phase P1.
        assertEq(address(registry).balance, 1 ether);
    }

    function test_out_of_window_sample_is_recorded_but_is_not_a_breach() public {
        uint256 id = _publish();
        vm.prank(subscriber);
        (, VerdictState state) = registry.recordSample(id, _sample(1000, 9000, 1, 1, 2001));
        assertEq(uint256(state), uint256(VerdictState.WINDOW_CLOSED));
        assertEq(registry.sampleCount(), 1);
        assertEq(registry.breachCount(), 0);
    }

    function test_depth_breach_is_recorded() public {
        uint256 id = _publish();
        vm.prank(subscriber);
        (, VerdictState state) = registry.recordSample(id, _sample(4990, 5010, 999, 5000, 1500));
        assertEq(uint256(state), uint256(VerdictState.DEPTH_BREACH));
        assertEq(registry.breachCount(), 1);
    }

    function test_absent_side_is_recorded_as_a_breach() public {
        uint256 id = _publish();
        vm.prank(subscriber);
        (, VerdictState state) = registry.recordSample(id, _sample(0, 5010, 5000, 5000, 1500));
        assertEq(uint256(state), uint256(VerdictState.ABSENT));
        assertEq(registry.breachCount(), 1);
    }

    /* ------------------------------ phase boundary ----------------------- */

    /// @notice Phase P1 has no settlement path, by design (docs/phase.md lists
    /// payouts as out of scope; DECISIONS.md D-006). This test states that as a
    /// fact about the current contract so that the deferral is visible rather
    /// than implied, and it is expected to be replaced in Phase P3.
    function test_no_settlement_path_exists_in_phase_p1() public {
        uint256 id = _publish();
        vm.prank(subscriber);
        registry.recordSample(id, _sample(1000, 9000, 5000, 5000, 1500));
        (bool forfeited,) = registry.forfeitureOf(id);
        assertTrue(forfeited);

        // The bond is recorded as forfeited and stays escrowed: nothing in this
        // contract can move it, including the owner.
        assertEq(address(registry).balance, 1 ether);
        vm.prank(deployer);
        (bool ok,) = address(registry).call(abi.encodeWithSignature("claim(uint256)", uint256(0)));
        assertFalse(ok, "claim() is Phase P3 and must not exist yet");
    }
}
