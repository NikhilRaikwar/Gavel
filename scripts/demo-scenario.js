const hre = require("hardhat");

async function main() {
  const address = process.env.DISPUTE_ESCROW_ADDRESS;
  if (!address) throw new Error("Set DISPUTE_ESCROW_ADDRESS");

  const [plaintiff, defendant] = await hre.ethers.getSigners();
  const escrow = await hre.ethers.getContractAt("DisputeEscrow", address);

  const stake = hre.ethers.parseEther("1");
  const createTx = await escrow.connect(plaintiff).createDispute(
    defendant.address,
    "Freelancer delivered a logo package; client claims the files were incomplete.",
    { value: stake }
  );
  const createReceipt = await createTx.wait();
  const event = createReceipt.logs
    .map((log) => {
      try {
        return escrow.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "DisputeCreated");

  const disputeId = event.args.id;
  await escrow.connect(defendant).joinDispute(disputeId, { value: stake });
  await escrow.connect(plaintiff).submitEvidence(disputeId, "https://github.com/example/gavel-demo/commit/9f42");
  await escrow.connect(defendant).submitEvidence(disputeId, "https://example.com/client-milestone-notes");

  console.log("Demo dispute ready:", disputeId.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
