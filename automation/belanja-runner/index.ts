import { getRunnerConfig } from "./config";
import { checkTargetReachability, inspectBelanjaTarget, runBelanjaRunner } from "./runner";

async function main() {
  const config = getRunnerConfig();
  const command = process.argv[2] ?? "run";

  if (command === "check") {
    const targetCheck = await checkTargetReachability(config);
    console.log(JSON.stringify({
      target: config.targetBaseUrl,
      targetHealthPath: config.targetHealthPath,
      targetCheck,
      reachable: targetCheck.reachable,
      dryRun: config.dryRun,
      headed: config.headed,
      fieldMapVerified: config.fieldMapVerified,
      hasRunnerToken: Boolean(config.runnerToken),
      hasTargetCredential: Boolean(config.targetEmail && config.targetPassword),
    }, null, 2));
    return;
  }

  if (command === "inspect") {
    await inspectBelanjaTarget(config);
    return;
  }

  await runBelanjaRunner(config, { once: process.argv.includes("--once") });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Belanja runner gagal.");
  process.exit(1);
});
