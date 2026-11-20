const { expect } = require("chai");
const hre = require("hardhat");

describe("Probe Contract (Day 3 Toolchain Test)", function () {
  it("Should deploy Probe with correct network tag and deployer", async function () {
    const [owner] = await hre.ethers.getSigners();
    const Probe = await hre.ethers.getContractFactory("Probe");
    const probe = await Probe.deploy("Aevum-Testnet-Local");
    await probe.waitForDeployment();

    expect(await probe.VERSION()).to.equal("1.0.0");
    expect(await probe.networkTag()).to.equal("Aevum-Testnet-Local");
    expect(await probe.deployer()).to.equal(owner.address);
    expect(await probe.pingCount()).to.equal(0n);
  });

  it("Should increment pingCount and emit Ping event", async function () {
    const [owner, caller] = await hre.ethers.getSigners();
    const Probe = await hre.ethers.getContractFactory("Probe");
    const probe = await Probe.deploy("Aevum-Testnet-Local");
    await probe.waitForDeployment();

    const tx = await probe.connect(caller).ping();
    await expect(tx)
      .to.emit(probe, "Ping")
      .withArgs(caller.address, 1n, (await hre.ethers.provider.getBlock("latest")).timestamp);

    expect(await probe.pingCount()).to.equal(1n);
  });
});
