// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentPolicy} from "../contracts/AgentPolicy.sol";
import {PaidReviews} from "../contracts/PaidReviews.sol";
import {IERC8004Identity, IERC8004Reputation, IPriceFeed} from "../contracts/interfaces/IERC8004.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Deploy} from "./Deploy.sol";

contract PaidReviewsTest is Test, Deploy {
    uint256 constant SELLER_KEY = 0xA11CE;
    uint256 constant OTHER_KEY = 0xB0B;
    address seller = vm.addr(SELLER_KEY);
    address other = vm.addr(OTHER_KEY);
    address buyer = makeAddr("buyer");
    address guardian = makeAddr("guardian");
    uint256 buyerId;
    uint256 sellerId;
    uint256 otherId;
    uint256 private _n;

    event Reviewed(uint256 indexed agentId, uint256 indexed reviewerAgentId, uint8 score, bool checked, uint256 quote, uint256 feedPrice, uint256 feedUpdatedAt, bytes32 ref);
    event Mirrored(uint256 indexed agentId, bool ok);

    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(7e8); // Chainlink stand-in: 7.00 USD
        vm.prank(buyer);
        buyerId = identity.register("buyer");
        vm.prank(seller);
        sellerId = identity.register("seller");
        vm.prank(other);
        otherId = identity.register("other");
        vm.prank(buyer);
        policy.createPolicy(buyerId, guardian, 1 ether, 0.01 ether);
        vm.startPrank(guardian);
        policy.setRecipient(buyerId, seller, true);
        policy.setRecipient(buyerId, other, true);
        policy.setRecipient(buyerId, buyer, true);
        vm.stopPrank();
        policy.deposit{value: 0.5 ether}(buyerId);
    }

    function _pay(address to) private returns (bytes32 ref) {
        ref = keccak256(abi.encode("nonce", ++_n));
        vm.prank(buyer);
        policy.pay(buyerId, payable(to), 0.0005 ether, ref);
    }

    function _sign(uint256 key, uint256 agentId, uint128 quote, uint64 at, bytes32 ref) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toEthSignedMessageHash(reviews.quoteDigest(agentId, quote, at, ref)));
        return abi.encodePacked(r, s, v);
    }

    function _reviewQuote(uint128 quote) private returns (uint8) {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        bytes memory sig = _sign(SELLER_KEY, sellerId, quote, at, ref);
        vm.prank(buyer);
        return reviews.reviewQuote(ref, sellerId, quote, at, sig);
    }

    // ---------- score ----------

    function test_scoreFor_table() public view {
        assertEq(reviews.scoreFor(7e8, 7e8), 100);
        assertEq(reviews.scoreFor(7.07e8, 7e8), 88); // +1%
        assertEq(reviews.scoreFor(6.93e8, 7e8), 88); // -1%
        assertEq(reviews.scoreFor(7.35e8, 7e8), 40); // +5%
        assertEq(reviews.scoreFor(7.7e8, 7e8), 0); // +10% would be -20
        assertEq(reviews.scoreFor(0, 7e8), 0);
        assertEq(reviews.scoreFor(7e8, 0), 0);
        assertEq(reviews.scoreFor(100e8, 7e8), 0);
    }

    function testFuzz_scoreFor_isBoundedAndSymmetric(uint128 ref, uint128 delta) public view {
        ref = uint128(bound(ref, 1e4, 1e30));
        delta = uint128(bound(delta, 0, ref - 1));
        uint8 up = reviews.scoreFor(uint256(ref) + delta, ref);
        uint8 down = reviews.scoreFor(uint256(ref) - delta, ref);
        assertLe(up, 100);
        assertEq(up, down);
        if (delta == 0) assertEq(up, 100);
        // a larger deviation never scores higher
        assertGe(up, reviews.scoreFor(uint256(ref) + delta + ref / 100, ref));
    }

    // ---------- reviewQuote ----------

    function test_reviewQuote_scoreComesFromTheFeed_notFromTheReviewer() public {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        bytes memory sig = _sign(SELLER_KEY, sellerId, 7.07e8, at, ref);
        vm.expectEmit(true, true, false, true);
        emit Reviewed(sellerId, buyerId, 88, true, 7.07e8, 7e8, block.timestamp, ref);
        vm.expectEmit(true, false, false, true);
        emit Mirrored(sellerId, true);
        vm.prank(buyer);
        uint8 score = reviews.reviewQuote(ref, sellerId, 7.07e8, at, sig);
        assertEq(score, 88);
        (uint256 count, uint256 average, uint256 checkedCount) = reviews.getSummary(sellerId);
        assertEq(count, 1);
        assertEq(average, 88);
        assertEq(checkedCount, 1);
        PaidReviews.Review memory r = reviews.getReviews(sellerId)[0];
        assertEq(r.reviewerAgentId, buyerId);
        assertEq(r.client, buyer);
        assertTrue(r.checked);
        assertEq(r.quote, 7.07e8);
        assertEq(r.feedPrice, 7e8);
        assertEq(r.ref, ref);
        assertEq(r.tag, "price-accuracy");
    }

    function test_reviewQuote_needsAPayment() public {
        bytes32 ref = keccak256("never paid");
        bytes memory sig = _sign(SELLER_KEY, sellerId, 7e8, uint64(block.timestamp), ref);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NoSuchPayment.selector, ref));
        vm.prank(buyer);
        reviews.reviewQuote(ref, sellerId, 7e8, uint64(block.timestamp), sig);
    }

    function test_onePayment_oneReview() public {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        bytes memory sig = _sign(SELLER_KEY, sellerId, 7e8, at, ref);
        vm.startPrank(buyer);
        reviews.reviewQuote(ref, sellerId, 7e8, at, sig);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.AlreadyReviewed.selector, ref));
        reviews.reviewQuote(ref, sellerId, 7e8, at, sig);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.AlreadyReviewed.selector, ref));
        reviews.review(ref, sellerId, 0, "spam");
        vm.stopPrank();
    }

    function test_reviewQuote_onlyThePayer() public {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        bytes memory sig = _sign(SELLER_KEY, sellerId, 7e8, at, ref);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.NotAgentOwner.selector, buyerId, other));
        vm.prank(other);
        reviews.reviewQuote(ref, sellerId, 7e8, at, sig);
    }

    function test_reviewQuote_onlyTheAgentThatWasPaid() public {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        bytes memory sig = _sign(OTHER_KEY, otherId, 1e8, at, ref);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.NotThePayee.selector, otherId, seller));
        vm.prank(buyer);
        reviews.reviewQuote(ref, otherId, 1e8, at, sig);
    }

    function test_reviewQuote_reviewerCannotInventTheQuote() public {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        // the seller signed 7.00; the reviewer claims 1.00 to trash it
        bytes memory sig = _sign(SELLER_KEY, sellerId, 7e8, at, ref);
        vm.expectPartialRevert(PaidReviews.BadSellerSignature.selector);
        vm.prank(buyer);
        reviews.reviewQuote(ref, sellerId, 1e8, at, sig);
        // a signature for another payment does not fit either
        bytes32 ref2 = _pay(seller);
        vm.expectPartialRevert(PaidReviews.BadSellerSignature.selector);
        vm.prank(buyer);
        reviews.reviewQuote(ref2, sellerId, 7e8, at, sig);
    }

    function test_reviewQuote_quoteAgeWindow() public {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        bytes memory sig = _sign(SELLER_KEY, sellerId, 7e8, at, ref);
        vm.warp(block.timestamp + 10 minutes + 1);
        feed.set(7e8);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.QuoteTooOld.selector, at));
        vm.prank(buyer);
        reviews.reviewQuote(ref, sellerId, 7e8, at, sig);
        uint64 future = uint64(block.timestamp + 1 hours);
        sig = _sign(SELLER_KEY, sellerId, 7e8, future, ref);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.QuoteFromFuture.selector, future));
        vm.prank(buyer);
        reviews.reviewQuote(ref, sellerId, 7e8, future, sig);
    }

    function test_reviewQuote_staleOrBrokenFeed_reverts_andKeepsThePaymentReviewable() public {
        bytes32 ref = _pay(seller);
        uint64 at = uint64(block.timestamp);
        bytes memory sig = _sign(SELLER_KEY, sellerId, 7e8, at, ref);
        feed.setUpdatedAt(block.timestamp - 1 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.StaleFeed.selector, block.timestamp - 1 hours - 1));
        vm.prank(buyer);
        reviews.reviewQuote(ref, sellerId, 7e8, at, sig);
        feed.set(0);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.BadFeedAnswer.selector, int256(0)));
        vm.prank(buyer);
        reviews.reviewQuote(ref, sellerId, 7e8, at, sig);
        feed.set(-5);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.BadFeedAnswer.selector, int256(-5)));
        vm.prank(buyer);
        reviews.reviewQuote(ref, sellerId, 7e8, at, sig);
        assertFalse(policy.getPayment(ref).reviewed);
        feed.set(7e8);
        vm.prank(buyer);
        assertEq(reviews.reviewQuote(ref, sellerId, 7e8, at, sig), 100);
    }

    function test_selfReview_isRejected() public {
        // the buyer pays its own wallet, then tries to review its own agent
        bytes32 ref = _pay(buyer);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.SelfReview.selector, buyerId));
        vm.prank(buyer);
        reviews.review(ref, buyerId, 100, "self");
    }

    // ---------- review (unchecked) ----------

    function test_review_paymentBacked_scoreRange() public {
        bytes32 ref = _pay(seller);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.ScoreOutOfRange.selector, 101));
        vm.prank(buyer);
        reviews.review(ref, sellerId, 101, "report");
        vm.prank(buyer);
        reviews.review(ref, sellerId, 90, "report");
        (uint256 count, uint256 average, uint256 checkedCount) = reviews.getSummary(sellerId);
        assertEq(count, 1);
        assertEq(average, 90);
        assertEq(checkedCount, 0);
        assertFalse(reviews.getReviews(sellerId)[0].checked);
    }

    function test_average_overSeveralReviews() public {
        _reviewQuote(7e8); // 100
        _reviewQuote(7.35e8); // 40
        (uint256 count, uint256 average, ) = reviews.getSummary(sellerId);
        assertEq(count, 2);
        assertEq(average, 70);
    }

    // ---------- ERC-8004 mirror ----------

    function test_mirror_writesToErc8004_withThisContractAsClient() public {
        _reviewQuote(7.07e8);
        assertEq(erc8004.count(), 1);
        (uint256 agentId, address client, int128 value, string memory tag1, string memory tag2) = erc8004.entries(0);
        assertEq(agentId, sellerId);
        assertEq(client, address(reviews));
        assertEq(value, 88);
        assertEq(tag1, "price-accuracy");
        assertEq(tag2, "aida-chainlink-checked");
    }

    function test_mirror_failureDoesNotBlockTheReview() public {
        erc8004.setBroken(true);
        bytes32 ref = _pay(seller);
        vm.expectEmit(true, false, false, true);
        emit Mirrored(sellerId, false);
        vm.prank(buyer);
        reviews.review(ref, sellerId, 75, "report");
        (uint256 count, , ) = reviews.getSummary(sellerId);
        assertEq(count, 1);
        assertEq(erc8004.count(), 0);
    }

    // ---------- directory ----------

    function test_enroll_onlyOwner_once() public {
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.NotAgentOwner.selector, sellerId, buyer));
        vm.prank(buyer);
        reviews.enroll(sellerId);
        vm.startPrank(seller);
        reviews.enroll(sellerId);
        vm.expectRevert(abi.encodeWithSelector(PaidReviews.AlreadyEnrolled.selector, sellerId));
        reviews.enroll(sellerId);
        vm.stopPrank();
        uint256[] memory list = reviews.agents();
        assertEq(list.length, 1);
        assertEq(list[0], sellerId);
        assertTrue(reviews.isEnrolled(sellerId));
    }
}

/// @dev Runs against the live Fuji contracts: `FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc forge test --match-contract Fork`.
///      Skipped when FUJI_RPC_URL is not set, so the default `forge test` needs no network.
contract ForkCanonicalTest is Test {
    address constant IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address constant CHAINLINK_AVAX_USD = 0x5498BB86BC934c8D34FDA08E81D444153d0D06aD;

    PaidReviews reviews;
    AgentPolicy policy;
    uint256 constant SELLER_KEY = 0xA11CE;
    address seller = vm.addr(SELLER_KEY);
    address buyer = makeAddr("fork-buyer");
    address guardian = makeAddr("fork-guardian");
    uint256 buyerId;
    uint256 sellerId;

    function _register(address who) private returns (uint256) {
        vm.prank(who);
        (, bytes memory out) = IDENTITY.call(abi.encodeWithSignature("register(string)", "data:application/json;base64,e30="));
        return abi.decode(out, (uint256));
    }

    function _sign(uint128 quote, uint64 at, bytes32 ref) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SELLER_KEY, MessageHashUtils.toEthSignedMessageHash(reviews.quoteDigest(sellerId, quote, at, ref)));
        return abi.encodePacked(r, s, v);
    }

    function test_fork_canonicalRegistries_acceptAidaReviews() public {
        string memory rpc = vm.envOr("FUJI_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        reviews = new PaidReviews(IERC8004Identity(IDENTITY), AgentPolicy(predicted), IPriceFeed(CHAINLINK_AVAX_USD), IERC8004Reputation(REPUTATION));
        policy = new AgentPolicy(IERC8004Identity(IDENTITY), address(reviews));
        assertEq(address(policy), predicted);

        buyerId = _register(buyer);
        sellerId = _register(seller);
        assertEq(IERC8004Identity(IDENTITY).ownerOf(sellerId), seller);

        vm.prank(buyer);
        policy.createPolicy(buyerId, guardian, 1 ether, 0.01 ether);
        vm.prank(guardian);
        policy.setRecipient(buyerId, seller, true);
        policy.deposit{value: 0.1 ether}(buyerId);
        bytes32 ref = keccak256("fork nonce");
        vm.prank(buyer);
        policy.pay(buyerId, payable(seller), 0.0005 ether, ref);

        (, int256 answer, , , ) = IPriceFeed(CHAINLINK_AVAX_USD).latestRoundData();
        bytes memory sig = _sign(uint128(uint256(answer)), uint64(block.timestamp), ref);
        vm.prank(buyer);
        uint256 gasBefore = gasleft();
        uint8 score = reviews.reviewQuote(ref, sellerId, uint128(uint256(answer)), uint64(block.timestamp), sig);
        emit log_named_uint("reviewQuote gas (incl. ERC-8004 mirror)", gasBefore - gasleft());
        assertEq(score, 100);

        // the canonical ERC-8004 Reputation Registry now holds the review, with PaidReviews as the client
        address[] memory clients = new address[](1);
        clients[0] = address(reviews);
        (, bytes memory out) = REPUTATION.staticcall(abi.encodeWithSignature("getSummary(uint256,address[],string,string)", sellerId, clients, "", ""));
        (uint64 count, int128 value, ) = abi.decode(out, (uint64, int128, uint8));
        assertEq(count, 1);
        assertEq(value, 100);
    }
}
