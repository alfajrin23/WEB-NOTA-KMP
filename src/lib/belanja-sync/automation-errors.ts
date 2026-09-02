export type BelanjaAutomationPhase = "fill" | "read" | "screenshot" | "submit" | "unknown";

export class BelanjaAutomationItemError extends Error {
  retryable: boolean;
  resetSession: boolean;
  metadataJson: Record<string, unknown>;

  constructor(message: string, options: {
    retryable: boolean;
    resetSession: boolean;
    metadataJson?: Record<string, unknown>;
  }) {
    super(message);
    this.name = "BelanjaAutomationItemError";
    this.retryable = options.retryable;
    this.resetSession = options.resetSession;
    this.metadataJson = options.metadataJson ?? {};
  }
}

export function isPlaywrightTargetClosedError(message: string) {
  return /target (?:page, context or browser )?has been closed|target closed|page closed|context closed|browser has been closed|browser has disconnected/i.test(message);
}

export function classifyBelanjaAutomationError(error: unknown, input: {
  phase?: BelanjaAutomationPhase;
  dryRun?: boolean;
}) {
  const message = error instanceof Error ? error.message : "Automation item gagal.";
  const phase = input.phase ?? "unknown";
  const targetClosed = isPlaywrightTargetClosedError(message);
  const transient = targetClosed || /timeout|network|navigation|unreachable|net::err_|econnreset|socket hang up/i.test(message);
  const submitMayHaveReachedTarget = phase === "submit" && input.dryRun !== true;

  return new BelanjaAutomationItemError(message, {
    retryable: transient && !submitMayHaveReachedTarget,
    resetSession: targetClosed,
    metadataJson: {
      automation_phase: phase,
      target_closed: targetClosed,
      transient,
      duplicate_check_required: submitMayHaveReachedTarget && transient,
    },
  });
}
