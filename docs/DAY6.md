# Day 6: Guardian Roles & Threshold

> **Milestone:** Day 6 (Sun 22 Nov 2026) — Aevum Builder Challenge #1  
> **Topic:** Access control, m-of-n approvals, asymmetric safety, and time-delayed guardian removal.

---

## 1. "Learn First" — Safety & Asymmetric Controls

### Q1: Why must a guardian be unable to spend?
* **Separation of Concerns:** A guardian's sole responsibility is **defense and oversight** (approving queued large payments, canceling suspicious transfers, or initiating a panic freeze).
* **Least Privilege:** If guardians had spending capabilities, each added guardian would exponentially increase the wallet's attack surface. If an attacker stole a single guardian private key, they could steal the user's funds.
* **Invariant:** Guardians **never hold spending authority**.

### Q2: Why should removing a guardian be delayed?
* **Compromised Owner Defense:** Consider the scenario where an elderly user's primary key is compromised or the user is socially engineered by a scammer. The attacker's very first action would be to delete all family guardians to remove oversight.
* **The Timelock Safeguard:** Enforcing a mandatory delay (`removalDelay = 72 hours`):
  1. Prevents immediate guardian deletion.
  2. Emits an on-chain `GuardianRemovalProposed` event notifying guardians.
  3. Provides a 72-hour window during which any guardian or the owner can cancel the removal via `cancelRemoveGuardian()` or freeze the wallet via `freeze()`.

---

## 2. Technical Architecture: `GuardianRegistry.sol`

### 2.1 State & Interface
```solidity
contract GuardianRegistry is IGuardianRegistry {
    address public owner;
    address[] public guardians;
    mapping(address => bool) public isGuardian;
    uint256 public threshold;
    uint256 public removalDelay;
    mapping(address => uint256) public pendingRemoval;

    function addGuardian(address guardian) external;
    function proposeRemoveGuardian(address guardian) external;
    function executeRemoveGuardian(address guardian) external;
    function cancelRemoveGuardian(address guardian) external;
    function setThreshold(uint256 newThreshold) external;
    function setRemovalDelay(uint256 newDelay) external;
    function guardianCount() external view returns (uint256);
    function getGuardians() external view returns (address[] memory);
    function isPendingRemoval(address guardian) external view returns (bool isPending, uint256 executeAfter);
}
```

### 2.2 Enforced Security Rules (Build Plan Rubric)
1. **Stranger Cannot Add Guardian:**
   * Only the owner can call `addGuardian`. Calls from unauthorized addresses revert with `Unauthorized()`.
2. **Removal Delay Holds:**
   * Calling `executeRemoveGuardian` before `block.timestamp >= executeAfter` strictly reverts with `RemovalDelayNotElapsed`.
   * Fast-forwarding beyond `removalDelay` allows safe finalization.
3. **Guardian Can Never Move Funds:**
   * Calls from guardians to `GuardianAccount.execute` or `GuardianAccount.executeTokenTransfer` revert with `Unauthorized()`.
4. **Threshold Invariants:**
   * Setting threshold to 0 or exceeding total guardian count reverts with `InvalidThreshold`.
   * Automatically scales down threshold if guardian removal would leave fewer guardians than the active threshold.

---

## 3. Verification & Evidence
* **18 unit tests passing** in `test/GuardianRegistry.test.cjs`.
* Time manipulation tests verifying the 72-hour timelock delay using `@nomicfoundation/hardhat-network-helpers`.
* Cancellation and threshold boundaries verified under all adversarial permutations.
