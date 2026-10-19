"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-3xl bg-panel p-6 text-center sm:mt-16 sm:p-8">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-bad-soft text-bad">
        <AlertTriangle size={22} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-pretty text-ink-mute">
        Sayfa yüklenirken hata oluştu. Veritabanı bağlantısını kontrol edip tekrar deneyin.
        {error.digest ? <span className="mt-1 block font-mono text-xs text-ink-quiet">Hata kodu: {error.digest}</span> : null}
      </p>
      <Button className="mt-5" onClick={reset}>
        <RotateCcw size={16} aria-hidden="true" /> Tekrar dene
      </Button>
    </div>
  );
}
