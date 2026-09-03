function normalized(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function cleanRole(value: string) {
  return value
    .replace(/\s*\(.+?\)\s*/g, "")
    .replace(/^pek\.\s*/i, "Pekerjaan ")
    .replace(/\btrampil\b/gi, "Terampil")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanKwitansiWorkerRole(value: string | undefined | null) {
  const role = cleanRole(value ?? "");
  if (!role) return "";

  const withoutOvertime = normalized(role)
    .replace(/\blembur\b/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  if (withoutOvertime === "mandor") return "Mandor";
  if (withoutOvertime === "kepala tukang") return "Kepala Tukang";
  if (withoutOvertime === "tukang") return "Tukang";
  if (
    withoutOvertime === "kuli/kenek" ||
    withoutOvertime === "kenek/kuli" ||
    withoutOvertime === "kuli kenek" ||
    withoutOvertime === "kenek kuli"
  ) return "Kuli/Kenek";

  return role;
}
