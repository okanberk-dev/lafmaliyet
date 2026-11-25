"use client";

import { Link2, Mail, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { ToggleRow } from "@/components/ui/toggle-row";
import { BLOCK_ROW_TEXT } from "@/lib/notify-recipients";
import { setBranchSettingLink } from "@/server/actions/branch-settings";
import { sendCashTestEmail, updateCashSettings } from "@/server/actions/cash-report";
import type { CashSettingsCardData } from "@/server/cash/settings-card";

/**
 * Kasa raporunun gideceği e-posta adresleri, WhatsApp numarası ve çalışanların kısa gün sonu e-postası (yalnız
 * yönetici; şube başına, docs/SUBE.md › Şube başına ayarlar). Kasa sayfası ve Şube ayarları ekranı aynı kartı çizer
 * (veri src/server/cash/settings-card.ts). Birden çok kasa açıkken alıcılarda "Diğer şubeyle aynı": açıkken form çizilmez,
 * bağlandığı şubenin alıcıları salt okunur görünür; kapatılınca bugünkü değerler şubeye kopyalanır. Çalışan listesi her
 * şubenin kendisinin. `blocked`: kayıtlı adreslerden personel ya da pasif hesabın olanlar (E-53): gönderimde düşer,
 * burada ve zilde söylenir. `anchor`: kartın çapası (zilin bağlantısı #rapor-alicilari)
 */
export function CashSettingsCard({
  settings,
  emailConfigured,
  blocked = [],
  branchId,
  branchName = null,
  link = null,
  showStaff = true,
  anchor = "rapor-alicilari",
}: Partial<Pick<CashSettingsCardData, "blocked" | "branchName" | "link" | "showStaff">> &
  Pick<CashSettingsCardData, "settings" | "branchId"> & { emailConfigured: boolean; anchor?: string }) {
  const [recipients, setRecipients] = useState(settings.recipients.join("\n"));
  const [emailEnabled, setEmailEnabled] = useState(settings.emailEnabled);
  const [whatsapp, setWhatsapp] = useState(settings.whatsapp ?? "");
  const [staffRecipients, setStaffRecipients] = useState((settings.staffRecipients ?? []).join("\n"));
  const [staffAmounts, setStaffAmounts] = useState(!!settings.staffAmounts);
  /** "Aynı" seçimini değiştirme onayı: "link" bağlar (hedefle), "own" ayırır (kopyalar) */
  const [confirm, setConfirm] = useState<null | "link" | "own">(null);
  const [target, setTarget] = useState(link?.targets[0]?.id ?? "");
  const [pending, start] = useActionTransition();
  const linked = link?.mode.kind === "linked";
  const here = branchName ?? "Bu şube";

  function save() {
    start(async () => {
      // Alıcılar başka şubeninkiyse yalnız çalışan listesi gider (sunucu bağlı şubeye alıcı yazmaz)
      // Çalışan listesi yalnız alanı çizildiyse (ModPOS'lu şubenin kartında yok; sunucu gönderilmeyene dokunmaz)
      const res = await updateCashSettings({ branchId, ...(linked ? {} : { recipients, emailEnabled, whatsapp }), ...(showStaff ? { staffRecipients, staffAmounts } : {}) });
      if (!res.ok) return void toast.error(res.error);
      if (!linked) {
        setRecipients(res.data.recipients.join("\n"));
        setWhatsapp(res.data.whatsapp ?? "");
      }
      if (showStaff) setStaffRecipients((res.data.staffRecipients ?? []).join("\n"));
      toast.success("Kasa raporu alıcıları kaydedildi", { description: linked ? undefined : res.data.recipients.join(", ") || "E-posta kapalı" });
    });
  }

  function test() {
    start(async () => {
      const res = await sendCashTestEmail(branchId);
      if (res.ok) {
        toast.success(`Deneme e-postası ${res.data.to} adrese gitti`, {
          description: res.data.skipped ? `Gönderilmedi: ${res.data.skipped}. Gelmezse istenmeyen (spam) klasörüne bakın.` : "Gelmezse istenmeyen (spam) klasörüne bakın.",
        });
      }
      else toast.error(res.error, { duration: 10_000 });
    });
  }

  function changeLink(to: "link" | "own") {
    start(async () => {
      const res = await setBranchSettingLink({ branchId, group: "kasa.rapor", sameAs: to === "link" ? target : null });
      if (!res.ok) return void toast.error(res.error);
      setConfirm(null);
      toast.success(to === "link" ? "Alıcılar artık ortak" : `${here} kendi alıcılarını kullanıyor`, {
        description: to === "link" ? undefined : "Bugünkü değerler kopyalandı; şimdi ayrı düzenleyebilirsiniz.",
      });
    });
  }

  const targetName = link?.targets.find((t) => t.id === target)?.name ?? link?.targets[0]?.name ?? "";

  return (
    <Card id={anchor} className="scroll-mt-20">
      <CardHeader
        icon={<Mail />}
        title={branchName ? `Rapor alıcıları · ${branchName}` : "Rapor alıcıları"}
        description={branchName ? `Personel ${branchName} kasasının raporunu gönderince bu adreslere e-posta gider` : "Personel raporu gönderince bu adreslere e-posta gider"}
      />
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
        {link && (linked || link.targets.length) ? (
          <ToggleRow
            title={linked ? `${link.toName ?? targetName} ile aynı` : link.targets.length === 1 ? `${targetName} ile aynı` : "Diğer şubeyle aynı"}
            description={linked ? `${here}, ${link.toName} şubesinin alıcılarını ve WhatsApp numarasını kullanır` : "Açarsanız bu şubenin alıcıları silinir, seçtiğiniz şubeninki kullanılır"}
            label="Diğer şubeyle aynı alıcılar"
            checked={linked}
            disabled={pending}
            onChange={(v) => setConfirm(v ? "link" : "own")}
          />
        ) : null}
        {link?.sharedWith.length ? (
          <p className="flex items-start gap-2 text-[13px] text-ink-mute">
            <Link2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {link.sharedWith.join(", ")} {link.sharedWith.length > 1 ? "şubeleri" : "şubesi"} de bu alıcıları kullanıyor; buradaki değişiklik orada da geçerli olur.
            </span>
          </p>
        ) : null}
        {linked ? (
          <div className="space-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
            <p className="text-ink">
              <span className="text-ink-mute">E-posta:</span> {settings.emailEnabled ? settings.recipients.join(", ") || "alıcı yok" : "kapalı"}
            </p>
            {settings.whatsapp ? (
              <p className="text-ink">
                <span className="text-ink-mute">WhatsApp:</span> {settings.whatsapp}
              </p>
            ) : null}
            {link?.mode.kind === "linked" ? (
              <ButtonLink href={`/panel/subeler/${encodeURIComponent(link.mode.to)}#rapor-alicilari`} variant="secondary" size="sm" className="max-sm:w-full">
                {link.toName} şubesinde düzenle
              </ButtonLink>
            ) : null}
          </div>
        ) : (
          <>
            <ToggleRow title="E-posta gönder" description="Kapalıyken rapor yalnız panelde ve WhatsApp'ta" label="Kasa raporu e-postası" checked={emailEnabled} onChange={setEmailEnabled} />
            <Field label="E-posta adresleri" htmlFor={`${anchor}-alicilar`} hint="Her satıra bir adres (en çok 10)">
              <Textarea id={`${anchor}-alicilar`} value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={3} spellCheck={false} autoCapitalize="none" />
            </Field>
          </>
        )}
        {showStaff ? (
          <>
            <Field label="Çalışanlar (LafPOS gün sonu, kısa e-posta)" htmlFor={`${anchor}-calisan`} hint="Her satıra bir adres (en çok 20). Gün sonu alınınca kısa özet gider; rapor ayrıntısı gitmez. Bu liste şubenin kendisinin">
              <Textarea id={`${anchor}-calisan`} value={staffRecipients} onChange={(e) => setStaffRecipients(e.target.value)} rows={3} spellCheck={false} autoCapitalize="none" />
            </Field>
            <ToggleRow title="Çalışan e-postasında tutarlar" description="Açıkken ciro ve ödeme türleri de yazar; kapalıyken yalnız gün sonu alındı ve fiş sayısı" label="Çalışan e-postasında tutarlar" checked={staffAmounts} onChange={setStaffAmounts} />
          </>
        ) : null}
        {linked ? null : (
          <Field label="WhatsApp numarası" htmlFor={`${anchor}-wp`} hint="İsteğe bağlı: “WhatsApp ile gönder” bu sohbeti açar; boşsa kişi ya da grup seçilir">
            <Input id={`${anchor}-wp`} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" placeholder="ör. 0532 123 45 67" autoComplete="off" />
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          {linked && !showStaff ? null : (
            <Button onClick={save} disabled={pending}>
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          )}
          <Button variant="secondary" onClick={test} disabled={pending || !emailConfigured}>
            <Send size={14} /> Deneme e-postası
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm === "own"}
        onClose={() => setConfirm(null)}
        onConfirm={() => changeLink("own")}
        pending={pending}
        tone="primary"
        confirmLabel="Ayır"
        title={`${here} kendi alıcılarını kullansın mı?`}
        description={`Bugünkü değerler (${link?.toName ?? "bağlı"} şubesinin alıcıları ve WhatsApp numarası) bu şubeye kopyalanır; sonra ayrı düzenlenir.`}
      />
      <ConfirmDialog
        open={confirm === "link"}
        onClose={() => setConfirm(null)}
        onConfirm={() => changeLink("link")}
        pending={pending}
        tone="primary"
        confirmLabel="Aynı yap"
        title={`${here} ve ${link && link.targets.length > 1 ? "seçilen şube" : targetName} aynı alıcıları kullansın mı?`}
        description={
          <div className="space-y-3">
            <p>Bu şubenin kendi alıcıları ve WhatsApp numarası silinir; değer tek yerden, {targetName} şubesinden düzenlenir.</p>
            {link && link.targets.length > 1 ? (
              <Field label="Hangi şubeyle aynı" htmlFor={`${anchor}-hedef`}>
                <Select id={`${anchor}-hedef`} value={target} onChange={(e) => setTarget(e.target.value)}>
                  {link.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        }
      />
    </Card>
  );
}
