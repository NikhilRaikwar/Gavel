// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDisputeEscrowV2Actions {
    function createDispute(address defendant, string calldata description) external payable returns (uint256);
    function withdraw() external;
}

contract RejectingParty {
    function create(address escrow, address defendant) external payable {
        IDisputeEscrowV2Actions(escrow).createDispute{value: msg.value}(defendant, "Contract party dispute");
    }

    function withdrawFrom(address escrow) external {
        IDisputeEscrowV2Actions(escrow).withdraw();
    }

    receive() external payable {
        revert("Reject ETH");
    }
}
