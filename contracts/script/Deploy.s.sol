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
    /// @dev Grouped so the run function keeps a shallow stack.
    struct Config {
        address pool;
        bytes32 marketId;
        uint128 maxSpread;
        uint128 minSize;
        uint64 windowBlocks;
        uint256 bond;
        uint256 deployerKey;
        uint256 makerKey;
    }

    function _config() internal view returns (Config memory) {
        return Config({
            pool: vm.envAddress("DREAMDEX_POOL_ADDRESS"),
            marketId: vm.envBytes32("DREAMDEX_MARKET_ID"),
            maxSpread: uint128(vm.envUint("ASSIZE_MAX_SPREAD")),
            minSize: uint128(vm.envUint("ASSIZE_MIN_SIZE")),
            windowBlocks: uint64(vm.envUint("ASSIZE_WINDOW_BLOCKS")),
            bond: vm.envUint("ASSIZE_BOND_WEI"),
            deployerKey: vm.envUint("DEPLOYER_PRIVATE_KEY"),
            makerKey: vm.envUint("MAKER_PRIVATE_KEY")
        });
    }

    function run() external {
        Config memory cfg = _config();

        // Two keys, because the deployer becomes the registry owner and the
        // owner can register a keeper who may write samples directly. A single
        // key doing both could fabricate the samples judging its own commitment
        // (DECISIONS.md D-019).
        address deployer = vm.addr(cfg.deployerKey);
        require(deployer != vm.addr(cfg.makerKey), "deployer and maker must differ (D-019)");

        // nonce + 1: the registry is deployed first and consumes the current one.
        address predictedSubscriber =
            vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);

        vm.broadcast(cfg.deployerKey);
        AssizeRegistry registry = new AssizeRegistry(predictedSubscriber);

        // The maker posts its own bond, from its own key. Its transaction comes
        // from a different account and does not advance the deployer's nonce, so
        // the prediction above still holds.
        uint64 start = uint64(block.number + 1);
        vm.broadcast(cfg.makerKey);
        uint256 commitmentId = registry.publishCommitment{value: cfg.bond}(
            cfg.marketId, cfg.maxSpread, cfg.minSize, start, start + cfg.windowBlocks
        );

        vm.broadcast(cfg.deployerKey);
        CoverageSubscriber subscriber =
            new CoverageSubscriber(IBinaryPool(cfg.pool), registry, commitmentId);

        require(address(subscriber) == predictedSubscriber, "subscriber address prediction failed");
        require(registry.subscriber() == address(subscriber), "registry is not wired to subscriber");

        console.log("AssizeRegistry     ", address(registry));
        console.log("CoverageSubscriber ", address(subscriber));
        console.log("commitmentId       ", commitmentId);
        console.log("window blocks      ", start, "to", start + cfg.windowBlocks);
        console.log("");
        console.log("Next: fund the subscriber, then call subscribe().");
        console.log("It must hold SUBSCRIPTION_OWNER_MINIMUM_BALANCE before subscribe() succeeds,");
        console.log("and stay above (gas price + priorityFee) * gasLimit at every firing or the");
        console.log("subscription is REMOVED, not skipped (DECISIONS.md D-020).");
    }
}
