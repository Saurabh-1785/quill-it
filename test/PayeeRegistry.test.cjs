const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PayeeRegistry (Day 7: Payee Registry & Trust Tiers)", function () {
  let registry;
  let guardianRegistry;
  let owner;
  let guardian;
  let store;
  let merchant;
  let stranger;

  const COOLDOWN_24H = 24 * 3600; // 86,400 seconds
  const TrustTier = {
    UNKNOWN: 0n,
    TRUSTED: 1n,
    VERIFIED_IDENTITY: 2n,
  };

  beforeEach(async function () {
    [owner, guardian, store, merchant, stranger] = await hre.ethers.getSigners();

    // Deploy GuardianRegistry
    const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
    guardianRegistry = await GuardianRegistry.deploy(owner.address, 3 * 24 * 3600);
    await guardianRegistry.waitForDeployment();
    await guardianRegistry.addGuardian(guardian.address);

    // Deploy PayeeRegistry
    const PayeeRegistry = await hre.ethers.getContractFactory("PayeeRegistry");
    registry = await PayeeRegistry.deploy(
      owner.address,
      await guardianRegistry.getAddress(),
      COOLDOWN_24H
    );
    await registry.waitForDeployment();
  });

  describe("Initialization & State", function () {
    it("Should initialize with correct owner, guardianRegistry, and 24h cooldown", async function () {
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.guardianRegistry()).to.equal(await guardianRegistry.getAddress());
      expect(await registry.cooldownPeriod()).to.equal(COOLDOWN_24H);
    });

    it("Should revert if deployed with zero address owner", async function () {
      const PayeeRegistry = await hre.ethers.getContractFactory("PayeeRegistry");
      await expect(
        PayeeRegistry.deploy(hre.ethers.ZeroAddress, hre.ethers.ZeroAddress, COOLDOWN_24H)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("Should treat any unadded address as UNKNOWN and not trusted", async function () {
      expect(await registry.getEffectiveTier(store.address)).to.equal(TrustTier.UNKNOWN);
      expect(await registry.isTrusted(store.address)).to.be.false;
    });
  });

  describe("Payee Addition & Mandatory Cooldown (Core Day 7 Requirement)", function () {
    it("Should register a payee as TRUSTED and emit PayeeRegistered event", async function () {
      const tx = await registry.connect(owner).setPayee(store.address, TrustTier.TRUSTED);
      const block = await hre.ethers.provider.getBlock(tx.blockNumber);
      const expectedCooldownEndsAt = block.timestamp + COOLDOWN_24H;

      await expect(tx)
        .to.emit(registry, "PayeeRegistered")
        .withArgs(store.address, TrustTier.TRUSTED, block.timestamp, expectedCooldownEndsAt);

      expect(await registry.rawTiers(store.address)).to.equal(TrustTier.TRUSTED);
      expect(await registry.registeredAt(store.address)).to.equal(block.timestamp);
    });

    it("RUBRIC CHECK: A payee added just now is still treated as UNKNOWN during cooldown", async function () {
      // Owner adds store
      await registry.connect(owner).setPayee(store.address, TrustTier.TRUSTED);

      // Immediately query effective tier -> must be UNKNOWN (0)!
      expect(await registry.getEffectiveTier(store.address)).to.equal(TrustTier.UNKNOWN);
      expect(await registry.isTrusted(store.address)).to.be.false;

      const [rawTier, effectiveTier, registeredTimestamp, cooldownEndsAt, cooldownActive] =
        await registry.getPayeeInfo(store.address);

      expect(rawTier).to.equal(TrustTier.TRUSTED);
      expect(effectiveTier).to.equal(TrustTier.UNKNOWN);
      expect(cooldownActive).to.be.true;
    });

    it("Should still treat payee as UNKNOWN 1 second before cooldown expires", async function () {
      await registry.connect(owner).setPayee(store.address, TrustTier.TRUSTED);

      // Fast forward time to (24h - 1 second)
      await time.increase(COOLDOWN_24H - 1);

      expect(await registry.getEffectiveTier(store.address)).to.equal(TrustTier.UNKNOWN);
      expect(await registry.isTrusted(store.address)).to.be.false;
    });

    it("Should activate TRUSTED status once full 24h cooldown has elapsed", async function () {
      await registry.connect(owner).setPayee(store.address, TrustTier.TRUSTED);

      // Fast forward time to exactly 24h + 1s
      await time.increase(COOLDOWN_24H + 1);

      expect(await registry.getEffectiveTier(store.address)).to.equal(TrustTier.TRUSTED);
      expect(await registry.isTrusted(store.address)).to.be.true;

      const [, effectiveTier, , , cooldownActive] = await registry.getPayeeInfo(store.address);
      expect(effectiveTier).to.equal(TrustTier.TRUSTED);
      expect(cooldownActive).to.be.false;
    });

    it("Should immediately trust VERIFIED_IDENTITY tier without cooldown", async function () {
      await registry.connect(owner).setPayee(merchant.address, TrustTier.VERIFIED_IDENTITY);

      expect(await registry.getEffectiveTier(merchant.address)).to.equal(TrustTier.VERIFIED_IDENTITY);
      expect(await registry.isTrusted(merchant.address)).to.be.true;
    });
  });

  describe("Payee Revocation & Asymmetric Guardian Oversight", function () {
    beforeEach(async function () {
      await registry.connect(owner).setPayee(store.address, TrustTier.TRUSTED);
      await time.increase(COOLDOWN_24H + 1);
      expect(await registry.isTrusted(store.address)).to.be.true;
    });

    it("Should allow owner to revoke a trusted payee", async function () {
      await expect(registry.connect(owner).revokePayee(store.address))
        .to.emit(registry, "PayeeRevoked")
        .withArgs(store.address, owner.address);

      expect(await registry.getEffectiveTier(store.address)).to.equal(TrustTier.UNKNOWN);
      expect(await registry.isTrusted(store.address)).to.be.false;
    });

    it("Should allow a REGISTERED GUARDIAN to revoke a payee (Asymmetric Defense)", async function () {
      await expect(registry.connect(guardian).revokePayee(store.address))
        .to.emit(registry, "PayeeRevoked")
        .withArgs(store.address, guardian.address);

      expect(await registry.getEffectiveTier(store.address)).to.equal(TrustTier.UNKNOWN);
      expect(await registry.isTrusted(store.address)).to.be.false;
    });

    it("Should reject revocation attempts by strangers", async function () {
      await expect(
        registry.connect(stranger).revokePayee(store.address)
      ).to.be.revertedWithCustomError(registry, "Unauthorized");

      expect(await registry.isTrusted(store.address)).to.be.true;
    });

    it("Should revert if revoking an address that is not registered", async function () {
      await expect(
        registry.connect(owner).revokePayee(stranger.address)
      ).to.be.revertedWithCustomError(registry, "PayeeNotRegistered");
    });
  });

  describe("Access Control & Configuration Updates", function () {
    it("Should reject payee addition by strangers", async function () {
      await expect(
        registry.connect(stranger).setPayee(store.address, TrustTier.TRUSTED)
      ).to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("Should reject adding zero address", async function () {
      await expect(
        registry.connect(owner).setPayee(hre.ethers.ZeroAddress, TrustTier.TRUSTED)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("Should allow owner to update cooldown period", async function () {
      const newPeriod = 12 * 3600; // 12h
      await expect(registry.connect(owner).setCooldownPeriod(newPeriod))
        .to.emit(registry, "CooldownPeriodUpdated")
        .withArgs(COOLDOWN_24H, newPeriod);

      expect(await registry.cooldownPeriod()).to.equal(newPeriod);
    });

    it("Should allow owner to update guardian registry link", async function () {
      const dummyRegistry = stranger.address;
      await expect(registry.connect(owner).setGuardianRegistry(dummyRegistry))
        .to.emit(registry, "GuardianRegistryUpdated")
        .withArgs(dummyRegistry);

      expect(await registry.guardianRegistry()).to.equal(dummyRegistry);
    });
  });
});
