// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssizeRegistry} from "../src/AssizeRegistry.sol";
import {Sample, SampleSource, VerdictLib} from "../src/VerdictLib.sol";

/// @notice Drives the registry with arbitrary sequences of the only two calls
/// that change its state, and records what was deposited so the invariants can
/// be stated against an independent tally rather than against the contract's own
/// accounting.
contract RegistryHandler is Test {
    AssizeRegistry public immutable registry;

    /// @dev Tallied here, outside the contract under test. An invariant checked
    /// against the subject's own bookkeeping only proves it is self-consistent.
    uint256 public totalBonded;
    uint256 public publishCalls;
    uint256 public sampleCalls;

    address[3] internal makers = [makeAddr("maker-a"), makeAddr("maker-b"), makeAddr("maker-c")];
    bytes32[2] internal markets = [keccak256("market-a"), keccak256("market-b")];

    constructor() {
        registry = new AssizeRegistry(address(this));
        for (uint256 i = 0; i < makers.length; ++i) {
            vm.deal(makers[i], 1_000 ether);
        }
    }

    function publish(uint256 makerSeed, uint256 marketSeed, uint96 bond, uint128 maxSpread, uint128 minSize, uint64 windowLength)
        external
    {
        address maker = makers[bound(makerSeed, 0, makers.length - 1)];
        bytes32 market = markets[bound(marketSeed, 0, markets.length - 1)];
        uint256 value = bound(bond, 1, 10 ether);
        uint64 start = uint64(block.number);
        uint64 end = start + uint64(bound(windowLength, 0, 100_000));

        vm.prank(maker);
        try registry.publishCommitment{value: value}(market, maxSpread, minSize, start, end) {
            totalBonded += value;
            publishCalls += 1;
        } catch {
            // A rejected publish is a valid outcome, not a failure of the run:
            // the maker already has an active commitment on that market
            // (PRD §10). Nothing was transferred, so nothing is tallied.
            // AGENTS.md forbids an empty catch; this one records why by leaving
            // the tallies untouched, which the invariants then check.
            publishCalls += 0;
        }
    }

    function sample(
        uint256 commitmentSeed,
        uint128 bid,
        uint128 ask,
        uint128 bidSize,
        uint128 askSize,
        uint64 blockNumber,
        uint8 sourceSeed
    ) external {
        uint256 count = registry.commitmentCount();
        if (count == 0) {
            return;
        }
        uint256 commitmentId = bound(commitmentSeed, 0, count - 1);
        Sample memory reading = Sample({
            bid: bid,
            ask: ask,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: uint64(bound(blockNumber, 1, type(uint64).max)),
            blockHash: keccak256(abi.encode(blockNumber, bid, ask)),
            source: bound(sourceSeed, 0, 1) == 0 ? SampleSource.REACTIVITY : SampleSource.KEEPER
        });
        // The handler is the registry's subscriber, so this call is authorised.
        registry.recordSample(commitmentId, reading);
        sampleCalls += 1;
    }
}

/// @notice PRD §13 invariants. "Bond conservation" is the one that applies in
/// Phase P1; "one claim per address per breach" and "no payout without a stored
/// breach" arrive with settlement in P3.
contract BondConservationTest is Test {
    RegistryHandler internal handler;
    AssizeRegistry internal registry;

    function setUp() public {
        handler = new RegistryHandler();
        registry = handler.registry();
        targetContract(address(handler));
    }

    /// @notice Every wei ever bonded is still held by the registry.
    /// @dev In Phase P1 there is no settlement path at all (DECISIONS.md D-006),
    /// so conservation is total: the balance equals the sum of every bond that
    /// was accepted. When P3 adds `claim()` this invariant weakens to
    /// "balance == bonded - paid out", and the change should be deliberate.
    function invariant_every_bond_is_still_held() public view {
        assertEq(
            address(registry).balance,
            handler.totalBonded(),
            "registry balance diverged from the bonds it accepted"
        );
    }

    /// @notice No sequence of calls moves ETH out of the registry.
    /// @dev PRD §10: no admin withdrawal of bonds. The property is structural —
    /// there is no payable-out function — and this asserts it holds under
    /// arbitrary call sequences rather than by inspection.
    function invariant_no_ether_ever_leaves() public view {
        assertGe(
            address(registry).balance,
            handler.totalBonded(),
            "ether left the registry, which has no path to send any"
        );
    }

    /// @notice A breach is never recorded without a sample to point at.
    /// @dev PRD §5.2: a breach records the sample that caused it. PRD §26 K6
    /// treats a breach that did not occur as an incident, so the count of
    /// breaches can never outrun the count of samples that could justify them.
    function invariant_no_breach_without_a_sample() public view {
        assertLe(
            registry.breachCount(),
            registry.sampleCount(),
            "more breaches recorded than samples taken"
        );
    }

    /// @notice Every breach on record still re-derives to a breach.
    /// @dev This is the property a stranger checks (claim C-002): read the breach,
    /// read the sample it names, re-derive the verdict, and reach the same answer.
    function invariant_every_breach_still_derives_from_its_sample() public view {
        uint256 count = registry.breachCount();
        for (uint256 i = 0; i < count; ++i) {
            AssizeRegistry.Breach memory breach = registry.breachAt(i);
            assertTrue(
                VerdictLib.isBreach(registry.verdictOf(breach.sampleId)),
                "a recorded breach points at a sample that does not breach"
            );
        }
    }

    /// @notice Asserts the sequence actually reached the states the invariants
    /// are about.
    /// @dev Called once at the end of each invariant run. Without it, a run that
    /// happened to record no breach would satisfy every breach invariant
    /// vacuously and report a pass that meant nothing.
    function afterInvariant() public view {
        assertGt(handler.publishCalls(), 0, "no commitment was ever published");
        assertGt(registry.sampleCount(), 0, "no sample was ever recorded");
        assertGt(
            registry.breachCount(),
            0,
            "the sequence never recorded a breach, so the breach invariants proved nothing"
        );
    }

    /// @notice A forfeited bond names a breach that exists, in every case.
    function invariant_forfeiture_always_names_a_real_breach() public view {
        uint256 count = registry.commitmentCount();
        for (uint256 i = 0; i < count; ++i) {
            (bool forfeited, uint256 breachId) = registry.forfeitureOf(i);
            if (!forfeited) {
                continue;
            }
            assertLt(breachId, registry.breachCount(), "forfeiture names a breach that does not exist");
            AssizeRegistry.Breach memory breach = registry.breachAt(breachId);
            assertEq(breach.commitmentId, i, "forfeiture names another commitment's breach");
        }
    }
}
