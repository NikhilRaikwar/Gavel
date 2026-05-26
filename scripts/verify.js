const hre = require("hardhat");

async function main() {
  const address = process.env.DISPUTE_ESCROW_ADDRESS;
  const platform = process.env.SOMNIA_AGENTS_ADDRESS || "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
  const parseAgentId = process.env.PARSE_WEBSITE_AGENT_ID || "12875401142070969085";
  const judgeAgentId = process.env.JUDGE_INFERENCE_AGENT_ID || "12847293847561029384";

  if (!address) throw new Error("Set DISPUTE_ESCROW_ADDRESS to the deployed contract address.");

  await hre.run("verify:verify", {
    address,
    constructorArguments: [platform, parseAgentId, judgeAgentId]
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
