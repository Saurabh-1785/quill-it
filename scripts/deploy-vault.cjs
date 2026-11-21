const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("==================================================");
  console.log("Guardian Wallet - Day 4: tUSD8 Inside Contracts");
  console.log(`Network: ${hre.network.name} (Chain ID: ${hre.network.config.chainId || "unknown"})`);
  console.log("==================================================");

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account configured. Set PRIVATE_KEY in your .env file or check hardhat.config.cjs"
    );
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} native tokens\n`);

  // 1. Resolve or deploy tUSD8 Token
  let tokenAddress = process.env.TUSD8_ADDRESS;
  let mockToken;
  let tokenTxHash = null;

  if (tokenAddress && hre.ethers.isAddress(tokenAddress)) {
    console.log(`Using existing tUSD8 token at: ${tokenAddress}`);
  } else {
    console.log("Deploying MockTUSD8 ('Test USD 8', symbol 'tUSD8', 18 decimals)...");
    const MockTUSD8 = await hre.ethers.getContractFactory("MockTUSD8");
    mockToken = await MockTUSD8.deploy("Test USD 8", "tUSD8", 18);
    await mockToken.waitForDeployment();
    tokenAddress = await mockToken.getAddress();
    const tokenDeployTx = mockToken.deploymentTransaction();
    tokenTxHash = tokenDeployTx ? tokenDeployTx.hash : null;
    console.log(`MockTUSD8 deployed at: ${tokenAddress}`);
    if (tokenTxHash) console.log(`Deployment Tx: ${tokenTxHash}`);
  }

  // 2. Deploy Vault Contract
  console.log("\nDeploying Vault contract...");
  const Vault = await hre.ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(tokenAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  const vaultDeployTx = vault.deploymentTransaction();
  const vaultTxHash = vaultDeployTx ? vaultDeployTx.hash : null;
  console.log(`Vault deployed at: ${vaultAddress}`);
  if (vaultTxHash) console.log(`Deployment Tx: ${vaultTxHash}`);

  // 3. Perform Live Testnet Interaction: Deposit & Withdrawal
  console.log("\n--- Executing On-Chain Deposit & Withdrawal Verification ---");
  const DECIMALS = 18n;
  const depositAmount = 100n * 10n ** DECIMALS; // 100 tUSD8
  const withdrawAmount = 50n * 10n ** DECIMALS; // 50 tUSD8

  // Ensure deployer has enough tokens
  const tokenContract = await hre.ethers.getContractAt("IERC20", tokenAddress, deployer);
  let deployerTokenBalance = await tokenContract.balanceOf(deployer.address);

  if (deployerTokenBalance < depositAmount && mockToken) {
    console.log("Minting tUSD8 to deployer...");
    const mintTx = await mockToken.mint(deployer.address, depositAmount * 2n);
    await mintTx.wait();
  }

  deployerTokenBalance = await tokenContract.balanceOf(deployer.address);
  console.log(`Deployer token balance: ${hre.ethers.formatUnits(deployerTokenBalance, DECIMALS)} tUSD8`);

  // Step A: Approve Vault
  console.log(`Approving Vault for ${hre.ethers.formatUnits(depositAmount, DECIMALS)} tUSD8...`);
  const approveTx = await tokenContract.approve(vaultAddress, depositAmount);
  await approveTx.wait();
  console.log(`Approve Tx: ${approveTx.hash}`);

  // Step B: Deposit
  console.log(`Depositing ${hre.ethers.formatUnits(depositAmount, DECIMALS)} tUSD8 into Vault...`);
  const depositTx = await vault.deposit(depositAmount);
  const depositReceipt = await depositTx.wait();
  const depositTxHash = depositTx.hash;
  console.log(`Deposit successful! Tx Hash: ${depositTxHash} (Gas used: ${depositReceipt.gasUsed})`);

  let vaultBalance = await vault.balanceOf(deployer.address);
  console.log(`Deployer Vault balance after deposit: ${hre.ethers.formatUnits(vaultBalance, DECIMALS)} tUSD8`);

  // Step C: Withdraw
  console.log(`\nWithdrawing ${hre.ethers.formatUnits(withdrawAmount, DECIMALS)} tUSD8 from Vault...`);
  const withdrawTx = await vault.withdraw(withdrawAmount);
  const withdrawReceipt = await withdrawTx.wait();
  const withdrawTxHash = withdrawTx.hash;
  console.log(`Withdrawal successful! Tx Hash: ${withdrawTxHash} (Gas used: ${withdrawReceipt.gasUsed})`);

  vaultBalance = await vault.balanceOf(deployer.address);
  console.log(`Deployer Vault balance after withdrawal: ${hre.ethers.formatUnits(vaultBalance, DECIMALS)} tUSD8`);
  console.log(`Total Vault deposits: ${hre.ethers.formatUnits(await vault.totalDeposits(), DECIMALS)} tUSD8`);

  // 4. Update deployments.json
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

  deployments[networkName].MockTUSD8 = {
    address: tokenAddress,
    deployer: deployer.address,
    transactionHash: tokenTxHash,
    decimals: 18,
    symbol: "tUSD8",
    chainId: hre.network.config.chainId || 44005,
    timestamp: new Date().toISOString(),
  };

  deployments[networkName].Vault = {
    address: vaultAddress,
    tokenAddress: tokenAddress,
    deployer: deployer.address,
    transactionHash: vaultTxHash,
    chainId: hre.network.config.chainId || 44005,
    timestamp: new Date().toISOString(),
    verificationActivity: {
      depositAmount: depositAmount.toString(),
      depositTransactionHash: depositTxHash,
      withdrawAmount: withdrawAmount.toString(),
      withdrawTransactionHash: withdrawTxHash,
    },
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nUpdated deployments.json successfully.`);
  console.log("==================================================");
  console.log("Summary for EVIDENCE.md:");
  console.log(`Vault Address:        ${vaultAddress}`);
  console.log(`Deposit Tx Hash:      ${depositTxHash}`);
  console.log(`Withdrawal Tx Hash:   ${withdrawTxHash}`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
