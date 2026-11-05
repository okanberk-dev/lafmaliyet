"use client";

import { Calculator, Copy, MessageCircle, Pencil, Plus, ReceiptText, RotateCw, Send, Wallet } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PhotoPicker, PhotoStatus, usePhotoUpload } from "@/components/panel/photo-picker";
import { SEND_OFFLINE_TEXT, tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { parseNumberTR } from "@/lib/calc/expr";
import { cashOutCheck, cashOutNoteOf, cashOutsTotal } from "@/lib/cash-outs";
import {
  CASH_TOLERANCE,
  carryCheck,
  carryDiffText,
  computeCash,
  diffKind,
  diffText,
  openingNeedsNote,
  type CashReportFields,
  type CashRevisionRow,
  reportNo,
  revenueWord,
} from "@/lib/cash-report";
import { money } from "@/lib/format";
import { lafposDiffs } from "@/lib/lafpos/diffs";
import { LAFPOS_NO_COUNT_TEXT, lafposOutsCheck, lafposSummary, type LafposDay } from "@/lib/lafpos/prefill";
import { OKC_PREFILL_ENABLED } from "@/lib/okc-z";
import { OKC_HALVES_TEXT, okcNeedsHalves } from "@/lib/photo-read/okc";
import type { PhotoUploadResponse } from "@/lib/photo-read/reading";
import {
  fieldText,
  MISSING_TEXT,
  photoDiffs,
  posPromptMarks,
  prefillPlan,
  prefillSummary,
  sameValue,
  savedFields,
  type CashPhotoKind,
  type CashReading,
  type PrefillPlan,
  type ReadField,
  type TillField,
} from "@/lib/photo-read/kasa";
import { MAX_OKC_PHOTOS, MAX_REPORT_PHOTOS, OKC_PHOTOS_TEXT, readingOffText, type ReadingState } from "@/lib/photo-rules";
import { dayMonthTR, daysBetween, longDateTR } from "@/lib/reminders";
import { emailFailedLine } from "@/lib/staff-errors";
import { resendCashReportEmail, submitCashReport } from "@/server/actions/cash-report";
import { requestCashCorrection, requestLateCashReport } from "@/server/actions/cash-requests";
import type { CashEmailOutcome } from "@/server/cash/report-email";
import type { CashOutView } from "@/server/data/cash-outs";
import type { CashPhotoInfo } from "@/server/data/cash-photos";
import type { CashReportDTO } from "@/server/data/cash-reports";
import type { OtherPending, OwnCorrection, OwnDelete } from "@/server/data/cash-requests";

import { copyText } from "../kullanicilar/password-field";
import { CardPhotos, ReadChecks, SavedPhotos, type FormPhoto } from "./cash-photos";
import { DeleteRequestButton, newClientKey, PendingRequests } from "./cash-requests";
import { CashRevisions } from "./cash-revisions";
import { CashBreakdown, DIFF_TONE, DiffHeadline, LafposDiffList, type OkcAdminView } from "./cash-summary";
import { OkcCard, type OkcFieldOptions } from "./okc-card";
import { OKC_KEYS, okcFieldsOf, okcValuesOf, type OkcKey, type OkcMoneyKey } from "./okc-form";

type MoneyKey =
  | "zTotal"
  | "cash"
  | "card"
  | "mealCard"
  | "online"
  | "other"
  | "openingCash"
  | "cashIn"
  | "cashOut"
  | "countedCash"
  | "handedOver"
  | "bankPos"
  | "offRevenue"
  | "discounts";
type Key = MoneyKey | OkcKey | "zNo" | "receipts" | "cashOutNote" | "note";
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
  cashIn: "Gün içinde kasaya giren",
  cashOut: "Gün içinde çıkan",
  countedCash: "Sayılan nakit",
  handedOver: "Teslim edilen",
  bankPos: "Banka gün sonu",
  offRevenue: "Ödenmez / ikram",
  discounts: "İndirim",
};

/**
 * Formda fotoğraftan dolabilen alanlar (Z okuması İndirim'i de doldurur; yazılan değer hiçbir zaman değişmez). Yazarkasa
 * alanları ModPOS'unkilerden ayrı anahtarlardır (çapraz karşılaştırma olmaz)
 */
const READ_FIELDS = ["zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "zNo", "receipts", "bankPos", ...OKC_KEYS] as const satisfies readonly (ReadField & Key)[];
type FormReadField = (typeof READ_FIELDS)[number];
/** Ön doldurmanın işaretlediği alanlar: fotoğrafınkiler ve LafPOS'un gün sonunun kasa alanları (docs/LAFPOS.md) */
const MARK_FIELDS = [...READ_FIELDS, ...(["openingCash", "cashIn", "cashOut", "countedCash", "handedOver"] as const satisfies readonly (TillField & Key)[])];
type MarkField = (typeof MARK_FIELDS)[number];

const input = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

function initialValues(report: CashReportFields | null, carry: { amount: number } | null, outs: CashOutView[]): Values {
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
      cashIn: report.cashIn ? input(report.cashIn) : "",
      cashOut: report.cashOut ? input(report.cashOut) : "",
      cashOutNote: report.cashOutNote ?? "",
      countedCash: input(report.countedCash),
      handedOver: report.handedOver ? input(report.handedOver) : "",
      bankPos: input(report.bankPos),
      offRevenue: input(report.offRevenue),
      discounts: input(report.discounts ?? null),
      note: report.note ?? "",
      ...okcValuesOf(report),
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
    cashIn: "",
    cashOut: outs.length ? input(cashOutsTotal(outs)) : "",
    cashOutNote: cashOutNoteOf(outs) ?? "",
    countedCash: "",
    handedOver: "",
    bankPos: "",
    offRevenue: "",
    discounts: "",
    note: "",
    ...okcValuesOf(null),
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
  // Yazarkasa bölümü (isteğe bağlı; kuralları sunucuyla aynı metinle, okcFieldsOf)
  const okc = okcFieldsOf(v);
  Object.assign(errors, okc.errors);
  if (Object.keys(errors).length || !okc.fields) return { fields: null, errors };
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
    cashIn: a.cashIn ?? 0,
    cashOut: a.cashOut ?? 0,
    cashOutNote: v.cashOutNote.trim() || null,
    countedCash: a.countedCash ?? 0,
    handedOver: a.handedOver ?? 0,
    bankPos: a.bankPos,
    offRevenue: a.offRevenue,
    discounts: a.discounts,
    note: v.note.trim() || null,
    ...okc.fields,
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
    cashIn: n("cashIn") ?? 0,
    cashOut: n("cashOut") ?? 0,
    countedCash: n("countedCash") ?? 0,
    handedOver: n("handedOver") ?? 0,
    bankPos: n("bankPos"),
  });
}

function emailLine(status: CashReportDTO["emailStatus"], error: string | null, recipients: number) {
  if (status === "sent") return { tone: "green" as const, text: `E-posta gönderildi${recipients ? ` · ${recipients} adres` : ""}` };
  // Personelin metni sunucudan sabit gelir ("E-posta gitmedi; yöneticiye haber verin…"; E-64), yöneticinin neden
  if (status === "failed") return { tone: "red" as const, text: emailFailedLine(error) };
  if (status === "off") return { tone: "gray" as const, text: "E-posta kapalı (yönetici ayarlarından açılır)" };
  return null;
}

/** Ön doldurmanın kaynağı: fotoğrafın kimliği ya da LafPOS'un gün sonu */
type MarkSource = number | "lafpos";

/**
 * Fotoğraftan (ya da LafPOS'tan) gelen alanın durumu: `from` alana yazanı, `filled` forma yazılan metin (değer hâlâ
 * buysa "Fotoğraftan" / "LafPOS'tan" rozeti), `warn` turuncu nedeni, `suggest` yazılandan farklı ya da net okunamayan
 * değer ve onu getiren ("Fotoğraftakini yaz", "LafPOS'takini yaz"). Alana yazınca turuncu kalkar.
 */
interface Mark {
  from: MarkSource;
  filled: string | null;
  warn: string | null;
  suggest: { text: string; photo: number | string; kind: "differs" | "unsure"; from: MarkSource } | null;
}
type Marks = Partial<Record<MarkField, Mark>>;

/** Fotoğraftaki (LafPOS'taki) değerin ekrandaki hâli */
const shownValue = (field: MarkField, v: number | string) => (field === "zNo" || field === "receipts" || field === "okcZNo" || field === "okcReceipts" ? String(v) : money(Number(v)));

const SOURCE_TEXT = {
  photo: { badge: "Fotoğraftan", at: "Fotoğrafta", take: "Fotoğraftakini yaz" },
  lafpos: { badge: "LafPOS'tan", at: "LafPOS'ta", take: "LafPOS'takini yaz" },
} as const;
const sourceText = (from: MarkSource) => SOURCE_TEXT[from === "lafpos" ? "lafpos" : "photo"];

/**
 * Bir ön doldurmanın (fotoğraf okuması ya da LafPOS) işaretleri: dolan alan kaynağıyla işaretlenir. Yazılmış ve farklı
 * olanda değer de değeri yazanın işareti de kalır, öneri kendi kaynağıyla eklenir. Net olmayan ve eksik olan turuncu.
 */
function planMarks(m: Marks, plan: PrefillPlan, from: MarkSource): Marks {
  const next: Marks = { ...m };
  for (const f of plan.fill) next[f.field as MarkField] = { from, filled: f.text, warn: f.warn, suggest: null };
  for (const d of plan.differs) {
    const prev = m[d.field as MarkField];
    next[d.field as MarkField] = {
      from: prev && prev.filled !== null ? prev.from : from,
      filled: prev?.filled ?? null,
      warn: null,
      suggest: { text: d.text, photo: d.photo, kind: "differs", from },
    };
  }
  for (const u of plan.unsure) {
    // Yazarkasa: tutmayan rakamın tek nedeni ya da (doldurma kapalıyken) öneri, ardından fotoğraftaki değer
    const at = sourceText(from).at;
    const shown = shownValue(u.field as MarkField, u.photo);
    next[u.field as MarkField] = {
      from,
      filled: null,
      warn: u.reason ? `${u.reason} ${at} ${shown}.` : `${at} net okunamadı (${shown}); fişten yazın.`,
      suggest: { text: u.text, photo: u.photo, kind: "unsure", from },
    };
  }
  for (const f of plan.missing) next[f as MarkField] = { from, filled: null, warn: from === "lafpos" ? LAFPOS_NO_COUNT_TEXT : MISSING_TEXT, suggest: null };
  return next;
}

/**
 * LafPOS gününde formun ilk hâli (docs/LAFPOS.md › Kasa raporu, G7). Yeni rapor (`fill`): LafPOS'un gün sonu açılışta
 * kendiliğinden uygulanır, fotoğrafınkiyle aynı kuralla (yalnız boş alanlar dolar, yazılmış ve farklı olanın altında
 * "LafPOS'ta …"). Yazılmış değerlerle açılan form (`compare`: Düzenle, düzeltme önerisi, geç raporun önceki değerleri,
 * Düzeltip onayla): hiçbir alan kendiliğinden değişmez; boş bırakılmış alanın LafPOS'taki değeri de yalnız öneridir
 * ("LafPOS'ta …", "LafPOS'takini yaz"; isteğe bağlı tutarın boşu 0'dır, LafPOS'ta 0 ise öneri yok). Hiçbir şey kaydedilmez.
 * LafPOS'un özeti yoksa olduğu gibi.
 */
function withLafpos(v: Values, lafpos: LafposDay | null, mode: "fill" | "compare"): { values: Values; marks: Marks; filled: number | null } {
  if (!lafpos) return { values: v, marks: {}, filled: null };
  const plan = prefillPlan(lafpos.prefill, Object.fromEntries(MARK_FIELDS.map((f) => [f, v[f]])));
  if (mode === "compare") {
    const suggested = plan.fill.flatMap((f) => {
      const value = lafpos.prefill.values[f.field]?.value;
      return value === undefined || value === 0 ? [] : [{ field: f.field, photo: value, text: f.text }];
    });
    return { values: v, marks: planMarks({}, { ...plan, fill: [], differs: [...plan.differs, ...suggested], missing: [] }, "lafpos"), filled: 0 };
  }
  const values = plan.fill.length ? { ...v, ...Object.fromEntries(plan.fill.map((f) => [f.field, f.text])) } : v;
  return { values, marks: planMarks({}, plan, "lafpos"), filled: plan.fill.length };
}

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
 * Düzenleme öneriye dönünce eklenen fotoğrafın durumu. Ertesi gün (gate "gec") yalnız fotoğraf eklemek doğrudan
 * kaydedilir (değişiklik yok: staffCashGate "direct"); kilitli günde fotoğrafı artık yönetici ekler (staffDayOpen).
 */
function droppedPhotoText(gate: "kilitli" | "gec"): string {
  return gate === "gec"
    ? "Eklediğiniz fotoğraf öneriye gitmez. Öneriyi gönderdikten sonra Düzenle ile yalnız fotoğrafı ekleyin; onay gerekmez."
    : "Eklediğiniz fotoğraf öneriye gitmez; ertesi günün raporu girildiği için bu güne fotoğrafı artık yönetici ekler.";
}

/** Geç raporun formdaki durumu: kişinin bekleyen isteğinin sürümü (yoksa 0), nedeni, teslim alanı ve fotoğrafları */
export interface LateFormState {
  version: number;
  reason: string;
  handedTo: { kind: "user"; id: number } | { kind: "banka" } | null;
  /** Önceki isteğin fotoğrafları (kişinin kendi küçük resimleri; formdan çıkarılabilir) */
  kept: FormPhoto[];
  /** Bekleyen istek güncelleniyor ("Güncelle ve gönder") */
  updating: boolean;
}

/**
 * Gün sonu kasa raporu: personel ModPOS'un Z raporuna ve kasaya bakıp girer. Yazarken olması gereken nakit ve fark
 * (eksik / fazla) anında görünür; gönderince alıcılara e-posta gider ve "WhatsApp ile gönder" ayrıntılı metni açar.
 * Gönderilmiş rapor özet olarak görünür, "Düzenle" ile yeniden gönderilir (güncellendi diye işaretlenir; önceki sürüm
 * "Değişiklikler"de kalır).
 *
 * Açılış önceki raporun devriyle karşılaştırılır (docs/KASA-RAPORU.md › Açılış ve devir): tutmuyorsa turuncu kutu ve
 * "Devri yaz"; nedeni nota yazılmadan gönderilmez (sunucu da aynı kuralı uygular). Kasayı sayan kişi seçilir.
 *
 * ModPOS Z raporunun ve yazarkasanın (banka POS) Z raporunun fotoğrafı çekilirse rakamlar okunur (docs/FOTOGRAF.md):
 * yalnız boş alanlar dolar ("Fotoğraftan" rozeti), net okunmayan ya da bir denetime takılan alan turuncu olur ve nedeni
 * altında yazar, okunamayan alan boş kalır. Hiçbir şey kendiliğinden kaydedilmez: personel bakıp gönderir; fotoğraflar
 * raporla saklanır. Yazarkasa Z'sinin kartı okc-card.tsx'tedir (docs/planlar/okc-z.md §3.2, D18): değerler ve fotoğraf
 * işaretleri burada, köprüyle (`field` / `textField`); doldurma kapısı kapalıyken (OKC_PREFILL_ENABLED) okunan her rakam
 * öneridir. Yanlış bölüme okutulan fiş öteki bölüme okutulur ("Banka POS Z bölümüne okut" / "ModPOS bölümüne okut");
 * yükleme bölüm başınadır, yazarkasa Z'si okunurken ModPOS Z'si çekilebilir.
 *
 * LafPOS günü (`lafposMode`: geçiş günü seçili ve gün ondan önce değil; docs/LAFPOS.md › Kasa raporu): Z bölümü "LafPOS
 * gün sonu (Z)", ModPOS Z fotoğrafı yok (yazarkasa Z bölümü kalır). LafPOS günün sonunu gönderdiyse (`lafpos`) form
 * açılırken (ve Düzenle'de) Z ve kasa rakamları fotoğrafınkiyle aynı kuralla boş alanlara kendiliğinden yazılır
 * ("LafPOS'tan" rozeti), yazılmış ve farklı olanın altında "LafPOS'ta …" ve "LafPOS'takini yaz"; bant "LafPOS'tan
 * doldur" ile yeniden uygular. Kaydetmez; personel bakıp gönderir. "Gün içinde çıkan"ın kaynağı panelin Kasadan
 * çıkanlar'ıdır (E-35): LafPOS'un harcama + teslimi tutmazsa bilgi satırı, fişler varken "LafPOS'takini yaz" yok.
 * Kayıtlı görünüm LafPOS'tan farklı yazılanları gösterir (E-09).
 *
 * "Gün içinde kasaya giren" (nakit satış dışında konan: bozuk para, tahsilat, nakit bahşiş) olması gereken nakde eklenir
 * (computeCash). Çoğu gün yoktur: alan tutarı varken, LafPOS'tan dolunca ya da "Kasaya giren ekle"yle görünür.
 *
 * Personelin sonradan düzeltmesi (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği): kilitli günde "Düzeltme
 * öner", ertesi gün kasa alanı ya da sayan değişince sunucu gönderimi onaya çevirir; form yazılanları koruyarak düzeltme
 * önerisine geçer (fotoğraf yok, "Neden düzeltiyorsunuz?" zorunlu, "Onaya gönder"). Rapor onaya kadar değişmez.
 *
 * Geç rapor (`mode="late"`; docs/KASA-RAPORU.md › Geç rapor): dünden eski bir günü personel Z fotoğrafı (LafPOS
 * gününde LafPOS'un gün sonu geldiyse fotoğraf gerekmez, gelmediyse yazarkasa Z'sinin fotoğrafı), Z no ve
 * nedeniyle onaya gönderir; sayan isteyendir (seçici yok), teslim varsa teslim alan seçilir, gün içinde çıkan elle
 * yazılır. Dünün formu gönderilirken gün döndüyse (05:00) sunucu geç rapora çevirir, form yazılanlarla geçer.
 * "Düzeltip onayla" (`mode="review"`): yönetici geç raporu kendi değerleriyle onaylar (fotoğraf, sayan ve neden yok).
 *
 * LafPOS gününde (G7) yalnız yeni form LafPOS'un gün sonuyla dolar; yazılmış değerlerle açılan form (Düzenle, öneri,
 * geç raporun önceki değerleri, Düzeltip onayla) yalnız karşılaştırır ve metinleri de öyle der (`lafposCompared`).
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
  next = null,
  counters = [],
  me = null,
  revisions = [],
  locked = false,
  requests = null,
  proposedBy,
  photoRemoval,
  mode = "report",
  initial = null,
  late = null,
  onReview,
  reviewPending = false,
  onCancel,
  onSent,
  prevOkcZ = null,
  okcAdmin = null,
  lafpos = null,
  lafposMode = lafpos !== null,
}: {
  date: string;
  report: CashReportDTO | null;
  /** Önceki raporun ertesi güne devri (açılış kendiliğinden dolar ve onunla karşılaştırılır) */
  carry: { date: string; amount: number } | null;
  whatsapp: { text: string; link: string } | null;
  /** Kaç adrese e-posta gider (adresler personele gösterilmez) */
  recipients: number;
  canEdit: boolean;
  /** Fotoğraf deposu var mı, okuma durumu, bakan yönetici mi */
  photoUi: { storage: boolean; reading: ReadingState; admin: boolean; me: string };
  /** Kayıtlı raporun fotoğrafları (görebilene; kapanmış günde personele boş) ve okumaları ("Fotoğraftan farklı") */
  saved: CashPhotoInfo | null;
  /** Günün kasadan çıkan satırları */
  cashOuts: CashOutView[];
  /** Sonraki günün raporu (açılışı bu raporun devriyle karşılaştırılır) */
  next?: { date: string; openingCash: number } | null;
  /** "Kasayı sayan" seçenekleri: etkin kullanıcılar (kayıtlı pasif sayan "(pasif)" ekiyle) */
  counters?: { id: number; name: string }[];
  /** Formu açan kişi (yeni raporda sayan o) */
  me?: { id: number; name: string } | null;
  /** Kayıtlı raporun önceki sürümleri */
  revisions?: CashRevisionRow[];
  /** Personel: ertesi günün raporu girildi, bu rapor yönetici onayıyla düzeltilir ("Düzeltme öner") */
  locked?: boolean;
  /** Personel: bu raporun bekleyen istekleri (kendisininki tam, başkalarınınki yalnız adı) */
  requests?: { own: (OwnCorrection | OwnDelete)[]; others: OtherPending[] } | null;
  /** Onaylanan düzeltme önerilerinin önerenleri (sürüme göre; "Değişiklikler") */
  proposedBy?: Record<number, string>;
  /** Personel: kayıtlı raporun fotoğraflarında kaldırma isteği ("ok" açılabilir, "pending" bekliyor, "blocked" olmaz) */
  photoRemoval?: Record<number, "ok" | "pending" | "blocked">;
  /** "report" gün sonu raporu; "late" personelin geç raporu; "review" yöneticinin "Düzeltip onayla"sı */
  mode?: "report" | "late" | "review";
  /** Geç rapor ve "Düzeltip onayla": rapor yokken formun ilk değerleri */
  initial?: CashReportFields | null;
  /** Geç rapor: kişinin bekleyen ya da reddedilen isteği (sürüm, neden, teslim alan, önceki fotoğraflar) */
  late?: LateFormState | null;
  /** "Düzeltip onayla": yöneticinin değerleri karta gider */
  onReview?: (fields: CashReportFields) => void;
  reviewPending?: boolean;
  /** Geç rapor ve "Düzeltip onayla": Vazgeç */
  onCancel?: () => void;
  /** Geç rapor onaya gitti */
  onSent?: () => void;
  /**
   * Önceki yazarkasa Z'si (yalnız gün ve numara): formun Z no denetimi (docs/planlar/okc-z.md §3.6). Kümülatif
   * personele gitmez (D17)
   */
  prevOkcZ?: { date: string; zNo: string } | null;
  /** Yönetici: kayıtlı raporun yazarkasa kümülatifi ve "Kümülatifi temizle" (personelde hep boş) */
  okcAdmin?: OkcAdminView | null;
  /** LafPOS'un bu günün sonu (Z ve kasa rakamları); yoksa "LafPOS'tan doldur" görünmez */
  lafpos?: LafposDay | null;
  /** Günün kasası LafPOS (geçiş gününden sonra; gönderimi gelmemiş olsa da): Z bölümü LafPOS'un, ModPOS fotoğrafı yok */
  lafposMode?: boolean;
}) {
  // Öğe kimlikleri form başına: Onaylar'da iki "Düzeltip onayla" formu aynı anda açıkken etiket, odak ve kaydırma
  // öteki karta gitmesin
  const uid = useId();
  const fid = (name: string) => `${uid}k-${name}`;
  const [editing, setEditing] = useState(report === null);
  // LafPOS gününde yeni formun ilk hâli LafPOS'un gün sonuyla; yazılmış değerlerle açılan form yalnız karşılaştırır
  // (withLafpos). Kayıtlı rapor görünümde açılır, Düzenle'de karşılaştırılır
  const [opening] = useState(() => withLafpos(initialValues(report ?? initial, carry, cashOuts), report === null ? lafpos : null, initial === null ? "fill" : "compare"));
  const [values, setValues] = useState<Values>(opening.values);
  const initialCounter = report?.countedBy ?? report?.submittedBy ?? me?.id ?? null;
  const [counter, setCounter] = useState<number | null>(initialCounter);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [pending, start] = useActionTransition();
  const [resending, setResending] = useState(false);
  const [photos, setPhotos] = useState<FormPhoto[]>(() => late?.kept ?? []);
  const [marks, setMarks] = useState<Marks>(opening.marks);
  const [posPrompt, setPosPrompt] = useState<PosPrompt | null>(null);
  // LafPOS'un uygulanışı: kaç alan doldu (uygulanmadıysa null); bandın satırı bundan ve alanların şimdiki
  // işaretlerinden (kaçı hâlâ farklı) kurulur, Kasadan çıkanlar'a teslim eklenince "farklı" kendiliğinden düşer
  const [lafposFilled, setLafposFilled] = useState<number | null>(opening.filled);
  // Form yazılmış değerlerle mi açıldı (karşılaştırma: Düzenle, düzeltme önerisi, geç raporun önceki değerleri, Düzeltip
  // onayla): metinler "doldu" değil "karşılaştırıldı" der
  const [lafposCompared, setLafposCompared] = useState(lafpos !== null && report === null && initial !== null);
  // "Gün içinde kasaya giren" çoğu gün yok: alan tutarı varken, LafPOS'tan dolunca ya da "Kasaya giren ekle"yle görünür
  const [cashInOpen, setCashInOpen] = useState(false);
  // Düzeltme önerisi: kilitli günde "Düzeltme öner", bekleyen öneriyi "Öneriyi düzenle" ya da sunucunun onaya çevirdiği
  // gönderim (`fromSubmit`: yazılanlar korunur, şerit nedenini söyler)
  // `dropped`: düzenlemede eklenen ve öneriye gitmeyen fotoğraf sayısı (şerit ve bildirim söyler)
  const [proposal, setProposal] = useState<{ gate: "kilitli" | "gec"; fromSubmit: boolean; dropped: number } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [clientKey, setClientKey] = useState(newClientKey);
  // Geç rapor: "late" kipi ya da 05:00 dönüşünde sunucunun çevirdiği dünün formu
  const [lateTurn, setLateTurn] = useState(false);
  const isLate = mode === "late" || lateTurn;
  const review = mode === "review";
  const [lateReason, setLateReason] = useState(late?.reason ?? "");
  const [handedTo, setHandedTo] = useState<string>(late?.handedTo ? (late.handedTo.kind === "banka" ? "banka" : `user:${late.handedTo.id}`) : "");
  const [handedError, setHandedError] = useState<string | null>(null);
  const ownCorrection = requests?.own.find((r): r is OwnCorrection => r.kind === "kasa-duzeltme") ?? null;
  const ownDelete = requests?.own.find((r): r is OwnDelete => r.kind === "kasa-silme") ?? null;
  // Yükleme bölüm başına: yazarkasa Z'si okunurken ModPOS Z'si çekilebilir (docs/planlar/okc-z.md §3.3)
  const zUp = usePhotoUpload();
  const okcUp = usePhotoUpload();
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
    if (k in marks) setMarks((m) => ({ ...m, [k]: { ...m[k as MarkField]!, warn: null, suggest: null } }));
    if (k === "bankPos") setPosPrompt(null);
  };

  function edit() {
    const s = withLafpos(initialValues(report, carry, cashOuts), lafpos, "compare");
    setValues(s.values);
    setCounter(initialCounter);
    setErrors({});
    setPhotos([]);
    setMarks(s.marks);
    setPosPrompt(null);
    setLafposFilled(s.filled);
    setLafposCompared(lafpos !== null);
    setCashInOpen(false);
    setProposal(null);
    setReason("");
    setReasonError(null);
    setEditing(true);
  }

  /** Düzeltme önerisi: kayıtlı rapordan (kilitli gün) ya da bekleyen önerinin değerlerinden ("Öneriyi düzenle") */
  function propose(from: OwnCorrection | null) {
    if (!report) return;
    edit();
    if (from) {
      const s = withLafpos(initialValues({ ...report, ...from.proposed }, carry, cashOuts), lafpos, "compare");
      setValues(s.values);
      setMarks(s.marks);
      setLafposFilled(s.filled);
      setCounter(from.proposed.countedBy);
      setReason(from.message ?? "");
    }
    setProposal({ gate: from?.gate ?? "kilitli", fromSubmit: false, dropped: 0 });
    setClientKey(newClientKey());
  }

  // Öneriye geçilince neden alanına gidilir (telefonda düğme formun altında; alan ekranın dışında kalmasın)
  useEffect(() => {
    if (!proposal?.fromSubmit) return;
    const el = document.getElementById(`${uid}k-reason`);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }, [proposal, uid]);

  /** Okumayı forma uygular: yalnız boş alanlar dolar; yeşil özet satırını döner */
  function applyReading(photoId: number, r: CashReading): string | null {
    if (!r.ok) return null;
    const current = valuesRef.current;
    // İkinci POS fişi: Banka POS önceki bir POS fotoğrafından geldiyse toplamı mı, yerine mi sorulur
    // (yazarkasa Z'sinin şeridindeki banka gün sonu da; öteki alanları yine uygulanır)
    const prevMark = marksRef.current.bankPos;
    const posValue = r.values.bankPos ? Number(r.values.bankPos.value) : null;
    const askPos = (r.kind === "kasa-pos" || r.kind === "kasa-okc") && posValue !== null && prevMark && prevMark.from !== photoId && prevMark.filled !== null && current.bankPos === prevMark.filled;
    if (askPos) setPosPrompt({ photoId, prev: parseNumberTR(current.bankPos) ?? 0, next: posValue, ...posPromptMarks(r) });
    if (askPos && r.kind === "kasa-pos") return "Banka POS fişi okundu.";
    const plan = prefillPlan(r, Object.fromEntries(READ_FIELDS.filter((f) => !(askPos && f === "bankPos")).map((f) => [f, current[f]])));
    if (plan.fill.length) setValues((v) => ({ ...v, ...Object.fromEntries(plan.fill.map((f) => [f.field, f.text])) }));
    setMarks((m) => planMarks(m, plan, photoId));
    const summary = prefillSummary(r.kind, plan);
    return askPos ? `${summary} Banka gün sonu için aşağıda seçin.` : summary;
  }

  /** LafPOS'un gün sonunu forma uygular: fotoğrafınkiyle aynı kural (yalnız boş alanlar dolar); bandın satırını yazar */
  function fillFromLafpos() {
    if (!lafpos) return;
    const plan = prefillPlan(lafpos.prefill, Object.fromEntries(MARK_FIELDS.map((f) => [f, values[f]])));
    if (plan.fill.length) {
      setValues((v) => ({ ...v, ...Object.fromEntries(plan.fill.map((f) => [f.field, f.text])) }));
      setErrors((x) => ({ ...x, ...Object.fromEntries(plan.fill.map((f) => [f.field, undefined])) }));
    }
    setMarks((m) => planMarks(m, plan, "lafpos"));
    setLafposFilled(plan.fill.length);
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
      advice: !res.readError && r !== null && !r.ok && r.advice === true,
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
  const photosOf = (k: CashPhotoKind) => photos.filter((p) => p.kind === k);
  // Yazarkasa bölümünde eski banka POS fotoğrafları da görünür (geçiş, docs/planlar/okc-z.md D2: yeniden okunursa kasa-okc olur)
  const savedOf = (k: CashPhotoKind) => saved?.photos.filter((p) => p.kind === k || (k === "kasa-okc" && p.kind === "kasa-pos")) ?? [];
  async function pick(kind: CashPhotoKind, file: File) {
    if (savedCount + photos.length >= MAX_REPORT_PHOTOS) return void toast.error(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
    if (kind === "kasa-okc" && savedOf("kasa-okc").length + photosOf("kasa-okc").length >= MAX_OKC_PHOTOS) return void toast.error(OKC_PHOTOS_TEXT);
    const up = kind === "kasa-z" ? zUp : okcUp;
    const res = await up.upload(file, { kind, day: date, read: reading });
    if (res) took(res, kind);
  }

  async function reread(p: FormPhoto, kind: CashPhotoKind) {
    // Öteki bölümden Banka POS Z bölümüne geçen fotoğraf da bölümün sınırına sayılır (gönderimde reddedilmesin)
    if (kind === "kasa-okc" && p.kind !== "kasa-okc" && savedOf("kasa-okc").length + photosOf("kasa-okc").length >= MAX_OKC_PHOTOS) return void toast.error(OKC_PHOTOS_TEXT);
    // Yazarkasa ve eski banka POS (geçiş, D2) aynı bölümün yükleyicisinde
    const up = kind === "kasa-z" ? zUp : okcUp;
    const res = await up.reread(p.id, kind, date);
    if (res) took(res, kind);
  }

  /** Fotoğrafı formdan çıkarır; onun doldurduğu (sonra değiştirilmemiş) alanlar boşalır, getirdiği öneriler kalkar */
  function removePhoto(id: number) {
    setPhotos((ps) => ps.filter((p) => p.id !== id));
    const cleared: Partial<Values> = {};
    const next: Marks = {};
    for (const [k, m] of Object.entries(marks) as [MarkField, Mark][]) {
      if (m.from !== id) {
        next[k] = m.suggest?.from === id ? { ...m, suggest: null } : m;
        continue;
      }
      if (m.filled !== null && values[k] === m.filled) cleared[k] = "";
      // Başka bir fotoğrafın (ya da LafPOS'un) önerisi alanda kalır
      if (m.suggest && m.suggest.from !== id) next[k] = { from: m.suggest.from, filled: null, warn: null, suggest: m.suggest };
    }
    setMarks(next);
    if (Object.keys(cleared).length) setValues((v) => ({ ...v, ...cleared }));
    if (posPrompt?.photoId === id) setPosPrompt(null);
  }

  function takeSuggestion(k: MarkField) {
    const s = marks[k]?.suggest;
    if (!s) return;
    setValues((v) => ({ ...v, [k]: s.text }));
    setMarks((m) => ({ ...m, [k]: { ...m[k]!, from: s.from, filled: s.text, warn: null, suggest: null } }));
  }

  function posChoice(sum: boolean) {
    if (!posPrompt) return;
    const text = fieldText("bankPos", sum ? posPrompt.prev + posPrompt.next : posPrompt.next);
    setValues((v) => ({ ...v, bankPos: text }));
    setMarks((m) => ({ ...m, bankPos: { from: posPrompt.photoId, filled: text, warn: posPrompt.warn, suggest: null } }));
    setPosPrompt(null);
  }

  function submit() {
    const { fields, errors: errs } = readValues(values, date);
    setErrors(errs);
    if (!fields) {
      toast.error("Eksik ya da hatalı alan var", { description: Object.values(errs)[0] });
      // Telefonda düğme formun altında: hatalı ilk alana gidilir (yoksa uyarı ekranın dışında kalır)
      const first = Object.keys(errs)[0];
      const el = first ? document.getElementById(fid(first)) : null;
      el?.scrollIntoView({ block: "center" });
      el?.focus({ preventScroll: true });
      return;
    }
    if (review) {
      if (openingNeedsNote({ check: carryCheck(date, fields.openingCash, carry), openingCash: fields.openingCash, prevOpening: null, note: fields.note })) {
        toast.error("Açılış önceki günün devrinden farklı: nedenini nota yazın");
        document.getElementById(fid("note"))?.focus();
        return;
      }
      onReview?.(fields);
      return;
    }
    if (isLate) {
      // Geç rapor: Z no, Z fotoğrafı, neden ve (teslim varsa) teslim alan zorunlu; açılış zincirin önceki halkasıyla
      const focus = (id: string) => {
        const el = document.getElementById(id);
        el?.scrollIntoView({ block: "center" });
        el?.focus({ preventScroll: true });
      };
      if (!fields.zNo) {
        // LafPOS gününde Z no LafPOS'unkidir (yazarkasa Z'sinin numarası değil; Z LafPOS'ta 1'den başlar)
        setErrors((x) => ({ ...x, zNo: lafposMode ? "LafPOS'un Z no'su gerekli (LafPOS › Kasa › Geçmiş günler)" : "Z no gerekli (Z raporunun üstünde)" }));
        toast.error(lafposMode ? "LafPOS'un Z no'su gerekli" : "Z no gerekli");
        return focus(fid("zNo"));
      }
      // Kanıt: ModPOS gününde Z raporunun fotoğrafı; LafPOS gününde LafPOS'un gün sonu, gelmediyse yazarkasa Z'sinin
      // fotoğrafı (sunucu da aynı kuralla: src/server/cash/late.ts)
      if (!lafposMode && !photos.some((p) => p.kind === "kasa-z")) {
        toast.error("Z raporunun fotoğrafını ekleyin", { description: "Geç rapor Z raporunun fotoğrafıyla onaya gider." });
        return document.getElementById(fid("z-photos"))?.scrollIntoView({ block: "center" });
      }
      if (lafposMode && !lafpos && !photos.some((p) => p.kind === "kasa-okc")) {
        toast.error("Yazarkasa (Banka POS) Z raporunun fotoğrafını ekleyin", { description: "LafPOS'un bu günün sonu gelmedi; geç rapor yazarkasa Z'sinin fotoğrafıyla onaya gider." });
        return document.getElementById(fid("okc-photos"))?.scrollIntoView({ block: "center" });
      }
      const why = lateReason.trim();
      if (why.length < 3) {
        setReasonError("Geç girme nedenini yazın");
        return focus(fid("reason"));
      }
      const to = handedTo === "banka" ? ({ kind: "banka" } as const) : handedTo.startsWith("user:") ? ({ kind: "user", id: Number(handedTo.slice(5)) } as const) : null;
      if (fields.handedOver > 0 && !to) {
        setHandedError("Teslim edileni kimin aldığını seçin");
        return focus(fid("handedTo"));
      }
      if (openingNeedsNote({ check: carryCheck(date, fields.openingCash, carry), openingCash: fields.openingCash, prevOpening: null, note: fields.note })) {
        toast.error("Açılış önceki günün devrinden farklı: nedenini nota yazın");
        return focus(fid("note"));
      }
      start(async () => {
        const res = await requestLateCashReport({
          ...fields,
          zNo: fields.zNo ?? "",
          reason: why,
          requestVersion: late?.version ?? 0,
          photoIds: photos.map((p) => p.id),
          handedTo: fields.handedOver > 0 ? to : null,
          clientKey,
        });
        if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
        toast.success(`Onaya gönderildi · ${diffText(res.data.cashDiff)}`, { description: "Yönetici onaylayınca kayda geçer; sonucu zilde görürsünüz." });
        setClientKey(newClientKey());
        onSent?.();
      });
      return;
    }
    if (proposal && report) {
      // Düzeltme önerisi: neden zorunlu; açılış devirle tutmuyorsa ve not boşsa neden nota da yazılır (sunucuda)
      const why = reason.trim();
      if (why.length < 5) {
        setReasonError("Nedeni en az 5 karakterle yazın");
        const el = document.getElementById(fid("reason"));
        el?.scrollIntoView({ block: "center" });
        el?.focus({ preventScroll: true });
        return;
      }
      const { date: _day, ...rest } = fields;
      void _day;
      start(async () => {
        const res = await requestCashCorrection({ date, baseRevision: report.revision, fields: rest, countedBy: counter, message: why, clientKey });
        if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
        toast.success("Düzeltme onaya gönderildi", { description: "Yönetici onaylayınca rapora işlenir; sonucu zilde görürsünüz." });
        setProposal(null);
        setClientKey(newClientKey());
        setEditing(false);
      });
      return;
    }
    // Açılış önceki devirle tutmuyorsa nedeni nota (sunucu da reddeder; burada not alanına gidilir)
    if (openingNeedsNote({ check: carryCheck(date, fields.openingCash, carry), openingCash: fields.openingCash, prevOpening: report?.openingCash ?? null, note: fields.note })) {
      toast.error("Açılış önceki günün devrinden farklı: nedenini nota yazın");
      document.getElementById(fid("note"))?.focus();
      return;
    }
    start(async () => {
      const res = await submitCashReport({ ...fields, countedBy: counter, revision: report?.revision ?? 0, photos: photos.map((p) => p.id) });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      // Gün döndü (05:00): dünün raporu artık geç rapor; yazılanlar ve fotoğraflar yerinde, geç rapora geçilir
      if (res.data.needsApproval && res.data.request === "kasa-gec") {
        setLateTurn(true);
        setClientKey(newClientKey());
        toast.info("Gün döndü: bu rapor artık yöneticinin onayıyla girilir", { description: "Yazdıklarınız yerinde; Z fotoğrafını ve nedenini ekleyip onaya gönderin." });
        return;
      }
      // Ertesi gün kasa alanı ya da sayan, kilitli gün: hiçbir şey kaydedilmedi; yazılanlar yerinde, öneriye geçilir.
      // Öneri fotoğraf taşımaz: düzenlemede eklenen fotoğraf varsa söylenir
      if (res.data.needsApproval) {
        setProposal({ gate: res.data.gate, fromSubmit: true, dropped: photos.length });
        setClientKey(newClientKey());
        const dropped = photos.length ? ` ${droppedPhotoText(res.data.gate)}` : "";
        toast.info("Bu değişiklik yöneticinin onayıyla olur", { description: `Yazdıklarınız yerinde; nedenini yazıp onaya gönderin.${dropped}`, duration: photos.length ? 12_000 : undefined });
        return;
      }
      const e: CashEmailOutcome = res.data.email;
      // Kayıtlı raporun düzeltmesi "gönderildi" değil (e-posta yalnız ilk gönderimde gider)
      const head = `${report ? "Rapor güncellendi" : "Rapor gönderildi"} · ${diffText(res.data.cashDiff)}`;
      if (e.status === "failed") toast.warning(head, { description: e.error ?? "E-posta gitmedi", duration: 12_000 });
      else toast.success(head, { description: e.status === "sent" ? `E-posta ${e.to} adrese gitti. Şimdi WhatsApp ile gönderebilirsiniz.` : "WhatsApp ile gönderebilirsiniz." });
      // Düzeltme ertesi günün zincirini bozduysa söylenir (ertesi günün açılışı bu raporun devrine dayanır)
      if (res.data.next) {
        toast.warning(`${dayMonthTR(res.data.next.date)} açılışı bu devirle ${res.data.nextBroken ? "artık " : ""}tutmuyor`, {
          description: "Ertesi günün açılışını ya da bu raporun sayımını kontrol edin.",
          duration: 12_000,
        });
      }
      setEditing(false);
    });
  }

  async function resend() {
    if (!report) return;
    setResending(true);
    // Bağlantı yoksa "Gönderilemedi": rapor kayıtlı, yalnız e-posta gitmedi ("Kaydedilemedi" rapor kayboldu sandırır)
    const res = await tryAction(() => resendCashReportEmail(report.id), { offline: SEND_OFFLINE_TEXT });
    setResending(false);
    // Atılan eylem (E-51): bildirim çıktı, düğme bırakıldı
    if (!res) return;
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
    // Sayan gönderenden farklıysa ikisi de; eski raporlarda sayan yok (gönderen saymış sayılır)
    const who = report.countedByName && report.countedByName !== report.submittedByName ? `Sayan ${report.countedByName} · gönderen ${report.submittedByName}` : report.submittedByName;
    const savedCarry = carryCheck(date, report.openingCash, carry);
    const savedNext = next ? carryCheck(next.date, next.openingCash, { date, amount: computeCash(report).carryOver }) : null;
    const diffs = saved ? photoDiffs(saved.readings, savedFields(report)) : [];
    // LafPOS'un gün sonundan farklı yazılanlar (E-09; yalnız LafPOS gününde, gönderimi geldiyse)
    const fromLafpos = lafpos ? lafposDiffs(report, lafpos) : [];
    const lafposOuts = lafpos ? lafposOutsCheck(lafpos.till, outsTotal) : null;
    // Rapordan sonra eklenen kasadan çıkanlar: rapordaki tutar kendiliğinden değişmez (sayılan kasaya bağlı)
    const later = cashOuts.filter((o) => o.createdAt > report.updatedAt);
    const laterNote = later.length && Math.abs(outsTotal - report.cashOut) >= CASH_TOLERANCE ? `Rapordan sonra ${later.length} kasadan çıkan eklendi; fişlerin toplamı ${money(outsTotal)}, raporda ${money(report.cashOut)}.` : null;
    return (
      <Card>
        <CardHeader
          icon={<ReceiptText />}
          title={`Kasa raporu · ${reportNo(date)}`}
          description={`${longDateTR(date)} · ${who} · ${sentAt}${report.revision > 1 ? " · güncellendi" : ""}`}
          meta={
            <Badge tone={DIFF_TONE[diffKind(report.cashDiff)]} dot>
              {diffText(report.cashDiff)}
            </Badge>
          }
        />
        <div className="space-y-4 px-5 pb-5">
          <DiffHeadline diff={report.cashDiff} />
          {mail ? (
            <Notice
              tone={mail.tone === "red" ? "bad" : mail.tone === "green" ? "good" : "neutral"}
              size="sm"
              title={mail.text}
              action={
                report.emailStatus === "failed" ? (
                  <Button size="xs" variant="secondary" onClick={() => void resend()} disabled={resending}>
                    <RotateCw size={13} /> {resending ? "Gönderiliyor…" : "Yeniden dene"}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {saved ? <SavedPhotos photos={saved.photos} diffs={diffs} admin={photoUi.admin} removal={photoRemoval} /> : null}
          <LafposDiffList diffs={fromLafpos} />
          {lafposOuts ? <Notice tone="neutral" size="sm" title={lafposOuts.text} /> : null}
          {laterNote ? <Notice tone="neutral" size="sm" title={laterNote} /> : null}
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
              <Button variant="ghost" size="lg" onClick={edit} disabled={Boolean(ownDelete)}>
                <Pencil size={16} /> Düzenle
              </Button>
            ) : null}
            {requests && !ownDelete ? <DeleteRequestButton date={date} revision={report.revision} label={`${longDateTR(date)} kasa raporu`} /> : null}
          </div>
          {ownDelete && canEdit ? <p className="text-[13px] leading-5 text-ink-mute">Silme isteğiniz bekliyor; önce geri çekin.</p> : null}
          {locked ? (
            <Notice
              tone="neutral"
              size="sm"
              title="Ertesi günün raporu girildi; bu raporu yönetici onayıyla düzeltirsiniz"
              action={
                !ownCorrection && !ownDelete ? (
                  <Button size="xs" variant="secondary" onClick={() => propose(null)}>
                    <Pencil size={14} /> Düzeltme öner
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {requests ? <PendingRequests own={requests.own} others={requests.others} onEdit={(c) => propose(c)} /> : null}
          <CashBreakdown
            report={report}
            cashOuts={cashOuts}
            carry={savedCarry}
            next={savedNext}
            audience={photoUi.admin ? "admin" : "staff"}
            okcAdmin={okcAdmin}
            kasa={lafposMode ? "LafPOS" : "ModPOS"}
            cardExtra={lafpos?.cardExtra ?? null}
          />
          <CashRevisions report={report} revisions={revisions} proposedBy={proposedBy} />
        </div>
      </Card>
    );
  }

  const kind = live ? live.kind : null;
  // Açılış ↔ önceki raporun devri (yazarken): tutmuyorsa turuncu kutu, Sonuç'ta satır ve zorunlu not
  const openingNum = values.openingCash.trim() ? parseNumberTR(values.openingCash) : null;
  const liveCarry = openingNum !== null ? carryCheck(date, openingNum, carry) : null;
  const noteRequired = openingNum !== null && openingNeedsNote({ check: liveCarry, openingCash: openingNum, prevOpening: report?.openingCash ?? null, note: values.note });
  const gap = carry ? Math.max(0, daysBetween(carry.date, date) - 1) : 0;
  const paymentsOff = live && values.zTotal.trim() && Math.abs(live.paymentsDiff) >= CASH_TOLERANCE;
  const offLine = photoUi.storage ? readingOffText(photoUi.reading, photoUi.admin) : null;
  const cashOutValue = values.cashOut.trim() ? parseNumberTR(values.cashOut) : 0;
  const showCashIn = cashInOpen || Boolean(values.cashIn.trim()) || Boolean(marks.cashIn);
  const outsWarning = cashOutValue !== null ? cashOutCheck(cashOutValue, cashOuts.map((o) => o.amount)) : null;
  const latestChecks = (k: CashPhotoKind) => [...photos].reverse().find((p) => p.kind === k && p.reading?.ok)?.reading?.checks ?? [];

  /**
   * Fotoğraftan (LafPOS'tan) gelen alanın etiketi, turuncusu ve altındaki satır. Önerinin değeri alana yazıldıysa (elle ya
   * da Kasadan çıkanlar'dan kendiliğinden) öneri çözülmüştür, görünmez
   */
  const markOf = (k: Key): Mark | undefined => {
    const m = (MARK_FIELDS as readonly string[]).includes(k) ? marks[k as MarkField] : undefined;
    if (!m?.suggest || m.suggest.kind !== "differs" || !sameValue(k as MarkField, values[k], m.suggest.photo)) return m;
    return m.warn ? { ...m, suggest: null } : undefined;
  };
  const labelOf = (k: Key, label: string) => {
    const m = markOf(k);
    return m?.filled !== null && m?.filled !== undefined && values[k] === m.filled ? (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {label}
        <Badge tone="blue">{sourceText(m.from).badge}</Badge>
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
        {m.suggest?.kind === "differs" ? (
          <span className="text-warn">
            {sourceText(m.suggest.from).at} {shownValue(k as MarkField, m.suggest.photo)}
          </span>
        ) : null}
        {m.suggest && !(k === "cashOut" && m.suggest.from === "lafpos" && cashOuts.length) ? (
          <button type="button" onClick={() => takeSuggestion(k as MarkField)} className="cursor-pointer font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11">
            {sourceText(m.suggest.from).take}
          </button>
        ) : null}
      </span>
    );
  };
  // LafPOS'un gün sonu: Z no ve geliş anı (İstanbul saatiyle, sunucuda ve tarayıcıda aynı)
  const lafposZNo = lafpos?.prefill.values.zNo?.value ?? null;
  const lafposAt = lafpos
    ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(lafpos.receivedAt))
    : null;
  const warnOf = (k: Key) => Boolean(markOf(k)?.warn || markOf(k)?.suggest || (k === "openingCash" && liveCarry));
  // Bandın satırı: dolan alan sayısı, hâlâ LafPOS'tan farklı (turuncu) ve sayımı olmayan alanlar
  const lafposNote =
    lafposFilled === null
      ? null
      : lafposSummary(
          {
            fill: new Array<null>(lafposFilled).fill(null),
            differs: MARK_FIELDS.filter((k) => markOf(k)?.suggest?.from === "lafpos"),
            missing: MARK_FIELDS.filter((k) => markOf(k)?.warn === LAFPOS_NO_COUNT_TEXT && !values[k].trim()),
          },
          review ? "staff" : "self",
        );
  // "Gün içinde çıkan"ın kaynağı panelin Kasadan çıkanlar'ı (E-35): LafPOS'un harcama + teslimi tutmuyorsa bilgi satırı.
  // Geç rapor ve "Düzeltip onayla" formuna günün satırları gelmez (`cashOuts` boş): orada karşılaştırılmaz, yöneticinin
  // kartı kayıtlı kasadan çıkanlarla söyler (lafposHandedGap)
  const lafposOuts = lafpos && mode === "report" ? lafposOutsCheck(lafpos.till, outsTotal) : null;
  // Fark yalnız LafPOS'taki teslimin Kasadan çıkanlar'a girilmemesinden mi (alan fişlerin toplamında): Sonuç'ta
  // girilince farkın ne olacağı söylenir (sahte "5.000 ₺ eksik" tek başına durmasın)
  const teslimMissing =
    lafpos && lafposOuts && lafpos.till.handed > 0 && Math.abs(outsTotal - lafpos.till.spent) < 0.01 && cashOutValue !== null && Math.abs(cashOutValue - outsTotal) < 0.01
      ? lafpos.till.handed
      : null;

  const field = (k: MoneyKey | OkcMoneyKey, label: string, opts: OkcFieldOptions & { autoFocus?: boolean } = {}) => (
    <Field label={labelOf(k, label)} htmlFor={fid(k)} hint={hintOf(k, opts.hint)} error={errors[k]}>
      <NumberInput
        id={fid(k)}
        inputMode="decimal"
        value={values[k]}
        onChange={set(k)}
        placeholder={opts.placeholder ?? (REQUIRED.includes(k as MoneyKey) ? "0" : "isteğe bağlı")}
        enterKeyHint="next"
        autoFocus={opts.autoFocus}
        aria-invalid={Boolean(errors[k])}
        data-warn={warnOf(k) || opts.warn || undefined}
      />
    </Field>
  );
  /** Yazarkasa Z no ve fiş sayısı (sayısal metin) */
  const textField = (k: "okcZNo" | "okcReceipts", label: string, opts: OkcFieldOptions = {}) => (
    <Field label={labelOf(k, label)} htmlFor={fid(k)} hint={hintOf(k, opts.hint)} error={errors[k]}>
      <Input
        id={fid(k)}
        inputMode="numeric"
        value={values[k]}
        onChange={set(k)}
        maxLength={k === "okcZNo" ? 30 : 6}
        autoComplete="off"
        placeholder={opts.placeholder}
        aria-invalid={Boolean(errors[k])}
        data-warn={warnOf(k) || opts.warn || undefined}
      />
    </Field>
  );

  // Gönderim yüklemesi süren bir fotoğraf varken bekler (fotoğrafın kimliği yanıtla gelir); seçiciler bölüm başına
  const busy = zUp.busy || okcUp.busy;
  const latestOkc = [...photos].reverse().find((p) => p.kind === "kasa-okc" && p.reading?.ok)?.reading ?? null;
  // Z'de toplam dışı tahsilat (tutarı personele gelmez): kayıtlı raporun sunucu sütunundan ya da bu formun okumasından
  const extraTakings = report?.okcExtraTakings === true || (report?.okcOutside ?? 0) > 1 || photos.some((p) => p.kind === "kasa-okc" && p.reading?.extraTakings === true);
  const photoBlock = (k: "kasa-z" | "kasa-okc") => {
    const up = k === "kasa-z" ? zUp : okcUp;
    return photoUi.storage && !proposal && !review ? (
      <div id={fid(k === "kasa-z" ? "z-photos" : "okc-photos")} className="scroll-mt-24 space-y-2.5 sm:col-span-2">
        <PhotoPicker onPick={(f) => void pick(k, f)} read={reading} disabled={up.busy} />
        {k === "kasa-okc" ? <p className="text-[13px] leading-5 text-ink-mute">Fişi düz koyun, ekranı fişle doldurun; uzunsa önce üstünü, sonra altını çekin.</p> : null}
        <PhotoStatus phase={up.phase} />
        {offLine ? <p className="text-[13px] leading-5 text-ink-mute">{offLine}</p> : null}
        <CardPhotos
          saved={savedOf(k)}
          photos={photosOf(k)}
          busy={up.busy}
          onRemove={removePhoto}
          onRetry={(p) => void reread(p, p.kind)}
          // ModPOS bölümünün düğmesi "kasa-pos" der (eski açık sayfa için, kasa.ts wrongDocument): bu formda Banka POS Z bölümü
          onSwitch={(p) => p.switchTo && void reread(p, p.switchTo === "kasa-pos" ? "kasa-okc" : p.switchTo)}
        />
        <ReadChecks checks={latestChecks(k)} />
        {k === "kasa-okc" && latestOkc && okcNeedsHalves(latestOkc) ? <p className="text-[13px] leading-5 text-ink-mute">{OKC_HALVES_TEXT}</p> : null}
      </div>
    ) : null;
  };
  const okcMarked = (k: FormReadField) => Boolean(marks[k]?.warn || marks[k]?.suggest);
  const num = (k: MoneyKey) => (values[k].trim() ? (parseNumberTR(values[k]) ?? 0) : 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        {isLate && !review ? (
          <Notice
            tone="neutral"
            title={`Geç rapor · ${longDateTR(date)}: yönetici onaylayınca kayda geçer`}
            text={
              !lafposMode
                ? "Z raporunun fotoğrafı ve Z no zorunlu; gün içinde kasadan çıkanı elle yazın."
                : lafpos
                  ? lafposCompared
                    ? "Önceki yazdıklarınız LafPOS'un gün sonuyla karşılaştırıldı, farklı olanlar turuncu; fotoğraf gerekmez. Sayımı ve gün içinde kasadan çıkanı kontrol edin."
                    : "Rakamlar LafPOS'un gün sonundan doldu; fotoğraf gerekmez. Sayımı ve gün içinde kasadan çıkanı kontrol edin."
                  : "LafPOS'un bu günün sonu gelmedi: yazarkasa (Banka POS) Z raporunun fotoğrafı zorunlu; LafPOS gün sonu bölümündeki Z no'yu LafPOS › Kasa › Geçmiş günler'den yazın."
            }
          />
        ) : null}
        {proposal ? (
          <Notice
            tone="neutral"
            title={`${dayMonthTR(date)} kasa raporu · düzeltme önerisi`}
            text={
              <>
                {proposal.fromSubmit ? (
                  <span className="block">
                    {proposal.gate === "kilitli"
                      ? "Ertesi günün raporu girildi; bu değişiklik yöneticinin onayıyla olur. Nedenini yazıp onaya gönderin."
                      : "Kasa alanlarını ertesi gün değiştirmek yöneticinin onayıyla olur; nedenini yazıp onaya gönderin."}
                  </span>
                ) : null}
                <span className="block">Yönetici onaylayınca rapora işlenir; o zamana kadar rapor değişmez.</span>
                {proposal.dropped ? <span className="block font-medium text-ink">{droppedPhotoText(proposal.gate)}</span> : null}
              </>
            }
          />
        ) : null}
        {lafpos ? (
          <div className="space-y-1.5">
            <Notice
              tone="neutral"
              title={`LafPOS gün sonu${lafposZNo !== null ? ` · Z ${lafposZNo}` : ""} · ${lafposAt}`}
              text={lafposNote ?? "Z ve kasa rakamları boş alanlara yazılır, yazdıklarınız değişmez; bakıp gönderin."}
              action={
                <Button size="xs" variant="secondary" onClick={fillFromLafpos} disabled={pending}>
                  LafPOS&apos;tan doldur
                </Button>
              }
            />
            {/* Doldurduktan sonra kasa eşlemesinin bilgi satırları (giren çıkandan fazla, LafPOS'un olması gerekeni farklı) */}
            {lafposNote !== null ? <ReadChecks checks={lafpos.prefill.checks} /> : null}
          </div>
        ) : null}
        <Card>
          <CardHeader
            icon={<ReceiptText />}
            title={lafposMode ? "LafPOS gün sonu (Z)" : "ModPOS Z raporu"}
            description={
              lafposMode
                ? lafpos
                  ? lafposCompared
                    ? "Yazılan rakamlar LafPOS'un gün sonuyla karşılaştırıldı: farklı olanlar turuncu, altında LafPOS'taki."
                    : "LafPOS'un gün sonundan doldu; LafPOS'taki Z raporuyla karşılaştırın."
                  : "LafPOS'un bu günün sonu gelmedi; LafPOS'ta Kasa › Geçmiş günler'deki Z raporundan yazın."
                : isLate
                ? "Z raporunun fotoğrafı zorunlu; rakamlar fotoğraftan dolar ya da elle yazın."
                : photoUi.storage && reading
                  ? "ModPOS'ta gün sonu Z raporunu alın; fotoğrafını çekin, rakamlar dolar. Ya da elle yazın."
                  : "ModPOS'ta gün sonu Z raporunu alın; toplam satışı ve ödeme türlerini yazın."
            }
          />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {/* LafPOS gününde ModPOS Z fotoğrafı yok: Z LafPOS'tan gelir (yazarkasa Z bölümü kalır) */}
            {lafposMode ? null : photoBlock("kasa-z")}
            {field("zTotal", "Toplam satış (Z)", { autoFocus: !report && !photoUi.storage && !lafpos })}
            <Field label={labelOf("zNo", "Z no")} htmlFor={fid("zNo")} hint={hintOf("zNo", isLate ? "zorunlu" : "isteğe bağlı")} error={errors.zNo}>
              <Input id={fid("zNo")} inputMode="numeric" value={values.zNo} onChange={set("zNo")} maxLength={30} autoComplete="off" aria-invalid={Boolean(errors.zNo)} data-warn={warnOf("zNo") || undefined} />
            </Field>
            {field("cash", "Nakit")}
            {field("card", "Kredi / banka kartı")}
            {field("mealCard", "Yemek kartı", { hint: "Multinet, Pluxee, Edenred, Setcard…" })}
            {field("online", "Online", { hint: "Yemeksepeti, Getir, Trendyol…" })}
            {field("other", "Diğer", { hint: "havale, cari, ikram…" })}
            {field("offRevenue", "Ödenmez / ikram", { hint: "Z raporunda ciro dışı (isteğe bağlı)" })}
            {field("discounts", "İndirim", { hint: "Z raporundaki indirim toplamı (isteğe bağlı)" })}
            <Field label={labelOf("receipts", "Fiş sayısı")} htmlFor={fid("receipts")} hint={hintOf("receipts", "isteğe bağlı")}>
              <Input id={fid("receipts")} inputMode="numeric" value={values.receipts} onChange={set("receipts")} maxLength={6} autoComplete="off" data-warn={warnOf("receipts") || undefined} />
            </Field>
            {paymentsOff && live ? (
              <Notice
                tone="warn"
                size="sm"
                className="sm:col-span-2"
                title={`Ödeme türleri ${revenueWord(live)} ${money(Math.abs(live.paymentsDiff))} ${live.paymentsDiff > 0 ? "fazla" : "az"}`}
                text={`Toplamları ${money(live.paymentsTotal)}. Bir tutarı yanlış yazmış olabilirsiniz.`}
              />
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Wallet />} title="Kasa (nakit)" description="Çekmecedeki bütün nakdi sayın; teslim ettiğiniz parayı sayımdan sonra yazın." />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {field("openingCash", "Açılış (dünden devir)", {
              hint: liveCarry ? (
                <Notice
                  tone="warn"
                  size="sm"
                  risk="para"
                  live="polite"
                  className="mt-0.5"
                  title={`Önceki raporun devri ${money(liveCarry.carry)} (${dayMonthTR(liveCarry.prevDate)}); yazdığınız ${carryDiffText(liveCarry)}`}
                  text="Kasaya para kondu ya da alındıysa nedenini nota yazın."
                  action={
                    <Button size="xs" variant="secondary" onClick={() => setValues((v) => ({ ...v, openingCash: input(liveCarry.carry) }))}>
                      Devri yaz
                    </Button>
                  }
                />
              ) : carry ? (
                `Önceki rapordan (${longDateTR(carry.date)}): ${money(carry.amount)}${gap ? ` · arada rapor girilmemiş ${gap} gün var` : ""}`
              ) : (
                "Gün başında kasadaki nakit"
              ),
            })}
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
            <Field label="Neye çıktı" htmlFor={fid("cashOutNote")} hint="isteğe bağlı">
              <Input id={fid("cashOutNote")} value={values.cashOutNote} onChange={set("cashOutNote")} maxLength={200} placeholder="ör. süt, buz" autoComplete="off" />
            </Field>
            {showCashIn ? (
              field("cashIn", "Gün içinde kasaya giren", { hint: "Satış dışı: bozuk para, tahsilat, nakit bahşiş", autoFocus: cashInOpen })
            ) : (
              <p className="flex flex-wrap items-center gap-x-2 text-[13px] leading-5 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setCashInOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-1 font-medium text-ink underline-offset-2 hover:underline pointer-coarse:min-h-11"
                >
                  <Plus size={14} aria-hidden="true" /> Kasaya giren ekle
                </button>
                <span className="text-ink-mute">bozuk para, tahsilat, nakit bahşiş</span>
              </p>
            )}
            {field("handedOver", "Teslim edilen", { hint: "Sayımdan sonra kasadan alınan (patrona, bankaya)" })}
            {isLate && !review && (parseNumberTR(values.handedOver) ?? 0) > 0 ? (
              <Field label="Teslim alan" htmlFor={fid("handedTo")} hint="Teslim edileni kim aldı ya da bankaya mı yatırıldı?" error={handedError ?? undefined}>
                <Select
                  id={fid("handedTo")}
                  value={handedTo}
                  onChange={(e) => {
                    setHandedTo(e.target.value);
                    setHandedError(null);
                  }}
                  aria-invalid={Boolean(handedError)}
                >
                  <option value="">Seçin</option>
                  {counters.map((c) => (
                    <option key={c.id} value={`user:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                  <option value="banka">Banka</option>
                </Select>
              </Field>
            ) : null}
            {counters.length && !isLate && !review ? (
              <Field label="Kasayı sayan" htmlFor={fid("counter")} hint="Çekmeceyi kim saydı? Siz değilseniz seçin.">
                <Select id={fid("counter")} value={counter ?? ""} onChange={(e) => setCounter(e.target.value ? Number(e.target.value) : null)}>
                  {counter === null ? <option value="">Seçin</option> : null}
                  {counters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {outsWarning ? <Notice tone="warn" size="sm" className="sm:col-span-2" title={outsWarning} /> : null}
            {lafposOuts ? <Notice tone="neutral" size="sm" className="sm:col-span-2" title={lafposOuts.text} /> : null}
          </div>
        </Card>
        <OkcCard
          values={values}
          field={field}
          textField={textField}
          marked={(k) => okcMarked(k)}
          failed={(k) => Boolean(errors[k])}
          photoBlock={photoBlock("kasa-okc")}
          posPrompt={
            posPrompt ? (
              // Pencere içi istisna: iki düğme (docs/planlar/ux-sade.md Ek A 97)
              <Notice
                tone="neutral"
                size="sm"
                title={`Bu günün bir banka gün sonu fişi daha okundu (${money(posPrompt.next)})`}
                text={
                  <>
                    {posPrompt.unsure ? <span className="block text-warn-ink">{posPrompt.unsure}</span> : null}
                    <span className="mt-1.5 flex flex-wrap gap-2">
                      <Button size="xs" variant="secondary" onClick={() => posChoice(true)}>
                        Toplama ekle ({money(posPrompt.prev + posPrompt.next)})
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => posChoice(false)}>
                        Yerine yaz
                      </Button>
                    </span>
                  </>
                }
              />
            ) : null
          }
          description={
            photoUi.storage && reading && !proposal && !review
              ? `Banka POS'tan (yazarkasa) aldığınız Z raporu: üstünde Z RAPORU ve KDV dökümü yazar; banka gün sonu fişi değil. ${
                  // Doldurma kapısı kapalıyken okunan rakam yalnız öneridir (docs/KASA-RAPORU.md › Fotoğraftan doldurma)
                  OKC_PREFILL_ENABLED ? "Fotoğrafını çekin, rakamlar dolar." : "Fotoğrafını çekin; okunan rakamlar alanların altında öneri olarak çıkar, fişle karşılaştırıp yazın."
                } Fotoğraf yoksa aşağıdakileri yazın.`
              : "Banka POS'tan (yazarkasa) aldığınız Z raporundaki rakamları yazın (üstünde Z RAPORU ve KDV dökümü yazar)."
          }
          prevZ={prevOkcZ}
          extraTakings={extraTakings}
          day={date}
          audience={photoUi.admin ? "admin" : "staff"}
          forceDetails={photoUi.admin}
          kasa={lafposMode ? "LafPOS" : "ModPOS"}
          modpos={
            values.card.trim()
              ? { zTotal: num("zTotal"), cash: num("cash"), card: num("card"), mealCard: num("mealCard"), online: num("online"), other: num("other"), cardExtra: lafpos?.cardExtra ?? null }
              : null
          }
        />
      </div>
      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Card>
          <CardHeader
            icon={<Calculator />}
            title="Sonuç"
            description={
              review
                ? `${longDateTR(date)} · sizin değerleriniz; personelin girdiği 1. sürüm olarak kalır`
                : isLate
                  ? `${longDateTR(date)} · onaya gider; yönetici onaylayınca kayda geçer`
                  : proposal
                    ? `${longDateTR(date)} · önerinin sonucu; rapor onaya kadar değişmez`
                    : `${longDateTR(date)} · gönderince yöneticiye e-posta gider`
            }
          />
          <div className="space-y-3 px-5 pb-5">
            {live ? (
              <>
                <DiffHeadline diff={live.cashDiff} />
                {teslimMissing !== null ? (
                  <Notice
                    tone="neutral"
                    size="sm"
                    title={`LafPOS'taki teslim (${money(teslimMissing)}) Kasadan çıkanlar'da yok; eklenince fark: ${diffText(Math.round((live.cashDiff + teslimMissing) * 100) / 100)}.`}
                  />
                ) : null}
                <div className="divide-y divide-line text-sm">
                  <p className="flex justify-between py-1.5">
                    <span className="text-ink-mute">Olması gereken</span>
                    <span className="tabular">{money(live.expectedCash)}</span>
                  </p>
                  <p className="flex justify-between py-1.5">
                    <span className="text-ink-mute">Ertesi güne devir</span>
                    <span className="tabular">{money(live.carryOver)}</span>
                  </p>
                  {liveCarry ? <p className="py-1.5 text-warn">Açılış devirden {carryDiffText(liveCarry)}</p> : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-mute">Nakit satış, açılış ve sayılan nakdi yazınca kasa farkı burada görünür.</p>
            )}
            <Field
              label="Not"
              htmlFor={fid("note")}
              hint={
                noteRequired && proposal
                  ? "Açılış devirle tutmuyor: boş bırakırsanız düzeltmenin nedeni buraya da yazılır"
                  : noteRequired
                  ? "Açılış devirle tutmuyor: nedenini yazın (zorunlu)"
                  : kind && kind !== "even"
                    ? "Fark var: nedenini kısaca yazın (ör. bozuk para, iade, yanlış fiş)"
                    : "isteğe bağlı"
              }
              className={(kind && kind !== "even" && !values.note.trim()) || noteRequired ? "[&_label]:text-warn" : undefined}
            >
              <Textarea id={fid("note")} value={values.note} onChange={set("note")} rows={3} maxLength={1000} />
            </Field>
            {proposal ? (
              <Field label="Neden düzeltiyorsunuz?" htmlFor={fid("reason")} hint="Yönetici görür; onaylayınca rapora işlenir" error={reasonError ?? undefined} className={reasonError ? undefined : "[&_label]:text-warn"}>
                <Textarea
                  id={fid("reason")}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setReasonError(null);
                  }}
                  rows={3}
                  maxLength={500}
                  placeholder="ör. teslim edilen yanlış yazılmış"
                />
              </Field>
            ) : null}
            {isLate && !review ? (
              <Field label="Neden geç giriliyor?" htmlFor={fid("reason")} hint="Yönetici görür; başka biri saydıysa buraya yazın" error={reasonError ?? undefined} className={reasonError ? undefined : "[&_label]:text-warn"}>
                <Textarea
                  id={fid("reason")}
                  value={lateReason}
                  onChange={(e) => {
                    setLateReason(e.target.value);
                    setReasonError(null);
                  }}
                  rows={3}
                  maxLength={300}
                  placeholder="ör. akşam sistem kapalıydı, Z ertesi gün alındı"
                />
              </Field>
            ) : null}
            <Button size="lg" className="w-full" onClick={submit} disabled={pending || busy || reviewPending}>
              <Send size={16} />{" "}
              {pending || reviewPending
                ? "Gönderiliyor…"
                : busy
                  ? "Fotoğraf bekleniyor…"
                  : review
                    ? "Düzeltip onayla"
                    : isLate
                      ? late?.updating
                        ? "Güncelle ve gönder"
                        : "Onaya gönder"
                      : proposal
                        ? "Onaya gönder"
                        : report
                          ? "Raporu güncelle"
                          : "Raporu gönder"}
            </Button>
            {report ? (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setProposal(null);
                  setEditing(false);
                }}
                disabled={pending}
              >
                Vazgeç
              </Button>
            ) : onCancel ? (
              <Button variant="ghost" className="w-full" onClick={onCancel} disabled={pending || reviewPending}>
                Vazgeç
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
