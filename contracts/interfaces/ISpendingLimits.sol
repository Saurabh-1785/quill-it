// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISpendingLimits {
    function checkAndRecord(uint256 amount) external returns (bool);
    function isWithinLimits(uint256 amount) external view returns (bool withinPerTx, bool withinDaily);
    function getLimits() external view returns (uint256 perTx, uint256 daily, uint256 remainingToday);
}
