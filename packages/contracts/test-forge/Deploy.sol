// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {AgentPolicy} from "../contracts/AgentPolicy.sol";
import {PaidReviews} from "../contracts/PaidReviews.sol";
import {LocalIdentityRegistry} from "../contracts/local/LocalIdentityRegistry.sol";
import {IERC8004Identity} from "../contracts/interfaces/IERC8004.sol";
import {MockPriceFeed, MockReputationRegistry} from "../contracts/local/Mocks.sol";

/// @dev Deploys the two contracts the way scripts/deploy.ts does: PaidReviews gets the address AgentPolicy will
///      have (next nonce), so both references are immutable and nobody holds an admin key.
abstract contract Deploy is CommonBase {
    LocalIdentityRegistry identity;
    MockPriceFeed feed;
    MockReputationRegistry erc8004;
    PaidReviews reviews;
    AgentPolicy policy;

    function _deploy(int256 feedAnswer) internal {
        identity = new LocalIdentityRegistry();
        feed = new MockPriceFeed(feedAnswer);
        erc8004 = new MockReputationRegistry();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        reviews = new PaidReviews(IERC8004Identity(address(identity)), AgentPolicy(predicted), feed, erc8004);
        policy = new AgentPolicy(IERC8004Identity(address(identity)), address(reviews));
        require(address(policy) == predicted, "address prediction failed");
    }
}
