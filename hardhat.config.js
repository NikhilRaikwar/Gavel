require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const privateKey = process.env.PRIVATE_KEY || "";
const somniaExplorerApiKey = process.env.SOMNIA_ETHERSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {},
    somniaTestnet: {
      url: process.env.SOMNIA_RPC_URL || "https://api.infra.testnet.somnia.network",
      chainId: 50312,
      accounts: privateKey ? [privateKey] : []
    }
  },
  etherscan: {
    apiKey: {
      somniaTestnet: somniaExplorerApiKey
    },
    customChains: [
      {
        network: "somniaTestnet",
        chainId: 50312,
        urls: {
          apiURL: process.env.SOMNIA_EXPLORER_API_URL || "https://shannon-explorer.somnia.network/api",
          browserURL: process.env.SOMNIA_EXPLORER_BROWSER_URL || "https://shannon-explorer.somnia.network"
        }
      }
    ]
  }
};
