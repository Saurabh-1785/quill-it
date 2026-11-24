// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IGuardianRegistry.sol";

/**
 * @title GuardianRegistry
 * @notice Manages guardian members, approval threshold (m-of-n), and time-delayed removal.
 *         Built for Day 6 of the Guardian Wallet 25-Day Build Plan (Aevum Builder Challenge #1).
 *
 * Security Model:
 * - Stranger cannot add guardians: only owner can add guardians.
 * - Guardians cannot spend funds: guardians have no execute privileges on the wallet.
 * - Time-delayed guardian removal: if an owner's key is compromised, the attacker cannot
 *   instantly strip guardians; removal requires a mandatory timelock delay (e.g. 72h).
 * - Asymmetric safety: Any active guardian (or the owner) can cancel a pending removal proposal.
 * - Threshold safety: Threshold cannot be set to 0 or greater than total active guardians.
 */
contract GuardianRegistry is IGuardianRegistry {
    // --- Custom Errors ---
    error Unauthorized();
    error ZeroAddress();
    error AlreadyGuardian();
    error NotGuardian();
    error CannotBeOwner();
    error RemovalAlreadyPending();
    error NoRemovalPending();
    error RemovalDelayNotElapsed(uint256 currentTime, uint256 executeAfter);
    error InvalidThreshold(uint256 requested, uint256 totalGuardians);

    // --- State Variables ---
    address public owner;
    address[] public guardians;
    mapping(address => bool) public override isGuardian;
    uint256 public override threshold;
    uint256 public removalDelay; // in seconds (e.g. 72 hours / 259,200 s)
    mapping(address => uint256) public pendingRemoval; // guardian => executeAfter timestamp

    // --- Events ---
    event GuardianAdded(address indexed guardian);
    event GuardianRemovalProposed(address indexed guardian, uint256 executeAfter);
    event GuardianRemoved(address indexed guardian);
    event GuardianRemovalCancelled(address indexed guardian);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event RemovalDelayUpdated(uint256 oldDelay, uint256 newDelay);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor(address _owner, uint256 _removalDelay) {
        if (_owner == address(0)) {
            revert ZeroAddress();
        }
        owner = _owner;
        removalDelay = _removalDelay;
    }

    /**
     * @notice Add a new guardian. Only callable by owner.
     * @param guardian Address of the guardian to add.
     */
    function addGuardian(address guardian) external onlyOwner {
        if (guardian == address(0)) {
            revert ZeroAddress();
        }
        if (guardian == owner) {
            revert CannotBeOwner();
        }
        if (isGuardian[guardian]) {
            revert AlreadyGuardian();
        }

        isGuardian[guardian] = true;
        guardians.push(guardian);

        // Auto-initialize threshold to 1 if first guardian added
        if (threshold == 0) {
            threshold = 1;
            emit ThresholdUpdated(0, 1);
        }

        emit GuardianAdded(guardian);
    }

    /**
     * @notice Propose removal of a guardian. Initiates the timelock delay.
     *         Only callable by owner.
     * @param guardian Address of the guardian to remove.
     */
    function proposeRemoveGuardian(address guardian) external onlyOwner {
        if (!isGuardian[guardian]) {
            revert NotGuardian();
        }
        if (pendingRemoval[guardian] != 0) {
            revert RemovalAlreadyPending();
        }

        uint256 executeAfter = block.timestamp + removalDelay;
        pendingRemoval[guardian] = executeAfter;

        emit GuardianRemovalProposed(guardian, executeAfter);
    }

    /**
     * @notice Finalize removal of a guardian after the delay has elapsed.
     *         Only callable by owner.
     * @param guardian Address of the guardian to remove.
     */
    function executeRemoveGuardian(address guardian) external onlyOwner {
        if (!isGuardian[guardian]) {
            revert NotGuardian();
        }

        uint256 executeAfter = pendingRemoval[guardian];
        if (executeAfter == 0) {
            revert NoRemovalPending();
        }
        if (block.timestamp < executeAfter) {
            revert RemovalDelayNotElapsed(block.timestamp, executeAfter);
        }

        // Clean up pending removal
        delete pendingRemoval[guardian];
        isGuardian[guardian] = false;

        // Remove from guardians array
        uint256 length = guardians.length;
        for (uint256 i = 0; i < length; i++) {
            if (guardians[i] == guardian) {
                guardians[i] = guardians[length - 1];
                guardians.pop();
                break;
            }
        }

        // Ensure threshold is adjusted if greater than remaining guardians
        if (guardians.length < threshold && guardians.length > 0) {
            uint256 oldThreshold = threshold;
            threshold = guardians.length;
            emit ThresholdUpdated(oldThreshold, threshold);
        } else if (guardians.length == 0) {
            threshold = 0;
            emit ThresholdUpdated(threshold, 0);
        }

        emit GuardianRemoved(guardian);
    }

    /**
     * @notice Cancel a pending guardian removal.
     *         Can be called by owner OR any active guardian.
     * @param guardian Address of the guardian whose removal proposal to cancel.
     */
    function cancelRemoveGuardian(address guardian) external {
        if (msg.sender != owner && !isGuardian[msg.sender]) {
            revert Unauthorized();
        }
        if (pendingRemoval[guardian] == 0) {
            revert NoRemovalPending();
        }

        delete pendingRemoval[guardian];
        emit GuardianRemovalCancelled(guardian);
    }

    /**
     * @notice Update m-of-n approval threshold. Only callable by owner.
     * @param newThreshold New threshold (1 <= newThreshold <= totalGuardians).
     */
    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > guardians.length) {
            revert InvalidThreshold(newThreshold, guardians.length);
        }
        uint256 oldThreshold = threshold;
        threshold = newThreshold;
        emit ThresholdUpdated(oldThreshold, newThreshold);
    }

    /**
     * @notice Update removal delay. Only callable by owner.
     * @param newDelay New removal delay in seconds.
     */
    function setRemovalDelay(uint256 newDelay) external onlyOwner {
        uint256 oldDelay = removalDelay;
        removalDelay = newDelay;
        emit RemovalDelayUpdated(oldDelay, newDelay);
    }

    /**
     * @notice Returns total number of active guardians.
     */
    function guardianCount() external view override returns (uint256) {
        return guardians.length;
    }

    /**
     * @notice Returns list of active guardians.
     */
    function getGuardians() external view returns (address[] memory) {
        return guardians;
    }

    /**
     * @notice Check whether a guardian has a pending removal and its executeAfter timestamp.
     */
    function isPendingRemoval(address guardian) external view returns (bool isPending, uint256 executeAfter) {
        executeAfter = pendingRemoval[guardian];
        isPending = (executeAfter > 0);
    }
}
