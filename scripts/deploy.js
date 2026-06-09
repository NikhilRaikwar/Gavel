const hre = require("hardhat");

async function main() {
  const platform = process.env.SOMNIA_AGENTS_ADDRESS || "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
  const parseAgentId = process.env.PARSE_WEBSITE_AGENT_ID || "12875401142070969085";
  const judgeAgentId = process.env.JUDGE_INFERENCE_AGENT_ID || "12847293847561029384";

  const DisputeEscrow = await hre.ethers.getContractFactory("DisputeEscrowV2");
  const escrow = await DisputeEscrow.deploy(platform, parseAgentId, judgeAgentId);
  await escrow.waitForDeployment();

  console.log("DisputeEscrowV2 deployed to:", await escrow.getAddress());
  console.log("Minimum five-stage agent budget:", hre.ethers.formatEther(await escrow.minimumAgentBudget()), "STT");
  console.log("SomniaAgents platform:", platform);
  console.log("Parse Website agent ID:", parseAgentId);
  console.log("Judge Inference agent ID:", judgeAgentId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
