const hre = require("hardhat");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const address = process.env.DISPUTE_ESCROW_ADDRESS;
  if (!address) throw new Error("Set DISPUTE_ESCROW_ADDRESS to the V2 deployment.");

  const [plaintiff] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;
  const defendant = hre.ethers.Wallet.createRandom().connect(provider);
  const escrow = await hre.ethers.getContractAt("DisputeEscrowV2", address);
  const stake = hre.ethers.parseEther(process.env.LIVE_PROOF_STAKE || "0.01");

  console.log("Gavel V2 live proof");
  console.log("Contract:", address);
  console.log("Plaintiff:", plaintiff.address);
  console.log("Defendant:", defendant.address);

  const fundTx = await plaintiff.sendTransaction({ to: defendant.address, value: hre.ethers.parseEther("0.05") });
  await fundTx.wait();
  console.log("Defendant funding tx:", fundTx.hash);

  const createTx = await escrow.connect(plaintiff).createDispute(
    defendant.address,
    "Audit whether the public Gavel repository documents a complete five-stage autonomous jury.",
    { value: stake }
  );
  const createReceipt = await createTx.wait();
  const created = createReceipt.logs
    .map((log) => {
      try { return escrow.interface.parseLog(log); } catch { return null; }
    })
    .find((log) => log?.name === "DisputeCreated");
  const id = created.args.id;
  console.log("Case:", id.toString(), "create tx:", createTx.hash);

  const joinTx = await escrow.connect(defendant).joinDispute(id, { value: stake });
  await joinTx.wait();
  console.log("Join tx:", joinTx.hash);

  const plaintiffEvidenceTx = await escrow.connect(plaintiff).submitEvidence(
    id,
    "https://github.com/NikhilRaikwar/Gavel/blob/main/README.md"
  );
  await plaintiffEvidenceTx.wait();
  const defendantEvidenceTx = await escrow.connect(defendant).submitEvidence(
    id,
    "https://github.com/NikhilRaikwar/Gavel/blob/main/agents/README.md"
  );
  await defendantEvidenceTx.wait();
  console.log("Evidence txs:", plaintiffEvidenceTx.hash, defendantEvidenceTx.hash);

  const budget = await escrow.minimumAgentBudget();
  const arbitrationTx = await escrow.connect(plaintiff).requestArbitration(id, { value: budget });
  await arbitrationTx.wait();
  console.log("Arbitration tx:", arbitrationTx.hash, "budget:", hre.ethers.formatEther(budget), "STT");

  const deadline = Date.now() + 30 * 60 * 1000;
  let retries = 0;
  while (Date.now() < deadline) {
    const dispute = await escrow.getDispute(id);
    const requestIds = await escrow.getStageRequestIds(id);
    console.log("State:", Number(dispute.state), "stage:", Number(dispute.currentStage), "requests:", requestIds.map(String).join(","));

    if (Number(dispute.state) === 5) {
      console.log("VERDICT:", {
        winner: dispute.winner,
        confidence: Number(dispute.confidence),
        reasoning: dispute.verdictReasoning,
        requestIds: requestIds.map(String)
      });
      const credit = await escrow.withdrawable(plaintiff.address);
      if (credit > 0n) {
        const withdrawTx = await escrow.connect(plaintiff).withdraw();
        await withdrawTx.wait();
        console.log("Plaintiff withdrawal tx:", withdrawTx.hash);
      }
      const defendantCredit = await escrow.withdrawable(defendant.address);
      if (defendantCredit > 0n) {
        const withdrawTx = await escrow.connect(defendant).withdraw();
        await withdrawTx.wait();
        console.log("Defendant withdrawal tx:", withdrawTx.hash);
      }
      return;
    }

    if (Number(dispute.state) === 4) {
      if (retries >= 2) throw new Error(`Live proof failed at stage ${Number(dispute.failedStage)} after two retries.`);
      const retryBudget = await escrow.requiredBudget(dispute.failedStage);
      const retryTx = await escrow.connect(plaintiff).retryFailedStage(id, { value: retryBudget });
      await retryTx.wait();
      retries++;
      console.log("Retry tx:", retryTx.hash);
    }
    await sleep(10000);
  }
  throw new Error("Timed out waiting for the autonomous five-stage verdict.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
