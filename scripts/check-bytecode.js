const hre = require("hardhat");

const CONTRACTS = {
  "DisputeEscrowV2.1 (primary)": "0x0BCEF4b601A497Db5A57AC211Ed95d01ad009A4A",
  "DisputeEscrowV2.0 (superseded)": "0x331Abe04BdEB265B4838586CE45eE7b553A66389",
  "DisputeEscrowV2 (completed case proof)": "0xEd614e7A3A80fd26426c6780cC15cf9a4F003f21",
  "DisputeEscrow V1 (retired)": "0xdc9A2ea119467AADcee21258A54138A8B138f6c5",
  "SomniaAgents platform": "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"
};

async function main() {
  console.log("Gavel bytecode live check");
  console.log("RPC:", hre.network.config.url);
  console.log("-".repeat(60));

  for (const [label, address] of Object.entries(CONTRACTS)) {
    const code = await hre.ethers.provider.getCode(address);
    const live = code !== "0x";
    const sizeBytes = live ? Math.floor((code.length - 2) / 2) : 0;
    console.log(`${live ? "OK" : "MISSING"} ${label}`);
    console.log(`  Address: ${address}`);
    console.log(`  Bytecode: ${live ? `${sizeBytes.toLocaleString()} bytes` : "not deployed"}`);
  }

  const v2Address = CONTRACTS["DisputeEscrowV2.1 (primary)"];
  const escrow = await hre.ethers.getContractAt(
    [
      "function version() pure returns (string)",
      "function parseWebsiteAgentId() view returns (uint256)",
      "function inferenceAgentId() view returns (uint256)",
      "function SUBCOMMITTEE_SIZE() view returns (uint256)",
      "function minimumAgentBudget() view returns (uint256)",
      "function disputeCount() view returns (uint256)"
    ],
    v2Address
  );

  console.log("-".repeat(60));
  const platform = await hre.ethers.getContractAt(
    ["function getRequestDeposit() view returns (uint256)"],
    CONTRACTS["SomniaAgents platform"]
  );
  try {
    console.log("version():", await escrow.version());
  } catch {
    console.log("version(): not present in the current deployment; available in the latest source");
  }
  console.log("platform request deposit:", hre.ethers.formatEther(await platform.getRequestDeposit()), "STT");
  console.log("parseWebsiteAgentId():", (await escrow.parseWebsiteAgentId()).toString());
  console.log("inferenceAgentId():", (await escrow.inferenceAgentId()).toString());
  console.log("SUBCOMMITTEE_SIZE():", (await escrow.SUBCOMMITTEE_SIZE()).toString());
  console.log("minimumAgentBudget():", hre.ethers.formatEther(await escrow.minimumAgentBudget()), "STT");
  console.log("disputeCount():", (await escrow.disputeCount()).toString());

  const constructorArgs = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256"],
    [
      CONTRACTS["SomniaAgents platform"],
      "12875401142070969085",
      "12847293847561029384"
    ]
  );
  console.log("constructor args:", constructorArgs.slice(2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
