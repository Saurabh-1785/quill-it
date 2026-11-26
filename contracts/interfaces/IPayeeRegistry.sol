// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPayeeRegistry {
    enum TrustTier {
        UNKNOWN,            // 0: Default / unverified / cooldown in effect
        TRUSTED,            // 1: Owner-added and cooldown completed
        VERIFIED_IDENTITY   // 2: Cryptographically verified identity (ERC-8004)
    }

    function getEffectiveTier(address payee) external view returns (TrustTier);
    function isTrusted(address payee) external view returns (bool);
    function cooldownPeriod() external view returns (uint256);
}
