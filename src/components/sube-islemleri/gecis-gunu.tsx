"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { monthLabel } from "@/lib/format";
import { dayMonthYearTR, switchAffectedMonths, switchDayProblem } from "@/lib/asilpos/switch";
import { saveAsilposSwitchDay } from "@/server/actions/asilpos";

/*
 * AsilPOS'a geçiş günü (docs/ASILPOS.md › Geçiş günü): Yönetim konsolunda Şubeler ve kasalar › şube (/yonetim/sube/[id]),
 * sunucu eylemi saveAsilposSwitchDay (kapalı dönem kuralı sunucuda; yalnız konsol oturumuyla geçer). ladmin'in Ayarlar ›
 * AsilPOS (kasa) kartı günü yalnız gösterir, yerinde "Bu iş Yönetim konsolunda yapılır" (docs/planlar/yonetim-konsolu.md › K-C).
 */

/**
 * Bir kasanın AsilPOS'a geçiş günü (çok şube: `branchId` bölümün şubesi). Kaydetmeden önce
 * onay penceresi: bu günden itibaren ne değişir (`effects`: switchEffects, kodun bugün yaptığı) ve hangi ayların günleri
 * kaynak değiştirir (switchAffectedMonths). Boşaltmak da aynı pencereden: kasa yeniden ModPOS sayılır. Hiçbir kayıt silinmez.
 */
export function AsilposSwitchDayForm({
  branchId,
  effects,
  value,
  today,
  min,
  max,
  linked,
}: {
  branchId: string;
  effects: readonly string[];
  value: string | null;
  today: string;
  min: string;
  max: string;
  linked: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(value ?? "");
  // Kayıttan ya da başka bir sekmedeki değişiklikten sonra sunucudan yeni değer gelir: el değmemiş alan yenisini alır
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    if (draft === (synced ?? "")) setDraft(value ?? "");
  }
  const [confirm, setConfirm] = useState<string | null | undefined>(undefined);
  const [pending, start] = useActionTransition();
  const next = draft || null;
  const dirty = next !== value;
  const problem = next ? switchDayProblem(next, today) : null;

  const save = (day: string | null) =>
    start(async () => {
      const res = await saveAsilposSwitchDay({ branchId, day });
      if (!res.ok) return void toast.error(res.error);
      setConfirm(undefined);
      toast.success(res.data.change ?? "Değişiklik yok");
      router.refresh();
    });

  const months = confirm !== undefined ? switchAffectedMonths(value, confirm, today) : [];
  return (
    <div className="space-y-3">
      <Field
        label="AsilPOS'a geçiş günü"
        htmlFor={`asilpos-gecis-${branchId}`}
        error={problem}
        hint="Kasada AsilPOS'u kullanmaya başladığınız ilk iş günü. Boş bırakın: her şey bugünkü gibi ModPOS'a göre çalışır. Tercihen ayın 1'i (ModPOS'un o ayki listesi bölünmez)."
      >
        <Input
          id={`asilpos-gecis-${branchId}`}
          type="date"
          value={draft}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={problem ? true : undefined}
          className="h-11 max-w-56 max-sm:max-w-none"
        />
      </Field>
      <div className="flex flex-wrap gap-2 max-sm:flex-col">
        {dirty ? (
          <>
            <Button onClick={() => setConfirm(next)} disabled={pending || problem !== null} className="max-sm:h-11 max-sm:w-full">
              {next ? "Geçiş gününü kaydet" : "Geçiş gününü kaldır"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(value ?? "")} disabled={pending} className="max-sm:h-11 max-sm:w-full">
              Vazgeç
            </Button>
          </>
        ) : value ? (
          <Button variant="secondary" onClick={() => setConfirm(null)} disabled={pending} className="max-sm:h-11 max-sm:w-full">
            Geçiş gününü kaldır
          </Button>
        ) : null}
      </div>
      <Dialog
        open={confirm !== undefined}
        onClose={() => setConfirm(undefined)}
        size="sm"
        title={confirm ? `Geçiş günü ${dayMonthYearTR(confirm)}` : "Geçiş gününü kaldır"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(undefined)} disabled={pending} data-autofocus className="max-sm:h-11 max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button onClick={() => save(confirm ?? null)} disabled={pending} className="max-sm:h-11">
              {pending ? "Kaydediliyor…" : confirm ? "Kaydet" : "Kaldır"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2 text-sm text-ink-soft">
          {confirm ? (
            <>
              <p>Bu günden itibaren kasanın kaynağı AsilPOS olur:</p>
              <ul className="list-disc space-y-1 pl-5">
                {effects.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {!linked ? <Notice tone="warn" size="sm" title="Bağlantı kurulmadı: anahtar girilene kadar AsilPOS günleri gelmez" /> : null}
            </>
          ) : (
            <p>Kasa yeniden ModPOS sayılır; AsilPOS&apos;tan gelen bütün günler deneme olur ve hiçbir hesaba girmez.</p>
          )}
          <p className="text-[13px] text-ink-mute">
            {months.length
              ? `Kaynağı değişen günlerin ayları: ${months.map(monthLabel).join(", ")}.`
              : "Geçmiş hiçbir gün değişmiyor (gün ileride)."}{" "}
            Hiçbir kayıt silinmez; tarihi sonra değiştirebilir ya da boşaltabilirsiniz.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
