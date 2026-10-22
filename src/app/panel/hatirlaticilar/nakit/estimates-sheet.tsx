"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ToggleRow } from "@/components/ui/toggle-row";
import type { EstimateRow } from "@/lib/cash-plan";
import { tl } from "@/lib/format";
import { saveCashPlanExcluded } from "@/server/actions/cash-plan";

import { Sheet, SHEET_BTN } from "../sheet";

/**
 * Tahmine katılanlar: hatırlatıcısı olmayan düzenli giderler ve beklenen satışlar. Faturası ayrıca gelen bir gider
 * kapatılır (iki kez sayılmasın). Ödemeler'de hatırlatıcısı olan ve yıllık kalemler değiştirilemez; kapatılanların
 * anahtarı kayıtlı listeye yazılır (ekranda olmayan eski anahtarlar korunur).
 */
export function EstimatesSheet({ rows, excluded, onClose }: { rows: EstimateRow[]; excluded: string[]; onClose: () => void }) {
  const router = useRouter();
  const toggleable = rows.filter((r) => r.status === "on" || r.status === "off");
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set(toggleable.filter((r) => r.status === "off").map((r) => r.key)));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const shown = new Set(toggleable.map((r) => r.key));
    const keys = [...excluded.filter((k) => !shown.has(k)), ...off];
    const r = await saveCashPlanExcluded(keys);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(off.size ? `${off.size} kalem tahmine katılmıyor` : "Bütün kalemler tahmine katılıyor");
    onClose();
  }

  // KDV satırının notu tutarı zaten yazar ("Ekim için ≈ 42.100 ₺"): "ayda" ayrıca yazılmaz
  const describe = (r: EstimateRow) => [r.monthly >= 1 && r.key !== "kdv" ? `ayda ${tl(r.monthly)}` : null, r.note].filter(Boolean).join(" · ");

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title="Tahmine katılanlar"
      description="Hatırlatıcısı olmayan düzenli giderler ve beklenen satışlar. Faturası ayrıca gelen bir gideri kapatın; iki kez sayılmasın."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Vazgeç
          </Button>
          <Button onClick={() => void save()} disabled={busy} className={SHEET_BTN}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {rows.map((r) => {
          const fixedLocked = r.status === "covered" || r.status === "yearly";
          return (
            <ToggleRow
              key={r.key}
              title={r.title}
              description={describe(r)}
              label={`${r.title} tahmine katılsın`}
              checked={fixedLocked ? false : !off.has(r.key)}
              disabled={fixedLocked || busy}
              onChange={(v) =>
                setOff((s) => {
                  const next = new Set(s);
                  if (v) next.delete(r.key);
                  else next.add(r.key);
                  return next;
                })
              }
            />
          );
        })}
      </div>
      {/* Pencere gezinmeden önce kapanır (alt sayfa açıkken sayfa değişmesin) */}
      <button
        type="button"
        onClick={() => {
          onClose();
          router.push("/panel/hatirlaticilar");
        }}
        className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-medium text-ink underline-offset-2 hover:underline"
      >
        Gününü girmek için Ödemeler&apos;e ekle <ArrowRight size={14} aria-hidden="true" />
      </button>
    </Sheet>
  );
}
