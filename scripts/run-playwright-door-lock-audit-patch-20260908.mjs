import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const patcher = 'scripts/patch-playwright-door-lock-audit-20260908.mjs';
let patcherSource = fs.readFileSync(patcher, 'utf8');
patcherSource = patcherSource.replace('  const combined = `${name}${specification}`;', '  const combined = name + specification;');
fs.writeFileSync(patcher, patcherSource);

await import(`${pathToFileURL(process.cwd() + '/' + patcher).href}?t=${Date.now()}`);

const target = 'automation/belanja-runner/copy-reconcile.ts';
let source = fs.readFileSync(target, 'utf8');
const oldBlock = `    if (new Set(tied.map(semanticKey)).size > 1) {
      throw new Error(\`Item ambigu: \${expected.namaItem}. Kandidat: \${tied.map((item) => JSON.stringify(item.line)).join(" | ")}\`);
    }`;
const newBlock = `    const hasBusinessEvidence = tied.every((item) => Boolean(
      item.line.unit || item.line.qty != null || item.line.unitPrice != null || item.line.subtotal != null
      || item.line.paymentDate || item.line.recipient
    ));
    if (!hasBusinessEvidence || new Set(tied.map(semanticKey)).size > 1) {
      throw new Error(\`Item ambigu: \${expected.namaItem}. Kandidat: \${tied.map((item) => JSON.stringify(item.line)).join(" | ")}\`);
    }`;
if (!source.includes(oldBlock)) throw new Error('matchLine evidence anchor not found');
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(target, source);
console.log('AUDIT_PATCH_OK');
