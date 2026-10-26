"use client";

import { Calculator, Copy, MessageCircle, Pencil, ReceiptText, RotateCw, Send, Wallet } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PhotoPicker, PhotoStatus, usePhotoUpload } from "@/components/panel/photo-picker";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
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
} from "@/lib/cash-report";
import { money } from "@/lib/format";
import { OKC_HALVES_TEXT, okcNeedsHalves } from "@/lib/photo-read/okc";
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
import { MAX_OKC_PHOTOS, MAX_REPORT_PHOTOS, OKC_PHOTOS_TEXT, readingOffText, type ReadingState } from "@/lib/photo-rules";
import { dayMonthTR, daysBetween, longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
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
import { CashBreakdown, DIFF_TONE, DiffHeadline, type OkcAdminView } from "./cash-summary";
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
const shownValue = (field: FormReadField, v: number | string) => (field === "zNo" || field === "receipts" || field === "okcZNo" || field === "okcReceipts" ? String(v) : money(Number(v)));

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
 * Personelin sonradan düzeltmesi (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği): kilitli günde "Düzeltme
 * öner", ertesi gün kasa alanı ya da sayan değişince sunucu gönderimi onaya çevirir; form yazılanları koruyarak düzeltme
 * önerisine geçer (fotoğraf yok, "Neden düzeltiyorsunuz?" zorunlu, "Onaya gönder"). Rapor onaya kadar değişmez.
 *
 * Geç rapor (`mode="late"`; docs/KASA-RAPORU.md › Geç rapor): dünden eski bir günü personel Z fotoğrafı, Z no ve
 * nedeniyle onaya gönderir; sayan isteyendir (seçici yok), teslim varsa teslim alan seçilir, gün içinde çıkan elle
 * yazılır. Dünün formu gönderilirken gün döndüyse (05:00) sunucu geç rapora çevirir, form yazılanlarla geçer.
 * "Düzeltip onayla" (`mode="review"`): yönetici geç raporu kendi değerleriyle onaylar (fotoğraf, sayan ve neden yok).
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
}) {
  // Öğe kimlikleri form başına: Onaylar'da iki "Düzeltip onayla" formu aynı anda açıkken etiket, odak ve kaydırma
  // öteki karta gitmesin
  const uid = useId();
  const fid = (name: string) => `${uid}k-${name}`;
  const [editing, setEditing] = useState(report === null);
  const [values, setValues] = useState<Values>(() => initialValues(report ?? initial, carry, cashOuts));
  const initialCounter = report?.countedBy ?? report?.submittedBy ?? me?.id ?? null;
  const [counter, setCounter] = useState<number | null>(initialCounter);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [pending, start] = useActionTransition();
  const [resending, setResending] = useState(false);
  const [photos, setPhotos] = useState<FormPhoto[]>(() => late?.kept ?? []);
  const [marks, setMarks] = useState<Marks>({});
  const [posPrompt, setPosPrompt] = useState<PosPrompt | null>(null);
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
    if (k in marks) setMarks((m) => ({ ...m, [k]: { ...m[k as FormReadField]!, warn: null, suggest: null } }));
    if (k === "bankPos") setPosPrompt(null);
  };

  function edit() {
    setValues(initialValues(report, carry, cashOuts));
    setCounter(initialCounter);
    setErrors({});
    setPhotos([]);
    setMarks({});
    setPosPrompt(null);
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
      setValues(initialValues({ ...report, ...from.proposed }, carry, cashOuts));
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
    const askPos = (r.kind === "kasa-pos" || r.kind === "kasa-okc") && posValue !== null && prevMark && prevMark.photoId !== photoId && prevMark.filled !== null && current.bankPos === prevMark.filled;
    if (askPos) setPosPrompt({ photoId, prev: parseNumberTR(current.bankPos) ?? 0, next: posValue, ...posPromptMarks(r) });
    if (askPos && r.kind === "kasa-pos") return "Banka POS fişi okundu.";
    const plan = prefillPlan(r, Object.fromEntries(READ_FIELDS.filter((f) => !(askPos && f === "bankPos")).map((f) => [f, current[f]])));
    if (plan.fill.length) setValues((v) => ({ ...v, ...Object.fromEntries(plan.fill.map((f) => [f.field, f.text])) }));
    setMarks((m) => {
      const next: Marks = { ...m };
      for (const f of plan.fill) next[f.field as FormReadField] = { photoId, filled: f.text, warn: f.warn, suggest: null };
      for (const d of plan.differs) next[d.field as FormReadField] = { photoId, filled: m[d.field as FormReadField]?.filled ?? null, warn: null, suggest: { text: d.text, photo: d.photo, kind: "differs" } };
      for (const u of plan.unsure) {
        // Yazarkasa: tutmayan rakamın tek nedeni ya da (doldurma kapalıyken) öneri, ardından fotoğraftaki değer
        const shown = shownValue(u.field as FormReadField, u.photo);
        next[u.field as FormReadField] = {
          photoId,
          filled: null,
          warn: u.reason ? `${u.reason} Fotoğrafta ${shown}.` : `Fotoğrafta net okunamadı (${shown}); fişten yazın.`,
          suggest: { text: u.text, photo: u.photo, kind: "unsure" },
        };
      }
      for (const f of plan.missing) next[f as FormReadField] = { photoId, filled: null, warn: MISSING_TEXT, suggest: null };
      return next;
    });
    const summary = prefillSummary(r.kind, plan);
    return askPos ? `${summary} Banka gün sonu için aşağıda seçin.` : summary;
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
    // Yazarkasa ve eski banka POS (geçiş, D2) aynı bölümün yükleyicisinde
    const up = kind === "kasa-z" ? zUp : okcUp;
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
        setErrors((x) => ({ ...x, zNo: "Z no gerekli (Z raporunun üstünde)" }));
        toast.error("Z no gerekli");
        return focus(fid("zNo"));
      }
      if (!photos.some((p) => p.kind === "kasa-z")) {
        toast.error("Z raporunun fotoğrafını ekleyin", { description: "Geç rapor Z raporunun fotoğrafıyla onaya gider." });
        return document.getElementById(fid("z-photos"))?.scrollIntoView({ block: "center" });
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
    // Sayan gönderenden farklıysa ikisi de; eski raporlarda sayan yok (gönderen saymış sayılır)
    const who = report.countedByName && report.countedByName !== report.submittedByName ? `Sayan ${report.countedByName} · gönderen ${report.submittedByName}` : report.submittedByName;
    const savedCarry = carryCheck(date, report.openingCash, carry);
    const savedNext = next ? carryCheck(next.date, next.openingCash, { date, amount: computeCash(report).carryOver }) : null;
    const diffs = saved ? photoDiffs(saved.readings, savedFields(report)) : [];
    // Rapordan sonra eklenen kasadan çıkanlar: rapordaki tutar kendiliğinden değişmez (sayılan kasaya bağlı)
    const later = cashOuts.filter((o) => o.createdAt > report.updatedAt);
    const laterNote = later.length && Math.abs(outsTotal - report.cashOut) >= CASH_TOLERANCE ? `Rapordan sonra ${later.length} kasadan çıkan eklendi; fişlerin toplamı ${money(outsTotal)}, raporda ${money(report.cashOut)}.` : null;
    return (
      <Card>
        <CardHeader
          icon={<ReceiptText />}
          title={`${longDateTR(date)} kasa raporu`}
          description={`${who} · ${sentAt}${report.revision > 1 ? " · güncellendi" : ""}`}
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
          {saved ? <SavedPhotos photos={saved.photos} diffs={diffs} admin={photoUi.admin} removal={photoRemoval} /> : null}
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
              <Button variant="ghost" size="lg" onClick={edit} disabled={Boolean(ownDelete)}>
                <Pencil size={16} /> Düzenle
              </Button>
            ) : null}
            {requests && !ownDelete ? <DeleteRequestButton date={date} revision={report.revision} label={`${longDateTR(date)} kasa raporu`} /> : null}
          </div>
          {ownDelete && canEdit ? <p className="text-[13px] leading-5 text-ink-mute">Silme isteğiniz bekliyor; önce geri çekin.</p> : null}
          {locked ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel px-3 py-2 text-[13px] leading-5 text-ink-mute">
              <span className="min-w-0 flex-1 basis-56">Ertesi günün raporu girildi; bu raporu yönetici onayıyla düzeltirsiniz.</span>
              {!ownCorrection && !ownDelete ? (
                <Button size="sm" variant="secondary" onClick={() => propose(null)}>
                  <Pencil size={14} /> Düzeltme öner
                </Button>
              ) : null}
            </div>
          ) : null}
          {requests ? <PendingRequests own={requests.own} others={requests.others} onEdit={(c) => propose(c)} /> : null}
          <CashBreakdown report={report} cashOuts={cashOuts} carry={savedCarry} next={savedNext} audience={photoUi.admin ? "admin" : "staff"} okcAdmin={okcAdmin} />
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
  const warnOf = (k: Key) => Boolean(markOf(k)?.warn || markOf(k)?.suggest || (k === "openingCash" && liveCarry));

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
          onSwitch={(p) => p.switchTo && void reread(p, p.switchTo)}
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
          <div role="note" className="rounded-2xl bg-info-soft px-4 py-3 text-sm leading-5 text-info">
            <p className="font-semibold">{longDateTR(date)} · Geç rapor</p>
            <p className="mt-0.5">Yöneticinin onayıyla kayda geçer. Z raporunun fotoğrafı ve Z no zorunlu; gün içinde kasadan çıkanı elle yazın.</p>
          </div>
        ) : null}
        {proposal ? (
          <div role="note" className="rounded-2xl bg-info-soft px-4 py-3 text-sm leading-5 text-info">
            <p className="font-semibold">{dayMonthTR(date)} kasa raporu · düzeltme önerisi</p>
            {proposal.fromSubmit ? (
              <p className="mt-0.5">
                {proposal.gate === "kilitli"
                  ? "Ertesi günün raporu girildi; bu değişiklik yöneticinin onayıyla olur. Nedenini yazıp onaya gönderin."
                  : "Kasa alanlarını ertesi gün değiştirmek yöneticinin onayıyla olur; nedenini yazıp onaya gönderin."}
              </p>
            ) : null}
            <p className="mt-0.5">Yönetici onaylayınca rapora işlenir; o zamana kadar rapor değişmez.</p>
            {proposal.dropped ? <p className="mt-0.5 font-medium">{droppedPhotoText(proposal.gate)}</p> : null}
          </div>
        ) : null}
        <Card>
          <CardHeader
            icon={<ReceiptText />}
            title="ModPOS Z raporu"
            description={
              isLate
                ? "Z raporunun fotoğrafı zorunlu; rakamlar fotoğraftan dolar ya da elle yazın."
                : photoUi.storage && reading
                  ? "ModPOS'ta gün sonu Z raporunu alın; fotoğrafını çekin, rakamlar dolar. Ya da elle yazın."
                  : "ModPOS'ta gün sonu Z raporunu alın; toplam satışı ve ödeme türlerini yazın."
            }
          />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {photoBlock("kasa-z")}
            {field("zTotal", "Toplam satış (Z)", { autoFocus: !report && !photoUi.storage })}
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
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn sm:col-span-2">
                Ödeme türlerinin toplamı {money(live.paymentsTotal)}: Z toplamından {money(Math.abs(live.paymentsDiff))} {live.paymentsDiff > 0 ? "fazla" : "az"}. Bir tutarı yanlış yazmış olabilirsiniz.
              </p>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Wallet />} title="Kasa (nakit)" description="Çekmecedeki bütün nakdi sayın; teslim ettiğiniz parayı sayımdan sonra yazın." />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {field("openingCash", "Açılış (dünden devir)", {
              hint: liveCarry ? (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn" role="status">
                  <span className="min-w-0 flex-1 basis-56">
                    Önceki raporun devri {money(liveCarry.carry)} ({dayMonthTR(liveCarry.prevDate)}); yazdığınız {carryDiffText(liveCarry)}. Kasaya para kondu ya da
                    alındıysa nedenini nota yazın.
                  </span>
                  <Button size="xs" variant="secondary" onClick={() => setValues((v) => ({ ...v, openingCash: input(liveCarry.carry) }))}>
                    Devri yaz
                  </Button>
                </span>
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
            {outsWarning ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn sm:col-span-2">{outsWarning}</p> : null}
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
              <div className="space-y-2 rounded-xl bg-info-soft px-3 py-2.5 text-[13px] text-info">
                <p>Bu günün bir banka gün sonu fişi daha okundu ({money(posPrompt.next)}).</p>
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
            ) : null
          }
          description={
            photoUi.storage && reading && !proposal && !review
              ? "Banka POS'tan (yazarkasa) aldığınız Z raporu: üstünde Z RAPORU ve KDV dökümü yazar; banka gün sonu fişi değil. Fotoğrafını çekin, rakamlar dolar. Fotoğraf yoksa aşağıdakileri yazın."
              : "Banka POS'tan (yazarkasa) aldığınız Z raporundaki rakamları yazın (üstünde Z RAPORU ve KDV dökümü yazar)."
          }
          prevZ={prevOkcZ}
          day={date}
          audience={photoUi.admin ? "admin" : "staff"}
          forceDetails={photoUi.admin}
          modpos={values.card.trim() ? { zTotal: num("zTotal"), cash: num("cash"), card: num("card"), mealCard: num("mealCard"), online: num("online"), other: num("other") } : null}
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
