// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC8004Identity, IERC8004Reputation, IPriceFeed} from "./interfaces/IERC8004.sol";
import {AgentPolicy} from "./AgentPolicy.sol";

/// @title AIDA Paid Reviews
/// @notice Reviews of ERC-8004 agents that can only be written after a payment through AgentPolicy.
///         One payment allows one review. For a price quote the reviewer does not choose the score:
///         the seller signs its quote, and this contract reads the Chainlink feed and computes the score.
///         Every review is also written to the ERC-8004 Reputation Registry (the canonical one on Fuji) with this
///         contract as the client, so any ERC-8004 reader can filter for payment-backed reviews.
///         No owner, no admin, no upgrade.
contract PaidReviews {
    using ECDSA for bytes32;

    error NotAgentOwner(uint256 agentId, address caller);
    error NotThePayee(uint256 agentId, address payee);
    error SelfReview(uint256 agentId);
    error BadSellerSignature(address recovered, address seller);
    error QuoteTooOld(uint256 quotedAt);
    error QuoteFromFuture(uint256 quotedAt);
    error BadFeedAnswer(int256 answer);
    error StaleFeed(uint256 updatedAt);
    error ScoreOutOfRange(uint8 score);
    error AlreadyEnrolled(uint256 agentId);
    error ZeroAddress();

    struct Review {
        uint256 reviewerAgentId;
        address client;
        uint8 score;
        bool checked; // true: score computed here from a seller-signed quote and the Chainlink feed
        uint64 timestamp;
        uint128 quote; // feed decimals; 0 when not checked
        uint128 feedPrice; // Chainlink answer used; 0 when not checked
        uint64 feedUpdatedAt;
        bytes32 ref; // the payment this review belongs to
        string tag;
    }

    event Enrolled(uint256 indexed agentId, address indexed owner);
    event Reviewed(uint256 indexed agentId, uint256 indexed reviewerAgentId, uint8 score, bool checked, uint256 quote, uint256 feedPrice, uint256 feedUpdatedAt, bytes32 ref);
    /// @dev `ok` is false when the ERC-8004 registry rejected the copy; the review above still stands.
    event Mirrored(uint256 indexed agentId, bool ok);

    /// @notice A signed quote is only accepted for review this long after the seller signed it.
    uint256 public constant MAX_QUOTE_AGE = 10 minutes;
    /// @notice The Chainlink answer must be at most this old.
    uint256 public constant MAX_FEED_AGE = 1 hours;
    /// @notice Points lost per 1% deviation from the feed.
    uint256 public constant POINTS_PER_PERCENT = 12;

    IERC8004Identity public immutable identity;
    AgentPolicy public immutable policy;
    IPriceFeed public immutable feed;
    uint8 public immutable feedDecimals;
    /// @notice ERC-8004 Reputation Registry that receives a copy of every review (address(0) = none).
    IERC8004Reputation public immutable erc8004;

    mapping(uint256 => Review[]) private _reviews;
    mapping(uint256 => uint256) private _total;
    mapping(uint256 => uint256) private _checkedCount;
    uint256[] private _agents;
    mapping(uint256 => bool) public isEnrolled;

    constructor(IERC8004Identity identity_, AgentPolicy policy_, IPriceFeed feed_, IERC8004Reputation erc8004_) {
        if (address(identity_) == address(0) || address(policy_) == address(0) || address(feed_) == address(0)) revert ZeroAddress();
        identity = identity_;
        policy = policy_;
        feed = feed_;
        feedDecimals = feed_.decimals();
        erc8004 = erc8004_;
    }

    // ---------- directory ----------

    /// @notice The owner of an ERC-8004 identity lists it in the AIDA directory.
    function enroll(uint256 agentId) external {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        if (isEnrolled[agentId]) revert AlreadyEnrolled(agentId);
        isEnrolled[agentId] = true;
        _agents.push(agentId);
        emit Enrolled(agentId, msg.sender);
    }

    function agents() external view returns (uint256[] memory) {
        return _agents;
    }

    // ---------- reviews ----------

    /// @notice What the seller signs (EIP-191 personal_sign over this hash) when it answers a paid quote request.
    function quoteDigest(uint256 agentId, uint128 quote, uint64 quotedAt, bytes32 ref) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, agentId, quote, quotedAt, ref));
    }

    /// @notice 100 for an exact match, minus 12 points per 1% deviation from the reference, floored at 0.
    function scoreFor(uint256 quote, uint256 reference_) public pure returns (uint8) {
        if (quote == 0 || reference_ == 0) return 0;
        uint256 diff = quote > reference_ ? quote - reference_ : reference_ - quote;
        if (diff >= reference_) return 0;
        uint256 penalty = (diff * 100 * POINTS_PER_PERCENT + reference_ / 2) / reference_;
        return penalty >= 100 ? 0 : uint8(100 - penalty);
    }

    /// @notice Review a price quote. The score is not an input: it is computed from the seller's signed quote and
    ///         the Chainlink feed read in this transaction.
    /// @param ref the payment (keccak256 of the 402 nonce) that bought this quote
    /// @param agentId the seller's ERC-8004 agent id
    /// @param quote the quoted price in feed decimals, as signed by the seller
    /// @param quotedAt the seller's timestamp, as signed
    /// @param sellerSig the seller's signature over quoteDigest(agentId, quote, quotedAt, ref)
    function reviewQuote(bytes32 ref, uint256 agentId, uint128 quote, uint64 quotedAt, bytes calldata sellerSig) external returns (uint8 score) {
        (uint256 reviewerId, address payee) = _consume(ref, agentId);
        _checkSellerSignature(payee, agentId, quote, quotedAt, ref, sellerSig);
        (uint128 feedPrice, uint64 updatedAt) = _readFeed();
        score = scoreFor(quote, feedPrice);
        _checkedCount[agentId] += 1;
        _store(agentId, Review(reviewerId, msg.sender, score, true, uint64(block.timestamp), quote, feedPrice, updatedAt, ref, "price-accuracy"));
    }

    function _checkSellerSignature(address payee, uint256 agentId, uint128 quote, uint64 quotedAt, bytes32 ref, bytes calldata sellerSig) private view {
        address signer = MessageHashUtils.toEthSignedMessageHash(quoteDigest(agentId, quote, quotedAt, ref)).recover(sellerSig);
        if (signer != payee) revert BadSellerSignature(signer, payee);
        if (quotedAt > block.timestamp + 60) revert QuoteFromFuture(quotedAt);
        if (block.timestamp > quotedAt + MAX_QUOTE_AGE) revert QuoteTooOld(quotedAt);
    }

    function _readFeed() private view returns (uint128 price, uint64 updatedAt) {
        (, int256 answer, , uint256 at, ) = feed.latestRoundData();
        if (answer <= 0 || uint256(answer) > type(uint128).max) revert BadFeedAnswer(answer);
        if (block.timestamp > at + MAX_FEED_AGE) revert StaleFeed(at);
        return (uint128(uint256(answer)), uint64(at));
    }

    /// @notice Review any other paid job. Payment-backed, but the score is the reviewer's own judgement.
    function review(bytes32 ref, uint256 agentId, uint8 score, string calldata tag) external {
        if (score > 100) revert ScoreOutOfRange(score);
        (uint256 reviewerId, ) = _consume(ref, agentId);
        _store(agentId, Review(reviewerId, msg.sender, score, false, uint64(block.timestamp), 0, 0, 0, ref, tag));
    }

    function _consume(bytes32 ref, uint256 agentId) private returns (uint256 reviewerId, address payee) {
        (reviewerId, payee) = policy.consumeForReview(ref);
        if (identity.ownerOf(reviewerId) != msg.sender) revert NotAgentOwner(reviewerId, msg.sender);
        if (identity.ownerOf(agentId) != payee) revert NotThePayee(agentId, payee);
        if (payee == msg.sender) revert SelfReview(agentId);
    }

    function _store(uint256 agentId, Review memory r) private {
        _reviews[agentId].push(r);
        _total[agentId] += r.score;
        emit Reviewed(agentId, r.reviewerAgentId, r.score, r.checked, r.quote, r.feedPrice, r.feedUpdatedAt, r.ref);
        if (address(erc8004) != address(0)) {
            // A copy for every ERC-8004 reader. The registry is an upgradeable third-party proxy, so its failure
            // must not block AIDA's own record.
            try erc8004.giveFeedback(agentId, int128(uint128(r.score)), 0, r.tag, r.checked ? "aida-chainlink-checked" : "aida-paid", "", "", bytes32(0)) {
                emit Mirrored(agentId, true);
            } catch {
                emit Mirrored(agentId, false);
            }
        }
    }

    // ---------- views ----------

    function getSummary(uint256 agentId) external view returns (uint256 count, uint256 average, uint256 checkedCount) {
        count = _reviews[agentId].length;
        average = count == 0 ? 0 : _total[agentId] / count;
        checkedCount = _checkedCount[agentId];
    }

    function getReviews(uint256 agentId) external view returns (Review[] memory) {
        return _reviews[agentId];
    }
}
