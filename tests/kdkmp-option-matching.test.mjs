import assert from "node:assert/strict";
import test from "node:test";

import {
  findKdkmpOption,
  parseKdkmpOptionText,
  sameKdkmpIdentity,
} from "../src/lib/belanja-sync/kdkmp.ts";

const bunisari = {
  province: "Jawa Barat",
  regency: "Cianjur",
  district: "Agrabinta",
  village: "Bunisari",
};

const babakankaret = {
  province: "Jawa Barat",
  regency: "Cianjur",
  district: "Cianjur",
  village: "Babakankaret",
};

test("parser accepts Koperasi without Desa prefix", () => {
  const parsed = parseKdkmpOptionText("Koperasi Bunisari (Jawa Barat, Cianjur, Agrabinta, Bunisari)");
  assert.ok(parsed);
  assert.equal(parsed.village, "Bunisari");
  assert.equal(parsed.district, "Agrabinta");
  assert.equal(sameKdkmpIdentity(parsed, bunisari), true);
});

test("parser uses final hierarchy group when display name contains alias parentheses", () => {
  const parsed = parseKdkmpOptionText("Koperasi Desa Babakan Karet (Babakankaret) (Jawa Barat, Cianjur, Cianjur, Babakankaret)");
  assert.ok(parsed);
  assert.equal(parsed.village, "Babakankaret");
  assert.equal(parsed.district, "Cianjur");
  assert.equal(sameKdkmpIdentity(parsed, babakankaret), true);
});

test("findKdkmpOption selects Bunisari from real dropdown naming", () => {
  const options = [
    { value: "", text: "-- Pilih KDKMP --" },
    { value: "bojongkaso", text: "Koperasi Desa Bojongkaso (Jawa Barat, Cianjur, Agrabinta, Bojongkaso)" },
    { value: "bunisari", text: "Koperasi Bunisari (Jawa Barat, Cianjur, Agrabinta, Bunisari)" },
  ];
  assert.equal(findKdkmpOption(options, bunisari).value, "bunisari");
});

test("findKdkmpOption selects Babakankaret alias safely", () => {
  const options = [
    { value: "babakancaringin", text: "Koperasi Desa Babakancaringin (Jawa Barat, Cianjur, Karangtengah, Babakancaringin)" },
    { value: "babakankaret", text: "Koperasi Desa Babakan Karet (Babakankaret) (Jawa Barat, Cianjur, Cianjur, Babakankaret)" },
    { value: "bangbayang", text: "Koperasi Desa Bangbayang (Jawa Barat, Cianjur, Gekbrong, Bangbayang)" },
  ];
  assert.equal(findKdkmpOption(options, babakankaret).value, "babakankaret");
});

test("duplicate village names remain disambiguated by district", () => {
  const options = [
    { value: "batulawang-cipanas", text: "Koperasi Desa Batulawang (Jawa Barat, Cianjur, Cipanas, Batulawang)" },
    { value: "batulawang-cibinong", text: "Koperasi Desa Batulawang (Jawa Barat, Cianjur, Cibinong, Batulawang)" },
  ];
  const expected = { province: "Jawa Barat", regency: "Cianjur", district: "Cipanas", village: "Batulawang" };
  assert.equal(findKdkmpOption(options, expected).value, "batulawang-cipanas");
});
