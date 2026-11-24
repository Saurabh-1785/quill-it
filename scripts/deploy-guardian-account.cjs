const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("==================================================");
  console.log("Guardian Wallet - Day 5 & 6: Smart Account & Guardian Registry");
  console.log(`Network: ${hre.network.name} (Chain ID: ${hre.network.config.chainId || "unknown"})`);
  console.log("==================================================");

  const [deployer, recipient, guardianCandidate] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account configured. Set PRIVATE_KEY in your .env file or check hardhat.config.cjs"
    );
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer / Owner:   ${deployer.address}`);
  console.log(`Balance:            ${hre.ethers.formatEther(balance)} native tokens\n`);

  // Read existing deployments.json if present
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

  // 1. Resolve or deploy tUSD8 Token
  let tokenAddress = process.env.TUSD8_ADDRESS;
  if (!tokenAddress && hre.network.name !== "hardhat" && deployments[networkName]?.MockTUSD8?.address) {
    tokenAddress = deployments[networkName].MockTUSD8.address;
  }

  let mockToken;
  let hasCode = false;
  if (tokenAddress && hre.ethers.isAddress(tokenAddress)) {
    const code = await hre.ethers.provider.getCode(tokenAddress);
    hasCode = code !== "0x";
  }

  if (hasCode) {
    console.log(`Using existing tUSD8 token at: ${tokenAddress}`);
    mockToken = await hre.ethers.getContractAt("MockTUSD8", tokenAddress, deployer);
  } else {
    console.log("Deploying MockTUSD8 ('Test USD 8', symbol 'tUSD8', 18 decimals)...");
    const MockTUSD8 = await hre.ethers.getContractFactory("MockTUSD8");
    mockToken = await MockTUSD8.deploy("Test USD 8", "tUSD8", 18);
    await mockToken.waitForDeployment();
    tokenAddress = await mockToken.getAddress();
    console.log(`MockTUSD8 deployed at: ${tokenAddress}`);
  }

  // 2. Deploy GuardianRegistry (Day 6)
  const removalDelay = 3 * 24 * 3600; // 3 days (72h) timelock
  console.log(`\nDeploying GuardianRegistry (removalDelay: ${removalDelay}s / 72h)...`);
  const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
  const registry = await GuardianRegistry.deploy(deployer.address, removalDelay);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  const registryTxHash = registry.deploymentTransaction()?.hash;
  console.log(`GuardianRegistry deployed at: ${registryAddress}`);
  if (registryTxHash) console.log(`Deployment Tx: ${registryTxHash}`);

  // 3. Deploy GuardianAccount (Day 5)
  console.log("\nDeploying GuardianAccount (smart account foundation)...");
  const GuardianAccount = await hre.ethers.getContractFactory("GuardianAccount");
  const account = await GuardianAccount.deploy(deployer.address, registryAddress);
  await account.waitForDeployment();
  const accountAddress = await account.getAddress();
  const accountTxHash = account.deploymentTransaction()?.hash;
  console.log(`GuardianAccount deployed at: ${accountAddress}`);
  if (accountTxHash) console.log(`Deployment Tx: ${accountTxHash}`);

  // 4. Day 5 Verification: Fund Smart Account & Send tUSD8 OUT of it
  console.log("\n--- Day 5 Verification: Smart Account Sending tUSD8 ---");
  const DECIMALS = 18n;
  const fundAmount = 250n * 10n ** DECIMALS;     // 250 tUSD8
  const transferOutAmount = 75n * 10n ** DECIMALS; // 75 tUSD8
  const testRecipient = recipient ? recipient.address : "0x000000000000000000000000000000000000dEaD";

  console.log(`Funding smart account with ${hre.ethers.formatUnits(fundAmount, DECIMALS)} tUSD8...`);
  const mintTx = await mockToken.mint(accountAddress, fundAmount);
  await mintTx.wait();

  let accountTokenBalance = await mockToken.balanceOf(accountAddress);
  console.log(`Smart Account tUSD8 balance: ${hre.ethers.formatUnits(accountTokenBalance, DECIMALS)} tUSD8`);

  console.log(`Executing tUSD8 transfer out of smart account to ${testRecipient}...`);
  const transferTx = await account.executeTokenTransfer(tokenAddress, testRecipient, transferOutAmount);
  const transferReceipt = await transferTx.wait();
  const transferTxHash = transferTx.hash;
  console.log(`tUSD8 Outbound Transfer Tx Hash: ${transferTxHash} (Gas used: ${transferReceipt.gasUsed})`);

  accountTokenBalance = await mockToken.balanceOf(accountAddress);
  const recipientBalance = await mockToken.balanceOf(testRecipient);
  console.log(`Smart Account remaining balance: ${hre.ethers.formatUnits(accountTokenBalance, DECIMALS)} tUSD8`);
  console.log(`Recipient token balance:        ${hre.ethers.formatUnits(recipientBalance, DECIMALS)} tUSD8`);
  console.log(`Smart Account Nonce:             ${await account.nonce()}`);

  // 5. Day 6 Verification: Add Guardian & Configure Threshold
  console.log("\n--- Day 6 Verification: Guardian Roles & Threshold ---");
  const guardianAddress = guardianCandidate ? guardianCandidate.address : "0x2222222222222222222222222222222222222222";
  console.log(`Adding guardian: ${guardianAddress}...`);
  const addGuardianTx = await registry.addGuardian(guardianAddress);
  const addGuardianReceipt = await addGuardianTx.wait();
  console.log(`Guardian Added! Tx Hash: ${addGuardianTx.hash} (Gas used: ${addGuardianReceipt.gasUsed})`);
  console.log(`Is Guardian:     ${await registry.isGuardian(guardianAddress)}`);
  console.log(`Guardian Count:  ${await registry.guardianCount()}`);
  console.log(`Threshold:       ${await registry.threshold()}`);

  // 6. Update deployments.json
  deployments[networkName].GuardianRegistry = {
    address: registryAddress,
    owner: deployer.address,
    removalDelay: removalDelay,
    transactionHash: registryTxHash,
    chainId: hre.network.config.chainId || 44005,
    timestamp: new Date().toISOString(),
    initialGuardians: [guardianAddress],
    threshold: Number(await registry.threshold()),
  };

  deployments[networkName].GuardianAccount = {
    address: accountAddress,
    owner: deployer.address,
    guardianRegistry: registryAddress,
    transactionHash: accountTxHash,
    chainId: hre.network.config.chainId || 44005,
    timestamp: new Date().toISOString(),
    verificationActivity: {
      fundedAmount: fundAmount.toString(),
      transferredOutAmount: transferOutAmount.toString(),
      recipient: testRecipient,
      outboundTransferTransactionHash: transferTxHash,
      addGuardianTransactionHash: addGuardianTx.hash,
    },
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nUpdated deployments.json successfully.`);
  console.log("==================================================");
  console.log("Day 5 & 6 Deployment Summary:");
  console.log(`GuardianAccount:         ${accountAddress}`);
  console.log(`GuardianRegistry:        ${registryAddress}`);
  console.log(`tUSD8 Outbound Tx Hash:  ${transferTxHash}`);
  console.log(`Add Guardian Tx Hash:    ${addGuardianTx.hash}`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
