import fs from "node:fs";

const file = "automation/belanja-runner/copy-reconcile.ts";
let source = fs.readFileSync(file, "utf8");

const replacements = [
  [
    "async function verifyCopyModal(page: Page, claim: ClaimedBelanjaSyncJob) {",
    "async function verifyCopyModal(page: Page, config: RunnerConfig, claim: ClaimedBelanjaSyncJob) {",
  ],
  [
    "const modal = await verifyCopyModal(page, claim);",
    "const modal = await verifyCopyModal(page, config, claim);",
  ],
];

for (const [before, after] of replacements) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected 1 occurrence of ${before}, found ${count}`);
  source = source.replace(before, after);
}

fs.writeFileSync(file, source);
console.log(`Fixed config propagation in ${file}`);
