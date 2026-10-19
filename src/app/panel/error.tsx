"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-3xl bg-panel p-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-bad-soft text-bad">
        <AlertTriangle size={22} />
      </span>
      <h1 className="mt-4 font-display text-xl font-bold text-ink">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-ink-mute">
        Sayfa yüklenirken hata oluştu. Veritabanı bağlantısını kontrol edip tekrar deneyin.
        {error.digest ? <span className="mt-1 block text-xs text-ink-quiet">Hata kodu: {error.digest}</span> : null}
      </p>
      <Button className="mt-5" onClick={reset}>
        <RotateCcw size={16} /> Tekrar dene
      </Button>
    </div>
  );
}
