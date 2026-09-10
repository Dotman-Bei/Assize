// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SomniaEventHandler} from
    "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

import {AssizeRegistry} from "./AssizeRegistry.sol";
import {IBinaryPool, OrderBookLevel} from "./interfaces/IBinaryPool.sol";
import {Sample, SampleSource} from "./VerdictLib.sol";

/// @title CoverageSubscriber
/// @notice PRD §8.2 Path R. Subscribes to a DreamDEX pool's events through the
/// Somnia reactivity precompile. Validators invoke {onEvent} when a matching log
/// is committed; this reads the book at that instant and writes a sample.
///
/// @dev Access control is inherited and is the strongest part of the design.
/// `SomniaEventHandler.onEvent` requires `msg.sender ==
/// SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS` before it calls
/// `_onEvent`, and the pinned reactivity reference confirms that a reactive
/// transaction executes with exactly that `msg.sender`. That satisfies PRD §12's
/// spoofed-callback row without this contract writing any check of its own.
///
/// @dev PRD §17: no protocol fact is compiled in. The pool arrives in the
/// constructor. The precompile address comes from the pinned package's own
/// constant, read from upstream rather than written here as a literal.
contract CoverageSubscriber is SomniaEventHandler {
    /// @notice The pool whose book this samples, and the only emitter it accepts.
    IBinaryPool public immutable pool;

    /// @notice The registry that stores samples.
    AssizeRegistry public immutable registry;

    /// @notice The commitment every sample is written against.
    /// @dev One subscriber per commitment. PRD §27 scopes Phase P2 to one market,
    /// and a subscriber that served many commitments would need to choose between
    /// them inside the handler, on gas the subscription owner pays.
    uint256 public immutable commitmentId;

    /// @notice The subscription this contract owns, once created. Zero until then.
    uint256 public subscriptionId;

    event SubscriptionCreated(uint256 indexed subscriptionId, address indexed emitter);
    event SampleForwarded(uint256 indexed sampleId, uint64 blockNumber);
    event SampleSkipped(string reason);

    error ZeroAddress();
    error AlreadySubscribed();
    error NotSubscribed();
    error EmitterNotThePool(address emitter);
    error FilterWouldMatchOurselves();
    error BookValueTooWide();

    constructor(IBinaryPool pool_, AssizeRegistry registry_, uint256 commitmentId_) {
        if (address(pool_) == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        pool = pool_;
        registry = registry_;
        commitmentId = commitmentId_;
    }

    /* --------------------------------------------------------------------- *
     * Subscription
     * --------------------------------------------------------------------- */

    /// @notice Create the reactivity subscription that drives sampling.
    /// @dev The filter's `emitter` is pinned to the pool, and that is a safety
    /// property rather than an optimisation. The pinned reactivity reference
    /// warns that logs emitted by reactive transactions are themselves matched
    /// against subscriptions, so "a subscription can provoke a recursive
    /// explosion, unstoppably draining the owner's balance". Writing a sample
    /// makes the registry emit `SampleRecorded`; if that log could match this
    /// subscription, each sample would trigger the next until the prefund was
    /// gone — and an exhausted prefund is silent `NOT_SAMPLED`, the worst failure
    /// PRD §8.2 names. Pinning the emitter to the pool makes that loop
    /// unreachable, and {_assertFilterCannotMatchUs} refuses any filter that
    /// would reopen it.
    /// @param eventTopics Topic filter. A zero topic matches any value.
    /// @param options Gas and fee controls for each callback.
    function subscribe(
        bytes32[4] calldata eventTopics,
        SomniaExtensions.SubscriptionOptions calldata options
    ) external returns (uint256) {
        if (subscriptionId != 0) revert AlreadySubscribed();

        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions
            .SubscriptionFilter({
            eventTopics: eventTopics,
            origin: address(0),
            emitter: address(pool)
        });
        _assertFilterCannotMatchUs(filter);

        uint256 created = SomniaExtensions.subscribe(address(this), filter, options);
        subscriptionId = created;
        emit SubscriptionCreated(created, address(pool));
        return created;
    }

    /// @notice Stop sampling.
    function unsubscribe() external {
        uint256 current = subscriptionId;
        if (current == 0) revert NotSubscribed();
        subscriptionId = 0;
        SomniaExtensions.unsubscribe(current);
    }

    /// @dev The recursion guard, stated as an assertion so it is testable.
    /// A filter may only be used when scoped to an emitter that is neither the
    /// registry nor this contract, and is not a wildcard.
    function _assertFilterCannotMatchUs(SomniaExtensions.SubscriptionFilter memory filter)
        private
        view
    {
        if (
            filter.emitter == address(0) || filter.emitter == address(registry)
                || filter.emitter == address(this)
        ) {
            revert FilterWouldMatchOurselves();
        }
    }

    /* --------------------------------------------------------------------- *
     * sample
     * --------------------------------------------------------------------- */

    /// @inheritdoc SomniaEventHandler
    /// @dev Reached only through `SomniaEventHandler.onEvent`, which has already
    /// required `msg.sender` to be the reactivity precompile.
    function _onEvent(address emitter, bytes32[] calldata, bytes calldata) internal override {
        // Defence in depth. The filter already scopes to the pool; this makes a
        // mis-scoped subscription fail loudly instead of sampling the wrong book.
        if (emitter != address(pool)) revert EmitterNotThePool(emitter);

        (uint128 bid, uint128 bidSize) = _bestLevel(true);
        (uint128 ask, uint128 askSize) = _bestLevel(false);

        Sample memory sample = Sample({
            bid: bid,
            ask: ask,
            bidSize: bidSize,
            askSize: askSize,
            blockNumber: uint64(block.number),
            // The parent hash, not this block's own hash, which no contract can
            // observe from inside the block it is executing in. A verifier checks
            // `getBlock(blockNumber).parentHash == sample.blockHash`, which pins
            // the sample to one block on one chain just as tightly. See
            // DECISIONS.md D-016.
            blockHash: blockhash(block.number - 1),
            source: SampleSource.REACTIVITY
        });

        (uint256 sampleId,) = registry.recordSample(commitmentId, sample);
        emit SampleForwarded(sampleId, sample.blockNumber);
    }

    /// @dev Best level on one side, or zeros when the side is empty.
    /// An empty side is a real reading — PRD §14's "pull one side entirely" —
    /// and becomes `ABSENT` downstream rather than an error here.
    function _bestLevel(bool isBid) private view returns (uint128 price, uint128 quantity) {
        OrderBookLevel[] memory levels = pool.getBookLevels(isBid, 1);
        if (levels.length == 0) {
            return (0, 0);
        }
        return (_narrow(levels[0].price), _narrow(levels[0].quantity));
    }

    /// @dev The book reports uint256; a sample stores uint128. Reverting beats
    /// truncating: a truncated size is a silently wrong sample, and a wrong
    /// sample recorded as a breach is exactly the incident PRD §26 K6 exists to
    /// stop. A revert here is a missing sample, which is `NOT_SAMPLED` — visible,
    /// counted, and never mistaken for coverage.
    function _narrow(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert BookValueTooWide();
        return uint128(value);
    }
}
