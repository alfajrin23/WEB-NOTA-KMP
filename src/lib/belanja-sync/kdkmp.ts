import type { Project } from "../../types/domain";
import { normalizeBelanjaText } from "./payload";
import type { KdkmpIdentity } from "./types";

export const SOURCE_KDKMP: Required<Pick<KdkmpIdentity, "province" | "regency" | "district" | "village">> = {
  province: "Jawa Barat",
  regency: "Cianjur",
  district: "Karangtengah",
  village: "Maleber",
};

const REGION_PREFIX_PATTERN = /^(provinsi|prov\.|kabupaten|kab\.|kota|kecamatan|kec\.|desa|des\.|kelurahan|kel\.)\s+/i;
const COOPERATIVE_PREFIX_PATTERN = /^koperasi(?:\s+(?:desa|kelurahan))?\s+/i;

export function normalizeKdkmpPart(value: string | null | undefined) {
  return normalizeBelanjaText(value)
    .replace(REGION_PREFIX_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function normalizeKdkmpName(value: string | null | undefined) {
  return normalizeBelanjaText(value)
    .replace(COOPERATIVE_PREFIX_PATTERN, "")
    .replace(/^kdkmp\s+/i, "")
    .replace(REGION_PREFIX_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

function villageAliases(nameText: string) {
  return [...nameText.matchAll(/\(([^()]*)\)/g)]
    .map((match) => normalizeKdkmpName(match[1]))
    .filter(Boolean);
}

/**
 * Nama desa di database kadang menyimpan nama display sekaligus alias target,
 * misalnya "Babakan Karet (Babakankaret)". Dropdown target memakai alias di
 * hirarki lokasi. Gunakan alias terakhir sebagai identitas canonical agar
 * source project dan dropdown target membentuk key yang sama.
 */
export function canonicalProjectVillageName(value: string | null | undefined) {
  const normalized = normalizeKdkmpName(value);
  const aliases = villageAliases(normalized);
  return aliases.at(-1) || normalized;
}

export function kdkmpIdentityKey(identity: KdkmpIdentity) {
  return [
    normalizeKdkmpPart(identity.province ?? SOURCE_KDKMP.province),
    normalizeKdkmpPart(identity.regency),
    normalizeKdkmpPart(identity.district),
    normalizeKdkmpPart(identity.village),
  ].join("|");
}

export function formatKdkmpIdentity(identity: KdkmpIdentity) {
  const province = normalizeBelanjaText(identity.province ?? SOURCE_KDKMP.province);
  return [
    normalizeBelanjaText(identity.village),
    normalizeBelanjaText(identity.district),
    normalizeBelanjaText(identity.regency),
    province,
  ].filter(Boolean).join(" / ");
}

export function buildDestinationKdkmp(project: Project): KdkmpIdentity {
  const province = normalizeBelanjaText(
    typeof project.metadataJson?.province === "string"
      ? project.metadataJson.province
      : typeof project.metadataJson?.provinsi === "string"
        ? project.metadataJson.provinsi
        : SOURCE_KDKMP.province,
  );
  const destination = {
    province,
    regency: normalizeKdkmpName(project.regencyName),
    district: normalizeKdkmpName(project.districtName),
    village: canonicalProjectVillageName(project.villageName),
    label: normalizeBelanjaText(project.projectName),
  };

  const missing = [
    ["desa/KDKMP", destination.village],
    ["kecamatan", destination.district],
    ["kabupaten", destination.regency],
    ["provinsi", destination.province],
  ].filter(([, value]) => !value).map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(`Metadata KDKMP tujuan belum lengkap: ${missing.join(", ")} kosong.`);
  }
  return destination;
}

export function sameKdkmpIdentity(left: KdkmpIdentity, right: KdkmpIdentity) {
  return kdkmpIdentityKey(left) === kdkmpIdentityKey(right);
}

export function isMaleberSource(identity: KdkmpIdentity) {
  return sameKdkmpIdentity(identity, SOURCE_KDKMP);
}

function hierarchySuffix(label: string) {
  // Ambil grup kurung PALING AKHIR yang berisi hirarki lokasi. Ini penting
  // untuk label seperti "Babakan Karet (Babakankaret) (Jawa Barat, ...)".
  const match = /\(([^()]*(?:,[^()]*){2,})\)\s*$/.exec(label);
  if (!match || match.index === undefined) return null;
  return {
    nameText: label.slice(0, match.index).trim(),
    hierarchyText: match[1],
  };
}

export function parseKdkmpOptionText(text: string | null | undefined): KdkmpIdentity | null {
  const label = normalizeBelanjaText(text);
  if (!label || /^(?:--\s*)?pilih\s+kdkmp|pilih\s+gerai/i.test(label)) return null;

  const suffix = hierarchySuffix(label);
  const nameText = suffix?.nameText ?? label;
  const hierarchy = (suffix?.hierarchyText ?? "")
    .split(",")
    .map((part) => normalizeBelanjaText(part))
    .filter(Boolean);
  const aliases = villageAliases(nameText);
  const displayVillage = normalizeKdkmpName(nameText.replace(/\([^()]*\)/g, " "));

  if (hierarchy.length >= 4) {
    const hierarchyVillage = normalizeKdkmpName(hierarchy.at(-1));
    return {
      province: normalizeKdkmpName(hierarchy[0]),
      regency: normalizeKdkmpName(hierarchy[1]),
      district: normalizeKdkmpName(hierarchy[2]),
      village: hierarchyVillage || aliases.at(-1) || displayVillage,
      label,
    };
  }

  if (hierarchy.length >= 3) {
    return {
      province: SOURCE_KDKMP.province,
      regency: normalizeKdkmpName(hierarchy[0]),
      district: normalizeKdkmpName(hierarchy[1]),
      village: normalizeKdkmpName(hierarchy.at(-1)) || aliases.at(-1) || displayVillage,
      label,
    };
  }

  return {
    province: SOURCE_KDKMP.province,
    regency: "",
    district: "",
    village: aliases.at(-1) || displayVillage,
    label,
  };
}

function samePart(left: string | null | undefined, right: string | null | undefined) {
  return normalizeKdkmpPart(left) === normalizeKdkmpPart(right);
}

function compatibleKnownPart(actual: string | null | undefined, expected: string | null | undefined) {
  const normalizedActual = normalizeKdkmpPart(actual);
  return !normalizedActual || normalizedActual === normalizeKdkmpPart(expected);
}

export function findKdkmpOption(
  options: Array<{ value: string; text: string }>,
  expected: KdkmpIdentity,
) {
  const candidates = options
    .map((option) => ({ option, identity: parseKdkmpOptionText(option.text || option.value) }))
    .filter((entry): entry is { option: { value: string; text: string }; identity: KdkmpIdentity } => Boolean(entry.identity));

  const exact = candidates.filter((entry) => sameKdkmpIdentity(entry.identity, expected));
  if (exact.length === 1) return exact[0].option;
  if (exact.length > 1) {
    throw new Error(`KDKMP tujuan "${formatKdkmpIdentity(expected)}" ambigu: ${exact.map((entry) => entry.option.text || entry.option.value).join(" | ")}.`);
  }

  // Fallback aman untuk variasi label target. Desa wajib sama. Provinsi,
  // kabupaten, dan kecamatan yang tersedia juga harus cocok. Field lokasi yang
  // tidak ditampilkan target diperlakukan sebagai unknown, bukan mismatch.
  const compatible = candidates.filter((entry) => (
    samePart(entry.identity.village, expected.village)
    && compatibleKnownPart(entry.identity.province, expected.province ?? SOURCE_KDKMP.province)
    && compatibleKnownPart(entry.identity.regency, expected.regency)
    && compatibleKnownPart(entry.identity.district, expected.district)
  ));
  if (compatible.length === 1) return compatible[0].option;
  if (compatible.length > 1) {
    throw new Error(`KDKMP tujuan "${formatKdkmpIdentity(expected)}" ambigu: ${compatible.map((entry) => entry.option.text || entry.option.value).join(" | ")}.`);
  }

  // Jika target punya typo/variasi kecamatan tetapi desa tersebut unik di
  // kabupaten yang sama, izinkan match. Jangan lakukan fallback ini bila ada
  // dua desa dengan nama sama (mis. Batulawang), agar tidak salah gerai.
  const sameVillageRegion = candidates.filter((entry) => (
    samePart(entry.identity.village, expected.village)
    && compatibleKnownPart(entry.identity.province, expected.province ?? SOURCE_KDKMP.province)
    && compatibleKnownPart(entry.identity.regency, expected.regency)
  ));
  if (sameVillageRegion.length === 1) return sameVillageRegion[0].option;
  if (sameVillageRegion.length > 1) {
    throw new Error(`KDKMP tujuan "${formatKdkmpIdentity(expected)}" ambigu antar kecamatan: ${sameVillageRegion.map((entry) => entry.option.text || entry.option.value).join(" | ")}.`);
  }

  throw new Error(`KDKMP tujuan "${formatKdkmpIdentity(expected)}" tidak ditemukan.`);
}
