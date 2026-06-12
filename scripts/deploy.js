const hre = require("hardhat");

async function main() {
  const platform = process.env.SOMNIA_AGENTS_ADDRESS || "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
  const parseAgentId = process.env.PARSE_WEBSITE_AGENT_ID || "12875401142070969085";
  const judgeAgentId = process.env.JUDGE_INFERENCE_AGENT_ID || "12847293847561029384";

  console.log("=================================================");
  console.log("  Deploying DisputeEscrowV2 - PRIMARY SUBMISSION");
  console.log("  Five stages: Research x2, Validator, Skeptic, Judge");
  console.log("=================================================");

  const DisputeEscrow = await hre.ethers.getContractFactory("DisputeEscrowV2");
  const escrow = await DisputeEscrow.deploy(platform, parseAgentId, judgeAgentId);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("DisputeEscrowV2 deployed to:", address);
  console.log("Source version:", await escrow.version());
  console.log("Minimum five-stage agent budget:", hre.ethers.formatEther(await escrow.minimumAgentBudget()), "STT");
  console.log("SomniaAgents platform:", platform);
  console.log("Parse Website agent ID:", parseAgentId);
  console.log("Judge Inference agent ID:", judgeAgentId);
  console.log("Next: set DISPUTE_ESCROW_ADDRESS and VITE_DISPUTE_ESCROW_ADDRESS to", address);
  console.log("Then run npm run verify:somnia and npm run frontend:build");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
