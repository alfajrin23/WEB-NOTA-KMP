type DryRunConfig = {
  dryRun: boolean;
};

type DryRunJob = {
  dryRun?: boolean | null;
};

type FieldMapConfig = {
  fieldMapVerified: boolean;
};

type FieldMapJob = {
  metadataJson?: Record<string, unknown> | null;
};

export function resolveEffectiveDryRun(config: DryRunConfig, job: DryRunJob) {
  return job.dryRun ?? config.dryRun;
}

function metadataBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return false;
}

export function resolveEffectiveFieldMapVerified(config: FieldMapConfig, job: FieldMapJob) {
  if (config.fieldMapVerified) return true;
  const metadata = job.metadataJson ?? {};
  return metadataBoolean(metadata.field_map_verified)
    || metadataBoolean(metadata.fieldMapVerified)
    || metadataBoolean(metadata.belanja_field_map_verified);
}
