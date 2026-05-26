export const DISPUTE_ESCROW_ABI = [
  "function disputeCount() view returns (uint256)",
  "function createDispute(address defendant,string description) payable returns (uint256)",
  "function joinDispute(uint256 id) payable",
  "function submitEvidence(uint256 id,string evidenceUrl)",
  "function requestArbitration(uint256 id) payable returns (uint256)",
  "function finalizeAppeal(uint256 id)",
  "function claimExpiry(uint256 id)",
  "function getDispute(uint256 id) view returns (tuple(address plaintiff,address defendant,uint256 plaintiffDeposit,uint256 defendantDeposit,uint256 heldAmount,uint256 agentBudget,uint256 appealDeadline,uint256 createdAt,uint8 state,address winner,uint8 confidence,string description,string plaintiffEvidenceUrl,string defendantEvidenceUrl,string plaintiffSummary,string defendantSummary,string verdictJson,string verdictReasoning,uint256 latestRequestId))",
  "event DisputeCreated(uint256 indexed id,address indexed plaintiff,address indexed defendant,uint256 amount)",
  "event EvidenceSubmitted(uint256 indexed id,address indexed by,string url)",
  "event AgentRequestCreated(uint256 indexed id,uint256 indexed requestId,uint8 stage)",
  "event AgentStep(uint256 indexed id,uint8 indexed stage,string step,string data)",
  "event VerdictDelivered(uint256 indexed id,address indexed winner,uint8 confidence,string reasoning,string verdictJson)",
  "event EscalatedToDAO(uint256 indexed id,uint8 confidence)",
  "event AgentRequestFailed(uint256 indexed id,uint256 indexed requestId,uint8 stage,uint8 status)"
];
