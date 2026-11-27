"use client";

import { Eye, Send } from "lucide-react";
import { useOptimistic, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { recipientsText } from "@/lib/weekly/text";
import { previewWeekly, saveWeeklyEnabled, sendWeeklySample } from "@/server/actions/weekly";

import { Sheet, SHEET_BTN } from "./sheet";

/** Ödemeler'deki satırın verisi (src/server/weekly/send.ts loadWeeklyPanel) */
export interface WeeklyPanel {
  enabled: boolean;
  /** Etkin yöneticilerin adı */
  recipients: string[];
  /** Bu haftanın durumu (src/lib/weekly/text.ts weeklyStatusText) */
  status: string;
  /** Açıkken durum: anahtar açılırken, sunucunun yanıtından önce gösterilir */
  onStatus: string;
}

type Preview = { subject: string; html: string; items: number; failed: string[]; empty: boolean; note?: string | null };

/**
 * E-posta bildirimleri › Haftalık özet: açma / kapama, kime gittiği, bu haftanın durumu, önizleme ve kendine örnek
 * (docs/HAFTALIK-OZET.md). Hatırlatma e-postalarının anahtarından ayrı.
 */
export function WeeklyRow({ weekly, emailConfigured }: { weekly: WeeklyPanel; emailConfigured: boolean }) {
  const [pending, start] = useActionTransition();
  // Hangi düğme bekliyor ("Hazırlanıyor…"): geçişten önce, eşzamanlı yazılır (geçişin içindeki durum sonunda görünür)
  const [which, setWhich] = useState<"toggle" | "preview" | "sample" | null>(null);
  const [enabled, setEnabled] = useOptimistic(weekly.enabled);
  const [preview, setPreview] = useState<Preview | null>(null);

  const toggle = (on: boolean) => {
    setWhich("toggle");
    start(async () => {
      setEnabled(on);
      const r = await saveWeeklyEnabled(on);
      if (!r.ok) return void toast.error(r.error);
      toast.success(on ? "Haftalık özet açıldı" : "Haftalık özet kapatıldı");
    });
  };

  const openPreview = () => {
    setWhich("preview");
    start(async () => {
      const r = await previewWeekly();
      if (!r.ok) return void toast.error(r.error);
      setPreview(r.data);
    });
  };

  const sendSample = () => {
    setWhich("sample");
    start(async () => {
      const r = await sendWeeklySample();
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Örnek ${r.data.to} adresine gönderildi`, { description: r.data.items ? `${r.data.items} madde` : "Bu hafta dikkat isteyen bir şey yok" });
    });
  };

  return (
    <div className="rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Haftalık özet</p>
          <p className="mt-0.5 text-xs leading-5 break-words text-ink-mute">
            Her pazartesi sabahı kısa bir e-posta: liraya etkisine göre sıralı en çok 5 madde, her biri ilgili ekranı açar. {recipientsText(weekly.recipients)}
          </p>
        </div>
        <Switch checked={enabled} showText onText="Açık" offText="Kapalı" label="Haftalık özet" disabled={pending} className="pointer-coarse:h-11" onChange={toggle} />
      </div>
      <p className="mt-2 text-xs leading-5 break-words text-ink-soft">{enabled === weekly.enabled ? weekly.status : enabled ? weekly.onStatus : "Kapalı: pazartesi e-postası gitmez."}</p>
      <div className="mt-3 grid gap-2 @lg:flex @lg:flex-wrap">
        <Button variant="secondary" disabled={pending} onClick={openPreview} className="max-sm:h-12 max-sm:justify-start">
          <Eye size={15} /> {pending && which === "preview" ? "Hazırlanıyor…" : "Haftalık özeti önizle"}
        </Button>
        <Button variant="secondary" disabled={pending || !emailConfigured} onClick={sendSample} className="max-sm:h-12 max-sm:justify-start">
          <Send size={15} /> {pending && which === "sample" ? "Hazırlanıyor…" : "Örneği bana gönder"}
        </Button>
      </div>
      {!emailConfigured ? <p className="mt-1.5 px-1 text-xs text-ink-mute">Örnek gönderimi Resend anahtarı girilince açılır; önizleme her zaman çalışır.</p> : null}

      {preview ? (
        <Sheet
          open
          onClose={() => setPreview(null)}
          size="lg"
          title="Haftalık özet önizlemesi"
          description={`${preview.empty ? "Bu hafta dikkat isteyen bir şey yok; e-posta tek satırla gider. Gönderilmez." : `Pazartesi giden e-posta böyle görünür; gönderilmez. ${preview.items} madde.`}${preview.failed.length ? ` Okunamadı: ${preview.failed.join(", ")}.` : ""}${preview.note ? ` ${preview.note}` : ""}`}
          bodyClassName="px-0 sm:px-0 pb-0"
          footer={
            <Button variant="secondary" onClick={() => setPreview(null)} className={SHEET_BTN}>
              Kapat
            </Button>
          }
        >
          <p className="px-5 pb-2 text-[13px] text-ink-mute sm:px-6">
            Konu: <span className="font-medium break-words text-ink">{preview.subject}</span>
          </p>
          <iframe title="Haftalık özet önizlemesi" srcDoc={preview.html} sandbox="" className="block h-[min(70dvh,640px)] w-full border-0 bg-panel" />
        </Sheet>
      ) : null}
    </div>
  );
}
