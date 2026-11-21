// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockTUSD8
 * @notice Mock ERC-20 token simulating tUSD8 on Aevum Testnet for Guardian Wallet development.
 *         Implements standard ERC-20 semantics with 18 decimals and a public mint helper for testing.
 */
contract MockTUSD8 is ERC20 {
    uint8 private immutable _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
        // Mint initial supply to deployer (1,000,000 tokens)
        _mint(msg.sender, 1_000_000 * 10 ** decimals_);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mint tokens to any address (for testing / faucet simulation).
     * @param to Recipient address.
     * @param amount Amount to mint.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an address.
     * @param from Address to burn tokens from.
     * @param amount Amount to burn.
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
