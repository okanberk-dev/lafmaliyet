"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { dayMonthYearTR } from "@/lib/asilpos/switch";
import { modposFetchConfirmLines } from "@/lib/modpos/ayarlar";
import { fetchModposDay, saveModposFallback } from "@/server/actions/modpos";

/**
 * Ayarlar › ModPOS (kasa föyü) › "Bu günü çek" (docs/MODPOS-API.md › Kota ve çekme sırası): bir gün seçilir (ilk değer
 * dün, en geç bugün), onay penceresi bugünkü kalan hakkı ve çekince kalacağını söyler; bugün seçildiyse föy kesin değildir.
 * Hak yoksa, anahtar kurulmamışsa ya da önizlemedeyse düğme kapalı, nedeni altında. Sayfa açılışı hiçbir zaman çekmez:
 * yalnız bu düğme ve sabah işi.
 */
export function ModposFetchForm({
  branchId,
  today,
  defaultDay,
  left,
  canFetch,
  blocked,
  stored,
}: {
  /** Kartın şubesi: o şubenin anahtarı ve hakkıyla çekilir */
  branchId: string;
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
  // Birden çok şubenin formu aynı sayfada: alanın kimliği şubeyle (Tuzla eski kimliği korur)
  const inputId = branchId === "tuzla" ? "modpos-gun" : `modpos-gun-${branchId}`;
  const [open, setOpen] = useState(false);
  const [pending, start] = useActionTransition();
  const problem = !day ? "Bir gün seçin" : day > today ? "İleri tarih çekilemez" : null;

  // Yanıt yolda kaybolursa çekim yapılmış (hak harcanmış) olabilir: pencere kapanır, "Yenile" önerilir; yeniden
  // denemeden önce sayfa kalan hakkı göstersin (maybeSaved)
  const run = () =>
    start(
      async () => {
        try {
          const res = await fetchModposDay(day, branchId);
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
        <Field label="Kasa günü" htmlFor={inputId} error={canFetch ? problem : null} className="max-sm:w-full">
          <Input
            id={inputId}
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
        {blocked ?? "Seçilen günün verisini ModPOS API'den hemen çeker ve günün çekim hakkından birini kullanır; yoksa her sabah dünün verisi kendiliğinden gelir."}
      </p>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        tone="primary"
        confirmLabel="Çek"
        pending={pending}
        title={`${day ? dayMonthYearTR(day) : ""} ModPOS API'den çekilsin mi?`}
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
export function ModposFallbackSwitch({
  on,
  branchId,
  branchName = null,
  from = null,
}: {
  on: boolean;
  /** Anahtarın şubesi (şube ayarı modpos) */
  branchId: string;
  /** Birden çok kasa açıkken başlıkta şubenin adı */
  branchName?: string | null;
  /** Şube ay yedeğinde başka şubenin ayarını kullanıyorsa o şube: anahtar burada değişmez, Şube ayarları'na gider */
  from?: { id: string; name: string } | null;
}) {
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [pending, start] = useActionTransition();

  const save = (next: boolean) =>
    start(async () => {
      const res = await saveModposFallback(next, branchId);
      setConfirm(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.on ? "Ay rakamına yedek açık" : "Ay rakamına yedek kapalı");
    });

  if (from) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
        <span className="min-w-0 flex-1 basis-56 text-ink">
          Ay rakamına yedek{branchName ? ` · ${branchName}` : ""}: <span className="font-medium">{on ? "açık" : "kapalı"}</span>
          <span className="block text-[13px] text-ink-mute">{from.name} ile aynı; ayrı ayar için Şube ayarları&apos;ndan ayırın</span>
        </span>
        <ButtonLink href={`/panel/subeler/${encodeURIComponent(branchId)}#modpos`} variant="secondary" size="sm" className="max-sm:w-full">
          Şube ayarları
        </ButtonLink>
      </div>
    );
  }

  return (
    <>
      <ToggleRow
        title={branchName ? `Ay rakamına yedek · ${branchName}` : "Ay rakamına yedek"}
        description="Açıkken kasa raporu olmayan günün kapanmış ModPOS API verisi ayın cirosuna girer; rapor girilince rapor kazanır."
        label="ModPOS API ay rakamına yedek"
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
              Kasa raporu (ya da AsilPOS gün sonu) olmayan günün kapanmış ModPOS API verisi ayın açık gün, ciro, ödenmez ve kart payına girer; gün yine &quot;rapor
              yok&quot; sayılır ve rapor girilince rapor kazanır. ModPOS API&apos;de indirim olmadığı için o günlerin indirimi bilinmez; elle yazılan ay bilgisi her zaman kazanır.
            </p>
          ) : (
            <p>ModPOS API verisi yeniden hiçbir hesaba girmez; ayın rakamı yalnız kasa raporlarından (ve AsilPOS&apos;tan) hesaplanır. Hiçbir kayıt silinmez.</p>
          )
        }
        onConfirm={() => save(confirm ?? false)}
      />
    </>
  );
}
