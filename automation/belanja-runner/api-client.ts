import type {
  BelanjaRunnerHeartbeat,
  ClaimedBelanjaSyncItem,
} from "../../src/lib/belanja-sync/types";
import type { RunnerConfig } from "./config";

export class BelanjaSyncApiClient {
  constructor(private readonly config: RunnerConfig) {}

  private async request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const url = new URL(path, this.config.notaKmpBaseUrl).toString();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.auth !== false) {
      if (!this.config.runnerToken) throw new Error("BELANJA_RUNNER_TOKEN belum diisi di env lokal runner.");
      headers.Authorization = `Bearer ${this.config.runnerToken}`;
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  }

  heartbeat(input: {
    status: BelanjaRunnerHeartbeat["status"];
    targetStatus: BelanjaRunnerHeartbeat["targetStatus"];
    dryRun: boolean;
    targetBaseUrl: string;
    message?: string | null;
  }) {
    return this.request<{ heartbeat: BelanjaRunnerHeartbeat }>("/api/belanja-runner/heartbeat", {
      method: "POST",
      body: {
        runnerId: this.config.runnerId,
        ...input,
      },
    });
  }

  async pendingCount() {
    const overview = await this.request<{
      projects?: Array<{ pendingItems: number }>;
    }>("/api/belanja-sync/overview", { auth: false });
    return (overview.projects ?? []).reduce((sum, project) => sum + project.pendingItems, 0);
  }

  claim() {
    return this.request<{ claim: ClaimedBelanjaSyncItem | null }>("/api/belanja-runner/claim", {
      method: "POST",
      body: { runnerId: this.config.runnerId },
    });
  }

  markSuccess(itemId: string, input: {
    targetReference?: string | null;
    dryRun?: boolean;
    metadataJson?: Record<string, unknown>;
  }) {
    return this.request(`/api/belanja-runner/items/${itemId}/success`, {
      method: "POST",
      body: {
        runnerId: this.config.runnerId,
        ...input,
      },
    });
  }

  markFailed(itemId: string, input: {
    errorMessage: string;
    retryable?: boolean;
    metadataJson?: Record<string, unknown>;
  }) {
    return this.request(`/api/belanja-runner/items/${itemId}/failed`, {
      method: "POST",
      body: {
        runnerId: this.config.runnerId,
        ...input,
      },
    });
  }
}
