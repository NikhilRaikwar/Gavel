// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRequester, IAgentRequesterHandler, Request, Response, ResponseStatus} from "./interfaces/IAgentRequester.sol";

interface IParseWebsiteAgent {
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

interface ILLMAgent {
    function inferString(
        string memory prompt,
        string memory system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory);
}

contract DisputeEscrow is IAgentRequesterHandler {
    enum DisputeState {
        Open,
        EvidencePending,
        EvidenceReady,
        Arbitrating,
        AppealWindow,
        Resolved,
        EscalatedToDAO,
        Expired,
        AgentFailed
    }

    enum RequestStage {
        None,
        PlaintiffParse,
        DefendantParse,
        Judge
    }

    struct Dispute {
        address plaintiff;
        address defendant;
        uint256 plaintiffDeposit;
        uint256 defendantDeposit;
        uint256 heldAmount;
        uint256 agentBudget;
        uint256 appealDeadline;
        uint256 createdAt;
        DisputeState state;
        address winner;
        uint8 confidence;
        string description;
        string plaintiffEvidenceUrl;
        string defendantEvidenceUrl;
        string plaintiffSummary;
        string defendantSummary;
        string verdictJson;
        string verdictReasoning;
        uint256 latestRequestId;
    }

    struct PendingRequest {
        uint256 disputeId;
        RequestStage stage;
        bool valid;
    }

    IAgentRequester public immutable platform;
    uint256 public immutable parseWebsiteAgentId;
    uint256 public immutable judgeInferenceAgentId;
    uint256 public disputeCount;

    uint256 public constant EXPIRY = 7 days;
    uint256 public constant APPEAL_WINDOW = 7 days;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant LLM_PARSE_WEBSITE_COST_PER_AGENT = 0.10 ether;
    uint256 public constant LLM_INFERENCE_COST_PER_AGENT = 0.07 ether;

    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => PendingRequest) public pendingRequests;
    bool private locked;

    event DisputeCreated(uint256 indexed id, address indexed plaintiff, address indexed defendant, uint256 amount);
    event EvidenceSubmitted(uint256 indexed id, address indexed by, string url);
    event AgentRequestCreated(uint256 indexed id, uint256 indexed requestId, RequestStage stage);
    event AgentStep(uint256 indexed id, RequestStage indexed stage, string step, string data);
    event VerdictDelivered(uint256 indexed id, address indexed winner, uint8 confidence, string reasoning, string verdictJson);
    event EscalatedToDAO(uint256 indexed id, uint8 confidence);
    event AgentRequestFailed(uint256 indexed id, uint256 indexed requestId, RequestStage stage, ResponseStatus status);
    event AppealFinalized(uint256 indexed id, address indexed winner, uint256 released);
    event DisputeExpired(uint256 indexed id);

    modifier noReentry() {
        require(!locked, "Reentry");
        locked = true;
        _;
        locked = false;
    }

    constructor(address platform_, uint256 parseWebsiteAgentId_, uint256 judgeInferenceAgentId_) {
        require(platform_ != address(0), "Invalid platform");
        require(parseWebsiteAgentId_ != 0, "Invalid parse agent");
        require(judgeInferenceAgentId_ != 0, "Invalid judge agent");
        platform = IAgentRequester(platform_);
        parseWebsiteAgentId = parseWebsiteAgentId_;
        judgeInferenceAgentId = judgeInferenceAgentId_;
    }

    function createDispute(address defendant, string calldata description) external payable returns (uint256 id) {
        require(msg.value > 0, "Stake required");
        require(defendant != address(0) && defendant != msg.sender, "Invalid defendant");
        require(bytes(description).length > 0, "Description required");

        id = disputeCount++;
        Dispute storage d = disputes[id];
        d.plaintiff = msg.sender;
        d.defendant = defendant;
        d.plaintiffDeposit = msg.value;
        d.createdAt = block.timestamp;
        d.state = DisputeState.Open;
        d.description = description;

        emit DisputeCreated(id, msg.sender, defendant, msg.value);
    }

    function joinDispute(uint256 id) external payable {
        Dispute storage d = disputes[id];
        require(d.state == DisputeState.Open, "Not open");
        require(msg.sender == d.defendant, "Only defendant");
        require(msg.value == d.plaintiffDeposit, "Stake mismatch");

        d.defendantDeposit = msg.value;
        d.state = DisputeState.EvidencePending;
    }

    function submitEvidence(uint256 id, string calldata evidenceUrl) external {
        Dispute storage d = disputes[id];
        require(d.state == DisputeState.EvidencePending || d.state == DisputeState.EvidenceReady, "Wrong state");
        require(bytes(evidenceUrl).length > 0, "Evidence required");

        if (msg.sender == d.plaintiff) {
            d.plaintiffEvidenceUrl = evidenceUrl;
        } else if (msg.sender == d.defendant) {
            d.defendantEvidenceUrl = evidenceUrl;
        } else {
            revert("Only parties");
        }

        if (bytes(d.plaintiffEvidenceUrl).length > 0 && bytes(d.defendantEvidenceUrl).length > 0) {
            d.state = DisputeState.EvidenceReady;
        }

        emit EvidenceSubmitted(id, msg.sender, evidenceUrl);
    }

    function requestArbitration(uint256 id) external payable returns (uint256 requestId) {
        Dispute storage d = disputes[id];
        require(d.state == DisputeState.EvidenceReady, "Evidence not ready");
        require(bytes(d.plaintiffEvidenceUrl).length > 0 && bytes(d.defendantEvidenceUrl).length > 0, "Missing evidence");
        require(msg.value >= _minimumAgentBudget(), "Insufficient agent budget");

        d.state = DisputeState.Arbitrating;
        d.agentBudget = msg.value;
        requestId = _requestPlaintiffParse(id, 0);
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external override noReentry {
        require(msg.sender == address(platform), "Only platform");

        PendingRequest memory pending = pendingRequests[requestId];
        require(pending.valid, "Unknown request");
        delete pendingRequests[requestId];

        Dispute storage d = disputes[pending.disputeId];
        require(d.state == DisputeState.Arbitrating, "Wrong state");

        if (status != ResponseStatus.Success || responses.length == 0) {
            d.state = DisputeState.AgentFailed;
            emit AgentRequestFailed(pending.disputeId, requestId, pending.stage, status);
            return;
        }

        string memory output = abi.decode(responses[0].result, (string));

        if (pending.stage == RequestStage.PlaintiffParse) {
            d.plaintiffSummary = output;
            emit AgentStep(pending.disputeId, pending.stage, "Parsed plaintiff evidence URL", output);
            _requestDefendantParse(pending.disputeId, 0);
            return;
        }

        if (pending.stage == RequestStage.DefendantParse) {
            d.defendantSummary = output;
            emit AgentStep(pending.disputeId, pending.stage, "Parsed defendant evidence URL", output);
            _requestJudge(pending.disputeId, 0);
            return;
        }

        if (pending.stage == RequestStage.Judge) {
            d.verdictJson = output;
            address winner = _parseWinner(output, d.plaintiff, d.defendant);
            uint8 confidence = _parseConfidence(output);
            string memory reasoning = _parseReasoning(output);
            _executeVerdict(pending.disputeId, confidence, winner, reasoning, output);
            return;
        }

        revert("Invalid stage");
    }

    function finalizeAppeal(uint256 id) external noReentry {
        Dispute storage d = disputes[id];
        require(d.state == DisputeState.AppealWindow, "No appeal");
        require(block.timestamp >= d.appealDeadline, "Appeal active");
        require(d.heldAmount > 0, "Nothing held");

        uint256 held = d.heldAmount;
        d.heldAmount = 0;
        d.state = DisputeState.Resolved;
        _sendValue(d.winner, held);

        emit AppealFinalized(id, d.winner, held);
    }

    function claimExpiry(uint256 id) external noReentry {
        Dispute storage d = disputes[id];
        require(d.createdAt != 0 || id < disputeCount, "Unknown dispute");
        require(block.timestamp > d.createdAt + EXPIRY, "Not expired");
        require(d.state != DisputeState.Resolved && d.state != DisputeState.Expired, "Closed");

        d.state = DisputeState.Expired;
        uint256 plaintiffAmount = d.plaintiffDeposit;
        uint256 defendantAmount = d.defendantDeposit;
        d.plaintiffDeposit = 0;
        d.defendantDeposit = 0;
        d.heldAmount = 0;

        if (plaintiffAmount > 0) _sendValue(d.plaintiff, plaintiffAmount);
        if (defendantAmount > 0) _sendValue(d.defendant, defendantAmount);

        emit DisputeExpired(id);
    }

    function getDispute(uint256 id) external view returns (Dispute memory) {
        return disputes[id];
    }

    function _requestPlaintiffParse(uint256 id, uint256 budget) internal returns (uint256 requestId) {
        Dispute storage d = disputes[id];
        string[] memory options = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            IParseWebsiteAgent.ExtractString.selector,
            "claims",
            "Factual claims relevant to this dispute",
            options,
            _researchPrompt(),
            d.plaintiffEvidenceUrl,
            false,
            1,
            70
        );
        requestId = _createAgentRequest(id, RequestStage.PlaintiffParse, parseWebsiteAgentId, payload, budget);
    }

    function _requestDefendantParse(uint256 id, uint256 budget) internal returns (uint256 requestId) {
        Dispute storage d = disputes[id];
        string[] memory options = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            IParseWebsiteAgent.ExtractString.selector,
            "claims",
            "Factual claims relevant to this dispute",
            options,
            _researchPrompt(),
            d.defendantEvidenceUrl,
            false,
            1,
            70
        );
        requestId = _createAgentRequest(id, RequestStage.DefendantParse, parseWebsiteAgentId, payload, budget);
    }

    function _requestJudge(uint256 id, uint256 budget) internal returns (uint256 requestId) {
        Dispute storage d = disputes[id];
        string[] memory allowedValues = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            _judgePrompt(d),
            _judgeSystemPrompt(),
            false,
            allowedValues
        );
        requestId = _createAgentRequest(id, RequestStage.Judge, judgeInferenceAgentId, payload, budget);
    }

    function _createAgentRequest(
        uint256 id,
        RequestStage stage,
        uint256 agentId,
        bytes memory payload,
        uint256 budget
    ) internal returns (uint256 requestId) {
        Dispute storage d = disputes[id];
        uint256 value = budget;
        if (value == 0 && stage == RequestStage.PlaintiffParse) value = _requiredRequestBudget(RequestStage.PlaintiffParse);
        if (value == 0 && stage == RequestStage.DefendantParse) value = _requiredRequestBudget(RequestStage.DefendantParse);
        if (value == 0 && stage == RequestStage.Judge) value = _requiredRequestBudget(RequestStage.Judge);
        require(value > 0 && value <= d.agentBudget, "Insufficient agent budget");
        d.agentBudget -= value;

        requestId = platform.createRequest{value: value}(agentId, address(this), this.handleResponse.selector, payload);
        pendingRequests[requestId] = PendingRequest({disputeId: id, stage: stage, valid: true});
        disputes[id].latestRequestId = requestId;

        emit AgentRequestCreated(id, requestId, stage);
    }

    function _executeVerdict(
        uint256 id,
        uint8 confidence,
        address winner,
        string memory reasoning,
        string memory verdictJson
    ) internal {
        Dispute storage d = disputes[id];
        uint256 total = d.plaintiffDeposit + d.defendantDeposit;

        d.confidence = confidence;
        d.winner = winner;
        d.verdictReasoning = reasoning;
        d.plaintiffDeposit = 0;
        d.defendantDeposit = 0;

        if (winner == address(0)) {
            d.state = DisputeState.Resolved;
            _sendValue(d.plaintiff, total / 2);
            _sendValue(d.defendant, total - (total / 2));
        } else if (confidence >= 90) {
            d.state = DisputeState.Resolved;
            _sendValue(winner, total);
        } else if (confidence >= 60) {
            uint256 release = (total * 80) / 100;
            d.heldAmount = total - release;
            d.state = DisputeState.AppealWindow;
            d.appealDeadline = block.timestamp + APPEAL_WINDOW;
            _sendValue(winner, release);
        } else {
            d.heldAmount = total;
            d.state = DisputeState.EscalatedToDAO;
            emit EscalatedToDAO(id, confidence);
        }

        emit AgentStep(id, RequestStage.Judge, "Final verdict issued", verdictJson);
        emit VerdictDelivered(id, winner, confidence, reasoning, verdictJson);
    }

    function _researchPrompt() internal pure returns (string memory) {
        return "You are a neutral evidence researcher. Parse this URL and extract ONLY factual claims relevant to the dispute. Output JSON with claims, timestamps, and sourceCredibility. If inaccessible, return {\"error\":\"unreachable\"}.";
    }

    function _judgeSystemPrompt() internal pure returns (string memory) {
        return "You are an impartial on-chain arbitrator. Return only valid JSON and nothing else.";
    }

    function _judgePrompt(Dispute storage d) internal view returns (string memory) {
        return string.concat(
            "You are an impartial arbitrator. DISPUTE: ",
            d.description,
            "\nPLAINTIFF EVIDENCE: ",
            d.plaintiffSummary,
            "\nDEFENDANT EVIDENCE: ",
            d.defendantSummary,
            "\nRules: Base verdict ONLY on submitted evidence. If evidence is equal, output split. ",
            "Respond ONLY with valid JSON: {\"winner\":\"plaintiff\"|\"defendant\"|\"split\",\"confidence\":0-100,\"reasoning\":\"one sentence max 20 words\"}"
        );
    }

    function _requiredRequestBudget(RequestStage stage) internal view returns (uint256) {
        uint256 perAgentPrice;
        if (stage == RequestStage.PlaintiffParse || stage == RequestStage.DefendantParse) {
            perAgentPrice = LLM_PARSE_WEBSITE_COST_PER_AGENT;
        } else if (stage == RequestStage.Judge) {
            perAgentPrice = LLM_INFERENCE_COST_PER_AGENT;
        }
        return platform.getRequestDeposit() + (perAgentPrice * SUBCOMMITTEE_SIZE);
    }

    function _minimumAgentBudget() internal view returns (uint256) {
        return
            _requiredRequestBudget(RequestStage.PlaintiffParse) +
            _requiredRequestBudget(RequestStage.DefendantParse) +
            _requiredRequestBudget(RequestStage.Judge);
    }

    function _parseWinner(string memory json, address plaintiff, address defendant) internal pure returns (address) {
        bytes memory b = bytes(json);
        if (_contains(b, bytes("\"winner\":\"plaintiff\"")) || _contains(b, bytes("\"winner\": \"plaintiff\""))) {
            return plaintiff;
        }
        if (_contains(b, bytes("\"winner\":\"defendant\"")) || _contains(b, bytes("\"winner\": \"defendant\""))) {
            return defendant;
        }
        return address(0);
    }

    function _parseConfidence(string memory json) internal pure returns (uint8) {
        bytes memory b = bytes(json);
        bytes memory key = bytes("\"confidence\"");

        for (uint256 i = 0; i + key.length < b.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < key.length; j++) {
                if (b[i + j] != key[j]) {
                    found = false;
                    break;
                }
            }
            if (!found) continue;

            uint256 cursor = i + key.length;
            while (cursor < b.length && (b[cursor] == 0x3a || b[cursor] == 0x20)) cursor++;

            uint256 value;
            bool hasDigit;
            while (cursor < b.length && uint8(b[cursor]) >= 48 && uint8(b[cursor]) <= 57) {
                value = (value * 10) + (uint8(b[cursor]) - 48);
                hasDigit = true;
                cursor++;
            }

            if (!hasDigit) return 0;
            if (value > 100) return 100;
            return uint8(value);
        }

        return 0;
    }

    function _parseReasoning(string memory json) internal pure returns (string memory) {
        bytes memory b = bytes(json);
        bytes memory key = bytes("\"reasoning\"");

        for (uint256 i = 0; i + key.length < b.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < key.length; j++) {
                if (b[i + j] != key[j]) {
                    found = false;
                    break;
                }
            }
            if (!found) continue;

            uint256 cursor = i + key.length;
            while (cursor < b.length && b[cursor] != 0x22) cursor++;
            if (cursor >= b.length) return json;
            cursor++;

            uint256 start = cursor;
            while (cursor < b.length && b[cursor] != 0x22) cursor++;
            if (cursor <= start) return json;

            bytes memory out = new bytes(cursor - start);
            for (uint256 k = 0; k < out.length; k++) out[k] = b[start + k];
            return string(out);
        }

        return json;
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length > haystack.length) return false;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        return false;
    }

    function _sendValue(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Transfer failed");
    }

    receive() external payable {}
}
