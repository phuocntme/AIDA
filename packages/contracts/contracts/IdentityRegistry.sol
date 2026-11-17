// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title AIDA Identity Registry (ERC-8004 style)
/// @notice Every AI agent gets a transferable ERC-721 identity whose tokenURI points to its agent card.
contract IdentityRegistry is ERC721URIStorage {
    error EmptyURI();
    error NotAgentOwner(uint256 agentId, address caller);

    event Registered(uint256 indexed agentId, address indexed owner, string agentURI);
    event URIUpdated(uint256 indexed agentId, string agentURI);

    uint256 private _lastId;

    constructor() ERC721("AIDA Agent Identity", "AIDA") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        if (bytes(agentURI).length == 0) revert EmptyURI();
        agentId = ++_lastId;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);
        emit Registered(agentId, msg.sender, agentURI);
    }

    function setAgentURI(uint256 agentId, string calldata agentURI) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        if (bytes(agentURI).length == 0) revert EmptyURI();
        _setTokenURI(agentId, agentURI);
        emit URIUpdated(agentId, agentURI);
    }

    function exists(uint256 agentId) external view returns (bool) {
        return _ownerOf(agentId) != address(0);
    }

    function totalAgents() external view returns (uint256) {
        return _lastId;
    }
}
