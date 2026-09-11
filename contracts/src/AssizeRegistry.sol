// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    CommitmentEnvelope, Sample, SampleSource, VerdictLib, VerdictState
} from "./VerdictLib.sol";

/// @title AssizeRegistry
/// @notice PRD §10. Stores quoting commitments and the bonds behind them, accepts
/// block-pinned samples from the sampler, and records a breach when a stored
/// sample falls outside a stored envelope.
///
/// @dev Phase boundary (PRD §27, docs/phase.md). This contract implements the
/// first four links of the mechanism chain:
///
///     commitment -> sample -> verdict -> breach record -> payout
///                                                         ^^^^^^
///
/// Payout, witnessed volume and `claim(breachId)` are Phase P3 and are absent
/// here on purpose: `docs/phase.md` lists payouts as explicitly out of scope for
/// P1, and PRD §27 forbids building a later phase's breadth before the current
/// phase's gate passes. A bond posted here therefore has no exit path yet, which
/// is why this contract is not deployable until P3 adds settlement — consistent
/// with P1's stop boundary, which deploys nothing at all. See DECISIONS.md D-006.
///
/// @dev PRD §10 constraints, all structural rather than promised: no
/// upgradeability, no pause, no admin withdrawal of bonds, no token, no fee
/// switch. The owner role can register a keeper address for the fallback path and
/// nothing else. There is no function by which the owner can touch a bond.
///
/// @dev PRD §17: no protocol fact is compiled in. The sampler address arrives in
/// the constructor and the market id is a caller-supplied parameter.
contract AssizeRegistry {
    /* --------------------------------------------------------------------- *
     * Storage
     * --------------------------------------------------------------------- */

    /// @notice PRD §10: a stored commitment. The envelope half is what the
    /// verdict reads; maker, marketId and bond are stored but are never inputs to
    /// a verdict (PRD §12: never computed from maker input).
    struct Commitment {
        address maker;
        bytes32 marketId;
        uint128 maxSpread;
        uint128 minSize;
        uint64 start;
        uint64 end;
        uint256 bond;
        /// @dev Breach id that forfeited the bond, plus one. Zero means the bond
        /// is not forfeited. Stored plus-one so the zero value is unambiguous.
        uint256 forfeitedAtBreachIdPlusOne;
    }

    /// @notice A stored sample and the commitment it was taken against.
    /// @dev The verdict is deliberately not stored. PRD §5.2 requires that a
    /// verdict be computable from a stored sample and a stored commitment, so
    /// {verdictOf} re-derives it on every call. A stored verdict would be an
    /// opinion that could drift from its inputs; a derived one cannot.
    struct SampleRecord {
        uint256 commitmentId;
        Sample sample;
    }

    /// @notice PRD §5.2: a breach records the sample that caused it.
    struct Breach {
        uint256 commitmentId;
        uint256 sampleId;
    }

    /// @notice The only address that may write samples on the reactivity path.
    /// @dev PRD §8.2 Path R: this is `CoverageSubscriber`, which itself accepts
    /// calls from the reactivity precompile only. Immutable and constructor-set,
    /// so there is no admin path to redirect sampling. Deployed in Phase P2.
    address public immutable subscriber;

    /// @notice May register a keeper for the fallback path, and nothing else.
    address public immutable owner;

    /// @notice PRD §8.2 Path K, selected only if PRD §26 K1 fires. Every sample
    /// this address writes is labelled `KEEPER`, in storage and on screen.
    address public keeper;

    uint256 public commitmentCount;
    uint256 public sampleCount;
    uint256 public breachCount;

    mapping(uint256 => Commitment) private _commitments;
    mapping(uint256 => SampleRecord) private _samples;
    mapping(uint256 => Breach) private _breaches;

    /// @dev keccak256(maker, marketId) => commitment id plus one. PRD §10: one
    /// active commitment per maker per market.
    mapping(bytes32 => uint256) private _activeCommitmentPlusOne;

    /* --------------------------------------------------------------------- *
     * Witnessed volume and settlement. PRD §27 Phase P3.
     *
     * PRD §23 beat 4 pays "a witnessed trader", and the word carries the whole
     * design: a bond is forfeited to the people who were actually exposed to the
     * book while the commitment did not hold, not to whoever calls first.
     *
     * Being exposed means having taken liquidity during the window, and the pool
     * says so in two events that must be read together. `OrderFilled` carries
     * `takerOrderId` and `quantityFilled` but no address; `OrderPlaced` carries
     * `orderId` and `owner` but no fill. Neither alone identifies a trader who
     * traded, which is why both are recorded here and joined at claim time
     * rather than at write time — the two logs can arrive in either order, and a
     * join performed on arrival would silently drop whichever came first.
     * --------------------------------------------------------------------- */

    /// @notice Who placed an order, from `OrderPlaced`. Set once and never
    /// changed: an order id is assigned by the pool and does not get reissued,
    /// so a second writer could only be overwriting a correct answer.
    mapping(uint128 => address) public orderOwner;

    /// @dev commitment => taker order id => quantity that order filled inside
    /// the window. Recorded against the order rather than the address, because
    /// the address may not be known yet.
    mapping(uint256 => mapping(uint128 => uint256)) private _fillVolume;

    /// @dev commitment => quantity filled by every taker inside the window. The
    /// denominator of a pro-rata share, accumulated whether or not the owner of
    /// a given order is ever learned — so an unknown owner dilutes nobody's
    /// share and quietly enlarges no one else's.
    mapping(uint256 => uint256) public witnessedVolume;

    /// @dev commitment => taker order id => already paid. Per order rather than
    /// per address, so one claim transaction can settle several orders and
    /// neither can be presented twice.
    mapping(uint256 => mapping(uint128 => bool)) public orderSettled;

    /// @dev commitment => wei already paid out of the forfeited bond.
    mapping(uint256 => uint256) public paidOut;

    /* --------------------------------------------------------------------- *
     * Events. PRD §10: the verifier reads events, not our database.
     * --------------------------------------------------------------------- */

    event CommitmentPublished(
        uint256 indexed commitmentId,
        address indexed maker,
        bytes32 indexed marketId,
        uint128 maxSpread,
        uint128 minSize,
        uint64 start,
        uint64 end,
        uint256 bond
    );

    /// @dev Carries the whole sample and its derived verdict so that a verifier
    /// with only a public RPC can re-derive the verdict from the log alone
    /// (PRD §11, claim C-002).
    event SampleRecorded(
        uint256 indexed sampleId,
        uint256 indexed commitmentId,
        VerdictState verdict,
        SampleSource source,
        uint64 blockNumber,
        bytes32 blockHash,
        uint128 bid,
        uint128 ask,
        uint128 bidSize,
        uint128 askSize
    );

    event BreachRecorded(
        uint256 indexed breachId,
        uint256 indexed commitmentId,
        uint256 indexed sampleId,
        VerdictState verdict
    );

    /// @dev Emitted once per commitment, on the breach that forfeits the bond.
    event BondForfeited(uint256 indexed commitmentId, uint256 indexed breachId, uint256 bond);

    event KeeperRegistered(address indexed previousKeeper, address indexed newKeeper);

    /// @dev The two halves of a witness, emitted separately because they arrive
    /// separately. A verifier reconstructs the same join this contract does.
    event OrderAttributed(uint128 indexed orderId, address indexed owner);
    event FillWitnessed(
        uint256 indexed commitmentId,
        uint128 indexed takerOrderId,
        uint256 quantity,
        uint256 witnessedVolumeAfter
    );

    /// @dev PRD §23 beat 4. Carries the arithmetic, so the share can be checked
    /// against `witnessedVolume` and the bond without trusting this number.
    event BondClaimed(
        uint256 indexed commitmentId,
        uint256 indexed breachId,
        address indexed claimant,
        uint256 volumeClaimed,
        uint256 amount
    );

    /* --------------------------------------------------------------------- *
     * Errors
     * --------------------------------------------------------------------- */

    error NotSampler(address caller);
    error NotOwner(address caller);
    error ZeroAddress();
    error BondRequired();
    error WindowStartsInThePast(uint64 start, uint256 currentBlock);
    error WindowEndsBeforeItStarts(uint64 start, uint64 end);
    error CommitmentAlreadyActive(uint256 commitmentId);
    error NoSuchCommitment(uint256 commitmentId);
    error NoSuchBreach(uint256 breachId);
    error SampleNotPinned();
    error SampleNotLabelled();
    error BondNotForfeited(uint256 commitmentId);
    error NoWitnessedVolume(uint256 commitmentId);
    error NotTheOrderOwner(uint128 orderId, address owner);
    error OrderAlreadySettled(uint128 orderId);
    error NothingToClaim();
    error PayoutFailed(address to, uint256 amount);
    error NoOrdersGiven();
    error WindowStillOpen(uint256 commitmentId, uint64 end, uint256 currentBlock);
    error PayoutExceedsBond(uint256 commitmentId, uint256 amount, uint256 remaining);

    /* --------------------------------------------------------------------- *
     * Construction
     * --------------------------------------------------------------------- */

    /// @param subscriber_ The `CoverageSubscriber` deployed in Phase P2. Passed
    /// in rather than compiled in (PRD §17), and immutable so that no later
    /// transaction can redirect who is allowed to write samples.
    constructor(address subscriber_) {
        if (subscriber_ == address(0)) revert ZeroAddress();
        subscriber = subscriber_;
        owner = msg.sender;
    }

    /* --------------------------------------------------------------------- *
     * Access control
     * --------------------------------------------------------------------- */

    /// @dev PRD §12, spoofed-callback row. Path R writes come from the subscriber,
    /// which accepts the reactivity precompile only. Path K writes come from the
    /// registered keeper. Nothing else can write a sample.
    modifier onlySampler() {
        if (msg.sender != subscriber && (keeper == address(0) || msg.sender != keeper)) {
            revert NotSampler(msg.sender);
        }
        _;
    }

    /// @notice Register the fallback keeper (PRD §26 K1). The owner's only power.
    /// @dev There is deliberately no other owner-gated function in this contract.
    function registerKeeper(address newKeeper) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        address previous = keeper;
        keeper = newKeeper;
        emit KeeperRegistered(previous, newKeeper);
    }

    /* --------------------------------------------------------------------- *
     * commitment
     * --------------------------------------------------------------------- */

    /// @notice PRD §10. Publish a quoting commitment for one market and bond it.
    /// @dev The window is in block numbers, inclusive at both ends
    /// (DECISIONS.md D-003): `blockNumber` is the only temporal field in the
    /// sample struct PRD §5.2 fixes, and a verdict may read nothing else.
    /// @dev `start` may not be in the past. A maker who could backdate a window
    /// could commit to an interval they had already watched go well, which would
    /// leave the bond exposed to nothing at all while still calling itself a bond.
    function publishCommitment(
        bytes32 marketId,
        uint128 maxSpread,
        uint128 minSize,
        uint64 start,
        uint64 end
    ) external payable returns (uint256 commitmentId) {
        if (msg.value == 0) revert BondRequired();
        if (end < start) revert WindowEndsBeforeItStarts(start, end);
        if (uint256(start) < block.number) revert WindowStartsInThePast(start, block.number);

        bytes32 key = _activeKey(msg.sender, marketId);
        uint256 activePlusOne = _activeCommitmentPlusOne[key];
        if (activePlusOne != 0) {
            // PRD §10: one active commitment per maker per market. A previous
            // commitment whose window has closed no longer blocks a new one.
            Commitment storage previous = _commitments[activePlusOne - 1];
            if (block.number <= uint256(previous.end)) {
                revert CommitmentAlreadyActive(activePlusOne - 1);
            }
        }

        commitmentId = commitmentCount;
        commitmentCount = commitmentId + 1;
        _commitments[commitmentId] = Commitment({
            maker: msg.sender,
            marketId: marketId,
            maxSpread: maxSpread,
            minSize: minSize,
            start: start,
            end: end,
            bond: msg.value,
            forfeitedAtBreachIdPlusOne: 0
        });
        _activeCommitmentPlusOne[key] = commitmentId + 1;

        emit CommitmentPublished(
            commitmentId, msg.sender, marketId, maxSpread, minSize, start, end, msg.value
        );
    }

    /* --------------------------------------------------------------------- *
     * sample -> verdict -> breach record
     * --------------------------------------------------------------------- */

    /// @notice PRD §10. Write a block-pinned sample against a commitment and
    /// record a breach if the stored envelope did not hold at that instant.
    /// @dev Callable only by the subscriber or the registered keeper.
    /// @dev An unpinned or unlabelled sample is rejected rather than stored.
    /// PRD §6 rests the whole keeper trust argument on every sample pinning a
    /// block, and AGENTS.md calls an unlabelled sample a bug rather than a
    /// sample. A crossed book, by contrast, is stored: it is a real reading, and
    /// the evaluator classifies it `SAMPLER_FAILED` where a verifier can see it.
    /// @dev A sample from outside the window is stored too. Rejecting one would
    /// let a sampler quietly drop late readings instead of recording them.
    function recordSample(uint256 commitmentId, Sample calldata sample)
        external
        onlySampler
        returns (uint256 sampleId, VerdictState state)
    {
        if (commitmentId >= commitmentCount) revert NoSuchCommitment(commitmentId);
        if (sample.blockNumber == 0 || sample.blockHash == bytes32(0)) revert SampleNotPinned();
        if (sample.source == SampleSource.UNLABELLED) revert SampleNotLabelled();

        sampleId = sampleCount;
        sampleCount = sampleId + 1;
        _samples[sampleId] = SampleRecord({commitmentId: commitmentId, sample: sample});

        state = verdictOf(sampleId);
        emit SampleRecorded(
            sampleId,
            commitmentId,
            state,
            sample.source,
            sample.blockNumber,
            sample.blockHash,
            sample.bid,
            sample.ask,
            sample.bidSize,
            sample.askSize
        );

        if (VerdictLib.isBreach(state)) {
            uint256 breachId = breachCount;
            breachCount = breachId + 1;
            _breaches[breachId] = Breach({commitmentId: commitmentId, sampleId: sampleId});
            emit BreachRecorded(breachId, commitmentId, sampleId, state);

            // The bond forfeits once, on the first breach in the window. Later
            // breaches are still recorded, because each one is evidence a
            // verifier can re-derive, but they do not forfeit a second bond.
            Commitment storage commitment = _commitments[commitmentId];
            if (commitment.forfeitedAtBreachIdPlusOne == 0) {
                commitment.forfeitedAtBreachIdPlusOne = breachId + 1;
                emit BondForfeited(commitmentId, breachId, commitment.bond);
            }
        }
    }

    /* --------------------------------------------------------------------- *
     * Witness recording. PRD §27 Phase P3.
     * --------------------------------------------------------------------- */

    /// @notice Record who placed an order, read from the pool's `OrderPlaced`.
    /// @dev Callable only by the sampler, for the same reason sampling is: an
    /// attacker who could attribute an order to themselves could claim another
    /// trader's share. Write-once — the pool does not reissue an order id, so a
    /// second write could only replace a correct answer with a chosen one.
    function attributeOrder(uint128 orderId, address placedBy) external onlySampler {
        if (placedBy == address(0)) revert ZeroAddress();
        if (orderOwner[orderId] != address(0)) return; // already known, not an error
        orderOwner[orderId] = placedBy;
        emit OrderAttributed(orderId, placedBy);
    }

    /// @notice Record a fill by a taker, read from the pool's `OrderFilled`.
    /// @dev Only fills inside the window count. A fill outside it was not
    /// exposure to this commitment, and paying for it would pay someone for a
    /// risk they did not take — the mirror of PRD §14's rule that a sample
    /// outside the window is not coverage.
    /// @dev The owner is deliberately not resolved here. `OrderPlaced` and
    /// `OrderFilled` are separate logs arriving as separate callbacks in an
    /// order this contract does not control, so joining on arrival would drop
    /// every fill whose placement had not yet been seen.
    function witnessFill(uint256 commitmentId, uint128 takerOrderId, uint256 quantity)
        external
        onlySampler
    {
        if (commitmentId >= commitmentCount) revert NoSuchCommitment(commitmentId);
        if (quantity == 0) return;
        Commitment storage commitment = _commitments[commitmentId];
        if (block.number < commitment.start || block.number > commitment.end) return;

        _fillVolume[commitmentId][takerOrderId] += quantity;
        uint256 total = witnessedVolume[commitmentId] + quantity;
        witnessedVolume[commitmentId] = total;
        emit FillWitnessed(commitmentId, takerOrderId, quantity, total);
    }

    /// @notice Quantity a taker order filled inside a commitment's window.
    function fillVolumeOf(uint256 commitmentId, uint128 takerOrderId)
        external
        view
        returns (uint256)
    {
        return _fillVolume[commitmentId][takerOrderId];
    }

    /// @notice What {claim} would pay for these orders, without claiming.
    /// @dev Exposed so the arithmetic can be checked before signing, and so a
    /// verifier can reproduce a settled claim from storage alone.
    function claimableFor(uint256 breachId, uint128[] calldata orderIds)
        external
        view
        returns (uint256 volume, uint256 amount)
    {
        if (breachId >= breachCount) revert NoSuchBreach(breachId);
        uint256 commitmentId = _breaches[breachId].commitmentId;
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint128 orderId = orderIds[i];
            if (orderSettled[commitmentId][orderId]) continue;
            volume += _fillVolume[commitmentId][orderId];
        }
        uint256 total = witnessedVolume[commitmentId];
        amount = total == 0 ? 0 : (_commitments[commitmentId].bond * volume) / total;
    }

    /* --------------------------------------------------------------------- *
     * Settlement. PRD §23 beat 4, §27 Phase P3.
     * --------------------------------------------------------------------- */

    /// @notice Claim a share of a forfeited bond, as a trader who took liquidity
    /// while the commitment did not hold.
    ///
    /// @dev The claimant names the orders they placed. Each is checked against
    /// `orderOwner`, written from the pool's own `OrderPlaced` log, so a claim is
    /// never taken on the caller's word. An order they did not place reverts
    /// rather than being skipped: silently ignoring it would make a wrong claim
    /// look like a small one.
    ///
    /// @dev Pro-rata by witnessed volume, `bond * yourVolume / witnessedVolume`.
    /// Integer division truncates, so every share together is at most the bond
    /// and the remainder stays here. That direction is deliberate — rounding that
    /// could overpay would let the last claimant find the bond already spent.
    ///
    /// @dev Effects before interactions. Orders are marked settled and `paidOut`
    /// is raised before any ether moves, so a recipient that re-enters finds
    /// nothing left to claim. A failed send reverts the claim rather than being
    /// swallowed: a swallowed failure would mark the orders settled while paying
    /// nothing, the one outcome a claimant cannot recover from.
    function claim(uint256 breachId, uint128[] calldata orderIds)
        external
        returns (uint256 amount)
    {
        if (orderIds.length == 0) revert NoOrdersGiven();
        if (breachId >= breachCount) revert NoSuchBreach(breachId);

        uint256 commitmentId = _breaches[breachId].commitmentId;
        Commitment storage commitment = _commitments[commitmentId];
        if (commitment.forfeitedAtBreachIdPlusOne == 0) revert BondNotForfeited(commitmentId);

        // The window must be closed before anyone is paid, and this is a
        // correctness requirement rather than a policy.
        //
        // A share is `bond * yourVolume / witnessedVolume`, and `witnessedVolume`
        // keeps growing while the window is open. Paying against a denominator
        // that is not final overpays whoever claims first, and the invariant
        // caught it doing exactly that: with a bond of 1000 and one order of
        // volume 100, the first claim takes the whole 1000 — then a later fill
        // doubles the denominator and the next claim takes 500 more. 1500 paid
        // against a bond of 1000.
        //
        // Nobody can know their share until the last fill is in, so nobody may
        // be paid until then. `witnessFill` already refuses anything past `end`,
        // so once this passes the denominator can no longer move.
        if (block.number <= commitment.end) {
            revert WindowStillOpen(commitmentId, commitment.end, block.number);
        }

        uint256 total = witnessedVolume[commitmentId];
        if (total == 0) revert NoWitnessedVolume(commitmentId);

        uint256 volume;
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint128 orderId = orderIds[i];
            address placedBy = orderOwner[orderId];
            if (placedBy != msg.sender) revert NotTheOrderOwner(orderId, placedBy);
            if (orderSettled[commitmentId][orderId]) revert OrderAlreadySettled(orderId);
            orderSettled[commitmentId][orderId] = true;
            volume += _fillVolume[commitmentId][orderId];
        }
        if (volume == 0) revert NothingToClaim();

        amount = (commitment.bond * volume) / total;
        if (amount == 0) revert NothingToClaim();

        // Belt and braces. With the window closed the denominator is fixed and
        // the shares cannot sum past the bond, so this should never bind. It is
        // here because the arithmetic above is one line from paying out money
        // that was never bonded, and a bound that never binds costs a comparison
        // while an unbounded one cost this contract its first invariant run.
        uint256 remaining = commitment.bond - paidOut[commitmentId];
        if (amount > remaining) revert PayoutExceedsBond(commitmentId, amount, remaining);

        paidOut[commitmentId] += amount;
        emit BondClaimed(commitmentId, breachId, msg.sender, volume, amount);

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert PayoutFailed(msg.sender, amount);
    }

    /// @notice PRD §10. The verdict for a stored sample, re-derived from storage.
    /// @dev Mirrors `packages/reference` exactly; G2 compares the two over 10,000
    /// generated pairs. Nothing is cached: this reads the stored sample and the
    /// stored commitment and computes, which is what makes claim C-002 checkable
    /// by a stranger with only a public RPC.
    /// @dev An unknown `sampleId` reads a zeroed slot, whose `blockNumber` is 0,
    /// which the evaluator maps to `NOT_SAMPLED`. That is the honest answer: no
    /// sample by that id was observed.
    function verdictOf(uint256 sampleId) public view returns (VerdictState) {
        SampleRecord storage record = _samples[sampleId];
        Commitment storage commitment = _commitments[record.commitmentId];
        CommitmentEnvelope memory envelope = CommitmentEnvelope({
            maxSpread: commitment.maxSpread,
            minSize: commitment.minSize,
            start: commitment.start,
            end: commitment.end
        });
        return VerdictLib.verdict(envelope, record.sample);
    }

    /* --------------------------------------------------------------------- *
     * Views
     * --------------------------------------------------------------------- */

    function commitmentAt(uint256 commitmentId) external view returns (Commitment memory) {
        return _commitments[commitmentId];
    }

    function sampleAt(uint256 sampleId) external view returns (SampleRecord memory) {
        return _samples[sampleId];
    }

    function breachAt(uint256 breachId) external view returns (Breach memory) {
        return _breaches[breachId];
    }

    /// @notice The commitment id currently registered for a maker on a market.
    /// @return found Whether one exists at all, which distinguishes "no
    /// commitment" from "commitment zero" without overloading the id.
    function activeCommitmentOf(address maker, bytes32 marketId)
        external
        view
        returns (bool found, uint256 commitmentId)
    {
        uint256 plusOne = _activeCommitmentPlusOne[_activeKey(maker, marketId)];
        return (plusOne != 0, plusOne == 0 ? 0 : plusOne - 1);
    }

    /// @notice Whether a commitment's bond is forfeited, and on which breach.
    /// @dev Phase P3 attaches settlement to this. P1 records the fact only.
    function forfeitureOf(uint256 commitmentId)
        external
        view
        returns (bool forfeited, uint256 breachId)
    {
        uint256 plusOne = _commitments[commitmentId].forfeitedAtBreachIdPlusOne;
        return (plusOne != 0, plusOne == 0 ? 0 : plusOne - 1);
    }

    function _activeKey(address maker, bytes32 marketId) private pure returns (bytes32) {
        return keccak256(abi.encode(maker, marketId));
    }
}
