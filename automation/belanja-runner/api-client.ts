import type {
  BelanjaRunnerHeartbeat,
  ClaimedBelanjaSyncItem,
} from "../../src/lib/belanja-sync/types";
import type { RunnerConfig } from "./config";

export class BelanjaSyncApiClient {
  constructor(private readonly config: RunnerConfig) {}

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableStatus(status: number) {
    return status === 408 || status === 429 || status >= 500;
  }

  private isRetryableError(error: unknown) {
    if (!(error instanceof Error)) return false;
    return /abort|timeout|fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(error.message);
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const url = new URL(path, this.config.notaKmpBaseUrl).toString();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.auth !== false) {
      if (!this.config.runnerToken) throw new Error("RUNNER_TOKEN belum diisi di env lokal runner.");
      headers.Authorization = `Bearer ${this.config.runnerToken}`;
    }

    const attempts = Math.max(1, this.config.apiRequestRetries + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.apiRequestTimeoutMs);
      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) return payload as T;

        const message = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
        const error = new Error(message);
        lastError = error;
        if (!this.isRetryableStatus(response.status) || attempt >= attempts) throw error;
      } catch (error) {
        lastError = error;
        if (!this.isRetryableError(error) || attempt >= attempts) throw error;
      } finally {
        clearTimeout(timeout);
      }

      await this.sleep(Math.min(1000 * attempt, 5000));
    }

    throw lastError instanceof Error ? lastError : new Error("Request WEB NOTA gagal.");
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
