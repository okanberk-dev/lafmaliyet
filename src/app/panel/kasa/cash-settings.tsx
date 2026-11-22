"use client";

import { Mail, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { ToggleRow } from "@/components/ui/toggle-row";
import { BLOCK_ROW_TEXT, type DroppedRecipient } from "@/lib/notify-recipients";
import { sendCashTestEmail, updateCashSettings } from "@/server/actions/cash-report";
import type { CashSettings } from "@/server/data/cash-reports";

/**
 * Kasa raporunun gideceği e-posta adresleri ve WhatsApp numarası (yalnız yönetici). `blocked`: kayıtlı adreslerden
 * personel ya da pasif hesabın olanlar (E-53): gönderimde düşer, burada ve zilde söylenir
 */
export function CashSettingsCard({ settings, emailConfigured, blocked = [] }: { settings: CashSettings; emailConfigured: boolean; blocked?: DroppedRecipient[] }) {
  const [recipients, setRecipients] = useState(settings.recipients.join("\n"));
  const [emailEnabled, setEmailEnabled] = useState(settings.emailEnabled);
  const [whatsapp, setWhatsapp] = useState(settings.whatsapp ?? "");
  const [staffRecipients, setStaffRecipients] = useState((settings.staffRecipients ?? []).join("\n"));
  const [staffAmounts, setStaffAmounts] = useState(!!settings.staffAmounts);
  const [pending, start] = useActionTransition();

  function save() {
    start(async () => {
      const res = await updateCashSettings({ recipients, emailEnabled, whatsapp, staffRecipients, staffAmounts });
      if (!res.ok) return void toast.error(res.error);
      setRecipients(res.data.recipients.join("\n"));
      setWhatsapp(res.data.whatsapp ?? "");
      setStaffRecipients((res.data.staffRecipients ?? []).join("\n"));
      toast.success("Kasa raporu alıcıları kaydedildi", { description: res.data.recipients.join(", ") || "E-posta kapalı" });
    });
  }

  function test() {
    start(async () => {
      const res = await sendCashTestEmail();
      if (res.ok) {
        toast.success(`Deneme e-postası ${res.data.to} adrese gitti`, {
          description: res.data.skipped ? `Gönderilmedi: ${res.data.skipped}. Gelmezse istenmeyen (spam) klasörüne bakın.` : "Gelmezse istenmeyen (spam) klasörüne bakın.",
        });
      }
      else toast.error(res.error, { duration: 10_000 });
    });
  }

  return (
    <Card id="rapor-alicilari" className="scroll-mt-20">
      <CardHeader icon={<Mail />} title="Rapor alıcıları" description="Personel raporu gönderince bu adreslere e-posta gider" />
      <div className="space-y-3 px-5 pb-5">
        {!emailConfigured ? (
          <Notice
            tone="neutral"
            size="sm"
            title="E-posta gönderimi kurulmadı: raporlar WhatsApp'la gider"
            tech="Vercel'de RESEND_API_KEY tanımlı değil. Raporlar yine kaydedilir."
          />
        ) : null}
        {blocked.length ? (
          <Notice
            tone="bad"
            size="sm"
            title="Bu adreslere rapor gitmez"
            text={
              <>
                {blocked.map((b) => (
                  <span key={b.email} className="block break-words">
                    <span className="font-medium text-ink">{b.email}</span>: {BLOCK_ROW_TEXT[b.reason].toLocaleLowerCase("tr-TR")}
                  </span>
                ))}
                {/* Neden kişiye göre: personele karaoke ön ödemesi gitmesin; pasif hesaba e-posta hiç gitmez */}
                <span className="block">
                  {blocked.some((b) => b.reason === "staff") ? "Kasa e-postasında karaoke ön ödemesi var; personel hesabına gitmez." : "Pasif hesaba e-posta gitmez."}{" "}
                  {blocked.length > 1 ? "Bu adresleri" : "Bu adresi"} listeden çıkarın ya da doğru adresi yazın.
                </span>
              </>
            }
          />
        ) : null}
        <ToggleRow title="E-posta gönder" description="Kapalıyken rapor yalnız panelde ve WhatsApp'ta" label="Kasa raporu e-postası" checked={emailEnabled} onChange={setEmailEnabled} />
        <Field label="E-posta adresleri" htmlFor="kasa-alicilar" hint="Her satıra bir adres (en çok 10)">
          <Textarea id="kasa-alicilar" value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={3} spellCheck={false} autoCapitalize="none" />
        </Field>
        <Field label="Çalışanlar (LafPOS gün sonu, kısa e-posta)" htmlFor="kasa-calisan" hint="Her satıra bir adres (en çok 20). Gün sonu alınınca kısa özet gider; rapor ayrıntısı gitmez">
          <Textarea id="kasa-calisan" value={staffRecipients} onChange={(e) => setStaffRecipients(e.target.value)} rows={3} spellCheck={false} autoCapitalize="none" />
        </Field>
        <ToggleRow title="Çalışan e-postasında tutarlar" description="Açıkken ciro ve ödeme türleri de yazar; kapalıyken yalnız gün sonu alındı ve fiş sayısı" label="Çalışan e-postasında tutarlar" checked={staffAmounts} onChange={setStaffAmounts} />
        <Field label="WhatsApp numarası" htmlFor="kasa-wp" hint="İsteğe bağlı: “WhatsApp ile gönder” bu sohbeti açar; boşsa kişi ya da grup seçilir">
          <Input id="kasa-wp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" placeholder="ör. 0532 123 45 67" autoComplete="off" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <Button variant="secondary" onClick={test} disabled={pending || !emailConfigured}>
            <Send size={14} /> Deneme e-postası
          </Button>
        </div>
      </div>
    </Card>
  );
}
