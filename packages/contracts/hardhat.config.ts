import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    localhost: { type: "http", chainType: "l1", url: "http://127.0.0.1:8545" },
    fuji: {
      type: "http",
      chainType: "l1",
      url: process.env.FUJI_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com",
      // the human guardian deploys and bootstraps; the key comes from .env.guardian, not from the agents' env file
      accounts: [configVariable("GUARDIAN_PRIVATE_KEY")],
    },
  },
});
