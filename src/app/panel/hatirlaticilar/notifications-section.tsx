"use client";

import { BellRing, ChevronDown, Eye, Mail, Plus, Send, Trash2 } from "lucide-react";
import { useContext, useEffect, useId, useOptimistic, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTimeTR } from "@/lib/format";
import { BLOCK_ROW_TEXT, type BlockReason, previewGroupText } from "@/lib/notify-recipients";
import { digestSummary } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { weeklyLogText } from "@/lib/weekly/text";
import {
  addRecipient,
  deleteRecipient,
  previewDigest,
  runDigestNow,
  saveNotificationSettings,
  sendTestNotification,
  setRecipientActive,
  setRecipientBranches,
} from "@/server/actions/reminders";
import type { NotifySettings } from "@/server/notify/settings";

import { FAB_AVOID } from "./fab-clear";
import { PaymentBranchesContext } from "./reminder-sheet";
import { Sheet, SHEET_BTN } from "./sheet";

export interface Recipient {
  id: number;
  email: string;
  name: string | null;
  active: boolean;
  /** Adres personel ya da pasif bir hesabın: listede durur, e-posta almaz (E-53) */
  blocked?: BlockReason | null;
  /** Adresin şubeleri; boş = bütün şubeler (şube kapsamı C P1-11: sabah e-postası şubenin başlığıyla ayrı gider) */
  branchIds?: string[];
  /** Seçili şubelerinin hiçbiri açık değil: sabah e-postası bu adrese gitmez (bütün şubelere de genişlemez) */
  branchClosed?: boolean;
}

/** Şubesi kapanmış adresin seçimdeki yer tutucusu (sunucuya gitmez) */
const CLOSED_BRANCH = "__kapali";

/** Zilden gelen bağlantının çapası: bölüm açılır */
const SECTION_ID = "e-posta-bildirimleri";
export interface LogRow {
  id: number;
  key: string;
  subject: string | null;
  recipients: string | null;
  ok: boolean;
  error: string | null;
  sentAt: string;
}
export type EmailStatus = { configured: boolean; cron: boolean; from: string; defaultFrom: string };

const BIG = "max-sm:h-12";

/** Aynı iletinin satır başına kaydı tek satırda gösterilir */
function dedupeLog(log: LogRow[]): LogRow[] {
  const seen = new Set<string>();
  return log.filter((l) => {
    const k = `${l.subject}|${l.sentAt.slice(0, 16)}|${l.ok}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * E-posta bildirimleri: kapalıyken tek satırlık özet (açık/kapalı, Resend yoksa uyarı, adres sayısı); açınca adresler,
 * gönderim ayarları, deneme, e-posta önizlemesi ve son gönderimler. `weekly`: hatırlatma e-postalarının satırının altında
 * Haftalık özet satırı (weekly-row.tsx).
 */
export function NotificationsSection({
  email,
  settings,
  recipients,
  log,
  weekly,
  className,
}: {
  email: EmailStatus;
  settings: NotifySettings;
  recipients: Recipient[];
  log: LogRow[];
  weekly?: ReactNode;
  className?: string;
}) {
  const [pending, start] = useActionTransition();
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState(settings.from ?? "");
  const [daysBefore, setDaysBefore] = useState(String(settings.invoiceDaysBefore));
  const [term, setTerm] = useState(String(settings.invoiceTermDays));
  const [removing, setRemoving] = useState<Recipient | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; group?: string | null; count: number; alreadySent: number; invoices: number; prices: number; syncError: boolean; system?: number; holds?: number; boxes?: string[]; sample: boolean } | null>(null);
  const addrRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const settingsForm = useId();
  // Zilin "Sabah e-postası … gitmiyor" satırı buraya getirir: bölüm kapalıysa açılır
  useEffect(() => {
    if (window.location.hash === `#${SECTION_ID}` && detailsRef.current) detailsRef.current.open = true;
  }, []);
  const [enabled, setEnabled] = useOptimistic(settings.emailEnabled);
  const [shownRecipients, patchRecipients] = useOptimistic(recipients, (state, p: { id: number; active?: boolean; remove?: boolean; branchIds?: string[] }) =>
    p.remove ? state.filter((r) => r.id !== p.id) : state.map((r) => (r.id === p.id ? { ...r, active: p.active ?? r.active, branchIds: p.branchIds ?? r.branchIds } : r)),
  );
  // Birden çok şube açıkken adres başına şube: "Bütün şubeler" ya da tek şube (sabah e-postası şubenin başlığıyla)
  const branchOptions = useContext(PaymentBranchesContext).options;

  const dirty = from !== (settings.from ?? "") || daysBefore !== String(settings.invoiceDaysBefore) || term !== String(settings.invoiceTermDays);
  const daysN = parseNumberTR(daysBefore);
  const termN = parseNumberTR(term);
  const daysError = daysN === null || daysN < 0 || daysN > 30 ? "0 ile 30 gün arasında olmalı" : null;
  const termError = termN === null || termN < 0 || termN > 120 ? "0 ile 120 gün arasında olmalı" : null;
  const addrInvalid = addr.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
  // Personel ya da pasif hesabın adresi gönderimde düşer: sayılmaz
  const activeRecipients = shownRecipients.filter((r) => r.active && !r.blocked).length;
  // Etkin adres var ama hepsi düşüyor: "Adres yok" denmez (liste etkin satırı gösterir), gidecek adres yoktur
  const allBlocked = activeRecipients === 0 && shownRecipients.some((r) => r.active && r.blocked);
  const missing = [!email.configured && "RESEND_API_KEY", !email.cron && "CRON_SECRET"].filter(Boolean) as string[]; // tech-metni
  const ready = enabled && email.configured && activeRecipients > 0;

  /** Anahtar yalnız açık/kapalıyı yazar (kayıtlı ayarlarla); "Gönderim ayarları"ndaki kaydedilmemiş taslak Kaydet'i bekler */
  const toggle = (on: boolean) =>
    start(async () => {
      setEnabled(on);
      const r = await saveNotificationSettings({ emailEnabled: on, from: settings.from, invoiceDaysBefore: settings.invoiceDaysBefore, invoiceTermDays: settings.invoiceTermDays });
      if (!r.ok) return void toast.error(r.error);
      toast.success(on ? "Hatırlatma e-postaları açıldı" : "Hatırlatma e-postaları kapatıldı");
    });

  const save = () =>
    start(async () => {
      const r = await saveNotificationSettings({
        emailEnabled: settings.emailEnabled,
        from: from.trim() || null,
        invoiceDaysBefore: Math.round(daysN ?? settings.invoiceDaysBefore),
        invoiceTermDays: Math.round(termN ?? settings.invoiceTermDays),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Bildirim ayarları kaydedildi");
    });

  const openPreview = () =>
    start(async () => {
      const r = await previewDigest();
      if (!r.ok) return void toast.error(r.error);
      setPreview(r.data);
    });

  const delivery: { text: string; tone: "green" | "amber" | "gray" } = !enabled
    ? { text: "E-postalar kapalı", tone: "gray" }
    : activeRecipients === 0
      ? { text: allBlocked ? "Gidecek adres yok" : "Adres yok", tone: "amber" }
      : !email.configured
        ? { text: `${activeRecipients} adres · gönderim bekliyor`, tone: "amber" }
        : email.cron
          ? { text: `${activeRecipients} adres · her sabah 08:00`, tone: "green" }
          : { text: `${activeRecipients} adres · elle gönderim`, tone: "amber" };

  return (
    // Yüzen "Ekle" bu bölümün üstüne gelince çekilir ("Adres ekle" ile yanyana iki "Ekle" olmasın)
    <section {...FAB_AVOID} id={SECTION_ID} className={cn("@container scroll-mt-20 rounded-3xl bg-panel", className)} aria-label="E-posta bildirimleri">
      <details ref={detailsRef} className="group/n">
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-3xl px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-ink" aria-hidden="true">
            <Mail size={18} strokeWidth={1.75} />
            <span className={cn("absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-panel", ready ? "bg-good" : enabled ? "bg-brass-500" : "bg-ink-quiet")} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-6 font-semibold tracking-tight text-ink">E-posta bildirimleri</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {/* Bağlıyken yazılmaz (bilinen durum); yalnız anahtar yoksa uyarır */}
              {email.configured ? null : (
                <Badge tone="red" dot>
                  Resend bağlı değil
                </Badge>
              )}
              <Badge tone={delivery.tone} dot>
                {delivery.text}
              </Badge>
            </span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-ink-quiet transition-transform group-open/n:rotate-180" aria-hidden="true" />
        </summary>

        <div className="space-y-4 px-3 pb-4 sm:px-5 sm:pb-5">
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Hatırlatma e-postaları</p>
              <p className="mt-0.5 text-xs leading-5 break-words text-ink-mute">
                Zamanı gelen ödemeler her sabah tek e-postada gider · {email.from}
              </p>
              {/* Aynı anahtar personelin e-postalarını da durdurur (checklist-alerts, karaoke/staff-mail); kapatan bunu bilsin */}
              <p className="mt-0.5 text-xs leading-5 text-pretty text-ink-mute">
                Kapatınca personelin kontrol listesi ve karaoke e-postaları ile sistem uyarısı e-postası da durur. Kasa e-postaları ayrı: Kasa › Rapor alıcıları.
              </p>
            </div>
            <Switch checked={enabled} showText onText="Açık" offText="Kapalı" label="Hatırlatma e-postaları" disabled={pending} className="pointer-coarse:h-11" onChange={toggle} />
          </div>
          {weekly}

          {missing.length ? (
            <Notice
              tone="neutral"
              title={!email.configured ? "E-posta gönderimi kurulmadı" : "Sabah gönderimi kendiliğinden çalışmaz"}
              text={!email.configured ? "Adresler ve ayarlar şimdiden kaydedilebilir." : "Elle gönderebilirsiniz."}
              tech={
                <>
                  {!email.configured ? (
                    <p>
                      RESEND_API_KEY Vercel ortam değişkenlerine (yerelde .env.local) eklenince e-postalar gitmeye başlar; adresler ve ayarlar şimdiden kaydedilebilir.
                    </p>
                  ) : null}
                  {!email.cron ? <p>CRON_SECRET yok: sabah gönderimi kendiliğinden çalışmaz, elle gönderebilirsiniz.</p> : null}
                </>
              }
            />
          ) : null}

          <div>
            <p className="mb-1.5 px-1 text-[13px] font-medium text-ink-soft">Bildirim adresleri</p>
            <div className="rounded-2xl bg-surface p-1.5 ring-1 ring-line">
              {shownRecipients.length === 0 ? (
                <p className="px-3 py-4 text-sm text-ink-mute">Henüz bildirim adresi yok. Aşağıdan bir e-posta ekleyin; hatırlatmalar bu adreslere gider.</p>
              ) : (
                <ul>
                  {shownRecipients.map((r, i) => (
                    <li key={r.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2", i > 0 && "border-t border-ink/[0.06]")}>
                      <Avatar name={r.name || r.email} size="sm" />
                      <div className={cn("min-w-0 flex-1", !r.active && "opacity-60")}>
                        <p className="text-sm font-medium break-all text-ink">{r.name || r.email}</p>
                        <p className="text-xs break-all text-ink-mute">{r.name ? r.email : r.blocked ? null : r.active ? "Hatırlatma alır" : "Duraklatıldı"}</p>
                        {r.blocked ? <p className="text-xs font-medium text-bad">{BLOCK_ROW_TEXT[r.blocked]}</p> : null}
                        {r.branchClosed ? <p className="text-xs font-medium text-warn">Seçili şubesi kapalı: e-posta gitmez. Başka bir şube ya da Bütün şubeler seçin</p> : null}
                      </div>
                      <Switch
                        checked={r.active}
                        label={`${r.email} bildirim alsın`}
                        disabled={pending}
                        className="pointer-coarse:h-11"
                        onChange={(v) =>
                          start(async () => {
                            patchRecipients({ id: r.id, active: v });
                            const res = await setRecipientActive(r.id, v);
                            if (!res.ok) toast.error(res.error);
                          })
                        }
                      />
                      <IconButton label={`${r.email} adresini sil`} tone="danger" onClick={() => setRemoving(r)} className="pointer-coarse:size-11">
                        <Trash2 size={15} />
                      </IconButton>
                      {branchOptions.length > 1 || r.branchClosed ? (
                        // Kendi satırında, adresin altında: dar ekranda seçimin metni ("Yalnız Marina") kırpılmasın
                        <div className="basis-full pl-11">
                          <Select
                            aria-label={`${r.email} hangi şubenin e-postasını alsın`}
                            value={r.branchClosed ? CLOSED_BRANCH : (r.branchIds?.[0] ?? "")}
                            disabled={pending}
                            className="h-9 w-auto max-w-full text-xs pointer-coarse:h-11"
                            onChange={(e) => {
                              const ids = e.target.value ? [e.target.value] : [];
                              start(async () => {
                                patchRecipients({ id: r.id, branchIds: ids });
                                const res = await setRecipientBranches(r.id, ids);
                                if (!res.ok) toast.error(res.error);
                              });
                            }}
                          >
                            {r.branchClosed ? (
                              <option value={CLOSED_BRANCH} disabled>
                                Şubesi kapalı
                              </option>
                            ) : null}
                            <option value="">Bütün şubeler</option>
                            {branchOptions.map((b) => (
                              <option key={b.id} value={b.id}>
                                Yalnız {b.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form
              className="mt-2 grid gap-2 @xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                if (addrInvalid) return void toast.error("Geçerli bir e-posta girin");
                start(async () => {
                  const r = await addRecipient(addr, name || null);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`${addr.trim()} eklendi`);
                  setAddr("");
                  setName("");
                  addrRef.current?.focus();
                });
              }}
            >
              <Input
                ref={addrRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="ad@ornek.com"
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                aria-label="Bildirim e-postası"
                aria-invalid={addrInvalid || undefined}
                className={BIG}
              />
              <Input placeholder="Ad (isteğe bağlı)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Ad" className={BIG} />
              <Button type="submit" disabled={pending || !addr.trim()} className="max-sm:h-12">
                <Plus size={16} /> Adres ekle
              </Button>
            </form>
          </div>

          <details className="group rounded-2xl bg-surface ring-1 ring-line">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">Gönderim ayarları</span>
                <span className="block text-xs text-ink-mute">
                  Faturadan {settings.invoiceDaysBefore} gün önce haber · vadesiz faturada {settings.invoiceTermDays} gün vade
                </span>
              </span>
              <ChevronDown size={16} className="shrink-0 text-ink-quiet transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <form
              id={settingsForm}
              className="px-4 pb-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty && !daysError && !termError) save();
              }}
            >
              <div className="mt-1 grid gap-3 @lg:grid-cols-2">
                <Field label="Gönderen" htmlFor={`${settingsForm}-from`} className="@lg:col-span-2" hint={`Boş bırakılırsa: ${email.defaultFrom}`}>
                  <Input id={`${settingsForm}-from`} value={from} onChange={(e) => setFrom(e.target.value)} placeholder={email.defaultFrom} className={BIG} />
                </Field>
                <Field label="Fatura vadesinden kaç gün önce" htmlFor={`${settingsForm}-days`} tip="Ödenmemiş faturalar için ilk hatırlatma." error={daysError}>
                  <div className="relative">
                    <NumberInput id={`${settingsForm}-days`} inputMode="numeric" value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)} aria-invalid={Boolean(daysError) || undefined} className={cn("pr-10", BIG)} />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">gün</span>
                  </div>
                </Field>
                <Field
                  label="Vadesiz faturada vade"
                  htmlFor={`${settingsForm}-term`}
                  tip="Vade tarihi girilmemiş ödenmemiş faturalar, fatura tarihinden bu kadar gün sonra vadeli sayılır. Tedarikçiler'de tedarikçinin bilgilerine vade günü yazılıysa onun faturalarında o geçer."
                  error={termError}
                >
                  <div className="relative">
                    <NumberInput id={`${settingsForm}-term`} inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} aria-invalid={Boolean(termError) || undefined} className={cn("pr-10", BIG)} />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">gün</span>
                  </div>
                </Field>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                {dirty ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFrom(settings.from ?? "");
                      setDaysBefore(String(settings.invoiceDaysBefore));
                      setTerm(String(settings.invoiceTermDays));
                    }}
                    className="max-sm:h-11"
                  >
                    Geri al
                  </Button>
                ) : null}
                <Button type="submit" disabled={!dirty || pending || Boolean(daysError || termError)} className="max-sm:h-11">
                  Kaydet
                </Button>
              </div>
            </form>
          </details>

          <div className="space-y-1.5">
            <div className="grid gap-2 @lg:flex @lg:flex-wrap">
              <Button variant="secondary" disabled={pending} onClick={openPreview} className="max-sm:h-12 max-sm:justify-start">
                <Eye size={15} /> E-postayı önizle
              </Button>
              <Button
                variant="secondary"
                className="max-sm:h-12 max-sm:justify-start"
                disabled={pending || !email.configured || activeRecipients === 0}
                onClick={() =>
                  start(async () => {
                    const r = await sendTestNotification();
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(`Deneme e-postası ${r.data.recipients} adrese gönderildi`, r.data.skipped ? { description: `Gönderilmedi: ${r.data.skipped}` } : undefined);
                  })
                }
              >
                <Send size={15} /> Deneme e-postası gönder
              </Button>
              <Button
                variant="secondary"
                className="max-sm:h-12 max-sm:justify-start"
                disabled={pending || !email.configured}
                onClick={() =>
                  start(async () => {
                    const r = await runDigestNow();
                    if (!r.ok) return void toast.error(r.error);
                    // Yalnız fatura, zam ya da eşitleme hatası için giden e-posta "0 hatırlatma" yazmasın
                    if (r.data.status === "sent") toast.success(`Sabah e-postası ${r.data.recipients} adrese gönderildi`, { description: digestSummary(r.data) || undefined });
                    else if (r.data.status === "skipped") toast.message(r.data.reason);
                  })
                }
              >
                <BellRing size={15} /> Bugünküleri şimdi gönder
              </Button>
            </div>
            {!email.configured ? (
              <p className="px-1 text-xs text-ink-mute">Gönderim düğmeleri Resend anahtarı girilince açılır; önizleme her zaman çalışır.</p>
            ) : activeRecipients === 0 ? (
              <p className="px-1 text-xs text-ink-mute">
                {allBlocked ? "Etkin adreslerin hepsi personel, müdür ya da pasif hesaba ait; yöneticinin ya da muhasebecinin adresini ekleyin." : "Deneme için en az bir etkin adres ekleyin."}
              </p>
            ) : null}
          </div>

          <div>
            <p className="mb-1.5 px-1 text-[13px] font-medium text-ink-soft">Son gönderimler</p>
            {log.length ? (
              <ul className="space-y-2 rounded-2xl bg-surface p-3 ring-1 ring-line">
                {dedupeLog(log).map((l) => {
                  // Haftalık özetin gidemeyen kaydı adıyla, iç işaretleri ("Yeniden denenecek:") olmadan
                  const weekly = weeklyLogText(l);
                  const error = weekly ? weekly.error : l.error;
                  return (
                    <li key={l.id} className="flex items-start gap-2 text-[13px]">
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", l.ok ? "bg-good" : "bg-bad")} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="break-words text-ink">{l.ok ? l.subject : (weekly?.title ?? "Gönderilemedi")}</span>
                        <span className="block text-xs break-words text-ink-mute">
                          {dateTimeTR(l.sentAt)}
                          {l.ok && l.recipients ? ` · ${l.recipients}` : ""}
                          {!l.ok && error ? ` · ${error}` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-3 py-3 text-[13px] text-ink-mute ring-1 ring-line">Henüz gönderim yok.</p>
            )}
          </div>
        </div>
      </details>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Adres silinsin mi?"
        description={removing ? `${removing.email} artık hatırlatma almayacak. Geçici olarak durdurmak için silmek yerine anahtarı kapatabilirsiniz.` : undefined}
        confirmLabel="Adresi sil"
        pending={pending}
        onConfirm={() => {
          const r = removing;
          if (!r) return;
          setRemoving(null);
          start(async () => {
            patchRecipients({ id: r.id, remove: true });
            const res = await deleteRecipient(r.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success(`${r.email} silindi`);
          });
        }}
      />

      {preview ? (
        <Sheet
          open
          onClose={() => setPreview(null)}
          size="lg"
          title="E-posta önizlemesi"
          description={`${previewGroupText(preview.group ?? null)}${
            preview.sample
              ? "Bugün haber verilecek ödeme, yeni fatura ya da zam yok; örnek bir satırla gösteriliyor."
              : `Bugün: ${digestSummary(preview)}.${preview.alreadySent ? ` ${preview.alreadySent} hatırlatma zaten gönderildi.` : ""} Gönderilmez, yalnızca görünüm.`
          }`}
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
          <iframe title="Hatırlatma e-postası önizlemesi" srcDoc={preview.html} sandbox="" className="block h-[min(70dvh,640px)] w-full border-0 bg-panel" />
        </Sheet>
      ) : null}
    </section>
  );
}

