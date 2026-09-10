// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SomniaExtensions} from
    "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

/// @notice Pins the funding numbers `scripts/preflight.ts` reasons with to the
/// pinned library's own constants.
///
/// @dev The preflight cannot import Solidity constants, so it carries copies. A
/// copy that silently drifts from upstream is how a deployment ends up underfunded
/// and a subscription ends up removed mid-window — PRD §8.2's silent NOT_SAMPLED.
/// This makes that drift fail a test instead.
contract FundingConstantsTest is Test {
    function test_preflight_numbers_match_the_pinned_library() public pure {
        assertEq(
            SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE,
            32 ether,
            "SUBSCRIPTION_OWNER_MINIMUM_BALANCE moved; update scripts/preflight.ts"
        );
        assertEq(
            SomniaExtensions.MINIMUM_BASE_FEE_PER_GAS,
            6 gwei,
            "MINIMUM_BASE_FEE_PER_GAS moved; update scripts/preflight.ts"
        );
        // The recommended gasLimit must stay inside what a subscription may ask
        // for, and clear of the default that would raise the balance floor.
        assertLe(uint256(1_000_000), uint256(SomniaExtensions.MAXIMUM_HANDLER_GAS_LIMIT));
        assertLt(uint256(1_000_000), uint256(SomniaExtensions.DEFAULT_HANDLER_GAS_LIMIT));
    }
}
