const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("DisputeEscrow", function () {
  const parseAgentId = 101;
  const judgeAgentId = 202;

  async function deployFixture() {
    const [plaintiff, defendant, stranger] = await ethers.getSigners();
    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();
    const DisputeEscrow = await ethers.getContractFactory("DisputeEscrow");
    const escrow = await DisputeEscrow.deploy(await platform.getAddress(), parseAgentId, judgeAgentId);
    return { escrow, platform, plaintiff, defendant, stranger };
  }

  async function fundedEvidenceReady() {
    const fixture = await deployFixture();
    const { escrow, plaintiff, defendant } = fixture;
    const stake = ethers.parseEther("1");
    await escrow.connect(plaintiff).createDispute(defendant.address, "Logo delivery dispute", { value: stake });
    await escrow.connect(defendant).joinDispute(0, { value: stake });
    await escrow.connect(plaintiff).submitEvidence(0, "https://example.com/plaintiff");
    await escrow.connect(defendant).submitEvidence(0, "https://example.com/defendant");
    return fixture;
  }

  async function startArbitration() {
    const fixture = await fundedEvidenceReady();
    const { escrow } = fixture;
    await escrow.requestArbitration(0, { value: ethers.parseEther("0.90") });
    return fixture;
  }

  it("creates, joins, and marks evidence ready", async function () {
    const { escrow, plaintiff, defendant } = await deployFixture();
    const stake = ethers.parseEther("1");

    await expect(escrow.connect(plaintiff).createDispute(defendant.address, "Milestone delivery", { value: stake }))
      .to.emit(escrow, "DisputeCreated")
      .withArgs(0, plaintiff.address, defendant.address, stake);

    await escrow.connect(defendant).joinDispute(0, { value: stake });
    await escrow.connect(plaintiff).submitEvidence(0, "https://example.com/a");
    await escrow.connect(defendant).submitEvidence(0, "https://example.com/b");

    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(2);
  });

  it("rejects non-party evidence and early arbitration", async function () {
    const { escrow, plaintiff, defendant, stranger } = await deployFixture();
    const stake = ethers.parseEther("1");

    await escrow.connect(plaintiff).createDispute(defendant.address, "Audit milestone", { value: stake });
    await expect(escrow.requestArbitration(0, { value: ethers.parseEther("0.90") })).to.be.revertedWith("Evidence not ready");
    await escrow.connect(defendant).joinDispute(0, { value: stake });
    await expect(escrow.connect(stranger).submitEvidence(0, "https://example.com/nope")).to.be.revertedWith("Only parties");
  });

  it("maps request ids through the three-call agent pipeline", async function () {
    const { escrow, platform } = await startArbitration();

    expect((await escrow.pendingRequests(1)).stage).to.equal(1);
    await platform.fulfillString(1, '{"claims":["delivery proof"],"sourceCredibility":95}');
    expect((await escrow.pendingRequests(2)).stage).to.equal(2);
    await platform.fulfillString(2, '{"claims":["scope dispute"],"sourceCredibility":80}');
    expect((await escrow.pendingRequests(3)).stage).to.equal(3);
  });

  it("fully releases escrow for confidence above 90", async function () {
    const { escrow, platform, plaintiff, defendant } = await startArbitration();

    await platform.fulfillString(1, '{"claims":["delivered"],"sourceCredibility":95}');
    await platform.fulfillString(2, '{"claims":["accepted late"],"sourceCredibility":77}');

    await expect(() =>
      platform.fulfillString(3, '{"winner":"plaintiff","confidence":94,"reasoning":"Delivery evidence satisfies the milestone."}')
    ).to.changeEtherBalances([plaintiff, defendant], [ethers.parseEther("2"), 0]);

    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(5);
    expect(dispute.winner).to.equal(plaintiff.address);
    expect(dispute.confidence).to.equal(94);
  });

  it("opens appeal window for medium confidence", async function () {
    const { escrow, platform, plaintiff } = await startArbitration();

    await platform.fulfillString(1, "plaintiff summary");
    await platform.fulfillString(2, "defendant summary");

    await expect(() =>
      platform.fulfillString(3, '{"winner":"plaintiff","confidence":72,"reasoning":"Delivery mostly matches scope."}')
    ).to.changeEtherBalance(plaintiff, ethers.parseEther("1.6"));

    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(4);
    expect(dispute.heldAmount).to.equal(ethers.parseEther("0.4"));
  });

  it("escalates to DAO below 60 confidence", async function () {
    const { escrow, platform } = await startArbitration();

    await platform.fulfillString(1, "plaintiff summary");
    await platform.fulfillString(2, "defendant summary");

    await expect(platform.fulfillString(3, '{"winner":"plaintiff","confidence":41,"reasoning":"Evidence is too conflicted."}'))
      .to.emit(escrow, "EscalatedToDAO")
      .withArgs(0, 41);

    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(6);
    expect(dispute.heldAmount).to.equal(ethers.parseEther("2"));
  });

  it("handles split verdicts", async function () {
    const { escrow, platform, plaintiff, defendant } = await startArbitration();

    await platform.fulfillString(1, "plaintiff summary");
    await platform.fulfillString(2, "defendant summary");

    await expect(() =>
      platform.fulfillString(3, '{"winner":"split","confidence":91,"reasoning":"Both sides proved equal performance."}')
    ).to.changeEtherBalances([plaintiff, defendant], [ethers.parseEther("1"), ethers.parseEther("1")]);

    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(5);
    expect(dispute.winner).to.equal(ethers.ZeroAddress);
  });

  it("marks failed and timed out agent responses", async function () {
    const { escrow, platform } = await startArbitration();

    await expect(platform.fail(1, 3)).to.emit(escrow, "AgentRequestFailed").withArgs(0, 1, 1, 3);
    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(8);
  });

  it("rejects unauthorized callbacks", async function () {
    const { escrow } = await startArbitration();
    await expect(escrow.handleResponse(1, [], 3, emptyRequest())).to.be.revertedWith("Only platform");
  });

  it("refunds deposits after expiry", async function () {
    const { escrow, plaintiff, defendant } = await deployFixture();
    const stake = ethers.parseEther("1");
    await escrow.connect(plaintiff).createDispute(defendant.address, "Expired case", { value: stake });

    await network.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await network.provider.send("evm_mine");

    await expect(() => escrow.claimExpiry(0)).to.changeEtherBalance(plaintiff, stake);
    const dispute = await escrow.getDispute(0);
    expect(dispute.state).to.equal(7);
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
