function normalizeLine(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function splitPaymentDateLine(line: string) {
  if (!/^Pembayaran\b/i.test(line)) return null;
  const dateMatch = /\s+Tanggal\b/i.exec(line);
  if (!dateMatch || dateMatch.index < 1) return null;

  const payment = line.slice(0, dateMatch.index).trim();
  // Keep natural prose such as "... pada tanggal ..." intact.
  if (/\bpada$/i.test(payment)) return null;

  return [payment, line.slice(dateMatch.index + 1).trim()] as const;
}

function isDateLine(line: string) {
  return /^Tanggal\b/i.test(line);
}

function isPaymentContextLine(line: string) {
  return /^(?:Pembangunan\b|KDKMP\b|Pekerjaan\s+Tahap\b|Tahap\b)/i.test(line);
}

const PURPOSE_SOFT_LINE_LIMIT = 72;

function splitLongPurposeLine(line: string, maxLines: number) {
  if (maxLines < 2 || line.length <= PURPOSE_SOFT_LINE_LIMIT) return [line];

  const pembangunanMatch = /\s+(Pembangunan\b.+)$/i.exec(line);
  if (pembangunanMatch?.index && pembangunanMatch.index > 20) {
    return [
      line.slice(0, pembangunanMatch.index).trim(),
      pembangunanMatch[1].trim(),
    ];
  }

  const dateMatch = /\s+(pada\s+tanggal\b.+)$/i.exec(line);
  if (dateMatch?.index && dateMatch.index > 20) {
    return [
      line.slice(0, dateMatch.index).trim(),
      dateMatch[1].trim(),
    ];
  }

  const words = line.split(/\s+/);
  const target = Math.ceil(line.length / 2);
  let splitAt = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let length = 0;
  for (let index = 0; index < words.length - 1; index += 1) {
    length += words[index].length + (index === 0 ? 0 : 1);
    const distance = Math.abs(length - target);
    if (distance < bestDistance) {
      splitAt = index + 1;
      bestDistance = distance;
    }
  }

  return [
    words.slice(0, splitAt).join(" "),
    words.slice(splitAt).join(" "),
  ].filter(Boolean);
}

/**
 * Produce at most two semantic rows so each payment sentence can sit on the
 * two ruled lines available in the scanned kwitansi template.
 */
export function layoutKwitansiPurposeLines(sourceLines: readonly string[], maxLines = 2) {
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new Error("Jumlah baris pembayaran harus lebih dari 0.");
  }

  const expanded = sourceLines
    .map(normalizeLine)
    .filter(Boolean)
    .flatMap((line) => splitPaymentDateLine(line) ?? [line]);
  const composed: string[] = [];

  for (let index = 0; index < expanded.length; index += 1) {
    const line = expanded[index];
    const next = expanded[index + 1];
    if (isDateLine(line) && next && isPaymentContextLine(next)) {
      composed.push(`${line} - ${next}`);
      index += 1;
    } else {
      composed.push(line);
    }
  }

  if (composed.length === 1) {
    return splitLongPurposeLine(composed[0], maxLines);
  }

  if (composed.length <= maxLines) return composed;
  return [
    ...composed.slice(0, maxLines - 1),
    composed.slice(maxLines - 1).join(" - "),
  ];
}
