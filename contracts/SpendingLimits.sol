// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISpendingLimits.sol";

/**
 * @title SpendingLimits
 * @notice Enforces per-transaction caps and rolling daily caps with clear custom errors.
 *         Built for Day 8 of the Guardian Wallet 25-Day Build Plan (Aevum Builder Challenge #1).
 *
 * Security Model:
 * - Per-transaction cap: Prevents any single catastrophic drain.
 * - Rolling daily window: Prevents split-window boundary attacks (e.g. at 23:59:59 and 00:00:01).
 * - Weighted sliding window: Tracks currentWindowSpent and lastWindowSpent over WINDOW_SIZE (24 hours).
 * - Custom errors with explicit numeric parameters translatable to human-readable UI warnings.
 */
contract SpendingLimits is ISpendingLimits {
    // --- Custom Errors ---
    error Unauthorized();
    error ZeroAmount();
    error ZeroLimit();
    error ExceedsPerTxLimit(uint256 requested, uint256 limit);
    error ExceedsDailyLimit(uint256 requested, uint256 available, uint256 dailyLimit);

    // --- State Variables ---
    address public owner;
    address public authorizedCaller; // GuardianAccount allowed to invoke checkAndRecord

    uint256 public constant WINDOW_SIZE = 24 hours; // 86,400 seconds

    uint256 public perTxLimit;
    uint256 public dailyLimit;

    uint256 public currentWindowStart;
    uint256 public currentWindowSpent;
    uint256 public lastWindowSpent;

    // --- Events ---
    event LimitsUpdated(uint256 oldPerTx, uint256 newPerTx, uint256 oldDaily, uint256 newDaily);
    event SpendingRecorded(uint256 amount, uint256 newCurrentSpent, uint256 totalRollingSpent);
    event AuthorizedCallerUpdated(address indexed newCaller);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != authorizedCaller) {
            revert Unauthorized();
        }
        _;
    }

    constructor(
        address _owner,
        address _authorizedCaller,
        uint256 _perTxLimit,
        uint256 _dailyLimit
    ) {
        if (_owner == address(0)) {
            revert Unauthorized();
        }
        if (_perTxLimit == 0 || _dailyLimit == 0) {
            revert ZeroLimit();
        }
        if (_perTxLimit > _dailyLimit) {
            revert ExceedsDailyLimit(_perTxLimit, _dailyLimit, _dailyLimit);
        }

        owner = _owner;
        authorizedCaller = _authorizedCaller;
        perTxLimit = _perTxLimit;
        dailyLimit = _dailyLimit;
        currentWindowStart = block.timestamp;
    }

    /**
     * @notice Enforces and records an outgoing spend against both per-transaction and daily rolling caps.
     *         Reverts with descriptive custom errors if limits are exceeded.
     * @param amount The transfer amount to debit.
     * @return bool True if within limits and successfully recorded.
     */
    function checkAndRecord(uint256 amount) external override onlyAuthorized returns (bool) {
        if (amount == 0) {
            revert ZeroAmount();
        }

        // 1. Check per-transaction cap
        if (amount > perTxLimit) {
            revert ExceedsPerTxLimit(amount, perTxLimit);
        }

        // 2. Advance rolling window if needed
        _advanceWindow();

        // 3. Calculate effective rolling spent
        uint256 rollingSpent = _calculateRollingSpent();
        if (rollingSpent + amount > dailyLimit) {
            uint256 available = (dailyLimit > rollingSpent) ? (dailyLimit - rollingSpent) : 0;
            revert ExceedsDailyLimit(amount, available, dailyLimit);
        }

        // 4. Record spend
        currentWindowSpent += amount;
        emit SpendingRecorded(amount, currentWindowSpent, rollingSpent + amount);
        return true;
    }

    /**
     * @notice View helper to check if an amount is within limits without modifying state.
     */
    function isWithinLimits(uint256 amount) external view override returns (bool withinPerTx, bool withinDaily) {
        if (amount == 0 || amount > perTxLimit) {
            withinPerTx = false;
        } else {
            withinPerTx = true;
        }

        uint256 rollingSpent = getEffectiveRollingSpent();
        withinDaily = (rollingSpent + amount <= dailyLimit);
    }

    /**
     * @notice Returns current limits and remaining daily allowance.
     */
    function getLimits() external view override returns (uint256 perTx, uint256 daily, uint256 remainingToday) {
        perTx = perTxLimit;
        daily = dailyLimit;
        uint256 spent = getEffectiveRollingSpent();
        remainingToday = (dailyLimit > spent) ? (dailyLimit - spent) : 0;
    }

    /**
     * @notice Returns current rolling 24-hour spent amount.
     */
    function getEffectiveRollingSpent() public view returns (uint256) {
        uint256 timeSinceStart = block.timestamp - currentWindowStart;
        if (timeSinceStart >= 2 * WINDOW_SIZE) {
            return 0;
        } else if (timeSinceStart >= WINDOW_SIZE) {
            uint256 elapsedInNew = timeSinceStart - WINDOW_SIZE;
            if (elapsedInNew >= WINDOW_SIZE) return 0;
            uint256 weight = WINDOW_SIZE - elapsedInNew;
            return (currentWindowSpent * weight) / WINDOW_SIZE;
        } else {
            uint256 weight = WINDOW_SIZE - timeSinceStart;
            uint256 decayedLast = (lastWindowSpent * weight) / WINDOW_SIZE;
            return currentWindowSpent + decayedLast;
        }
    }

    function _advanceWindow() internal {
        uint256 timeSinceStart = block.timestamp - currentWindowStart;
        if (timeSinceStart >= 2 * WINDOW_SIZE) {
            lastWindowSpent = 0;
            currentWindowSpent = 0;
            currentWindowStart = block.timestamp;
        } else if (timeSinceStart >= WINDOW_SIZE) {
            lastWindowSpent = currentWindowSpent;
            currentWindowSpent = 0;
            currentWindowStart = currentWindowStart + WINDOW_SIZE;
        }
    }

    function _calculateRollingSpent() internal view returns (uint256) {
        uint256 timeSinceStart = block.timestamp - currentWindowStart;
        if (timeSinceStart >= WINDOW_SIZE) {
            return 0;
        }
        uint256 weight = WINDOW_SIZE - timeSinceStart;
        uint256 decayedLast = (lastWindowSpent * weight) / WINDOW_SIZE;
        return currentWindowSpent + decayedLast;
    }

    /**
     * @notice Update limits. Only owner can update.
     */
    function setLimits(uint256 newPerTx, uint256 newDaily) external onlyOwner {
        if (newPerTx == 0 || newDaily == 0) {
            revert ZeroLimit();
        }
        if (newPerTx > newDaily) {
            revert ExceedsDailyLimit(newPerTx, newDaily, newDaily);
        }

        uint256 oldPerTx = perTxLimit;
        uint256 oldDaily = dailyLimit;
        perTxLimit = newPerTx;
        dailyLimit = newDaily;

        emit LimitsUpdated(oldPerTx, newPerTx, oldDaily, newDaily);
    }

    /**
     * @notice Set authorized caller contract (e.g. GuardianAccount).
     */
    function setAuthorizedCaller(address newCaller) external onlyOwner {
        authorizedCaller = newCaller;
        emit AuthorizedCallerUpdated(newCaller);
    }
}
