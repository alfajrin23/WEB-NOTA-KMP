import { NextResponse } from "next/server";
import { createBelanjaSyncJob } from "@/lib/belanja-sync/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const EXPIRES_AT = Date.parse("2026-09-08T15:30:00Z");
const MAX_BATCH = 5;

const PROJECTS = [
  { no: 1, label: "Pananggapan / Cubinong", id: "517c8b3c-5024-451c-805b-7f0caf9d0f63" },
  { no: 2, label: "Panyindangan / Cubinong", id: "ce2a3e1b-cf8d-4834-99c8-4e5041678283" },
  { no: 3, label: "Sukajadi / Cubinong", id: "73b8172c-6607-4f48-a4ce-c57912a819e4" },
  { no: 4, label: "Wargaluyu / Cubinong", id: "8ba01db0-2481-454f-8e8f-4e7aa5ae9d0d" },
  { no: 5, label: "Cibuluh / Cidaun", id: "5b2b6340-6557-43b6-b539-08c68ef90c5d" },
  { no: 6, label: "Cidamar / Cidaun", id: "add6c6c0-fd4a-48e0-94a7-56b07fc73f62" },
  { no: 7, label: "Cimaragang / Cidaun", id: "f6b753d0-9011-4aad-9f00-d4547d31327a" },
  { no: 8, label: "Cisalak / Cidaun", id: "bda837ef-57d6-428c-a208-b1074436acf4" },
  { no: 9, label: "Gelarpawitan / Cidaun", id: "ddbaf022-a70e-4473-abac-3b47e959ac25" },
  { no: 10, label: "Jayapura / Cidaun", id: "47ac30fc-fc2b-46a8-a53b-d923b6318f9a" },
  { no: 11, label: "Karangwangi / Cidaun", id: "c890b52b-2d95-450a-a6bb-e7338593527c" },
  { no: 12, label: "Karyabakti / Cidaun", id: "287161d2-df6e-44f7-bbcf-0d412696de82" },
  { no: 13, label: "Kertajadi / Cidaun", id: "5e51d4cc-9268-46de-a218-a343bc90ec4c" },
  { no: 15, label: "Sukapura / Cidaun", id: "e6d7ee01-2276-4888-b4ff-46061835b537" },
  { no: 16, label: "Cibodas / Cijati", id: "271ed934-4b44-436d-8f0c-1d0c8bd079ce" },
  { no: 17, label: "Sukaluyu / Cijati", id: "68ef09b1-ff75-4719-8344-50f9a2a992eb" },
  { no: 18, label: "Cikadu / Cikadu", id: "d06c12f0-f1f2-4840-a6c2-7ac230d3e27a" },
  { no: 19, label: "Kalapanunggal / Cikadu", id: "c56c4111-8dd3-4192-8726-5af18ae16ecb" },
  { no: 20, label: "Padaluyu / Cikadu", id: "a7ad1c26-2241-4efc-81b1-a6fcebd663cc" },
  { no: 21, label: "Sukaluyu / Cikadu", id: "505947f9-1874-4fc3-a0c1-5aa864cdd404" },
  { no: 22, label: "Sukamulya / Cikadu", id: "6c89d3b7-2823-493f-9974-eccd23af180e" },
  { no: 23, label: "Sukamanah / Cugenang", id: "9adac303-7acd-4c2a-925c-407c0baebbed" },
  { no: 24, label: "Neglasari / Kadupandak", id: "755c8ee5-a695-4a62-b6cb-317793373348" },
  { no: 25, label: "Pasirdalem / Kadupandak", id: "98b42a75-e7d1-4117-8a98-5c3d3c7ac7b4" },
  { no: 26, label: "Sukaraharja / Kadupandak", id: "b4a366b7-5b88-44af-8879-a8aa84390625" },
  { no: 27, label: "Sukaresmi / Kadupandak", id: "5a235798-5251-475c-8b9f-c836c8e007e4" },
  { no: 28, label: "Sukasari / Kadupandak", id: "892edbbd-d791-4bf4-a06a-01deb39ec53f" },
  { no: 29, label: "Wargasari / Kadupandak", id: "2a7d5c7d-aea8-404d-82de-b9261b3f234e" },
  { no: 30, label: "Mandalawangi / Leles", id: "19ecda79-792c-43d2-a62a-d6d17c20c072" },
  { no: 31, label: "Nagasari / Leles", id: "c0e471fc-3a6f-4de6-b86d-c06ca99936eb" },
  { no: 32, label: "Puncakwangi / Leles", id: "ba693114-11be-4508-ba91-b1ee71bd8299" },
  { no: 34, label: "Pusakasari / Leles", id: "6695d1d8-552a-41ae-b1ea-443212862257" },
  { no: 36, label: "Sirnasari / Leles", id: "8bd42bc5-4d40-4c96-8093-eefe886d5b63" },
  { no: 37, label: "Sukajaya / Leles", id: "e31a6df0-a0c4-4730-8f68-96be1f05f704" },
  { no: 38, label: "Sukasirna / Leles", id: "fbe35f4c-889e-43e5-a4b8-b2eecf3a575f" },
  { no: 39, label: "Walahir / Leles", id: "455ca27b-398a-415e-98d4-d3e4d107a434" },
  { no: 40, label: "Margasari / Naringgul", id: "d495d628-beec-4257-bdc0-8c9b1cfe62de" },
] as const;

export async function GET(request: Request) {
  if (Date.now() > EXPIRES_AT) {
    return NextResponse.json({ error: "Dispatch endpoint sudah kedaluwarsa." }, { status: 410 });
  }

  const url = new URL(request.url);
  const start = Math.max(0, Number.parseInt(url.searchParams.get("start") ?? "0", 10) || 0);
  const count = Math.min(MAX_BATCH, Math.max(1, Number.parseInt(url.searchParams.get("count") ?? String(MAX_BATCH), 10) || MAX_BATCH));
  const selected = PROJECTS.slice(start, start + count);
  const client = createSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase admin client tidak tersedia." }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];
  for (const project of selected) {
    try {
      const { data, error } = await client
        .from("resume_items")
        .select("id,is_included_in_resume_total")
        .eq("project_id", project.id)
        .order("urutan", { ascending: true });
      if (error) throw error;
      const itemIds = (data ?? [])
        .filter((row) => row.is_included_in_resume_total !== false)
        .map((row) => row.id as string);

      const created = await createBelanjaSyncJob({
        projectId: project.id,
        itemIds,
        dryRun: false,
        operationType: "copy_reconcile_v1",
        expectedTransactionCount: 43,
      });
      results.push({ no: project.no, label: project.label, ok: true, created });
    } catch (error) {
      results.push({
        no: project.no,
        label: project.label,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ mode: "LIVE", dryRun: false, start, count: selected.length, totalConfigured: PROJECTS.length, results });
}
