import { StructuredTool } from "langchain/tools";
import { z } from "zod";
import { BlueshiftClient } from "./blueshiftClient.js";
import { SolanaWallet } from "./solana.js";
import { createAnchorProgram } from "./anchorBuilder.js";

const EmptySchema = z.object({});
const NamespaceKeySchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1),
});

const ChallengeSlugSchema = z.object({
  slug: z.string().min(1),
});

class GetWalletAddressTool extends StructuredTool<typeof EmptySchema> {
  name = "wallet_get_address" as const;
  description = "Returns the active Solana wallet address (base58).";
  schema = EmptySchema;

  constructor(private readonly wallet: SolanaWallet) {
    super();
  }

  protected async _call(): Promise<string> {
    return this.wallet.address;
  }
}

const SignBytesSchema = z.object({
  data: z.string().describe("Input data to sign. Interpret according to encoding."),
  encoding: z
    .enum(["base64", "utf8", "hex"])
    .default("base64")
    .describe("Encoding used for the input data."),
});

class SignBytesTool extends StructuredTool<typeof SignBytesSchema> {
  name = "wallet_sign_bytes" as const;
  description =
    "Signs arbitrary bytes with the active wallet and returns the base58 signature.";
  schema = SignBytesSchema;

  constructor(private readonly wallet: SolanaWallet) {
    super();
  }

  protected async _call({ data, encoding }: z.infer<typeof SignBytesSchema>): Promise<string> {
    let bytes: Uint8Array;
    switch (encoding) {
      case "utf8":
        bytes = new TextEncoder().encode(data);
        break;
      case "hex":
        bytes = Uint8Array.from(Buffer.from(data.replace(/^0x/, ""), "hex"));
        break;
      case "base64":
      default:
        bytes = Uint8Array.from(Buffer.from(data, "base64"));
        break;
    }
    return this.wallet.signBase58(bytes);
  }
}

const EncodeBase58Schema = z.object({
  data: z.string().describe("Input data to encode"),
  encoding: z
    .enum(["base64", "utf8", "hex"])
    .default("base64")
    .describe("Encoding used for the input data."),
});

class EncodeBase58Tool extends StructuredTool<typeof EncodeBase58Schema> {
  name = "wallet_encode_base58" as const;
  description = "Encodes provided bytes into base58 using the wallet utility.";
  schema = EncodeBase58Schema;

  constructor(private readonly wallet: SolanaWallet) {
    super();
  }

  protected async _call({ data, encoding }: z.infer<typeof EncodeBase58Schema>): Promise<string> {
    let bytes: Uint8Array;
    switch (encoding) {
      case "utf8":
        bytes = new TextEncoder().encode(data);
        break;
      case "hex":
        bytes = Uint8Array.from(Buffer.from(data.replace(/^0x/, ""), "hex"));
        break;
      case "base64":
      default:
        bytes = Uint8Array.from(Buffer.from(data, "base64"));
        break;
    }
    return this.wallet.encodeBase58(bytes);
  }
}

class ListChallengesTool extends StructuredTool<typeof EmptySchema> {
  name = "blueshift_list_challenges" as const;
  description = "Lists all available Blueshift coding challenges.";
  schema = EmptySchema;

  constructor(private readonly client: BlueshiftClient) {
    super();
  }

  protected async _call(): Promise<string> {
    const challenges = await this.client.listChallenges();
    return JSON.stringify(challenges, null, 2);
  }
}

class GetChallengeTool extends StructuredTool<typeof NamespaceKeySchema> {
  name = "blueshift_get_challenge" as const;
  description = "Fetches details for a specific challenge by namespace and key.";
  schema = NamespaceKeySchema;

  constructor(private readonly client: BlueshiftClient) {
    super();
  }

  protected async _call({ namespace, key }: z.infer<typeof NamespaceKeySchema>): Promise<string> {
    const challenge = await this.client.getChallenge(namespace, key);
    return JSON.stringify(challenge, null, 2);
  }
}

class GetProgressTool extends StructuredTool<typeof EmptySchema> {
  name = "blueshift_get_progress" as const;
  description = "Returns the current progress for the agent wallet.";
  schema = EmptySchema;

  constructor(private readonly client: BlueshiftClient) {
    super();
  }

  protected async _call(): Promise<string> {
    const progress = await this.client.getProgress();
    return JSON.stringify(progress, null, 2);
  }
}

const AttemptProgramSchema = ChallengeSlugSchema.extend({
  programPath: z
    .string()
    .describe("Absolute path to the compiled program binary (.so file) to submit for the challenge."),
});

class AttemptProgramTool extends StructuredTool<typeof AttemptProgramSchema> {
  name = "blueshift_attempt_program" as const;
  description =
    "Submits a program challenge attempt. Provide the challenge slug and the absolute path to the compiled program binary (.so file).";
  schema = AttemptProgramSchema;

  constructor(private readonly client: BlueshiftClient) {
    super();
  }

  protected async _call(
    args: z.infer<typeof AttemptProgramSchema>,
  ): Promise<string> {
    const { readFile } = await import("node:fs/promises");

    try {
      const programBuffer = await readFile(args.programPath);

      const response = await this.client.submitProgramChallenge({
        slug: args.slug,
        programBuffer,
      });

      const text = await response.text();
      return JSON.stringify(
        {
          status: response.status,
          ok: response.ok,
          body: text,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to read program file: ${(error as Error).message}`,
        },
        null,
        2,
      );
    }
  }
}

const AttemptClientSchema = ChallengeSlugSchema.extend({
  transactionBase64: z
    .string()
    .min(1)
    .describe("Base64 encoded VersionedTransaction signed by the submitting wallet."),
});

class AttemptClientTool extends StructuredTool<typeof AttemptClientSchema> {
  name = "blueshift_attempt_client" as const;
  description =
    "Submits a client challenge attempt. Provide the challenge slug and a transaction payload.";
  schema = AttemptClientSchema;

  constructor(private readonly client: BlueshiftClient) {
    super();
  }

  protected async _call(
    args: z.infer<typeof AttemptClientSchema>,
  ): Promise<string> {
    const result = await this.client.submitClientChallenge({
      slug: args.slug,
      transactionBase64: args.transactionBase64,
    });

    return JSON.stringify(result, null, 2);
  }
}

const CreateAnchorProgramSchema = z.object({
  programName: z.string().min(1).describe("Name of the Anchor program"),
  cargoToml: z.string().min(1).describe("Complete Cargo.toml file content for the program"),
  libRs: z.string().min(1).describe("Complete lib.rs file content for the program"),
});

class CreateAnchorProgramTool extends StructuredTool<typeof CreateAnchorProgramSchema> {
  name = "anchor_create_program" as const;
  description =
    "Scaffolds an Anchor workspace using 'anchor init', replaces the generated lib.rs and Cargo.toml with provided content, builds with 'anchor build', and returns the workspace path and .so artifact. Provide the complete Cargo.toml and lib.rs file contents.";
  schema = CreateAnchorProgramSchema;

  protected async _call(
    args: z.infer<typeof CreateAnchorProgramSchema>,
  ): Promise<string> {
    const result = await createAnchorProgram({
      programName: args.programName,
      cargoToml: args.cargoToml,
      libRs: args.libRs,
    });

    return JSON.stringify(
      {
        workspaceDir: result.workspaceDir,
        files: result.files,
        build: result.build,
      },
      null,
      2,
    );
  }
}

const ReadFileSchema = z.object({
  filePath: z.string().describe("Absolute path to the file to read."),
});

class ReadFileTool extends StructuredTool<typeof ReadFileSchema> {
  name = "read_file" as const;
  description = "Reads the contents of a file from the filesystem. Use this to inspect generated Anchor files before modifying them.";
  schema = ReadFileSchema;

  protected async _call(args: z.infer<typeof ReadFileSchema>): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    try {
      const content = await readFile(args.filePath, "utf8");
      return content;
    } catch (error) {
      return `Error reading file: ${(error as Error).message}`;
    }
  }
}

const WriteFileSchema = z.object({
  filePath: z.string().describe("Absolute path to the file to write."),
  content: z.string().describe("Complete file content to write."),
});

class WriteFileTool extends StructuredTool<typeof WriteFileSchema> {
  name = "write_file" as const;
  description = "Writes content to a file, overwriting it completely. Use this to modify Anchor lib.rs, Cargo.toml, or other files in the scaffolded workspace.";
  schema = WriteFileSchema;

  protected async _call(args: z.infer<typeof WriteFileSchema>): Promise<string> {
    const { writeFile } = await import("node:fs/promises");
    try {
      await writeFile(args.filePath, args.content, "utf8");
      return `Successfully wrote ${args.content.length} bytes to ${args.filePath}`;
    } catch (error) {
      return `Error writing file: ${(error as Error).message}`;
    }
  }
}

const RunAnchorBuildSchema = z.object({
  workspaceDir: z.string().describe("Absolute path to the Anchor workspace directory."),
});

class RunAnchorBuildTool extends StructuredTool<typeof RunAnchorBuildSchema> {
  name = "run_anchor_build" as const;
  description = "Runs 'anchor build' in the specified workspace directory and returns the build output and path to the .so file.";
  schema = RunAnchorBuildSchema;

  protected async _call(args: z.infer<typeof RunAnchorBuildSchema>): Promise<string> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { readFile } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");

    const execFileAsync = promisify(execFile);

    try {
      const { stdout, stderr } = await execFileAsync("anchor", ["build"], {
        cwd: args.workspaceDir,
        env: process.env,
      });

      // Find the .so file
      const targetDeployDir = path.join(args.workspaceDir, "target", "deploy");
      const { readdir } = await import("node:fs/promises");

      if (existsSync(targetDeployDir)) {
        const files = await readdir(targetDeployDir);
        const soFiles = files.filter(f => f.endsWith(".so"));

        if (soFiles.length > 0) {
          const soPath = path.join(targetDeployDir, soFiles[0]);

          return JSON.stringify({
            success: true,
            stdout,
            stderr,
            soPath,
          }, null, 2);
        }
      }

      return JSON.stringify({
        success: true,
        stdout,
        stderr,
        message: "Build completed but .so file not found",
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        error: error.message,
      }, null, 2);
    }
  }
}

export function buildAgentTools(
  client: BlueshiftClient,
  wallet: SolanaWallet,
): StructuredTool[] {
  return [
    new GetWalletAddressTool(wallet),
    new SignBytesTool(wallet),
    new EncodeBase58Tool(wallet),
    new ListChallengesTool(client),
    new GetChallengeTool(client),
    new GetProgressTool(client),
    new AttemptProgramTool(client),
    new AttemptClientTool(client),
    new CreateAnchorProgramTool(),
    new ReadFileTool(),
    new WriteFileTool(),
    new RunAnchorBuildTool(),
  ];
}
