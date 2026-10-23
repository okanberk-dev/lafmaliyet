"use client";

import { Calculator, Copy, CreditCard, MessageCircle, Pencil, ReceiptText, RotateCw, Send, Wallet } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { PhotoPicker, PhotoStatus, usePhotoUpload } from "@/components/panel/photo-picker";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, NumberInput, Textarea } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { cashOutCheck, cashOutNoteOf, cashOutsTotal } from "@/lib/cash-outs";
import { CASH_TOLERANCE, computeCash, diffKind, diffText, type CashReportFields } from "@/lib/cash-report";
import { money } from "@/lib/format";
import type { PhotoUploadResponse } from "@/lib/photo-read/reading";
import {
  fieldText,
  MISSING_TEXT,
  photoDiffs,
  posPromptMarks,
  prefillPlan,
  prefillSummary,
  savedFields,
  type CashPhotoKind,
  type CashReading,
  type ReadField,
} from "@/lib/photo-read/kasa";
import { MAX_REPORT_PHOTOS, readingOffText, type ReadingState } from "@/lib/photo-rules";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { resendCashReportEmail, submitCashReport, type CashEmailOutcome } from "@/server/actions/cash-report";
import type { CashOutDTO } from "@/server/data/cash-outs";
import type { CashPhotoInfo } from "@/server/data/cash-photos";
import type { CashReportDTO } from "@/server/data/cash-reports";

import { copyText } from "../kullanicilar/password-field";
import { CardPhotos, ReadChecks, SavedPhotos, type FormPhoto } from "./cash-photos";
import { CashBreakdown, DIFF_TONE, DiffHeadline } from "./cash-summary";

type MoneyKey = "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "openingCash" | "cashOut" | "countedCash" | "handedOver" | "bankPos" | "offRevenue";
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
  offRevenue: "Ödenmez / ikram",
};

/** Formda fotoğraftan dolabilen alanlar (İndirim kasa grubunun alanı gelince eklenir) */
const READ_FIELDS = ["zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "zNo", "receipts", "bankPos"] as const satisfies readonly (ReadField & Key)[];
type FormReadField = (typeof READ_FIELDS)[number];

const input = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

function initialValues(report: CashReportDTO | null, carry: { amount: number } | null, outs: CashOutDTO[]): Values {
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
      offRevenue: input(report.offRevenue),
      note: report.note ?? "",
    };
  }
  // Yeni rapor: gün içinde kasadan çıkan satırların toplamı ve adları kendiliğinden gelir
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
    cashOut: outs.length ? input(cashOutsTotal(outs)) : "",
    cashOutNote: cashOutNoteOf(outs) ?? "",
    countedCash: "",
    handedOver: "",
    bankPos: "",
    offRevenue: "",
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
    offRevenue: a.offRevenue,
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
 * Fotoğraftan gelen alanın durumu: `filled` forma yazılan metin (değer hâlâ buysa "Fotoğraftan" rozeti), `warn` turuncu
 * nedeni, `suggest` yazılandan farklı ya da net okunamayan değer ("Fotoğraftakini yaz"). Alana yazınca turuncu kalkar.
 */
interface Mark {
  photoId: number;
  filled: string | null;
  warn: string | null;
  suggest: { text: string; photo: number | string; kind: "differs" | "unsure" } | null;
}
type Marks = Partial<Record<FormReadField, Mark>>;

/** Fotoğraftaki değerin ekrandaki hâli */
const shownValue = (field: FormReadField, v: number | string) => (field === "zNo" || field === "receipts" ? String(v) : money(Number(v)));

/**
 * İki banka POS fişi (iki cihaz): ikinci okumada toplama ekle ya da yerine yaz. İkinci fişin rakamı net değilse ya da
 * bir denetime takıldıysa (`warn`) seçilen değer turuncu kalır; net olmayan rakam (`unsure`) soruda da söylenir
 * (posPromptMarks).
 */
interface PosPrompt {
  photoId: number;
  prev: number;
  next: number;
  warn: string | null;
  unsure: string | null;
}

/**
 * Gün sonu kasa raporu: personel ModPOS'un Z raporuna ve kasaya bakıp girer. Yazarken olması gereken nakit ve fark
 * (eksik / fazla) anında görünür; gönderince alıcılara e-posta gider ve "WhatsApp ile gönder" ayrıntılı metni açar.
 * Gönderilmiş rapor özet olarak görünür, "Düzenle" ile yeniden gönderilir (güncellendi diye işaretlenir).
 *
 * Z raporunun ve banka POS fişinin fotoğrafı çekilirse rakamlar okunur (docs/FOTOGRAF.md): yalnız boş alanlar dolar
 * ("Fotoğraftan" rozeti), net okunmayan ya da bir denetime takılan alan turuncu olur ve nedeni altında yazar, okunamayan
 * alan boş kalır. Hiçbir şey kendiliğinden kaydedilmez: personel bakıp gönderir; fotoğraflar raporla saklanır.
 */
export function CashForm({
  date,
  report,
  carry,
  whatsapp,
  recipients,
  canEdit,
  photoUi,
  saved,
  cashOuts,
}: {
  date: string;
  report: CashReportDTO | null;
  /** Önceki raporun ertesi güne devri (açılış kendiliğinden dolar) */
  carry: { date: string; amount: number } | null;
  whatsapp: { text: string; link: string } | null;
  /** Kaç adrese e-posta gider (adresler personele gösterilmez) */
  recipients: number;
  canEdit: boolean;
  /** Fotoğraf deposu var mı, okuma durumu, bakan yönetici mi */
  photoUi: { storage: boolean; reading: ReadingState; admin: boolean; me: string };
  /** Kayıtlı raporun fotoğrafları ve okumaları (görebilene) */
  saved: CashPhotoInfo | null;
  /** Günün kasadan çıkan satırları */
  cashOuts: CashOutDTO[];
}) {
  const [editing, setEditing] = useState(report === null);
  const [values, setValues] = useState<Values>(() => initialValues(report, carry, cashOuts));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [pending, start] = useTransition();
  const [resending, setResending] = useState(false);
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [marks, setMarks] = useState<Marks>({});
  const [posPrompt, setPosPrompt] = useState<PosPrompt | null>(null);
  const zUp = usePhotoUpload();
  const posUp = usePhotoUpload();
  const live = preview(values);
  const reading = photoUi.reading === "on";

  // Okuma yükleme bitince gelir: o arada yazılanlara ve işaretlere göre (en son hâlleri) uygulanır
  const valuesRef = useRef(values);
  const marksRef = useRef(marks);
  useEffect(() => {
    valuesRef.current = values;
    marksRef.current = marks;
  }, [values, marks]);

  // Gün içinde kasadan çıkan eklenince (sayfa yenilenir, form kalır) toplam ve adlar değişir: alanlar hâlâ
  // kendiliğinden gelen değerdeyse onlar da güncellenir, elle yazılan kalır
  const outsTotal = cashOutsTotal(cashOuts);
  const auto = { cashOut: cashOuts.length ? input(outsTotal) : "", note: cashOutNoteOf(cashOuts) ?? "" };
  const [autoSeen, setAutoSeen] = useState(auto);
  if (!report && (autoSeen.cashOut !== auto.cashOut || autoSeen.note !== auto.note)) {
    setAutoSeen(auto);
    setValues((v) => ({
      ...v,
      cashOut: v.cashOut === autoSeen.cashOut ? auto.cashOut : v.cashOut,
      cashOutNote: v.cashOutNote === autoSeen.note ? auto.note : v.cashOutNote,
    }));
  }

  const set = (k: Key) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
    if (k in marks) setMarks((m) => ({ ...m, [k]: { ...m[k as FormReadField]!, warn: null, suggest: null } }));
    if (k === "bankPos") setPosPrompt(null);
  };

  function edit() {
    setValues(initialValues(report, carry, cashOuts));
    setErrors({});
    setPhotos([]);
    setMarks({});
    setPosPrompt(null);
    setEditing(true);
  }

  /** Okumayı forma uygular: yalnız boş alanlar dolar; yeşil özet satırını döner */
  function applyReading(photoId: number, r: CashReading): string | null {
    if (!r.ok) return null;
    const current = valuesRef.current;
    // İkinci POS fişi: Banka POS önceki bir POS fotoğrafından geldiyse toplamı mı, yerine mi sorulur
    const prevMark = marksRef.current.bankPos;
    const posValue = r.values.bankPos ? Number(r.values.bankPos.value) : null;
    if (r.kind === "kasa-pos" && posValue !== null && prevMark && prevMark.photoId !== photoId && prevMark.filled !== null && current.bankPos === prevMark.filled) {
      setPosPrompt({ photoId, prev: parseNumberTR(current.bankPos) ?? 0, next: posValue, ...posPromptMarks(r) });
      return "Banka POS fişi okundu.";
    }
    const plan = prefillPlan(r, Object.fromEntries(READ_FIELDS.map((f) => [f, current[f]])));
    if (plan.fill.length) setValues((v) => ({ ...v, ...Object.fromEntries(plan.fill.map((f) => [f.field, f.text])) }));
    setMarks((m) => {
      const next: Marks = { ...m };
      for (const f of plan.fill) next[f.field as FormReadField] = { photoId, filled: f.text, warn: f.warn, suggest: null };
      for (const d of plan.differs) next[d.field as FormReadField] = { photoId, filled: m[d.field as FormReadField]?.filled ?? null, warn: null, suggest: { text: d.text, photo: d.photo, kind: "differs" } };
      for (const u of plan.unsure) {
        next[u.field as FormReadField] = {
          photoId,
          filled: null,
          warn: `Fotoğrafta net okunamadı (${shownValue(u.field as FormReadField, u.photo)}); fişten yazın.`,
          suggest: { text: u.text, photo: u.photo, kind: "unsure" },
        };
      }
      for (const f of plan.missing) next[f as FormReadField] = { photoId, filled: null, warn: MISSING_TEXT, suggest: null };
      return next;
    });
    return prefillSummary(r.kind, plan);
  }

  /** Yükleme ya da yeniden okumanın sonucu: fotoğraf listeye (ya da yerine), okuma forma */
  function took(res: PhotoUploadResponse, kind: CashPhotoKind) {
    const r = res.reading && res.reading.kind !== "fis" ? res.reading : null;
    const summary = r ? applyReading(res.photo.id, r) : null;
    const photo: FormPhoto = {
      id: res.photo.id,
      kind,
      createdAt: new Date().toISOString(),
      byName: photoUi.me,
      reading: r,
      error: res.readError ?? (r && !r.ok ? r.error : null),
      switchTo: r && !r.ok ? r.switchTo : null,
      canRetry: res.canRetry,
      summary,
    };
    setPhotos((ps) => {
      const i = ps.findIndex((p) => p.id === photo.id);
      if (i < 0) return [...ps, photo];
      const next = [...ps];
      next[i] = { ...photo, createdAt: ps[i].createdAt };
      return next;
    });
  }

  const savedCount = saved?.photos.length ?? 0;
  async function pick(kind: CashPhotoKind, file: File) {
    if (savedCount + photos.length >= MAX_REPORT_PHOTOS) return void toast.error(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
    const up = kind === "kasa-z" ? zUp : posUp;
    const res = await up.upload(file, { kind, day: date, read: reading });
    if (res) took(res, kind);
  }

  async function reread(p: FormPhoto, kind: CashPhotoKind) {
    const up = kind === "kasa-z" ? zUp : posUp;
    const res = await up.reread(p.id, kind, date);
    if (res) took(res, kind);
  }

  /** Fotoğrafı formdan çıkarır; onun doldurduğu (sonra değiştirilmemiş) alanlar da boşalır */
  function removePhoto(id: number) {
    setPhotos((ps) => ps.filter((p) => p.id !== id));
    const cleared: Partial<Values> = {};
    const next: Marks = {};
    for (const [k, m] of Object.entries(marks) as [FormReadField, Mark][]) {
      if (m.photoId !== id) next[k] = m;
      else if (m.filled !== null && values[k] === m.filled) cleared[k] = "";
    }
    setMarks(next);
    if (Object.keys(cleared).length) setValues((v) => ({ ...v, ...cleared }));
    if (posPrompt?.photoId === id) setPosPrompt(null);
  }

  function takeSuggestion(k: FormReadField) {
    const s = marks[k]?.suggest;
    if (!s) return;
    setValues((v) => ({ ...v, [k]: s.text }));
    setMarks((m) => ({ ...m, [k]: { ...m[k]!, filled: s.text, warn: null, suggest: null } }));
  }

  function posChoice(sum: boolean) {
    if (!posPrompt) return;
    const text = fieldText("bankPos", sum ? posPrompt.prev + posPrompt.next : posPrompt.next);
    setValues((v) => ({ ...v, bankPos: text }));
    setMarks((m) => ({ ...m, bankPos: { photoId: posPrompt.photoId, filled: text, warn: posPrompt.warn, suggest: null } }));
    setPosPrompt(null);
  }

  function submit() {
    const { fields, errors: errs } = readValues(values, date);
    setErrors(errs);
    if (!fields) {
      toast.error("Eksik ya da hatalı alan var", { description: Object.values(errs)[0] });
      return;
    }
    start(async () => {
      const res = await submitCashReport({ ...fields, revision: report?.revision ?? 0, photos: photos.map((p) => p.id) });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      const e: CashEmailOutcome = res.data.email;
      const head = `Rapor gönderildi · ${diffText(res.data.cashDiff)}`;
      if (e.status === "failed") toast.warning(head, { description: e.error ?? "E-posta gitmedi", duration: 12_000 });
      else toast.success(head, { description: e.status === "sent" ? `E-posta ${e.to} adrese gitti. Şimdi WhatsApp ile gönderebilirsiniz.` : "WhatsApp ile gönderebilirsiniz." });
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
    const diffs = saved ? photoDiffs(saved.readings, savedFields(report)) : [];
    // Rapordan sonra eklenen kasadan çıkanlar: rapordaki tutar kendiliğinden değişmez (sayılan kasaya bağlı)
    const later = cashOuts.filter((o) => o.createdAt > report.updatedAt);
    const laterNote = later.length && Math.abs(outsTotal - report.cashOut) >= CASH_TOLERANCE ? `Rapordan sonra ${later.length} kasadan çıkan eklendi; fişlerin toplamı ${money(outsTotal)}, raporda ${money(report.cashOut)}.` : null;
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
          {saved ? <SavedPhotos photos={saved.photos} diffs={diffs} admin={photoUi.admin} /> : null}
          {laterNote ? <p className="rounded-xl bg-info-soft px-3 py-2 text-[13px] leading-5 text-info">{laterNote}</p> : null}
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
          <CashBreakdown report={report} cashOuts={cashOuts} />
        </div>
      </Card>
    );
  }

  const kind = live ? live.kind : null;
  const paymentsOff = live && values.zTotal.trim() && Math.abs(live.paymentsDiff) >= CASH_TOLERANCE;
  const cardOff = live && live.cardDiff !== null && Math.abs(live.cardDiff) >= CASH_TOLERANCE;
  const offLine = photoUi.storage ? readingOffText(photoUi.reading, photoUi.admin) : null;
  const cashOutValue = values.cashOut.trim() ? parseNumberTR(values.cashOut) : 0;
  const outsWarning = cashOutValue !== null ? cashOutCheck(cashOutValue, cashOuts.map((o) => o.amount)) : null;
  const latestChecks = (k: CashPhotoKind) => [...photos].reverse().find((p) => p.kind === k && p.reading?.ok)?.reading?.checks ?? [];

  /** Fotoğraftan gelen alanın etiketi, turuncusu ve altındaki satır */
  const markOf = (k: Key) => (READ_FIELDS as readonly string[]).includes(k) ? marks[k as FormReadField] : undefined;
  const labelOf = (k: Key, label: string) => {
    const m = markOf(k);
    return m?.filled !== null && m?.filled !== undefined && values[k] === m.filled ? (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {label}
        <Badge tone="blue">Fotoğraftan</Badge>
      </span>
    ) : (
      label
    );
  };
  const hintOf = (k: Key, fallback?: ReactNode): ReactNode => {
    const m = markOf(k);
    if (!m || (!m.warn && !m.suggest)) return fallback;
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {m.warn ? <span className="text-warn">{m.warn}</span> : null}
        {m.suggest?.kind === "differs" ? <span className="text-warn">Fotoğrafta {shownValue(k as FormReadField, m.suggest.photo)}</span> : null}
        {m.suggest ? (
          <button type="button" onClick={() => takeSuggestion(k as FormReadField)} className="cursor-pointer font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11">
            Fotoğraftakini yaz
          </button>
        ) : null}
      </span>
    );
  };
  const warnOf = (k: Key) => Boolean(markOf(k)?.warn || markOf(k)?.suggest);

  const field = (k: MoneyKey, label: string, opts: { hint?: ReactNode; placeholder?: string; autoFocus?: boolean } = {}) => (
    <Field label={labelOf(k, label)} htmlFor={`k-${k}`} hint={hintOf(k, opts.hint)} error={errors[k]}>
      <NumberInput
        id={`k-${k}`}
        inputMode="decimal"
        value={values[k]}
        onChange={set(k)}
        placeholder={opts.placeholder ?? (REQUIRED.includes(k) ? "0" : "isteğe bağlı")}
        enterKeyHint="next"
        autoFocus={opts.autoFocus}
        aria-invalid={Boolean(errors[k])}
        data-warn={warnOf(k) || undefined}
      />
    </Field>
  );

  const photosOf = (k: CashPhotoKind) => photos.filter((p) => p.kind === k);
  const savedOf = (k: CashPhotoKind) => saved?.photos.filter((p) => p.kind === k) ?? [];
  const busy = zUp.busy || posUp.busy;
  const photoBlock = (k: CashPhotoKind) => {
    const up = k === "kasa-z" ? zUp : posUp;
    return photoUi.storage ? (
      <div className="space-y-2.5 sm:col-span-2">
        <PhotoPicker onPick={(f) => void pick(k, f)} read={reading} disabled={busy} />
        <PhotoStatus phase={up.phase} />
        {offLine ? <p className="text-[13px] leading-5 text-ink-mute">{offLine}</p> : null}
        <CardPhotos
          saved={savedOf(k)}
          photos={photosOf(k)}
          busy={busy}
          onRemove={removePhoto}
          onRetry={(p) => void reread(p, p.kind)}
          onSwitch={(p) => p.switchTo && void reread(p, p.switchTo)}
        />
        <ReadChecks checks={latestChecks(k)} />
      </div>
    ) : null;
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader
            icon={<ReceiptText />}
            title="Z raporu (ModPOS)"
            description={
              photoUi.storage && reading
                ? "ModPOS'ta gün sonu Z raporunu alın; fotoğrafını çekin, rakamlar dolar. Ya da elle yazın."
                : "ModPOS'ta gün sonu Z raporunu alın; toplam satışı ve ödeme türlerini yazın."
            }
          />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {photoBlock("kasa-z")}
            {field("zTotal", "Toplam satış (Z)", { autoFocus: !report && !photoUi.storage })}
            <Field label={labelOf("zNo", "Z no")} htmlFor="k-zNo" hint={hintOf("zNo", "isteğe bağlı")}>
              <Input id="k-zNo" inputMode="numeric" value={values.zNo} onChange={set("zNo")} maxLength={30} autoComplete="off" data-warn={warnOf("zNo") || undefined} />
            </Field>
            {field("cash", "Nakit")}
            {field("card", "Kredi / banka kartı")}
            {field("mealCard", "Yemek kartı", { hint: "Multinet, Pluxee, Edenred, Setcard…" })}
            {field("online", "Online", { hint: "Yemeksepeti, Getir, Trendyol…" })}
            {field("other", "Diğer", { hint: "havale, cari, ikram…" })}
            {field("offRevenue", "Ödenmez / ikram", { hint: "Z raporunda ciro dışı (isteğe bağlı)" })}
            <Field label={labelOf("receipts", "Fiş sayısı")} htmlFor="k-receipts" hint={hintOf("receipts", "isteğe bağlı")}>
              <Input id="k-receipts" inputMode="numeric" value={values.receipts} onChange={set("receipts")} maxLength={6} autoComplete="off" data-warn={warnOf("receipts") || undefined} />
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
            {field("cashOut", "Gün içinde kasadan çıkan", {
              hint: cashOuts.length ? (
                <span className="flex flex-wrap items-center gap-x-2">
                  <span>
                    Fişlerden: {cashOuts.length} kalem · {money(outsTotal)}
                  </span>
                  {cashOutValue === null || Math.abs(cashOutValue - outsTotal) >= 0.005 ? (
                    <button
                      type="button"
                      onClick={() => setValues((v) => ({ ...v, cashOut: input(outsTotal), cashOutNote: v.cashOutNote.trim() ? v.cashOutNote : (cashOutNoteOf(cashOuts) ?? "") }))}
                      className="cursor-pointer font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11"
                    >
                      Yaz
                    </button>
                  ) : null}
                </span>
              ) : (
                "Kasadan ödenen harcama, gün içinde teslim edilen"
              ),
            })}
            <Field label="Neye çıktı" htmlFor="k-cashOutNote" hint="isteğe bağlı">
              <Input id="k-cashOutNote" value={values.cashOutNote} onChange={set("cashOutNote")} maxLength={200} placeholder="ör. süt, buz" autoComplete="off" />
            </Field>
            {field("handedOver", "Teslim edilen", { hint: "Sayımdan sonra kasadan alınan (patrona, bankaya)" })}
            {outsWarning ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn sm:col-span-2">{outsWarning}</p> : null}
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<CreditCard />}
            title="Kart"
            description={
              photoUi.storage
                ? "Banka POS cihazının gün sonu fişindeki toplam; fotoğrafını çekin ya da yazın. ModPOS'taki kartla karşılaştırılır."
                : "Banka POS cihazının gün sonu fişindeki toplam; ModPOS'taki kartla karşılaştırılır."
            }
          />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {photoBlock("kasa-pos")}
            {posPrompt ? (
              <div className="space-y-2 rounded-xl bg-info-soft px-3 py-2.5 text-[13px] text-info sm:col-span-2">
                <p>Bu günün bir POS fişi daha okundu ({money(posPrompt.next)}).</p>
                {posPrompt.unsure ? <p className="text-warn">{posPrompt.unsure}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => posChoice(true)}>
                    Toplama ekle ({money(posPrompt.prev + posPrompt.next)})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => posChoice(false)}>
                    Yerine yaz
                  </Button>
                </div>
              </div>
            ) : null}
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
            <Button size="lg" className="w-full" onClick={submit} disabled={pending || busy}>
              <Send size={16} /> {pending ? "Gönderiliyor…" : busy ? "Fotoğraf bekleniyor…" : report ? "Raporu güncelle" : "Raporu gönder"}
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
