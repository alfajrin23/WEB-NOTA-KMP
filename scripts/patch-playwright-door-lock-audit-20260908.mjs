import fs from 'node:fs';

const file = 'automation/belanja-runner/copy-reconcile.ts';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(from, to, label) {
  if (!source.includes(from)) throw new Error(`Patch anchor not found: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
`type LookupBelanjaItem = {
  uuid: string;
  nama?: string | null;
  spesifikasi?: string | null;
  satuan?: string | null;
};`,
`type LookupBelanjaItem = {
  uuid: string;
  nama?: string | null;
  spesifikasi?: string | null;
  satuan?: string | null;
  hargaSatuan?: number | null;
};`,
'lookup type',
);

replaceOnce(`const FINAL_BUDGET_REPAIR_MAX_PASSES = 2;`, `const FINAL_BUDGET_REPAIR_MAX_PASSES = 4;`, 'budget repair passes');

replaceOnce(
`function unitIdentity(value: string | null | undefined) {
  const normalized = normalizeIdentityPart(value?.normalize("NFKC"));
  const aliases: Record<string, string> = { ltr: "liter", lt: "liter", btg: "batang", bh: "buah", lbr: "lembar", roll: "rol", truk: "truck" };
  return aliases[normalized] ?? normalized;
}`,
`function unitIdentity(value: string | null | undefined) {
  const normalized = normalizeIdentityPart(value?.normalize("NFKC"));
  const aliases: Record<string, string> = {
    ltr: "liter", lt: "liter", liter: "liter",
    btg: "batang", batang: "batang",
    pcs: "piece", pc: "piece", piece: "piece", bh: "piece", buah: "piece",
    lbr: "lembar", lembar: "lembar", roll: "rol", truk: "truck", truck: "truck",
  };
  return aliases[normalized] ?? normalized;
}

function lookupItemPrice(item: LookupBelanjaItem) {
  const numeric = Number(item.hargaSatuan);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizedSpecification(item: LookupBelanjaItem) {
  return normalizeIdentityPart(item.spesifikasi);
}

function doorLockSpecificationScore(item: LookupBelanjaItem, expected: "pvc" | "standard") {
  const specification = normalizedSpecification(item);
  const name = normalizeIdentityPart(item.nama);
  const combined = `${name}${specification}`;
  if (expected === "pvc") {
    if (specification === "pvc") return 900;
    if (combined.includes("pvc")) return 700;
    return 0;
  }
  if (/^(standar|standard|standart|setandar)$/.test(specification)) return 900;
  if (/(standar|standard|standart|setandar)/.test(combined)) return 700;
  if (!specification && /^kuncipintu(?:pcs|piece|buah|bh)?$/.test(name)) return 450;
  return 0;
}`,
'unit identity',
);

const oldResolver = `export function findLookupItemForLine(items: LookupBelanjaItem[], line: BelanjaTransactionLine, kind: BelanjaTransactionKind) {
  const expectedDoorLock = kind === "material" ? doorLockVariant(line.namaItem) : null;
  const matches = items.filter((item) => {
    const label = detailLookupLabel(kind, item);
    if (expectedDoorLock) {
      // For Kunci Pintu, always map from the complete lookup label so target
      // specifications such as PVC vs Standar are part of the identity.
      return doorLockVariant(label) === expectedDoorLock;
    }
    return detailNamesMatch(label, line.namaItem) || detailNamesMatch(item.nama ?? "", line.namaItem);
  });
  if (matches.length === 0) {
    throw new Error(\`Opsi target untuk "\${line.namaItem}" tidak ditemukan pada lookup \${kind}.\`);
  }
  const specification = (item: LookupBelanjaItem) => normalizeIdentityPart(item.spesifikasi).replace(/^(standar|standard|standart|setandar)$/, "");
  const ranked = matches.map((item) => ({ item,
    score: (normalizeIdentityPart(item.nama) === normalizeIdentityPart(line.namaItem) ? 1000 : 0)
      + (unitIdentity(item.satuan) === unitIdentity(line.satuan) ? 200 : 0)
      + (!specification(item) ? 50 : 0),
  })).sort((a, b) => b.score - a.score || a.item.uuid.localeCompare(b.item.uuid));
  const semanticKey = (item: LookupBelanjaItem) => [normalizeIdentityPart(item.nama), unitIdentity(item.satuan), specification(item)].join("|");
  if (ranked.some((candidate) => candidate.score === ranked[0].score && semanticKey(candidate.item) !== semanticKey(ranked[0].item))) {
    throw new Error(\`Opsi target ambigu untuk \${line.namaItem}; spesifikasi/satuan kandidat berbeda.\`);
  }
  return ranked[0].item;
}`;

const newResolver = `export function findLookupItemForLine(items: LookupBelanjaItem[], line: BelanjaTransactionLine, kind: BelanjaTransactionKind) {
  const expectedDoorLock = kind === "material" ? doorLockVariant(line.namaItem) : null;
  const matches = items.filter((item) => {
    const label = detailLookupLabel(kind, item);
    if (expectedDoorLock) return doorLockVariant(label) === expectedDoorLock;
    return detailNamesMatch(label, line.namaItem) || detailNamesMatch(item.nama ?? "", line.namaItem);
  });
  if (matches.length === 0) {
    throw new Error(\`Opsi target untuk "\${line.namaItem}" tidak ditemukan pada lookup \${kind}.\`);
  }

  const expectedUnit = unitIdentity(line.satuan);
  const expectedPrice = Number(line.hargaSatuan);
  const ranked = matches.map((item) => {
    const itemPrice = lookupItemPrice(item);
    const itemUnit = unitIdentity(item.satuan);
    const priceExact = itemPrice != null && Number.isFinite(expectedPrice) && Math.abs(itemPrice - expectedPrice) <= 0.01;
    const unitExact = Boolean(expectedUnit) && itemUnit === expectedUnit;
    const fullLabel = detailLookupLabel(kind, item);
    const exactName = normalizeIdentityPart(item.nama) === normalizeIdentityPart(line.namaItem);
    const exactLabel = normalizeIdentityPart(fullLabel) === normalizeIdentityPart(line.namaItem);
    const variantScore = expectedDoorLock ? doorLockSpecificationScore(item, expectedDoorLock) : 0;
    const score = (exactName ? 1800 : 0)
      + (exactLabel ? 1400 : 0)
      + (priceExact ? 2200 : itemPrice == null ? 0 : -1200)
      + (unitExact ? 600 : expectedUnit && itemUnit ? -500 : 0)
      + variantScore;
    return { item, score, itemPrice, itemUnit, variantScore };
  }).sort((a, b) => b.score - a.score || b.variantScore - a.variantScore || a.item.uuid.localeCompare(b.item.uuid));

  const best = ranked[0];
  const tied = ranked.filter((candidate) => candidate.score === best.score);
  if (tied.length > 1) {
    if (expectedDoorLock) {
      const businessKey = (candidate: typeof best) => [
        expectedDoorLock,
        candidate.itemUnit || expectedUnit,
        candidate.itemPrice ?? expectedPrice,
      ].join("|");
      if (new Set(tied.map(businessKey)).size === 1) return tied[0].item;
    }
    const semanticKey = (candidate: typeof best) => [
      normalizeIdentityPart(candidate.item.nama),
      candidate.itemUnit,
      normalizedSpecification(candidate.item),
      candidate.itemPrice ?? "",
    ].join("|");
    if (new Set(tied.map(semanticKey)).size > 1) {
      throw new Error(\`Opsi target ambigu untuk \${line.namaItem}; kandidat terbaik masih berbeda pada nama/spesifikasi/satuan/harga.\`);
    }
  }
  return best.item;
}`;
replaceOnce(oldResolver, newResolver, 'lookup resolver');

replaceOnce(
`      satuan: item.satuan || '',
    })) : [];`,
`      satuan: item.satuan || '',
      hargaSatuan: (() => {
        const raw = item.harga_satuan ?? item.hargaSatuan ?? item.harga ?? item.price ?? null;
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric : null;
      })(),
    })) : [];`,
'lookup fetch price',
);

replaceOnce(
`  if (ranked.length > 1 && ranked[0].score === ranked[1].score && !options.allowDuplicateNames) {
    throw new Error(\`Item ambigu: \${expected.namaItem}. Kandidat: \${ranked.filter((item) => item.score === ranked[0].score).map((item) => JSON.stringify(item.line)).join(" | ")}\`);
  }
  const match = ranked[0].line;`,
`  if (ranked.length > 1 && ranked[0].score === ranked[1].score && !options.allowDuplicateNames) {
    const tied = ranked.filter((item) => item.score === ranked[0].score);
    const semanticKey = (item: typeof tied[number]) => [
      detailNameBase(item.line.name), unitIdentity(item.line.unit), item.line.qty ?? "", item.line.unitPrice ?? "",
      item.line.subtotal ?? "", item.line.paymentDate ?? "", normalizeIdentityPart(item.line.recipient),
    ].join("|");
    if (new Set(tied.map(semanticKey)).size > 1) {
      throw new Error(\`Item ambigu: \${expected.namaItem}. Kandidat: \${tied.map((item) => JSON.stringify(item.line)).join(" | ")}\`);
    }
  }
  const match = ranked[0].line;`,
'matchLine tie',
);

replaceOnce(
`  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].option.value !== ranked[1].option.value) {
    throw new Error(\`Opsi "\${expectedText}" ambigu pada dropdown \${selectId}: \${ranked.slice(0, 5).map((entry) => entry.option.text).join(" | ")}.\`);
  }

  await select.selectOption({ value: ranked[0].option.value }, { timeout: 2_000 });`,
`  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].option.value !== ranked[1].option.value) {
    const tied = ranked.filter((entry) => entry.score === ranked[0].score);
    const normalizedLabels = new Set(tied.map((entry) => normalizeIdentityPart(entry.option.text)));
    if (normalizedLabels.size > 1) {
      throw new Error(\`Opsi "\${expectedText}" ambigu pada dropdown \${selectId}: \${tied.slice(0, 5).map((entry) => entry.option.text).join(" | ")}.\`);
    }
  }

  await select.selectOption({ value: ranked[0].option.value }, { timeout: 2_000 });`,
'generic dropdown tie',
);

fs.writeFileSync(file, source);

const testFile = 'tests/iii05-door-lock-mapping.test.mjs';
let testSource = fs.readFileSync(testFile, 'utf8');
testSource += `\n\ntest("door-lock lookup normalizes Pcs and Buah and resolves duplicate Standard metadata", () => {\n  const targetLookup = [\n    { uuid: "std-a", nama: "Kunci Pintu", spesifikasi: "Standar", satuan: "Buah", hargaSatuan: 35000 },\n    { uuid: "std-b", nama: "Kunci Pintu", spesifikasi: "Standard", satuan: "Pcs", hargaSatuan: 35000 },\n    { uuid: "std-wrong-price", nama: "Kunci Pintu", spesifikasi: "Standar premium", satuan: "Buah", hargaSatuan: 50000 },\n    { uuid: "pvc", nama: "Kunci Pintu", spesifikasi: "PVC", satuan: "Buah", hargaSatuan: 5000 },\n  ];\n  const resolved = findLookupItemForLine(targetLookup, line("Kunci Pintu (Standar) - Pcs", 35000), "material");\n  assert.ok(["std-a", "std-b"].includes(resolved.uuid));\n  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu PVC", 5000), "material").uuid, "pvc");\n});\n\ntest("door-lock lookup uses price when target exposes multiple same-variant candidates", () => {\n  const targetLookup = [\n    { uuid: "std-correct", nama: "Kunci Pintu", spesifikasi: "Standar", satuan: "Buah", hargaSatuan: 35000 },\n    { uuid: "std-other", nama: "Kunci Pintu", spesifikasi: "Standar", satuan: "Buah", hargaSatuan: 45000 },\n  ];\n  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu (Standar) - Pcs", 35000), "material").uuid, "std-correct");\n});\n`;
fs.writeFileSync(testFile, testSource);

const packageFile = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
pkg.scripts['test:door-lock'] = 'tsx --test tests/iii05-door-lock-mapping.test.mjs';
pkg.scripts['test:playwright-matching'] = 'tsx --test tests/playwright-robust-matching.test.mjs';
pkg.scripts['test:acceptance'] = 'npm run test:nota-order && npm run test:kwitansi-sync && npm run test:kdkmp && npm run test:belanja-sync && npm run test:door-lock && npm run test:playwright-matching && npm run test:print-layout && npm run test:date-shift';
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('PATCH_OK');
