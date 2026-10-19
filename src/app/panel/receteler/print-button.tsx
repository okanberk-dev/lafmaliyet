"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Sayfa başlığındaki yazdır düğmesi: kartlar yazdırma düzeninde (araç çubuğu gizli) çıkar */
export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="pointer-coarse:h-10" title="Reçete kartlarını yazdır">
      <Printer size={16} aria-hidden="true" /> Yazdır
    </Button>
  );
}
