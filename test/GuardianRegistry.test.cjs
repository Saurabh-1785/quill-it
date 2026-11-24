const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("GuardianRegistry (Day 6: Guardian Roles & Threshold)", function () {
  let registry;
  let account;
  let mockToken;
  let owner;
  let g1;
  let g2;
  let g3;
  let stranger;

  const THREE_DAYS = 3 * 24 * 3600; // 259,200 seconds

  beforeEach(async function () {
    [owner, g1, g2, g3, stranger] = await hre.ethers.getSigners();

    // Deploy GuardianRegistry
    const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
    registry = await GuardianRegistry.deploy(owner.address, THREE_DAYS);
    await registry.waitForDeployment();

    // Deploy GuardianAccount linked to registry
    const GuardianAccount = await hre.ethers.getContractFactory("GuardianAccount");
    account = await GuardianAccount.deploy(owner.address, await registry.getAddress());
    await account.waitForDeployment();

    // Deploy Mock tUSD8 & fund account
    const MockTUSD8 = await hre.ethers.getContractFactory("MockTUSD8");
    mockToken = await MockTUSD8.deploy("Test USD 8", "tUSD8", 18);
    await mockToken.waitForDeployment();
    await mockToken.mint(await account.getAddress(), 1000n * 10n ** 18n);
  });

  describe("Initialization & Basic State", function () {
    it("Should initialize with correct owner, removal delay, 0 guardians, and 0 threshold", async function () {
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.removalDelay()).to.equal(THREE_DAYS);
      expect(await registry.guardianCount()).to.equal(0n);
      expect(await registry.threshold()).to.equal(0n);
    });

    it("Should revert if deployed with zero address owner", async function () {
      const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
      await expect(
        GuardianRegistry.deploy(hre.ethers.ZeroAddress, THREE_DAYS)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  describe("Adding Guardians (Rubric: Stranger Cannot Add Guardian)", function () {
    it("Should allow owner to add a guardian and auto-set threshold to 1", async function () {
      await expect(registry.connect(owner).addGuardian(g1.address))
        .to.emit(registry, "GuardianAdded")
        .withArgs(g1.address)
        .and.to.emit(registry, "ThresholdUpdated")
        .withArgs(0n, 1n);

      expect(await registry.isGuardian(g1.address)).to.be.true;
      expect(await registry.guardianCount()).to.equal(1n);
      expect(await registry.threshold()).to.equal(1n);

      const list = await registry.getGuardians();
      expect(list).to.deep.equal([g1.address]);
    });

    it("Should REJECT attempts by a stranger to add a guardian", async function () {
      await expect(
        registry.connect(stranger).addGuardian(g1.address)
      ).to.be.revertedWithCustomError(registry, "Unauthorized");

      expect(await registry.isGuardian(g1.address)).to.be.false;
      expect(await registry.guardianCount()).to.equal(0n);
    });

    it("Should reject adding zero address", async function () {
      await expect(
        registry.connect(owner).addGuardian(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("Should reject adding owner as a guardian (separation of powers)", async function () {
      await expect(
        registry.connect(owner).addGuardian(owner.address)
      ).to.be.revertedWithCustomError(registry, "CannotBeOwner");
    });

    it("Should reject adding an already existing guardian", async function () {
      await registry.connect(owner).addGuardian(g1.address);
      await expect(
        registry.connect(owner).addGuardian(g1.address)
      ).to.be.revertedWithCustomError(registry, "AlreadyGuardian");
    });
  });

  describe("Threshold Configuration (m-of-n)", function () {
    beforeEach(async function () {
      await registry.connect(owner).addGuardian(g1.address);
      await registry.connect(owner).addGuardian(g2.address);
      await registry.connect(owner).addGuardian(g3.address);
    });

    it("Should allow owner to update threshold within valid bounds", async function () {
      await expect(registry.connect(owner).setThreshold(2n))
        .to.emit(registry, "ThresholdUpdated")
        .withArgs(1n, 2n);

      expect(await registry.threshold()).to.equal(2n);

      await expect(registry.connect(owner).setThreshold(3n))
        .to.emit(registry, "ThresholdUpdated")
        .withArgs(2n, 3n);

      expect(await registry.threshold()).to.equal(3n);
    });

    it("Should reject threshold of 0", async function () {
      await expect(
        registry.connect(owner).setThreshold(0n)
      ).to.be.revertedWithCustomError(registry, "InvalidThreshold")
        .withArgs(0n, 3n);
    });

    it("Should reject threshold exceeding total guardian count", async function () {
      await expect(
        registry.connect(owner).setThreshold(4n)
      ).to.be.revertedWithCustomError(registry, "InvalidThreshold")
        .withArgs(4n, 3n);
    });

    it("Should reject stranger updating threshold", async function () {
      await expect(
        registry.connect(stranger).setThreshold(2n)
      ).to.be.revertedWithCustomError(registry, "Unauthorized");
    });
  });

  describe("Time-Delayed Guardian Removal (Rubric: Removal Delay Holds)", function () {
    beforeEach(async function () {
      await registry.connect(owner).addGuardian(g1.address);
      await registry.connect(owner).addGuardian(g2.address);
      await registry.connect(owner).setThreshold(2n);
    });

    it("Should allow owner to propose guardian removal and emit event", async function () {
      const tx = await registry.connect(owner).proposeRemoveGuardian(g1.address);
      const block = await hre.ethers.provider.getBlock(tx.blockNumber);
      const expectedExecuteAfter = block.timestamp + THREE_DAYS;

      await expect(tx)
        .to.emit(registry, "GuardianRemovalProposed")
        .withArgs(g1.address, expectedExecuteAfter);

      const [isPending, executeAfter] = await registry.isPendingRemoval(g1.address);
      expect(isPending).to.be.true;
      expect(executeAfter).to.equal(expectedExecuteAfter);
    });

    it("Should reject removal proposal from stranger", async function () {
      await expect(
        registry.connect(stranger).proposeRemoveGuardian(g1.address)
      ).to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("Should reject proposing removal of non-guardian", async function () {
      await expect(
        registry.connect(owner).proposeRemoveGuardian(stranger.address)
      ).to.be.revertedWithCustomError(registry, "NotGuardian");
    });

    it("Should reject proposing removal if already pending", async function () {
      await registry.connect(owner).proposeRemoveGuardian(g1.address);
      await expect(
        registry.connect(owner).proposeRemoveGuardian(g1.address)
      ).to.be.revertedWithCustomError(registry, "RemovalAlreadyPending");
    });

    it("Should REVERT if attempting to finalize removal before delay has elapsed (Removal Delay Holds)", async function () {
      await registry.connect(owner).proposeRemoveGuardian(g1.address);

      // Fast-forward time to 1 hour before delay elapses
      await time.increase(THREE_DAYS - 3600);

      // Attempt execution prematurely
      await expect(
        registry.connect(owner).executeRemoveGuardian(g1.address)
      ).to.be.revertedWithCustomError(registry, "RemovalDelayNotElapsed");

      // g1 remains an active guardian
      expect(await registry.isGuardian(g1.address)).to.be.true;
    });

    it("Should SUCCEED in removing guardian once full removal delay has passed", async function () {
      await registry.connect(owner).proposeRemoveGuardian(g1.address);

      // Fast-forward time by full 3 days + 1 second
      await time.increase(THREE_DAYS + 1);

      // Finalize removal
      await expect(registry.connect(owner).executeRemoveGuardian(g1.address))
        .to.emit(registry, "GuardianRemoved")
        .withArgs(g1.address);

      expect(await registry.isGuardian(g1.address)).to.be.false;
      expect(await registry.guardianCount()).to.equal(1n);

      const [isPending] = await registry.isPendingRemoval(g1.address);
      expect(isPending).to.be.false;

      // Threshold was automatically adjusted to 1 because only 1 guardian remains
      expect(await registry.threshold()).to.equal(1n);
    });

    it("Should allow guardian or owner to CANCEL a pending removal (asymmetric defense)", async function () {
      await registry.connect(owner).proposeRemoveGuardian(g1.address);

      // g1 cancels the malicious removal proposal
      await expect(registry.connect(g1).cancelRemoveGuardian(g1.address))
        .to.emit(registry, "GuardianRemovalCancelled")
        .withArgs(g1.address);

      const [isPending] = await registry.isPendingRemoval(g1.address);
      expect(isPending).to.be.false;

      // Even if time elapses, execution fails because proposal was cancelled
      await time.increase(THREE_DAYS + 1);
      await expect(
        registry.connect(owner).executeRemoveGuardian(g1.address)
      ).to.be.revertedWithCustomError(registry, "NoRemovalPending");

      expect(await registry.isGuardian(g1.address)).to.be.true;
    });

    it("Should reject cancellation by stranger", async function () {
      await registry.connect(owner).proposeRemoveGuardian(g1.address);
      await expect(
        registry.connect(stranger).cancelRemoveGuardian(g1.address)
      ).to.be.revertedWithCustomError(registry, "Unauthorized");
    });
  });

  describe("Guardian Spending Prohibition (Rubric: Guardian Can Never Move Funds)", function () {
    beforeEach(async function () {
      await registry.connect(owner).addGuardian(g1.address);
      await registry.connect(owner).addGuardian(g2.address);
    });

    it("Should prove that a guardian CANNOT execute transfers from GuardianAccount", async function () {
      const amount = 100n * 10n ** 18n;

      // g1 is a verified active guardian
      expect(await registry.isGuardian(g1.address)).to.be.true;

      // g1 attempts direct token transfer from account -> REVERTS
      await expect(
        account.connect(g1).executeTokenTransfer(
          await mockToken.getAddress(),
          g1.address,
          amount
        )
      ).to.be.revertedWithCustomError(account, "Unauthorized");

      // g1 attempts arbitrary call execute -> REVERTS
      const calldata = mockToken.interface.encodeFunctionData("transfer", [g1.address, amount]);
      await expect(
        account.connect(g1).execute(await mockToken.getAddress(), 0n, calldata)
      ).to.be.revertedWithCustomError(account, "Unauthorized");

      // Account balance remains intact
      expect(await mockToken.balanceOf(await account.getAddress())).to.equal(1000n * 10n ** 18n);
    });

    it("Should allow guardian to freeze account, but still never spend funds while frozen or active", async function () {
      // Guardian triggers panic freeze
      await expect(account.connect(g1).freeze())
        .to.emit(account, "AccountFrozen")
        .withArgs(g1.address);

      expect(await account.status()).to.equal(1n); // FROZEN

      // Guardian still cannot spend funds
      await expect(
        account.connect(g1).executeTokenTransfer(
          await mockToken.getAddress(),
          g1.address,
          10n
        )
      ).to.be.revertedWithCustomError(account, "Unauthorized");
    });
  });
});
