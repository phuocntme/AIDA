// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC8004Identity} from "./interfaces/IERC8004.sol";

/// @title AIDA Validation Registry (ERC-8004-style, simplified: one validator answers once with 0-100)
/// @notice An agent owner asks an independent validator (re-runner, auditor, TEE oracle) to check a piece of work.
///         The validator answers once with a 0-100 score; results are tied to the agent identity.
contract ValidationRegistry {
    error NotAgentOwner(uint256 agentId, address caller);
    error InvalidValidator();
    error SelfValidation(uint256 agentId);
    error RequestNotFound(uint256 requestId);
    error NotValidator(uint256 requestId, address caller);
    error AlreadyResponded(uint256 requestId);
    error ScoreOutOfRange(uint8 score);

    struct Request {
        uint256 agentId;
        address validator;
        string requestURI;
        bool responded;
        uint8 response;
        string responseURI;
        uint64 requestedAt;
        uint64 respondedAt;
    }

    event ValidationRequested(uint256 indexed requestId, uint256 indexed agentId, address indexed validator, string requestURI);
    event ValidationResponded(uint256 indexed requestId, uint256 indexed agentId, uint8 response);

    IERC8004Identity public immutable identity;

    uint256 private _lastId;
    mapping(uint256 => Request) private _requests;
    mapping(uint256 => uint256[]) private _byAgent;
    mapping(uint256 => uint256) private _respondedCount;
    mapping(uint256 => uint256) private _responseTotal;

    constructor(IERC8004Identity identity_) {
        identity = identity_;
    }

    function requestValidation(uint256 agentId, address validator, string calldata requestURI) external returns (uint256 requestId) {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        if (validator == address(0)) revert InvalidValidator();
        if (validator == msg.sender) revert SelfValidation(agentId);
        requestId = ++_lastId;
        _requests[requestId] = Request(agentId, validator, requestURI, false, 0, "", uint64(block.timestamp), 0);
        _byAgent[agentId].push(requestId);
        emit ValidationRequested(requestId, agentId, validator, requestURI);
    }

    function respond(uint256 requestId, uint8 response, string calldata responseURI) external {
        Request storage r = _requests[requestId];
        if (r.agentId == 0) revert RequestNotFound(requestId);
        if (r.validator != msg.sender) revert NotValidator(requestId, msg.sender);
        if (r.responded) revert AlreadyResponded(requestId);
        if (response > 100) revert ScoreOutOfRange(response);
        r.responded = true;
        r.response = response;
        r.responseURI = responseURI;
        r.respondedAt = uint64(block.timestamp);
        _respondedCount[r.agentId] += 1;
        _responseTotal[r.agentId] += response;
        emit ValidationResponded(requestId, r.agentId, response);
    }

    function getRequest(uint256 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    function getAgentRequests(uint256 agentId) external view returns (uint256[] memory) {
        return _byAgent[agentId];
    }

    function getSummary(uint256 agentId) external view returns (uint256 count, uint256 average) {
        count = _respondedCount[agentId];
        average = count == 0 ? 0 : _responseTotal[agentId] / count;
    }
}
