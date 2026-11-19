// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The part of the ERC-8004 Identity Registry (reference implementation v2) that AIDA reads.
///         On Fuji this is the canonical registry at 0x8004A818BFB912233c491871b3d84c89A494BD9e.
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @notice The write entry point of the ERC-8004 Reputation Registry (reference implementation v2).
///         On Fuji this is the canonical registry at 0x8004B663056A597Dffe9eCcC1965A193B7388713.
interface IERC8004Reputation {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/// @notice Chainlink price feed (AggregatorV3Interface subset).
interface IPriceFeed {
    function decimals() external view returns (uint8);

    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
