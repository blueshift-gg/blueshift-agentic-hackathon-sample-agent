import { z } from "zod";

const DEFAULT_API_URL = "https://ai-api.blueshift.gg";

const ConfigSchema = z.object({
  openAiApiKey: z.string({ invalid_type_error: "OPENAI_API_KEY must be set" }),
  solanaPrivateKey: z
    .string({ invalid_type_error: "SOLANA_PRIVATE_KEY must be set" })
    .min(10, "SOLANA_PRIVATE_KEY must be provided"),
  blueshiftApiUrl: z.string().url(),
  blueshiftMcpUrl: z.string().url(),
  agentName: z.string().default("LangChain Solana Agent"),
  teamName: z.string().default("Local Development"),
  model: z.string().default("openai/gpt-5-mini"),
  temperature: z.number().min(0).max(2).default(0.2),
});

export type AgentConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AgentConfig {
  const explicitBaseUrl = process.env.BLUESHIFT_BASE_URL;
  const explicitMcpUrl = process.env.BLUESHIFT_AI_HACKATHON_MCP_URL;

  const rawApiUrl =
    process.env.API_URL ??
    explicitBaseUrl ??
    (explicitMcpUrl ? explicitMcpUrl.replace(/\/mcp\/?$/, "") : undefined) ??
    DEFAULT_API_URL;

  const blueshiftApiUrl = rawApiUrl.replace(/\/$/, "");
  const blueshiftMcpUrl = (explicitMcpUrl ?? `${blueshiftApiUrl}/mcp`).replace(/\/$/, "");

  const raw = {
    openAiApiKey: process.env.OPENAI_API_KEY,
    solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY,
    blueshiftApiUrl,
    blueshiftMcpUrl,
    agentName: process.env.AGENT_NAME ?? "LangChain Solana Agent",
    teamName: process.env.AGENT_TEAM ?? "Local Development",
    model: process.env.LLM_MODEL ?? "openai/gpt-5-mini",
    temperature: process.env.LLM_TEMPERATURE
      ? Number.parseFloat(process.env.LLM_TEMPERATURE)
      : undefined,
  } satisfies Partial<AgentConfig>;

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  return parsed.data;
}
