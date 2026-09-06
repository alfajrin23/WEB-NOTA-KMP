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
    .replace(/^koperasi\s+(desa|kelurahan)\s+/i, "")
    .replace(/^kdkmp\s+/i, "")
    .replace(REGION_PREFIX_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
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
    village: normalizeKdkmpName(project.villageName),
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

export function parseKdkmpOptionText(text: string | null | undefined): KdkmpIdentity | null {
  const label = normalizeBelanjaText(text);
  if (!label) return null;

  const match = /^(.*?)\s*\((.*?)\)\s*$/.exec(label);
  const nameText = match ? match[1] : label;
  const hierarchy = (match ? match[2] : "")
    .split(",")
    .map((part) => normalizeBelanjaText(part))
    .filter(Boolean);

  const village = normalizeKdkmpName(nameText);
  if (hierarchy.length >= 4) {
    return {
      province: normalizeKdkmpName(hierarchy[0]),
      regency: normalizeKdkmpName(hierarchy[1]),
      district: normalizeKdkmpName(hierarchy[2]),
      village,
      label,
    };
  }

  if (hierarchy.length >= 3) {
    return {
      province: SOURCE_KDKMP.province,
      regency: normalizeKdkmpName(hierarchy[0]),
      district: normalizeKdkmpName(hierarchy[1]),
      village: normalizeKdkmpName(hierarchy[2]) || village,
      label,
    };
  }

  return {
    province: SOURCE_KDKMP.province,
    regency: "",
    district: "",
    village,
    label,
  };
}

export function findKdkmpOption(
  options: Array<{ value: string; text: string }>,
  expected: KdkmpIdentity,
) {
  const matches = options
    .map((option) => ({ option, identity: parseKdkmpOptionText(option.text || option.value) }))
    .filter((entry): entry is { option: { value: string; text: string }; identity: KdkmpIdentity } => Boolean(entry.identity))
    .filter((entry) => sameKdkmpIdentity(entry.identity, expected));

  if (matches.length === 0) {
    throw new Error(`KDKMP tujuan "${formatKdkmpIdentity(expected)}" tidak ditemukan.`);
  }
  if (matches.length > 1) {
    throw new Error(`KDKMP tujuan "${formatKdkmpIdentity(expected)}" ambigu: ${matches.map((entry) => entry.option.text || entry.option.value).join(" | ")}.`);
  }
  return matches[0].option;
}
