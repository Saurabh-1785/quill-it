const { expect } = require("chai");
const hre = require("hardhat");

describe("GuardianAccount (Day 5: Smart Account Foundation)", function () {
  let mockToken;
  let guardianRegistry;
  let account;
  let owner;
  let guardian;
  let recipient;
  let stranger;

  const DECIMALS = 18n;
  const ONE_TOKEN = 10n ** DECIMALS;
  const INITIAL_BALANCE = 500n * ONE_TOKEN;

  beforeEach(async function () {
    [owner, guardian, recipient, stranger] = await hre.ethers.getSigners();

    // 1. Deploy Mock tUSD8
    const MockTUSD8 = await hre.ethers.getContractFactory("MockTUSD8");
    mockToken = await MockTUSD8.deploy("Test USD 8", "tUSD8", 18);
    await mockToken.waitForDeployment();

    // 2. Deploy GuardianRegistry with 3 days removal delay
    const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
    guardianRegistry = await GuardianRegistry.deploy(owner.address, 3 * 24 * 3600);
    await guardianRegistry.waitForDeployment();
    await guardianRegistry.addGuardian(guardian.address);

    // 3. Deploy GuardianAccount
    const GuardianAccount = await hre.ethers.getContractFactory("GuardianAccount");
    account = await GuardianAccount.deploy(owner.address, await guardianRegistry.getAddress());
    await account.waitForDeployment();

    // Fund the smart account with tUSD8
    await mockToken.mint(await account.getAddress(), INITIAL_BALANCE);
  });

  describe("Initialization & Funding", function () {
    it("Should correctly set owner, status, and guardian registry", async function () {
      expect(await account.owner()).to.equal(owner.address);
      expect(await account.status()).to.equal(0n); // ACTIVE
      expect(await account.nonce()).to.equal(0n);
      expect(await account.guardianRegistry()).to.equal(await guardianRegistry.getAddress());
    });

    it("Should revert if deployed with zero address owner", async function () {
      const GuardianAccount = await hre.ethers.getContractFactory("GuardianAccount");
      await expect(
        GuardianAccount.deploy(hre.ethers.ZeroAddress, hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(account, "ZeroAddress");
    });

    it("Should accept native ETH via receive() and emit NativeReceived", async function () {
      const amount = hre.ethers.parseEther("1.0");
      await expect(
        owner.sendTransaction({
          to: await account.getAddress(),
          value: amount,
        })
      )
        .to.emit(account, "NativeReceived")
        .withArgs(owner.address, amount);

      expect(await hre.ethers.provider.getBalance(await account.getAddress())).to.equal(amount);
    });

    it("Should hold tUSD8 tokens upon funding", async function () {
      expect(await mockToken.balanceOf(await account.getAddress())).to.equal(INITIAL_BALANCE);
    });
  });

  describe("Execution & Sending tUSD8 Out of Account", function () {
    it("Should execute a token transfer via executeTokenTransfer, with account as sender", async function () {
      const transferAmount = 100n * ONE_TOKEN;

      // Execute token transfer
      const tx = account.connect(owner).executeTokenTransfer(
        await mockToken.getAddress(),
        recipient.address,
        transferAmount
      );

      // Verify ERC20 Transfer event: from = smart account, to = recipient
      await expect(tx)
        .to.emit(mockToken, "Transfer")
        .withArgs(await account.getAddress(), recipient.address, transferAmount);

      // Verify smart account ExecutionSuccess event
      await expect(tx)
        .to.emit(account, "ExecutionSuccess");

      // Verify balances
      expect(await mockToken.balanceOf(await account.getAddress())).to.equal(INITIAL_BALANCE - transferAmount);
      expect(await mockToken.balanceOf(recipient.address)).to.equal(transferAmount);
      expect(await account.nonce()).to.equal(1n);
    });

    it("Should execute arbitrary call via execute() to transfer tUSD8", async function () {
      const transferAmount = 50n * ONE_TOKEN;
      const transferCalldata = mockToken.interface.encodeFunctionData("transfer", [
        recipient.address,
        transferAmount,
      ]);

      const tx = account.connect(owner).execute(
        await mockToken.getAddress(),
        0n,
        transferCalldata
      );

      await expect(tx)
        .to.emit(mockToken, "Transfer")
        .withArgs(await account.getAddress(), recipient.address, transferAmount);

      await expect(tx)
        .to.emit(account, "ExecutionSuccess")
        .withArgs(0n, await mockToken.getAddress(), 0n, transferCalldata);

      expect(await mockToken.balanceOf(await account.getAddress())).to.equal(INITIAL_BALANCE - transferAmount);
      expect(await mockToken.balanceOf(recipient.address)).to.equal(transferAmount);
      expect(await account.nonce()).to.equal(1n);
    });

    it("Should increment nonce monotonically on successive executions", async function () {
      const amount = 10n * ONE_TOKEN;

      await account.connect(owner).executeTokenTransfer(
        await mockToken.getAddress(),
        recipient.address,
        amount
      );
      expect(await account.nonce()).to.equal(1n);

      await account.connect(owner).executeTokenTransfer(
        await mockToken.getAddress(),
        recipient.address,
        amount
      );
      expect(await account.nonce()).to.equal(2n);
    });

    it("Should revert if target is zero address", async function () {
      await expect(
        account.connect(owner).execute(hre.ethers.ZeroAddress, 0n, "0x")
      ).to.be.revertedWithCustomError(account, "ZeroAddress");

      await expect(
        account.connect(owner).executeTokenTransfer(hre.ethers.ZeroAddress, recipient.address, 100n)
      ).to.be.revertedWithCustomError(account, "ZeroAddress");
    });
  });

  describe("Access Control & Guardian Spending Prevention", function () {
    it("Should reject execution attempts by strangers", async function () {
      const transferAmount = 50n * ONE_TOKEN;

      await expect(
        account.connect(stranger).executeTokenTransfer(
          await mockToken.getAddress(),
          stranger.address,
          transferAmount
        )
      ).to.be.revertedWithCustomError(account, "Unauthorized");

      const transferCalldata = mockToken.interface.encodeFunctionData("transfer", [
        stranger.address,
        transferAmount,
      ]);

      await expect(
        account.connect(stranger).execute(
          await mockToken.getAddress(),
          0n,
          transferCalldata
        )
      ).to.be.revertedWithCustomError(account, "Unauthorized");
    });

    it("Should reject execution attempts by guardians (guardians cannot move funds)", async function () {
      const transferAmount = 50n * ONE_TOKEN;

      await expect(
        account.connect(guardian).executeTokenTransfer(
          await mockToken.getAddress(),
          guardian.address,
          transferAmount
        )
      ).to.be.revertedWithCustomError(account, "Unauthorized");

      const transferCalldata = mockToken.interface.encodeFunctionData("transfer", [
        guardian.address,
        transferAmount,
      ]);

      await expect(
        account.connect(guardian).execute(
          await mockToken.getAddress(),
          0n,
          transferCalldata
        )
      ).to.be.revertedWithCustomError(account, "Unauthorized");
    });
  });

  describe("Emergency Panic Freeze & Recovery", function () {
    it("Should allow owner to freeze account", async function () {
      await expect(account.connect(owner).freeze())
        .to.emit(account, "AccountFrozen")
        .withArgs(owner.address);

      expect(await account.status()).to.equal(1n); // FROZEN
    });

    it("Should allow registered guardian to freeze account", async function () {
      await expect(account.connect(guardian).freeze())
        .to.emit(account, "AccountFrozen")
        .withArgs(guardian.address);

      expect(await account.status()).to.equal(1n); // FROZEN
    });

    it("Should reject freeze attempts from unauthorized strangers", async function () {
      await expect(
        account.connect(stranger).freeze()
      ).to.be.revertedWithCustomError(account, "Unauthorized");
    });

    it("Should block all executions while account is frozen", async function () {
      // Guardian freezes account
      await account.connect(guardian).freeze();

      // Owner tries to execute spend
      await expect(
        account.connect(owner).executeTokenTransfer(
          await mockToken.getAddress(),
          recipient.address,
          10n * ONE_TOKEN
        )
      ).to.be.revertedWithCustomError(account, "AccountIsFrozen");
    });

    it("Should allow owner to unfreeze and resume executions", async function () {
      await account.connect(guardian).freeze();
      expect(await account.status()).to.equal(1n);

      await expect(account.connect(owner).unfreeze())
        .to.emit(account, "AccountUnfrozen")
        .withArgs(owner.address);

      expect(await account.status()).to.equal(0n);

      // Now execution succeeds
      await expect(
        account.connect(owner).executeTokenTransfer(
          await mockToken.getAddress(),
          recipient.address,
          10n * ONE_TOKEN
        )
      ).to.emit(mockToken, "Transfer");
    });

    it("Should reject unfreeze attempts from non-owner", async function () {
      await account.connect(guardian).freeze();

      await expect(
        account.connect(guardian).unfreeze()
      ).to.be.revertedWithCustomError(account, "Unauthorized");

      await expect(
        account.connect(stranger).unfreeze()
      ).to.be.revertedWithCustomError(account, "Unauthorized");
    });
  });

  describe("Ownership Transfer & Registry Updates", function () {
    it("Should allow owner to transfer ownership", async function () {
      const [_, __, ___, ____, newOwner] = await hre.ethers.getSigners();

      await expect(account.connect(owner).transferOwnership(newOwner.address))
        .to.emit(account, "OwnershipTransferred")
        .withArgs(owner.address, newOwner.address);

      expect(await account.owner()).to.equal(newOwner.address);

      // Previous owner can no longer execute
      await expect(
        account.connect(owner).executeTokenTransfer(
          await mockToken.getAddress(),
          recipient.address,
          10n * ONE_TOKEN
        )
      ).to.be.revertedWithCustomError(account, "Unauthorized");

      // New owner can execute
      await expect(
        account.connect(newOwner).executeTokenTransfer(
          await mockToken.getAddress(),
          recipient.address,
          10n * ONE_TOKEN
        )
      ).to.emit(mockToken, "Transfer");
    });

    it("Should revert when transferring ownership to zero address", async function () {
      await expect(
        account.connect(owner).transferOwnership(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(account, "ZeroAddress");
    });

    it("Should allow owner to update guardian registry", async function () {
      const dummyRegistry = recipient.address;
      await expect(account.connect(owner).setGuardianRegistry(dummyRegistry))
        .to.emit(account, "GuardianRegistryUpdated")
        .withArgs(dummyRegistry);

      expect(await account.guardianRegistry()).to.equal(dummyRegistry);
    });
  });

  describe("Guarded Execution with PayeeRegistry & SpendingLimits (Days 7-8)", function () {
    let payeeRegistry;
    let spendingLimits;

    const COOLDOWN_24H = 24 * 3600;
    const PER_TX_CAP = 100n * ONE_TOKEN;  // 100 tUSD8
    const DAILY_CAP = 250n * ONE_TOKEN;   // 250 tUSD8

    beforeEach(async function () {
      const { time } = require("@nomicfoundation/hardhat-network-helpers");

      // Deploy PayeeRegistry
      const PayeeRegistry = await hre.ethers.getContractFactory("PayeeRegistry");
      payeeRegistry = await PayeeRegistry.deploy(
        owner.address,
        await guardianRegistry.getAddress(),
        COOLDOWN_24H
      );
      await payeeRegistry.waitForDeployment();

      // Deploy SpendingLimits
      const SpendingLimits = await hre.ethers.getContractFactory("SpendingLimits");
      spendingLimits = await SpendingLimits.deploy(
        owner.address,
        await account.getAddress(),
        PER_TX_CAP,
        DAILY_CAP
      );
      await spendingLimits.waitForDeployment();

      // Link modules to GuardianAccount
      await account.connect(owner).setPayeeRegistry(await payeeRegistry.getAddress());
      await account.connect(owner).setSpendingLimits(await spendingLimits.getAddress());
    });

    it("Should REJECT guarded transfer to unadded or unknown payee", async function () {
      await expect(
        account.connect(owner).executeGuardedTransfer(
          await mockToken.getAddress(),
          recipient.address,
          50n * ONE_TOKEN
        )
      ).to.be.revertedWithCustomError(account, "PayeeNotTrusted")
        .withArgs(recipient.address, 0n);
    });

    it("Should REJECT guarded transfer to payee whose 24h cooldown has NOT yet elapsed", async function () {
      const { time } = require("@nomicfoundation/hardhat-network-helpers");

      // Owner registers recipient as TRUSTED
      await payeeRegistry.connect(owner).setPayee(recipient.address, 1n); // TRUSTED

      // Immediate spend within cooldown reverts with PayeeNotTrusted (tier UNKNOWN = 0)
      await expect(
        account.connect(owner).executeGuardedTransfer(
          await mockToken.getAddress(),
          recipient.address,
          50n * ONE_TOKEN
        )
      ).to.be.revertedWithCustomError(account, "PayeeNotTrusted")
        .withArgs(recipient.address, 0n);
    });

    it("Should SUCCEED with guarded transfer once payee cooldown has passed and within limits", async function () {
      const { time } = require("@nomicfoundation/hardhat-network-helpers");

      await payeeRegistry.connect(owner).setPayee(recipient.address, 1n);
      await time.increase(COOLDOWN_24H + 1);

      await expect(
        account.connect(owner).executeGuardedTransfer(
          await mockToken.getAddress(),
          recipient.address,
          50n * ONE_TOKEN
        )
      ).to.emit(mockToken, "Transfer")
        .withArgs(await account.getAddress(), recipient.address, 50n * ONE_TOKEN);

      expect(await mockToken.balanceOf(recipient.address)).to.equal(50n * ONE_TOKEN);
    });

    it("Should REJECT guarded transfer exceeding per-transaction limit with ExceedsPerTxLimit", async function () {
      const { time } = require("@nomicfoundation/hardhat-network-helpers");

      await payeeRegistry.connect(owner).setPayee(recipient.address, 1n);
      await time.increase(COOLDOWN_24H + 1);

      // Attempt 150 tUSD8 (exceeds 100 tUSD8 cap)
      const excessiveAmount = 150n * ONE_TOKEN;
      await expect(
        account.connect(owner).executeGuardedTransfer(
          await mockToken.getAddress(),
          recipient.address,
          excessiveAmount
        )
      ).to.be.revertedWithCustomError(spendingLimits, "ExceedsPerTxLimit")
        .withArgs(excessiveAmount, PER_TX_CAP);
    });

    it("Should REJECT guarded transfer exceeding daily limit with ExceedsDailyLimit", async function () {
      const { time } = require("@nomicfoundation/hardhat-network-helpers");

      await payeeRegistry.connect(owner).setPayee(recipient.address, 1n);
      await time.increase(COOLDOWN_24H + 1);

      // Spend 100 + 100 = 200 tUSD8
      await account.connect(owner).executeGuardedTransfer(
        await mockToken.getAddress(),
        recipient.address,
        100n * ONE_TOKEN
      );
      await account.connect(owner).executeGuardedTransfer(
        await mockToken.getAddress(),
        recipient.address,
        100n * ONE_TOKEN
      );

      // Attempt to spend another 100 tUSD8 (200 + 100 = 300 > 250 daily limit)
      await expect(
        account.connect(owner).executeGuardedTransfer(
          await mockToken.getAddress(),
          recipient.address,
          100n * ONE_TOKEN
        )
      ).to.be.revertedWithCustomError(spendingLimits, "ExceedsDailyLimit")
        .withArgs(100n * ONE_TOKEN, 50n * ONE_TOKEN, DAILY_CAP);
    });
  });
});
