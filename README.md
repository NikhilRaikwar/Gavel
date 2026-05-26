# Gavel

[![Somnia](https://img.shields.io/badge/Built%20for-Somnia%20Testnet-0B1F4B?style=for-the-badge&logo=ethereum&logoColor=white)](https://www.somnia.network/)
[![Chain ID](https://img.shields.io/badge/Chain%20ID-50312-0EA5E9?style=for-the-badge)](https://shannon-explorer.somnia.network)
[![Agents](https://img.shields.io/badge/Somnia%20Agents-Live-7C3AED?style=for-the-badge)](https://agents.testnet.somnia.network)
[![Hardhat](https://img.shields.io/badge/Hardhat-Smart%20Contracts-F97316?style=for-the-badge)](https://hardhat.org/)
[![Vite](https://img.shields.io/badge/Vite-Frontend-22C55E?style=for-the-badge)](https://vite.dev/)
[![React](https://img.shields.io/badge/React-UI-06B6D4?style=for-the-badge)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge)](LICENSE)

Gavel is an onchain dispute resolution app for Somnia testnet. Two parties stake equal value into escrow, submit evidence, and let deterministic Somnia agents decide the outcome on-chain.

The project uses:
- Somnia Agents for evidence extraction and verdict inference
- A Solidity escrow contract with callback-based agent requests
- A React/Vite dashboard for users to create disputes and follow the live hearing

## Project Snapshot

### Problem

Disputes are slow, expensive, and hard to verify when evidence lives across public URLs, private messages, and off-chain coordination. Traditional escrow systems need a human arbiter or a backend service that users must trust.

### Solution

Gavel turns dispute resolution into an on-chain workflow. Both parties stake equally, submit evidence URLs, and let Somnia validator-executed agents extract claims and return a deterministic verdict with audit receipts.

### Somnia Integration

- Evidence parsing uses the Somnia LLM Parse Website agent
- Final judgment uses the Somnia LLM Inference agent
- Requests are routed through the SomniaAgents platform contract
- Receipts are available from the Somnia receipt service

### Deployment Status

- Deployed on Somnia testnet
- Verified on the Shannon explorer
- Frontend configured to use the deployed contract address
- Wallet-gated landing page and dashboard flow are active

### Demo Flow

1. Connect wallet on the landing page
2. Switch to Somnia testnet if needed
3. Create a dispute and lock escrow
4. Submit evidence URLs for both parties
5. Request arbitration with the minimum agent budget
6. Watch the live hearing and open the receipt
7. Disconnect the wallet to return to the landing page

## What Gavel Does

- Locks equal stakes from both parties into escrow
- Collects evidence URLs from plaintiff and defendant
- Calls Somnia LLM Parse Website agents to extract factual claims
- Calls the Somnia LLM Inference agent to produce a final verdict
- Releases funds automatically based on the verdict confidence
- Stores and displays Somnia receipt data for auditability

## Live Somnia Setup

- Testnet chain ID: `50312`
- RPC: `https://api.infra.testnet.somnia.network`
- Deployed contract: [0xdc9A2ea119467AADcee21258A54138A8B138f6c5](https://shannon-explorer.somnia.network/address/0xdc9A2ea119467AADcee21258A54138A8B138f6c5#code)
- SomniaAgents contract: [0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776](https://shannon-explorer.somnia.network/address/0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776#code)
- AgentRegistry contract: [0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A](https://shannon-explorer.somnia.network/address/0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A#code)
- LLM Parse Website agent ID: [12875401142070969085](https://agents.testnet.somnia.network/agent/12875401142070969085)
- LLM Inference agent ID: [12847293847561029384](https://agents.testnet.somnia.network/agent/12847293847561029384)
- JSON API Request agent ID: [13174292974160097713](https://agents.testnet.somnia.network/agent/13174292974160097713)

## Somnia Agents Used

```mermaid
flowchart LR
  classDef parse fill:#7c3aed,stroke:#3b0764,color:#ffffff,stroke-width:2px;
  classDef infer fill:#0ea5e9,stroke:#082f49,color:#ffffff,stroke-width:2px;
  classDef api fill:#f97316,stroke:#7c2d12,color:#ffffff,stroke-width:2px;
  classDef infra fill:#111827,stroke:#374151,color:#ffffff,stroke-width:2px;
  classDef use fill:#22c55e,stroke:#14532d,color:#ffffff,stroke-width:2px;

  P[LLM Parse Website<br/>ID 12875401142070969085<br/>2 methods]:::parse
  I[LLM Inference<br/>ID 12847293847561029384<br/>4 methods]:::infer
  J[JSON API Request<br/>ID 13174292974160097713<br/>6 methods]:::api
  S[SomniaAgents<br/>0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776]:::infra
  R[AgentRegistry<br/>0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A]:::infra

  P -->|Extract evidence claims| U1[Gavel dispute evidence intake]:::use
  I -->|Generate verdict JSON| U2[Gavel final judgment]:::use
  J -->|Optional future oracle checks| U3[Evidence verification / v2]:::use
  S --> P
  S --> I
  S --> J
  R --> S
```

## How Gavel Uses Them

- [LLM Parse Website](https://agents.testnet.somnia.network/agent/12875401142070969085)
  - Used for plaintiff and defendant evidence URLs
  - Extracts factual claims from public pages
  - Powers the first two requests in the dispute pipeline

- [LLM Inference](https://agents.testnet.somnia.network/agent/12847293847561029384)
  - Used for the final judge step
  - Returns winner, confidence, and reasoning
  - Determines how escrow is released

- [JSON API Request](https://agents.testnet.somnia.network/agent/13174292974160097713)
  - Reserved for v2 evidence checks when sources are JSON APIs
  - Not required for the MVP arbitration flow

- [SomniaAgents contract](https://shannon-explorer.somnia.network/address/0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776#code)
  - Platform contract that receives requests and routes callbacks

- [AgentRegistry contract](https://shannon-explorer.somnia.network/address/0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A#code)
  - Registry layer for Somnia agents and explorer metadata

## Architecture

```mermaid
flowchart LR
  classDef user fill:#0ea5e9,stroke:#082f49,color:#ffffff,stroke-width:2px;
  classDef ui fill:#22c55e,stroke:#14532d,color:#ffffff,stroke-width:2px;
  classDef chain fill:#7c3aed,stroke:#3b0764,color:#ffffff,stroke-width:2px;
  classDef agent fill:#f97316,stroke:#7c2d12,color:#ffffff,stroke-width:2px;
  classDef data fill:#14b8a6,stroke:#134e4a,color:#ffffff,stroke-width:2px;
  classDef audit fill:#ef4444,stroke:#7f1d1d,color:#ffffff,stroke-width:2px;

  U[User Wallet]:::user
  UI[Gavel React Dashboard]:::ui
  SC[DisputeEscrow.sol]:::chain
  PA[Somnia Parse Website Agent]:::agent
  IA[Somnia Inference Agent]:::agent
  RC[Somnia Receipt Service]:::audit
  EX[Evidence URLs]:::data
  VF[Verdict + Fund Release]:::chain

  U --> UI
  UI --> SC
  SC --> EX
  SC --> PA
  SC --> IA
  PA --> SC
  IA --> SC
  SC --> VF
  SC --> RC
  RC --> UI
```

## AI Agent Flow

```mermaid
flowchart TD
  classDef start fill:#0f766e,stroke:#134e4a,color:#ffffff,stroke-width:2px;
  classDef research fill:#f59e0b,stroke:#92400e,color:#ffffff,stroke-width:2px;
  classDef judge fill:#8b5cf6,stroke:#4c1d95,color:#ffffff,stroke-width:2px;
  classDef escrow fill:#10b981,stroke:#064e3b,color:#ffffff,stroke-width:2px;
  classDef warn fill:#ef4444,stroke:#7f1d1d,color:#ffffff,stroke-width:2px;

  A[Dispute created]:::start --> B[Both parties deposit equal stake]:::escrow
  B --> C[Evidence URLs submitted]:::escrow
  C --> D[Plaintiff evidence -> Parse Website agent]:::research
  C --> E[Defendant evidence -> Parse Website agent]:::research
  D --> F[Plaintiff summary stored on-chain]:::escrow
  E --> G[Defendant summary stored on-chain]:::escrow
  F --> H[Judge prompt assembled]:::judge
  G --> H
  H --> I[LLM Inference agent returns verdict JSON]:::judge
  I --> J{Confidence >= 90?}:::warn
  J -->|Yes| K[Release full escrow to winner]:::escrow
  J -->|60 to 89| L[Release 80%, open appeal window]:::warn
  J -->|Below 60| M[Escalate to DAO review]:::warn
```

## Request Funding Model

Somnia requests must be funded with the operations reserve plus the runner execution budget:

- Parse Website request: `0.33 STT`
- Inference request: `0.24 STT`
- Three-step arbitration total: `0.90 STT`

The contract enforces this by requiring the full minimum arbitration budget before starting the agent pipeline.

## Tech Stack

- Solidity `0.8.24`
- Hardhat
- React
- Vite
- RainbowKit + Wagmi
- Ethers v6
- Somnia testnet agents

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables in `.env`:

```env
PRIVATE_KEY=your_deployer_key
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network
SOMNIA_AGENTS_ADDRESS=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
PARSE_WEBSITE_AGENT_ID=12875401142070969085
JUDGE_INFERENCE_AGENT_ID=12847293847561029384
VITE_DISPUTE_ESCROW_ADDRESS=your_deployed_contract_address
```

3. Start the frontend:

```bash
npm run frontend:dev
```

4. Compile contracts:

```bash
npm run contracts:compile
```

5. Run tests:

```bash
npm run contracts:test
```

6. Build the app:

```bash
npm run frontend:build
```

## Deploy to Somnia Testnet

```bash
npm run deploy:somnia
```

After deployment:
- Copy the deployed contract address into `DISPUTE_ESCROW_ADDRESS`
- Copy the same address into `VITE_DISPUTE_ESCROW_ADDRESS`
- Rebuild or restart the frontend

## Verify on Somnia

```bash
npm run verify:somnia
```

## How to Use the App

1. Open the landing page.
2. Click `Connect wallet`.
3. Connect a wallet and switch to Somnia testnet if prompted.
4. Enter the dashboard.
5. Create a dispute and lock escrow.
6. Submit evidence URLs for both parties.
7. Request arbitration with at least `0.90 STT`.
8. Watch the live hearing and open the receipt after request creation.
9. Disconnecting the wallet returns you to the landing page.

## Testing Checklist

### Smart Contract

- `createDispute()` locks the plaintiff stake
- `joinDispute()` requires matching defendant stake
- `submitEvidence()` only accepts parties
- `requestArbitration()` requires evidence from both sides
- Agent callbacks only accept calls from the Somnia platform
- Parse Website calls use `ExtractString(...)`
- Inference calls use `inferString(...)`
- Request funding respects the live Somnia deposit model

### Frontend

- Landing page requires wallet connection before entering the dashboard
- Disconnecting wallet returns to the landing page
- Somnia testnet chain is enforced
- Receipt view loads from the Somnia receipts service

## Security Notes

- `.env` is ignored by git and should remain local only
- `.env.example` is safe to commit because it contains placeholders and public addresses only
- The deployed contract address is public, but private keys and API keys must never be committed
- If a live private key was exposed outside this machine, rotate it immediately
