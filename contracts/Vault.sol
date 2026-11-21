// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Vault
 * @notice Minimal secure vault accepting tUSD8 deposits and allowing only the depositor to withdraw.
 *         Built for Day 4 of the Guardian Wallet 25-Day Build Plan (Aevum Builder Challenge #1).
 *
 * Security Design:
 * - Uses SafeERC20 to guard against non-compliant ERC-20 return values or reverts.
 * - Strict Checks-Effects-Interactions (CEI) pattern to prevent state inconsistency.
 * - Non-reentrancy protection via OpenZeppelin ReentrancyGuard.
 * - Isolated per-depositor accounting: non-depositors cannot withdraw another user's funds.
 * - Custom errors for optimal gas efficiency and expressive reverts.
 */
contract Vault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Custom Errors ---
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);

    // --- State Variables ---
    IERC20 public immutable token;
    uint256 public totalDeposits;
    mapping(address => uint256) private _balances;

    // --- Events ---
    event Deposit(address indexed depositor, uint256 amount);
    event Withdraw(address indexed depositor, uint256 amount);

    /**
     * @notice Constructs the Vault tied to a specific ERC-20 token (tUSD8).
     * @param _tokenAddress The address of the underlying token.
     */
    constructor(address _tokenAddress) {
        if (_tokenAddress == address(0)) {
            revert ZeroAddress();
        }
        token = IERC20(_tokenAddress);
    }

    /**
     * @notice Deposit tUSD8 tokens into the vault.
     *         Caller must have approved this vault contract for at least `amount`.
     * @param amount Amount of tokens to deposit.
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }

        // Transfer tokens from depositor to vault
        token.safeTransferFrom(msg.sender, address(this), amount);

        // State update
        _balances[msg.sender] += amount;
        totalDeposits += amount;

        emit Deposit(msg.sender, amount);
    }

    /**
     * @notice Withdraw deposited tUSD8 tokens. Only the depositor can withdraw their own funds.
     * @param amount Amount of tokens to withdraw.
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 userBalance = _balances[msg.sender];
        if (userBalance < amount) {
            revert InsufficientBalance(amount, userBalance);
        }

        // Checks-Effects-Interactions: update state before external transfer
        unchecked {
            _balances[msg.sender] = userBalance - amount;
            totalDeposits -= amount;
        }

        // Transfer tokens back to depositor
        token.safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, amount);
    }

    /**
     * @notice Check the deposited balance of a specific account.
     * @param account Address to query.
     * @return Deposited balance.
     */
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Return the underlying token address.
     * @return Underlying token address.
     */
    function tokenAddress() external view returns (address) {
        return address(token);
    }
}
