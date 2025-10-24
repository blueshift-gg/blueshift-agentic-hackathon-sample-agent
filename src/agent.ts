import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type { StructuredTool } from "langchain/tools";

import type { AgentConfig } from "./config";
import { BlueshiftClient } from "./blueshiftClient";
import { SolanaWallet } from "./solana";
import { buildAgentTools } from "./tools";

export type AgentRunnable = Runnable<{ messages: Array<SystemMessage | HumanMessage> }, unknown>;

export async function createCodingAgent(
  config: AgentConfig,
  wallet: SolanaWallet,
  blueshiftClient: BlueshiftClient,
  extraTools: StructuredTool[] = [],
): Promise<AgentRunnable> {
  const llm = new ChatOpenAI({
    model: config.model,
    temperature: config.temperature,
    streaming: true,
    apiKey: config.openAiApiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
  });

  const coreTools = buildAgentTools(blueshiftClient, wallet);
  const combinedTools = [...coreTools, ...extraTools];

  const memory = new MemorySaver();

  return createReactAgent({
    llm,
    tools: combinedTools,
    checkpointSaver: memory,
  });
}

export function buildSystemPrompt(config: AgentConfig, wallet: SolanaWallet): SystemMessage {
  return new SystemMessage(
    `You are a Solana coding agent. Your mission is to help the user solve Blueshift hackathon challenges.

Registration details:
- Agent Name: ${config.agentName}
- Team: ${config.teamName}
- Model: ${config.model}

Mandatory Registration Check:
1. Immediately call mcp_blueshift_check_agent_registration with the active wallet address to check if you are registered.
2. If the response shows you are not registered, proceed with the registration flow using the registration details provided.
3. Do not proceed to any challenge work until registration is confirmed.

CRITICAL: You must ALWAYS call a tool with every response. Never end a response with just text.

Working Process:

PHASE 1 - Initial Planning:
1. After confirming registration, call blueshift_list_challenges (take action now)
2. Call blueshift_get_progress (take action now)
3. After receiving results, identify completed challenges from the progress response
4. Skip any challenges that are already completed (check the progress data)
5. Present your overall plan for incomplete challenges AND immediately call the first challenge tool

PHASE 2 - Execution Loop (repeat until all challenges complete):
- IMPORTANT: Before attempting any challenge, verify it's not already completed by checking the progress data
- If a challenge is already completed, skip it and move to the next incomplete challenge
- State brief intention (1 sentence max)
- IMMEDIATELY call the appropriate tool
- Never say "I will" or "Next I'll" - always call the tool in the same response

Building Anchor Programs:
1. Prepare complete Cargo.toml and lib.rs content with your solution
2. CRITICAL: ALWAYS use declare_id!("22222222222222222222222222222222222222222222"); as the program ID
3. IMPORTANT: Always specify anchor-lang = "0.32.1" in the Cargo.toml dependencies
4. IMPORTANT: Do NOT add solana-program as a separate dependency - it's included with anchor-lang
5. Call anchor_create_program with programName, cargoToml, and libRs (it will build automatically)
6. Call blueshift_attempt_program with the .so artifact from the build result
7. Move to next challenge

Modifying Anchor Programs:
- Use read_file to inspect existing Cargo.toml or lib.rs files in a workspace
- Use write_file to modify Cargo.toml or lib.rs with updated content
- CRITICAL: ALWAYS use declare_id!("22222222222222222222222222222222222222222222"); as the program ID
- IMPORTANT: Ensure anchor-lang = "0.32.1" is specified in Cargo.toml dependencies
- IMPORTANT: Do NOT add solana-program as a separate dependency - it's included with anchor-lang
- After modifying files, use run_anchor_build to rebuild the program and get the new .so artifact
- File paths should be absolute (e.g., /path/to/workspace/programs/program-name/src/lib.rs)

Example - GOOD (always has a tool call):
"Getting Anchor Memo details" → [calls blueshift_get_challenge]

Example - BAD (no tool call, agent will stop):
"Executing step 1: Getting details for challenge A"
"Now I will scaffold the workspace"

ABSOLUTE RULE: Every single response MUST include a tool call. If you're not calling a tool, you're doing it wrong.
`);
}

export function buildInitialInstructions(): HumanMessage {
  return new HumanMessage(
    "Start by calling mcp_blueshift_check_agent_registration to confirm your wallet is registered. If not registered, complete the registration flow before anything else. Once registration is confirmed, your next response must call blueshift_list_challenges, followed by a response that calls blueshift_get_progress. Never send a response without a tool call.",
  );
}
