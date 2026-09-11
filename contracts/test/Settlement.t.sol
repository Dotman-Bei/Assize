// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssizeRegistry} from "../src/AssizeRegistry.sol";
import {Sample, SampleSource, VerdictState} from "../src/VerdictLib.sol";

/// @notice PRD §23 beat 4 and §27 Phase P3: a bond forfeited by a breach is
/// paid to the traders who took liquidity while the commitment did not hold.
///
/// @dev The invariant run in `BondConservation.t.sol` drives this path with
/// arbitrary sequences and is what found the overpayment fixed below. These
/// tests pin each rule individually, so a future change that breaks one gets a
/// named failure rather than a random counterexample.
contract SettlementTest is Test {
    AssizeRegistry internal registry;

    address internal maker = makeAddr("maker");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant MARKET = keccak256("market-under-test");

    uint128 internal constant MAX_SPREAD = 200;
    uint128 internal constant MIN_SIZE = 1000;
    uint256 internal constant BOND = 1 ether;

    uint64 internal start;
    uint64 internal end;
    uint256 internal commitmentId;

    /// @dev This contract is the registry's subscriber, so it may attribute
    /// orders and witness fills. That mirrors the deployment, where only
    /// `CoverageSubscriber` can, and it is the property `attributeOrder` leans
    /// on: an attacker who could name themselves the owner of someone else's
    /// order could claim that trader's share.
    function setUp() public {
        registry = new AssizeRegistry(address(this));
        vm.roll(1000);
        vm.deal(maker, 10 ether);

        start = uint64(block.number);
        end = start + 500;
        vm.prank(maker);
        commitmentId =
            registry.publishCommitment{value: BOND}(MARKET, MAX_SPREAD, MIN_SIZE, start, end);
    }

    /* ------------------------------ helpers ------------------------------ */

    function _breach() internal returns (uint256 breachId) {
        // Spread 500 against a committed maximum of 200.
        registry.recordSample(
            commitmentId,
            Sample({
                bid: 4750,
                ask: 5250,
                bidSize: 5000,
                askSize: 5000,
                blockNumber: uint64(block.number),
                blockHash: keccak256("pin"),
                source: SampleSource.REACTIVITY
            })
        );
        assertEq(registry.breachCount(), 1, "the sample must have breached");
        return 0;
    }

    function _one(uint128 orderId) internal pure returns (uint128[] memory ids) {
        ids = new uint128[](1);
        ids[0] = orderId;
    }

    function _closeWindow() internal {
        vm.roll(uint256(end) + 1);
    }

    /* --------------------------- the happy path --------------------------- */

    /// @notice A sole witnessed trader takes the whole bond.
    function test_a_witnessed_trader_is_paid_the_forfeited_bond() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);
        uint256 breachId = _breach();
        _closeWindow();

        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 paid = registry.claim(breachId, _one(1));

        assertEq(paid, BOND, "a sole witness takes the whole bond");
        assertEq(alice.balance - before, BOND, "the ether actually arrived");
        assertEq(address(registry).balance, 0, "the bond left the registry");
        assertEq(registry.paidOut(commitmentId), BOND);
    }

    /// @notice Two traders split it in proportion to what they filled.
    function test_the_bond_splits_pro_rata_by_witnessed_volume() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 300);
        registry.attributeOrder(2, bob);
        registry.witnessFill(commitmentId, 2, 100);
        uint256 breachId = _breach();
        _closeWindow();

        assertEq(registry.witnessedVolume(commitmentId), 400);

        vm.prank(alice);
        uint256 toAlice = registry.claim(breachId, _one(1));
        vm.prank(bob);
        uint256 toBob = registry.claim(breachId, _one(2));

        assertEq(toAlice, (BOND * 300) / 400, "three quarters of the volume, three quarters of the bond");
        assertEq(toBob, (BOND * 100) / 400);
        assertEq(toAlice + toBob, BOND, "and together they are the bond");
    }

    /// @notice The quoted figure is what gets paid.
    function test_claimableFor_matches_what_claim_pays() public {
        registry.attributeOrder(7, alice);
        registry.witnessFill(commitmentId, 7, 250);
        registry.attributeOrder(8, bob);
        registry.witnessFill(commitmentId, 8, 750);
        uint256 breachId = _breach();
        _closeWindow();

        (uint256 volume, uint256 quoted) = registry.claimableFor(breachId, _one(7));
        assertEq(volume, 250);

        vm.prank(alice);
        assertEq(registry.claim(breachId, _one(7)), quoted, "the quote must be the payment");
    }

    /* ------------------------------- guards ------------------------------- */

    /// @notice The regression test for the overpayment the invariant found.
    ///
    /// @dev A share is `bond * yourVolume / witnessedVolume`, and the
    /// denominator grows for as long as the window is open. Paying against a
    /// denominator that is not final overpaid whoever claimed first: with one
    /// order of volume 100 the first claim took the whole bond, and a later fill
    /// then let a second claim take half of it again.
    function test_no_claim_before_the_window_closes() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);
        uint256 breachId = _breach();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssizeRegistry.WindowStillOpen.selector, commitmentId, end, block.number
            )
        );
        registry.claim(breachId, _one(1));
    }

    /// @notice And the overpayment itself cannot be reproduced once it closes.
    function test_late_volume_cannot_make_the_payouts_exceed_the_bond() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);
        uint256 breachId = _breach();

        // A second fill lands while the window is still open. This is the
        // sequence that broke the arithmetic when claiming was allowed early.
        registry.attributeOrder(2, bob);
        registry.witnessFill(commitmentId, 2, 100);
        _closeWindow();

        vm.prank(alice);
        uint256 toAlice = registry.claim(breachId, _one(1));
        vm.prank(bob);
        uint256 toBob = registry.claim(breachId, _one(2));

        assertEq(toAlice, BOND / 2, "the denominator was final before anyone was paid");
        assertEq(toBob, BOND / 2);
        assertLe(toAlice + toBob, BOND, "payouts may never exceed the bond");
    }

    /// @notice You cannot claim for an order you did not place.
    /// @dev It reverts rather than being skipped: silently ignoring it would
    /// make a wrong claim look like a small one.
    function test_only_the_order_owner_may_claim_it() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);
        uint256 breachId = _breach();
        _closeWindow();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AssizeRegistry.NotTheOrderOwner.selector, uint128(1), alice)
        );
        registry.claim(breachId, _one(1));
    }

    /// @notice An order pays once.
    function test_an_order_cannot_be_claimed_twice() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);
        uint256 breachId = _breach();
        _closeWindow();

        vm.prank(alice);
        registry.claim(breachId, _one(1));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AssizeRegistry.OrderAlreadySettled.selector, uint128(1))
        );
        registry.claim(breachId, _one(1));
    }

    /// @notice A fill outside the window is not exposure to this commitment.
    /// @dev The mirror of PRD §14's rule that a sample outside the window is not
    /// coverage. Paying for it would pay someone for a risk they did not take.
    function test_a_fill_outside_the_window_is_not_witnessed() public {
        _closeWindow();
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);

        assertEq(registry.witnessedVolume(commitmentId), 0, "a late fill counts for nothing");
        assertEq(registry.fillVolumeOf(commitmentId, 1), 0);
    }

    /// @notice An order id is never reattributed.
    /// @dev The pool does not reissue an order id, so a second write could only
    /// replace a correct answer with a chosen one.
    function test_order_attribution_is_write_once() public {
        registry.attributeOrder(1, alice);
        registry.attributeOrder(1, bob);
        assertEq(registry.orderOwner(1), alice, "the first attribution stands");
    }

    /// @notice Witness writes are as restricted as sampling is.
    function test_only_the_sampler_may_attribute_or_witness() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotSampler.selector, stranger));
        registry.attributeOrder(1, stranger);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NotSampler.selector, stranger));
        registry.witnessFill(commitmentId, 1, 100);
    }

    /// @notice No payout where no bond forfeited.
    function test_no_claim_against_a_commitment_that_held() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);
        // A sample that holds: spread 200 is exactly the committed maximum.
        registry.recordSample(
            commitmentId,
            Sample({
                bid: 4900,
                ask: 5100,
                bidSize: 5000,
                askSize: 5000,
                blockNumber: uint64(block.number),
                blockHash: keccak256("pin"),
                source: SampleSource.REACTIVITY
            })
        );
        assertEq(registry.breachCount(), 0, "that sample must not have breached");

        _closeWindow();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AssizeRegistry.NoSuchBreach.selector, uint256(0)));
        registry.claim(0, _one(1));
    }

    /// @notice A trader who never traded has nothing to claim.
    function test_a_trader_with_no_volume_claims_nothing() public {
        registry.attributeOrder(1, alice);
        registry.witnessFill(commitmentId, 1, 100);
        registry.attributeOrder(2, bob); // placed, never filled
        uint256 breachId = _breach();
        _closeWindow();

        vm.prank(bob);
        vm.expectRevert(AssizeRegistry.NothingToClaim.selector);
        registry.claim(breachId, _one(2));
    }

    function test_claim_needs_at_least_one_order() public {
        uint256 breachId = _breach();
        _closeWindow();
        vm.prank(alice);
        vm.expectRevert(AssizeRegistry.NoOrdersGiven.selector);
        registry.claim(breachId, new uint128[](0));
    }
}
