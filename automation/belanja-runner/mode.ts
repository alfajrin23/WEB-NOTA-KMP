type DryRunConfig = {
  dryRun: boolean;
};

type DryRunJob = {
  dryRun?: boolean | null;
};

export function resolveEffectiveDryRun(config: DryRunConfig, job: DryRunJob) {
  return job.dryRun ?? config.dryRun;
}
