"use client";

import { Calculator, Copy, CreditCard, MessageCircle, Pencil, ReceiptText, RotateCw, Send, Wallet } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, NumberInput, Textarea } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { CASH_TOLERANCE, computeCash, diffKind, diffText, type CashReportFields } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { resendCashReportEmail, submitCashReport, type CashEmailOutcome } from "@/server/actions/cash-report";
import type { CashReportDTO } from "@/server/data/cash-reports";

import { copyText } from "../kullanicilar/password-field";
import { CashBreakdown, DIFF_TONE, DiffHeadline } from "./cash-summary";

type MoneyKey = "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "openingCash" | "cashOut" | "countedCash" | "handedOver" | "bankPos";
type Key = MoneyKey | "zNo" | "receipts" | "cashOutNote" | "note";
type Values = Record<Key, string>;

/** Boş bırakılamayan tutarlar (ötekiler boşsa 0; banka POS boşsa karşılaştırılmaz) */
const REQUIRED: MoneyKey[] = ["zTotal", "cash", "card", "openingCash", "countedCash"];
const LABELS: Record<MoneyKey, string> = {
  zTotal: "Toplam satış",
  cash: "Nakit",
  card: "Kart",
  mealCard: "Yemek kartı",
  online: "Online",
  other: "Diğer",
  openingCash: "Açılış",
  cashOut: "Gün içinde çıkan",
  countedCash: "Sayılan nakit",
  handedOver: "Teslim edilen",
  bankPos: "Banka POS",
};

const input = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

function initialValues(report: CashReportDTO | null, carry: { amount: number } | null): Values {
  if (report) {
    return {
      zNo: report.zNo ?? "",
      receipts: report.receipts === null ? "" : String(report.receipts),
      zTotal: input(report.zTotal),
      cash: input(report.cash),
      card: input(report.card),
      mealCard: report.mealCard ? input(report.mealCard) : "",
      online: report.online ? input(report.online) : "",
      other: report.other ? input(report.other) : "",
      openingCash: input(report.openingCash),
      cashOut: report.cashOut ? input(report.cashOut) : "",
      cashOutNote: report.cashOutNote ?? "",
      countedCash: input(report.countedCash),
      handedOver: report.handedOver ? input(report.handedOver) : "",
      bankPos: input(report.bankPos),
      note: report.note ?? "",
    };
  }
  return {
    zNo: "",
    receipts: "",
    zTotal: "",
    cash: "",
    card: "",
    mealCard: "",
    online: "",
    other: "",
    openingCash: carry ? input(carry.amount) : "",
    cashOut: "",
    cashOutNote: "",
    countedCash: "",
    handedOver: "",
    bankPos: "",
    note: "",
  };
}

/** Formdan rapor alanları; boş zorunlu ya da okunamayan tutar varsa hatalar */
function readValues(v: Values, date: string): { fields: CashReportFields | null; errors: Partial<Record<Key, string>> } {
  const errors: Partial<Record<Key, string>> = {};
  const amount = (k: MoneyKey): number | null => {
    const raw = v[k].trim();
    if (!raw) {
      if (REQUIRED.includes(k)) errors[k] = `${LABELS[k]} gerekli (yoksa 0 yazın)`;
      return null;
    }
    const n = parseNumberTR(raw);
    if (n === null || n < 0) {
      errors[k] = "Geçerli bir tutar yazın (ör. 1.250,50)";
      return null;
    }
    return Math.round(n * 100) / 100;
  };
  const a = Object.fromEntries((Object.keys(LABELS) as MoneyKey[]).map((k) => [k, amount(k)])) as Record<MoneyKey, number | null>;
  const receiptsRaw = v.receipts.trim();
  const receipts = receiptsRaw ? Number(receiptsRaw.replace(/\D/g, "")) : null;
  if (Object.keys(errors).length) return { fields: null, errors };
  const fields: CashReportFields = {
    date,
    zNo: v.zNo.trim() || null,
    receipts: receipts !== null && Number.isFinite(receipts) ? receipts : null,
    zTotal: a.zTotal ?? 0,
    cash: a.cash ?? 0,
    card: a.card ?? 0,
    mealCard: a.mealCard ?? 0,
    online: a.online ?? 0,
    other: a.other ?? 0,
    openingCash: a.openingCash ?? 0,
    cashOut: a.cashOut ?? 0,
    cashOutNote: v.cashOutNote.trim() || null,
    countedCash: a.countedCash ?? 0,
    handedOver: a.handedOver ?? 0,
    bankPos: a.bankPos,
    note: v.note.trim() || null,
  };
  if (fields.handedOver > fields.countedCash) errors.handedOver = "Teslim edilen, sayılan nakitten fazla olamaz";
  return Object.keys(errors).length ? { fields: null, errors } : { fields, errors };
}

/** Yazarken anlık hesap: zorunlular okunabiliyorsa olması gereken nakit ve fark */
function preview(v: Values): ReturnType<typeof computeCash> | null {
  const n = (k: MoneyKey) => (v[k].trim() ? parseNumberTR(v[k]) : null);
  const need = [n("cash"), n("openingCash"), n("countedCash")];
  if (need.some((x) => x === null)) return null;
  return computeCash({
    zTotal: n("zTotal") ?? 0,
    cash: n("cash") ?? 0,
    card: n("card") ?? 0,
    mealCard: n("mealCard") ?? 0,
    online: n("online") ?? 0,
    other: n("other") ?? 0,
    openingCash: n("openingCash") ?? 0,
    cashOut: n("cashOut") ?? 0,
    countedCash: n("countedCash") ?? 0,
    handedOver: n("handedOver") ?? 0,
    bankPos: n("bankPos"),
  });
}

function emailLine(status: CashReportDTO["emailStatus"], error: string | null, recipients: number) {
  if (status === "sent") return { tone: "green" as const, text: `E-posta gönderildi${recipients ? ` · ${recipients} adres` : ""}` };
  if (status === "failed") return { tone: "red" as const, text: `E-posta gitmedi: ${error ?? "bilinmeyen hata"}` };
  if (status === "off") return { tone: "gray" as const, text: "E-posta kapalı (yönetici ayarlarından açılır)" };
  return null;
}

/**
 * Gün sonu kasa raporu: personel ModPOS'un Z raporuna ve kasaya bakıp girer. Yazarken olması gereken nakit ve fark
 * (eksik / fazla) anında görünür; gönderince alıcılara e-posta gider ve "WhatsApp ile gönder" ayrıntılı metni açar.
 * Gönderilmiş rapor özet olarak görünür, "Düzenle" ile yeniden gönderilir (güncellendi diye işaretlenir).
 */
export function CashForm({
  date,
  report,
  carry,
  whatsapp,
  recipients,
  canEdit,
}: {
  date: string;
  report: CashReportDTO | null;
  /** Önceki raporun ertesi güne devri (açılış kendiliğinden dolar) */
  carry: { date: string; amount: number } | null;
  whatsapp: { text: string; link: string } | null;
  /** Kaç adrese e-posta gider (adresler personele gösterilmez) */
  recipients: number;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(report === null);
  const [values, setValues] = useState<Values>(() => initialValues(report, carry));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [pending, start] = useTransition();
  const [resending, setResending] = useState(false);
  const live = preview(values);

  const set = (k: Key) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  function edit() {
    setValues(initialValues(report, carry));
    setErrors({});
    setEditing(true);
  }

  function submit() {
    const { fields, errors: errs } = readValues(values, date);
    setErrors(errs);
    if (!fields) {
      toast.error("Eksik ya da hatalı alan var", { description: Object.values(errs)[0] });
      return;
    }
    start(async () => {
      const res = await submitCashReport({ ...fields, revision: report?.revision ?? 0 });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      const e: CashEmailOutcome = res.data.email;
      const head = `Rapor gönderildi · ${diffText(res.data.cashDiff)}`;
      if (e.status === "failed") toast.warning(head, { description: e.error ?? "E-posta gitmedi", duration: 12_000 });
      else toast.success(head, { description: e.status === "sent" ? `E-posta ${e.to} adrese gitti. Şimdi WhatsApp ile de gönderebilirsiniz.` : "WhatsApp ile gönderebilirsiniz." });
      setEditing(false);
    });
  }

  async function resend() {
    if (!report) return;
    setResending(true);
    const res = await resendCashReportEmail(report.id);
    setResending(false);
    if (!res.ok) return void toast.error(res.error);
    if (res.data.status === "sent") toast.success(`E-posta ${res.data.to} adrese gitti`);
    else toast.error(res.data.error ?? "E-posta gitmedi");
  }

  async function copy() {
    if (!whatsapp) return;
    if (await copyText(whatsapp.text)) toast.success("Rapor metni kopyalandı");
    else toast.error("Kopyalanamadı");
  }

  if (report && !editing) {
    const mail = emailLine(report.emailStatus, report.emailError, recipients);
    const sentAt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(report.updatedAt));
    return (
      <Card>
        <CardHeader
          icon={<ReceiptText />}
          title={`${longDateTR(date)} kasa raporu`}
          description={`${report.submittedByName} · ${sentAt}${report.revision > 1 ? " · güncellendi" : ""}`}
          meta={
            <Badge tone={DIFF_TONE[diffKind(report.cashDiff)]} dot>
              {diffText(report.cashDiff)}
            </Badge>
          }
        />
        <div className="space-y-4 px-5 pb-5">
          <DiffHeadline diff={report.cashDiff} />
          {mail ? (
            <div className={cn("flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[13px]", mail.tone === "red" ? "bg-bad-soft text-bad" : mail.tone === "green" ? "bg-lime/25 text-good-ink" : "bg-panel text-ink-mute")}>
              <span className="min-w-0 flex-1">{mail.text}</span>
              {report.emailStatus === "failed" ? (
                <Button size="xs" variant="secondary" onClick={() => void resend()} disabled={resending}>
                  <RotateCw size={13} /> {resending ? "Gönderiliyor…" : "Yeniden dene"}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {whatsapp ? (
              <a href={whatsapp.link} target="_blank" rel="noopener noreferrer" className={buttonClass("accent", "lg")}>
                <MessageCircle size={18} /> WhatsApp ile gönder
              </a>
            ) : null}
            {whatsapp ? (
              <Button variant="secondary" size="lg" onClick={() => void copy()}>
                <Copy size={16} /> Metni kopyala
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="ghost" size="lg" onClick={edit}>
                <Pencil size={16} /> Düzenle
              </Button>
            ) : null}
          </div>
          <CashBreakdown report={report} />
        </div>
      </Card>
    );
  }

  const kind = live ? live.kind : null;
  const paymentsOff = live && values.zTotal.trim() && Math.abs(live.paymentsDiff) >= CASH_TOLERANCE;
  const cardOff = live && live.cardDiff !== null && Math.abs(live.cardDiff) >= CASH_TOLERANCE;
  const field = (k: MoneyKey, label: string, opts: { hint?: string; placeholder?: string; autoFocus?: boolean } = {}) => (
    <Field label={label} htmlFor={`k-${k}`} hint={opts.hint} error={errors[k]}>
      <NumberInput
        id={`k-${k}`}
        inputMode="decimal"
        value={values[k]}
        onChange={set(k)}
        placeholder={opts.placeholder ?? (REQUIRED.includes(k) ? "0" : "isteğe bağlı")}
        enterKeyHint="next"
        autoFocus={opts.autoFocus}
        aria-invalid={Boolean(errors[k])}
      />
    </Field>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader icon={<ReceiptText />} title="Z raporu (ModPOS)" description="ModPOS'ta gün sonu Z raporunu alın; toplam satışı ve ödeme türlerini yazın." />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {field("zTotal", "Toplam satış (Z)", { autoFocus: !report })}
            <Field label="Z no" htmlFor="k-zNo" hint="isteğe bağlı">
              <Input id="k-zNo" value={values.zNo} onChange={set("zNo")} maxLength={30} autoComplete="off" />
            </Field>
            {field("cash", "Nakit")}
            {field("card", "Kredi / banka kartı")}
            {field("mealCard", "Yemek kartı", { hint: "Multinet, Pluxee, Edenred, Setcard…" })}
            {field("online", "Online", { hint: "Yemeksepeti, Getir, Trendyol…" })}
            {field("other", "Diğer", { hint: "havale, cari, ikram…" })}
            <Field label="Fiş sayısı" htmlFor="k-receipts" hint="isteğe bağlı">
              <Input id="k-receipts" inputMode="numeric" value={values.receipts} onChange={set("receipts")} maxLength={6} autoComplete="off" />
            </Field>
            {paymentsOff && live ? (
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn sm:col-span-2">
                Ödeme türlerinin toplamı {money(live.paymentsTotal)}: Z toplamından {money(Math.abs(live.paymentsDiff))} {live.paymentsDiff > 0 ? "fazla" : "az"}. Bir tutarı yanlış yazmış olabilirsiniz.
              </p>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Wallet />} title="Kasa (nakit)" description="Çekmecedeki bütün nakdi sayın; teslim ettiğiniz parayı sayımdan sonra yazın." />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {field("openingCash", "Açılış (dünden devir)", { hint: carry ? `Önceki rapordan (${longDateTR(carry.date)}): ${money(carry.amount)}` : "Gün başında kasadaki nakit" })}
            {field("countedCash", "Akşam sayılan nakit")}
            {field("cashOut", "Gün içinde kasadan çıkan", { hint: "Kasadan ödenen harcama, gün içinde teslim edilen" })}
            <Field label="Neye çıktı" htmlFor="k-cashOutNote" hint="isteğe bağlı">
              <Input id="k-cashOutNote" value={values.cashOutNote} onChange={set("cashOutNote")} maxLength={200} placeholder="ör. süt, buz" autoComplete="off" />
            </Field>
            {field("handedOver", "Teslim edilen", { hint: "Sayımdan sonra kasadan alınan (patrona, bankaya)" })}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<CreditCard />} title="Kart" description="Banka POS cihazının gün sonu fişindeki toplam; ModPOS'taki kartla karşılaştırılır." />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {field("bankPos", "Banka POS gün sonu")}
            {cardOff && live?.cardDiff != null ? (
              <p className="self-end rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
                Banka POS, ModPOS&apos;taki karttan {money(Math.abs(live.cardDiff))} {live.cardDiff > 0 ? "fazla" : "az"}.
              </p>
            ) : null}
          </div>
        </Card>
      </div>
      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Card>
          <CardHeader icon={<Calculator />} title="Sonuç" description={`${longDateTR(date)} · gönderince yöneticiye e-posta gider`} />
          <div className="space-y-3 px-5 pb-5">
            {live ? (
              <>
                <DiffHeadline diff={live.cashDiff} />
                <div className="divide-y divide-line text-sm">
                  <p className="flex justify-between py-1.5">
                    <span className="text-ink-mute">Olması gereken</span>
                    <span className="tabular">{money(live.expectedCash)}</span>
                  </p>
                  <p className="flex justify-between py-1.5">
                    <span className="text-ink-mute">Ertesi güne devir</span>
                    <span className="tabular">{money(live.carryOver)}</span>
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-mute">Nakit satış, açılış ve sayılan nakdi yazınca kasa farkı burada görünür.</p>
            )}
            <Field
              label="Not"
              htmlFor="k-note"
              hint={kind && kind !== "even" ? "Fark var: nedenini kısaca yazın (ör. bozuk para, iade, yanlış fiş)" : "isteğe bağlı"}
              className={kind && kind !== "even" && !values.note.trim() ? "[&_label]:text-warn" : undefined}
            >
              <Textarea id="k-note" value={values.note} onChange={set("note")} rows={3} maxLength={1000} />
            </Field>
            <Button size="lg" className="w-full" onClick={submit} disabled={pending}>
              <Send size={16} /> {pending ? "Gönderiliyor…" : report ? "Raporu güncelle" : "Raporu gönder"}
            </Button>
            {report ? (
              <Button variant="ghost" className="w-full" onClick={() => setEditing(false)} disabled={pending}>
                Vazgeç
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
