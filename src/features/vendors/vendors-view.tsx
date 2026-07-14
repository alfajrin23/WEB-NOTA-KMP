"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MotionPage } from "@/components/ui/motion-page";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";

export function VendorsView() {
  const { vendors } = useKdkmpStore();
  return (
    <MotionPage>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-normal">Vendor</h2>
          <p className="text-sm text-slate-500">Daftar vendor template. Nota tetap dicetak polos tanpa logo/cap/tanda tangan.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vendors.map((vendor) => (
            <Card key={vendor.id}>
              <CardHeader>
                <CardTitle>{vendor.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge>{vendor.type}</Badge>
                <p className="text-sm text-slate-500">{vendor.address ?? "Alamat belum diisi"}</p>
                <p className="text-sm text-slate-500">{vendor.phone ?? "Telepon belum diisi"}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </MotionPage>
  );
}
