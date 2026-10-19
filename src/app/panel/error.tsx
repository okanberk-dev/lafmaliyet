"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-rose-200 bg-white p-8 text-center">
      <AlertTriangle className="mx-auto text-rose-500" size={36} />
      <h1 className="mt-3 text-xl font-semibold text-coffee-950">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-coffee-600">
        Sayfa yüklenirken hata oluştu. Veritabanı bağlantısını kontrol edip tekrar deneyin.
        {error.digest ? <span className="mt-1 block text-xs text-coffee-400">Hata kodu: {error.digest}</span> : null}
      </p>
      <Button className="mt-5" onClick={reset}>
        <RotateCcw size={16} /> Tekrar dene
      </Button>
    </div>
  );
}
