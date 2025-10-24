import { VersionedTransaction } from "@solana/web3.js";
import { SolanaWallet } from "./solana.js";

interface ChallengeSummary {
  slug: string;
  name: string;
  category: string;
  challenge_type: "program" | "client";
  submission_endpoint: string;
  problem_description: string;
}

interface ChallengeListResponse {
  challenges: ChallengeSummary[];
}

interface ChallengeDetailResponse {
  challenge: ChallengeSummary;
}

interface ProgressEntry extends ChallengeSummary {
  attempt_count: number;
  completed: boolean;
  latest_attempt?: {
    passed: boolean;
    cu_consumed: number | null;
    binary_size: number | null;
    attempt_time: string;
  } | null;
}

interface ProgressResponse {
  agent: {
    agent_name: string;
    team: string;
    address: string;
    model: string | null;
    registered_at: string;
  } | null;
  challenges: ProgressEntry[];
}

export type ProgramSubmissionInput = {
  slug: string;
  programBuffer: Uint8Array;
};

export type ClientSubmissionInput = {
  slug: string;
  transactionBase64?: string;
  transaction?: VersionedTransaction;
};

type ClientSubmissionSuccess = {
  success: boolean;
  results: Array<{
    success: boolean;
    instruction: string;
    compute_units_consumed: number;
    execution_time: number;
    program_logs: unknown[];
    account?: string;
    message?: string;
  }>;
};

type ClientSubmissionError = {
  error: string;
  message: string;
};

export type ClientSubmissionResponse =
  | { ok: true; status: number; body: ClientSubmissionSuccess }
  | { ok: false; status: number; body: ClientSubmissionError };

export class BlueshiftClient {
  constructor(
    private readonly baseUrl: string,
    private readonly wallet: SolanaWallet,
  ) {}

  private endpoint(pathname: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${pathname}`;
  }

  async listChallenges(): Promise<ChallengeSummary[]> {
    const res = await fetch(this.endpoint("/v1/challenges"));
    if (!res.ok) {
      throw new Error(`Failed to list challenges: ${res.status} ${res.statusText}`);
    }
    const payload = (await res.json()) as ChallengeListResponse;
    return payload.challenges;
  }

  async getChallenge(namespace: string, key: string): Promise<ChallengeSummary> {
    const res = await fetch(
      this.endpoint(`/v1/challenges/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`),
    );
    if (!res.ok) {
      throw new Error(
        `Failed to fetch challenge ${namespace}/${key}: ${res.status} ${res.statusText}`,
      );
    }
    const payload = (await res.json()) as ChallengeDetailResponse;
    return payload.challenge;
  }

  async getProgress(address = this.wallet.address): Promise<ProgressResponse> {
    const res = await fetch(
      this.endpoint(`/v1/agents/${encodeURIComponent(address)}/progress`),
    );
    if (res.status === 404) {
      return { agent: null, challenges: [] };
    }
    if (!res.ok) {
      throw new Error(
        `Failed to fetch agent progress: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as ProgressResponse;
  }

  async submitProgramChallenge({
    slug,
    programBuffer,
  }: ProgramSubmissionInput): Promise<Response> {
    const target = this.endpoint(
      `/v1/challenges/program/${encodeURIComponent(slug)}`,
    );

    const fileName = `${slug}-submission.so`;
    const signatureBase58 = this.wallet.signBase58(programBuffer);

    const formData = new FormData();
    formData.append("program", new Blob([Buffer.from(programBuffer)]), fileName);
    formData.append("signature", signatureBase58);
    formData.append("address", this.wallet.address);

    return fetch(target, {
      method: "POST",
      body: formData,
    });
  }

  async submitClientChallenge({
    slug,
    transactionBase64,
    transaction,
  }: ClientSubmissionInput): Promise<ClientSubmissionResponse> {
    const target = this.endpoint(
      `/v1/challenges/client/${encodeURIComponent(slug)}`,
    );

    const serializedTransactionBase64 = this.resolveTransactionBase64({
      transactionBase64,
      transaction,
    });

    const body = {
      transaction: serializedTransactionBase64,
      address: this.wallet.address,
    };

    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await this.parseJsonSafe(response);

    if (response.ok && this.isClientSubmissionSuccess(payload)) {
      return {
        ok: true,
        status: response.status,
        body: payload,
      };
    }

    const errorBody = this.isClientSubmissionError(payload)
      ? payload
      : {
          error: "Invalid response",
          message: typeof payload === "object" ? JSON.stringify(payload) : String(payload),
        } satisfies ClientSubmissionError;

    return {
      ok: false,
      status: response.status,
      body: errorBody,
    };
  }

  private resolveTransactionBase64({
    transactionBase64,
    transaction,
  }: Pick<ClientSubmissionInput, "transactionBase64" | "transaction">): string {
    if (transactionBase64) {
      return transactionBase64;
    }

    if (!transaction) {
      throw new Error(
        "Client submission requires either a pre-signed transactionBase64 or a VersionedTransaction instance",
      );
    }

    return this.wallet.signAndEncodeTransaction(transaction);
  }

  private async parseJsonSafe(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return { error: "Invalid response", message: await response.text() } satisfies ClientSubmissionError;
    }

    try {
      return await response.json();
    } catch (error) {
      return { error: "Invalid JSON", message: (error as Error).message } satisfies ClientSubmissionError;
    }
  }

  private isClientSubmissionSuccess(payload: unknown): payload is ClientSubmissionSuccess {
    if (!payload || typeof payload !== "object") {
      return false;
    }
    const candidate = payload as Partial<ClientSubmissionSuccess>;
    return (
      typeof candidate.success === "boolean" &&
      Array.isArray(candidate.results)
    );
  }

  private isClientSubmissionError(payload: unknown): payload is ClientSubmissionError {
    if (!payload || typeof payload !== "object") {
      return false;
    }
    const candidate = payload as Partial<ClientSubmissionError>;
    return typeof candidate.error === "string" && typeof candidate.message === "string";
  }
}
