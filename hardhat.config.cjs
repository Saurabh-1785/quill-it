require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const AEVUM_RPC_URL = process.env.AEVUM_RPC_URL || "https://rpc-test.qday.info";
const PRIVATE_KEY = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    aevum: {
      url: AEVUM_RPC_URL,
      chainId: 44005,
      accounts: PRIVATE_KEY,
    },
  },
  etherscan: {
    apiKey: {
      aevum: "empty", // Blockscout does not require an API key
    },
    customChains: [
      {
        network: "aevum",
        chainId: 44005,
        urls: {
          apiURL: "https://explorer-test.qday.info/api",
          browserURL: "https://explorer-test.qday.info",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};
