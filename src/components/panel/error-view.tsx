"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AUTO_RETRY, takeAutoRetry } from "@/lib/error-retry";

/** Kendiliğinden yeniden denemelerin zamanları (sayfa açık kaldıkça; src/lib/error-retry.ts) */
const autoRetries: number[] = [];

/**
 * Hata ekranı (panelin, uygulamanın ve en dıştaki sınırın ortak görünümü). "Tekrar dene" `retry` çağırır: Next sayfayı
 * sunucudan yeniden ister ve çizer (`reset` yalnız aynı hatalı çıktıyı yeniden çizerdi; veritabanının geçici hatası
 * geçse de ekran düzelmiyordu). `auto`: gözetimsiz ekranda (bar) 10 sn sonra kendiliğinden dener.
 */
export function ErrorView({ error, retry, auto = false }: { error: unknown; retry: () => void; auto?: boolean }) {
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!auto || !takeAutoRetry(autoRetries, Date.now())) return;
    const show = window.setTimeout(() => setWaiting(true), 0);
    const id = window.setTimeout(retry, AUTO_RETRY.delayMs);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(id);
    };
  }, [auto, retry]);

  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-3xl bg-panel p-6 text-center sm:mt-16 sm:p-8">
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-bad-soft text-bad">
        <AlertTriangle size={22} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-pretty text-ink-mute">
        Sayfa yüklenirken hata oluştu. Bağlantı çoğu zaman birkaç saniyede düzelir; tekrar deneyin.
        {waiting ? <span className="mt-1 block">Ekran 10 saniye sonra kendiliğinden yeniden deneyecek.</span> : null}
        {digest ? <span className="mt-1 block font-mono text-xs text-ink-quiet">Hata kodu: {digest}</span> : null}
      </p>
      <Button className="mt-5" onClick={() => retry()}>
        <RotateCcw size={16} aria-hidden="true" /> Tekrar dene
      </Button>
    </div>
  );
}
