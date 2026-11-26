const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("==================================================");
  console.log("Guardian Wallet - Day 7 & 8: Payee Registry & Spending Limits");
  console.log(`Network: ${hre.network.name} (Chain ID: ${hre.network.config.chainId || "unknown"})`);
  console.log("==================================================");

  const [deployer, trustedPayee, stranger] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured. Check PRIVATE_KEY in your .env");
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer / Owner:  ${deployer.address}`);
  console.log(`Native Balance:    ${hre.ethers.formatEther(balance)} native tokens\n`);

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

  const DECIMALS = 18n;
  const ONE_TOKEN = 10n ** DECIMALS;

  // 1. Resolve or Deploy MockTUSD8
  let tokenAddress = process.env.TUSD8_ADDRESS;
  if (!tokenAddress && networkName !== "hardhat" && deployments[networkName]?.MockTUSD8?.address) {
    tokenAddress = deployments[networkName].MockTUSD8.address;
  }

  let mockToken;
  let hasTokenCode = false;
  if (tokenAddress && hre.ethers.isAddress(tokenAddress)) {
    const code = await hre.ethers.provider.getCode(tokenAddress);
    hasTokenCode = code !== "0x";
  }

  if (hasTokenCode) {
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

  // 2. Resolve or Deploy GuardianRegistry
  let registryAddress = networkName !== "hardhat" ? deployments[networkName]?.GuardianRegistry?.address : null;
  let guardianRegistry;
  if (registryAddress && (await hre.ethers.provider.getCode(registryAddress)) !== "0x") {
    console.log(`Using existing GuardianRegistry at: ${registryAddress}`);
    guardianRegistry = await hre.ethers.getContractAt("GuardianRegistry", registryAddress, deployer);
  } else {
    console.log("Deploying GuardianRegistry (72h removal delay)...");
    const GuardianRegistry = await hre.ethers.getContractFactory("GuardianRegistry");
    guardianRegistry = await GuardianRegistry.deploy(deployer.address, 3 * 24 * 3600);
    await guardianRegistry.waitForDeployment();
    registryAddress = await guardianRegistry.getAddress();
    console.log(`GuardianRegistry deployed at: ${registryAddress}`);
  }

  // 3. Resolve or Deploy GuardianAccount
  let accountAddress = networkName !== "hardhat" ? deployments[networkName]?.GuardianAccount?.address : null;
  let account;
  if (accountAddress && (await hre.ethers.provider.getCode(accountAddress)) !== "0x") {
    console.log(`Using existing GuardianAccount at: ${accountAddress}`);
    account = await hre.ethers.getContractAt("GuardianAccount", accountAddress, deployer);
  } else {
    console.log("Deploying GuardianAccount...");
    const GuardianAccount = await hre.ethers.getContractFactory("GuardianAccount");
    account = await GuardianAccount.deploy(deployer.address, registryAddress);
    await account.waitForDeployment();
    accountAddress = await account.getAddress();
    console.log(`GuardianAccount deployed at: ${accountAddress}`);
  }

  // 4. Deploy PayeeRegistry (Day 7)
  const COOLDOWN_24H = 24 * 3600; // 24 hours
  console.log(`\nDeploying PayeeRegistry (cooldown: ${COOLDOWN_24H}s / 24h)...`);
  const PayeeRegistry = await hre.ethers.getContractFactory("PayeeRegistry");
  const payeeRegistry = await PayeeRegistry.deploy(deployer.address, registryAddress, COOLDOWN_24H);
  await payeeRegistry.waitForDeployment();
  const payeeRegistryAddress = await payeeRegistry.getAddress();
  const payeeRegistryTx = payeeRegistry.deploymentTransaction()?.hash;
  console.log(`PayeeRegistry deployed at: ${payeeRegistryAddress}`);

  // 5. Deploy SpendingLimits (Day 8)
  const PER_TX_CAP = 100n * ONE_TOKEN; // 100 tUSD8
  const DAILY_CAP = 250n * ONE_TOKEN;  // 250 tUSD8
  console.log(`\nDeploying SpendingLimits (perTx: 100 tUSD8, daily: 250 tUSD8)...`);
  const SpendingLimits = await hre.ethers.getContractFactory("SpendingLimits");
  const spendingLimits = await SpendingLimits.deploy(
    deployer.address,
    accountAddress,
    PER_TX_CAP,
    DAILY_CAP
  );
  await spendingLimits.waitForDeployment();
  const spendingLimitsAddress = await spendingLimits.getAddress();
  const spendingLimitsTx = spendingLimits.deploymentTransaction()?.hash;
  console.log(`SpendingLimits deployed at: ${spendingLimitsAddress}`);

  // 6. Link Modules to GuardianAccount
  console.log("\nLinking PayeeRegistry and SpendingLimits to GuardianAccount...");
  const setPayeeTx = await account.setPayeeRegistry(payeeRegistryAddress);
  await setPayeeTx.wait();
  const setLimitsTx = await account.setSpendingLimits(spendingLimitsAddress);
  await setLimitsTx.wait();
  console.log("Modules linked successfully!");

  // 7. Fund GuardianAccount with tUSD8
  console.log("\nFunding GuardianAccount with 500 tUSD8...");
  const fundTx = await mockToken.mint(accountAddress, 500n * ONE_TOKEN);
  await fundTx.wait();
  console.log(`Account tUSD8 Balance: ${hre.ethers.formatUnits(await mockToken.balanceOf(accountAddress), 18)} tUSD8`);

  // --- 8. DAY 7 VERIFICATION: PAYEE COOLDOWN ---
  console.log("\n--- Day 7 Verification: Payee Registry & Cooldown ---");
  const payeeAddr = trustedPayee ? trustedPayee.address : "0x3333333333333333333333333333333333333333";
  console.log(`Adding payee ${payeeAddr} as TRUSTED...`);
  const addPayeeTx = await payeeRegistry.setPayee(payeeAddr, 1n); // TRUSTED
  await addPayeeTx.wait();

  const effectiveTier = await payeeRegistry.getEffectiveTier(payeeAddr);
  const isTrustedNow = await payeeRegistry.isTrusted(payeeAddr);
  console.log(`Immediate Effective Tier: ${effectiveTier} (0 = UNKNOWN)`);
  console.log(`Is Trusted Immediately:   ${isTrustedNow} (must be FALSE due to cooldown)`);

  // Verify attempted spend during cooldown is rejected
  let cooldownRejectionVerified = false;
  try {
    await account.executeGuardedTransfer(tokenAddress, payeeAddr, 50n * ONE_TOKEN);
  } catch (err) {
    if (err.message.includes("PayeeNotTrusted")) {
      console.log(`✅ Verified: Guarded transfer during cooldown REVERTED with expected error: PayeeNotTrusted`);
      cooldownRejectionVerified = true;
    } else {
      console.log(`Caught error: ${err.message}`);
    }
  }

  // If local hardhat network, advance time past cooldown to verify activation
  let postCooldownTxHash = null;
  if (networkName === "hardhat") {
    const { time } = require("@nomicfoundation/hardhat-network-helpers");
    console.log("Advancing time by 24h + 1s to elapse cooldown...");
    await time.increase(COOLDOWN_24H + 1);

    const postEffectiveTier = await payeeRegistry.getEffectiveTier(payeeAddr);
    console.log(`Post-Cooldown Effective Tier: ${postEffectiveTier} (1 = TRUSTED)`);
    console.log(`Is Trusted Post-Cooldown:    ${await payeeRegistry.isTrusted(payeeAddr)}`);

    console.log("Executing guarded transfer of 50 tUSD8 (within limits)...");
    const guardedTransferTx = await account.executeGuardedTransfer(tokenAddress, payeeAddr, 50n * ONE_TOKEN);
    const receipt = await guardedTransferTx.wait();
    postCooldownTxHash = guardedTransferTx.hash;
    console.log(`✅ Guarded Transfer Succeeded! Tx Hash: ${postCooldownTxHash} (Gas: ${receipt.gasUsed})`);
  }

  // --- 9. DAY 8 VERIFICATION: SPENDING LIMITS & BOUNDARY ENFORCEMENT ---
  console.log("\n--- Day 8 Verification: Spending Limits & Boundary Rejections ---");
  let perTxRejectionVerified = false;
  let perTxRejectionError = "";

  console.log("Testing transfer of 150 tUSD8 (exceeds 100 tUSD8 per-tx limit)...");
  try {
    await account.executeGuardedTransfer(tokenAddress, payeeAddr, 150n * ONE_TOKEN);
  } catch (err) {
    if (err.message.includes("ExceedsPerTxLimit")) {
      perTxRejectionVerified = true;
      perTxRejectionError = "ExceedsPerTxLimit(150000000000000000000, 100000000000000000000)";
      console.log(`✅ Verified: Excessive transfer REVERTED with expected custom error: ${perTxRejectionError}`);
    } else {
      console.log(`Caught error: ${err.message}`);
    }
  }

  // 10. Update deployments.json
  deployments[networkName].PayeeRegistry = {
    address: payeeRegistryAddress,
    owner: deployer.address,
    cooldownPeriod: COOLDOWN_24H,
    transactionHash: payeeRegistryTx,
    chainId: hre.network.config.chainId || 44005,
    timestamp: new Date().toISOString(),
    verificationActivity: {
      testedPayee: payeeAddr,
      immediateEffectiveTier: Number(effectiveTier),
      cooldownRejectionVerified: cooldownRejectionVerified,
      postCooldownTransferTxHash: postCooldownTxHash,
    },
  };

  deployments[networkName].SpendingLimits = {
    address: spendingLimitsAddress,
    owner: deployer.address,
    authorizedCaller: accountAddress,
    perTxLimit: PER_TX_CAP.toString(),
    dailyLimit: DAILY_CAP.toString(),
    transactionHash: spendingLimitsTx,
    chainId: hre.network.config.chainId || 44005,
    timestamp: new Date().toISOString(),
    verificationActivity: {
      perTxLimitTested: "150000000000000000000",
      perTxCap: PER_TX_CAP.toString(),
      rejectionVerified: perTxRejectionVerified,
      expectedCustomError: perTxRejectionError,
    },
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nUpdated deployments.json successfully.`);
  console.log("==================================================");
  console.log("Summary for Days 7 & 8:");
  console.log(`PayeeRegistry:                 ${payeeRegistryAddress}`);
  console.log(`SpendingLimits:                ${spendingLimitsAddress}`);
  console.log(`Cooldown Rejection Verified:   ${cooldownRejectionVerified}`);
  console.log(`Per-Tx Rejection Verified:     ${perTxRejectionVerified}`);
  if (postCooldownTxHash) console.log(`Post-Cooldown Transfer Hash:   ${postCooldownTxHash}`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
