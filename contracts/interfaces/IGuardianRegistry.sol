// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGuardianRegistry {
    function isGuardian(address account) external view returns (bool);
    function threshold() external view returns (uint256);
    function guardianCount() external view returns (uint256);
}
