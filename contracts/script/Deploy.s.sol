// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {AssizeRegistry} from "../src/AssizeRegistry.sol";
import {CoverageSubscriber} from "../src/CoverageSubscriber.sol";
import {IBinaryPool} from "../src/interfaces/IBinaryPool.sol";

/// @title Deploy
/// @notice Phase P2 deployment. PRD §16 and §19: `DEPLOYMENT.md` is generated
/// from this script, so the script is the record of what was deployed.
///
/// @dev PRD §17: no address is compiled in. The pool and the commitment arrive
/// from the environment, discovered by `pnpm probe:dreamdex`.
///
/// @dev Deployment order is forced by both contracts being immutable in each
/// other's direction: the registry takes its subscriber in the constructor, and
/// the subscriber takes its registry. Neither can be set afterwards, because
/// PRD §10 allows the owner to register a keeper "and nothing else" — a settable
/// subscriber would be an admin path to redirect who may write samples.
///
/// The circle is closed by computing the subscriber's address before deploying
/// it, which `CREATE` makes deterministic from the deployer and its nonce. The
/// script asserts the prediction held, so a mis-predicted address fails here
/// rather than producing a registry that no subscriber can write to.
/// See DECISIONS.md D-017.
contract Deploy is Script {
    function run() external {
        address pool = vm.envAddress("DREAMDEX_POOL_ADDRESS");
        uint32 maxSpread = uint32(vm.envUint("ASSIZE_MAX_SPREAD"));
        uint128 minSize = uint128(vm.envUint("ASSIZE_MIN_SIZE"));
        uint64 windowBlocks = uint64(vm.envUint("ASSIZE_WINDOW_BLOCKS"));
        uint256 bond = vm.envUint("ASSIZE_BOND_WEI");
        bytes32 marketId = vm.envBytes32("DREAMDEX_MARKET_ID");

        vm.startBroadcast();
        address deployer = msg.sender;

        // nonce + 1: the registry is deployed first and consumes the current one.
        address predictedSubscriber =
            vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);

        AssizeRegistry registry = new AssizeRegistry(predictedSubscriber);

        uint64 start = uint64(block.number + 1);
        uint256 commitmentId = registry.publishCommitment{value: bond}(
            marketId, maxSpread, minSize, start, start + windowBlocks
        );

        CoverageSubscriber subscriber =
            new CoverageSubscriber(IBinaryPool(pool), registry, commitmentId);

        require(address(subscriber) == predictedSubscriber, "subscriber address prediction failed");
        require(registry.subscriber() == address(subscriber), "registry is not wired to subscriber");

        vm.stopBroadcast();

        console.log("AssizeRegistry     ", address(registry));
        console.log("CoverageSubscriber ", address(subscriber));
        console.log("commitmentId       ", commitmentId);
        console.log("window blocks      ", start, "to", start + windowBlocks);
        console.log("");
        console.log("Next: fund the subscriber, then call subscribe().");
        console.log("The pinned library requires the subscriber to hold at least");
        console.log("SUBSCRIPTION_OWNER_MINIMUM_BALANCE before subscribe() succeeds,");
        console.log("and it pays per-callback gas from the same balance afterwards.");
        console.log("An unfunded subscription is silent NOT_SAMPLED (PRD 8.2).");
    }
}
