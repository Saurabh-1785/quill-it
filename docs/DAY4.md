# Day 4: tUSD8 Inside Contracts (Vault & Safe Transfers)

> **Milestone:** Day 4 (Fri 20 Nov 2026) — Aevum Builder Challenge #1  
> **Topic:** tUSD8 (ERC-20 behavior), safe token transfer patterns, and depositor-isolated vault.

---

## 1. "Learn First" Core Questions

### Q1: How do `approve`, `transfer`, and `transferFrom` differ?
* `transfer(address to, uint256 amount)`:
  * Initiated directly by the token owner (`msg.sender`).
  * Moves tokens directly from `msg.sender` to `to`.
  * No allowance is needed.
* `approve(address spender, uint256 amount)`:
  * Initiated by the token owner (`msg.sender`).
  * Authorizes a third-party address (`spender`, e.g., a vault, exchange, or smart account) to withdraw up to `amount` of tokens on the owner's behalf.
* `transferFrom(address from, address to, uint256 amount)`:
  * Initiated by an authorized third party (`msg.sender` as spender).
  * Moves tokens from the `from` account to `to`, debiting the spender's allowance (`allowance[from][msg.sender] -= amount`).

### Q2: Why are unlimited approvals (`type(uint256).max`) dangerous?
* **The Vulnerability:** DApps commonly prompt users for infinite / unlimited allowance (`2^256 - 1`) so users do not have to approve each subsequent transaction.
* **The Catastrophic Risk:** If the approved smart contract has a vulnerability, is maliciously upgraded, or has its admin keys compromised, an attacker can siphon **100% of the user's tokens at any time**, without requiring any signature or action from the user.
* **How Guardian Wallet Solves This (The 30-Second Answer):**
  > *"Unlimited approvals grant external contracts an open, permanent blank check on your wallet. Guardian Wallet eradicates this danger by replacing open-ended approvals with scoped session keys, per-transaction and rolling daily limits, and timelocked pending queues where any high-risk or novel transfer requires multi-guardian consensus before funds can ever leave the account."*

---

## 2. Technical Architecture: `Vault.sol`

### 2.1 Design Principles
1. **SafeERC20 Protection:** Many ERC-20 tokens either do not return a boolean on success (like USDT) or return `false` instead of reverting on failure. Using OpenZeppelin's `SafeERC20` wrapper (`using SafeERC20 for IERC20;`) ensures consistent revert semantics and verifies token contract existence.
2. **Checks-Effects-Interactions (CEI):** Internal balances and `totalDeposits` are updated strictly before any external token transfers are dispatched.
3. **Reentrancy Guard:** Protected by OpenZeppelin's `ReentrancyGuard` with the `nonReentrant` modifier on state-mutating entrypoints.
4. **Strict Per-Depositor Isolation:** Withdrawals are keyed to `msg.sender`. Non-depositors or attackers cannot withdraw funds deposited by others. Attempting to withdraw any amount without having deposited reverts with custom error `InsufficientBalance(requested, available)`.
5. **Gas-Efficient Custom Errors:** Replaces costly revert strings with structured custom errors (`ZeroAddress`, `ZeroAmount`, `InsufficientBalance`).

### 2.2 Interface & State

```solidity
contract Vault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);

    IERC20 public immutable token;
    uint256 public totalDeposits;
    mapping(address => uint256) private _balances;

    event Deposit(address indexed depositor, uint256 amount);
    event Withdraw(address indexed depositor, uint256 amount);

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function tokenAddress() external view returns (address);
}
```

---

## 3. Test Coverage Matrix

The unit test suite in `test/Vault.test.cjs` achieves 100% coverage across core flows and edge cases:

1. **Initialization & Configuration:**
   * Validates `tokenAddress` points to tUSD8 token.
   * Initial `totalDeposits` is 0.
   * Constructor reverts with `ZeroAddress` if given `address(0)`.
2. **Happy Path:**
   * Depositor approves and deposits tUSD8 tokens.
   * `Deposit` event emitted with correct depositor and amount.
   * Internal vault balance, total deposits, and ERC-20 balances update accurately.
   * Depositor withdraws partial and full amounts.
   * `Withdraw` event emitted with correct depositor and amount.
3. **Non-Owner / Unauthorized Withdrawal Protection:**
   * Stranger with 0 balance attempting withdrawal reverts with `InsufficientBalance(amount, 0)`.
   * Depositor attempting to withdraw more than their balance reverts with `InsufficientBalance(requested, available)`.
   * User B cannot withdraw User A's deposits even when both have active deposits in the vault.
   * Multi-user accounting isolation remains perfectly balanced.
4. **ERC-20 Safe Transfer & Boundary Conditions:**
   * Deposit of 0 reverts with `ZeroAmount`.
   * Withdrawal of 0 reverts with `ZeroAmount`.
   * Deposit without ERC-20 approval reverts with `ERC20InsufficientAllowance`.
   * Deposit exceeding token balance reverts with `ERC20InsufficientBalance`.
