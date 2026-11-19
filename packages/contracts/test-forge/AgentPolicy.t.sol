// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentPolicy} from "../contracts/AgentPolicy.sol";
import {LocalIdentityRegistry} from "../contracts/local/LocalIdentityRegistry.sol";
import {Deploy} from "./Deploy.sol";

contract Rejector {
    receive() external payable {
        revert("no");
    }
}

/// @dev Tries to re-enter pay() when it receives money.
contract Reenterer {
    AgentPolicy public policy;
    uint256 public agentId;
    bool public tried;
    function arm(AgentPolicy p, uint256 id) external {
        policy = p;
        agentId = id;
    }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
    function register(LocalIdentityRegistry id) external returns (uint256) {
        return id.register("data:application/json;base64,e30=");
    }
    function create(uint256 id, address guardian) external {
        policy.createPolicy(id, guardian, 1 ether, 1 ether);
    }
    function payOut(address payable to, uint128 amount) external {
        policy.pay(agentId, to, amount, bytes32(uint256(1)));
    }
    receive() external payable {
        if (!tried) {
            tried = true;
            policy.pay(agentId, payable(address(this)), 0.1 ether, bytes32(uint256(2)));
        }
    }
}

contract AgentPolicyTest is Test, Deploy {
    uint256 private _n;

    /// @dev every payment needs its own ref
    function _ref() private returns (bytes32) {
        return bytes32(++_n);
    }

    address agent = makeAddr("agent");
    address guardian = makeAddr("guardian");
    address seller = makeAddr("seller");
    address other = makeAddr("other");
    uint256 id;

    event Paid(uint256 indexed agentId, address indexed to, uint256 amount, bytes32 ref);

    function setUp() public {
        vm.warp(1_800_000_000);
        _deploy(7e8);
        vm.prank(agent);
        id = identity.register("data:application/json;base64,e30=");
        vm.prank(agent);
        policy.createPolicy(id, guardian, 0.01 ether, 0.002 ether);
        vm.prank(guardian);
        policy.setRecipient(id, seller, true);
        vm.deal(agent, 1 ether);
        vm.prank(agent);
        policy.deposit{value: 0.05 ether}(id);
    }

    function test_createPolicy_onlyIdentityOwner_once() public {
        vm.prank(other);
        uint256 id2 = identity.register("x");
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotAgent.selector, id2, agent));
        vm.prank(agent);
        policy.createPolicy(id2, guardian, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.PolicyExists.selector, id));
        vm.prank(agent);
        policy.createPolicy(id, guardian, 1, 1);
        vm.expectRevert(AgentPolicy.ZeroAddress.selector);
        vm.prank(other);
        policy.createPolicy(id2, address(0), 1, 1);
    }

    function test_pay_happyPath_movesMoneyAndEmits() public {
        bytes32 ref = keccak256("nonce-1");
        vm.expectEmit(true, true, false, true);
        emit Paid(id, seller, 0.0005 ether, ref);
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.0005 ether, ref);
        assertEq(seller.balance, 0.0005 ether);
        AgentPolicy.Policy memory p = policy.getPolicy(id);
        assertEq(p.balance, 0.05 ether - 0.0005 ether);
        assertEq(p.spentToday, 0.0005 ether);
        assertEq(address(policy).balance, 0.0495 ether);
    }

    function test_pay_onlyAgent() public {
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotAgent.selector, id, guardian));
        vm.prank(guardian);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotAgent.selector, id, other));
        vm.prank(other);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
    }

    function test_identityTransfer_freezesPayments_untilGuardianRebinds() public {
        vm.prank(agent);
        identity.transferFrom(agent, other, id);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotAgent.selector, id, agent));
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotAgent.selector, id, other));
        vm.prank(other);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotGuardian.selector, id, other));
        vm.prank(other);
        policy.rebindAgent(id);
        vm.prank(guardian);
        policy.rebindAgent(id);
        assertEq(policy.getPolicy(id).agent, other);
        vm.prank(other);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
        assertEq(seller.balance, 0.0005 ether);
    }

    function test_ref_canBePaidOnlyOnce_andIsRecorded() public {
        bytes32 ref = keccak256("nonce-1");
        vm.startPrank(agent);
        policy.pay(id, payable(seller), 0.0005 ether, ref);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.RefUsed.selector, ref));
        policy.pay(id, payable(seller), 0.0005 ether, ref);
        vm.stopPrank();
        AgentPolicy.Payment memory pm = policy.getPayment(ref);
        assertEq(pm.to, seller);
        assertEq(pm.agentId, id);
        assertFalse(pm.reviewed);
        AgentPolicy.Policy memory p = policy.getPolicy(id);
        assertEq(p.payments, 1);
        assertEq(p.totalPaid, 0.0005 ether);
    }

    function test_consumeForReview_onlyPaidReviews() public {
        bytes32 ref = keccak256("nonce-1");
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.0005 ether, ref);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotReviews.selector, agent));
        vm.prank(agent);
        policy.consumeForReview(ref);
        vm.startPrank(address(reviews));
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NoSuchPayment.selector, bytes32(uint256(77))));
        policy.consumeForReview(bytes32(uint256(77)));
        policy.consumeForReview(ref);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.AlreadyReviewed.selector, ref));
        policy.consumeForReview(ref);
        vm.stopPrank();
    }

    function test_killSwitch_blocksPayments_andResumes() public {
        vm.prank(guardian);
        policy.setPaused(id, true);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.AgentPaused.selector, id));
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
        vm.prank(guardian);
        policy.setPaused(id, false);
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
        assertEq(seller.balance, 0.0005 ether);
    }

    function test_onlyGuardian_controls() public {
        bytes memory err = abi.encodeWithSelector(AgentPolicy.NotGuardian.selector, id, agent);
        vm.startPrank(agent);
        vm.expectRevert(err);
        policy.setPaused(id, true);
        vm.expectRevert(err);
        policy.setRecipient(id, other, true);
        vm.expectRevert(err);
        policy.setLimits(id, 1 ether, 1 ether);
        vm.expectRevert(err);
        policy.withdraw(id, 0.01 ether);
        vm.expectRevert(err);
        policy.setGuardian(id, agent);
        vm.stopPrank();
    }

    function test_whitelist_blocksUnknownRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.RecipientNotAllowed.selector, id, other));
        vm.prank(agent);
        policy.pay(id, payable(other), 0.0005 ether, _ref());
        vm.prank(guardian);
        policy.setRecipient(id, seller, false);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.RecipientNotAllowed.selector, id, seller));
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
    }

    function test_recipients_listHasNoDuplicates() public {
        vm.startPrank(guardian);
        policy.setRecipient(id, other, true);
        policy.setRecipient(id, other, false);
        policy.setRecipient(id, other, true);
        vm.stopPrank();
        address[] memory list = policy.recipients(id);
        assertEq(list.length, 2);
        assertEq(list[0], seller);
        assertEq(list[1], other);
    }

    function test_perPaymentCap() public {
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.OverPerPaymentCap.selector, 0.003 ether, 0.002 ether));
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.003 ether, _ref());
    }

    function test_dailyCap_andResetNextDay() public {
        vm.startPrank(agent);
        for (uint256 i; i < 5; i++) policy.pay(id, payable(seller), 0.002 ether, _ref());
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.OverDailyCap.selector, 0.01 ether, 0.0005 ether, 0.01 ether));
        policy.pay(id, payable(seller), 0.0005 ether, _ref());
        vm.warp(block.timestamp + 1 days);
        assertEq(policy.getPolicy(id).spentToday, 0);
        policy.pay(id, payable(seller), 0.002 ether, _ref());
        vm.stopPrank();
        assertEq(seller.balance, 0.012 ether);
    }

    function test_insufficientBalance_andZeroAmount() public {
        vm.prank(guardian);
        policy.setLimits(id, 1 ether, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.InsufficientBalance.selector, 0.05 ether, 0.06 ether));
        vm.prank(agent);
        policy.pay(id, payable(seller), 0.06 ether, _ref());
        vm.expectRevert(AgentPolicy.AmountZero.selector);
        vm.prank(agent);
        policy.pay(id, payable(seller), 0, _ref());
    }

    function test_failedTransfer_revertsWholePayment() public {
        Rejector r = new Rejector();
        vm.prank(guardian);
        policy.setRecipient(id, address(r), true);
        vm.expectRevert(AgentPolicy.TransferFailed.selector);
        vm.prank(agent);
        policy.pay(id, payable(address(r)), 0.001 ether, _ref());
        assertEq(policy.getPolicy(id).balance, 0.05 ether);
        assertEq(policy.getPolicy(id).spentToday, 0);
    }

    function test_reentrancy_isBlocked() public {
        Reenterer bad = new Reenterer();
        uint256 id2 = bad.register(identity);
        bad.arm(policy, id2);
        bad.create(id2, guardian);
        vm.prank(guardian);
        policy.setRecipient(id2, address(bad), true);
        policy.deposit{value: 0.5 ether}(id2);
        vm.expectRevert(AgentPolicy.TransferFailed.selector);
        bad.payOut(payable(address(bad)), 0.1 ether);
        assertEq(policy.getPolicy(id2).balance, 0.5 ether);
    }

    function test_deposit_andWithdraw_onlyToGuardian() public {
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NoPolicy.selector, 99));
        policy.deposit{value: 1}(99);
        vm.expectRevert(AgentPolicy.AmountZero.selector);
        policy.deposit{value: 0}(id);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.InsufficientBalance.selector, 0.05 ether, 1 ether));
        vm.prank(guardian);
        policy.withdraw(id, 1 ether);
        vm.prank(guardian);
        policy.withdraw(id, 0.02 ether);
        assertEq(guardian.balance, 0.02 ether);
        assertEq(policy.getPolicy(id).balance, 0.03 ether);
    }

    function test_operator_canOnlyPauseAndResume() public {
        address op = makeAddr("operator");
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotGuardian.selector, id, op));
        vm.prank(op);
        policy.setPaused(id, true);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotGuardian.selector, id, agent));
        vm.prank(agent);
        policy.setOperator(id, agent);
        vm.prank(guardian);
        policy.setOperator(id, op);
        assertEq(policy.operator(id), op);
        vm.startPrank(op);
        policy.setPaused(id, true);
        assertTrue(policy.getPolicy(id).paused);
        policy.setPaused(id, false);
        assertFalse(policy.getPolicy(id).paused);
        // everything else stays with the guardian
        bytes memory err = abi.encodeWithSelector(AgentPolicy.NotGuardian.selector, id, op);
        vm.expectRevert(err);
        policy.withdraw(id, 0.01 ether);
        vm.expectRevert(err);
        policy.setLimits(id, 1 ether, 1 ether);
        vm.expectRevert(err);
        policy.setRecipient(id, op, true);
        vm.expectRevert(err);
        policy.setGuardian(id, op);
        vm.expectRevert(err);
        policy.setOperator(id, other);
        vm.expectRevert(err);
        policy.rebindAgent(id);
        vm.stopPrank();
        // the guardian removes the operator
        vm.prank(guardian);
        policy.setOperator(id, address(0));
        vm.expectRevert(err);
        vm.prank(op);
        policy.setPaused(id, true);
    }

    function test_setGuardian_movesControl() public {
        vm.prank(guardian);
        policy.setGuardian(id, other);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.NotGuardian.selector, id, guardian));
        vm.prank(guardian);
        policy.setPaused(id, true);
        vm.prank(other);
        policy.setPaused(id, true);
        assertTrue(policy.getPolicy(id).paused);
    }

    function testFuzz_neverSpendsMoreThanDailyCap(uint128[8] memory amounts) public {
        vm.prank(guardian);
        policy.setLimits(id, 0.01 ether, 0.01 ether);
        uint256 sent;
        for (uint256 i; i < amounts.length; i++) {
            uint128 a = uint128(bound(amounts[i], 1, 0.01 ether));
            vm.prank(agent);
            try policy.pay(id, payable(seller), a, 0) {
                sent += a;
            } catch {}
        }
        assertLe(sent, 0.01 ether);
        assertEq(seller.balance, sent);
        assertEq(policy.getPolicy(id).balance, 0.05 ether - sent);
    }
}
