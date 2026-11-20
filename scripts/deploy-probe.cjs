const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("--------------------------------------------------");
  console.log("Guardian Wallet - Day 3 Deploy Probe Contract");
  console.log(`Network: ${hre.network.name} (Chain ID: ${hre.network.config.chainId || "unknown"})`);
  console.log("--------------------------------------------------");

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account configured. Set PRIVATE_KEY in your .env file or check hardhat.config.cjs"
    );
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} native tokens`);

  const networkTag = "Aevum-Testnet-Day3";
  console.log(`Deploying Probe contract with tag: "${networkTag}"...`);

  const Probe = await hre.ethers.getContractFactory("Probe");
  const probe = await Probe.deploy(networkTag);
  await probe.waitForDeployment();

  const probeAddress = await probe.getAddress();
  const deploymentTx = probe.deploymentTransaction();

  console.log(`Probe deployed successfully!`);
  console.log(`Contract Address: ${probeAddress}`);
  console.log(`Transaction Hash: ${deploymentTx.hash}`);
  console.log(`Explorer URL:     https://explorer-test.qday.info/address/${probeAddress}`);

  // Write/Update deployments.json
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    try {
      deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
    } catch (e) {
      deployments = {};
    }
  }

  const networkName = hre.network.name;
  if (!deployments[networkName]) {
    deployments[networkName] = {};
  }

  deployments[networkName].Probe = {
    address: probeAddress,
    deployer: deployer.address,
    transactionHash: deploymentTx.hash,
    networkTag: networkTag,
    chainId: hre.network.config.chainId || 44005,
    timestamp: new Date().toISOString(),
    verified: false,
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`Updated deployments.json successfully.`);
  console.log("--------------------------------------------------");
  console.log(`Verification command:`);
  console.log(`npx hardhat verify --network aevum ${probeAddress} "${networkTag}"`);
  console.log("--------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
