// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SomniaExtensions} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

import {AssizeRegistry} from "../src/AssizeRegistry.sol";
import {CoverageSubscriber} from "../src/CoverageSubscriber.sol";
import {IBinaryPool, OrderBookLevel} from "../src/interfaces/IBinaryPool.sol";
import {ISomniaReactivityPrecompile} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";
import {ISomniaEventHandler} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaEventHandler.sol";

import {SampleSource, VerdictState} from "../src/VerdictLib.sol";

/// @notice A stand-in for the DreamDEX pool, so the handler can be driven without
/// a chain. Labelled a local fixture: AGENTS.md keeps simulated data off the
/// public proof path, and nothing this returns is ever presented as a reading.
contract LocalFixturePool is IBinaryPool {
    OrderBookLevel[] private _bids;
    OrderBookLevel[] private _asks;

    function setBook(uint256 bid, uint256 bidSize, uint256 ask, uint256 askSize) external {
        delete _bids;
        delete _asks;
        if (bidSize > 0 || bid > 0) _bids.push(OrderBookLevel({price: bid, quantity: bidSize}));
        if (askSize > 0 || ask > 0) _asks.push(OrderBookLevel({price: ask, quantity: askSize}));
    }

    function clearSide(bool isBid) external {
        if (isBid) delete _bids;
        else delete _asks;
    }

    function getBookLevels(bool isBid, uint64) external view returns (OrderBookLevel[] memory) {
        return isBid ? _bids : _asks;
    }
}

contract CoverageSubscriberTest is Test {
    AssizeRegistry internal registry;
    CoverageSubscriber internal subscriber;
    LocalFixturePool internal pool;

    address internal maker = makeAddr("maker");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant MARKET = keccak256("market-under-test");

    /// @dev The precompile's address, taken from the pinned package's constant
    /// rather than written as a literal (PRD §17).
    address internal constant PRECOMPILE =
        SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS;

    function setUp() public {
        pool = new LocalFixturePool();
        vm.deal(maker, 100 ether);
        vm.roll(1000);

        // The registry's subscriber is immutable and the subscriber's registry is
        // immutable, so one address is predicted before the other is deployed.
        // contracts/script/Deploy.s.sol does the same thing on chain.
        address predictedSubscriber = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        registry = new AssizeRegistry(predictedSubscriber);

        vm.prank(maker);
        uint256 commitmentId =
            registry.publishCommitment{value: 1 ether}(MARKET, 200, 1000, 1000, 2000);

        subscriber = new CoverageSubscriber(pool, registry, commitmentId);
        assertEq(address(subscriber), predictedSubscriber, "prediction must hold");
        assertEq(registry.subscriber(), address(subscriber));

        pool.setBook(4900, 5000, 5100, 5000);

        // The pinned library requires the subscription owner to hold at least
        // SUBSCRIPTION_OWNER_MINIMUM_BALANCE before it will subscribe. Funding it
        // here is what makes the subscription tests exercise the filter rather
        // than the balance check; the requirement itself is asserted separately
        // by test_subscribing_requires_the_minimum_owner_balance.
        vm.deal(address(subscriber), SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE);
    }

    /// @dev The precompile cannot be `vm.etch`ed — foundry refuses addresses in
    /// the precompile range — so subscription calls are answered with a mock and
    /// asserted with `vm.expectCall`, which matches the exact calldata sent. That
    /// is a stricter check than recording it: any deviation in any field fails.
    function _answerPrecompile() internal {
        vm.mockCall(PRECOMPILE, bytes(""), abi.encode(uint256(7)));
    }

    /// @dev The subscription this contract is required to send: scoped to the
    /// pool, handled by itself, through the standard onEvent selector.
    function _expectedSubscription(address subscriberAddress, address emitter)
        internal
        pure
        returns (ISomniaReactivityPrecompile.SubscriptionData memory)
    {
        bytes32[4] memory topics;
        return ISomniaReactivityPrecompile.SubscriptionData({
            eventTopics: topics,
            origin: address(0),
            caller: address(0),
            emitter: emitter,
            handlerContractAddress: subscriberAddress,
            handlerFunctionSelector: ISomniaEventHandler.onEvent.selector,
            priorityFeePerGas: SomniaExtensions.DEFAULT_PRIORITY_FEE_PER_GAS,
            maxFeePerGas: SomniaExtensions.DEFAULT_MAX_FEE_PER_GAS,
            gasLimit: SomniaExtensions.DEFAULT_HANDLER_GAS_LIMIT,
            isGuaranteed: false,
            isCoalesced: false
        });
    }

    function _onEventAsPrecompile() internal {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = keccak256("OrderPlaced(uint128,(uint128,bool,address,uint64,uint256,uint256,uint256,uint64))");
        vm.prank(PRECOMPILE);
        subscriber.onEvent(address(pool), topics, "");
    }

    /* ------------------------- access control ---------------------------- */

    /// @notice PRD §12, spoofed-callback row. Inherited from SomniaEventHandler,
    /// and asserted here because it is the property the whole path rests on.
    function test_onEvent_rejects_every_caller_but_the_precompile() public {
        bytes32[] memory topics = new bytes32[](0);

        vm.prank(stranger);
        vm.expectRevert();
        subscriber.onEvent(address(pool), topics, "");

        vm.prank(maker);
        vm.expectRevert();
        subscriber.onEvent(address(pool), topics, "");

        vm.prank(address(registry));
        vm.expectRevert();
        subscriber.onEvent(address(pool), topics, "");

        // And the precompile itself succeeds, so the test above is not passing
        // because the call is broken for everyone.
        _onEventAsPrecompile();
        assertEq(registry.sampleCount(), 1);
    }

    function test_onEvent_rejects_an_emitter_that_is_not_the_pool() public {
        bytes32[] memory topics = new bytes32[](0);
        vm.prank(PRECOMPILE);
        vm.expectRevert(
            abi.encodeWithSelector(CoverageSubscriber.EmitterNotThePool.selector, stranger)
        );
        subscriber.onEvent(stranger, topics, "");
    }

    /* ------------------------- the recursion guard ----------------------- */

    /// @notice The subscription can never match a log this system emits.
    ///
    /// @dev The pinned reactivity reference warns that logs emitted by reactive
    /// transactions are matched against subscriptions, so a subscription can feed
    /// itself and drain the owner's balance. Writing a sample makes the registry
    /// emit `SampleRecorded`. If that could match, each sample would trigger the
    /// next until the prefund was gone — and an exhausted prefund is silent
    /// `NOT_SAMPLED`, the worst failure PRD §8.2 names.
    function test_subscription_filter_is_pinned_to_the_pool() public {
        _answerPrecompile();
        bytes32[4] memory topics;

        // The subscription must be sent byte for byte as this: emitter pinned to
        // the pool, never a wildcard and never one of our own contracts. Any
        // deviation in any field fails this expectation.
        vm.expectCall(
            PRECOMPILE,
            abi.encodeCall(
                ISomniaReactivityPrecompile.subscribe,
                (_expectedSubscription(address(subscriber), address(pool)))
            )
        );
        subscriber.subscribe(topics, _defaultOptions());
        assertEq(subscriber.subscriptionId(), 7);

        // And the emitter that was pinned is none of the addresses that would
        // make the subscription feed itself.
        assertTrue(address(pool) != address(0), "a wildcard emitter would match our own logs");
        assertTrue(address(pool) != address(registry), "must not match the registry's logs");
        assertTrue(address(pool) != address(subscriber), "must not match our own logs");
    }

    /// @notice The pinned library refuses to subscribe unless the owner holds the
    /// minimum balance, and the owner here is the subscriber contract itself.
    /// @dev A real operational cost for Phase P2: the subscriber must be funded
    /// from the faucet before it can subscribe at all, and separately funded to
    /// pay per-callback gas. Asserted so the requirement is discovered by a test
    /// rather than by a failed deployment.
    function test_subscribing_requires_the_minimum_owner_balance() public {
        _answerPrecompile();
        bytes32[4] memory topics;

        vm.deal(address(subscriber), SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE - 1);
        vm.expectRevert(SomniaExtensions.InsufficientBalance.selector);
        subscriber.subscribe(topics, _defaultOptions());

        vm.deal(address(subscriber), SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE);
        subscriber.subscribe(topics, _defaultOptions());
        assertEq(subscriber.subscriptionId(), 7);
    }

    /// @notice A subscriber pointed at the registry refuses to subscribe at all.
    /// @dev The guard is stated as an assertion rather than trusted to the
    /// constructor, so a mis-wired deployment fails before it can spend anything.
    function test_subscribe_refuses_a_filter_that_would_match_the_registry() public {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        AssizeRegistry other = new AssizeRegistry(predicted);
        // Pool and registry are the same address: any log the registry emits
        // would match this subscription.
        CoverageSubscriber miswired = new CoverageSubscriber(IBinaryPool(address(other)), other, 0);

        bytes32[4] memory topics;
        _answerPrecompile();
        vm.deal(address(miswired), SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE);
        vm.expectRevert(CoverageSubscriber.FilterWouldMatchOurselves.selector);
        miswired.subscribe(topics, _defaultOptions());
    }

    function test_subscribe_is_one_shot() public {
        bytes32[4] memory topics;
        _answerPrecompile();
        subscriber.subscribe(topics, _defaultOptions());
        vm.expectRevert(CoverageSubscriber.AlreadySubscribed.selector);
        subscriber.subscribe(topics, _defaultOptions());
    }

    /* ------------------------- funding ----------------------------------- */

    /// @notice The contract can actually be funded by a transfer.
    ///
    /// @dev Every other test funds it with `vm.deal`, which writes a balance
    /// directly and never performs a transfer. That proved the contract could
    /// hold a balance, not that anyone could give it one — and the first
    /// deployment shipped without a `receive()`, so the transfer meant to fund it
    /// reverted on chain. This asserts the property that was actually missing.
    function test_can_be_funded_by_a_plain_transfer() public {
        uint256 before = address(subscriber).balance;
        vm.deal(address(this), 40 ether);
        (bool ok,) = address(subscriber).call{value: 40 ether}("");
        assertTrue(ok, "a plain transfer to the subscriber must succeed");
        assertEq(address(subscriber).balance, before + 40 ether);
    }

    function test_only_the_funder_may_sweep() public {
        vm.deal(address(subscriber), 5 ether);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CoverageSubscriber.NotFunder.selector, stranger));
        subscriber.sweep(payable(stranger));

        // This test contract deployed the subscriber, so it is the funder.
        uint256 before = address(this).balance;
        subscriber.sweep(payable(address(this)));
        assertEq(address(subscriber).balance, 0);
        assertEq(address(this).balance, before + 5 ether);
    }

    receive() external payable {}

    /* ------------------------- sampling ---------------------------------- */

    function test_sample_carries_the_book_and_is_labelled_reactivity() public {
        _onEventAsPrecompile();

        AssizeRegistry.SampleRecord memory stored = registry.sampleAt(0);
        assertEq(stored.sample.bid, 4900);
        assertEq(stored.sample.ask, 5100);
        assertEq(stored.sample.bidSize, 5000);
        assertEq(stored.sample.askSize, 5000);
        // AGENTS.md: a sample without a source label is a bug, not a sample.
        assertEq(uint256(stored.sample.source), uint256(SampleSource.REACTIVITY));
        // Spread is 200, exactly the committed bound, so this holds (D-011).
        assertEq(uint256(registry.verdictOf(0)), uint256(VerdictState.COVERED_AT_SAMPLE));
    }

    /// @notice The pin is the parent hash, and it resolves (DECISIONS.md D-016).
    function test_sample_pins_the_parent_hash_of_its_own_block() public {
        _onEventAsPrecompile();
        AssizeRegistry.SampleRecord memory stored = registry.sampleAt(0);
        assertEq(stored.sample.blockNumber, uint64(block.number));
        assertEq(stored.sample.blockHash, blockhash(block.number - 1));
        assertTrue(stored.sample.blockHash != bytes32(0), "an unpinned sample is rejected upstream");
    }

    /// @notice PRD §14: a maker who pulls one side entirely must be recorded as
    /// ABSENT, which forfeits the bond.
    function test_a_pulled_side_samples_as_absent() public {
        pool.clearSide(false);
        _onEventAsPrecompile();
        assertEq(uint256(registry.verdictOf(0)), uint256(VerdictState.ABSENT));
        assertEq(registry.breachCount(), 1);
    }

    function test_an_empty_book_samples_as_absent() public {
        pool.clearSide(true);
        pool.clearSide(false);
        _onEventAsPrecompile();
        assertEq(uint256(registry.verdictOf(0)), uint256(VerdictState.ABSENT));
    }

    function test_a_wide_quote_is_recorded_as_a_spread_breach() public {
        pool.setBook(1000, 5000, 9000, 5000);
        _onEventAsPrecompile();
        assertEq(uint256(registry.verdictOf(0)), uint256(VerdictState.SPREAD_BREACH));
        assertEq(registry.breachCount(), 1);
    }

    /// @notice A book value too wide for the sample struct reverts rather than
    /// truncating. A truncated size is a silently wrong sample, and a wrong
    /// sample recorded as a breach is the incident PRD §26 K6 exists to stop.
    function test_an_oversized_book_value_reverts_rather_than_truncating() public {
        pool.setBook(4900, uint256(type(uint128).max) + 1, 5100, 5000);
        bytes32[] memory topics = new bytes32[](0);
        vm.prank(PRECOMPILE);
        vm.expectRevert(CoverageSubscriber.BookValueTooWide.selector);
        subscriber.onEvent(address(pool), topics, "");
        // Nothing was written, so the interval is a gap rather than a bad datum.
        assertEq(registry.sampleCount(), 0);
    }

    function test_repeated_events_write_repeated_samples() public {
        _onEventAsPrecompile();
        vm.roll(block.number + 1);
        _onEventAsPrecompile();
        assertEq(registry.sampleCount(), 2);
        assertEq(registry.sampleAt(0).sample.blockNumber, 1000);
        assertEq(registry.sampleAt(1).sample.blockNumber, 1001);
    }

    function _defaultOptions()
        private
        pure
        returns (SomniaExtensions.SubscriptionOptions memory)
    {
        return SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: SomniaExtensions.DEFAULT_PRIORITY_FEE_PER_GAS,
            maxFeePerGas: SomniaExtensions.DEFAULT_MAX_FEE_PER_GAS,
            gasLimit: SomniaExtensions.DEFAULT_HANDLER_GAS_LIMIT
        });
    }
}
