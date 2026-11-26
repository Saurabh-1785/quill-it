// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IGuardianRegistry.sol";
import "./interfaces/IPayeeRegistry.sol";
import "./interfaces/ISpendingLimits.sol";

/**
 * @title GuardianAccount
 * @notice Owner-controlled smart account foundation with guardian integration,
 *         payee registry verification, spending limits enforcement,
 *         supporting arbitrary calls, token transfers, nonces, and emergency panic freeze.
 *         Built for Days 5-8 of the Guardian Wallet 25-Day Build Plan (Aevum Builder Challenge #1).
 *
 * Security Architecture:
 * - Owner execution only: only owner can initiate calls or transfer assets.
 * - Non-reentrancy protection: guarded with ReentrancyGuard on execution entrypoints.
 * - Monotonic nonce: increments on every execution for replay tracking.
 * - Asymmetric panic freeze: can be triggered immediately by the owner OR any active guardian.
 * - Guardian spending block: guardians have zero permission to spend or move funds from this account.
 * - Payee Registry integration (Day 7): enforces cooldown-validated trust tiers.
 * - Spending Limits integration (Day 8): enforces per-tx and rolling daily caps with custom errors.
 */
contract GuardianAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum AccountStatus { ACTIVE, FROZEN }

    // --- Custom Errors ---
    error Unauthorized();
    error AccountIsFrozen();
    error ZeroAddress();
    error ExecutionFailed(bytes returnData);
    error PayeeNotTrusted(address payee, uint256 currentTier);

    // --- State Variables ---
    address public owner;
    AccountStatus public status;
    uint256 public nonce;
    IGuardianRegistry public guardianRegistry;
    IPayeeRegistry public payeeRegistry;
    ISpendingLimits public spendingLimits;

    // --- Events ---
    event ExecutionSuccess(uint256 indexed nonce, address indexed target, uint256 value, bytes data);
    event AccountFrozen(address indexed caller);
    event AccountUnfrozen(address indexed caller);
    event GuardianRegistryUpdated(address indexed newRegistry);
    event PayeeRegistryUpdated(address indexed newRegistry);
    event SpendingLimitsUpdated(address indexed newLimits);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event NativeReceived(address indexed sender, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    modifier notFrozen() {
        if (status == AccountStatus.FROZEN) {
            revert AccountIsFrozen();
        }
        _;
    }

    constructor(address _owner, address _guardianRegistry) {
        if (_owner == address(0)) {
            revert ZeroAddress();
        }
        owner = _owner;
        if (_guardianRegistry != address(0)) {
            guardianRegistry = IGuardianRegistry(_guardianRegistry);
        }
        status = AccountStatus.ACTIVE;
    }

    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    /**
     * @notice Executes an arbitrary call from this smart account.
     *         Only the owner can execute calls; guardians cannot initiate spends.
     * @param target Target contract or recipient address.
     * @param value Native currency value in wei to forward.
     * @param data Calldata payload.
     * @return returnData Return bytes from external call.
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external payable onlyOwner notFrozen nonReentrant returns (bytes memory returnData) {
        if (target == address(0)) {
            revert ZeroAddress();
        }

        uint256 currentNonce = nonce++;

        bool success;
        (success, returnData) = target.call{value: value}(data);
        if (!success) {
            revert ExecutionFailed(returnData);
        }

        emit ExecutionSuccess(currentNonce, target, value, data);
    }

    /**
     * @notice Transfers ERC-20 tokens (e.g. tUSD8) out of this smart account.
     *         The smart account is the msg.sender of the token transfer.
     * @param token Address of the ERC-20 token contract.
     * @param to Recipient address.
     * @param amount Token amount to transfer.
     * @return bool True on success.
     */
    function executeTokenTransfer(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner notFrozen nonReentrant returns (bool) {
        if (token == address(0) || to == address(0)) {
            revert ZeroAddress();
        }

        uint256 currentNonce = nonce++;
        IERC20(token).safeTransfer(to, amount);

        bytes memory callData = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
        emit ExecutionSuccess(currentNonce, token, 0, callData);
        return true;
    }

    /**
     * @notice Executes a guarded transfer of ERC-20 tokens (e.g. tUSD8) enforcing
     *         payee trust checks (Day 7) and spending limits (Day 8).
     * @param token ERC-20 token address.
     * @param to Payee address.
     * @param amount Transfer amount.
     */
    function executeGuardedTransfer(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner notFrozen nonReentrant returns (bool) {
        if (token == address(0) || to == address(0)) {
            revert ZeroAddress();
        }

        // 1. Payee Registry Check (Day 7: Payee must be effectively TRUSTED)
        if (address(payeeRegistry) != address(0)) {
            if (!payeeRegistry.isTrusted(to)) {
                revert PayeeNotTrusted(to, uint256(payeeRegistry.getEffectiveTier(to)));
            }
        }

        // 2. Spending Limits Enforcement (Day 8: perTxLimit & daily rolling cap)
        if (address(spendingLimits) != address(0)) {
            spendingLimits.checkAndRecord(amount);
        }

        uint256 currentNonce = nonce++;
        IERC20(token).safeTransfer(to, amount);

        bytes memory callData = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
        emit ExecutionSuccess(currentNonce, token, 0, callData);
        return true;
    }

    /**
     * @notice Emergency panic freeze. Can be triggered by the owner OR any registered guardian.
     */
    function freeze() external {
        bool isAuthorized = (msg.sender == owner);
        if (!isAuthorized && address(guardianRegistry) != address(0)) {
            isAuthorized = guardianRegistry.isGuardian(msg.sender);
        }

        if (!isAuthorized) {
            revert Unauthorized();
        }

        status = AccountStatus.FROZEN;
        emit AccountFrozen(msg.sender);
    }

    /**
     * @notice Unfreeze account. Restricted to owner.
     */
    function unfreeze() external onlyOwner {
        status = AccountStatus.ACTIVE;
        emit AccountUnfrozen(msg.sender);
    }

    /**
     * @notice Link or update the guardian registry.
     * @param _guardianRegistry Address of new registry.
     */
    function setGuardianRegistry(address _guardianRegistry) external onlyOwner {
        guardianRegistry = IGuardianRegistry(_guardianRegistry);
        emit GuardianRegistryUpdated(_guardianRegistry);
    }

    /**
     * @notice Link or update the payee registry.
     * @param _payeeRegistry Address of new payee registry.
     */
    function setPayeeRegistry(address _payeeRegistry) external onlyOwner {
        payeeRegistry = IPayeeRegistry(_payeeRegistry);
        emit PayeeRegistryUpdated(_payeeRegistry);
    }

    /**
     * @notice Link or update the spending limits module.
     * @param _spendingLimits Address of new spending limits module.
     */
    function setSpendingLimits(address _spendingLimits) external onlyOwner {
        spendingLimits = ISpendingLimits(_spendingLimits);
        emit SpendingLimitsUpdated(_spendingLimits);
    }

    /**
     * @notice Transfer ownership of this smart account.
     * @param newOwner Address of new owner.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert ZeroAddress();
        }
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}
