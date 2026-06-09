const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("DisputeEscrowV2", function () {
  const parseAgentId = 101;
  const inferenceAgentId = 202;
  const stake = ethers.parseEther("1");

  async function deployFixture() {
    const [plaintiff, defendant, stranger] = await ethers.getSigners();
    const Platform = await ethers.getContractFactory("MockAgentRequester");
    const platform = await Platform.deploy();
    const Escrow = await ethers.getContractFactory("DisputeEscrowV2");
    const escrow = await Escrow.deploy(await platform.getAddress(), parseAgentId, inferenceAgentId);
    return { escrow, platform, plaintiff, defendant, stranger };
  }

  async function evidenceReady() {
    const fixture = await deployFixture();
    const { escrow, plaintiff, defendant } = fixture;
    await escrow.connect(plaintiff).createDispute(defendant.address, "Milestone delivery dispute", { value: stake });
    await escrow.connect(defendant).joinDispute(0, { value: stake });
    await escrow.connect(plaintiff).submitEvidence(0, "https://example.com/plaintiff");
    await escrow.connect(defendant).submitEvidence(0, "https://example.com/defendant");
    return fixture;
  }

  async function started(extra = 0n) {
    const fixture = await evidenceReady();
    const { escrow, plaintiff } = fixture;
    const budget = await escrow.minimumAgentBudget();
    await escrow.connect(plaintiff).requestArbitration(0, { value: budget + extra });
    return fixture;
  }

  async function reachJudge(fixture) {
    const { platform } = fixture;
    await platform.fulfillString(1, "plaintiff research");
    await platform.fulfillString(2, "defendant research");
    await platform.fulfillString(3, "validator report");
    await platform.fulfillString(4, "skeptic report");
  }

  it("creates indexed cases for both parties", async function () {
    const { escrow, plaintiff, defendant } = await deployFixture();
    await escrow.connect(plaintiff).createDispute(defendant.address, "Valid dispute", { value: stake });
    expect(await escrow.getPartyCaseIds(plaintiff.address)).to.deep.equal([0n]);
    expect(await escrow.getPartyCaseIds(defendant.address)).to.deep.equal([0n]);
  });

  it("rejects invalid defendants and descriptions", async function () {
    const { escrow, plaintiff } = await deployFixture();
    await expect(escrow.connect(plaintiff).createDispute(plaintiff.address, "Self", { value: stake })).to.be.revertedWith("Invalid defendant");
    await expect(escrow.connect(plaintiff).createDispute(ethers.Wallet.createRandom().address, "", { value: stake })).to.be.revertedWith("Invalid description");
  });

  it("joins with an exactly matching stake", async function () {
    const { escrow, plaintiff, defendant } = await deployFixture();
    await escrow.connect(plaintiff).createDispute(defendant.address, "Join test", { value: stake });
    await expect(escrow.connect(defendant).joinDispute(0, { value: stake })).to.emit(escrow, "DisputeJoined");
    expect((await escrow.getDispute(0)).state).to.equal(1);
  });

  it("rejects non-http evidence and non-party evidence", async function () {
    const { escrow, plaintiff, defendant, stranger } = await deployFixture();
    await escrow.connect(plaintiff).createDispute(defendant.address, "Evidence test", { value: stake });
    await escrow.connect(defendant).joinDispute(0, { value: stake });
    await expect(escrow.connect(plaintiff).submitEvidence(0, "ipfs://claim")).to.be.revertedWith("URL must use http(s)");
    await expect(escrow.connect(stranger).submitEvidence(0, "https://example.com/no")).to.be.revertedWith("Only parties");
  });

  it("freezes evidence after arbitration starts", async function () {
    const { escrow, plaintiff } = await started();
    await expect(escrow.connect(plaintiff).submitEvidence(0, "https://example.com/new")).to.be.revertedWith("Evidence frozen");
  });

  it("requires a party and the calculated minimum budget", async function () {
    const { escrow, plaintiff, stranger } = await evidenceReady();
    const budget = await escrow.minimumAgentBudget();
    await expect(escrow.connect(stranger).requestArbitration(0, { value: budget })).to.be.revertedWith("Only parties");
    await expect(escrow.connect(plaintiff).requestArbitration(0, { value: budget - 1n })).to.be.revertedWith("Insufficient agent budget");
  });

  it("runs all five autonomous stages and stores request ids", async function () {
    const fixture = await started();
    const { escrow, platform } = fixture;
    await reachJudge(fixture);
    expect(await escrow.getStageRequestIds(0)).to.deep.equal([1n, 2n, 3n, 4n, 5n]);
    expect((await platform.createdRequests(1)).agentId).to.equal(parseAgentId);
    expect((await platform.createdRequests(3)).agentId).to.equal(inferenceAgentId);
  });

  it("resolves a plaintiff verdict into pull-payment credit", async function () {
    const fixture = await started();
    const { escrow, platform, plaintiff } = fixture;
    await reachJudge(fixture);
    await expect(platform.fulfillString(5, "GAVEL_V1|plaintiff|94|Milestone was proven complete"))
      .to.emit(escrow, "VerdictDelivered")
      .withArgs(0, plaintiff.address, 94, "Milestone was proven complete");
    expect(await escrow.withdrawable(plaintiff.address)).to.equal(stake * 2n);
    expect((await escrow.getDispute(0)).state).to.equal(5);
  });

  it("resolves a defendant verdict", async function () {
    const fixture = await started();
    const { escrow, platform, defendant } = fixture;
    await reachJudge(fixture);
    await platform.fulfillString(5, "GAVEL_V1|defendant|81|Delivery was incomplete");
    expect(await escrow.withdrawable(defendant.address)).to.equal(stake * 2n);
  });

  it("resolves a split verdict without losing odd wei", async function () {
    const fixture = await started();
    const { escrow, platform, plaintiff, defendant } = fixture;
    await reachJudge(fixture);
    await platform.fulfillString(5, "GAVEL_V1|split|50|Evidence was balanced");
    expect(await escrow.withdrawable(plaintiff.address)).to.equal(stake);
    expect(await escrow.withdrawable(defendant.address)).to.equal(stake);
  });

  it("rejects malformed winner output as a retryable failure", async function () {
    const fixture = await started();
    const { escrow, platform } = fixture;
    await reachJudge(fixture);
    await expect(platform.fulfillString(5, "GAVEL_V1|attacker|99|Pay attacker")).to.emit(escrow, "AgentRequestFailed");
    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(4);
    expect(dispute.failedStage).to.equal(5);
  });

  it("rejects malformed confidence output", async function () {
    const fixture = await started();
    const { escrow, platform } = fixture;
    await reachJudge(fixture);
    await platform.fulfillString(5, "GAVEL_V1|plaintiff|101|Impossible confidence");
    expect((await escrow.getDispute(0)).state).to.equal(4);
  });

  it("rejects extra separators in verdict output", async function () {
    const fixture = await started();
    const { escrow, platform } = fixture;
    await reachJudge(fixture);
    await platform.fulfillString(5, "GAVEL_V1|plaintiff|90|Bad|extra");
    expect((await escrow.getDispute(0)).state).to.equal(4);
  });

  it("marks failed and empty successful callbacks as failed", async function () {
    const fixture = await started();
    const { escrow, platform } = fixture;
    await platform.fulfillEmpty(1);
    expect((await escrow.getDispute(0)).state).to.equal(4);
  });

  it("rejects unauthorized callbacks", async function () {
    const { escrow } = await started();
    await expect(escrow.handleResponse(1, [], 3, emptyRequest())).to.be.revertedWith("Only platform");
  });

  it("rejects duplicate callbacks", async function () {
    const { escrow, platform } = await started();
    await platform.fulfillString(1, "research");
    await expect(platform.fulfillString(1, "duplicate")).to.be.revertedWith("Unknown request");
    expect((await escrow.getDispute(0)).currentStage).to.equal(2);
  });

  it("retries the exact failed stage", async function () {
    const fixture = await started();
    const { escrow, platform, plaintiff } = fixture;
    await platform.fail(1, 4);
    const required = await escrow.requiredBudget(1);
    await expect(escrow.connect(plaintiff).retryFailedStage(0, { value: required })).to.emit(escrow, "AgentStageRetried");
    expect((await escrow.getStageRequestIds(0))[0]).to.equal(2);
    expect((await escrow.getDispute(0)).state).to.equal(3);
  });

  it("prevents recovery before the delay", async function () {
    const { escrow, platform, plaintiff } = await started();
    await platform.fail(1, 3);
    await expect(escrow.connect(plaintiff).recoverFailedDispute(0)).to.be.revertedWith("Recovery delay");
  });

  it("recovers all escrow and unused budget after a permanent failure", async function () {
    const { escrow, platform, plaintiff, defendant } = await started(ethers.parseEther("0.5"));
    await platform.fail(1, 3);
    await network.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
    await network.provider.send("evm_mine");
    await escrow.connect(defendant).recoverFailedDispute(0);
    expect(await escrow.withdrawable(plaintiff.address)).to.be.greaterThan(stake);
    expect(await escrow.withdrawable(defendant.address)).to.equal(stake);
    expect((await escrow.getDispute(0)).state).to.equal(7);
  });

  it("expires only pre-arbitration cases and credits deposits", async function () {
    const { escrow, plaintiff, defendant } = await deployFixture();
    await escrow.connect(plaintiff).createDispute(defendant.address, "Expiry", { value: stake });
    await network.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await network.provider.send("evm_mine");
    await escrow.claimExpiry(0);
    expect(await escrow.withdrawable(plaintiff.address)).to.equal(stake);
    expect((await escrow.getDispute(0)).state).to.equal(6);
  });

  it("does not allow arbitrating cases to erase escrow through expiry", async function () {
    const { escrow } = await started();
    await network.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await network.provider.send("evm_mine");
    await expect(escrow.claimExpiry(0)).to.be.revertedWith("State cannot expire");
  });

  it("refunds excess initial agent budget to the original funder", async function () {
    const extra = ethers.parseEther("0.5");
    const fixture = await started(extra);
    const { escrow, platform, plaintiff } = fixture;
    await reachJudge(fixture);
    await platform.fulfillString(5, "GAVEL_V1|defendant|70|Defendant wins");
    expect(await escrow.withdrawable(plaintiff.address)).to.equal(extra);
  });

  it("tracks platform rebates separately and honestly", async function () {
    const { escrow, platform } = await deployFixture();
    await platform.sendRebate(await escrow.getAddress(), { value: 123n });
    expect(await escrow.unallocatedPlatformRebates()).to.equal(123n);
  });

  it("withdraws credits and updates total liabilities", async function () {
    const fixture = await started();
    const { escrow, platform, plaintiff } = fixture;
    await reachJudge(fixture);
    await platform.fulfillString(5, "GAVEL_V1|plaintiff|90|Plaintiff wins");
    expect(await escrow.totalWithdrawable()).to.equal(stake * 2n);
    await expect(() => escrow.connect(plaintiff).withdraw()).to.changeEtherBalance(plaintiff, stake * 2n);
    expect(await escrow.totalWithdrawable()).to.equal(0);
  });

  it("a rejecting receiver cannot block verdict completion", async function () {
    const { escrow, platform, defendant } = await deployFixture();
    const Rejecting = await ethers.getContractFactory("RejectingParty");
    const rejecting = await Rejecting.deploy();
    await rejecting.create(await escrow.getAddress(), defendant.address, { value: stake });
    await escrow.connect(defendant).joinDispute(0, { value: stake });
    await rejecting.withdrawFrom(await escrow.getAddress()).catch(() => {});
    await network.provider.send("hardhat_setBalance", [await rejecting.getAddress(), "0xDE0B6B3A7640000"]);
    await network.provider.send("hardhat_impersonateAccount", [await rejecting.getAddress()]);
    const signer = await ethers.getSigner(await rejecting.getAddress());
    await escrow.connect(signer).submitEvidence(0, "https://example.com/plaintiff");
    await escrow.connect(defendant).submitEvidence(0, "https://example.com/defendant");
    const budget = await escrow.minimumAgentBudget();
    await escrow.connect(defendant).requestArbitration(0, { value: budget });
    await reachJudge({ platform });
    await platform.fulfillString(5, "GAVEL_V1|plaintiff|99|Contract party wins");
    expect((await escrow.getDispute(0)).state).to.equal(5);
    expect(await escrow.withdrawable(await rejecting.getAddress())).to.equal(stake * 2n);
  });
});

function emptyRequest() {
  return {
    id: 0,
    requester: ethers.ZeroAddress,
    callbackAddress: ethers.ZeroAddress,
    callbackSelector: "0x00000000",
    subcommittee: [],
    responses: [],
    responseCount: 0,
    failureCount: 0,
    threshold: 0,
    createdAt: 0,
    deadline: 0,
    status: 0,
    consensusType: 0,
    remainingBudget: 0,
    perAgentBudget: 0
  };
}
