# Gavel: Somnia Agentathon Judging Guide

## One-Line Pitch

Gavel turns Somnia validator-consensus AI into enforceable economic decisions: one arbitration transaction launches a five-stage autonomous jury that reads both parties' public evidence, challenges unsupported claims, records a strict verdict, and unlocks escrow.

## Why Gavel Needs Somnia

An autonomous court must reason over offchain evidence while controlling onchain funds. Using a project-operated AI server or a single oracle would make that service the trusted judge.

Gavel uses Somnia Agents because validators independently execute the offchain evidence and inference jobs, reach consensus, and callback into the escrow contract. The contract accepts only the expected Somnia platform callback and request ID, validates the final verdict format, and converts the result into secure pull-payment credits.

This creates a product that cannot be reproduced honestly by calling a centralized LLM API from a backend and posting its answer onchain.

## Judge The Live Product

| Question | Verifiable answer |
| --- | --- |
| Is it deployed? | Yes. The latest Gavel V2.1 source is deployed at `0x0BCEF4b601A497Db5A57AC211Ed95d01ad009A4A`; the completed five-stage case proof is on `0xEd614e7A3A80fd26426c6780cC15cf9a4F003f21`. |
| Are Somnia Agents essential? | Yes. Arbitration cannot advance from evidence to verdict without five authenticated Somnia Agent callbacks. |
| Does it run autonomously? | Yes. After `requestArbitration`, each successful callback launches the next stage without another user transaction. |
| Does agent output have consequences? | Yes. The validated consensus verdict determines which accounts receive escrow withdrawal credits. |
| Is there live proof? | Yes. Case `0` completed five requests with 15/15 successful validator execution receipts. |
| Can failures be handled? | Yes. Failed stages are retryable, and permanently failed disputes can recover escrow after the delay. |

## Five-Stage Autonomous Jury

1. **Plaintiff research:** Somnia LLM Parse Website extracts supported claims from the plaintiff evidence URL.
2. **Defendant research:** Somnia LLM Parse Website independently extracts the defendant record.
3. **Evidence validator:** Somnia LLM Inference checks accessibility, support, timestamps, and contradictions.
4. **Skeptic:** Somnia LLM Inference challenges both sides and identifies weak conclusions.
5. **Final judge:** Somnia LLM Inference returns `GAVEL_V1|winner|confidence|reasoning`.

The contract rejects malformed verdicts instead of silently paying either party.

## Judging Criteria

### Functionality

- Deployed and working on Somnia testnet.
- 38 passing contract tests and a successful production frontend build.
- Real dispute creation, matched escrow, evidence submission, autonomous arbitration, verdict, receipt inspection, and withdrawal.
- Pull payments prevent a malicious receiver from blocking resolution.
- State-specific expiry, retry, and recovery paths protect escrow.
- A permissionless 15-minute fallback prevents an undelivered platform timeout callback from trapping a case in arbitration.

### Agent-First Design

- Somnia Agents are the decision engine, not a decorative chatbot.
- One transaction starts five asynchronous requests.
- Authenticated callbacks autonomously advance the contract state machine.
- Every expected request ID and stage is stored and validated.
- The public contract interface allows other contracts or agents to create cases, fund arbitration, and consume verdict state.

### Innovation And Technical Creativity

- Validator-consensus AI reasons over unstructured public evidence and controls escrow.
- Validator and skeptic stages reduce the risk of a single-pass LLM judgment.
- Strict verdict parsing creates a deterministic contract boundary between AI reasoning and financial execution.
- Real validator receipts expose how each consensus job executed.

### Autonomous Performance

- Live Case `0` completed all five stages.
- Request IDs: `5892205`, `5892264`, `5892316`, `5892338`, `5892357`.
- All five requests produced three successful validator receipts: 15/15 successful execution traces.
- Failed, malformed, empty, duplicated, unauthorized, and out-of-order callbacks are tested.

## Live Proof

- V2.1 primary contract: `0x0BCEF4b601A497Db5A57AC211Ed95d01ad009A4A`
- V2 completed-case proof contract: `0xEd614e7A3A80fd26426c6780cC15cf9a4F003f21`
- SomniaAgents platform: `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`
- LLM Parse Website agent ID: `12875401142070969085`
- LLM Inference agent ID: `12847293847561029384`
- Case `0` result: split verdict, 60% confidence
- Plaintiff withdrawal transaction: `0x853709e3c398023ebb494750fe7f6b7ace0054d4729ee536b72ab5ee117c3414`

## Honest Limitations

- The live jury has five stages implemented with two Somnia base agent types and distinct prompts. It is not five separately deployed custom agents.
- JSON API Request is planned for structured evidence verification but is not used by deployed V2.
- Native Reactivity is not currently used; the autonomous progression is driven by authenticated Somnia Agent callbacks.
- The current public proof contains one completed V2 dispute on the earlier V2 deployment. A complete case on the latest primary address would provide stronger proof.
- External contracts and agents can invoke the public interface, but the current demo does not show autonomous discovery by another agent.

## Highest-Value Next Steps

1. Add JSON API Request as a structured evidence verification tool.
2. Demonstrate an external Somnia agent or contract creating and consuming a Gavel case.
3. Publish decisive plaintiff-win, defendant-win, split, and failed-stage-retry live cases.
4. Evaluate Native Reactivity for automatic expiry and recovery triggers when the production interface is available.

## Somnia References

- [Somnia Developer Documentation](https://docs.somnia.network/)
- [Somnia Network Overview](https://docs.somnia.network/developer/network-info/network-overview-mainnet-testnet)
- [Somnia Smart Contract Tutorials](https://docs.somnia.network/developer/tutorials)
- [Somnia Homepage](https://somnia.network/)
