# Agent Prompt Library

This directory is the canonical prompt library for Gavel's Somnia workflows.

## Source of Truth

- `prompt-library/research.md`
  - Evidence extraction prompt for the Somnia Parse Website role

- `prompt-library/validator.md`
  - Claim consistency and verification prompt for future multi-step reasoning

- `prompt-library/skeptic.md`
  - Adversarial review prompt for future multi-agent deliberation

- `prompt-library/judge.md`
  - Final verdict prompt used to produce a structured outcome

## Why Markdown Here

- The library is meant to be readable and maintainable by humans.
- Each file documents the role, expected inputs, expected outputs, and the raw prompt text.
- The prompt body itself remains copyable for Somnia tooling or future custom agents.

## Current MVP Note

- The deployed Gavel MVP uses inline Somnia base-agent ABI calls in the Solidity contract.
- These library files are not directly consumed by the on-chain contract today.
- They are the canonical reference for future custom agents, prompt tuning, or v2 workflows.
