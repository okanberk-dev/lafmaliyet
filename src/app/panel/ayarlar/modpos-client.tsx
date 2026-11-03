"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { dayMonthYearTR } from "@/lib/lafpos/switch";
import { modposFetchConfirmLines } from "@/lib/modpos/ayarlar";
import { fetchModposDay, saveModposFallback } from "@/server/actions/modpos";

/**
 * Ayarlar › ModPOS (kasa föyü) › "Bu günü çek" (docs/MODPOS-API.md › Kota ve çekme sırası): bir gün seçilir (ilk değer
 * dün, en geç bugün), onay penceresi bugünkü kalan hakkı ve çekince kalacağını söyler; bugün seçildiyse föy kesin değildir.
 * Hak yoksa, anahtar kurulmamışsa ya da önizlemedeyse düğme kapalı, nedeni altında. Sayfa açılışı hiçbir zaman çekmez:
 * yalnız bu düğme ve sabah işi.
 */
export function ModposFetchForm({
  today,
  defaultDay,
  left,
  canFetch,
  blocked,
  stored,
}: {
  today: string;
  defaultDay: string;
  left: number;
  canFetch: boolean;
  /** Düğme kapalıysa nedeni (modposCardSummary.fetchBlocked) */
  blocked: string | null;
  /** Saklanan günler → kesin mi */
  stored: Record<string, boolean>;
}) {
  const [day, setDay] = useState(defaultDay);
  const [open, setOpen] = useState(false);
  const [pending, start] = useActionTransition();
  const problem = !day ? "Bir gün seçin" : day > today ? "İleri tarih çekilemez" : null;

  // Yanıt yolda kaybolursa çekim yapılmış (hak harcanmış) olabilir: pencere kapanır, "Yenile" önerilir; yeniden
  // denemeden önce sayfa kalan hakkı göstersin (maybeSaved)
  const run = () =>
    start(
      async () => {
        try {
          const res = await fetchModposDay(day);
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.data.title, { description: res.data.description });
        } finally {
          setOpen(false);
        }
      },
      { maybeSaved: true },
    );

  // Onay penceresi açılınca okunur (sunucuda çizilmez): saat tarayıcınınkidir, 07:00 sınırı için yeterli
  const lines = modposFetchConfirmLines({ day, today, left, stored: day in stored ? stored[day] : null, now: new Date() });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2 max-sm:flex-col max-sm:items-stretch">
        <Field label="Kasa günü" htmlFor="modpos-gun" error={canFetch ? problem : null} className="max-sm:w-full">
          <Input
            id="modpos-gun"
            type="date"
            value={day}
            max={today}
            onChange={(e) => setDay(e.target.value)}
            disabled={!canFetch || pending}
            aria-invalid={canFetch && problem ? true : undefined}
            className="h-11 max-w-56 max-sm:max-w-none"
          />
        </Field>
        <Button onClick={() => setOpen(true)} disabled={!canFetch || pending || problem !== null} className="h-11 max-sm:w-full">
          <Download size={15} aria-hidden="true" />
          {pending ? "Çekiliyor…" : "Bu günü çek"}
        </Button>
      </div>
      <p className="text-[13px] leading-5 text-pretty text-ink-mute">
        {blocked ?? "Seçilen günün föyünü hemen çeker ve günün çekim hakkından birini kullanır; yoksa her sabah dünün föyü kendiliğinden gelir."}
      </p>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        tone="primary"
        confirmLabel="Çek"
        pending={pending}
        title={`${day ? dayMonthYearTR(day) : ""} föyü çekilsin mi?`}
        description={
          <div className="space-y-2">
            {lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        }
        onConfirm={run}
      />
    </div>
  );
}

/**
 * Ay rakamına yedek anahtarı (docs/MODPOS-API.md › Ay rakamına yedek; varsayılan kapalı). Çevirmeden önce onay penceresi
 * ne değişeceğini söyler; kayıttan sonra eylemin refresh()'i kartı yeni değerle çizer.
 */
export function ModposFallbackSwitch({ on }: { on: boolean }) {
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [pending, start] = useActionTransition();

  const save = (next: boolean) =>
    start(async () => {
      const res = await saveModposFallback(next);
      setConfirm(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.on ? "Ay rakamına yedek açık" : "Ay rakamına yedek kapalı");
    });

  return (
    <>
      <ToggleRow
        title="Ay rakamına yedek"
        description="Açıkken kasa raporu olmayan günün kapanmış föyü ayın cirosuna girer; rapor girilince rapor kazanır."
        label="ModPOS föyü ay rakamına yedek"
        onText="Açık"
        offText="Kapalı"
        checked={on}
        onChange={(v) => setConfirm(v)}
        disabled={pending}
      />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        tone="primary"
        confirmLabel={confirm ? "Aç" : "Kapat"}
        pending={pending}
        title={confirm ? "Ay rakamına yedek açılsın mı?" : "Ay rakamına yedek kapatılsın mı?"}
        description={
          confirm ? (
            <p>
              Kasa raporu (ya da LafPOS gün sonu) olmayan günün kapanmış ModPOS föyü ayın açık gün, ciro, ödenmez ve kart payına girer; gün yine &quot;rapor
              yok&quot; sayılır ve rapor girilince rapor kazanır. Föyde indirim olmadığı için o günlerin indirimi bilinmez; elle yazılan ay bilgisi her zaman kazanır.
            </p>
          ) : (
            <p>Föy yeniden hiçbir hesaba girmez; ayın rakamı yalnız kasa raporlarından (ve LafPOS&apos;tan) hesaplanır. Hiçbir kayıt silinmez.</p>
          )
        }
        onConfirm={() => save(confirm ?? false)}
      />
    </>
  );
}
