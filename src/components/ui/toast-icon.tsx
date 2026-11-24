"use client";

import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { TONE_LABEL, TONE_TILE } from "./notice";

/**
 * Bildirim kartının (sonner) hareketli ikon karosu (rare-ui toast'tan uyarlandı). `TopLayerToaster` bunu sonner'ın
 * `icons` seçeneğiyle verir: `toast.success / error / warning / info / loading` çağıran her yer (sonner'dan doğrudan)
 * kendiliğinden bu karoyu alır, çağıran kodda değişiklik yok. Panel uyarlaması:
 * - Karo rengi uyarıların tablosundan (`TONE_TILE`: zilin ve "Dikkat" kartının kuyusu); rare-ui'nin dolu iOS
 *   renkleri ve squircle kütüphanesi yok, köşe CSS yarıçapı (karo 11 px + kart dolgusu 10 px = kartın 21 px köşesi).
 * - Bilgi mavi değil nötr (TASARIM.md: mavi uyarı rengi değildir).
 * - İşaret kart yerine oturduktan sonra çizilir (✓, ✕, !, i); "yükleniyor"dan sonuca geçişte (aynı `id`) karo bekleme
 *   yapmadan bir kez kabarır. Hareket CSS'te (globals.css › "Bildirim kartı"); hareket azaltma tercihinde hepsi
 *   durur, işaret çizili gelir. Karo sunucuda hiç çizilmez (bildirim yalnız istemcide).
 * - Ekran okuyucu karonun yerine kısa bir önek okur ("Tamam: ", "Önemli: ", "Dikkat: ", "Bilgi: "), uyarılarla aynı.
 */

export type ToastIconType = "success" | "error" | "warning" | "info" | "loading";

/** Karonun rengi: uyarıların tonu (notice.tsx) */
export const TOAST_TILE: Record<ToastIconType, string> = {
  success: TONE_TILE.good,
  error: TONE_TILE.bad,
  warning: TONE_TILE.warn,
  info: TONE_TILE.neutral,
  loading: TONE_TILE.neutral,
};

/** Ekran okuyucu öneki; yükleniyor bildiriminin başlığı zaten durumu söyler */
export const TOAST_PREFIX: Record<ToastIconType, string | null> = {
  success: TONE_LABEL.good,
  error: TONE_LABEL.bad,
  warning: TONE_LABEL.warn,
  info: TONE_LABEL.neutral,
  loading: null,
};

/** Çizilen çizgi: pathLength 1, CSS stroke-dashoffset ile 1 → 0 */
const Draw = ({ d }: { d: string }) => <path d={d} pathLength={1} data-draw="" />;
const Dot = ({ cy }: { cy: number }) => <circle cx="12" cy={cy} r="1.6" fill="currentColor" stroke="none" />;

function Glyph({ type }: { type: ToastIconType }) {
  if (type === "loading") {
    return (
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" data-spin="">
        <circle cx="12" cy="12" r="8" strokeOpacity={0.25} />
        <path d="M12 4a8 8 0 0 1 8 8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      {type === "success" ? <Draw d="M6 12.5l4 4 8-9" /> : null}
      {type === "error" ? (
        <>
          <Draw d="M7.5 7.5l9 9" />
          <Draw d="M16.5 7.5l-9 9" />
        </>
      ) : null}
      {type === "warning" ? (
        <>
          <Draw d="M12 6v7" />
          <Dot cy={18} />
        </>
      ) : null}
      {type === "info" ? (
        <>
          <Dot cy={6.25} />
          <Draw d="M12 11v7" />
        </>
      ) : null}
    </svg>
  );
}

export function ToastIcon({ type }: { type: ToastIconType }) {
  const ref = useRef<HTMLSpanElement>(null);

  // "Yükleniyor" kartı işaretlenir: aynı kart sonuca dönünce (toast.success(…, { id })) karo gelişi beklemez, kabarır
  useLayoutEffect(() => {
    if (type !== "loading") return;
    ref.current?.closest("[data-sonner-toast]")?.setAttribute("data-laf-spun", "");
  }, [type]);

  const prefix = TOAST_PREFIX[type];
  return (
    <>
      {prefix ? <span className="sr-only">{prefix}: </span> : null}
      <span
        ref={ref}
        aria-hidden="true"
        data-slot="toast-icon"
        data-type={type}
        className={cn("relative grid size-9 shrink-0 place-items-center rounded-[11px]", TOAST_TILE[type])}
      >
        <span data-slot="toast-glyph" className="grid place-items-center">
          <Glyph type={type} />
        </span>
      </span>
    </>
  );
}

/** sonner `icons`: her türün karosu */
export const TOAST_ICONS = {
  success: <ToastIcon type="success" />,
  error: <ToastIcon type="error" />,
  warning: <ToastIcon type="warning" />,
  info: <ToastIcon type="info" />,
  loading: <ToastIcon type="loading" />,
};
