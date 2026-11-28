"use client";

import { Calculator, Camera, ChevronDown, Copy, MessageCircle, Pencil, Plus, ReceiptText, RotateCw, Send, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { PhotoPicker, PhotoStatus, usePhotoUpload } from "@/components/panel/photo-picker";
import { SEND_OFFLINE_TEXT, tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { BRANCH_LEAVE, useLeaveGuard } from "@/components/ui/leave-guard";
import { Notice } from "@/components/ui/notice";
import { parseNumberTR } from "@/lib/calc/expr";
import { reportAttention, reportFlags } from "@/lib/cash-attention";
import { cashDraftJson, cashDraftKey, droppedPhotosText, leaveDialogText, leaveDropsDraft, parseCashDraft, restorableDraftPhotos, staleCashDraftKeys, type CashDraft } from "@/lib/cash-draft";
import { CASH_OUT_NOTE_REQUIRED, cashOutCheck, cashOutNoteMissing, cashOutNoteOf, cashOutNoteVisible, cashOutsTotal } from "@/lib/cash-outs";
import {
  businessDate,
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
import { asilposDiffs } from "@/lib/asilpos/diffs";
import { staffAutoNote, staffPhotoDiffs } from "@/lib/asilpos/foto";
import { BLIND_COUNT_TEXT, countNeedsReason, countReasonError, type BlindCountLock } from "@/lib/kor-sayim";
import { BLIND_TEXT } from "@/lib/asilpos/kor-kasa";
import { ASILPOS_NO_COUNT_TEXT, asilposOutsCheck, asilposSummary, unreceiptedCashOut, type AsilposDay } from "@/lib/asilpos/prefill";
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
import { HANDED_TO_MAX, handedToChoiceOf, handedToInputOf, handedToMissing, HANDOVER_TEXT, type HandedToChoice } from "@/lib/teslim";
import { cn } from "@/lib/utils";
import { lockCashCount, resendCashReportEmail, submitCashReport } from "@/server/actions/cash-report";
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
import { CashBreakdown, DiffHeadline, AsilposDiffList, type OkcAdminView } from "./cash-summary";
import { Fold } from "./fold";
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

/** Bildirimde hatalı alanın adı (tutarlar LABELS'tan; yazarkasa alanlarının iletisi adını zaten söyler) */
const FIELD_NAMES: Partial<Record<Key, string>> = { ...LABELS, zNo: "Z no", receipts: "Fiş sayısı" };

/**
 * Alana gider ve odaklanır. Alan kapalı bir katın içindeyse (Fold, ya da Yazarkasa kartının Ayrıntılar'ı) önce kat
 * açılır: gizli alana kaydırılamaz, odak da düşmez (kişi katı kapatıp yeniden gönderdiyse de)
 */
function goToField(el: HTMLElement | null) {
  if (!el) return;
  const fold = el.closest<HTMLElement>("[hidden]");
  if (fold?.id) {
    const toggle = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(fold.id)}"]`);
    if (toggle) flushSync(() => toggle.click());
  }
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
}

/**
 * Formda fotoğraftan dolabilen alanlar (Z okuması İndirim'i de doldurur; yazılan değer hiçbir zaman değişmez). Yazarkasa
 * alanları ModPOS'unkilerden ayrı anahtarlardır (çapraz karşılaştırma olmaz)
 */
const READ_FIELDS = ["zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "zNo", "receipts", "bankPos", ...OKC_KEYS] as const satisfies readonly (ReadField & Key)[];
type FormReadField = (typeof READ_FIELDS)[number];
/** Ön doldurmanın işaretlediği alanlar: fotoğrafınkiler ve AsilPOS'un gün sonunun kasa alanları (docs/ASILPOS.md) */
const MARK_FIELDS = [...READ_FIELDS, ...(["openingCash", "cashIn", "cashOut", "countedCash", "handedOver"] as const satisfies readonly (TillField & Key)[])];
type MarkField = (typeof MARK_FIELDS)[number];

const input = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

/** Taslağın okunuşu (useSyncExternalStore: sunucuda ve hidrasyonda null, sonra bu cihazdaki taslak) */
const noopSubscribe = () => () => {};
function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

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

/** Ön doldurmanın kaynağı: fotoğrafın kimliği ya da AsilPOS'un gün sonu */
type MarkSource = number | "asilpos";

/**
 * Fotoğraftan (ya da AsilPOS'tan) gelen alanın durumu: `from` alana yazanı, `filled` forma yazılan metin (değer hâlâ
 * buysa "Fotoğraftan" / "AsilPOS'tan" rozeti), `warn` turuncu nedeni, `suggest` yazılandan farklı ya da net okunamayan
 * değer ve onu getiren ("Fotoğraftakini yaz", "AsilPOS'takini yaz"). Alana yazınca turuncu kalkar.
 */
interface Mark {
  from: MarkSource;
  filled: string | null;
  warn: string | null;
  suggest: { text: string; photo: number | string; kind: "differs" | "unsure"; from: MarkSource } | null;
}
type Marks = Partial<Record<MarkField, Mark>>;

/** Fotoğraftaki (AsilPOS'taki) değerin ekrandaki hâli */
const shownValue = (field: MarkField, v: number | string) => (field === "zNo" || field === "receipts" || field === "okcZNo" || field === "okcReceipts" ? String(v) : money(Number(v)));

const SOURCE_TEXT = {
  photo: { badge: "Fotoğraftan", at: "Fotoğrafta", take: "Fotoğraftakini yaz" },
  asilpos: { badge: "AsilPOS'tan", at: "AsilPOS'ta", take: "AsilPOS'takini yaz" },
} as const;
const sourceText = (from: MarkSource) => SOURCE_TEXT[from === "asilpos" ? "asilpos" : "photo"];

/**
 * Bir ön doldurmanın (fotoğraf okuması ya da AsilPOS) işaretleri: dolan alan kaynağıyla işaretlenir. Yazılmış ve farklı
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
  for (const f of plan.missing) next[f as MarkField] = { from, filled: null, warn: from === "asilpos" ? ASILPOS_NO_COUNT_TEXT : MISSING_TEXT, suggest: null };
  return next;
}

/**
 * AsilPOS gününde formun ilk hâli (docs/ASILPOS.md › Kasa raporu, G7). Yeni rapor (`fill`): AsilPOS'un gün sonu açılışta
 * kendiliğinden uygulanır, fotoğrafınkiyle aynı kuralla (yalnız boş alanlar dolar, yazılmış ve farklı olanın altında
 * "AsilPOS'ta …"). Yazılmış değerlerle açılan form (`compare`: Düzenle, düzeltme önerisi, geç raporun önceki değerleri,
 * Düzeltip onayla): hiçbir alan kendiliğinden değişmez; boş bırakılmış alanın AsilPOS'taki değeri de yalnız öneridir
 * ("AsilPOS'ta …", "AsilPOS'takini yaz"; isteğe bağlı tutarın boşu 0'dır, AsilPOS'ta 0 ise öneri yok). Hiçbir şey kaydedilmez.
 * AsilPOS'un özeti yoksa olduğu gibi.
 */
function withAsilpos(v: Values, asilpos: AsilposDay | null, mode: "fill" | "compare"): { values: Values; marks: Marks; filled: number | null } {
  if (!asilpos) return { values: v, marks: {}, filled: null };
  const plan = prefillPlan(asilpos.prefill, Object.fromEntries(MARK_FIELDS.map((f) => [f, v[f]])));
  if (mode === "compare") {
    const suggested = plan.fill.flatMap((f) => {
      const value = asilpos.prefill.values[f.field]?.value;
      return value === undefined || value === 0 ? [] : [{ field: f.field, photo: value, text: f.text }];
    });
    return { values: v, marks: planMarks({}, { ...plan, fill: [], differs: [...plan.differs, ...suggested], missing: [] }, "asilpos"), filled: 0 };
  }
  const values = plan.fill.length ? { ...v, ...Object.fromEntries(plan.fill.map((f) => [f.field, f.text])) } : v;
  return { values, marks: planMarks({}, plan, "asilpos"), filled: plan.fill.length };
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
 * AsilPOS günü (`asilposMode`: geçiş günü seçili ve gün ondan önce değil; docs/ASILPOS.md › Kasa raporu): Z bölümü "AsilPOS
 * gün sonu (Z)", ModPOS Z fotoğrafı yok (yazarkasa Z bölümü kalır). AsilPOS günün sonunu gönderdiyse (`asilpos`) form
 * açılırken (ve Düzenle'de) Z ve kasa rakamları fotoğrafınkiyle aynı kuralla boş alanlara kendiliğinden yazılır
 * ("AsilPOS'tan" rozeti), yazılmış ve farklı olanın altında "AsilPOS'ta …" ve "AsilPOS'takini yaz"; bant "AsilPOS'tan
 * doldur" ile yeniden uygular. Kaydetmez; personel bakıp gönderir. "Gün içinde çıkan"ın kaynağı panelin Kasadan
 * çıkanlar'ıdır (E-35): AsilPOS'un harcama + teslimi tutmazsa bilgi satırı, fişler varken "AsilPOS'takini yaz" yok.
 * Kayıtlı görünüm AsilPOS'tan farklı yazılanları gösterir (E-09).
 *
 * "Gün içinde kasaya giren" (nakit satış dışında konan: bozuk para, tahsilat, nakit bahşiş) olması gereken nakde eklenir
 * (computeCash). Çoğu gün yoktur: alan tutarı varken, AsilPOS'tan dolunca ya da "Kasaya giren ekle"yle görünür.
 *
 * Personelin sonradan düzeltmesi (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği): kilitli günde "Düzeltme
 * öner", ertesi gün kasa alanı ya da sayan değişince sunucu gönderimi onaya çevirir; form yazılanları koruyarak düzeltme
 * önerisine geçer (fotoğraf yok, "Neden düzeltiyorsunuz?" zorunlu, "Onaya gönder"). Rapor onaya kadar değişmez.
 *
 * Geç rapor (`mode="late"`; docs/KASA-RAPORU.md › Geç rapor): dünden eski bir günü personel Z fotoğrafı (AsilPOS
 * gününde AsilPOS'un gün sonu geldiyse fotoğraf gerekmez, gelmediyse yazarkasa Z'sinin fotoğrafı), Z no ve
 * nedeniyle onaya gönderir; sayan isteyendir (seçici yok), teslim varsa teslim alan seçilir, gün içinde çıkan elle
 * yazılır. Dünün formu gönderilirken gün döndüyse (05:00) sunucu geç rapora çevirir, form yazılanlarla geçer.
 * "Düzeltip onayla" (`mode="review"`): yönetici geç raporu kendi değerleriyle onaylar (fotoğraf, sayan ve neden yok).
 *
 * AsilPOS gününde (G7) yalnız yeni form AsilPOS'un gün sonuyla dolar; yazılmış değerlerle açılan form (Düzenle, öneri,
 * geç raporun önceki değerleri, Düzeltip onayla) yalnız karşılaştırır ve metinleri de öyle der (`asilposCompared`).
 */
export function CashForm({
  date,
  report,
  carry,
  whatsapp,
  recipients,
  canEdit,
  readOnly = false,
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
  asilpos = null,
  asilposMode = asilpos !== null,
  asilposAuto = false,
  asilposPhotoLabel,
  dayPhotoCard = false,
  branchId = null,
  blindCount = null,
  handoverAdmins = [],
}: {
  date: string;
  report: CashReportDTO | null;
  /**
   * Formun kasası (docs/SUBE.md › Yazarken hangi şube): rapor, düzeltme ve silme isteği ve geç rapor bu şubeye gider,
   * gönderim anındaki seçime değil (başka sekmede seçici değişmiş olabilir). Yoksa sunucu seçili kasayı kullanır
   */
  branchId?: string | null;
  /** Önceki raporun ertesi güne devri (açılış kendiliğinden dolar ve onunla karşılaştırılır) */
  carry: { date: string; amount: number } | null;
  whatsapp: { text: string; link: string } | null;
  /** Kaç adrese e-posta gider (adresler personele gösterilmez); e-posta kapalıysa ya da gönderim kurulmamışsa 0 */
  recipients: number;
  canEdit: boolean;
  /**
   * Salt okunur hesap (muhasebeci; src/lib/roles.ts › isReadOnly): kayıtlı raporu rakamlarıyla okur. `canEdit` zaten
   * kapalıdır (Düzenle yok); buna ek olarak e-postayı yeniden göndermek de çizilmez (o da yazan bir eylem)
   */
  readOnly?: boolean;
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
  /** AsilPOS'un bu günün sonu (Z ve kasa rakamları); yoksa "AsilPOS'tan doldur" görünmez */
  asilpos?: AsilposDay | null;
  /** Günün kasası AsilPOS (geçiş gününden sonra; gönderimi gelmemiş olsa da): Z bölümü AsilPOS'un, ModPOS fotoğrafı yok */
  asilposMode?: boolean;
  /**
   * Rapor AsilPOS'un gün sonundan kendiliğinden yazıldı (gün sonu tam, 24 Kasım 2026): personele rakamlar salt okunur,
   * tek işi gün sonu fotoğrafı (sayfanın "Gün sonu fotoğrafı" kartı). Düzenle, silme isteği, düzeltme önerisi, WhatsApp ve
   * metin personelde yok: düzeltme AsilPOS'ta yapılır (föy, yeniden açma), AsilPOS yeniden gönderir. Yönetici Düzenle'yi
   * görür; elle düzelttiği alanı sonraki otomatik güncelleme ezmez
   */
  asilposAuto?: boolean;
  /** AsilPOS gününün gün sonu fotoğrafının adı (asilposPhotoLabel: "Pavo gün sonu fişi"); yoksa türün adı */
  asilposPhotoLabel?: string;
  /**
   * Sayfada AsilPOS gününün "Gün sonu fotoğrafı" kartı var (gün sonu geldi): yazarkasanın fişi oradan eklenir, formda
   * ikinci bir yazarkasa fotoğraf seçicisi çizilmez (aynı fiş iki kartta istenmesin)
   */
  dayPhotoCard?: boolean;
  /**
   * Kör sayım (Tuzla; src/lib/kor-sayim.ts, docs/KASA-RAPORU.md › Kör sayım): personelde ve bu günde geçerliyse verilir;
   * `lock` geçerli sayım (yoksa null). Sayım kilitlenmeden olması gereken ve kasa farkı çizilmez, rapor gönderilmez;
   * kilitli sayım salt okunur, "Sayımı değiştir" nedeniyle yeni sayım yazar (yöneticiye görünür). Yöneticide verilmez
   */
  blindCount?: { lock: BlindCountLock | null } | null;
  /** "Kime" seçicisinin yönetici kullanıcıları (Teslim defteri; sayımdan sonra teslim) */
  handoverAdmins?: { id: number; name: string }[];
}) {
  // Öğe kimlikleri form başına: Onaylar'da iki "Düzeltip onayla" formu aynı anda açıkken etiket, odak ve kaydırma
  // öteki karta gitmesin
  const uid = useId();
  const fid = (name: string) => `${uid}k-${name}`;
  const [editing, setEditing] = useState(report === null);
  // AsilPOS gününde yeni formun ilk hâli AsilPOS'un gün sonuyla; yazılmış değerlerle açılan form yalnız karşılaştırır
  // (withAsilpos). Kayıtlı rapor görünümde açılır, Düzenle'de karşılaştırılır
  const [opening] = useState(() => {
    const o = withAsilpos(initialValues(report ?? initial, carry, cashOuts), report === null ? asilpos : null, initial === null ? "fill" : "compare");
    // Kör sayım: kilitlenmiş sayım yeni raporun sayılanıdır (sayfa yenilense de)
    return blindCount?.lock && !report && !initial ? { ...o, values: { ...o.values, countedCash: input(blindCount.lock.amount) } } : o;
  });
  const [values, setValues] = useState<Values>(opening.values);
  const initialCounter = report?.countedBy ?? report?.submittedBy ?? me?.id ?? null;
  const [counter, setCounter] = useState<number | null>(initialCounter);
  // Formun açıldığı hâl (taslak ve ayrılma uyarısı yalnız bundan farklı yazılanlara bakar; Düzenle ve öneri yeniden kurar)
  const [baseline, setBaseline] = useState<{ values: Values; counter: number | null }>(() => ({ values: opening.values, counter: initialCounter }));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [pending, start] = useActionTransition();
  const [resending, setResending] = useState(false);
  const [photos, setPhotos] = useState<FormPhoto[]>(() => late?.kept ?? []);
  const [marks, setMarks] = useState<Marks>(opening.marks);
  const [posPrompt, setPosPrompt] = useState<PosPrompt | null>(null);
  // AsilPOS'un uygulanışı: kaç alan doldu (uygulanmadıysa null); bandın satırı bundan ve alanların şimdiki
  // işaretlerinden (kaçı hâlâ farklı) kurulur, Kasadan çıkanlar'a teslim eklenince "farklı" kendiliğinden düşer
  const [asilposFilled, setAsilposFilled] = useState<number | null>(opening.filled);
  // Form yazılmış değerlerle mi açıldı (karşılaştırma: Düzenle, düzeltme önerisi, geç raporun önceki değerleri, Düzeltip
  // onayla): metinler "doldu" değil "karşılaştırıldı" der
  const [asilposCompared, setAsilposCompared] = useState(asilpos !== null && report === null && initial !== null);
  // "Gün içinde kasaya giren" çoğu gün yok: alan tutarı varken, AsilPOS'tan dolunca ya da "Kasaya giren ekle"yle görünür
  const [cashInOpen, setCashInOpen] = useState(false);
  // "Kasayı sayan" tek satır ("… (siz) · Değiştir"); Değiştir'e basınca seçici
  const [counterOpen, setCounterOpen] = useState(false);
  // Fark varken not boşsa ilk gönderim nota götürür (bir kez); ikinci basış notsuz gönderir (not zorunlu değil)
  const [noteAsked, setNoteAsked] = useState(false);
  // Sonuç kartı ekranın altında mı (telefonda sonuç çubuğu yalnız o zaman; kart görününce ya da geçilince çubuk kalkar)
  const resultRef = useRef<HTMLDivElement>(null);
  const [resultBelow, setResultBelow] = useState(false);
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
  // Kör sayım: geçerli kilit (kilitleyince ve değiştirince güncellenir) ve "Sayımı değiştir"in alanları
  const [countLock, setCountLock] = useState<BlindCountLock | null>(blindCount?.lock ?? null);
  const [recount, setRecount] = useState<{ amount: string; reason: string; error: string | null } | null>(null);
  const [countPending, startCount] = useActionTransition();
  // Sayımdan sonra teslimin "Kime"si (Teslim defteri): yönetici, banka ya da elle yazılan ad
  const savedHanded = handedToChoiceOf({ name: report?.handedToName ?? null, userId: report?.handedToUserId ?? null });
  const [handChoice, setHandChoice] = useState<HandedToChoice>(savedHanded.choice);
  const [handName, setHandName] = useState(savedHanded.name);
  const [handError, setHandError] = useState<string | null>(null);
  const ownCorrection = requests?.own.find((r): r is OwnCorrection => r.kind === "kasa-duzeltme") ?? null;
  const ownDelete = requests?.own.find((r): r is OwnDelete => r.kind === "kasa-silme") ?? null;
  // Yükleme bölüm başına: yazarkasa Z'si okunurken ModPOS Z'si çekilebilir (docs/planlar/okc-z.md §3.3)
  const zUp = usePhotoUpload();
  const okcUp = usePhotoUpload();
  const live = preview(values);
  const reading = photoUi.reading === "on";
  // Kör sayım yalnız günün raporunda (geç rapor, düzeltme önerisi ve "Düzeltip onayla" yöneticinin onayından geçer)
  const blindOn = blindCount !== null && mode === "report" && !lateTurn && !proposal;
  // Sayım kilitlenmeden olması gereken ve fark çizilmez (kayıtlı raporun farkı zaten görüldü: yalnız yeni raporda)
  const awaitingLock = blindOn && countLock === null && report === null;
  // Kilitli ya da kayıtlı sayılan salt okunur: değişiklik "Sayımı değiştir"le, nedeniyle
  const countReadOnly = blindOn && !awaitingLock;
  // Farkın gösterildiği hesap (kör sayımda kilitlenene kadar yok)
  const diffLive = awaitingLock ? null : live;
  // Sayımdan sonra teslim varken "Kime" (Teslim defteri); geç rapor kendi "Teslim alan"ını sorar, öneri ve "Düzeltip
  // onayla" Kime taşımaz (kayıtlı değer kalır)
  const kimeShown = !isLate && !review && !proposal && (parseNumberTR(values.handedOver) ?? 0) > 0;

  // Okuma yükleme bitince gelir: o arada yazılanlara ve işaretlere göre (en son hâlleri) uygulanır
  const valuesRef = useRef(values);
  const marksRef = useRef(marks);
  useEffect(() => {
    valuesRef.current = values;
    marksRef.current = marks;
  }, [values, marks]);

  useEffect(() => {
    const el = resultRef.current;
    if (!editing || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setResultBelow(!e.isIntersecting && e.boundingClientRect.top > 0));
    io.observe(el);
    return () => io.disconnect();
  }, [editing]);

  // Gün içinde kasadan çıkan eklenince (sayfa yenilenir, form kalır) toplam ve adlar değişir: alanlar hâlâ
  // kendiliğinden gelen değerdeyse onlar da güncellenir, elle yazılan kalır
  const outsTotal = cashOutsTotal(cashOuts);
  const auto = { cashOut: cashOuts.length ? input(outsTotal) : "", note: cashOutNoteOf(cashOuts) ?? "" };
  const [autoSeen, setAutoSeen] = useState(auto);
  if (!report && (autoSeen.cashOut !== auto.cashOut || autoSeen.note !== auto.note)) {
    setAutoSeen(auto);
    const follow = (v: Values): Values => ({
      ...v,
      cashOut: v.cashOut === autoSeen.cashOut ? auto.cashOut : v.cashOut,
      cashOutNote: v.cashOutNote === autoSeen.note ? auto.note : v.cashOutNote,
    });
    setValues(follow);
    // Kendiliğinden gelen değişiklik yazılmış sayılmaz (taslak ve ayrılma uyarısı yalnız kişinin yazdığına bakar)
    setBaseline((b) => ({ ...b, values: follow(b.values) }));
  }

  // ---------------------------------------------------------------- Taslak ve ayrılma uyarısı (bulgu 87)
  // Yazılanlar bu cihazda taslak olarak durur (src/lib/cash-draft.ts): telefon Z fişini çekerken sekmeyi yeniden yüklese,
  // sayfa kapansa da kaybolmaz; form yeniden açılınca "Geri yükle" önerilir. Taslak şube ve gün başına (başka şubenin ya da
  // günün formunda önerilmez) ve raporun sürümüne bağlı (arada başkası gönderdiyse önerilmez); yalnız kişinin değiştirdiği
  // alanlar, kasayı sayan ve formda yüklenen fotoğraflar. Gönderilince, "Sil"le ve başka güne ya da şubeye geçerken silinir.
  // Yazılanlar varken sayfadan çıkmak önce sorar (useLeaveGuard). "Düzeltip onayla" (Onaylar) taslak tutmaz
  const draftOn = mode !== "review" && branchId !== null && canEdit;
  const draftKey = cashDraftKey(branchId ?? "", date);
  const keptPhotos = late?.kept?.length ?? 0;
  const changed = (Object.keys(values) as Key[]).filter((k) => values[k] !== baseline.values[k]);
  const dirty = draftOn && editing && (changed.length > 0 || counter !== baseline.counter || photos.length !== keptPhotos);
  const draftBody = dirty
    ? JSON.stringify({
        values: Object.fromEntries(changed.map((k) => [k, values[k]])),
        counter,
        photos: photos.map((p) => ({ id: p.id, kind: p.kind, createdAt: p.createdAt, byName: p.byName })),
        revision: report?.revision ?? 0,
        branch: branchId ?? "",
        date,
        by: me?.name ?? photoUi.me,
      } satisfies Omit<CashDraft, "at">)
    : "";
  const wroteDraft = useRef(false);
  useEffect(() => {
    try {
      if (draftBody) {
        window.localStorage.setItem(draftKey, cashDraftJson({ ...(JSON.parse(draftBody) as Omit<CashDraft, "at">), at: new Date().toISOString() }));
        wroteDraft.current = true;
      } else if (wroteDraft.current) {
        window.localStorage.removeItem(draftKey);
        wroteDraft.current = false;
      }
    } catch {
      // Gizli pencere ya da dolu depolama: taslaksız devam
    }
  }, [draftBody, draftKey]);
  // Artık açılamayacak günlerin taslakları (14 günden eski) bir kez temizlenir
  useEffect(() => {
    if (!draftOn) return;
    try {
      const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i) ?? "");
      for (const k of staleCashDraftKeys(keys, businessDate())) window.localStorage.removeItem(k);
    } catch {
      // yok sayılır
    }
  }, [draftOn]);
  // Bant yalnız açılışta var olan taslak için (bu açılışta yazılan, yazılanlar geri alınınca bant olarak çıkmasın)
  const openingDraft = useRef<{ key: string; json: string | null } | null>(null);
  const storedDraft = useSyncExternalStore(
    noopSubscribe,
    () => {
      if (openingDraft.current?.key !== draftKey) openingDraft.current = { key: draftKey, json: readDraft(draftKey) };
      return openingDraft.current.json;
    },
    () => null,
  );
  const [draftGone, setDraftGone] = useState(false);
  const draft = draftOn && !dirty && !draftGone ? parseCashDraft(storedDraft, { branch: branchId ?? "", date, revision: report?.revision ?? 0, keys: Object.keys(opening.values) }) : null;
  const draftPhotos = draft ? restorableDraftPhotos(draft.photos, { admin: photoUi.admin, me: me?.name ?? photoUi.me }) : null;
  function forgetDraft() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // yok sayılır
    }
    wroteDraft.current = false;
    setDraftGone(true);
  }
  const router = useRouter();
  const [leaveHref, setLeaveHref] = useLeaveGuard(dirty, BRANCH_LEAVE);
  // Pencerenin metni hedefe göre (leaveDialogText): kapanırken son hedefin metni kalsın diye ayrı tutulur
  const [leaveDrops, setLeaveDrops] = useState(false);
  if (leaveHref !== null && leaveDropsDraft(leaveHref, date, businessDate()) !== leaveDrops) setLeaveDrops(!leaveDrops);
  const leaveText = leaveDialogText(leaveDrops);

  const set = (k: Key) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
    if (k in marks) setMarks((m) => ({ ...m, [k]: { ...m[k as MarkField]!, warn: null, suggest: null } }));
    if (k === "bankPos") setPosPrompt(null);
  };

  function edit() {
    const s = withAsilpos(initialValues(report, carry, cashOuts), asilpos, "compare");
    setValues(s.values);
    setBaseline({ values: s.values, counter: initialCounter });
    setCounter(initialCounter);
    setErrors({});
    setPhotos([]);
    setMarks(s.marks);
    setPosPrompt(null);
    setAsilposFilled(s.filled);
    setAsilposCompared(asilpos !== null);
    setCashInOpen(false);
    setCounterOpen(false);
    setNoteAsked(false);
    setProposal(null);
    setReason("");
    setReasonError(null);
    setRecount(null);
    setHandChoice(savedHanded.choice);
    setHandName(savedHanded.name);
    setHandError(null);
    setEditing(true);
  }

  /** Düzeltme önerisi: kayıtlı rapordan (kilitli gün) ya da bekleyen önerinin değerlerinden ("Öneriyi düzenle") */
  function propose(from: OwnCorrection | null) {
    if (!report) return;
    edit();
    if (from) {
      const s = withAsilpos(initialValues({ ...report, ...from.proposed }, carry, cashOuts), asilpos, "compare");
      setValues(s.values);
      setBaseline({ values: s.values, counter: from.proposed.countedBy });
      setMarks(s.marks);
      setAsilposFilled(s.filled);
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

  /** AsilPOS'un gün sonunu forma uygular: fotoğrafınkiyle aynı kural (yalnız boş alanlar dolar); bandın satırını yazar */
  function fillFromAsilpos() {
    if (!asilpos) return;
    const plan = prefillPlan(asilpos.prefill, Object.fromEntries(MARK_FIELDS.map((f) => [f, values[f]])));
    if (plan.fill.length) {
      setValues((v) => ({ ...v, ...Object.fromEntries(plan.fill.map((f) => [f.field, f.text])) }));
      setErrors((x) => ({ ...x, ...Object.fromEntries(plan.fill.map((f) => [f.field, undefined])) }));
    }
    setMarks((m) => planMarks(m, plan, "asilpos"));
    setAsilposFilled(plan.fill.length);
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
    // Uzun fiş birleştirilemezse parçalar ayrı fotoğraf: bölümün ve raporun kalan yeri kadar
    const left = MAX_REPORT_PHOTOS - savedCount - photos.length;
    const room = kind === "kasa-okc" ? Math.min(left, MAX_OKC_PHOTOS - savedOf("kasa-okc").length - photosOf("kasa-okc").length) : left;
    const res = await up.upload(file, { kind, day: date, read: reading, room, onMore: (more) => took(more, kind) });
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
      // Başka bir fotoğrafın (ya da AsilPOS'un) önerisi alanda kalır
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

  /** Kör sayım: çekmecede sayılanı kilitler (ilk sayım nedensiz). Olması gereken ve fark bundan sonra görünür */
  function lockCount() {
    const raw = values.countedCash.trim();
    const amount = raw ? parseNumberTR(raw) : null;
    if (amount === null || amount < 0) {
      setErrors((x) => ({ ...x, countedCash: raw ? "Geçerli bir tutar yazın (ör. 1.250,50)" : "Çekmecede sayılan nakdi yazın (yoksa 0)" }));
      return goToField(document.getElementById(fid("countedCash")));
    }
    startCount(async () => {
      const res = await lockCashCount({ date, amount: Math.round(amount * 100) / 100, branchId });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      setCountLock(res.data);
      setValues((v) => ({ ...v, countedCash: input(res.data.amount) }));
      setErrors((x) => ({ ...x, countedCash: undefined }));
      toast.success(`Sayım kilitlendi · ${money(res.data.amount)}`, { description: "Olması gereken ve kasa farkı artık görünür." });
    });
  }

  /** "Sayımı değiştir": yeni sayım nedeniyle yazılır (yöneticiye görünür); form yeni sayımla sürer */
  function saveRecount() {
    if (!recount) return;
    const amount = recount.amount.trim() ? parseNumberTR(recount.amount) : null;
    if (amount === null || amount < 0) return setRecount({ ...recount, error: "Geçerli bir tutar yazın (ör. 1.250,50)" });
    const err = countNeedsReason({ counts: countLock ? 1 : 0, hasReport: report !== null }) ? countReasonError(recount.reason) : null;
    if (err) return setRecount({ ...recount, error: err });
    const why = recount.reason.trim() || null;
    startCount(async () => {
      const res = await lockCashCount({ date, amount: Math.round(amount * 100) / 100, reason: why, branchId });
      if (!res.ok) return void setRecount((r) => (r ? { ...r, error: res.error } : r));
      setCountLock(res.data);
      setValues((v) => ({ ...v, countedCash: input(res.data.amount) }));
      setRecount(null);
      toast.success(`Sayım değişti · ${money(res.data.amount)}`, { description: "Raporu gönderin; değişiklik yöneticiye görünür." });
    });
  }

  /** Taslağı forma geri yükler (kayıtlı raporda önce Düzenle açılır): yazılanlar, kasayı sayan, yüklenen fotoğraflar */
  function restoreDraft() {
    if (!draft) return;
    if (!editing) edit();
    // Kör sayım: kilitli sayılan taslaktan ezilmez (değişiklik yalnız "Sayımı değiştir"le)
    setValues((v) => ({ ...v, ...draft.values, ...(countReadOnly ? { countedCash: v.countedCash } : {}) }));
    if (draft.counter !== null) setCounter(draft.counter);
    if (draft.values.cashIn?.trim()) setCashInOpen(true);
    // Personel yalnız kendi yüklediği fotoğrafı geri alır (sunucu başkasınınkini bağlamaz); yönetici hepsini
    const { kept, dropped } = draftPhotos ?? { kept: [], dropped: 0 };
    if (kept.length) {
      const back: FormPhoto[] = kept.map((p) => ({ ...p, reading: null, error: null, switchTo: null, canRetry: false, summary: null }));
      setPhotos((ps) => [...ps.filter((p) => !back.some((b) => b.id === p.id)), ...back]);
    }
    toast.success("Taslak geri yüklendi", { description: dropped ? `Rakamları kontrol edip gönderin. ${droppedPhotosText(dropped)}` : "Rakamları kontrol edip gönderin." });
  }

  /**
   * Personelin fişsiz çıkışının açıklaması eksik mi (cashOutNoteMissing): yeni raporda ya da çıkış veya açıklaması
   * değiştiyse (eski raporun dokunulmayan satırı yeniden sorulmaz). Yönetici, geç rapor ve "Düzeltip onayla" değil
   */
  function staffOutNoteMissing(fields: CashReportFields): boolean {
    if (photoUi.admin || review || isLate) return false;
    if (report && report.cashOut === fields.cashOut && (report.cashOutNote ?? null) === (fields.cashOutNote ?? null)) return false;
    const { unreceipted } = unreceiptedCashOut(fields.cashOut, cashOuts, asilpos?.till ?? null);
    return cashOutNoteMissing({ unreceipted, note: fields.cashOutNote, outsNote: cashOutNoteOf(cashOuts) });
  }

  function submit() {
    const { fields, errors: errs } = readValues(values, date);
    setErrors(errs);
    if (!fields) {
      // Hatalar hemen çizilir: katlı bölümdeki hatalı alanın katı açılır, alan görünür olur (sonra gidilir)
      flushSync(() => setErrors(errs));
      const first = Object.keys(errs)[0] as Key | undefined;
      const name = first ? FIELD_NAMES[first] : undefined;
      const message = first ? errs[first] : undefined;
      toast.error("Eksik ya da hatalı alan var", { description: name && message && !message.startsWith(name) ? `${name}: ${message}` : message });
      // Telefonda düğme formun altında (ya da çubukta): hatalı ilk alana gidilir (yoksa uyarı ekranın dışında kalır)
      goToField(first ? document.getElementById(fid(first)) : null);
      return;
    }
    // Fişsiz çıkış (bulgu 2): personelin "Gün içinde çıkan"ı kasadan çıkan satırlarından fazlaysa neye çıktığı yazılır
    // (sunucu da aynı kuralla). Geç raporda formda günün satırları yok: kararı sunucu verir
    if (staffOutNoteMissing(fields)) {
      flushSync(() => setErrors((x) => ({ ...x, cashOutNote: CASH_OUT_NOTE_REQUIRED })));
      toast.error(CASH_OUT_NOTE_REQUIRED);
      goToField(document.getElementById(fid("cashOutNote")));
      return;
    }
    // Kör sayım: sayım kilitlenmeden rapor gönderilmez (sunucu da reddeder)
    if (awaitingLock) {
      flushSync(() => setErrors((x) => ({ ...x, countedCash: BLIND_COUNT_TEXT.lockFirst })));
      toast.error(BLIND_COUNT_TEXT.lockFirst);
      return goToField(document.getElementById(fid("countedCash")));
    }
    // Sayımdan sonra teslimin "Kime"si (Teslim defteri; sunucu da aynı kuralla): yeni raporda ya da tutar değiştiyse
    const kime = kimeShown ? handedToInputOf(handChoice, handName) : null;
    if (kimeShown && handedToMissing({ handedOver: fields.handedOver, to: kime ? "seçildi" : null, prev: report ? { handedOver: report.handedOver, handedTo: report.handedToName } : null })) {
      const msg = handChoice === "ad" ? HANDOVER_TEXT.nameMissing : HANDOVER_TEXT.required;
      flushSync(() => setHandError(msg));
      toast.error(msg);
      return goToField(document.getElementById(fid(handChoice === "ad" ? "handName" : "handChoice")));
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
      const focus = (id: string) => goToField(document.getElementById(id));
      if (!fields.zNo) {
        // AsilPOS gününde Z no AsilPOS'unkidir (yazarkasa Z'sinin numarası değil; Z AsilPOS'ta 1'den başlar)
        setErrors((x) => ({ ...x, zNo: asilposMode ? "AsilPOS'un Z no'su gerekli (AsilPOS › Kasa › Geçmiş günler)" : "Z no gerekli (Z raporunun üstünde)" }));
        toast.error(asilposMode ? "AsilPOS'un Z no'su gerekli" : "Z no gerekli");
        return focus(fid("zNo"));
      }
      // Kanıt: ModPOS gününde Z raporunun fotoğrafı; AsilPOS gününde AsilPOS'un gün sonu, gelmediyse yazarkasa Z'sinin
      // fotoğrafı (sunucu da aynı kuralla: src/server/cash/late.ts)
      if (!asilposMode && !photos.some((p) => p.kind === "kasa-z")) {
        toast.error("Z raporunun fotoğrafını ekleyin", { description: "Geç rapor Z raporunun fotoğrafıyla onaya gider." });
        return document.getElementById(fid("z-photos"))?.scrollIntoView({ block: "center" });
      }
      if (asilposMode && !asilpos && !photos.some((p) => p.kind === "kasa-okc")) {
        toast.error("Yazarkasa (Banka POS) Z raporunun fotoğrafını ekleyin", { description: "AsilPOS'un bu günün sonu gelmedi; geç rapor yazarkasa Z'sinin fotoğrafıyla onaya gider." });
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
          branchId,
          clientKey,
        });
        if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
        toast.success(`Onaya gönderildi · ${diffText(res.data.cashDiff)}`, { description: "Yönetici onaylayınca kayda geçer; sonucu zilde görürsünüz." });
        setClientKey(newClientKey());
        forgetDraft();
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
        const res = await requestCashCorrection({ date, baseRevision: report.revision, branchId, fields: rest, countedBy: counter, message: why, clientKey });
        if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
        toast.success("Düzeltme onaya gönderildi", { description: "Yönetici onaylayınca rapora işlenir; sonucu zilde görürsünüz." });
        setProposal(null);
        setClientKey(newClientKey());
        forgetDraft();
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
    // Fark var, not boş: bir kez nota götürülür (telefonda sonuç çubuğundan gönderilince not ekranın dışında kalıyordu).
    // Not zorunlu değil: ikinci basış notsuz gönderir
    const diff = computeCash(fields).cashDiff;
    if (diffKind(diff) !== "even" && !fields.note && !noteAsked) {
      setNoteAsked(true);
      toast.info(`${diffText(diff)}: nedenini nota yazın`, { description: "Ör. bozuk para, iade, yanlış fiş. Notsuz göndermek için yeniden basın." });
      const el = document.getElementById(fid("note"));
      el?.scrollIntoView({ block: "center" });
      el?.focus({ preventScroll: true });
      return;
    }
    start(async () => {
      const res = await submitCashReport({
        ...fields,
        countedBy: counter,
        revision: report?.revision ?? 0,
        photos: photos.map((p) => p.id),
        branchId,
        // Teslim yoksa Kime temizlenir. Seçilmediyse null: sunucu da aynı kuralla reddeder (handedToMissing; alan gelmeden
        // önce girilmiş, tutarı değişmeyen raporun boş Kime'si geçer)
        handedTo: fields.handedOver > 0 ? kime : null,
      });
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
      forgetDraft();
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

  // Bu cihazdaki taslağın bandı (form açılınca; kayıtlı raporda "Geri yükle" Düzenle'yi açar)
  const draftTime = draft?.at ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(draft.at)) : null;
  const draftBanner = draft ? (
    <Notice
      tone="neutral"
      live="polite"
      title={`${draft.by && draft.by !== (me?.name ?? photoUi.me) ? `${draft.by} bu cihazda` : "Bu cihazda"} gönderilmemiş kasa raporu var`}
      text={`${draftTime ? `${draftTime} · ` : ""}${longDateTR(date)} raporu; sayfa kapanmış ya da bağlantı gitmiş olabilir.${draftPhotos?.dropped ? ` ${droppedPhotosText(draftPhotos.dropped)}` : ""}`}
      action={
        <span className="flex flex-wrap gap-1.5">
          <Button size="xs" onClick={restoreDraft}>
            Geri yükle
          </Button>
          <Button size="xs" variant="ghost" onClick={forgetDraft}>
            Sil
          </Button>
        </span>
      }
    />
  ) : null;

  if (report && !editing) {
    // AsilPOS'un otomatik raporu personelde salt okunur (yalnız fotoğraf; sayfanın kartı). Kör kasa (bulgu 0): personelin
    // AsilPOS günü raporu (otomatik ya da yöneticinin elle girdiği) sayımsız gelir (blindReport), o da salt okunur
    const blind = report.blind === true && !photoUi.admin;
    const staffAuto = (asilposAuto || blind) && !photoUi.admin;
    const mail = emailLine(report.emailStatus, report.emailError, recipients);
    const sentAt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(report.updatedAt));
    // Sayan gönderenden farklıysa ikisi de; eski raporlarda sayan yok (gönderen saymış sayılır)
    const who = report.countedByName && report.countedByName !== report.submittedByName ? `Sayan ${report.countedByName} · gönderen ${report.submittedByName}` : report.submittedByName;
    const savedCarry = blind ? null : carryCheck(date, report.openingCash, carry);
    const savedNext = next && !blind ? carryCheck(next.date, next.openingCash, { date, amount: computeCash(report).carryOver }) : null;
    // AsilPOS'un otomatik gününde fotoğraf ↔ rapor farkı yalnız yöneticinin (sayfanın "Fotoğraf ↔ AsilPOS"u); personel görmez
    const diffs = staffPhotoDiffs(saved ? photoDiffs(saved.readings, savedFields(report)) : [], { admin: photoUi.admin, asilposAuto }) ?? [];
    // AsilPOS'un gün sonundan farklı yazılanlar (E-09; yalnız AsilPOS gününde, gönderimi geldiyse)
    const fromAsilpos = asilpos ? asilposDiffs(report, asilpos) : [];
    const asilposOuts = asilpos ? asilposOutsCheck(asilpos.till, outsTotal) : null;
    // Rapordan sonra eklenen kasadan çıkanlar: rapordaki tutar kendiliğinden değişmez (sayılan kasaya bağlı)
    const later = cashOuts.filter((o) => o.createdAt > report.updatedAt);
    const laterNote = later.length && Math.abs(outsTotal - report.cashOut) >= CASH_TOLERANCE ? `Rapordan sonra ${later.length} kasadan çıkan eklendi; fişlerin toplamı ${money(outsTotal)}, raporda ${money(report.cashOut)}.` : null;
    // Yöneticinin dikkat etmesi gerekenler (ay listesinin rozetleri; gün açıkken liste yok): döküm açık gelir, özet söyler
    const attention = photoUi.admin
      ? reportAttention(reportFlags(report, { cardExtra: asilpos?.cardExtra ?? null, offDevice: asilpos?.offDevice ?? null, kasa: asilposMode ? "AsilPOS" : "ModPOS" }), {
          photoDiffs: diffs.length,
          asilposDiffs: fromAsilpos.length,
          // Fişsiz çıkış (bulgu 2): ay listesinin rozetiyle ve onay kartıyla aynı hesap
          // gün sonu gelmemiş AsilPOS gününde hesaplanmaz (hareketler bekleniyor; asilposMovesPending)
          unreceipted: asilposMode && !asilpos ? 0 : unreceiptedCashOut(report.cashOut, cashOuts, asilpos?.till ?? null, date).unreceipted,
        })
      : [];
    return (
      <Card>
        <CardHeader
          icon={<ReceiptText />}
          title={`Kasa raporu · ${reportNo(date)}`}
          description={`${longDateTR(date)} · ${who} · ${sentAt}${report.revision > 1 ? " · güncellendi" : ""}`}
        />
        <div className="space-y-4 px-5 pb-5">
          {/* Kör kasa: personel farkı görmez (AsilPOS'ta da görmedi); büyük satır yalnız günün alındığını söyler */}
          {blind ? <p className="text-2xl font-semibold tracking-tight text-ink">{BLIND_TEXT.headline}</p> : <DiffHeadline diff={report.cashDiff} />}
          {draftBanner}
          {mail ? (
            <Notice
              tone={mail.tone === "red" ? "bad" : mail.tone === "green" ? "good" : "neutral"}
              size="sm"
              title={mail.text}
              action={
                report.emailStatus === "failed" && !readOnly ? (
                  <Button size="xs" variant="secondary" onClick={() => void resend()} disabled={resending}>
                    <RotateCw size={13} /> {resending ? "Gönderiliyor…" : "Yeniden dene"}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {saved ? <SavedPhotos photos={saved.photos} diffs={diffs} admin={photoUi.admin} removal={photoRemoval} dayEndLabel={asilposPhotoLabel} /> : null}
          <AsilposDiffList diffs={fromAsilpos} />
          {asilposOuts ? <Notice tone="neutral" size="sm" title={asilposOuts.text} /> : null}
          {laterNote ? <Notice tone="neutral" size="sm" title={laterNote} /> : null}
          {staffAuto ? (
            // "AsilPOS'ta düzeltin" değil: farkı görmeyen kasiyere düzeltmeyi istemek açığı ima ederdi (bulgu 0). Elle
            // girilmiş kör raporda rakamlar AsilPOS'tan gelmedi: ayrı satır
            <p className="text-[13px] leading-5 text-ink-mute">{asilposAuto ? BLIND_TEXT.line : BLIND_TEXT.manualLine}</p>
          ) : (
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
            {requests && !ownDelete ? <DeleteRequestButton date={date} revision={report.revision} branchId={branchId} label={`${longDateTR(date)} kasa raporu`} /> : null}
          </div>
          )}
          {ownDelete && canEdit ? <p className="text-[13px] leading-5 text-ink-mute">Silme isteğiniz bekliyor; önce geri çekin.</p> : null}
          {locked && !staffAuto ? (
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
          {/*
            Rapor dökümü katlı: kartın üstü özet (fark, e-posta, eylemler), satır satır döküm istenince. Açılış ya da ertesi
            günün açılışı devirle tutmuyorsa ya da yöneticinin dikkat etmesi gereken bir şey varsa (Z / yazarkasa tutmuyor,
            kart farkı, fotoğraftan ya da AsilPOS'tan farklı) açık gelir ve özet adını söyler (uyarı dökümün içinde; gizlenmez)
          */}
          <details open={Boolean(savedCarry || savedNext || attention.length)} className="group/r border-t border-line pt-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-ink-soft select-none [&::-webkit-details-marker]:hidden">
              <ChevronDown size={16} aria-hidden="true" className="shrink-0 motion-safe:transition-transform group-open/r:rotate-180" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">Rapor dökümü</span> · Z {money(report.zTotal)} · nakit {money(report.cash)}
                {blind ? null : ` · sayılan ${money(report.countedCash)}`}
                {attention.length ? <span className="font-medium text-warn"> · {attention.join(" · ")}</span> : null}
              </span>
            </summary>
            <div className="space-y-4 pt-2">
              <CashBreakdown
                // Otomatik raporun notundaki yönetici yönergesi ("AsilPOS'ta Yönetim › …") personele kısa nötr satır olur
                report={staffAuto ? { ...report, note: staffAutoNote(report.note, report) } : report}
                cashOuts={cashOuts}
                carry={savedCarry}
                next={savedNext}
                audience={photoUi.admin ? "admin" : "staff"}
                okcAdmin={okcAdmin}
                kasa={asilposMode ? "AsilPOS" : "ModPOS"}
                cardExtra={asilpos?.cardExtra ?? null}
                offDevice={asilpos?.offDevice ?? null}
                blind={blind}
              />
              {/* Sürümler sayılanı ve farkı taşır: kör kasada personele gelmez (sayfa boş verir) */}
              {blind ? null : <CashRevisions report={report} revisions={revisions} proposedBy={proposedBy} />}
            </div>
          </details>
        </div>
      </Card>
    );
  }

  const kind = diffLive ? diffLive.kind : null;
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
  // Fişsiz çıkış (bulgu 2): personelde "Neye çıktı" zorunlu (geç raporda formda günün satırları yok, sunucu söyler)
  const unreceiptedLive = cashOutValue !== null ? unreceiptedCashOut(cashOutValue, cashOuts, asilpos?.till ?? null).unreceipted : 0;
  const outNoteNeeded = !photoUi.admin && !review && !isLate && unreceiptedLive >= 1;
  const latestChecks = (k: CashPhotoKind) => [...photos].reverse().find((p) => p.kind === k && p.reading?.ok)?.reading?.checks ?? [];

  /**
   * Fotoğraftan (AsilPOS'tan) gelen alanın etiketi, turuncusu ve altındaki satır. Önerinin değeri alana yazıldıysa (elle ya
   * da Kasadan çıkanlar'dan kendiliğinden) öneri çözülmüştür, görünmez
   */
  const markOf = (k: Key): Mark | undefined => {
    const m = (MARK_FIELDS as readonly string[]).includes(k) ? marks[k as MarkField] : undefined;
    if (!m?.suggest || m.suggest.kind !== "differs" || !sameValue(k as MarkField, values[k], m.suggest.photo)) return m;
    return m.warn ? { ...m, suggest: null } : undefined;
  };
  // AsilPOS'tan dolan alanlara rozet basılmaz (formun başındaki bant söyler; 14 rozet ekranı dolduruyordu): yalnız
  // fotoğraftan dolan alan "Fotoğraftan"; AsilPOS'tan farklı olan turuncu ve altında AsilPOS'taki
  const labelOf = (k: Key, label: string) => {
    const m = markOf(k);
    return m?.filled !== null && m?.filled !== undefined && m.from !== "asilpos" && values[k] === m.filled ? (
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
        {m.suggest && !(k === "cashOut" && m.suggest.from === "asilpos" && cashOuts.length) ? (
          <button type="button" onClick={() => takeSuggestion(k as MarkField)} className="cursor-pointer font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11">
            {sourceText(m.suggest.from).take}
          </button>
        ) : null}
      </span>
    );
  };
  // AsilPOS'un gün sonu: Z no ve geliş anı (İstanbul saatiyle, sunucuda ve tarayıcıda aynı)
  const asilposZNo = asilpos?.prefill.values.zNo?.value ?? null;
  const asilposAt = asilpos
    ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(asilpos.receivedAt))
    : null;
  const warnOf = (k: Key) => Boolean(markOf(k)?.warn || markOf(k)?.suggest || (k === "openingCash" && liveCarry));
  // Bandın satırı: dolan alan sayısı, hâlâ AsilPOS'tan farklı (turuncu) ve sayımı olmayan alanlar
  const asilposNote =
    asilposFilled === null
      ? null
      : asilposSummary(
          {
            fill: new Array<null>(asilposFilled).fill(null),
            differs: MARK_FIELDS.filter((k) => markOf(k)?.suggest?.from === "asilpos"),
            missing: MARK_FIELDS.filter((k) => markOf(k)?.warn === ASILPOS_NO_COUNT_TEXT && !values[k].trim()),
          },
          review ? "staff" : "self",
        );
  // "Gün içinde çıkan"ın kaynağı panelin Kasadan çıkanlar'ı (E-35): AsilPOS'un harcama + teslimi tutmuyorsa bilgi satırı.
  // Geç rapor ve "Düzeltip onayla" formuna günün satırları gelmez (`cashOuts` boş): orada karşılaştırılmaz, yöneticinin
  // kartı kayıtlı kasadan çıkanlarla söyler (asilposHandedGap)
  const asilposOuts = asilpos && mode === "report" ? asilposOutsCheck(asilpos.till, outsTotal) : null;
  // Fark yalnız AsilPOS'taki teslimin Kasadan çıkanlar'a girilmemesinden mi (alan fişlerin toplamında): Sonuç'ta
  // girilince farkın ne olacağı söylenir (sahte "5.000 ₺ eksik" tek başına durmasın)
  const teslimMissing =
    asilpos && asilposOuts && asilpos.till.handed > 0 && Math.abs(outsTotal - asilpos.till.spent) < 0.01 && cashOutValue !== null && Math.abs(cashOutValue - outsTotal) < 0.01
      ? asilpos.till.handed
      : null;
  // Gönderince ne olur: e-posta kapalıyken (ya da gönderim kurulmamışken) "e-posta gider" denmez, rapor WhatsApp'la
  // paylaşılır (denetim UI-05; gönderilmiş raporun kartı "E-posta kapalı" der)
  const sendHint = recipients ? "Gönderince yöneticiye e-posta gider" : "E-posta kapalı; gönderdikten sonra WhatsApp ile paylaşın";

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
  // Kör sayım (Tuzla): kilitlenene kadar yazılır ve "Sayımı kilitle"; sonra salt okunur, "Sayımı değiştir" nedeniyle
  const countField = (
    <div className="space-y-2">
      {countReadOnly ? (
        <Field
          label="Akşam sayılan nakit"
          htmlFor={fid("countedCash")}
          error={errors.countedCash}
          hint={
            <span className="flex flex-wrap items-center gap-x-2">
              <span>
                {countLock
                  ? `${BLIND_COUNT_TEXT.locked} · ${countLock.by} · ${new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(countLock.at))}${countLock.changed ? " · değişti" : ""}`
                  : "Kayıtlı rapordaki sayım"}
              </span>
              {recount ? null : (
                <button
                  type="button"
                  onClick={() => setRecount({ amount: values.countedCash, reason: "", error: null })}
                  className="cursor-pointer font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11"
                >
                  Sayımı değiştir
                </button>
              )}
            </span>
          }
        >
          <NumberInput id={fid("countedCash")} value={values.countedCash} readOnly aria-readonly="true" className="bg-panel" />
        </Field>
      ) : (
        field("countedCash", "Akşam sayılan nakit", { hint: "Çekmecedeki bütün nakit; kilitleyince fark görünür" })
      )}
      {awaitingLock ? (
        <Button size="sm" variant="secondary" onClick={lockCount} disabled={countPending || !values.countedCash.trim()} className="max-sm:w-full">
          {countPending ? "Kilitleniyor…" : "Sayımı kilitle"}
        </Button>
      ) : null}
      {recount ? (
        <div className="space-y-2 rounded-xl bg-panel p-3">
          <Field label="Yeni sayım" htmlFor={fid("recount")}>
            <NumberInput
              id={fid("recount")}
              value={recount.amount}
              onChange={(e) => setRecount({ ...recount, amount: e.target.value, error: null })}
              placeholder="0"
              autoFocus
            />
          </Field>
          <Field label="Neden değişti?" htmlFor={fid("recountReason")} hint="Yönetici görür" error={recount.error ?? undefined}>
            <Input
              id={fid("recountReason")}
              value={recount.reason}
              onChange={(e) => setRecount({ ...recount, reason: e.target.value, error: null })}
              maxLength={300}
              placeholder="ör. çekmecenin altında 50 ₺ çıktı"
              autoComplete="off"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={saveRecount} disabled={countPending}>
              {countPending ? "Kaydediliyor…" : "Sayımı değiştir"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRecount(null)} disabled={countPending}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
  // Sayımdan sonra teslimin "Kime"si (Teslim defteri): yönetici, banka ya da elle yazılan ad
  const kimeAdmins =
    report?.handedToUserId && !handoverAdmins.some((a) => a.id === report.handedToUserId)
      ? [...handoverAdmins, { id: report.handedToUserId, name: report.handedToName ?? "Yönetici" }]
      : handoverAdmins;
  const kimeField = (
    <div className="space-y-2">
      <Field label="Kime" htmlFor={fid("handChoice")} hint="Teslim edileni kim aldı?" error={handChoice === "ad" ? undefined : (handError ?? undefined)}>
        <Select
          id={fid("handChoice")}
          value={handChoice}
          onChange={(e) => {
            setHandChoice(e.target.value as HandedToChoice);
            setHandError(null);
          }}
          aria-invalid={Boolean(handError) && handChoice !== "ad"}
        >
          <option value="">Seçin</option>
          {kimeAdmins.map((a) => (
            <option key={a.id} value={`user:${a.id}`}>
              {a.name}
            </option>
          ))}
          <option value="banka">Banka (yatırıldı)</option>
          <option value="ad">Başka biri (adını yazın)</option>
        </Select>
      </Field>
      {handChoice === "ad" ? (
        <Field label="Teslim alanın adı" htmlFor={fid("handName")} error={handError ?? undefined}>
          <Input
            id={fid("handName")}
            value={handName}
            onChange={(e) => {
              setHandName(e.target.value);
              setHandError(null);
            }}
            maxLength={HANDED_TO_MAX}
            placeholder="ör. Okan Bey"
            autoComplete="off"
            aria-invalid={Boolean(handError)}
          />
        </Field>
      ) : null}
    </div>
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
  // Fiş fotoğrafları tek kartta, formun başında (ModPOS Z'si ve yazarkasa Z'si; telefonda iki ayrı seçici kartların
  // içinde dağılıyordu). AsilPOS gününde ModPOS Z'si yok; gün sonu geldiyse yazarkasanın fişi sayfanın "Gün sonu
  // fotoğrafı" kartından eklenir (`dayPhotoCard`): aynı fiş için ikinci seçici çizilmez
  const photoKinds: ("kasa-z" | "kasa-okc")[] = photoUi.storage && !proposal && !review ? [...(asilposMode ? [] : (["kasa-z"] as const)), ...(dayPhotoCard ? [] : (["kasa-okc"] as const))] : [];
  const photoSection = (k: "kasa-z" | "kasa-okc") => {
    const up = k === "kasa-z" ? zUp : okcUp;
    return (
      <section key={k} id={fid(k === "kasa-z" ? "z-photos" : "okc-photos")} aria-label={PHOTO_TITLE[k]} className="scroll-mt-24 space-y-2.5">
        {photoKinds.length > 1 ? <p className="text-sm font-medium text-ink">{PHOTO_TITLE[k]}</p> : null}
        <PhotoPicker onPick={(f) => void pick(k, f)} read={reading} disabled={up.busy} />
        {k === "kasa-okc" ? <p className="text-[13px] leading-5 text-ink-mute">Fişi düz koyun; uzunsa üstünü ve altını ayrı çekin.</p> : null}
        <PhotoStatus phase={up.phase} />
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
      </section>
    );
  };
  const photosCard = photoKinds.length ? (
    <Card>
      <CardHeader
        icon={<Camera />}
        title={photoKinds.length > 1 ? "Fiş fotoğrafları" : `${PHOTO_TITLE[photoKinds[0]]} fotoğrafı`}
        description={
          isLate && !asilposMode
            ? "Geç raporda ModPOS Z'sinin fotoğrafı zorunlu."
            : !reading
              ? "Fotoğraf raporla saklanır; rakamları aşağıya yazın."
              : photoKinds.includes("kasa-okc") && !OKC_PREFILL_ENABLED
                ? photoKinds.length > 1
                  ? "ModPOS Z'si rakamları doldurur; yazarkasanın rakamları alanların altında çıkar, fişle karşılaştırıp yazın."
                  : "Okunan rakamlar alanların altında çıkar; fişle karşılaştırıp yazın."
                : "Çekin, rakamlar boş alanlara dolar; yazdıklarınız değişmez."
        }
      />
      <div className="space-y-5 px-5 pb-5">
        {photoKinds.map(photoSection)}
        {offLine ? <p className="text-[13px] leading-5 text-ink-mute">{offLine}</p> : null}
      </div>
    </Card>
  ) : null;
  const okcMarked = (k: FormReadField) => Boolean(marks[k]?.warn || marks[k]?.suggest);
  const num = (k: MoneyKey) => (values[k].trim() ? (parseNumberTR(values[k]) ?? 0) : 0);

  // Z'nin seyrek alanları katlı (yemek kartı, online, diğer, ödenmez, indirim, fiş sayısı; geç rapor dışında Z no):
  // başlıkta dolu olanların özeti, turuncu ya da hata varsa ya da ödeme türleri toplamı tutmuyorsa kendiliğinden açık
  const zExtra = Z_EXTRA.filter((k) => !(isLate && k === "zNo"));
  const zAttention = zExtra.filter((k) => Boolean(errors[k]) || warnOf(k)).length + (paymentsOff ? 1 : 0);
  const zSummary = zExtra
    .flatMap((k) => {
      const raw = values[k].trim();
      if (!raw || raw === "0") return [];
      if (k === "zNo") return [`Z no ${raw}`];
      if (k === "receipts") return [`${raw} fiş`];
      const n = parseNumberTR(raw);
      return [`${LABELS[k]} ${n === null ? raw : money(n)}`];
    })
    .join(" · ");
  const zNoField = (
    <Field key="zNo" label={labelOf("zNo", "Z no")} htmlFor={fid("zNo")} hint={hintOf("zNo", isLate ? "zorunlu" : undefined)} error={errors.zNo}>
      <Input
        id={fid("zNo")}
        inputMode="numeric"
        value={values.zNo}
        onChange={set("zNo")}
        maxLength={30}
        autoComplete="off"
        placeholder={isLate ? undefined : "isteğe bağlı"}
        aria-invalid={Boolean(errors.zNo)}
        data-warn={warnOf("zNo") || undefined}
      />
    </Field>
  );
  // Kasayı sayan: çoğu akşam formu açan sayar; tek satır, "Değiştir" ile seçici (başkası saydıysa seçici açık)
  const meCounts = me !== null && counter === me.id && !counterOpen;
  // "Neye çıktı": fişlerden gelen kalemlerin adları kendiliğinden yazılır; elle yazılan çıkışta, adlar değiştirildiyse ya
  // da fişlerin toplamının üstüne elle tutar eklendiyse alan görünür
  const outsNote = cashOutNoteOf(cashOuts) ?? "";
  const showOutNote = cashOutNoteVisible({ cashOut: cashOutValue, outs: cashOuts, note: values.cashOutNote, outsNote });
  const submitLabel =
    pending || reviewPending
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
                : "Raporu gönder";
  // Telefonda sonuç çubuğu: Sonuç kartı ekranın altında kaldıkça fark ve Gönder alt menünün üstünde durur (klavye
  // açıkken gizli). Yalnız günün raporunda (Onaylar'daki "Düzeltip onayla" kartında birden çok form olabilir)
  const bar = mode === "report" && resultBelow;
  // Çubuğun kısa düğmesi işlemi söyler: öneri "Onaya gönder", gönderilmiş raporun düzenlenmesi "Güncelle"
  const barLabel = pending || busy || reviewPending ? submitLabel : proposal || isLate ? "Onaya gönder" : report ? "Güncelle" : "Gönder";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        {draftBanner}
        {isLate && !review ? (
          <Notice
            tone="neutral"
            title={`Geç rapor · ${longDateTR(date)}: yönetici onaylayınca kayda geçer`}
            text={
              !asilposMode
                ? "Z raporunun fotoğrafı ve Z no zorunlu; gün içinde kasadan çıkanı elle yazın."
                : asilpos
                  ? asilposCompared
                    ? "Önceki yazdıklarınız AsilPOS'un gün sonuyla karşılaştırıldı, farklı olanlar turuncu; fotoğraf gerekmez. Sayımı ve gün içinde kasadan çıkanı kontrol edin."
                    : "Rakamlar AsilPOS'un gün sonundan doldu; fotoğraf gerekmez. Sayımı ve gün içinde kasadan çıkanı kontrol edin."
                  : "AsilPOS'un bu günün sonu gelmedi: yazarkasa Z raporunun fotoğrafı zorunlu; AsilPOS gün sonu bölümündeki Z no'yu AsilPOS › Kasa › Geçmiş günler'den yazın."
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
        {asilpos ? (
          <div className="space-y-1.5">
            <Notice
              tone="neutral"
              title={`AsilPOS gün sonu${asilposZNo !== null ? ` · Z ${asilposZNo}` : ""} · ${asilposAt}`}
              text={asilposNote ?? "Z ve kasa rakamları boş alanlara yazılır, yazdıklarınız değişmez; bakıp gönderin."}
              action={
                <Button size="xs" variant="secondary" onClick={fillFromAsilpos} disabled={pending}>
                  AsilPOS&apos;tan doldur
                </Button>
              }
            />
            {/* Doldurduktan sonra kasa eşlemesinin bilgi satırları (giren çıkandan fazla, AsilPOS'un olması gerekeni farklı) */}
            {asilposNote !== null ? <ReadChecks checks={asilpos.prefill.checks} /> : null}
          </div>
        ) : null}
        {photosCard}
        <Card>
          <CardHeader
            icon={<ReceiptText />}
            title={asilposMode ? "AsilPOS gün sonu (Z)" : "ModPOS Z raporu"}
            description={
              asilposMode
                ? asilpos
                  ? asilposCompared
                    ? "Yazılan rakamlar AsilPOS'un gün sonuyla karşılaştırıldı: farklı olanlar turuncu, altında AsilPOS'taki."
                    : "AsilPOS'un gün sonundan doldu; AsilPOS'taki Z'yle aynı olmalı."
                  : "AsilPOS'un bu günün sonu gelmedi; AsilPOS › Kasa › Geçmiş günler'deki Z'den yazın."
                : isLate
                  ? "Z no zorunlu; rakamlar fotoğraftan dolar ya da elle yazın."
                  : "ModPOS'ta gün sonu Z raporunu alın; rakamları ondan yazın."
            }
          />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {field("zTotal", "Toplam satış (Z)", { autoFocus: !report && !photoUi.storage && !asilpos })}
            {isLate ? zNoField : null}
            {field("cash", "Nakit")}
            {field("card", "Kredi / banka kartı")}
            <Fold label="Diğer ödemeler ve Z ayrıntısı" summary={zSummary || "yemek kartı, online, indirim, fiş sayısı"} attention={zAttention}>
              {isLate ? null : zNoField}
              {field("mealCard", "Yemek kartı")}
              {field("online", "Online (Yemeksepeti, Getir…)")}
              {field("other", "Diğer (havale, cari…)")}
              {field("offRevenue", "Ödenmez / ikram")}
              {field("discounts", "İndirim")}
              <Field label={labelOf("receipts", "Fiş sayısı")} htmlFor={fid("receipts")} hint={hintOf("receipts")}>
                <Input id={fid("receipts")} inputMode="numeric" value={values.receipts} onChange={set("receipts")} maxLength={6} autoComplete="off" placeholder="isteğe bağlı" data-warn={warnOf("receipts") || undefined} />
              </Field>
            </Fold>
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
          <CardHeader icon={<Wallet />} title="Kasa (nakit)" description={awaitingLock ? BLIND_COUNT_TEXT.card : "Çekmecedeki bütün nakdi sayın."} />
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
                `${dayMonthTR(carry.date)} raporunun devri${gap ? ` · arada ${gap} gün rapor yok` : ""}`
              ) : (
                "Gün başında kasadaki nakit"
              ),
            })}
            {blindOn ? countField : field("countedCash", "Akşam sayılan nakit")}
            {field("cashOut", "Gün içinde kasadan çıkan", {
              hint: cashOuts.length ? (
                <span className="flex flex-wrap items-center gap-x-2">
                  <span>
                    Kasadan çıkanlar: {cashOuts.length} kalem · {money(outsTotal)}
                  </span>
                  {cashOutValue === null || Math.abs(cashOutValue - outsTotal) >= 0.005 ? (
                    <button
                      type="button"
                      onClick={() => setValues((v) => ({ ...v, cashOut: input(outsTotal), cashOutNote: v.cashOutNote.trim() ? v.cashOutNote : outsNote }))}
                      className="cursor-pointer font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11"
                    >
                      Yaz
                    </button>
                  ) : null}
                </span>
              ) : (
                "Kasadan ödenen harcama"
              ),
            })}
            {showOutNote ? (
              <Field
                label="Neye çıktı"
                htmlFor={fid("cashOutNote")}
                hint={outNoteNeeded ? `Kasadan çıkanlar'dan ${money(unreceiptedLive)} fazla: neye çıktığını yazın` : undefined}
                error={errors.cashOutNote}
              >
                <Input
                  id={fid("cashOutNote")}
                  value={values.cashOutNote}
                  onChange={set("cashOutNote")}
                  maxLength={200}
                  placeholder={outNoteNeeded ? "ör. buz, bozuk para, patrona teslim" : "ör. süt, buz (isteğe bağlı)"}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.cashOutNote)}
                />
              </Field>
            ) : null}
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
            {field("handedOver", "Sayımdan sonra teslim", { hint: "Patrona ya da bankaya verilen" })}
            {kimeShown ? kimeField : null}
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
              meCounts ? (
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] leading-5 sm:col-span-2">
                  <span className="text-ink-mute">
                    Kasayı sayan: <span className="font-medium text-ink">{me.name} (siz)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setCounterOpen(true)}
                    className="cursor-pointer font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11"
                  >
                    Değiştir
                  </button>
                </p>
              ) : (
                <Field label="Kasayı sayan" htmlFor={fid("counter")} hint="Çekmeceyi kim saydı?">
                  <Select id={fid("counter")} value={counter ?? ""} onChange={(e) => setCounter(e.target.value ? Number(e.target.value) : null)} autoFocus={counterOpen}>
                    {counter === null ? <option value="">Seçin</option> : null}
                    {counters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )
            ) : null}
            {outsWarning ? <Notice tone="warn" size="sm" className="sm:col-span-2" title={outsWarning} /> : null}
            {asilposOuts ? <Notice tone="neutral" size="sm" className="sm:col-span-2" title={asilposOuts.text} /> : null}
          </div>
        </Card>
        <OkcCard
          values={values}
          field={field}
          textField={textField}
          marked={(k) => okcMarked(k)}
          failed={(k) => Boolean(errors[k])}
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
            dayPhotoCard
              ? "Yazarkasanın KDV dökümlü Z raporu; fotoğrafı Gün sonu fotoğrafı kartından eklenir."
              : "Yazarkasanın KDV dökümlü Z raporu (banka gün sonu fişi değil). Fotoğraf yoksa rakamları yazın."
          }
          prevZ={prevOkcZ}
          extraTakings={extraTakings}
          day={date}
          audience={photoUi.admin ? "admin" : "staff"}
          kasa={asilposMode ? "AsilPOS" : "ModPOS"}
          modpos={
            values.card.trim()
              ? { zTotal: num("zTotal"), cash: num("cash"), card: num("card"), mealCard: num("mealCard"), online: num("online"), other: num("other"), cardExtra: asilpos?.cardExtra ?? null, offDevice: asilpos?.offDevice ?? null }
              : null
          }
        />
      </div>
      <div ref={resultRef} className="space-y-4 xl:sticky xl:top-4 xl:self-start">
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
                    : sendHint
            }
          />
          <div className="space-y-3 px-5 pb-5">
            {awaitingLock ? (
              <p className="text-sm text-ink-mute">{BLIND_COUNT_TEXT.result}</p>
            ) : live ? (
              <>
                <DiffHeadline diff={live.cashDiff} live />
                {teslimMissing !== null ? (
                  <Notice
                    tone="neutral"
                    size="sm"
                    title={`AsilPOS'taki teslim (${money(teslimMissing)}) Kasadan çıkanlar'da yok; eklenince fark: ${diffText(Math.round((live.cashDiff + teslimMissing) * 100) / 100)}.`}
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
                      : undefined
              }
              className={(kind && kind !== "even" && !values.note.trim()) || noteRequired ? "[&_label]:text-warn" : undefined}
            >
              <Textarea id={fid("note")} value={values.note} onChange={set("note")} rows={3} maxLength={1000} placeholder={noteRequired || (kind && kind !== "even") ? undefined : "isteğe bağlı"} />
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
              <Send size={16} /> {submitLabel}
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
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  // Vazgeç yazılanları bırakır: taslak da silinir
                  forgetDraft();
                  onCancel();
                }}
                disabled={pending || reviewPending}
              >
                Vazgeç
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
      {bar ? (
        // data-bottom-bar: bildirimler çubuğun ve Gönder'in üstüne binmez, telefonda üstte çıkar (toast-layout.ts)
        <div
          data-bottom-bar
          className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-nav-h,0px)+0.5rem)] z-30 flex justify-center pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] in-data-[keyboard=open]:hidden lg:left-[17.5rem] xl:hidden">
          <div
            role="region"
            aria-label="Kasa farkı ve gönderme"
            className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl bg-surface py-2 pr-2 pl-4 shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-line-strong"
          >
            <p className="min-w-0 flex-1 truncate text-sm">
              {diffLive ? (
                <span className={cn("font-semibold tabular", kind === "short" ? "text-bad" : kind === "over" ? "text-warn" : "text-good")}>{diffText(diffLive.cashDiff)}</span>
              ) : (
                <span className="text-ink-mute">{awaitingLock ? BLIND_COUNT_TEXT.bar : "Kasa farkı sayımdan sonra"}</span>
              )}
            </p>
            <Button size="lg" onClick={submit} disabled={pending || busy || reviewPending}>
              <Send size={16} /> {barLabel}
            </Button>
          </div>
        </div>
      ) : null}
      {/* Gönderilmemiş rapordan çıkış (menü, alt çubuk, gün çipi, şube seçici): önce sorulur. Başka güne ya da şubeye
          geçilince taslak silinir, başka sayfaya gidilince bu cihazda kalır (dönünce geri yüklenir) */}
      <ConfirmDialog
        open={leaveHref !== null}
        onClose={() => setLeaveHref(null)}
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          if (!href) return;
          if (leaveDropsDraft(href, date, businessDate())) forgetDraft();
          router.push(href);
        }}
        title="Gönderilmemiş kasa raporu var"
        {...leaveText}
      />
    </div>
  );
}

/** Fotoğraf bölümlerinin adı (Fiş fotoğrafları kartında; tek bölümse kartın başlığı) */
const PHOTO_TITLE = { "kasa-z": "ModPOS Z raporu", "kasa-okc": "Yazarkasa Z raporu" } as const;

/** Z kartının katlı alanları (geç raporda Z no zorunlu, katın dışında) */
const Z_EXTRA = ["zNo", "mealCard", "online", "other", "offRevenue", "discounts", "receipts"] as const satisfies readonly Key[];
