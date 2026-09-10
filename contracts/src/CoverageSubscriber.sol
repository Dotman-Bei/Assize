// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SomniaEventHandler} from
    "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {ISomniaReactivityPrecompile} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";

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

    /// @notice The account that may recover unspent handler prefund.
    /// @dev The deployer, fixed at construction. This contract holds no user
    /// money: its balance is gas prefund for callbacks, which the reactivity
    /// precompile spends on its behalf. Recovering it matters operationally
    /// because testnet funds are rate limited, and stranding a prefund in a
    /// superseded subscriber costs a day.
    /// @dev This is not a lever over anything measured. The registry holds the
    /// bonds and has no admin path at all (PRD §10). Draining this balance stops
    /// sampling, which is PRD §12's griefing row — and that row's mitigation is
    /// unchanged: an unfunded window surfaces as an explicit unfunded state
    /// rather than expiring clean. The funder is the deployer, not the maker
    /// (DECISIONS.md D-019), so it cannot be used by a maker against its own bond.
    address public immutable funder;

    event SubscriptionCreated(uint256 indexed subscriptionId, address indexed emitter);
    event SampleForwarded(uint256 indexed sampleId, uint64 blockNumber);
    event SampleSkipped(string reason);
    event Swept(address indexed to, uint256 amount);
    /// @notice Emitted when the stored subscription id is cleared.
    /// @param acknowledged Whether the precompile agreed to remove it. False
    /// means the chain had already removed it, which is still a successful stop.
    event SubscriptionCleared(uint256 indexed subscriptionId, bool acknowledged);

    error ZeroAddress();
    error AlreadySubscribed();
    error NotSubscribed();
    error EmitterNotThePool(address emitter);
    error FilterWouldMatchOurselves();
    error BookValueTooWide();
    error NotFunder(address caller);
    error SweepFailed();

    constructor(IBinaryPool pool_, AssizeRegistry registry_, uint256 commitmentId_) {
        if (address(pool_) == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        pool = pool_;
        registry = registry_;
        commitmentId = commitmentId_;
        funder = msg.sender;
    }

    /// @notice Accept handler prefund.
    /// @dev Without this the contract cannot be funded at all, and a subscription
    /// it owns can never fire. The first deployment of this contract omitted it,
    /// and the plain transfer that was meant to fund it reverted. The tests did
    /// not catch it because they used `vm.deal`, which writes a balance directly
    /// and never performs a transfer — so they proved the contract could hold a
    /// balance, not that anyone could give it one.
    receive() external payable {}

    /// @notice Recover unspent prefund.
    /// @dev Restricted to the funder. Sweeping while a subscription is live stops
    /// sampling, so it is for recovering a superseded deployment, not for use
    /// mid-window.
    function sweep(address payable to) external {
        if (msg.sender != funder) revert NotFunder(msg.sender);
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = address(this).balance;
        (bool ok,) = to.call{value: balance}("");
        if (!ok) revert SweepFailed();
        emit Swept(to, balance);
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
        // The caller chooses `options.gasLimit` and `options.maxFeePerGas`, and
        // every callback is paid out of this contract's prefund. An unrestricted
        // subscribe let a stranger set both and drain it.
        if (msg.sender != funder) revert NotFunder(msg.sender);
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

    /// @notice Stop sampling, and clear the stored id even if the chain has
    /// already removed the subscription on its own.
    ///
    /// @dev The precompile is called low-level here rather than through
    /// `SomniaExtensions.unsubscribe`, and that is the whole point of this
    /// function rather than a shortcut through it.
    ///
    /// A subscription can be removed by the network without this contract being
    /// told. DECISIONS.md D-032 records it happening: the prefund ran out, the
    /// chain dropped the subscription, `somnia_reactivityGetSubscriptions`
    /// returned an empty list, and `subscriptionId` still held the removed id.
    /// `SomniaExtensions.unsubscribe` reverts `UnsubscribeFailed` when the
    /// precompile rejects an id it no longer knows — and because the reset above
    /// it lives in the same transaction, that revert rolls the reset back too.
    /// The result is a contract that can never subscribe again: `subscribe`
    /// refuses with `AlreadySubscribed` on an id no longer on chain, and the one
    /// function that clears it cannot run. That wedged the first funded
    /// deployment permanently and cost a redeploy.
    ///
    /// So a refusal from the precompile is not treated as failure. Being asked
    /// to stop something already stopped is the goal reached by another route.
    /// The outcome is not swallowed either: it is emitted, so a removal the
    /// chain declined is visible on the log rather than assumed.
    ///
    /// @dev Restricted to the funder. Before this it was callable by anyone,
    /// which let any address stop sampling for a live window — PRD §12's
    /// griefing row, reachable without spending anything.
    function unsubscribe() external {
        if (msg.sender != funder) revert NotFunder(msg.sender);
        uint256 current = subscriptionId;
        if (current == 0) revert NotSubscribed();
        subscriptionId = 0;

        // solhint-disable-next-line avoid-low-level-calls
        (bool acknowledged,) = SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(ISomniaReactivityPrecompile.unsubscribe.selector, current)
        );
        emit SubscriptionCleared(current, acknowledged);
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
