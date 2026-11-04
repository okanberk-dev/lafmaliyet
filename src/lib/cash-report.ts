import { CASH_OUT_LINES_SHOWN, cashOutShortLine, type CashOutLine } from "./cash-outs";
import { money } from "./format";
import { okcHasFigures, okcReconcile, sameVat, type OkcReconcileLine, type OkcReportFields, type OkcVatLine } from "./okc-z";
import { lafposDiffsLine, type LafposDiff } from "./lafpos/diffs";
import { photoDiffText, type PhotoDiff } from "./photo-read/kasa";
import { addDays, dayMonthTR, daysBetween, longDateTR, todayTR } from "./reminders";

/**
 * Gün sonu kasa raporu (saf; testli: tests/kasa-raporu.test.ts). Personel her akşam ModPOS'un Z raporuna ve kasaya
 * bakıp girer; burada olması gereken nakit, kasa farkı (eksik / fazla), kart farkı ve ertesi güne devir hesaplanır,
 * WhatsApp'a yapıştırılacak ayrıntılı metin yazılır. Ayrıntı: docs/KASA-RAPORU.md.
 */

export interface CashReportFields {
  /** İş günü (YYYY-MM-DD) */
  date: string;
  zNo: string | null;
  receipts: number | null;
  /** Z raporu: toplam satış ve ödeme türleri */
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  /** Kasa: açılış (dünden devir), gün içinde giren ve çıkan, akşam sayılan, sayımdan sonra teslim edilen */
  openingCash: number;
  /**
   * Gün içinde kasaya giren: nakit satış dışında çekmeceye konan (bozuk para, nakit tahsilat, nakit bahşiş). Alan
   * sonradan geldi: eski jsonb kopyalarında (önceki sürümler, istek yükleri) yoktur, 0 sayılır
   */
  cashIn: number;
  cashOut: number;
  cashOutNote: string | null;
  countedCash: number;
  handedOver: number;
  /**
   * Banka gün sonu fişinin net toplamı (yazarkasa Z'sinin kart satırı değil); yazarkasa kartı da girilmediyse kart
   * karşılaştırılmaz. Yazarkasa bölümünden önceki raporlarda tek kart kanıtı ("Banka POS")
   */
  bankPos: number | null;
  /** Z raporundaki ödenmez / ikram tutarı (ciroya girmez); girilmediyse null */
  offRevenue: number | null;
  /**
   * Z raporundaki indirim toplamı (isteğe bağlı); girilmediyse null: ayın indirimine yalnız girilen günler gider.
   * Alan sonradan geldi: eski kopyalarda ve elle kurulan raporlarda olmayabilir (boş sayılır)
   */
  discounts?: number | null;
  note: string | null;
  /**
   * Yazarkasanın (banka POS) mali Z raporu (dalga 13; docs/planlar/okc-z.md §6.5): bölüm isteğe bağlı. Alanlar sonradan
   * geldi: eski kopyalarda, bekleyen eski isteklerde ve elle kurulan raporlarda olmayabilir (boş sayılır). Kümülatif ve
   * yazarkasa dışı tahsilat burada değil: sunucu sütunlarıdır, yalnız yöneticinin DTO'sunda
   */
  okcZNo?: string | null;
  okcReceipts?: number | null;
  okcTotal?: number | null;
  okcVatTotal?: number | null;
  /** Oran oran KDV dökümü: sıfır gruplar yok, orana göre sıralı */
  okcVat?: OkcVatLine[] | null;
  okcCash?: number | null;
  /** K.KARTI / KREDİ satırı (altındaki banka satırları hariç) */
  okcCard?: number | null;
  okcMealCard?: number | null;
  okcOther?: number | null;
}

/** Yazarkasa alanları (formun; sunucu sütunları değil), formdaki sırayla */
export const OKC_FORM_KEYS = ["okcZNo", "okcReceipts", "okcTotal", "okcVatTotal", "okcVat", "okcCash", "okcCard", "okcMealCard", "okcOther"] as const satisfies readonly (keyof CashReportFields)[];
export type OkcFormKey = (typeof OKC_FORM_KEYS)[number];

/** Günün zayi ve ikram özeti (src/lib/waste.ts summarize): "2× Latte M, Süt 1 LT" */
export interface DayWaste {
  zayi: string | null;
  ikram: string | null;
}

/** Bu kadarın altındaki fark (bozuk para) "tutuyor" sayılır */
export const CASH_TOLERANCE = 1;

export type DiffKind = "short" | "over" | "even";

const r2 = (v: number) => Math.round(v * 100) / 100;

export function diffKind(diff: number): DiffKind {
  if (Math.abs(diff) < CASH_TOLERANCE) return "even";
  return diff < 0 ? "short" : "over";
}

/** "120 ₺ eksik", "30 ₺ fazla", "Kasa tutuyor" */
export function diffText(diff: number): string {
  const k = diffKind(diff);
  return k === "even" ? "Kasa tutuyor" : `${money(Math.abs(diff))} ${k === "short" ? "eksik" : "fazla"}`;
}

export interface CashResult {
  /** Ödeme türlerinin toplamı ve Z toplamından farkı (tutmuyorsa yanlış yazılmış bir tutar var) */
  paymentsTotal: number;
  paymentsDiff: number;
  /** Açılış + nakit satış + gün içinde giren − gün içinde çıkan */
  expectedCash: number;
  /** Sayılan − olması gereken: eksi eksik, artı fazla */
  cashDiff: number;
  kind: DiffKind;
  /** Sayılan − teslim edilen: ertesi günün açılışı */
  carryOver: number;
  /**
   * Kart farkı (docs/planlar/okc-z.md D5): yazarkasa kartı varsa o, yoksa banka gün sonu − ModPOS kart (ikisi de
   * girilmediyse null). Yazarkasa alanı boş eski raporda bugünkü sonuç birebir
   */
  cardDiff: number | null;
  /** Kart farkının kaynağı: yazarkasanın kart satırı, banka gün sonu ya da yok */
  cardSource: "okc" | "bank" | null;
}

/**
 * Raporun hesabı; olması gereken nakit her yerde buradan (form, döküm, e-posta, WhatsApp, istekler, LafPOS'tan doldur).
 * Gün içinde giren eski jsonb kopyasında yoksa 0 (CashReportFields.cashIn).
 */
export function computeCash(
  f: Pick<CashReportFields, "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "openingCash" | "cashIn" | "cashOut" | "countedCash" | "handedOver" | "bankPos" | "okcCard"> & {
    /** LafPOS gününde kartla bahşiş + kartla cari tahsilatı (G11): banka POS'unda var, Z'nin kartında yok; kart farkı düşer */
    cardExtra?: number | null;
  },
): CashResult {
  const paymentsTotal = r2(f.cash + f.card + f.mealCard + f.online + f.other);
  const expectedCash = r2(f.openingCash + f.cash + (f.cashIn ?? 0) - f.cashOut);
  const cashDiff = r2(f.countedCash - expectedCash);
  const okcCard = f.okcCard ?? null;
  const bankPos = f.bankPos ?? null;
  const cardRef = okcCard ?? bankPos;
  return {
    paymentsTotal,
    paymentsDiff: r2(paymentsTotal - f.zTotal),
    expectedCash,
    cashDiff,
    kind: diffKind(cashDiff),
    carryOver: r2(f.countedCash - f.handedOver),
    cardDiff: cardRef === null ? null : r2(cardRef - f.card - (f.cardExtra ?? 0)),
    cardSource: okcCard !== null ? "okc" : bankPos !== null ? "bank" : null,
  };
}

/** İş gününün döndüğü saat (Türkiye): gece bundan önce kapatılan gün bir önceki güne yazılır */
export const DAY_TURN_HOUR = 5;
/** Kasa raporunun "akşam" sayıldığı saat: bugünün raporu bundan sonra beklenir (zil ve Bugün ekranı) */
export const CASH_EVENING_HOUR = 20;

/** Türkiye saatiyle saat (0–23) */
export function trHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Akşam (20:00 ve sonrası) ya da gece 05:00'ten önce: bugünün kasa raporu beklenir (zil ve Bugün aynı kurala bakar) */
export function isCashEvening(now: Date = new Date()): boolean {
  const hour = trHour(now);
  return hour >= CASH_EVENING_HOUR || hour < DAY_TURN_HOUR;
}

/**
 * Formdaki iş günü: gece 05:00'ten önce kapatılan gün bir önceki güne yazılır (kafe gece yarısından sonra kapanabilir).
 * Türkiye saatiyle.
 */
export function businessDate(now: Date = new Date()): string {
  const today = todayTR(now);
  return trHour(now) < DAY_TURN_HOUR ? addDays(today, -1) : today;
}

/** Personelin rapor girebileceği günler: iş günü ve bir önceki gün (unutulan akşam ertesi gün girilir) */
export function staffCanReport(date: string, now: Date = new Date()): boolean {
  const day = businessDate(now);
  return date === day || date === addDays(day, -1);
}

/**
 * Personel bu günün kasasına (rapor, kasadan çıkanlar, fotoğraflar) hâlâ dokunabilir mi: bugün ve dün; ama günün raporu
 * varken sonraki bir günün raporu da girildiyse artık yalnız yönetici düzeltir (ertesi günün açılışı bu raporun devrine
 * dayanır). Unutulan dünü girmek serbest: o günün raporu yoksa kilit yok. Kasa sayfası, rapor eylemi, kasadan
 * çıkanlar ve fotoğraflar (src/server/photo-read/rules.ts staffDayOpen) aynı kuralı kullanır.
 */
export function staffDayEditable(date: string, state: { hasReport: boolean; laterReport: boolean }, now: Date = new Date()): boolean {
  return staffCanReport(date, now) && !(state.hasReport && state.laterReport);
}

// ---------------------------------------------------------------- Açılış ↔ önceki devir

/** Açılışın önceki raporun ertesi güne devriyle karşılaştırması (yalnız tutmadığında üretilir) */
export interface CarryCheck {
  /** Denetlenen raporun günü */
  date: string;
  /** Önceki raporun günü ve ertesi güne devri */
  prevDate: string;
  carry: number;
  opening: number;
  /** Açılış − devir: eksi az, artı fazla */
  diff: number;
  /** İki rapor arasında rapor girilmemiş gün */
  gapDays: number;
}

/**
 * Açılış önceki raporun devriyle tutuyor mu (1 ₺ altı tutar). Önceki rapor yoksa ya da tutuyorsa null. Okurken
 * hesaplanır: ertesi günün açılışını kullandıktan sonra düzeltilen bir önceki gün de yakalanır.
 */
export function carryCheck(date: string, openingCash: number, prev: { date: string; amount: number } | null): CarryCheck | null {
  if (!prev) return null;
  const diff = r2(openingCash - prev.amount);
  if (Math.abs(diff) < CASH_TOLERANCE) return null;
  return { date, prevDate: prev.date, carry: prev.amount, opening: openingCash, diff, gapDays: Math.max(0, daysBetween(prev.date, date) - 1) };
}

/** "120 ₺ az", "30 ₺ fazla" (açılış devre göre) */
export function carryDiffText(c: Pick<CarryCheck, "diff">): string {
  return `${money(Math.abs(c.diff))} ${c.diff < 0 ? "az" : "fazla"}`;
}

/**
 * Raporların açılış ↔ devir zinciri (günden güne listesi): her raporun açılışı kendinden önceki raporun devriyle.
 * `before`: listenin ilk raporundan önceki son raporun devri (previousCarryOver). Yalnız tutmayanlar, denetlenen
 * raporun gününe göre.
 */
export function carryChecks(
  reports: Pick<CashReportFields, "date" | "openingCash" | "countedCash" | "handedOver">[],
  before: { date: string; amount: number } | null,
): Map<string, CarryCheck> {
  const out = new Map<string, CarryCheck>();
  let prev = before;
  for (const r of [...reports].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = carryCheck(r.date, r.openingCash, prev);
    if (c) out.set(r.date, c);
    prev = { date: r.date, amount: r2(r.countedCash - r.handedOver) };
  }
  return out;
}

/** Bu günün devriyle tutmayan sonraki rapor (zincirdeki denetimlerden) */
export function nextCheckOf(checks: Iterable<CarryCheck>, date: string): CarryCheck | null {
  for (const c of checks) if (c.prevDate === date) return c;
  return null;
}

/**
 * Açılış devirle tutmuyorsa not zorunlu: yalnız rapor yeniyse ya da açılış değiştiyse (tutmayan eski bir raporda Z
 * yazım hatasını düzeltmek engellenmez). `prevOpening`: kayıtlı raporun açılışı (yeni raporda null).
 */
export function openingNeedsNote(o: { check: CarryCheck | null; openingCash: number; prevOpening: number | null; note: string | null }): boolean {
  if (!o.check || (o.note ?? "").trim()) return false;
  return o.prevOpening === null || Math.abs(o.openingCash - o.prevOpening) >= 0.005;
}

// ---------------------------------------------------------------- Düzeltmeler (önceki sürümler)

/** Önceki sürümün kopyası (cash_report_revisions.data): formun alanları, kasa farkı ve sayan */
export type CashRevisionData = CashReportFields & { cashDiff: number; countedByName: string | null };

type ChangeKey = Exclude<keyof CashRevisionData, "date" | "cashDiff">;

/** Değişiklik listesindeki adlar ve sıra: önce kasa (nakit), sonra ModPOS Z raporu, yazarkasa (banka POS) Z'si, kart ve notlar */
export const CHANGE_LABELS: Record<ChangeKey, string> = {
  openingCash: "Açılış",
  cash: "Nakit satış",
  cashIn: "Gün içinde giren",
  cashOut: "Gün içinde çıkan",
  countedCash: "Sayılan nakit",
  handedOver: "Teslim edilen",
  zTotal: "Toplam satış",
  card: "Kart",
  mealCard: "Yemek kartı",
  online: "Online",
  other: "Diğer",
  discounts: "İndirim",
  offRevenue: "Ödenmez / ikram",
  okcTotal: "Yazarkasa toplam",
  okcCash: "Yazarkasa nakit",
  okcCard: "Yazarkasa kart",
  okcMealCard: "Yazarkasa yemek kartı",
  okcOther: "Yazarkasa diğer",
  okcVatTotal: "Yazarkasa KDV",
  okcVat: "KDV dökümü",
  bankPos: "Banka gün sonu",
  zNo: "Z no",
  receipts: "Fiş sayısı",
  okcZNo: "Yazarkasa Z no",
  okcReceipts: "Yazarkasa fiş sayısı",
  cashOutNote: "Neye çıktı",
  note: "Not",
  countedByName: "Sayan",
};

/**
 * Kasadaki nakdi değiştiren alanlar ve kasayı sayan: bunlar iş günü kapandıktan sonra değişirse yönetici uyarılır,
 * personel ertesi gün yalnız yönetici onayıyla değiştirir (staffCashGate)
 */
export const SENSITIVE: readonly ChangeKey[] = ["openingCash", "cash", "cashIn", "cashOut", "countedCash", "handedOver", "countedByName"];

const TEXT_FIELDS: readonly ChangeKey[] = ["cashOutNote", "note"];
const PLAIN_FIELDS: readonly ChangeKey[] = ["zNo", "receipts", "okcZNo", "okcReceipts", "countedByName"];
/**
 * Değeri yazılmadan "… değişti" diye gösterilenler: metin alanları ve KDV dökümü (bir dizi: metin ya da sayı gibi
 * karşılaştırılmaz, sameVat; docs/planlar/okc-z.md §6.5)
 */
const QUIET_FIELDS: readonly ChangeKey[] = [...TEXT_FIELDS, "okcVat"];

export interface FieldChange {
  key: ChangeKey;
  label: string;
  /** Önceki ve yeni değer (metin alanında boş: yalnız "değişti" yazılır) */
  from: string;
  to: string;
  sensitive: boolean;
}

/**
 * Eksik alan (eski bir kopyada olmayan) boş sayılır; gün içinde giren 0 (alan gelmeden önce giren yazılmazdı: eski
 * kopyayla ilk düzeltmede "Gün içinde giren — → 0 ₺" görünmez)
 */
const valueOf = (d: Partial<CashRevisionData>, k: ChangeKey) => (k === "cashIn" ? (d.cashIn ?? 0) : (d[k] ?? null));

/**
 * İki sürüm arasındaki değişiklikler. Tutarlar 0,005 hassasiyetle, boş "—"; metin alanı (not, neye çıktı) içeriği
 * yazılmadan "Not değişti". Değişiklik yoksa boş liste.
 */
export function revisionChanges(before: Partial<CashRevisionData>, after: Partial<CashRevisionData>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const key of Object.keys(CHANGE_LABELS) as ChangeKey[]) {
    const quiet = QUIET_FIELDS.includes(key);
    if (key === "okcVat") {
      // Döküm sıralı ve kuruşa yuvarlı karşılaştırılır: aynı döküm farklı sırada değişmemiştir, boş ve [] eşit
      if (!sameVat(before.okcVat, after.okcVat)) out.push({ key, label: CHANGE_LABELS[key], from: "", to: "", sensitive: false });
      continue;
    }
    const a = valueOf(before, key) as string | number | null;
    const b = valueOf(after, key) as string | number | null;
    const text = TEXT_FIELDS.includes(key) || PLAIN_FIELDS.includes(key);
    const same = text
      ? String(a ?? "").trim() === String(b ?? "").trim()
      : (a === null && b === null) || (a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.005);
    if (same) continue;
    const shown = (v: string | number | null) => (v === null || v === "" ? "—" : PLAIN_FIELDS.includes(key) ? String(v) : money(Number(v)));
    out.push({ key, label: CHANGE_LABELS[key], from: quiet ? "" : shown(a), to: quiet ? "" : shown(b), sensitive: SENSITIVE.includes(key) });
  }
  return out;
}

/** "Sayılan nakit: 2.880 ₺ → 2.980 ₺", metin alanında ve KDV dökümünde "Not değişti" (`colon: false`: iki noktasız, satır içi) */
export function changeLine(c: FieldChange, colon = true): string {
  if (QUIET_FIELDS.includes(c.key)) return `${c.label} değişti`;
  return `${c.label}${colon ? ":" : ""} ${c.from} → ${c.to}`;
}

/** "Sayılan nakit 2.880 ₺ → 2.980 ₺; Not değişti" */
export function changesText(changes: FieldChange[]): string {
  return changes.map((c) => changeLine(c, false)).join("; ");
}

/** İş günü kapandıktan sonra (ertesi gün 05:00'ten sonra) yapılan gönderim */
export function isLateEdit(date: string, submittedAt: Date): boolean {
  return businessDate(submittedAt) > date;
}

/**
 * Personelin kayıtlı rapordaki değişikliği nasıl kaydedilir (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği):
 * "direct" doğrudan, "request" yöneticinin onayına giden istek, "closed" personele kapalı. Rapor yoksa (unutulan dünü
 * girmek) doğrudan. Ertesi günün raporu girildiyse (kilitli gün) her değişiklik istek; iş günü kapandıktan sonra
 * (ertesi gün 05:00'ten sonra) kasa alanı ya da sayan değişirse istek; metin ve Z alanları doğrudan.
 */
export function staffCashGate(o: { date: string; now: Date; hasReport: boolean; laterReport: boolean; changes: readonly Pick<FieldChange, "sensitive">[] }): "direct" | "request" | "closed" {
  if (!staffCanReport(o.date, o.now)) return "closed";
  if (!o.hasReport) return "direct";
  if (o.laterReport) return o.changes.length ? "request" : "direct";
  return isLateEdit(o.date, o.now) && o.changes.some((c) => c.sensitive) ? "request" : "direct";
}

// ---------------------------------------------------------------- Geç rapor (onaylı; docs/KASA-RAPORU.md › Geç rapor)

/** Personelin geç rapor penceresi (takvim günü): dünden eski, iş gününden en çok bu kadar önce */
export const LATE_REPORT_DAYS = 14;

/**
 * Personel bu günün raporunu geç rapor olarak (yöneticinin onayıyla) girebilir mi: iş gününden 2 ile 14 takvim günü
 * önce. Dün normal formdadır (staffCanReport); bugün ve ileri günler yok.
 */
export function staffLateDay(date: string, now: Date = new Date()): boolean {
  const day = businessDate(now);
  return date <= addDays(day, -2) && date >= addDays(day, -LATE_REPORT_DAYS);
}

/**
 * Geç raporun yükü (staff_requests.payload, tür `kasa-gec`): raporun alanları (Z no zorunlu), teslim alan, istekte
 * tutulan fotoğraflar ve isteyenin gördüğü kasa farkı. Kasayı sayan isteyendir; çözümü src/lib/cash-requests.ts LatePayload.
 */
export type LateCashPayload = CashReportFields & {
  zNo: string;
  handedTo: { kind: "user"; id: number; name: string } | { kind: "banka" } | null;
  photos: { id: number; kind: "kasa-z" | "kasa-pos" | "kasa-okc" }[];
  cashDiff: number;
};

/** Zincirin bir halkası: kayıtlı rapor ya da onay bekleyen geç rapor (`pending`) */
export interface ZLink {
  date: string;
  zNo: string | null;
  pending?: boolean;
}

const zNumber = (z: string | null | undefined): number | null => {
  const t = (z ?? "").trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};

/**
 * Z no sırası (yöneticinin geç rapor kartı): önceki halkanın Z no'su bu rapordan küçük, sonrakininki büyük olmalı.
 * `ok`: null yargı yok (Z no sayı değil ya da sayılı komşu yok), false sıra tutmuyor. Metin: "Z no 1204 · önceki 1203
 * (13 Ekim) · sonraki 1206 (15 Ekim, onay bekliyor)" ya da "Z no sırası tutmuyor: …".
 */
export function zNoOrder(prev: ZLink | null, zNo: string | null, next: ZLink | null): { ok: boolean | null; text: string } {
  const n = zNumber(zNo);
  const label = (l: ZLink) => `${l.zNo?.trim() || "Z no yok"} (${dayMonthTR(l.date)}${l.pending ? ", onay bekliyor" : ""})`;
  const parts = [prev ? `önceki ${label(prev)}` : null, next ? `sonraki ${label(next)}` : null].filter((x): x is string => Boolean(x));
  if (n === null) return { ok: null, text: [`Z no ${zNo?.trim() || "yok"}`, ...parts].join(" · ") };
  const p = zNumber(prev?.zNo);
  const q = zNumber(next?.zNo);
  const bad = [p !== null && p >= n ? `önceki ${label(prev!)} bu rapordan büyük ya da eşit` : null, q !== null && q <= n ? `sonraki ${label(next!)} bu rapordan küçük ya da eşit` : null].filter(
    (x): x is string => Boolean(x),
  );
  if (bad.length) return { ok: false, text: `Z no sırası tutmuyor: ${bad.join("; ")} (bu rapor ${zNo!.trim()})` };
  return { ok: p === null && q === null ? null : true, text: [`Z no ${zNo!.trim()}`, ...parts].join(" · ") };
}

/**
 * Personelin "Girilmemiş günler"i: dünden eski geç rapor penceresindeki (staffLateDay), ilk raporun gününden sonraki,
 * raporu olmayan ve kapalı işaretli olmayan günler, en yeni önce. `pendingByDate`: o gün için onay bekleyen ya da
 * kişinin reddedilen isteği. Hiç rapor yoksa (kasa kullanılmaya başlamadı) boş.
 */
export function lateMissingDays(
  reportDates: Iterable<string>,
  firstDate: string | null,
  closedDays: Iterable<string>,
  pendingByDate: ReadonlyMap<string, "pending" | "rejected">,
  now: Date = new Date(),
): { date: string; state: "missing" | "pending" | "rejected" }[] {
  if (!firstDate) return [];
  const reported = new Set(reportDates);
  const closed = new Set(closedDays);
  const day = businessDate(now);
  const out: { date: string; state: "missing" | "pending" | "rejected" }[] = [];
  for (let d = addDays(day, -2); d >= addDays(day, -LATE_REPORT_DAYS); d = addDays(d, -1)) {
    if (d <= firstDate || reported.has(d) || closed.has(d)) continue;
    out.push({ date: d, state: pendingByDate.get(d) ?? "missing" });
  }
  return out;
}

/**
 * Bir sürümün kopyası (kayıtlı rapor satırından ya da rapor DTO'sundan). Sayanı boş rapor (bu özellikten önce
 * kaydedilmiş) gönderenin saydığı raporudur: kopyaya o yazılır, yoksa ilk düzeltmede kimsenin yapmadığı "Sayan — → Ayşe"
 * değişikliği görünür.
 */
export function revisionDataOf(r: CashReportFields & { cashDiff: number; countedByName: string | null; submittedByName?: string }): CashRevisionData {
  return {
    date: r.date,
    zNo: r.zNo,
    receipts: r.receipts,
    zTotal: r.zTotal,
    cash: r.cash,
    card: r.card,
    mealCard: r.mealCard,
    online: r.online,
    other: r.other,
    openingCash: r.openingCash,
    cashIn: r.cashIn ?? 0,
    cashOut: r.cashOut,
    cashOutNote: r.cashOutNote,
    countedCash: r.countedCash,
    handedOver: r.handedOver,
    bankPos: r.bankPos,
    offRevenue: r.offRevenue,
    discounts: r.discounts,
    note: r.note,
    okcZNo: r.okcZNo ?? null,
    okcReceipts: r.okcReceipts ?? null,
    okcTotal: r.okcTotal ?? null,
    okcVatTotal: r.okcVatTotal ?? null,
    okcVat: r.okcVat ?? null,
    okcCash: r.okcCash ?? null,
    okcCard: r.okcCard ?? null,
    okcMealCard: r.okcMealCard ?? null,
    okcOther: r.okcOther ?? null,
    cashDiff: r.cashDiff,
    countedByName: r.countedByName ?? r.submittedByName ?? null,
  };
}

/** Kayıtlı önceki sürüm (cash_report_revisions satırı) */
export interface CashRevisionRow {
  revision: number;
  data: CashRevisionData;
  /** O sürümü gönderen (zil yöneticinin kendi düzeltmesini saymaz; kullanıcı silindiyse boş) */
  submittedBy?: number | null;
  submittedByName: string;
  /** O sürümün gönderildiği an (ISO) */
  submittedAt: string;
}

/** Sayanı boş kopya (bu özellikten önceki rapordan, düzeltilmeden alınmış): o sürümü gönderen saymış sayılır */
const withCounter = (d: CashRevisionData, by: string): CashRevisionData => (d.countedByName ? d : { ...d, countedByName: by });

export interface RevisionEntry {
  /** Bu gönderimle gelen sürüm */
  revision: number;
  /** Gönderim anı (ISO) ve gönderen */
  at: string;
  by: string;
  byId: number | null;
  /** Sürüm personelin onaylanan düzeltme önerisiyse öneren (gönderen onaylayan yöneticidir); değilse null */
  proposedBy: string | null;
  changes: FieldChange[];
  /** İş günü kapandıktan sonra ve kasa alanı değişti */
  late: boolean;
}

/**
 * Raporun düzeltme geçmişi, en yeni önce: kayıtlı sürümler sırayla birbiriyle, sonuncusu raporun şimdiki hâliyle
 * karşılaştırılır. `first`: ilk gönderim (raporun açıldığı an; gönderen yalnız 1. sürümün kopyası varsa bilinir).
 * Bu özellikten önceki raporların geçmişi ilk düzeltmeden sonra başlar. `proposedBy`: onaylanan düzeltme önerilerinin
 * sürüme göre önerenleri (src/server/data/cash-requests.ts proposedByForReports).
 */
export function historyOf(
  report: CashReportFields & {
    revision: number;
    cashDiff: number;
    countedByName: string | null;
    submittedBy?: number | null;
    submittedByName: string;
    createdAt: string;
    updatedAt: string;
  },
  revisions: CashRevisionRow[],
  proposedBy?: ReadonlyMap<number, string>,
): { entries: RevisionEntry[]; first: { at: string; by: string | null } } {
  const snaps = [...revisions].filter((r) => r.revision < report.revision).sort((a, b) => a.revision - b.revision);
  const versions = [
    ...snaps.map((s) => ({ revision: s.revision, data: withCounter(s.data, s.submittedByName), at: s.submittedAt, by: s.submittedByName, byId: s.submittedBy ?? null })),
    { revision: report.revision, data: revisionDataOf(report), at: report.updatedAt, by: report.submittedByName, byId: report.submittedBy ?? null },
  ];
  const entries: RevisionEntry[] = [];
  for (let i = 1; i < versions.length; i++) {
    const v = versions[i];
    const changes = revisionChanges(versions[i - 1].data, v.data);
    entries.push({
      revision: v.revision,
      at: v.at,
      by: v.by,
      byId: v.byId,
      proposedBy: proposedBy?.get(v.revision) ?? null,
      changes,
      late: isLateEdit(report.date, new Date(v.at)) && changes.some((c) => c.sensitive),
    });
  }
  const knownFirst = snaps[0]?.revision === 1 ? snaps[0].submittedByName : report.revision === 1 ? report.submittedByName : null;
  return { entries: entries.reverse(), first: { at: report.createdAt, by: knownFirst } };
}

/**
 * Kayıtlı raporun bütünlük bilgisi (WhatsApp metni, e-posta, ekran): sayan, açılışın önceki devirle tutmaması, bu
 * raporun devriyle tutmayan sonraki rapor ve son düzeltmede değişenler. `prev`: önceki raporun devri
 * (previousCarryOver), `next`: sonraki rapor (nextReportAfter), `revisions`: raporun kayıtlı önceki sürümleri.
 */
export function integrityOf(
  r: CashReportFields & { revision: number; cashDiff: number; countedByName: string | null; submittedByName: string; updatedAt: string },
  prev: { date: string; amount: number } | null,
  next: { date: string; openingCash: number } | null,
  revisions: CashRevisionRow[],
): CashReportIntegrity {
  return {
    countedBy: r.countedByName,
    carry: carryCheck(r.date, r.openingCash, prev),
    next: next ? carryCheck(next.date, next.openingCash, { date: r.date, amount: r2(r.countedCash - r.handedOver) }) : null,
    changes: lastRevision(r, revisions)?.changes ?? null,
  };
}

/** Gönderim anı, Türkiye saatiyle: "22 Ekim 10:05" */
export function stampTR(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(d);
  return `${dayMonthTR(todayTR(d))} ${time}`;
}

/** Son düzeltme (şimdiki sürüm ile bir önceki kopya): e-posta ve WhatsApp'taki "Değişen:" satırı */
export function lastRevision(
  report: CashReportFields & { revision: number; cashDiff: number; countedByName: string | null; submittedByName: string; updatedAt: string },
  revisions: CashRevisionRow[],
): { changes: FieldChange[]; late: boolean } | null {
  const prev = revisions.find((r) => r.revision === report.revision - 1);
  if (!prev) return null;
  const changes = revisionChanges(withCounter(prev.data, prev.submittedByName), revisionDataOf(report));
  return { changes, late: isLateEdit(report.date, new Date(report.updatedAt)) && changes.some((c) => c.sensitive) };
}

/**
 * Zilin "Kasa raporu ertesi gün değişti" bildirimi: iş günü kapandıktan sonra kasa alanı değişen bütün düzeltmeler,
 * yalnız sonuncusu değil (ardından not için yeniden gönderilen rapor uyarıyı kapatmaz). Bakan yöneticinin kendi
 * düzeltmeleri sayılmaz (`viewer`). `revision`: en yeni geç düzeltmenin sürümü (bildirimin kimliği; yalnız yeni bir geç
 * düzeltme yeniden okunmamış yapar), `by`: düzeltenler (onaylanan öneride "Mehmet önerdi · Ayşe onayladı"),
 * `changes`: o düzeltmelerde değişen kasa alanları, eskiden yeniye. Yoksa null.
 */
export function lateCorrections(
  report: Parameters<typeof historyOf>[0],
  revisions: CashRevisionRow[],
  viewer: number | null,
  proposedBy?: ReadonlyMap<number, string>,
): { revision: number; by: string[]; changes: FieldChange[] } | null {
  const late = historyOf(report, revisions, proposedBy).entries.filter((e) => e.late && (viewer === null || e.byId !== viewer));
  if (!late.length) return null;
  const oldestFirst = [...late].reverse();
  return {
    revision: late[0].revision,
    by: [...new Set(oldestFirst.map((e) => (e.proposedBy ? `${e.proposedBy} önerdi · ${e.by} onayladı` : e.by)))],
    changes: oldestFirst.flatMap((e) => e.changes.filter((c) => c.sensitive)),
  };
}

/** Türkiye numarası wa.me biçimine: "0532 123 45 67" → "905321234567"; geçersizse null */
export function waPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (/^90\d{10}$/.test(d)) return d;
  if (/^0\d{10}$/.test(d)) return `9${d}`;
  if (/^5\d{9}$/.test(d)) return `90${d}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** WhatsApp bağlantısı: numara varsa o sohbete, yoksa sohbet seçiciye (grup da seçilebilir) */
export function whatsappLink(text: string, phone?: string | null): string {
  const p = waPhone(phone);
  return `https://wa.me/${p ?? ""}?text=${encodeURIComponent(text)}`;
}

const PAYMENTS: { key: "cash" | "card" | "mealCard" | "online" | "other"; label: string }[] = [
  { key: "cash", label: "Nakit" },
  { key: "card", label: "Kredi / banka kartı" },
  { key: "mealCard", label: "Yemek kartı" },
  { key: "online", label: "Online" },
  { key: "other", label: "Diğer" },
];

/** Raporun satırları (WhatsApp metni, e-posta ve ekran aynı sırayı kullanır) */
export function paymentLines(f: CashReportFields): { label: string; amount: number }[] {
  return PAYMENTS.filter((p) => p.key === "cash" || p.key === "card" || f[p.key] !== 0).map((p) => ({ label: p.label, amount: f[p.key] }));
}

/**
 * Raporun fotoğraf ve kasadan çıkan bilgisi (WhatsApp metni ve e-posta; docs/FOTOGRAF.md). Fotoğrafın kendisi ya da
 * adresi hiçbir zaman metne girmez: "Panelde aç" yeterli.
 */
export interface CashReportExtras {
  /**
   * Rapora bağlı fotoğraflar: `z` ModPOS Z'si (`kasa-z`), `okc` banka POS Z'si (yazarkasa, `kasa-okc`; bölümünde
   * çekilen banka gün sonu fişi de), `pos` yazarkasa bölümünden önceki eski banka POS fotoğrafı (`kasa-pos`, banka fişi)
   */
  photos?: { z: boolean; okc: boolean; pos: boolean } | null;
  /** Net okunmuş ama farklı yazılan alanlar (src/lib/photo-read/kasa.ts suspiciousDiffs) */
  photoDiffs?: PhotoDiff[] | null;
  /** Günün kasadan çıkan satırları */
  cashOuts?: (CashOutLine & { photo: boolean })[] | null;
  /**
   * Günün kasası (docs/LAFPOS.md › Kasa raporu): "LafPOS" geçiş gününden sonraki günlerde (Z bölümünün adı "LafPOS gün
   * sonu (Z)"); verilmezse ModPOS. Geçiş günü boşken hep ModPOS: metin bugünkü gibi
   */
  kasa?: "ModPOS" | "LafPOS";
  /** LafPOS'un gün sonundan farklı yazılan alanlar (denetim E-09; src/lib/lafpos/diffs.ts), yalnız LafPOS günlerinde */
  lafposDiffs?: LafposDiff[] | null;
  /** LafPOS gününde kartla bahşiş + kartla cari tahsilatı (G11): kart karşılaştırmaları bunu düşer (withCardExtra) */
  cardExtra?: number | null;
}

/** Kart karşılaştırmasının girdisi: LafPOS'un kartla bahşiş ve cari tahsilatı varsa rapor alanlarına eklenir (kaydedilmez) */
export function withCardExtra<T extends object>(f: T, cardExtra: number | null | undefined): T & { cardExtra?: number } {
  return cardExtra && cardExtra > 0 ? { ...f, cardExtra } : f;
}

/**
 * Kart bölümünde düşülen LafPOS kartla bahşiş + cari tahsilatı (G11): kayıtlı görünümün ve e-postanın satır adı. Banka
 * POS ile kart arasındaki farkın neden "yok" olduğunu söyler; tutarı yöneticiye yazılır, personele "düşüldü"
 */
export const CARD_EXTRA_LABEL = "− LafPOS kartla bahşiş + cari tahsilatı";

/** WhatsApp ve e-posta metninin kart satırının eki: " (bahşiş / cari tahsilatı düşüldü)"; yöneticide tutarıyla; yoksa "" */
export function cardExtraSuffix(extra: number | null | undefined, audience: CashTextAudience): string {
  if (!extra || extra <= 0) return "";
  return audience === "admin" ? ` (LafPOS kartla bahşiş + cari tahsilatı ${money(extra)} düşüldü)` : " (bahşiş / cari tahsilatı düşüldü)";
}

/** Z bölümünün adı: "ModPOS Z raporu", LafPOS günlerinde "LafPOS gün sonu (Z)" */
export function zSectionTitle(kasa: CashReportExtras["kasa"]): string {
  return kasa === "LafPOS" ? "LafPOS gün sonu (Z)" : "ModPOS Z raporu";
}

/** Fotoğrafların adları, formdaki sırayla: "ModPOS Z", "banka POS Z", eski "banka fişi" (e-postanın satırı da bunlar) */
export function photoNames(p: CashReportExtras["photos"]): string[] {
  if (!p) return [];
  return [p.z ? "ModPOS Z" : null, p.okc ? "banka POS Z" : null, p.pos ? "banka fişi" : null].filter((n): n is string => n !== null);
}

/** "📷 ModPOS Z ve banka POS Z fotoğrafı panelde" (docs/planlar/okc-z.md §8) */
export function photosLine(p: CashReportExtras["photos"]): string | null {
  const names = photoNames(p);
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}`;
  return `📷 ${list} fotoğrafı panelde`;
}

/** Kasadan çıkan satırları: en çok altısı, kalanı "ve 2 kalem daha" */
export function cashOutLines(lines: CashReportExtras["cashOuts"]): string[] {
  if (!lines?.length) return [];
  const shown = lines.slice(0, CASH_OUT_LINES_SHOWN).map((l) => `${cashOutShortLine(l)}${l.photo ? " 📷" : ""}`);
  return lines.length > CASH_OUT_LINES_SHOWN ? [...shown, `ve ${lines.length - CASH_OUT_LINES_SHOWN} kalem daha`] : shown;
}

/**
 * Kasanın bütünlüğü (WhatsApp metni ve e-posta; docs/KASA-RAPORU.md › Açılış ve devir, Düzeltmeler): kasayı kimin
 * saydığı, açılışın önceki devirle tutmaması, bu raporun devriyle tutmayan ertesi gün ve son düzeltmede değişenler.
 */
export interface CashReportIntegrity {
  /** Kasayı sayan (gönderenden farklıysa yazılır) */
  countedBy?: string | null;
  /** Açılış önceki raporun devriyle tutmuyor */
  carry?: CarryCheck | null;
  /** Sonraki raporun açılışı bu raporun devriyle tutmuyor */
  next?: CarryCheck | null;
  /** Son düzeltmede değişenler (yalnız güncellenen raporda) */
  changes?: FieldChange[] | null;
}

/** "Önceki devir 1.200 ₺ (21 Ekim): açılış 120 ₺ az" */
export function carryWarning(c: CarryCheck): string {
  return `Önceki devir ${money(c.carry)} (${dayMonthTR(c.prevDate)}): açılış ${carryDiffText(c)}`;
}

/** "22 Ekim açılışı (1.200 ₺) bu devirle tutmuyor" */
export function nextWarning(c: CarryCheck): string {
  return `${dayMonthTR(c.date)} açılışı (${money(c.opening)}) bu devirle tutmuyor`;
}

/** Başlıktaki kişi: "Mehmet", sayan başkaysa "Mehmet · sayan Ayşe" */
export function byLine(by: string, countedBy?: string | null): string {
  return countedBy && countedBy !== by ? `${by} · sayan ${countedBy}` : by;
}

/**
 * Rapor metninin okuru: `"staff"` WhatsApp metni (personel de gönderir; grup güvenli bir kanal değildir), `"admin"`
 * yöneticinin seçtiği adreslere giden e-postanın metin sürümü. Yazarkasanın toplamı, KDV'si ve ModPOS'la öteki
 * karşılaştırmaları yalnız `"admin"`de (docs/planlar/okc-z.md İlke 8, D13, §8)
 */
export type CashTextAudience = "staff" | "admin";

/** Yöneticinin metninde rapor alanları ve sunucunun yazarkasa dışı tahsilatı (K4 onu da sayar; personelde hiç yok) */
export type CashTextFields = CashReportFields & Pick<OkcReportFields, "okcOutside">;

/** WhatsApp metninde değeriyle yazılan yazarkasa alanları (bloğun kendi rakamları); ötekiler yalnız adıyla (İlke 8) */
const OKC_STAFF_DIFF_VALUES: readonly PhotoDiff["field"][] = ["okcZNo", "okcCash", "okcCard"];

/**
 * WhatsApp'ın "Değişen" satırında değeri yazılmayan yazarkasa alanları: bloğa girmeyen rakamlar (günlük toplam, KDV,
 * fiş sayısı, yemek kartı, diğer; döküm zaten adıyla). Z no, nakit, kart ve banka gün sonu bloktaki gibi değeriyle
 */
const OKC_STAFF_CHANGE_NAME_ONLY: readonly FieldChange["key"][] = ["okcTotal", "okcVatTotal", "okcVat", "okcReceipts", "okcMealCard", "okcOther"];

/** "Değişen" satırı: personelin metninde bloğa girmeyen yazarkasa rakamı yalnız adıyla ("Yazarkasa toplam değişti") */
function changesLine(changes: FieldChange[], audience: CashTextAudience): string {
  return changes.map((c) => (audience === "staff" && OKC_STAFF_CHANGE_NAME_ONLY.includes(c.key) ? `${c.label} değişti` : changeLine(c, false))).join("; ");
}

/**
 * Fotoğraftan farklı yazılan alan: "Kart (fotoğrafta 8.915 ₺)". Personelin metninde bloğa girmeyen yazarkasa rakamı
 * (günlük toplam, KDV, oranlar…) yalnız adıyla: "Günlük toplam (banka POS Z)"
 */
function diffLine(d: PhotoDiff, audience: CashTextAudience): string {
  if (audience === "admin" || !d.field.startsWith("okc") || OKC_STAFF_DIFF_VALUES.includes(d.field)) return photoDiffText(d, false);
  return d.label.startsWith("Yazarkasa") ? d.label : `${d.label} (banka POS Z)`;
}

const TONE_MARK: Record<OkcReconcileLine["tone"], string> = { good: "✅", info: "ℹ️", warn: "⚠️" };
const moreLess = (d: number) => `${money(Math.abs(d))} ${d > 0 ? "fazla" : "az"}`;

/**
 * Banka POS Z bloğu (docs/planlar/okc-z.md §8). WhatsApp (`"staff"`): Z no, nakit, kredi kartı, kart satırı ve banka
 * gün sonu; yazarkasanın günlük toplamı, KDV'si, fiş sayısı ve ModPOS'la öteki karşılaştırmalar (toplam, nakit, yemek
 * kartı, banka, kendi içinde) yalnız e-postada (`"admin"`). Kart satırı `computeCash`'in kaynağıyla (D5). Yazarkasa
 * alanları boş raporda (eski ya da yalnız banka gün sonu yazılmış) bugünkü "Kart" bloğu, etiket "Banka POS" (§3.7:
 * eski günlerde alan banka gün sonunu da yazarkasanın kart satırını da tutabilir, anlam iddia edilmez). `kasa` günün
 * kasası (geçiş gününden itibaren LafPOS; denetim E-39), karşılaştırmalar onun adıyla
 */
export function okcTextBlock(f: CashTextFields & { cardExtra?: number | null }, audience: CashTextAudience, kasa: CashReportExtras["kasa"] = "ModPOS"): string[] {
  const k = kasa ?? "ModPOS";
  const c = computeCash(f);
  const same = (d: number) => Math.abs(d) < CASH_TOLERANCE;
  // LafPOS'un kartla bahşiş ve cari tahsilatı düşüldüyse kart satırı söyler (G11; personelde tutarsız)
  const extra = cardExtraSuffix(f.cardExtra, audience);
  if (!okcHasFigures(f)) {
    if (c.cardDiff === null) return [];
    return ["*Kart*", `Banka POS: ${money(f.bankPos)} ${same(c.cardDiff) ? `✅ ${k} ile aynı` : `⚠️ ${k}'tan ${moreLess(c.cardDiff)}`}${extra}`];
  }
  const admin = audience === "admin";
  const out = ["*Banka POS Z raporu*"];
  if (f.okcZNo) out.push(`Z no: ${f.okcZNo}`);
  if (admin && f.okcTotal != null) {
    out.push(`Günlük toplam: ${money(f.okcTotal)}${f.okcVatTotal != null ? ` (KDV ${money(f.okcVatTotal)})` : ""}${f.okcReceipts ? ` · ${f.okcReceipts} fiş` : ""}`);
  }
  if (admin && f.okcVat?.length) out.push(`KDV dökümü: ${f.okcVat.map((l) => `%${l.rate} ${money(l.total)} (KDV ${money(l.vat)})`).join(" · ")}`);
  if (f.okcCash != null) out.push(`• Nakit: ${money(f.okcCash)}`);
  if (f.okcCard != null) out.push(`• Kredi kartı: ${money(f.okcCard)}`);
  if (admin && f.okcMealCard) out.push(`• Yemek kartı: ${money(f.okcMealCard)}`);
  if (admin && f.okcOther) out.push(`• Diğer: ${money(f.okcOther)}`);
  if (c.cardDiff !== null) {
    out.push(`${same(c.cardDiff) ? `✅ Kart ${k} ile aynı` : `⚠️ ${c.cardSource === "okc" ? "Yazarkasa kartı" : "Banka gün sonu"} ${k}'tan ${moreLess(c.cardDiff)}`}${extra}`);
  }
  if (f.bankPos !== null) out.push(`Banka gün sonu: ${money(f.bankPos)}`);
  // Yöneticinin satırları (kart satırı yukarıda kısa hâliyle)
  if (admin) for (const l of okcReconcile(f, "admin", k)) if (l.key !== "okc-card") out.push(`${TONE_MARK[l.tone]} ${l.text}`);
  return out;
}

/**
 * WhatsApp'a yapıştırılacak ayrıntılı rapor (WhatsApp *kalın* yazar). Kasa farkı, kart farkı ve Z toplamının ödeme
 * türleriyle tutmaması öne çıkarılır. Her zaman personelin metni (yönetici gönderse de gruba gider)
 */
export function whatsappText(f: CashReportFields, meta: { by: string; revision?: number; waste?: DayWaste | null } & CashReportExtras & CashReportIntegrity): string {
  return cashReportText(f, meta, "staff");
}

/** Rapor metni: WhatsApp (`"staff"`) ya da e-postanın metin sürümü (`"admin"`; yıldızları şablon siler) */
export function cashReportText(
  f: CashTextFields,
  meta: { by: string; revision?: number; waste?: DayWaste | null } & CashReportExtras & CashReportIntegrity,
  audience: CashTextAudience,
): string {
  // LafPOS gününde kart karşılaştırması kartla bahşiş ve cari tahsilatını düşer (G11)
  f = withCardExtra(f, meta.cardExtra);
  const c = computeCash(f);
  const head = [`*L'Affogato · Gün sonu kasa raporu ${reportNo(f.date)}*${meta.revision && meta.revision > 1 ? " (güncellendi)" : ""}`, `${longDateTR(f.date)} · ${byLine(meta.by, meta.countedBy)}`];
  const zMeta = [f.zNo ? `Z no: ${f.zNo}` : null, f.receipts ? `${f.receipts} fiş` : null].filter(Boolean).join(" · ");
  if (zMeta) head.push(zMeta);
  const photos = photosLine(meta.photos);
  if (photos) head.push(photos);
  if (meta.photoDiffs?.length) head.push(`⚠️ Fotoğraftan farklı yazılan: ${meta.photoDiffs.map((d) => diffLine(d, audience)).join("; ")}`);
  // LafPOS'un gün sonundan farklı yazılan (E-09): yalnız formun rakamları (personel de yazdı), her iki metinde
  const lafposLine = lafposDiffsLine(meta.lafposDiffs ?? []);
  if (lafposLine) head.push(`⚠️ ${lafposLine}`);
  if (meta.revision && meta.revision > 1 && meta.changes?.length) head.push(`*Değişen:* ${changesLine(meta.changes, audience)}`);
  const outs = cashOutLines(meta.cashOuts);
  const z = [`*${zSectionTitle(meta.kasa)}*`, `Toplam satış: ${money(f.zTotal)}`, ...paymentLines(f).map((p) => `• ${p.label}: ${money(p.amount)}`)];
  if (f.discounts) z.push(`• İndirim: ${money(f.discounts)}`);
  if (f.offRevenue) z.push(`• Ödenmez / ikram (ciro dışı): ${money(f.offRevenue)}`);
  if (Math.abs(c.paymentsDiff) >= CASH_TOLERANCE) z.push(`⚠️ Ödeme türleri toplamı (${money(c.paymentsTotal)}) Z toplamından ${money(Math.abs(c.paymentsDiff))} ${c.paymentsDiff > 0 ? "fazla" : "az"}`);
  const mark = c.kind === "short" ? "🔴" : c.kind === "over" ? "🟠" : "✅";
  const kasa = [
    "*Kasa (nakit)*",
    `Açılış (devir): ${money(f.openingCash)}`,
    ...(meta.carry ? [`⚠️ ${carryWarning(meta.carry)}`] : []),
    `+ Nakit satış: ${money(f.cash)}`,
    ...(f.cashIn ? [`+ Gün içinde giren: ${money(f.cashIn)}`] : []),
    ...(f.cashOut || outs.length ? [`− Gün içinde çıkan: ${money(f.cashOut)}${f.cashOutNote ? ` (${f.cashOutNote})` : ""}`, ...outs.map((l) => `  · ${l}`)] : []),
    `= Olması gereken: ${money(c.expectedCash)}`,
    `Sayılan: ${money(f.countedCash)}`,
    `${mark} *${c.kind === "even" ? "Kasa tutuyor" : diffText(c.cashDiff).toLocaleUpperCase("tr")}*`,
    ...(f.handedOver ? [`Teslim edilen: ${money(f.handedOver)} · Ertesi güne devir: ${money(c.carryOver)}`] : [`Ertesi güne devir: ${money(c.carryOver)}`]),
    ...(meta.next ? [`⚠️ ${nextWarning(meta.next)}`] : []),
  ];
  const kart = okcTextBlock(f, audience, meta.kasa);
  const waste = meta.waste?.ikram || meta.waste?.zayi ? ["*Zayi & ikram*", ...(meta.waste.ikram ? [`İkram: ${meta.waste.ikram}`] : []), ...(meta.waste.zayi ? [`Zayi: ${meta.waste.zayi}`] : [])] : [];
  const blocks = [head, z, kasa, kart, waste, f.note ? [`Not: ${f.note}`] : []].filter((b) => b.length);
  return blocks.map((b) => b.join("\n")).join("\n\n");
}

/**
 * Kasa e-postasının Resend anahtarı (Idempotency-Key; denetim E-40): rapor satırına ve sürümüne özgü, `cash-{id}-r{sürüm}`.
 * Aynı sürüm iki kez gitmez ("Yeniden dene" aynı anahtarla); silinip aynı gün yeniden girilen rapor yeni satırdır, sürümü
 * yine 1'den başlar ama anahtarı silinenden farklıdır. Resend anahtarı 24 saat tutar: güne göre anahtar
 * (`cash-{gün}-r{sürüm}`) silinip yeniden girilen günün e-postasını göndermezdi (aynı gövde: eski sonuç; farklı gövde:
 * 409). İşlem geçmişinin anahtarı (`notification_log`, `cash:{gün}:r{sürüm}`) güne göre kalır: son gönderimin kaydı.
 */
export function cashEmailKey(row: { id: number; revision: number }): string {
  return `cash-${row.id}-r${row.revision}`;
}

/**
 * Kasa raporunun numarası (sahibin kararı, 4 Kasım 2026): iş gününden, "KR-20261103". Gün başına tek rapor olduğu için
 * (cash_reports_date_uq) benzersizdir; silinip yeniden girilen ya da geç girilen rapor da aynı numarayı alır, sıra
 * kaymaz. Panel, e-posta ve WhatsApp aynı numarayı yazar
 */
export function reportNo(date: string): string {
  return `KR-${date.replaceAll("-", "")}`;
}

/** E-posta konusu: "Kasa raporu KR-20261021 · 21 Ekim Salı · 120 ₺ eksik" */
export function reportSubject(f: CashReportFields, revision = 1): string {
  return `Kasa raporu ${reportNo(f.date)} · ${longDateTR(f.date)} · ${diffText(computeCash(f).cashDiff).replace("Kasa tutuyor", "kasa tutuyor")}${revision > 1 ? " (güncellendi)" : ""}`;
}

/** E-posta adresleri: virgül, noktalı virgül, boşluk ya da satırla ayrılmış metinden; tekrarlar ve geçersizler çıkar */
export function parseEmails(raw: string): { valid: string[]; invalid: string[] } {
  const parts = raw
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLocaleLowerCase("en"))
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p) || p.length > 254) invalid.push(p);
    else if (!valid.includes(p)) valid.push(p);
  }
  return { valid, invalid };
}

/**
 * Yönetici alıcıları hiç kaydetmediyse kasa raporunun gittiği adresler: ortamdaki `CASH_REPORT_RECIPIENTS` (virgül,
 * noktalı virgül ya da satırla ayrılmış; Vercel'de canlı ortamda). Adresler kodda durmaz: yerel bir kurulum gerçek
 * kişilere rapor göndermesin. Tanımlı değilse liste boştur ve rapor e-postasız kaydedilir.
 */
export function defaultCashRecipients(env: Record<string, string | undefined>): string[] {
  return parseEmails(env.CASH_REPORT_RECIPIENTS ?? "").valid;
}
