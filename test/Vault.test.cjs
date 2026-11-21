const { expect } = require("chai");
const hre = require("hardhat");

describe("Vault Contract (Day 4: tUSD8 Inside Contracts)", function () {
  let mockToken;
  let vault;
  let owner;
  let alice;
  let bob;
  let stranger;

  const DECIMALS = 18n;
  const ONE_TOKEN = 10n ** DECIMALS;
  const INITIAL_MINT = 1000n * ONE_TOKEN;

  beforeEach(async function () {
    [owner, alice, bob, stranger] = await hre.ethers.getSigners();

    // Deploy Mock tUSD8 Token
    const MockTUSD8 = await hre.ethers.getContractFactory("MockTUSD8");
    mockToken = await MockTUSD8.deploy("Test USD 8", "tUSD8", 18);
    await mockToken.waitForDeployment();

    // Deploy Vault tied to mockToken
    const Vault = await hre.ethers.getContractFactory("Vault");
    vault = await Vault.deploy(await mockToken.getAddress());
    await vault.waitForDeployment();

    // Distribute tokens to alice and bob
    await mockToken.mint(alice.address, INITIAL_MINT);
    await mockToken.mint(bob.address, INITIAL_MINT);
  });

  describe("Initialization & Configuration", function () {
    it("Should correctly set the token address and initialize with zero deposits", async function () {
      expect(await vault.tokenAddress()).to.equal(await mockToken.getAddress());
      expect(await vault.totalDeposits()).to.equal(0n);
      expect(await vault.balanceOf(alice.address)).to.equal(0n);
    });

    it("Should revert if deployed with zero address token", async function () {
      const Vault = await hre.ethers.getContractFactory("Vault");
      await expect(
        Vault.deploy(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  describe("Happy Path: Deposit & Withdrawal", function () {
    it("Should allow a depositor to approve and deposit tokens, updating balances and emitting Deposit event", async function () {
      const depositAmount = 250n * ONE_TOKEN;

      // Alice approves vault
      await mockToken.connect(alice).approve(await vault.getAddress(), depositAmount);

      // Alice deposits
      await expect(vault.connect(alice).deposit(depositAmount))
        .to.emit(vault, "Deposit")
        .withArgs(alice.address, depositAmount);

      // Verify internal accounting and ERC20 balances
      expect(await vault.balanceOf(alice.address)).to.equal(depositAmount);
      expect(await vault.totalDeposits()).to.equal(depositAmount);
      expect(await mockToken.balanceOf(await vault.getAddress())).to.equal(depositAmount);
      expect(await mockToken.balanceOf(alice.address)).to.equal(INITIAL_MINT - depositAmount);
    });

    it("Should allow the depositor to withdraw their full balance, updating state and emitting Withdraw event", async function () {
      const depositAmount = 300n * ONE_TOKEN;

      await mockToken.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      // Alice withdraws full balance
      await expect(vault.connect(alice).withdraw(depositAmount))
        .to.emit(vault, "Withdraw")
        .withArgs(alice.address, depositAmount);

      expect(await vault.balanceOf(alice.address)).to.equal(0n);
      expect(await vault.totalDeposits()).to.equal(0n);
      expect(await mockToken.balanceOf(await vault.getAddress())).to.equal(0n);
      expect(await mockToken.balanceOf(alice.address)).to.equal(INITIAL_MINT);
    });

    it("Should allow partial withdrawals correctly tracking remaining balance", async function () {
      const depositAmount = 500n * ONE_TOKEN;
      const firstWithdraw = 200n * ONE_TOKEN;
      const secondWithdraw = 300n * ONE_TOKEN;

      await mockToken.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      // First partial withdrawal
      await vault.connect(alice).withdraw(firstWithdraw);
      expect(await vault.balanceOf(alice.address)).to.equal(depositAmount - firstWithdraw);
      expect(await vault.totalDeposits()).to.equal(depositAmount - firstWithdraw);
      expect(await mockToken.balanceOf(alice.address)).to.equal(INITIAL_MINT - secondWithdraw);

      // Second withdrawal (remaining balance)
      await vault.connect(alice).withdraw(secondWithdraw);
      expect(await vault.balanceOf(alice.address)).to.equal(0n);
      expect(await vault.totalDeposits()).to.equal(0n);
      expect(await mockToken.balanceOf(alice.address)).to.equal(INITIAL_MINT);
    });
  });

  describe("Non-Owner / Unauthorized Withdrawal Protection", function () {
    it("Should reject withdrawal from a user who has zero deposits (stranger)", async function () {
      const depositAmount = 100n * ONE_TOKEN;

      // Alice deposits 100 tokens
      await mockToken.connect(alice).approve(await vault.getAddress(), depositAmount);
      await vault.connect(alice).deposit(depositAmount);

      // Stranger (with 0 balance in vault) attempts to withdraw
      await expect(
        vault.connect(stranger).withdraw(depositAmount)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(depositAmount, 0n);

      // Stranger attempts to withdraw even 1 wei
      await expect(
        vault.connect(stranger).withdraw(1n)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(1n, 0n);

      // Alice's funds remain safe
      expect(await vault.balanceOf(alice.address)).to.equal(depositAmount);
    });

    it("Should prevent a user from withdrawing more than their own deposited balance", async function () {
      const aliceDeposit = 500n * ONE_TOKEN;
      const bobDeposit = 50n * ONE_TOKEN;

      // Alice deposits 500, Bob deposits 50
      await mockToken.connect(alice).approve(await vault.getAddress(), aliceDeposit);
      await vault.connect(alice).deposit(aliceDeposit);

      await mockToken.connect(bob).approve(await vault.getAddress(), bobDeposit);
      await vault.connect(bob).deposit(bobDeposit);

      // Bob attempts to withdraw 51 tokens (exceeding his balance)
      await expect(
        vault.connect(bob).withdraw(bobDeposit + 1n)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(bobDeposit + 1n, bobDeposit);

      // Bob attempts to withdraw Alice's 500 tokens
      await expect(
        vault.connect(bob).withdraw(aliceDeposit)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(aliceDeposit, bobDeposit);

      // Both balances are preserved
      expect(await vault.balanceOf(alice.address)).to.equal(aliceDeposit);
      expect(await vault.balanceOf(bob.address)).to.equal(bobDeposit);
      expect(await vault.totalDeposits()).to.equal(aliceDeposit + bobDeposit);
    });

    it("Should maintain strict multi-user balance isolation across repeated deposits and withdrawals", async function () {
      const aliceAmount = 400n * ONE_TOKEN;
      const bobAmount = 600n * ONE_TOKEN;

      await mockToken.connect(alice).approve(await vault.getAddress(), aliceAmount);
      await vault.connect(alice).deposit(aliceAmount);

      await mockToken.connect(bob).approve(await vault.getAddress(), bobAmount);
      await vault.connect(bob).deposit(bobAmount);

      // Alice withdraws 400
      await vault.connect(alice).withdraw(aliceAmount);
      expect(await vault.balanceOf(alice.address)).to.equal(0n);
      expect(await vault.balanceOf(bob.address)).to.equal(bobAmount);
      expect(await vault.totalDeposits()).to.equal(bobAmount);

      // Alice attempts to withdraw Bob's remaining funds -> reverts
      await expect(
        vault.connect(alice).withdraw(1n)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(1n, 0n);

      // Bob withdraws his 600
      await vault.connect(bob).withdraw(bobAmount);
      expect(await vault.balanceOf(bob.address)).to.equal(0n);
      expect(await vault.totalDeposits()).to.equal(0n);
    });
  });

  describe("Safe Token Transfer Edge Cases & ERC-20 Invariants", function () {
    it("Should revert when attempting to deposit 0 tokens", async function () {
      await expect(
        vault.connect(alice).deposit(0n)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("Should revert when attempting to withdraw 0 tokens", async function () {
      await expect(
        vault.connect(alice).withdraw(0n)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("Should revert when depositing without sufficient ERC-20 allowance", async function () {
      const amount = 100n * ONE_TOKEN;
      // Alice has tokens but did not approve vault
      await expect(
        vault.connect(alice).deposit(amount)
      ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientAllowance");
    });

    it("Should revert when depositing more tokens than account balance", async function () {
      const excessiveAmount = INITIAL_MINT * 2n;
      await mockToken.connect(alice).approve(await vault.getAddress(), excessiveAmount);

      await expect(
        vault.connect(alice).deposit(excessiveAmount)
      ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance");
    });
  });
});
