# Platform Primitive Inventory (Aevum Testnet)

> Evaluated on Day 1 (17 Nov 2026) for Aevum Builder Challenge #1.
> Rule: If the platform gives the primitive natively, use it; otherwise, build the minimum yourself and note it as a constraint.

| Primitive | Native Support (Yes / No / Unknown) | Evidence / Documentation Reference | Project Implementation Strategy |
| :--- | :--- | :--- | :--- |
| **Smart Accounts** | No (Standard EVM / EOA default) | [QDay Whitepaper / Docs](https://community.qday.io/guide/) | Implement custom `GuardianAccount.sol` smart contract wallet (owner execution, guardian gating). |
| **Scoped Session Keys** | No | [QDay Community Docs](https://community.qday.io/guide/) | Implement on-chain `SessionScope` module with allowance, expiration timestamp, and whitelisted payees. |
| **Spending Limits** | No | [QDay Community Docs](https://community.qday.io/guide/) | Build custom rolling/daily and per-transaction limits into the account execution pipeline. |
| **ERC-8004 Registries** | Unknown / Community Standard | [ERC-8004 Spec & Community Docs](https://community.qday.io/guide/) | Deploy or link against an ERC-8004 agent/identity registry; mock if official testnet contract is unavailable. |
| **SDK / API** | Yes (Standard EVM JSON-RPC) | RPC: `https://rpc-test.qday.info` (Chain ID: 44005) | Use standard `ethers.js` / `viem` to interface with network and smart contracts. |
| **Explorer Verification** | Yes (Blockscout-based) | Explorer: `https://explorer-test.qday.info` | Verify via standard Blockscout Hardhat/Foundry verification APIs. |

### Summary of Known Constraints
1. The Aevum testnet is EVM-compatible (Polygon zkEVM based architecture) and uses standard EOA signatures for outer transaction transport.
2. Account Abstraction, session keys, and safety controls are not native testnet opcodes/system contracts, so they will be implemented cleanly in our smart contract suite starting Day 3–5.
