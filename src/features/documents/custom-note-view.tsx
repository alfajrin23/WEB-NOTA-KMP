"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES } from "@/constants/stages";
import { TEMPLATE_DEFINITIONS, resolveTemplateAssignment } from "@/constants/template-mapping";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { formatRupiah } from "@/utils/format";
import { StageCode } from "@/types/domain";

export function CustomNoteView() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const { projects, vendors, createProjectCustomNote, supabaseReady } = useKdkmpStore();
  const project = projects.find((entry) => entry.id === projectId);
  const [stageCode, setStageCode] = useState<StageCode>("TAHAP_I");
  const [vendorId, setVendorId] = useState("vendor-murah-maju");
  const [templateId, setTemplateId] = useState("template-murah-maju");
  const [tanggal, setTanggal] = useState(new Date().toISOString().slice(0, 10));
  const [uraian, setUraian] = useState("");
  const [qty, setQty] = useState(1);
  const [satuan, setSatuan] = useState("Ls");
  const [hargaSatuan, setHargaSatuan] = useState(0);
  const [jumlahOverride, setJumlahOverride] = useState("");
  const [alasan, setAlasan] = useState("");
  const [saving, setSaving] = useState(false);

  const templateOptions = useMemo(() => {
    return TEMPLATE_DEFINITIONS.filter((template) => template.stageCodes.includes(stageCode));
  }, [stageCode]);

  const total = jumlahOverride.trim() ? Number(jumlahOverride) || 0 : qty * hargaSatuan;

  function applyDefaultTemplate(nextStage: StageCode, nextVendorId: string) {
    const assignment = resolveTemplateAssignment(nextStage, nextVendorId);
    if (assignment) setTemplateId(assignment.templateId);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    if (!supabaseReady) {
      toast.error("Supabase belum dikonfigurasi. Nota tambahan wajib tersimpan ke Supabase.");
      return;
    }

    setSaving(true);
    try {
      await createProjectCustomNote(project.id, {
        stageCode,
        vendorId,
        templateId,
        tanggal,
        uraian,
        qty,
        satuan,
        hargaSatuan,
        jumlahOverride: jumlahOverride.trim() ? Number(jumlahOverride) : null,
        alasan,
      });
      router.push(`/projects/${project.id}/cek-nota`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan nota tambahan.");
    } finally {
      setSaving(false);
    }
  }

  if (!project) {
    return <Card><CardContent className="p-8">Project tidak ditemukan.</CardContent></Card>;
  }

  return (
    <MotionPage>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Buat Nota/Kwitansi Tambahan</h2>
            <p className="text-sm text-slate-500">
              Nota tambahan disimpan di tabel custom_notes dan tidak mengubah resume utama.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/projects/${project.id}/cek-nota`}><ArrowLeft className="h-4 w-4" />Kembali Cek Nota</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Data Nota Tambahan</CardTitle>
            <CardDescription>Template visual tetap memakai mapping vendor yang sudah ada.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tahap</span>
                <Select
                  value={stageCode}
                  onValueChange={(value) => {
                    const next = value as StageCode;
                    setStageCode(next);
                    applyDefaultTemplate(next, vendorId);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((stage) => <SelectItem key={stage.code} value={stage.code}>{stage.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Vendor</span>
                <Select
                  value={vendorId}
                  onValueChange={(value) => {
                    setVendorId(value);
                    applyDefaultTemplate(stageCode, value);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {vendors.filter((vendor) => vendor.type !== "internal").map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Template</span>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {templateOptions.map((template) => <SelectItem key={template.id} value={template.id}>{template.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tanggal</span>
                <Input type="date" value={tanggal} onChange={(event) => setTanggal(event.target.value)} required />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Item / Barang / Jasa</span>
                <Input value={uraian} onChange={(event) => setUraian(event.target.value)} required />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Qty</span>
                <Input type="number" value={qty} onChange={(event) => setQty(Number(event.target.value))} required />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Satuan</span>
                <Input value={satuan} onChange={(event) => setSatuan(event.target.value)} required />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Harga Satuan</span>
                <Input type="number" value={hargaSatuan} onChange={(event) => setHargaSatuan(Number(event.target.value))} required />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Override Total</span>
                <Input type="number" value={jumlahOverride} placeholder={(qty * hargaSatuan).toString()} onChange={(event) => setJumlahOverride(event.target.value)} />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Alasan</span>
                <textarea
                  value={alasan}
                  onChange={(event) => setAlasan(event.target.value)}
                  className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
                />
              </label>

              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 md:col-span-2 md:flex-row md:items-center md:justify-between dark:border-slate-800">
                <div>
                  <p className="text-sm font-semibold">Total Nota Tambahan</p>
                  <p className="text-xl font-bold">{formatRupiah(total)}</p>
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? "Menyimpan" : "Simpan Nota Tambahan"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </MotionPage>
  );
}
