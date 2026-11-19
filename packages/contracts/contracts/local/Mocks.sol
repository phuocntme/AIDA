// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC8004Reputation, IPriceFeed} from "../interfaces/IERC8004.sol";

/// @notice Local stand-in for the Chainlink AVAX/USD feed (local chain and tests only).
contract MockPriceFeed is IPriceFeed {
    uint8 public constant decimals = 8;
    int256 public answer;
    uint80 public round;
    uint256 private _fixedAt; // 0 = always fresh (reports the current block time)

    constructor(int256 answer_) {
        set(answer_);
    }

    function set(int256 answer_) public {
        answer = answer_;
        _fixedAt = 0;
        round++;
    }

    /// @dev Tests use this to make the answer look stale.
    function setUpdatedAt(uint256 t) external {
        _fixedAt = t;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 at = _fixedAt == 0 ? block.timestamp : _fixedAt;
        return (round, answer, at, at, round);
    }
}

/// @notice Local stand-in for the ERC-8004 Reputation Registry: records what PaidReviews mirrors (tests only).
contract MockReputationRegistry is IERC8004Reputation {
    struct Entry {
        uint256 agentId;
        address client;
        int128 value;
        string tag1;
        string tag2;
    }

    Entry[] public entries;
    bool public broken;

    function setBroken(bool b) external {
        broken = b;
    }

    function count() external view returns (uint256) {
        return entries.length;
    }

    function giveFeedback(uint256 agentId, int128 value, uint8, string calldata tag1, string calldata tag2, string calldata, string calldata, bytes32) external {
        require(!broken, "registry down");
        entries.push(Entry(agentId, msg.sender, value, tag1, tag2));
    }
}
