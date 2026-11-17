// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IdentityRegistry} from "./IdentityRegistry.sol";

/// @title AIDA Reputation Registry (ERC-8004 style)
/// @notice Clients leave 0-100 scores for agents registered in the IdentityRegistry.
contract ReputationRegistry {
    error AgentNotFound(uint256 agentId);
    error SelfFeedback(uint256 agentId);
    error ScoreOutOfRange(uint8 score);

    struct Feedback {
        address client;
        uint8 score;
        bytes32 tag;
        string uri;
        uint64 timestamp;
    }

    event NewFeedback(uint256 indexed agentId, address indexed client, uint8 score, bytes32 tag);

    IdentityRegistry public immutable identity;

    mapping(uint256 => Feedback[]) private _feedback;
    mapping(uint256 => uint256) private _totalScore;

    constructor(IdentityRegistry identity_) {
        identity = identity_;
    }

    function giveFeedback(uint256 agentId, uint8 score, bytes32 tag, string calldata uri) external {
        if (!identity.exists(agentId)) revert AgentNotFound(agentId);
        if (score > 100) revert ScoreOutOfRange(score);
        if (identity.ownerOf(agentId) == msg.sender) revert SelfFeedback(agentId);
        _feedback[agentId].push(Feedback(msg.sender, score, tag, uri, uint64(block.timestamp)));
        _totalScore[agentId] += score;
        emit NewFeedback(agentId, msg.sender, score, tag);
    }

    function getSummary(uint256 agentId) external view returns (uint256 count, uint256 average) {
        count = _feedback[agentId].length;
        average = count == 0 ? 0 : _totalScore[agentId] / count;
    }

    function getFeedback(uint256 agentId) external view returns (Feedback[] memory) {
        return _feedback[agentId];
    }
}
