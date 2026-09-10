// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

import {AssizeRegistry} from "../src/AssizeRegistry.sol";
import {CoverageSubscriber} from "../src/CoverageSubscriber.sol";
import {IBinaryPool, OrderBookLevel} from "../src/interfaces/IBinaryPool.sol";
import {SampleSource, VerdictLib, VerdictState} from "../src/VerdictLib.sol";
import {SomniaExtensions} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

/// @notice Samples a real DreamDEX pool on a fork of Shannon testnet.
///
/// @dev This is the one test that reads a live book. Everything else runs against
/// a local fixture, and a fixture agrees with whatever it was written to agree
/// with. The pinned starter template flags `OrderBookLevel` as the one struct to
/// confirm against a deployed pool before relying on it; this is that
/// confirmation, executed rather than argued.
///
/// @dev Nothing is deployed by this test. A fork is local state: the registry and
/// subscriber exist only inside the test, and no transaction is broadcast.
///
/// @dev Skips when `SOMNIA_RPC_URL` and `DREAMDEX_POOL_ADDRESS` are absent, so a
/// fresh clone with no network still runs a green suite. PRD §22 gates run on a
/// fresh clone, and a test that needs the internet cannot be one of them.
///
/// @dev IT DOES NOT RUN AGAINST SHANNON'S PUBLIC RPC TODAY, and that is a
/// property of the endpoint rather than of this code. Both published endpoints —
/// `dream-rpc.somnia.network` and `api.infra.testnet.somnia.network` — return
/// `method not found` for `eth_getProof`, reject EIP-1898 block-hash parameters
/// with `invalid parameters`, and answer `eth_getStorageAt` with a bare `0x`
/// rather than a 32-byte word. forge's fork backend needs those, and fails in
/// `setUp` with "failed to get account". Established by testing each call
/// directly against both endpoints; see DECISIONS.md D-018.
///
/// It is kept rather than deleted because it is not failing on a defect in this
/// repository, and it will work unchanged against an archive node that serves
/// those methods. What it would have confirmed — that `getBookLevels` really
/// returns `{price, quantity}` best-first, and what `oneCollateral` really is —
/// is confirmed instead by `pnpm probe:dreamdex`, which reads a live pool
/// without forking and is covered by gate G1.
contract ForkSamplingTest is Test {
    AssizeRegistry internal registry;
    CoverageSubscriber internal subscriber;
    IBinaryPool internal pool;

    address internal maker = makeAddr("maker");
    bytes32 internal constant MARKET = keccak256("fork-market");
    address internal constant PRECOMPILE =
        SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS;

    /// @dev Wide enough that a live book is unlikely to breach it, so the test
    /// asserts the sampling machinery rather than the market's behaviour today.
    uint128 internal constant MAX_SPREAD = 100_000;

    function _configured() internal view returns (bool) {
        return bytes(vm.envOr("SOMNIA_RPC_URL", string(""))).length > 0
            && vm.envOr("DREAMDEX_POOL_ADDRESS", address(0)) != address(0);
    }

    function setUp() public {
        if (!_configured()) {
            return;
        }
        // Pinned by block NUMBER, never by hash.
        //
        // Shannon's public RPC does not serve `eth_getProof` (-32601) and rejects
        // EIP-1898 block-hash parameters (-32602), and forge's fork backend uses
        // a block-hash specifier when a fork is created without an explicit
        // number. Doing that here fails in `setUp` with "failed to get account".
        // Passing a number keeps every request on the numeric block parameter the
        // node does serve. Recorded for the SDK feedback report (PRD §20).
        uint256 forkBlock = vm.envOr("SOMNIA_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) {
            vm.createSelectFork(vm.envString("SOMNIA_RPC_URL"));
        } else {
            vm.createSelectFork(vm.envString("SOMNIA_RPC_URL"), forkBlock);
        }
        pool = IBinaryPool(vm.envAddress("DREAMDEX_POOL_ADDRESS"));

        vm.deal(maker, 100 ether);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        registry = new AssizeRegistry(predicted);

        vm.prank(maker);
        uint256 commitmentId = registry.publishCommitment{value: 1 ether}(
            MARKET, MAX_SPREAD, 1, uint64(block.number), uint64(block.number + 10_000)
        );
        subscriber = new CoverageSubscriber(pool, registry, commitmentId);
    }

    /// @notice The book read works against a real pool, and the layout is what
    /// two pinned sources said it was.
    function test_book_layout_is_what_upstream_documented() public {
        if (!_configured()) {
            vm.skip(true);
        }
        OrderBookLevel[] memory bids = pool.getBookLevels(true, 5);
        OrderBookLevel[] memory asks = pool.getBookLevels(false, 5);

        if (bids.length == 0 || asks.length == 0) {
            // A one-sided book is a real state, not a failure. It is exactly what
            // PRD §14 calls pulling a side, and the evaluator calls it ABSENT.
            console.log("live book has an empty side; nothing to confirm this run");
            return;
        }

        // Price is a probability in the market's own units, so it sits strictly
        // inside (0, oneCollateral). A quantity would not: this is what tells the
        // two fields apart, and it is why the field order can be confirmed rather
        // than assumed.
        assertGt(bids[0].price, 0, "a bid price of zero is not a price");
        assertLt(bids[0].price, 1_000_000, "a probability must be below one whole contract");
        assertLt(asks[0].price, 1_000_000, "a probability must be below one whole contract");
        assertLe(bids[0].price, asks[0].price, "a live book should not be crossed");

        // Best price first, on both sides.
        for (uint256 i = 1; i < bids.length; ++i) {
            assertLe(bids[i].price, bids[i - 1].price, "bids must descend from the best");
        }
        for (uint256 i = 1; i < asks.length; ++i) {
            assertGe(asks[i].price, asks[i - 1].price, "asks must ascend from the best");
        }

        console.log("live best bid price", bids[0].price, "size", bids[0].quantity);
        console.log("live best ask price", asks[0].price, "size", asks[0].quantity);
        console.log("absolute spread    ", asks[0].price - bids[0].price);
        // Rendered the way frontend.md renders it: basis points of one contract.
        console.log("spread bps of 1.0  ", ((asks[0].price - bids[0].price) * 10_000) / 1_000_000);
    }

    /// @notice The whole Path R chain, end to end, against a live book: the
    /// precompile calls the handler, the handler reads the pool, and the registry
    /// stores a labelled, block-pinned sample it can re-derive a verdict from.
    function test_sampling_a_live_book_end_to_end() public {
        if (!_configured()) {
            vm.skip(true);
        }
        OrderBookLevel[] memory bids = pool.getBookLevels(true, 1);
        OrderBookLevel[] memory asks = pool.getBookLevels(false, 1);

        bytes32[] memory topics = new bytes32[](0);
        vm.prank(PRECOMPILE);
        subscriber.onEvent(address(pool), topics, "");

        assertEq(registry.sampleCount(), 1, "no sample was written");
        AssizeRegistry.SampleRecord memory stored = registry.sampleAt(0);

        // The sample carries the book that was actually on chain.
        assertEq(stored.sample.bid, bids.length == 0 ? 0 : uint128(bids[0].price));
        assertEq(stored.sample.ask, asks.length == 0 ? 0 : uint128(asks[0].price));
        assertEq(stored.sample.bidSize, bids.length == 0 ? 0 : uint128(bids[0].quantity));
        assertEq(stored.sample.askSize, asks.length == 0 ? 0 : uint128(asks[0].quantity));

        // AGENTS.md: a sample without a source label is a bug, not a sample.
        assertEq(uint256(stored.sample.source), uint256(SampleSource.REACTIVITY));

        // PRD §6: the pin must resolve. D-016: it is the parent hash.
        assertEq(stored.sample.blockNumber, uint64(block.number));
        assertEq(stored.sample.blockHash, blockhash(block.number - 1));
        assertTrue(stored.sample.blockHash != bytes32(0), "an unpinned sample is not evidence");

        VerdictState state = registry.verdictOf(0);
        console.log("verdict on the live book:", uint256(state));
        // Whatever the book was doing, the verdict is a real state and the two
        // sides of the record agree: a breach is recorded exactly when the
        // re-derived verdict says so.
        assertEq(registry.breachCount(), VerdictLib.isBreach(state) ? 1 : 0);
    }
}
