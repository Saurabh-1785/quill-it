# Day 8: Spending Limits & Boundary Enforcement

> **Milestone:** Day 8 (Tue 24 Nov 2026) — Aevum Builder Challenge #1  
> **Topic:** Rolling window rate-limiting, per-transaction caps, daily allowances, and human-readable custom errors.

---

## 1. "Learn First" — Rate Limiting & Boundary Attacks

### Q1: Rolling Window vs. Fixed Period & Boundary Attacks
* **Fixed Period (e.g., Midnight-to-Midnight):**
  * Resets spent allowance at fixed wall-clock intervals (e.g. `block.timestamp / 86400`).
  * **The Split-Window Boundary Attack:** An attacker transfers the maximum daily limit at 23:59:59, and immediately transfers another full daily limit at 00:00:01 (2 seconds later). In two seconds, the attacker drains **2x the daily limit**, completely defeating the security intent.
* **Rolling 24-Hour Window:**
  * Continuously accounts for funds spent over the preceding 24-hour sliding window using a time-weighted decaying calculation.
  * Eliminates the midnight double-dip spike and guarantees that the total outgoing volume over *any* continuous 24-hour period never exceeds `dailyLimit`.

### Q2: Per-Transaction Cap vs. Period Cap
* **Per-Transaction Cap (`perTxLimit`):**
  * Maximum allowable amount for a single immediate transaction (e.g., 1,000 tUSD8).
  * Prevents a single catastrophic transaction from wiping out the wallet balance.
* **Daily Rolling Cap (`dailyLimit`):**
  * Cumulative cap on outgoing volume across a 24-hour period (e.g., 2,500 tUSD8).
  * Prevents "smurfing" attacks where an attacker drains the wallet through dozens of rapid smaller transfers just below the per-transaction cap.

---

## 2. Technical Architecture: `SpendingLimits.sol`

### 2.1 State & Interface
```solidity
contract SpendingLimits is ISpendingLimits {
    error ExceedsPerTxLimit(uint256 requested, uint256 limit);
    error ExceedsDailyLimit(uint256 requested, uint256 available, uint256 dailyLimit);

    address public owner;
    address public authorizedCaller; // GuardianAccount

    uint256 public constant WINDOW_SIZE = 24 hours;
    uint256 public perTxLimit;
    uint256 public dailyLimit;
    uint256 public currentWindowStart;
    uint256 public currentWindowSpent;
    uint256 public lastWindowSpent;

    function checkAndRecord(uint256 amount) external returns (bool);
    function isWithinLimits(uint256 amount) external view returns (bool withinPerTx, bool withinDaily);
    function getLimits() external view returns (uint256 perTx, uint256 daily, uint256 remainingToday);
}
```

### 2.2 Expressive Custom Errors for Plain-Language UI
* `ExceedsPerTxLimit(uint256 requested, uint256 limit)`:
  * *"Transfer of $150 exceeds your single-transfer limit of $100."*
* `ExceedsDailyLimit(uint256 requested, uint256 available, uint256 dailyLimit)`:
  * *"Transfer of $100 exceeds remaining daily allowance ($50 available out of $250 limit)."*

---

## 3. Verification & Evidence
* **16 unit and boundary tests passing** in `test/SpendingLimits.test.cjs`.
* **Rubric Requirement Passed:**
  * Exactly at `perTxLimit` succeeds; `perTxLimit + 1 wei` reverts with `ExceedsPerTxLimit`.
  * Cumulative spend up to `dailyLimit` succeeds; spending `1 wei` over reverts with `ExceedsDailyLimit`.
  * One rejected transaction recorded on-chain showing the expected custom error.
