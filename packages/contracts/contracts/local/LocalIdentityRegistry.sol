// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title Local stand-in for the ERC-8004 Identity Registry
/// @notice Used only on the local Hardhat chain and in tests. It has the same `register(string)`, `setAgentURI`,
///         `ownerOf`, `tokenURI` and `Registered` event as the canonical registry AIDA uses on Fuji.
///         It is NOT deployed on Fuji.
contract LocalIdentityRegistry is ERC721URIStorage {
    error NotAgentOwner(uint256 agentId, address caller);

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    uint256 private _lastId;

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = ++_lastId;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);
        emit Registered(agentId, agentURI, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }
}
