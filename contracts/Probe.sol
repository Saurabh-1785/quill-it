// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Probe
 * @notice Day 3 trivial contract for verifying toolchain, deployment, and source verification
 *         on the QDay Aevum Testnet (Aevum Builder Challenge #1).
 */
contract Probe {
    string public constant VERSION = "1.0.0";
    string public networkTag;
    address public deployer;
    uint256 public pingCount;

    event Ping(address indexed caller, uint256 count, uint256 timestamp);

    constructor(string memory _networkTag) {
        networkTag = _networkTag;
        deployer = msg.sender;
    }

    function ping() external returns (uint256) {
        pingCount++;
        emit Ping(msg.sender, pingCount, block.timestamp);
        return pingCount;
    }
}
