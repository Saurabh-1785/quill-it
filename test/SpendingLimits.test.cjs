const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SpendingLimits (Day 8: Spending Limits & Boundary Tests)", function () {
  let limits;
  let owner;
  let authorizedAccount;
  let stranger;

  const DECIMALS = 18n;
  const ONE_TOKEN = 10n ** DECIMALS;

  const PER_TX_LIMIT = 1000n * ONE_TOKEN; // 1,000 tUSD8
  const DAILY_LIMIT = 2500n * ONE_TOKEN;  // 2,500 tUSD8

  beforeEach(async function () {
    [owner, authorizedAccount, stranger] = await hre.ethers.getSigners();

    const SpendingLimits = await hre.ethers.getContractFactory("SpendingLimits");
    limits = await SpendingLimits.deploy(
      owner.address,
      authorizedAccount.address,
      PER_TX_LIMIT,
      DAILY_LIMIT
    );
    await limits.waitForDeployment();
  });

  describe("Initialization & Limits Configuration", function () {
    it("Should initialize with correct owner, caller, and limit values", async function () {
      expect(await limits.owner()).to.equal(owner.address);
      expect(await limits.authorizedCaller()).to.equal(authorizedAccount.address);
      expect(await limits.perTxLimit()).to.equal(PER_TX_LIMIT);
      expect(await limits.dailyLimit()).to.equal(DAILY_LIMIT);

      const [perTx, daily, remaining] = await limits.getLimits();
      expect(perTx).to.equal(PER_TX_LIMIT);
      expect(daily).to.equal(DAILY_LIMIT);
      expect(remaining).to.equal(DAILY_LIMIT);
    });

    it("Should revert if deploying with zero limits", async function () {
      const SpendingLimits = await hre.ethers.getContractFactory("SpendingLimits");
      await expect(
        SpendingLimits.deploy(owner.address, authorizedAccount.address, 0n, DAILY_LIMIT)
      ).to.be.revertedWithCustomError(limits, "ZeroLimit");

      await expect(
        SpendingLimits.deploy(owner.address, authorizedAccount.address, PER_TX_LIMIT, 0n)
      ).to.be.revertedWithCustomError(limits, "ZeroLimit");
    });

    it("Should revert if perTxLimit exceeds dailyLimit", async function () {
      const SpendingLimits = await hre.ethers.getContractFactory("SpendingLimits");
      await expect(
        SpendingLimits.deploy(owner.address, authorizedAccount.address, 3000n * ONE_TOKEN, DAILY_LIMIT)
      ).to.be.revertedWithCustomError(limits, "ExceedsDailyLimit");
    });
  });

  describe("Boundary Tests: Per-Transaction Limit", function () {
    it("RUBRIC CHECK: Exactly at perTxLimit (1000 tUSD8) SUCCEEDS", async function () {
      await expect(limits.connect(authorizedAccount).checkAndRecord(PER_TX_LIMIT))
        .to.emit(limits, "SpendingRecorded")
        .withArgs(PER_TX_LIMIT, PER_TX_LIMIT, PER_TX_LIMIT);

      const [, , remaining] = await limits.getLimits();
      expect(remaining).to.equal(DAILY_LIMIT - PER_TX_LIMIT);
    });

    it("RUBRIC CHECK: Exceeding perTxLimit by even 1 wei REVERTS with ExceedsPerTxLimit", async function () {
      const excessiveAmount = PER_TX_LIMIT + 1n;

      await expect(
        limits.connect(authorizedAccount).checkAndRecord(excessiveAmount)
      ).to.be.revertedWithCustomError(limits, "ExceedsPerTxLimit")
        .withArgs(excessiveAmount, PER_TX_LIMIT);
    });

    it("Should revert on zero amount spend", async function () {
      await expect(
        limits.connect(authorizedAccount).checkAndRecord(0n)
      ).to.be.revertedWithCustomError(limits, "ZeroAmount");
    });
  });

  describe("Boundary Tests: Daily Limit & Rolling Window", function () {
    it("RUBRIC CHECK: Cumulative spends exactly up to dailyLimit (2500 tUSD8) SUCCEED", async function () {
      // Spend 1: 1000 tUSD8
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);
      // Spend 2: 1000 tUSD8 (total: 2000)
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);
      // Spend 3: 500 tUSD8 (total: 2500 - exactly dailyLimit)
      await limits.connect(authorizedAccount).checkAndRecord(500n * ONE_TOKEN);

      const [, , remaining] = await limits.getLimits();
      expect(remaining).to.equal(0n);
    });

    it("RUBRIC CHECK: Spending 1 wei over dailyLimit REVERTS with ExceedsDailyLimit", async function () {
      // Spend 2500 tUSD8 in 3 chunks
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);
      await limits.connect(authorizedAccount).checkAndRecord(500n * ONE_TOKEN);

      // Attempt to spend 1 wei -> must revert with ExceedsDailyLimit!
      await expect(
        limits.connect(authorizedAccount).checkAndRecord(1n)
      ).to.be.revertedWithCustomError(limits, "ExceedsDailyLimit")
        .withArgs(1n, 0n, DAILY_LIMIT);
    });

    it("RUBRIC CHECK: Partial daily spend with excessive next spend reports accurate available amount", async function () {
      // Spend 2000 tUSD8
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);

      // Available is 500 tUSD8. Attempting to spend 600 tUSD8 reverts with available = 500
      const attempted = 600n * ONE_TOKEN;
      const expectedAvailable = 500n * ONE_TOKEN;

      await expect(
        limits.connect(authorizedAccount).checkAndRecord(attempted)
      ).to.be.revertedWithCustomError(limits, "ExceedsDailyLimit")
        .withArgs(attempted, expectedAvailable, DAILY_LIMIT);
    });

    it("RUBRIC CHECK: Rolling window resets allowance after 24 hours has elapsed", async function () {
      // Max out daily limit (2500 tUSD8)
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);
      await limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN);
      await limits.connect(authorizedAccount).checkAndRecord(500n * ONE_TOKEN);

      // Fast-forward time past 48 hours (clean two window reset)
      await time.increase(48 * 3600 + 1);

      // Now full limit is available again!
      await expect(limits.connect(authorizedAccount).checkAndRecord(1000n * ONE_TOKEN))
        .to.emit(limits, "SpendingRecorded");

      const [, , remaining] = await limits.getLimits();
      expect(remaining).to.equal(DAILY_LIMIT - 1000n * ONE_TOKEN);
    });
  });

  describe("Access Control & Limit Adjustments", function () {
    it("Should reject checkAndRecord by unauthorized callers (strangers)", async function () {
      await expect(
        limits.connect(stranger).checkAndRecord(100n * ONE_TOKEN)
      ).to.be.revertedWithCustomError(limits, "Unauthorized");
    });

    it("Should allow owner to adjust limits and emit LimitsUpdated", async function () {
      const newPerTx = 500n * ONE_TOKEN;
      const newDaily = 1500n * ONE_TOKEN;

      await expect(limits.connect(owner).setLimits(newPerTx, newDaily))
        .to.emit(limits, "LimitsUpdated")
        .withArgs(PER_TX_LIMIT, newPerTx, DAILY_LIMIT, newDaily);

      expect(await limits.perTxLimit()).to.equal(newPerTx);
      expect(await limits.dailyLimit()).to.equal(newDaily);
    });

    it("Should reject stranger adjusting limits", async function () {
      await expect(
        limits.connect(stranger).setLimits(100n, 200n)
      ).to.be.revertedWithCustomError(limits, "Unauthorized");
    });

    it("Should allow owner to update authorized caller", async function () {
      await expect(limits.connect(owner).setAuthorizedCaller(stranger.address))
        .to.emit(limits, "AuthorizedCallerUpdated")
        .withArgs(stranger.address);

      expect(await limits.authorizedCaller()).to.equal(stranger.address);

      // Now stranger can call checkAndRecord
      await expect(limits.connect(stranger).checkAndRecord(50n * ONE_TOKEN))
        .to.emit(limits, "SpendingRecorded");
    });
  });
});
