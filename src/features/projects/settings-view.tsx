"use client";

import { ChangeEvent, useRef } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MotionPage } from "@/components/ui/motion-page";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { todayInIndonesiaIsoDate } from "@/utils/format";

export function SettingsView() {
  const { projects, masterItems, templateAssignments, importStoreData, resetAll } = useKdkmpStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function exportJson() {
    const blob = new Blob([JSON.stringify({ projects, masterItems, templateAssignments }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `backup-kdkmp-${todayInIndonesiaIsoDate()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    importStoreData(JSON.parse(text));
    event.target.value = "";
  }

  return (
    <MotionPage>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Pengaturan</CardTitle>
          <CardDescription>Konfigurasi lokal, backup JSON, dan utilitas data. Tidak ada login/authentication.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportJson}>
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            Import JSON
          </Button>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={importJson} />
          <Button variant="outline" onClick={resetAll}>
            <RotateCcw className="h-4 w-4" />
            Reset Data Lokal
          </Button>
        </CardContent>
      </Card>
    </MotionPage>
  );
}
