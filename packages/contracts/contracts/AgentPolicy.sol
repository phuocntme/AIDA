// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC8004Identity} from "./interfaces/IERC8004.sol";

/// @title AIDA Agent Policy
/// @notice A spending policy that an AI agent's payments go through. Each policy belongs to one ERC-8004 agent
///         identity. The agent (the wallet that owned the identity when the policy was created) can only pay.
///         A human guardian sets the daily cap, the per-payment cap and the recipient whitelist, can pause the
///         agent (kill switch) and is the only one who can withdraw. The guardian may name an operator whose
///         only power is the kill switch.
///         Every payment is recorded under its `ref` (keccak256 of the seller's 402 nonce). A seller checks that
///         record before serving, and PaidReviews consumes it once, so one payment allows exactly one review.
///         No owner, no admin, no upgrade: `identity` and `reviews` are fixed at deployment.
contract AgentPolicy is ReentrancyGuard {
    error PolicyExists(uint256 agentId);
    error NoPolicy(uint256 agentId);
    error NotAgent(uint256 agentId, address caller);
    error NotGuardian(uint256 agentId, address caller);
    error ZeroAddress();
    error AgentPaused(uint256 agentId);
    error RecipientNotAllowed(uint256 agentId, address to);
    error AmountZero();
    error AmountTooLarge();
    error OverPerPaymentCap(uint256 amount, uint256 cap);
    error OverDailyCap(uint256 spentToday, uint256 amount, uint256 cap);
    error InsufficientBalance(uint256 balance, uint256 amount);
    error TransferFailed();
    error RefUsed(bytes32 ref);
    error NotReviews(address caller);
    error NoSuchPayment(bytes32 ref);
    error AlreadyReviewed(bytes32 ref);

    /// @dev Packed so that pay() writes three slots of the policy (0, 2, 3) plus one slot for the payment record.
    struct Policy {
        address guardian;
        uint96 totalPaid; // all-time amount paid through this policy
        uint128 dailyCap;
        uint128 perPaymentCap;
        uint128 balance;
        uint128 spentToday;
        address agent; // the only wallet that may call pay()
        uint32 day; // unix day of `spentToday`
        uint48 payments; // number of payments made through this policy
        bool paused;
        bool exists;
    }

    /// @dev One slot per payment.
    struct Payment {
        address to;
        uint64 agentId;
        bool reviewed;
    }

    event PolicyCreated(uint256 indexed agentId, address indexed agent, address indexed guardian, uint256 dailyCap, uint256 perPaymentCap);
    event LimitsSet(uint256 indexed agentId, uint256 dailyCap, uint256 perPaymentCap);
    event RecipientSet(uint256 indexed agentId, address indexed to, bool allowed);
    event PausedSet(uint256 indexed agentId, bool paused);
    event GuardianChanged(uint256 indexed agentId, address indexed guardian);
    event OperatorSet(uint256 indexed agentId, address indexed operator);
    event AgentRebound(uint256 indexed agentId, address indexed agent);
    event Deposited(uint256 indexed agentId, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed agentId, address indexed to, uint256 amount);
    /// @dev `ref` is keccak256(x402 nonce): it binds the payment to one 402 challenge.
    event Paid(uint256 indexed agentId, address indexed to, uint256 amount, bytes32 ref);

    /// @notice ERC-8004 Identity Registry (the canonical one on Fuji).
    IERC8004Identity public immutable identity;
    /// @notice The PaidReviews contract: the only caller allowed to consume a payment for a review.
    address public immutable reviews;

    /// @notice Optional second key that may only pause and resume the agent (an on-call kill switch).
    ///         It cannot withdraw, change limits, edit the whitelist or replace anyone. Set by the guardian.
    mapping(uint256 => address) public operator;
    mapping(uint256 => Policy) private _policies;
    mapping(bytes32 => Payment) private _payments;
    mapping(uint256 => mapping(address => bool)) public isAllowed;
    mapping(uint256 => address[]) private _recipients;
    mapping(uint256 => mapping(address => bool)) private _listed;

    constructor(IERC8004Identity identity_, address reviews_) {
        if (address(identity_) == address(0) || reviews_ == address(0)) revert ZeroAddress();
        identity = identity_;
        reviews = reviews_;
    }

    modifier onlyGuardian(uint256 agentId) {
        Policy storage p = _policies[agentId];
        if (!p.exists) revert NoPolicy(agentId);
        if (msg.sender != p.guardian) revert NotGuardian(agentId, msg.sender);
        _;
    }

    /// @notice The agent puts itself under a guardian. Called once by the identity owner.
    function createPolicy(uint256 agentId, address guardian, uint128 dailyCap, uint128 perPaymentCap) external {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgent(agentId, msg.sender);
        if (guardian == address(0)) revert ZeroAddress();
        if (agentId > type(uint64).max) revert AmountTooLarge();
        Policy storage p = _policies[agentId];
        if (p.exists) revert PolicyExists(agentId);
        p.guardian = guardian;
        p.agent = msg.sender;
        p.dailyCap = dailyCap;
        p.perPaymentCap = perPaymentCap;
        p.exists = true;
        emit PolicyCreated(agentId, msg.sender, guardian, dailyCap, perPaymentCap);
    }

    // ---------- guardian ----------

    function setLimits(uint256 agentId, uint128 dailyCap, uint128 perPaymentCap) external onlyGuardian(agentId) {
        _policies[agentId].dailyCap = dailyCap;
        _policies[agentId].perPaymentCap = perPaymentCap;
        emit LimitsSet(agentId, dailyCap, perPaymentCap);
    }

    function setRecipient(uint256 agentId, address to, bool allowed) external onlyGuardian(agentId) {
        if (to == address(0)) revert ZeroAddress();
        if (allowed && !_listed[agentId][to]) {
            _listed[agentId][to] = true;
            _recipients[agentId].push(to);
        }
        isAllowed[agentId][to] = allowed;
        emit RecipientSet(agentId, to, allowed);
    }

    /// @notice Kill switch. The guardian, or the operator the guardian named, may pause and resume.
    function setPaused(uint256 agentId, bool paused) external {
        Policy storage p = _policies[agentId];
        if (!p.exists) revert NoPolicy(agentId);
        if (msg.sender != p.guardian && msg.sender != operator[agentId]) revert NotGuardian(agentId, msg.sender);
        p.paused = paused;
        emit PausedSet(agentId, paused);
    }

    /// @notice Names (or with address(0) removes) the pause-only operator.
    function setOperator(uint256 agentId, address operator_) external onlyGuardian(agentId) {
        operator[agentId] = operator_;
        emit OperatorSet(agentId, operator_);
    }

    function setGuardian(uint256 agentId, address guardian) external onlyGuardian(agentId) {
        if (guardian == address(0)) revert ZeroAddress();
        _policies[agentId].guardian = guardian;
        emit GuardianChanged(agentId, guardian);
    }

    /// @notice If the identity NFT moved, payments stay frozen until the guardian accepts its new owner.
    function rebindAgent(uint256 agentId) external onlyGuardian(agentId) {
        address owner = identity.ownerOf(agentId);
        _policies[agentId].agent = owner;
        emit AgentRebound(agentId, owner);
    }

    function withdraw(uint256 agentId, uint128 amount) external nonReentrant onlyGuardian(agentId) {
        Policy storage p = _policies[agentId];
        if (amount > p.balance) revert InsufficientBalance(p.balance, amount);
        p.balance -= amount;
        emit Withdrawn(agentId, msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------- anyone ----------

    function deposit(uint256 agentId) external payable {
        Policy storage p = _policies[agentId];
        if (!p.exists) revert NoPolicy(agentId);
        if (msg.value == 0) revert AmountZero();
        if (msg.value > type(uint128).max) revert AmountTooLarge();
        p.balance += uint128(msg.value);
        emit Deposited(agentId, msg.sender, msg.value);
    }

    // ---------- agent ----------

    /// @notice The only way the agent can move the policy's money. Every rule is checked here, on-chain.
    function pay(uint256 agentId, address payable to, uint128 amount, bytes32 ref) external nonReentrant {
        Policy storage p = _policies[agentId];
        if (!p.exists) revert NoPolicy(agentId);
        // Both must hold: the caller is the wallet bound to the policy and still owns the identity.
        if (msg.sender != p.agent || identity.ownerOf(agentId) != msg.sender) revert NotAgent(agentId, msg.sender);
        if (p.paused) revert AgentPaused(agentId);
        if (!isAllowed[agentId][to]) revert RecipientNotAllowed(agentId, to);
        if (amount == 0) revert AmountZero();
        if (amount > p.perPaymentCap) revert OverPerPaymentCap(amount, p.perPaymentCap);
        uint32 today = uint32(block.timestamp / 1 days);
        if (p.day != today) {
            p.day = today;
            p.spentToday = 0;
        }
        if (p.spentToday + amount > p.dailyCap) revert OverDailyCap(p.spentToday, amount, p.dailyCap);
        if (amount > p.balance) revert InsufficientBalance(p.balance, amount);
        if (_payments[ref].to != address(0)) revert RefUsed(ref);
        p.spentToday += amount;
        p.balance -= amount;
        p.payments += 1;
        p.totalPaid += uint96(amount); // amount <= balance, far below 2^96 wei
        _payments[ref] = Payment(to, uint64(agentId), false);
        emit Paid(agentId, to, amount, ref);
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------- PaidReviews ----------

    /// @notice Marks a payment as reviewed and returns who paid whom. One payment, one review.
    function consumeForReview(bytes32 ref) external returns (uint256 agentId, address to) {
        if (msg.sender != reviews) revert NotReviews(msg.sender);
        Payment storage pm = _payments[ref];
        if (pm.to == address(0)) revert NoSuchPayment(ref);
        if (pm.reviewed) revert AlreadyReviewed(ref);
        pm.reviewed = true;
        return (pm.agentId, pm.to);
    }

    // ---------- views ----------

    function getPolicy(uint256 agentId) external view returns (Policy memory p) {
        p = _policies[agentId];
        if (p.day != uint32(block.timestamp / 1 days)) p.spentToday = 0;
    }

    function getPayment(bytes32 ref) external view returns (Payment memory) {
        return _payments[ref];
    }

    function recipients(uint256 agentId) external view returns (address[] memory list) {
        address[] storage all = _recipients[agentId];
        uint256 n;
        for (uint256 i; i < all.length; i++) if (isAllowed[agentId][all[i]]) n++;
        list = new address[](n);
        uint256 j;
        for (uint256 i; i < all.length; i++) if (isAllowed[agentId][all[i]]) list[j++] = all[i];
    }
}
