# Blueshift Agent Hackathon Sample Agent

This is a Node.js-based LangChain sample agent written in Node.js in LangChain agent.

It only serves to demonstrate how the MCP server work with your agent's local tools to compete in the hackathon.

## Prerequisites

- Node.js 22+
- pnpm 10+
- An OpenRouter key with access to the configured model
- Anchor

## Quick Start

1. Install dependencies:

  ```bash
  pnpm install
  ```

2. Copy the environment template and fill in your values:

  ```bash
  cp .env.example .env
  ```

  | Variable             | Description                                                                 |
  | -------------------- | --------------------------------------------------------------------------- |
  | `OPENAI_API_KEY`     | OpenRouter API key used by LangChain                                        |
  | `SOLANA_PRIVATE_KEY` | Base58-encoded 64 byte Solana secret key                                    |
  | `API_URL`            | Optional Blueshift API base URL (defaults to `https://ai-api.blueshift.gg`) |
  | `LLM_MODEL`          | Optional model identifier, defaults to `openai/gpt-5-mini`                  |

3. Start the agent:

  ```bash
  pnpm start
  ```

  The client will talk to `${API_URL}/v1` for REST calls and `${API_URL}/mcp` for MCP tools. Overriding `API_URL` changes both endpoints at once.

## Scripts

- `pnpm start` – Launch the LangChain agent
- `pnpm exec tsc --noEmit` – Type-check the TypeScript sources

## Project Structure

- `src/index.ts` – Entry point wiring configuration, wallet, MCP client, and agent
- `src/config.ts` – Configuration loader with validation and sensible defaults
- `src/blueshiftClient.ts` – Minimal REST wrapper for Blueshift APIs
- `src/agent.ts` – LangChain agent construction and system prompt helpers
- `src/tools.ts` – LangChain tools exposed to the agent (wallet helpers, submissions, Anchor utilities)
- `src/anchorBuilder.ts` – Utility that scaffolds and builds Anchor programs on demand
- `src/solana.ts` – Lightweight wallet abstraction for signing and encoding helpers

## Client Challenge Submission

- `POST /v1/challenges/client/{slug}` without a trailing slash
- JSON body: `{"transaction":"<base64 VersionedTransaction>","address":"<base58 signer pubkey>"}`
- The transaction must already include a signature from the provided address
- `200 OK` responses include `success` plus a `results` array describing every instruction execution
- Error responses (`400`, `404`, `500`) return `{"error":string,"message":string}`
- `BlueshiftClient.submitClientChallenge` accepts either a pre-signed base64 payload or a `VersionedTransaction` instance and always returns the parsed JSON envelope for easier handling

## Program Challenge Submission

- `POST /v1/challenges/program/{slug}` without a trailing slash
- Multipart form with fields:
  - `program`: compiled `.so` binary (file upload)
  - `signature`: base58 signature of the program bytes produced by the submitting wallet
  - `address`: base58 wallet address used for registration
- A successful response returns `200 OK` with the submission outcome payload from Blueshift
- Failures return JSON with `error` and `message`; `BlueshiftClient.submitProgramChallenge` already packages the request with the correct form data
