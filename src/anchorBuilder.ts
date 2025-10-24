import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CreateAnchorProgramOptions {
  programName: string;
  cargoToml: string;
  libRs: string;
}

export interface AnchorBuildResult {
  success: boolean;
  stdout: string;
  stderr: string;
  programSoPath?: string;
  programSoBase64?: string;
  keypairPath?: string;
  errorMessage?: string;
}

export interface CreatedAnchorProgram {
  workspaceDir: string;
  files: Array<{ path: string; content: string }>;
  build?: AnchorBuildResult;
}

function sanitizeProgramName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "anchor_program";
}

function toKebabCase(name: string): string {
  return sanitizeProgramName(name).replace(/_/g, "-");
}

export async function createAnchorProgram(
  options: CreateAnchorProgramOptions,
): Promise<CreatedAnchorProgram> {
  const programDirName = toKebabCase(options.programName);
  const crateName = sanitizeProgramName(options.programName);

  const outputRoot = path.resolve(process.cwd(), path.join("artifacts", "anchor"));
  if (!existsSync(outputRoot)) {
    await mkdir(outputRoot, { recursive: true });
  }

  // Create unique slug with random strings
  const slug = `${programDirName}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const workspaceDir = path.join(outputRoot, slug);

  // Use anchor init to scaffold the project
  try {
    await execFileAsync("anchor", ["init", slug], {
      cwd: outputRoot,
      env: process.env,
    });
  } catch (error) {
    const execError = error as ExecFileException & {
      stdout?: string;
      stderr?: string;
    };
    throw new Error(`Failed to scaffold Anchor project: ${execError.message}\n${execError.stderr ?? ""}`);
  }

  const files: Array<{ path: string; content: string }> = [];

  // Replace the generated lib.rs with provided content
  const programDir = path.join(workspaceDir, "programs", slug);
  const srcDir = path.join(programDir, "src");
  const libRsPath = path.join(srcDir, "lib.rs");

  await writeFile(libRsPath, options.libRs, "utf8");
  files.push({ path: path.relative(workspaceDir, libRsPath), content: options.libRs });

  // Replace the generated Cargo.toml with provided content
  const programCargoPath = path.join(programDir, "Cargo.toml");
  await writeFile(programCargoPath, options.cargoToml, "utf8");
  files.push({ path: path.relative(workspaceDir, programCargoPath), content: options.cargoToml });

  // Build the program
  let build: AnchorBuildResult | undefined;

  try {
    const { stdout, stderr } = await execFileAsync("anchor", ["build"], {
      cwd: workspaceDir,
      env: process.env,
    });

    const programSoPath = path.join(
      workspaceDir,
      "target",
      "deploy",
      `${slug}.so`,
    );
    const keypairPath = path.join(
      workspaceDir,
      "target",
      "deploy",
      `${slug}-keypair.json`,
    );

    const hasSo = existsSync(programSoPath);
    const hasKeypair = existsSync(keypairPath);

    let programSoBase64: string | undefined;
    if (hasSo) {
      const soBytes = await readFile(programSoPath);
      programSoBase64 = soBytes.toString("base64");
    }

    build = {
      success: true,
      stdout,
      stderr,
      programSoPath: hasSo ? programSoPath : undefined,
      programSoBase64,
      keypairPath: hasKeypair ? keypairPath : undefined,
    };
  } catch (error) {
    const execError = error as ExecFileException & {
      stdout?: string;
      stderr?: string;
    };

    const programSoPath = path.join(
      workspaceDir,
      "target",
      "deploy",
      `${slug}.so`,
    );

    const hasSo = existsSync(programSoPath);
    let programSoBase64: string | undefined;
    if (hasSo) {
      const soBytes = await readFile(programSoPath);
      programSoBase64 = soBytes.toString("base64");
    }

    build = {
      success: false,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      errorMessage: execError.message,
      programSoPath: hasSo ? programSoPath : undefined,
      programSoBase64,
    };
  }

  return {
    workspaceDir,
    files,
    build,
  };
}
