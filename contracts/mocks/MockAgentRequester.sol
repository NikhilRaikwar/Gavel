// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRequester, IAgentRequesterHandler, Request, Response, ResponseStatus, ConsensusType} from "../interfaces/IAgentRequester.sol";

contract MockAgentRequester is IAgentRequester {
    uint256 public nextRequestId = 1;
    uint256 public requestDeposit = 0.01 ether;

    struct CreatedRequest {
        uint256 agentId;
        address requester;
        address callbackAddress;
        bytes4 callbackSelector;
        bytes payload;
        uint256 value;
    }

    mapping(uint256 => CreatedRequest) public createdRequests;

    event MockRequestCreated(uint256 indexed requestId, uint256 agentId, address callbackAddress, bytes payload, uint256 value);

    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId) {
        requestId = nextRequestId++;
        createdRequests[requestId] = CreatedRequest({
            agentId: agentId,
            requester: msg.sender,
            callbackAddress: callbackAddress,
            callbackSelector: callbackSelector,
            payload: payload,
            value: msg.value
        });
        emit MockRequestCreated(requestId, agentId, callbackAddress, payload, msg.value);
    }

    function getRequestDeposit() external view returns (uint256) {
        return requestDeposit;
    }

    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256,
        uint256,
        ConsensusType,
        uint256
    ) external payable returns (uint256 requestId) {
        requestId = nextRequestId++;
        createdRequests[requestId] = CreatedRequest({
            agentId: agentId,
            requester: msg.sender,
            callbackAddress: callbackAddress,
            callbackSelector: callbackSelector,
            payload: payload,
            value: msg.value
        });
    }

    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256) {
        return requestDeposit * subcommitteeSize;
    }

    function fulfillString(uint256 requestId, string calldata result) external {
        CreatedRequest storage created = createdRequests[requestId];
        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: address(this),
            result: abi.encode(result),
            status: ResponseStatus.Success,
            receipt: requestId,
            timestamp: block.timestamp,
            executionCost: 0
        });
        Request memory details = _requestDetails(requestId, created);
        IAgentRequesterHandler(created.callbackAddress).handleResponse(requestId, responses, ResponseStatus.Success, details);
    }

    function fail(uint256 requestId, ResponseStatus status) external {
        CreatedRequest storage created = createdRequests[requestId];
        Response[] memory responses = new Response[](0);
        Request memory details = _requestDetails(requestId, created);
        IAgentRequesterHandler(created.callbackAddress).handleResponse(requestId, responses, status, details);
    }

    function fulfillEmpty(uint256 requestId) external {
        CreatedRequest storage created = createdRequests[requestId];
        Response[] memory responses = new Response[](0);
        Request memory details = _requestDetails(requestId, created);
        IAgentRequesterHandler(created.callbackAddress).handleResponse(requestId, responses, ResponseStatus.Success, details);
    }

    function sendRebate(address payable requester) external payable {
        (bool ok, ) = requester.call{value: msg.value}("");
        require(ok, "Rebate failed");
    }

    function _requestDetails(uint256 requestId, CreatedRequest storage created) private view returns (Request memory details) {
        address[] memory subcommittee = new address[](1);
        subcommittee[0] = address(this);
        Response[] memory responses = new Response[](0);
        details = Request({
            id: requestId,
            requester: created.requester,
            callbackAddress: created.callbackAddress,
            callbackSelector: created.callbackSelector,
            subcommittee: subcommittee,
            responses: responses,
            responseCount: 1,
            failureCount: 0,
            threshold: 1,
            createdAt: block.timestamp,
            deadline: block.timestamp + 1 hours,
            status: ResponseStatus.Success,
            consensusType: ConsensusType.Majority,
            remainingBudget: 0,
            perAgentBudget: 0
        });
    }
}
