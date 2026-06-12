// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRequester, IAgentRequesterHandler, Request, Response, ResponseStatus} from "./interfaces/IAgentRequester.sol";

/**
 * @title DisputeEscrowV2
 * @author Nikhil Raikwar
 * @notice Gavel - autonomous dispute resolution powered by Somnia Agents.
 *
 * Unlike human-juror protocols such as Kleros, Gavel uses Somnia
 * validator-executed agents to run a five-stage pipeline:
 * research -> research -> validate -> challenge -> judge.
 *
 * Consensus callbacks advance the escrow state without a project-operated
 * arbiter or keeper. Validator execution records are exposed by Somnia's
 * receipt service; the consensus result and escrow credits are recorded
 * onchain.
 */
interface IParseWebsiteAgentV2 {
    function ExtractString(
        string memory key,
        string memory description,
        string[] calldata options,
        string memory prompt,
        string memory url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
    ) external returns (string memory);
}

interface ILLMAgentV2 {
    function inferString(
        string memory prompt,
        string memory system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory);
}

contract DisputeEscrowV2 is IAgentRequesterHandler {
    enum DisputeState {
        Open,
        EvidencePending,
        EvidenceReady,
        Arbitrating,
        AgentFailed,
        Resolved,
        Expired,
        Recovered
    }

    enum RequestStage {
        None,
        PlaintiffResearch,
        DefendantResearch,
        Validator,
        Skeptic,
        Judge
    }

    struct Dispute {
        address plaintiff;
        address defendant;
        address arbitrationFunder;
        uint256 plaintiffDeposit;
        uint256 defendantDeposit;
        uint256 agentBudget;
        uint256 createdAt;
        uint256 failedAt;
        DisputeState state;
        RequestStage currentStage;
        RequestStage failedStage;
        address winner;
        uint8 confidence;
        string description;
        string plaintiffEvidenceUrl;
        string defendantEvidenceUrl;
        string plaintiffSummary;
        string defendantSummary;
        string validationSummary;
        string skepticSummary;
        string verdictReasoning;
    }

    struct PendingRequest {
        uint256 disputeId;
        RequestStage stage;
        bool valid;
    }

    IAgentRequester public immutable platform;
    uint256 public immutable parseWebsiteAgentId;
    uint256 public immutable inferenceAgentId;
    uint256 public disputeCount;
    uint256 public totalWithdrawable;
    uint256 public unallocatedPlatformRebates;

    uint256 public constant EXPIRY = 7 days;
    uint256 public constant FAILURE_RECOVERY_DELAY = 1 days;
    uint256 public constant STAGE_TIMEOUT = 15 minutes;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant LLM_PARSE_WEBSITE_COST_PER_AGENT = 0.10 ether;
    uint256 public constant LLM_INFERENCE_COST_PER_AGENT = 0.07 ether;
    uint256 public constant MAX_DESCRIPTION_BYTES = 512;
    uint256 public constant MAX_EVIDENCE_URL_BYTES = 512;
    uint256 public constant MAX_AGENT_OUTPUT_BYTES = 4096;
    uint256 public constant MAX_REASONING_BYTES = 512;

    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => PendingRequest) public pendingRequests;
    mapping(uint256 => uint256[5]) private stageRequestIds;
    mapping(uint256 => uint256) public stageRequestedAt;
    mapping(address => uint256[]) private partyCaseIds;
    mapping(address => uint256) public withdrawable;
    bool private locked;

    event DisputeCreated(uint256 indexed id, address indexed plaintiff, address indexed defendant, uint256 amount);
    event DisputeJoined(uint256 indexed id, address indexed defendant, uint256 amount);
    event EvidenceSubmitted(uint256 indexed id, address indexed by, string url);
    event ArbitrationStarted(uint256 indexed id, address indexed funder, uint256 budget);
    event AgentRequestCreated(uint256 indexed id, uint256 indexed requestId, RequestStage stage, uint256 budget);
    event AgentStepCompleted(uint256 indexed id, uint256 indexed requestId, RequestStage stage, string output);
    event AgentRequestFailed(uint256 indexed id, uint256 indexed requestId, RequestStage stage, ResponseStatus status, string reason);
    event AgentStageRetried(uint256 indexed id, RequestStage stage, address indexed funder, uint256 addedBudget);
    event VerdictDelivered(uint256 indexed id, address indexed winner, uint8 confidence, string reasoning);
    event FundsCredited(uint256 indexed id, address indexed account, uint256 amount, string reason);
    event DisputeExpired(uint256 indexed id);
    event DisputeRecovered(uint256 indexed id);
    event Withdrawal(address indexed account, uint256 amount);
    event PlatformRebateReceived(uint256 amount);

    modifier noReentry() {
        require(!locked, "Reentry");
        locked = true;
        _;
        locked = false;
    }

    constructor(address platform_, uint256 parseWebsiteAgentId_, uint256 inferenceAgentId_) {
        require(platform_ != address(0), "Invalid platform");
        require(parseWebsiteAgentId_ != 0 && inferenceAgentId_ != 0, "Invalid agent");
        platform = IAgentRequester(platform_);
        parseWebsiteAgentId = parseWebsiteAgentId_;
        inferenceAgentId = inferenceAgentId_;
    }

    /// @notice Returns the source contract version for UI and deployment identification.
    function version() external pure returns (string memory) {
        return "2.1.0";
    }

    function createDispute(address defendant, string calldata description) external payable returns (uint256 id) {
        require(msg.value > 0, "Stake required");
        require(defendant != address(0) && defendant != msg.sender, "Invalid defendant");
        _requireLength(bytes(description).length, 1, MAX_DESCRIPTION_BYTES, "Invalid description");

        id = disputeCount++;
        Dispute storage d = disputes[id];
        d.plaintiff = msg.sender;
        d.defendant = defendant;
        d.plaintiffDeposit = msg.value;
        d.createdAt = block.timestamp;
        d.state = DisputeState.Open;
        d.description = description;
        partyCaseIds[msg.sender].push(id);
        partyCaseIds[defendant].push(id);
        emit DisputeCreated(id, msg.sender, defendant, msg.value);
    }

    function joinDispute(uint256 id) external payable {
        Dispute storage d = _dispute(id);
        require(d.state == DisputeState.Open, "Not open");
        require(msg.sender == d.defendant, "Only defendant");
        require(msg.value == d.plaintiffDeposit, "Stake mismatch");
        d.defendantDeposit = msg.value;
        d.state = DisputeState.EvidencePending;
        emit DisputeJoined(id, msg.sender, msg.value);
    }

    function submitEvidence(uint256 id, string calldata evidenceUrl) external {
        Dispute storage d = _dispute(id);
        require(d.state == DisputeState.EvidencePending || d.state == DisputeState.EvidenceReady, "Evidence frozen");
        _requireLength(bytes(evidenceUrl).length, 1, MAX_EVIDENCE_URL_BYTES, "Invalid evidence URL");
        require(_isHttpUrl(evidenceUrl), "URL must use http(s)");

        if (msg.sender == d.plaintiff) d.plaintiffEvidenceUrl = evidenceUrl;
        else if (msg.sender == d.defendant) d.defendantEvidenceUrl = evidenceUrl;
        else revert("Only parties");

        if (bytes(d.plaintiffEvidenceUrl).length > 0 && bytes(d.defendantEvidenceUrl).length > 0) {
            d.state = DisputeState.EvidenceReady;
        }
        emit EvidenceSubmitted(id, msg.sender, evidenceUrl);
    }

    function requestArbitration(uint256 id) external payable returns (uint256 requestId) {
        Dispute storage d = _dispute(id);
        require(d.state == DisputeState.EvidenceReady, "Evidence not ready");
        require(msg.sender == d.plaintiff || msg.sender == d.defendant, "Only parties");
        require(msg.value >= minimumAgentBudget(), "Insufficient agent budget");
        d.state = DisputeState.Arbitrating;
        d.arbitrationFunder = msg.sender;
        d.agentBudget = msg.value;
        emit ArbitrationStarted(id, msg.sender, msg.value);
        requestId = _requestStage(id, RequestStage.PlaintiffResearch);
    }

    function retryFailedStage(uint256 id) external payable returns (uint256 requestId) {
        Dispute storage d = _dispute(id);
        require(d.state == DisputeState.AgentFailed, "No failed stage");
        require(msg.sender == d.plaintiff || msg.sender == d.defendant, "Only parties");
        uint256 required = requiredBudget(d.failedStage);
        require(d.agentBudget + msg.value >= required, "Insufficient retry budget");
        d.agentBudget += msg.value;
        d.state = DisputeState.Arbitrating;
        d.failedAt = 0;
        RequestStage stage = d.failedStage;
        d.failedStage = RequestStage.None;
        emit AgentStageRetried(id, stage, msg.sender, msg.value);
        requestId = _requestStage(id, stage);
    }

    function recoverFailedDispute(uint256 id) external {
        Dispute storage d = _dispute(id);
        require(d.state == DisputeState.AgentFailed, "Not recoverable");
        require(msg.sender == d.plaintiff || msg.sender == d.defendant, "Only parties");
        require(block.timestamp >= d.failedAt + FAILURE_RECOVERY_DELAY, "Recovery delay");
        d.state = DisputeState.Recovered;
        _creditAllRemaining(id, d, "Agent failure recovery");
        emit DisputeRecovered(id);
    }

    /// @notice Permissionless fallback when the platform never delivers a timeout callback.
    function markCurrentStageTimedOut(uint256 id) external {
        Dispute storage d = _dispute(id);
        require(d.state == DisputeState.Arbitrating, "Not arbitrating");
        require(stageRequestedAt[id] != 0 && block.timestamp >= stageRequestedAt[id] + STAGE_TIMEOUT, "Stage still active");
        uint256 requestId = stageRequestIds[id][uint8(d.currentStage) - 1];
        require(pendingRequests[requestId].valid, "No pending request");
        delete pendingRequests[requestId];
        _failStage(id, requestId, d.currentStage, ResponseStatus.TimedOut, "Stage timeout fallback");
    }

    function claimExpiry(uint256 id) external {
        Dispute storage d = _dispute(id);
        require(block.timestamp >= d.createdAt + EXPIRY, "Not expired");
        require(
            d.state == DisputeState.Open || d.state == DisputeState.EvidencePending || d.state == DisputeState.EvidenceReady,
            "State cannot expire"
        );
        d.state = DisputeState.Expired;
        _creditAllRemaining(id, d, "Dispute expired");
        emit DisputeExpired(id);
    }

    function withdraw() external noReentry {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawal(msg.sender, amount);
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external override {
        require(msg.sender == address(platform), "Only platform");
        PendingRequest memory pending = pendingRequests[requestId];
        require(pending.valid, "Unknown request");
        delete pendingRequests[requestId];

        Dispute storage d = disputes[pending.disputeId];
        require(d.state == DisputeState.Arbitrating && d.currentStage == pending.stage, "Unexpected callback");
        stageRequestedAt[pending.disputeId] = 0;
        if (status != ResponseStatus.Success || responses.length == 0 || responses[0].status != ResponseStatus.Success) {
            _failStage(pending.disputeId, requestId, pending.stage, status, "Agent request failed");
            return;
        }

        string memory output = abi.decode(responses[0].result, (string));
        if (bytes(output).length == 0 || bytes(output).length > MAX_AGENT_OUTPUT_BYTES) {
            _failStage(pending.disputeId, requestId, pending.stage, status, "Invalid agent output length");
            return;
        }

        if (pending.stage == RequestStage.PlaintiffResearch) d.plaintiffSummary = output;
        else if (pending.stage == RequestStage.DefendantResearch) d.defendantSummary = output;
        else if (pending.stage == RequestStage.Validator) d.validationSummary = output;
        else if (pending.stage == RequestStage.Skeptic) d.skepticSummary = output;
        else if (pending.stage == RequestStage.Judge) {
            (bool valid, address winner, uint8 confidence, string memory reasoning) = _parseVerdict(d, output);
            if (!valid) {
                _failStage(pending.disputeId, requestId, pending.stage, status, "Malformed GAVEL_V1 verdict");
                return;
            }
            emit AgentStepCompleted(pending.disputeId, requestId, pending.stage, output);
            _resolve(pending.disputeId, d, winner, confidence, reasoning);
            return;
        } else revert("Invalid stage");

        emit AgentStepCompleted(pending.disputeId, requestId, pending.stage, output);
        _requestStage(pending.disputeId, RequestStage(uint8(pending.stage) + 1));
    }

    function getDispute(uint256 id) external view returns (Dispute memory) {
        require(id < disputeCount, "Unknown dispute");
        return disputes[id];
    }

    function getStageRequestIds(uint256 id) external view returns (uint256[5] memory) {
        require(id < disputeCount, "Unknown dispute");
        return stageRequestIds[id];
    }

    function getPartyCaseIds(address party) external view returns (uint256[] memory) {
        return partyCaseIds[party];
    }

    function minimumAgentBudget() public view returns (uint256) {
        return (requiredBudget(RequestStage.PlaintiffResearch) * 2) + (requiredBudget(RequestStage.Validator) * 3);
    }

    function requiredBudget(RequestStage stage) public view returns (uint256) {
        require(stage != RequestStage.None, "Invalid stage");
        uint256 price = stage == RequestStage.PlaintiffResearch || stage == RequestStage.DefendantResearch
            ? LLM_PARSE_WEBSITE_COST_PER_AGENT
            : LLM_INFERENCE_COST_PER_AGENT;
        return platform.getRequestDeposit() + (price * SUBCOMMITTEE_SIZE);
    }

    function _requestStage(uint256 id, RequestStage stage) internal returns (uint256 requestId) {
        Dispute storage d = disputes[id];
        uint256 budget = requiredBudget(stage);
        require(d.agentBudget >= budget, "Agent budget exhausted");
        d.agentBudget -= budget;
        d.currentStage = stage;
        stageRequestedAt[id] = block.timestamp;

        bytes memory payload = stage == RequestStage.PlaintiffResearch
            ? _parsePayload(d.plaintiffEvidenceUrl, _researchPrompt("plaintiff"))
            : stage == RequestStage.DefendantResearch
                ? _parsePayload(d.defendantEvidenceUrl, _researchPrompt("defendant"))
                : _inferencePayload(_stagePrompt(d, stage), _systemPrompt(stage));

        uint256 agentId = stage == RequestStage.PlaintiffResearch || stage == RequestStage.DefendantResearch
            ? parseWebsiteAgentId
            : inferenceAgentId;
        requestId = platform.createRequest{value: budget}(agentId, address(this), this.handleResponse.selector, payload);
        pendingRequests[requestId] = PendingRequest(id, stage, true);
        stageRequestIds[id][uint8(stage) - 1] = requestId;
        emit AgentRequestCreated(id, requestId, stage, budget);
    }

    function _parsePayload(string memory url, string memory prompt) internal pure returns (bytes memory) {
        string[] memory options = new string[](0);
        return abi.encodeWithSelector(
            IParseWebsiteAgentV2.ExtractString.selector,
            "claims",
            "Factual claims, timestamps, and source support relevant to the dispute",
            options,
            prompt,
            url,
            false,
            1,
            70
        );
    }

    function _inferencePayload(string memory prompt, string memory system) internal pure returns (bytes memory) {
        string[] memory allowedValues = new string[](0);
        return abi.encodeWithSelector(ILLMAgentV2.inferString.selector, prompt, system, false, allowedValues);
    }

    function _stagePrompt(Dispute storage d, RequestStage stage) internal view returns (string memory) {
        string memory record = string.concat(
            "DISPUTE: ", d.description,
            "\nPLAINTIFF RESEARCH: ", d.plaintiffSummary,
            "\nDEFENDANT RESEARCH: ", d.defendantSummary
        );
        if (stage == RequestStage.Validator) {
            return string.concat(record, "\nCheck source support, contradictions, accessibility, and timestamps. Return a concise neutral validation report.");
        }
        if (stage == RequestStage.Skeptic) {
            return string.concat(record, "\nVALIDATOR REPORT: ", d.validationSummary, "\nChallenge unsupported claims from both sides. Return a concise cross-examination report.");
        }
        return string.concat(
            record,
            "\nVALIDATOR REPORT: ", d.validationSummary,
            "\nSKEPTIC REPORT: ", d.skepticSummary,
            "\nReturn exactly: GAVEL_V1|plaintiff or defendant or split|confidence integer 0-100|reasoning under 512 bytes"
        );
    }

    function _researchPrompt(string memory side) internal pure returns (string memory) {
        return string.concat(
            "Act as the neutral ", side,
            " evidence researcher. Extract only factual claims, timestamps, and direct source support. Explicitly report inaccessible or unsupported content."
        );
    }

    function _systemPrompt(RequestStage stage) internal pure returns (string memory) {
        if (stage == RequestStage.Validator) return "You are Gavel's neutral evidence validator. Do not decide the winner.";
        if (stage == RequestStage.Skeptic) return "You are Gavel's adversarial skeptic. Challenge both sides equally. Do not decide the winner.";
        return "You are Gavel's final impartial judge. Follow the exact GAVEL_V1 output format.";
    }

    function _parseVerdict(Dispute storage d, string memory output)
        internal
        view
        returns (bool valid, address winner, uint8 confidence, string memory reasoning)
    {
        bytes memory b = bytes(output);
        bytes memory prefix = bytes("GAVEL_V1|");
        if (b.length <= prefix.length || b.length > MAX_AGENT_OUTPUT_BYTES) return (false, address(0), 0, "");
        for (uint256 i; i < prefix.length; i++) if (b[i] != prefix[i]) return (false, address(0), 0, "");

        (uint256 first, uint256 second, bool separatorsValid) = _findSeparators(b, prefix.length);
        if (!separatorsValid) return (false, address(0), 0, "");
        bytes memory winnerText = _slice(b, prefix.length, first);
        bytes memory confidenceText = _slice(b, first + 1, second);
        bytes memory reasoningBytes = _slice(b, second + 1, b.length);
        if (reasoningBytes.length == 0 || reasoningBytes.length > MAX_REASONING_BYTES) return (false, address(0), 0, "");

        if (_equal(winnerText, bytes("plaintiff"))) winner = d.plaintiff;
        else if (_equal(winnerText, bytes("defendant"))) winner = d.defendant;
        else if (!_equal(winnerText, bytes("split"))) return (false, address(0), 0, "");

        (bool confidenceValid, uint256 parsedConfidence) = _parseUint(confidenceText);
        if (!confidenceValid || parsedConfidence > 100) return (false, address(0), 0, "");
        return (true, winner, uint8(parsedConfidence), string(reasoningBytes));
    }

    function _resolve(uint256 id, Dispute storage d, address winner, uint8 confidence, string memory reasoning) internal {
        uint256 escrow = d.plaintiffDeposit + d.defendantDeposit;
        d.plaintiffDeposit = 0;
        d.defendantDeposit = 0;
        d.state = DisputeState.Resolved;
        d.currentStage = RequestStage.None;
        stageRequestedAt[id] = 0;
        d.winner = winner;
        d.confidence = confidence;
        d.verdictReasoning = reasoning;

        if (winner == address(0)) {
            _credit(id, d.plaintiff, escrow / 2, "Split verdict");
            _credit(id, d.defendant, escrow - (escrow / 2), "Split verdict");
        } else {
            _credit(id, winner, escrow, "Winning verdict");
        }
        _refundAgentBudget(id, d, "Unused agent budget");
        emit VerdictDelivered(id, winner, confidence, reasoning);
    }

    function _failStage(uint256 id, uint256 requestId, RequestStage stage, ResponseStatus status, string memory reason) internal {
        Dispute storage d = disputes[id];
        stageRequestedAt[id] = 0;
        d.state = DisputeState.AgentFailed;
        d.failedStage = stage;
        d.failedAt = block.timestamp;
        emit AgentRequestFailed(id, requestId, stage, status, reason);
    }

    function _creditAllRemaining(uint256 id, Dispute storage d, string memory reason) internal {
        uint256 plaintiffAmount = d.plaintiffDeposit;
        uint256 defendantAmount = d.defendantDeposit;
        d.plaintiffDeposit = 0;
        d.defendantDeposit = 0;
        _credit(id, d.plaintiff, plaintiffAmount, reason);
        _credit(id, d.defendant, defendantAmount, reason);
        _refundAgentBudget(id, d, reason);
    }

    function _refundAgentBudget(uint256 id, Dispute storage d, string memory reason) internal {
        uint256 amount = d.agentBudget;
        d.agentBudget = 0;
        _credit(id, d.arbitrationFunder, amount, reason);
    }

    function _credit(uint256 id, address account, uint256 amount, string memory reason) internal {
        if (account == address(0) || amount == 0) return;
        withdrawable[account] += amount;
        totalWithdrawable += amount;
        emit FundsCredited(id, account, amount, reason);
    }

    function _dispute(uint256 id) internal view returns (Dispute storage d) {
        require(id < disputeCount, "Unknown dispute");
        return disputes[id];
    }

    function _requireLength(uint256 length, uint256 min, uint256 max, string memory reason) internal pure {
        require(length >= min && length <= max, reason);
    }

    function _isHttpUrl(string memory value) internal pure returns (bool) {
        bytes memory b = bytes(value);
        return (b.length >= 7 && b[0] == "h" && b[1] == "t" && b[2] == "t" && b[3] == "p" && b[4] == ":")
            || (b.length >= 8 && b[0] == "h" && b[1] == "t" && b[2] == "t" && b[3] == "p" && b[4] == "s" && b[5] == ":");
    }

    function _findSeparators(bytes memory b, uint256 start) internal pure returns (uint256 first, uint256 second, bool valid) {
        for (uint256 i = start; i < b.length; i++) {
            if (b[i] != "|") continue;
            if (first == 0) first = i;
            else if (second == 0) second = i;
            else return (0, 0, false);
        }
        valid = first > start && second > first + 1 && second + 1 < b.length;
    }

    function _slice(bytes memory b, uint256 start, uint256 end) internal pure returns (bytes memory out) {
        out = new bytes(end - start);
        for (uint256 i; i < out.length; i++) out[i] = b[start + i];
    }

    function _equal(bytes memory a, bytes memory b) internal pure returns (bool) {
        if (a.length != b.length) return false;
        for (uint256 i; i < a.length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    function _parseUint(bytes memory b) internal pure returns (bool valid, uint256 value) {
        if (b.length == 0) return (false, 0);
        for (uint256 i; i < b.length; i++) {
            uint8 digit = uint8(b[i]);
            if (digit < 48 || digit > 57) return (false, 0);
            value = (value * 10) + digit - 48;
        }
        return (true, value);
    }

    receive() external payable {
        if (msg.sender == address(platform)) {
            unallocatedPlatformRebates += msg.value;
            emit PlatformRebateReceived(msg.value);
        }
    }
}
