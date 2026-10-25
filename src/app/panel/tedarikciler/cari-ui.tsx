"use client";

import { CalendarClock } from "lucide-react";
import { useState } from "react";

import { PhotoPicker, PhotoStatus, PhotoThumb, usePhotoUpload } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { Checkbox } from "@/components/ui/form";
import { pastMonthConfirmText, pastMonthText, type MonthEffect } from "@/lib/cari/months";
import { cn } from "@/lib/utils";

/*
 * Cari pencerelerinin ortak parçaları (Borç ekle, Ödeme ekle, Faturası geldi, Neye sayıldı, silme onayı). Yazım
 * src/server/actions/cari.ts'te; kurallar src/lib/cari'de.
 */

/** "Geri al"lı bildirimlerin süresi (tedarikçi sayfasının öteki bildirimleriyle aynı) */
export const CARI_UNDO_MS = 10_000;

/** Tutarın alandaki yazılışı: 1250.5 → "1250,5" (panelin sayı girişi binlik ayırıcıyı da okur) */
export const amountText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

/**
 * Geçmiş ay onayı (K18): işlem kapanmış bir ayın giderini değiştiriyorsa ay ay ne olacağı yazılır ve onay kutusu
 * işaretlenmeden kayıt yapılmaz. Sunucu da onaysız isteği reddeder.
 */
export function PastConfirm({ effects, checked, onChange, className }: { effects: readonly MonthEffect[]; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  if (!effects.length) return null;
  return (
    <div className={cn("space-y-2 rounded-2xl bg-warn-soft px-3.5 py-3 text-[13px] leading-5 text-warn", className)} role="alert">
      <p className="flex items-start gap-2 font-medium">
        <CalendarClock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{effects.map(pastMonthText).join(" · ")}</span>
      </p>
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} label={<span className="text-ink">{pastMonthConfirmText(effects)}</span>} className="items-start" />
    </div>
  );
}

/**
 * Kaydın fotoğrafı (borçta irsaliye ya da el fişi, ödemede dekont ya da makbuz): fiş gibi saklanır (400 gün), yalnız
 * kanıt olarak; okunmaz. Yükleme kasanın gününden ileri olamaz (ileri tarihli kayıtta bugünün günüyle yüklenir).
 */
export function CariPhotoField({ value, onChange, day, label }: { value: number | null; onChange: (id: number | null) => void; day: string; label: string }) {
  const up = usePhotoUpload();
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      {value ? (
        <PhotoThumb id={value} caption={label} onOpen={() => setViewer({ id: value, caption: label })} onRemove={() => onChange(null)} />
      ) : (
        <PhotoPicker
          read={false}
          disabled={up.busy}
          onPick={async (file) => {
            const r = await up.upload(file, { kind: "fis", day, read: false });
            if (r) onChange(r.photo.id);
          }}
        />
      )}
      <PhotoStatus phase={up.phase} />
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}
