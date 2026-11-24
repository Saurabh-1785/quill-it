# Day 5: Smart Account Foundation

> **Milestone:** Day 5 (Sat 21 Nov 2026) — Aevum Builder Challenge #1  
> **Topic:** Smart Account Foundation, low-level `execute`, transaction nonce, and sending tUSD8.

---

## 1. "Learn First" — Foundational Concepts

### Q1: How is a Smart Account different from an EOA?
* **EOA (Externally Owned Account):**
  * Governed by a single private key (secp256k1).
  * Has no code or logic attached.
  * Rigid signature and authorization scheme: whatever is signed by the private key is permanently authorized.
  * Complete single-point-of-failure: if the private key or seed phrase leaks, all funds are irrecoverably stolen.
* **Smart Account (Contract Account):**
  * Governed by executable smart contract code.
  * Programmable verification and execution: can enforce spending limits, guardian approvals, timelocks, panic freezes, and scoped session keys.
  * Can change keys without changing the public address (account recovery / rotation).
  * Can act as the autonomous sender of token transfers and DeFi operations.

### Q2: What does `execute` do?
* `execute(address target, uint256 value, bytes calldata data)` is the fundamental primitive of smart contract wallets (similar to Gnosis Safe / ERC-4337).
* It initiates an arbitrary low-level call from the smart account: `target.call{value: value}(data)`.
* This enables the account to:
  * Interact with any contract on the blockchain.
  * Send native coins (`ETH`/`AEVUM`) and ERC-20 tokens (`tUSD8`).
  * Ensure the smart account is recognized as `msg.sender` for outgoing calls.

### Q3: How is a call validated?
* In `GuardianAccount.sol`, calls are validated through access control:
  1. **Owner check:** Only `msg.sender == owner` can invoke `execute()` or `executeTokenTransfer()`. Guardians cannot spend or move funds.
  2. **Status check:** Account must be in the `ACTIVE` state. If `status == AccountStatus.FROZEN`, all executions revert immediately with `AccountIsFrozen()`.
  3. **Target check:** Calls to `address(0)` are rejected with `ZeroAddress()`.

### Q4: What is a nonce for?
* A **nonce** (number used once) provides strict replay protection and execution ordering.
* Every call executed through `GuardianAccount` increments `nonce++` monotonically.
* This ensures that each transaction is uniquely identified and cannot be replayed by relayers or malicious observers.

---

## 2. Technical Architecture: `GuardianAccount.sol`

### 2.1 State & Interface
```solidity
contract GuardianAccount is ReentrancyGuard {
    enum AccountStatus { ACTIVE, FROZEN }

    address public owner;
    AccountStatus public status;
    uint256 public nonce;
    IGuardianRegistry public guardianRegistry;

    function execute(address target, uint256 value, bytes calldata data) external payable returns (bytes memory);
    function executeTokenTransfer(address token, address to, uint256 amount) external returns (bool);
    function freeze() external;
    function unfreeze() external;
    function setGuardianRegistry(address _guardianRegistry) external;
    function transferOwnership(address newOwner) external;
}
```

### 2.2 Key Security Features
1. **Separation of Spender vs Guardian:** Guardians have zero spending capability. Any attempt by a guardian or stranger to call `execute` or `executeTokenTransfer` reverts with `Unauthorized()`.
2. **Panic Freeze Accessibility:** Both the owner AND any registered guardian can call `freeze()` to instantly halt outgoing transactions.
3. **Reentrancy Protection:** All execution paths are secured with OpenZeppelin's `nonReentrant` modifier.
4. **Token Sender Identity:** When `executeTokenTransfer` or `execute` calls `IERC20.transfer`, the ERC-20 token contract records `from: address(GuardianAccount)`.

---

## 3. Verification & Evidence
* **19 unit tests passing** in `test/GuardianAccount.test.cjs`.
* Smart account successfully funded with 250 tUSD8 and executed outbound transfer of 75 tUSD8, verifiably acting as the sender on-chain.
