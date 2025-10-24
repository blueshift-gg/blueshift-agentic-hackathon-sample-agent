import * as dotenv from "dotenv";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { HumanMessage } from "@langchain/core/messages";

import { loadConfig } from "./config.js";
import { SolanaWallet } from "./solana.js";
import { BlueshiftClient } from "./blueshiftClient.js";
import {
  buildInitialInstructions,
  buildSystemPrompt,
  createCodingAgent,
} from "./agent.js";

dotenv.config();

async function main() {
  const config = loadConfig();

  const wallet = new SolanaWallet(config.solanaPrivateKey);
  const blueshiftClient = new BlueshiftClient(config.blueshiftApiUrl, wallet);

  const mcpClient = new MultiServerMCPClient({
    useStandardContentBlocks: true,
    mcpServers: {
      blueshift: {
  url: config.blueshiftMcpUrl,
        headers: {
          Accept: "text/event-stream",
        },
        automaticSSEFallback: false,
      },
    },
  });

  const mcpTools = await mcpClient.getTools();

  const agent = await createCodingAgent(config, wallet, blueshiftClient, mcpTools);

  const systemPrompt = buildSystemPrompt(config, wallet);
  const initialInstruction = buildInitialInstructions();

  const threadId = `solana-agent-${Date.now()}`;
  const configBlock = { configurable: { thread_id: threadId } } as const;

  console.log(`🚀 Starting Solana coding agent for wallet ${wallet.address}`);
  console.log(`🔗 Using API URL: ${config.blueshiftApiUrl}`);
  console.log(`🔌 Using MCP server: ${config.blueshiftMcpUrl}`);

  try {
    const stream = await agent.stream(
      {
        messages: [systemPrompt, initialInstruction as HumanMessage],
      },
      configBlock,
    );

    process.stdout.write("🤖 Agent: ");
    for await (const chunk of stream) {
      if (typeof chunk !== "object" || chunk === null) {
        continue;
      }
      const typedChunk = chunk as {
        agent?: { messages?: Array<{ content?: unknown; tool_calls?: Array<{ name?: string; args?: unknown }> }> };
        tools?: { messages?: Array<{ content?: unknown }> };
      };

      if (typedChunk.agent?.messages && Array.isArray(typedChunk.agent.messages)) {
        for (const message of typedChunk.agent.messages) {
          // Print agent's text content
          if (message.content) {
            const agentContent = String(message.content);
            if (agentContent.trim()) {
              process.stdout.write(agentContent);
            }
          }

          // Print tool calls (intent)
          if (message.tool_calls && Array.isArray(message.tool_calls)) {
            for (const toolCall of message.tool_calls) {
              const toolName = toolCall.name || "unknown";
              const toolArgs = toolCall.args ? JSON.stringify(toolCall.args, null, 2) : "{}";
              process.stdout.write(`\n🎯 Intent: Calling tool "${toolName}"\n`);
              process.stdout.write(`   Args: ${toolArgs}\n`);
            }
          }
        }
      } else if (typedChunk.tools?.messages && Array.isArray(typedChunk.tools.messages)) {
        const toolMessages = typedChunk.tools.messages
          .map((message) => String(message.content))
          .join("\n");
        process.stdout.write(`🛠️ Tool Output:\n${toolMessages}\n`);
      }
    }
    console.log("\n✅ Agent run complete");
  } finally {
    await mcpClient.close();
  }
}

main().catch((error) => {
  console.error("Agent execution failed", error);
  process.exit(1);
});