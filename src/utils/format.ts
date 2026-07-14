export function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2,
  }).format(value);
}

const units = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];

function spellUnderThousand(value: number): string {
  if (value < 12) return units[value];
  if (value < 20) return `${spellUnderThousand(value - 10)} Belas`;
  if (value < 100) return `${spellUnderThousand(Math.floor(value / 10))} Puluh ${spellUnderThousand(value % 10)}`.trim();
  if (value < 200) return `Seratus ${spellUnderThousand(value - 100)}`.trim();
  return `${spellUnderThousand(Math.floor(value / 100))} Ratus ${spellUnderThousand(value % 100)}`.trim();
}

export function terbilangRupiah(value: number) {
  const integer = Math.floor(Math.abs(value));
  if (integer === 0) return "Nol Rupiah";

  const groups = [
    { value: 1_000_000_000_000, label: "Triliun" },
    { value: 1_000_000_000, label: "Milyar" },
    { value: 1_000_000, label: "Juta" },
    { value: 1_000, label: "Ribu" },
  ];

  let rest = integer;
  const parts: string[] = [];

  for (const group of groups) {
    const count = Math.floor(rest / group.value);
    if (count > 0) {
      if (group.value === 1_000 && count === 1) parts.push("Seribu");
      else parts.push(`${spellUnderThousand(count)} ${group.label}`);
      rest %= group.value;
    }
  }

  if (rest > 0) parts.push(spellUnderThousand(rest));
  return `${parts.join(" ").replace(/\s+/g, " ").trim()} Rupiah`;
}

export function getAmount(volume: number, unitPrice: number) {
  return Math.round((Number(volume) || 0) * (Number(unitPrice) || 0));
}
