"use client";

import { Mail, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
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
  const [pending, start] = useActionTransition();

  function save() {
    start(async () => {
      const res = await updateCashSettings({ recipients, emailEnabled, whatsapp });
      if (!res.ok) return void toast.error(res.error);
      setRecipients(res.data.recipients.join("\n"));
      setWhatsapp(res.data.whatsapp ?? "");
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
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
            E-posta kurulmamış: Vercel&apos;de RESEND_API_KEY tanımlı değil. Raporlar kaydedilir, WhatsApp ile gönderilebilir.
          </p>
        ) : null}
        {blocked.length ? (
          <div role="note" className="space-y-1 rounded-xl bg-bad-soft px-3 py-2 text-[13px] leading-5 text-bad">
            {blocked.map((b) => (
              <p key={b.email} className="break-words">
                <span className="font-medium">{b.email}</span>: {BLOCK_ROW_TEXT[b.reason].toLocaleLowerCase("tr-TR")}
              </p>
            ))}
            <p>Kasa e-postasında karaoke ön ödemesi var; bu adresi listeden çıkarın ya da doğru adresi yazın.</p>
          </div>
        ) : null}
        <ToggleRow title="E-posta gönder" description="Kapalıyken rapor yalnız panelde ve WhatsApp'ta" label="Kasa raporu e-postası" checked={emailEnabled} onChange={setEmailEnabled} />
        <Field label="E-posta adresleri" htmlFor="kasa-alicilar" hint="Her satıra bir adres (en çok 10)">
          <Textarea id="kasa-alicilar" value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={3} spellCheck={false} autoCapitalize="none" />
        </Field>
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
