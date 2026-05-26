# Agent Prompt Library

This directory is the source of truth for Gavel's agent prompt templates and role definitions.

## Structure

- `research.md`
  - Evidence extraction prompt for the Somnia Parse Website role
- `validator.md`
  - Claim consistency and verification prompt for future multi-step reasoning
- `skeptic.md`
  - Adversarial review prompt for future multi-agent deliberation
- `judge.md`
  - Final verdict prompt used to produce a structured outcome

## Why Markdown Here

- The library is meant to be readable and maintainable by humans.
- Markdown lets each prompt file include purpose, inputs, outputs, and the raw prompt itself.
- The actual prompt text remains copyable, but the surrounding documentation makes the role clearer.

## Current MVP

- The deployed contract uses inline prompt strings in Solidity today.
- These library files are the canonical reference for future custom agents, prompt tuning, or v2 workflows.
