// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IPayeeRegistry.sol";
import "./interfaces/IGuardianRegistry.sol";

/**
 * @title PayeeRegistry
 * @notice Maintains payee trust tiers with mandatory cooldown period before trust activates.
 *         Built for Day 7 of the Guardian Wallet 25-Day Build Plan (Aevum Builder Challenge #1).
 *
 * Security Architecture:
 * - Cooldown temporal delay: Newly registered payees are treated as UNKNOWN until cooldown elapses.
 * - Three trust tiers: UNKNOWN (0), TRUSTED (1), VERIFIED_IDENTITY (2).
 * - Asymmetric defense: Owner can add or revoke; guardians can also immediately revoke malicious payees.
 * - Real-time state query: getEffectiveTier(payee) evaluates block.timestamp dynamically.
 */
contract PayeeRegistry is IPayeeRegistry {
    // --- Custom Errors ---
    error Unauthorized();
    error ZeroAddress();
    error InvalidTier();
    error PayeeNotRegistered();

    // --- State Variables ---
    address public owner;
    IGuardianRegistry public guardianRegistry;
    uint256 public override cooldownPeriod; // in seconds (default 24h = 86400s)

    mapping(address => TrustTier) public rawTiers;
    mapping(address => uint256) public registeredAt;

    // --- Events ---
    event PayeeRegistered(address indexed payee, TrustTier tier, uint256 registeredAt, uint256 cooldownEndsAt);
    event PayeeRevoked(address indexed payee, address indexed caller);
    event CooldownPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event GuardianRegistryUpdated(address indexed newRegistry);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address _owner, address _guardianRegistry, uint256 _cooldownPeriod) {
        if (_owner == address(0)) {
            revert ZeroAddress();
        }
        owner = _owner;
        if (_guardianRegistry != address(0)) {
            guardianRegistry = IGuardianRegistry(_guardianRegistry);
        }
        cooldownPeriod = _cooldownPeriod;
    }

    /**
     * @notice Register or update payee trust tier. Only owner can register.
     * @param payee Address of the payee.
     * @param tier Target trust tier (TRUSTED or VERIFIED_IDENTITY).
     */
    function setPayee(address payee, TrustTier tier) external onlyOwner {
        if (payee == address(0)) {
            revert ZeroAddress();
        }
        if (tier == TrustTier.UNKNOWN) {
            // Setting to UNKNOWN acts as revocation
            _revoke(payee);
            return;
        }

        rawTiers[payee] = tier;
        registeredAt[payee] = block.timestamp;

        uint256 cooldownEndsAt = block.timestamp + cooldownPeriod;
        emit PayeeRegistered(payee, tier, block.timestamp, cooldownEndsAt);
    }

    /**
     * @notice Revoke a payee's trust status immediately.
     *         Callable by owner OR any active guardian in guardianRegistry.
     * @param payee Address of payee to revoke.
     */
    function revokePayee(address payee) external {
        bool isAuthorized = (msg.sender == owner);
        if (!isAuthorized && address(guardianRegistry) != address(0)) {
            isAuthorized = guardianRegistry.isGuardian(msg.sender);
        }

        if (!isAuthorized) {
            revert Unauthorized();
        }

        if (rawTiers[payee] == TrustTier.UNKNOWN) {
            revert PayeeNotRegistered();
        }

        _revoke(payee);
    }

    function _revoke(address payee) internal {
        delete rawTiers[payee];
        delete registeredAt[payee];
        emit PayeeRevoked(payee, msg.sender);
    }

    /**
     * @notice Returns the effective trust tier of a payee.
     *         If registered as TRUSTED but cooldown has not passed, returns UNKNOWN.
     * @param payee Address to query.
     */
    function getEffectiveTier(address payee) public view override returns (TrustTier) {
        TrustTier raw = rawTiers[payee];

        if (raw == TrustTier.TRUSTED) {
            if (block.timestamp < registeredAt[payee] + cooldownPeriod) {
                return TrustTier.UNKNOWN; // Cooldown still in effect!
            }
            return TrustTier.TRUSTED;
        }

        if (raw == TrustTier.VERIFIED_IDENTITY) {
            return TrustTier.VERIFIED_IDENTITY;
        }

        return TrustTier.UNKNOWN;
    }

    /**
     * @notice Check whether a payee is currently trusted (cooldown elapsed).
     */
    function isTrusted(address payee) external view override returns (bool) {
        TrustTier effective = getEffectiveTier(payee);
        return (effective == TrustTier.TRUSTED || effective == TrustTier.VERIFIED_IDENTITY);
    }

    /**
     * @notice Helper returning full payee status info.
     */
    function getPayeeInfo(address payee) external view returns (
        TrustTier rawTier,
        TrustTier effectiveTier,
        uint256 registeredTimestamp,
        uint256 cooldownEndsAt,
        bool cooldownActive
    ) {
        rawTier = rawTiers[payee];
        effectiveTier = getEffectiveTier(payee);
        registeredTimestamp = registeredAt[payee];
        cooldownEndsAt = registeredTimestamp + cooldownPeriod;
        cooldownActive = (rawTier == TrustTier.TRUSTED && block.timestamp < cooldownEndsAt);
    }

    /**
     * @notice Update cooldown period. Only owner can update.
     */
    function setCooldownPeriod(uint256 newPeriod) external onlyOwner {
        uint256 oldPeriod = cooldownPeriod;
        cooldownPeriod = newPeriod;
        emit CooldownPeriodUpdated(oldPeriod, newPeriod);
    }

    /**
     * @notice Update guardian registry reference. Only owner can update.
     */
    function setGuardianRegistry(address _guardianRegistry) external onlyOwner {
        guardianRegistry = IGuardianRegistry(_guardianRegistry);
        emit GuardianRegistryUpdated(_guardianRegistry);
    }
}
