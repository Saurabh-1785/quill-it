# Day 7: Payee Registry & Trust Tiers

> **Milestone:** Day 7 (Mon 23 Nov 2026) — Aevum Builder Challenge #1  
> **Topic:** Smart contract state design, payee allowlists, trust tiers, and mandatory cooldown delay.

---

## 1. "Learn First" — Foundational Safety Principles

### Q1: Why should a newly added payee only become trusted after a cool-off period?
* **Threat Scenario:** If an attacker compromises an owner's private key, or if an elderly user is tricked by a scammer on the phone, the attacker's immediate goal is to add their own address to the trusted allowlist and instantly drain the wallet.
* **The Cooldown Defense:** By enforcing a mandatory 24-hour cool-off period:
  1. The payee's initial status remains strictly `UNKNOWN`.
  2. Any attempted transfer to the new payee during the cooldown period **cannot execute on the fast-path** and will be held in the `PendingQueue`.
  3. Family guardians and the Sentinel agent receive alerts and have a full 24-hour window to inspect the transaction, cancel it, or freeze the account before any funds can leave.

### Q2: What are the three Trust Tiers?
1. **`UNKNOWN` (Tier 0):**
   * Default tier for all unlisted addresses and newly added payees while their cooldown is active.
   * Requires multi-guardian threshold approval and timelock delays.
2. **`TRUSTED` (Tier 1):**
   * Address explicitly added by the owner that has successfully passed the mandatory 24-hour cooldown period.
   * Eligible for immediate fast-path clearance as long as the amount is within daily and per-transaction spending limits.
3. **`VERIFIED_IDENTITY` (Tier 2):**
   * Cryptographically verified on-chain identity (wired via ERC-8004 on Day 14), representing verified entities such as registered hospitals, utilities, or audited merchants.

---

## 2. Technical Architecture: `PayeeRegistry.sol`

### 2.1 State & Interface
```solidity
contract PayeeRegistry is IPayeeRegistry {
    enum TrustTier { UNKNOWN, TRUSTED, VERIFIED_IDENTITY }

    address public owner;
    IGuardianRegistry public guardianRegistry;
    uint256 public cooldownPeriod; // 24 hours (86,400s)

    mapping(address => TrustTier) public rawTiers;
    mapping(address => uint256) public registeredAt;

    function setPayee(address payee, TrustTier tier) external;
    function revokePayee(address payee) external;
    function getEffectiveTier(address payee) external view returns (TrustTier);
    function isTrusted(address payee) external view returns (bool);
}
```

### 2.2 Security Features
* **Dynamic Timestamp Evaluation:** `getEffectiveTier(payee)` calculates `block.timestamp < registeredAt + cooldownPeriod` dynamically on-chain.
* **Asymmetric Guardian Revocation:** Both the owner AND any registered guardian in `GuardianRegistry` can revoke a payee immediately without delay.
* **Events for Auditability:** Emits `PayeeRegistered` with `registeredAt` and `cooldownEndsAt`, and `PayeeRevoked`.

---

## 3. Verification & Evidence
* **17 unit tests passing** in `test/PayeeRegistry.test.cjs`.
* **Rubric Requirement Passed:** Verifies that a payee added just now evaluates to `TrustTier.UNKNOWN` and `isTrusted == false` during the cooldown, and transitions to `TRUSTED` after 24h.
