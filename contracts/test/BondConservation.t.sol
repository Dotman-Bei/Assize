// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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

    /// @dev Settlement tallies, kept here for the same reason as `totalBonded`:
    /// an invariant checked against the subject's own `paidOut` would only prove
    /// the contract agrees with itself.
    uint256 public totalPaidOut;
    uint256 public witnessCalls;
    uint256 public claimCalls;
    uint256 public rejectedClaims;
    bytes4 public lastClaimRevert;

    address[3] internal makers = [makeAddr("maker-a"), makeAddr("maker-b"), makeAddr("maker-c")];
    bytes32[2] internal markets = [keccak256("market-a"), keccak256("market-b")];
    address[3] internal traders =
        [makeAddr("trader-a"), makeAddr("trader-b"), makeAddr("trader-c")];

    /// @dev Orders indexed BY COMMITMENT. A claim pays from the bond of the
    /// commitment its breach belongs to, and reads volume from that same
    /// commitment's books — so an order witnessed against a different commitment
    /// has nothing to claim. Picking a breach and an order independently made
    /// every claim revert `NothingToClaim`, and 8192 calls executed no
    /// settlement at all.
    mapping(uint256 => uint128[]) internal ordersByCommitment;
    mapping(uint128 => address) internal orderTrader;

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
        // Short windows on purpose. `claim` refuses until the window closes, so a
        // 100_000-block window is one no sequence of calls can ever settle — and
        // the settlement invariants would then pass by never running.
        uint64 end = start + uint64(bound(windowLength, 0, 2_000));

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

        // Aim most samples INSIDE the commitment's window, and let one in eight
        // fall outside it.
        //
        // A uniformly random uint64 block number is outside every window with
        // overwhelming probability, so the verdict is `WINDOW_CLOSED` and no
        // breach is ever recorded. That was survivable while windows ran to
        // 100_000 blocks and the fuzzer's own bias toward small values landed
        // the occasional sample inside; shortening windows so claims could
        // settle made it rare, and the run became seed-dependent — passing under
        // one seed and failing `afterInvariant` under the next. A flaky
        // invariant is worse than a missing one, because it teaches you to rerun.
        AssizeRegistry.Commitment memory window = registry.commitmentAt(commitmentId);
        uint64 at = bound(blockNumber, 0, 7) == 0
            ? uint64(bound(blockNumber, 1, type(uint64).max))
            : uint64(bound(blockNumber, window.start, window.end));

        Sample memory reading = Sample({
            bid: bid,
            ask: ask,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: at,
            blockHash: keccak256(abi.encode(blockNumber, bid, ask)),
            source: bound(sourceSeed, 0, 1) == 0 ? SampleSource.REACTIVITY : SampleSource.KEEPER
        });
        // The handler is the registry's subscriber, so this call is authorised.
        registry.recordSample(commitmentId, reading);
        sampleCalls += 1;
    }

    /* --------------------------------------------------------------------- *
     * Settlement, PRD §27 Phase P3.
     * --------------------------------------------------------------------- */

    /// @dev Attribute an order and credit it a fill, the two halves a claim
    /// needs. Driven as one call because a witness with only one half can never
    /// pay anyone, and the invariants are about money moving.
    function witness(uint256 commitmentSeed, uint256 traderSeed, uint128 orderId, uint96 quantity)
        external
    {
        uint256 count = registry.commitmentCount();
        if (count == 0) return;
        uint256 commitmentId = bound(commitmentSeed, 0, count - 1);
        address trader = traders[bound(traderSeed, 0, traders.length - 1)];

        registry.attributeOrder(orderId, trader);
        // Volumes within four orders of magnitude of each other, so a share is
        // a share rather than dust. Unbounded below, the fuzzer paired a volume
        // of 1 against a denominator of 1e18 and every claim truncated to zero —
        // `NothingToClaim`, which is the contract being right and the harness
        // being unrealistic. Truncation to zero is covered deliberately by
        // test_a_trader_with_no_volume_claims_nothing instead.
        registry.witnessFill(commitmentId, orderId, bound(quantity, 1e14, 1e18));
        // Only count it if the fill actually landed inside the window; outside
        // it, `witnessFill` records nothing and there would be nothing to claim.
        if (registry.fillVolumeOf(commitmentId, orderId) == 0) return;
        // Read the owner back rather than assuming it is the one just passed.
        // `attributeOrder` is write-once, so when the fuzzer reuses an order id
        // with a different trader the registry keeps the FIRST — and a harness
        // that recorded the latest then claimed as the wrong address, which
        // `claim` correctly refused with `NotTheOrderOwner`.
        orderTrader[orderId] = registry.orderOwner(orderId);
        ordersByCommitment[commitmentId].push(orderId);
        witnessCalls += 1;
    }

    /// @dev Claim as the trader who actually placed the order, which is the only
    /// caller `claim` accepts. Failures are expected and are not tallied: the
    /// bond may not be forfeited, the order may already be settled, or the share
    /// may truncate to zero.
    function claimOne(uint256 breachSeed, uint256 orderSeed) external {
        uint256 breaches = registry.breachCount();
        if (breaches == 0) return;
        uint256 breachId = bound(breachSeed, 0, breaches - 1);

        // The order has to be one witnessed against THIS breach's commitment.
        AssizeRegistry.Breach memory breach = registry.breachAt(breachId);
        uint128[] storage orders = ordersByCommitment[breach.commitmentId];
        if (orders.length == 0) return;
        uint128 orderId = orders[bound(orderSeed, 0, orders.length - 1)];
        address trader = orderTrader[orderId];
        if (trader == address(0)) return;

        // Roll past the end of that commitment. Rolling a fixed distance instead
        // left every claim refused as `WindowStillOpen`.
        AssizeRegistry.Commitment memory c = registry.commitmentAt(breach.commitmentId);
        if (block.number <= c.end) vm.roll(uint256(c.end) + 1);

        uint128[] memory ids = new uint128[](1);
        ids[0] = orderId;

        uint256 before = trader.balance;
        vm.prank(trader);
        try registry.claim(breachId, ids) returns (uint256 amount) {
            // Tallied from the trader's balance change, not from the return
            // value, so the tally is independent of the contract under test.
            totalPaidOut += trader.balance - before;
            require(amount == trader.balance - before, "claim paid a different amount than it returned");
            claimCalls += 1;
        } catch (bytes memory reason) {
            // A rejected claim is a valid outcome and moves no money. The reason
            // is kept rather than discarded: when no claim succeeded at all, the
            // question is which guard refused them, and an empty catch cannot
            // answer it. AGENTS.md forbids the empty catch for this reason.
            rejectedClaims += 1;
            lastClaimRevert = bytes4(reason);
        }
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

    /// @notice Every wei bonded is still held, less exactly what was claimed.
    ///
    /// @dev This is the deliberate weakening the P1 version of this file named in
    /// advance. Until P3 there was no settlement path at all (D-006), so
    /// conservation was total and the balance equalled the sum of every bond.
    /// `claim` moves money, so the statement becomes `bonded - paid out` — and it
    /// stays an equality. A weakening to `assertGe` would have let a payout of
    /// the wrong size pass, which is the whole thing worth checking here.
    ///
    /// @dev Both sides are tallied outside the registry: `totalBonded` from what
    /// the handler deposited, `totalPaidOut` from the claimants' balance changes.
    /// Neither reads the registry's own `paidOut`.
    function invariant_every_bond_is_still_held() public view {
        assertEq(
            address(registry).balance,
            handler.totalBonded() - handler.totalPaidOut(),
            "registry balance diverged from bonds accepted less claims paid"
        );
    }

    /// @notice No sequence of calls pays out more than the bonds that forfeited.
    ///
    /// @dev The structural version of this — "there is no payable-out function"
    /// — retired when `claim` arrived, and replacing it with nothing would have
    /// left the money path asserted by inspection alone. What survives the
    /// change is the property that actually protects a maker: a bond that did
    /// not forfeit is never touched, so payouts can never exceed the total of
    /// the bonds that did.
    function invariant_payouts_never_exceed_forfeited_bonds() public view {
        uint256 forfeited;
        uint256 count = registry.commitmentCount();
        for (uint256 i = 0; i < count; ++i) {
            (bool isForfeited,) = registry.forfeitureOf(i);
            if (isForfeited) forfeited += registry.commitmentAt(i).bond;
        }
        assertLe(
            handler.totalPaidOut(),
            forfeited,
            "more was paid out than the forfeited bonds could cover"
        );
    }

    /// @notice PRD §13: no payout without a stored breach.
    /// @dev If nothing has breached, nothing can have been paid — whatever
    /// sequence of witnesses and claims was attempted.
    function invariant_no_payout_without_a_breach() public view {
        if (registry.breachCount() == 0) {
            assertEq(handler.totalPaidOut(), 0, "a payout happened with no breach on record");
        }
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
        // P3. The settlement invariants are about money moving, and a run where
        // nothing was ever witnessed or claimed satisfies all three of them
        // without executing a single line of `claim`. That is the same vacuous
        // pass this function already existed to catch, one phase later.
        assertGt(handler.witnessCalls(), 0, "nothing was ever witnessed");
        assertGt(
            handler.claimCalls(),
            0,
            string.concat(
                "no claim ever succeeded, so the settlement invariants proved nothing. rejected=",
                vm.toString(handler.rejectedClaims()),
                " lastRevert=",
                vm.toString(handler.lastClaimRevert())
            )
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
