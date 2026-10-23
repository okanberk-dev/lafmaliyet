import { CASH_OUT_LINES_SHOWN, cashOutShortLine, type CashOutLine } from "./cash-outs";
import { money } from "./format";
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
  /** Kasa: açılış (dünden devir), gün içinde çıkan, akşam sayılan, sayımdan sonra teslim edilen */
  openingCash: number;
  cashOut: number;
  cashOutNote: string | null;
  countedCash: number;
  handedOver: number;
  /** Banka POS cihazının gün sonu toplamı; girilmediyse kart karşılaştırılmaz */
  bankPos: number | null;
  /** Z raporundaki ödenmez / ikram tutarı (ciroya girmez); girilmediyse null */
  offRevenue: number | null;
  /**
   * Z raporundaki indirim toplamı (isteğe bağlı); girilmediyse null: ayın indirimine yalnız girilen günler gider.
   * Alan sonradan geldi: eski kopyalarda ve elle kurulan raporlarda olmayabilir (boş sayılır)
   */
  discounts?: number | null;
  note: string | null;
}

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
  /** Açılış + nakit satış − gün içinde çıkan */
  expectedCash: number;
  /** Sayılan − olması gereken: eksi eksik, artı fazla */
  cashDiff: number;
  kind: DiffKind;
  /** Sayılan − teslim edilen: ertesi günün açılışı */
  carryOver: number;
  /** Banka POS − ModPOS kart (girilmediyse null) */
  cardDiff: number | null;
}

export function computeCash(f: Pick<CashReportFields, "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "openingCash" | "cashOut" | "countedCash" | "handedOver" | "bankPos">): CashResult {
  const paymentsTotal = r2(f.cash + f.card + f.mealCard + f.online + f.other);
  const expectedCash = r2(f.openingCash + f.cash - f.cashOut);
  const cashDiff = r2(f.countedCash - expectedCash);
  return {
    paymentsTotal,
    paymentsDiff: r2(paymentsTotal - f.zTotal),
    expectedCash,
    cashDiff,
    kind: diffKind(cashDiff),
    carryOver: r2(f.countedCash - f.handedOver),
    cardDiff: f.bankPos === null ? null : r2(f.bankPos - f.card),
  };
}

/**
 * Formdaki iş günü: gece 05:00'ten önce kapatılan gün bir önceki güne yazılır (kafe gece yarısından sonra kapanabilir).
 * Türkiye saatiyle.
 */
export function businessDate(now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(now));
  const today = todayTR(now);
  return hour < 5 ? addDays(today, -1) : today;
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

/** Değişiklik listesindeki adlar ve sıra: önce kasa (nakit), sonra Z raporu, kart ve notlar */
export const CHANGE_LABELS: Record<ChangeKey, string> = {
  openingCash: "Açılış",
  cash: "Nakit satış",
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
  bankPos: "Banka POS",
  zNo: "Z no",
  receipts: "Fiş sayısı",
  cashOutNote: "Neye çıktı",
  note: "Not",
  countedByName: "Sayan",
};

/** Kasadaki nakdi değiştiren alanlar: bunlar iş günü kapandıktan sonra değişirse yönetici uyarılır */
export const SENSITIVE: readonly ChangeKey[] = ["openingCash", "cash", "cashOut", "countedCash", "handedOver"];

const TEXT_FIELDS: readonly ChangeKey[] = ["cashOutNote", "note"];
const PLAIN_FIELDS: readonly ChangeKey[] = ["zNo", "receipts", "countedByName"];

export interface FieldChange {
  key: ChangeKey;
  label: string;
  /** Önceki ve yeni değer (metin alanında boş: yalnız "değişti" yazılır) */
  from: string;
  to: string;
  sensitive: boolean;
}

/** Eksik alan (eski bir kopyada olmayan) boş sayılır */
const valueOf = (d: Partial<CashRevisionData>, k: ChangeKey) => d[k] ?? null;

/**
 * İki sürüm arasındaki değişiklikler. Tutarlar 0,005 hassasiyetle, boş "—"; metin alanı (not, neye çıktı) içeriği
 * yazılmadan "Not değişti". Değişiklik yoksa boş liste.
 */
export function revisionChanges(before: Partial<CashRevisionData>, after: Partial<CashRevisionData>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const key of Object.keys(CHANGE_LABELS) as ChangeKey[]) {
    const a = valueOf(before, key);
    const b = valueOf(after, key);
    const text = TEXT_FIELDS.includes(key) || PLAIN_FIELDS.includes(key);
    const same = text
      ? String(a ?? "").trim() === String(b ?? "").trim()
      : (a === null && b === null) || (a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.005);
    if (same) continue;
    const shown = (v: string | number | null) => (v === null || v === "" ? "—" : PLAIN_FIELDS.includes(key) ? String(v) : money(Number(v)));
    const quiet = TEXT_FIELDS.includes(key);
    out.push({ key, label: CHANGE_LABELS[key], from: quiet ? "" : shown(a), to: quiet ? "" : shown(b), sensitive: SENSITIVE.includes(key) });
  }
  return out;
}

/** "Sayılan nakit: 2.880 ₺ → 2.980 ₺", metin alanında "Not değişti" (`colon: false`: iki noktasız, satır içi) */
export function changeLine(c: FieldChange, colon = true): string {
  if (TEXT_FIELDS.includes(c.key)) return `${c.label} değişti`;
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

/** Bir sürümün kopyası (kayıtlı rapor satırından ya da rapor DTO'sundan) */
export function revisionDataOf(r: CashReportFields & { cashDiff: number; countedByName: string | null }): CashRevisionData {
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
    cashOut: r.cashOut,
    cashOutNote: r.cashOutNote,
    countedCash: r.countedCash,
    handedOver: r.handedOver,
    bankPos: r.bankPos,
    offRevenue: r.offRevenue,
    discounts: r.discounts,
    note: r.note,
    cashDiff: r.cashDiff,
    countedByName: r.countedByName,
  };
}

/** Kayıtlı önceki sürüm (cash_report_revisions satırı) */
export interface CashRevisionRow {
  revision: number;
  data: CashRevisionData;
  submittedByName: string;
  /** O sürümün gönderildiği an (ISO) */
  submittedAt: string;
}

export interface RevisionEntry {
  /** Bu gönderimle gelen sürüm */
  revision: number;
  /** Gönderim anı (ISO) ve gönderen */
  at: string;
  by: string;
  changes: FieldChange[];
  /** İş günü kapandıktan sonra ve kasa alanı değişti */
  late: boolean;
}

/**
 * Raporun düzeltme geçmişi, en yeni önce: kayıtlı sürümler sırayla birbiriyle, sonuncusu raporun şimdiki hâliyle
 * karşılaştırılır. `first`: ilk gönderim (raporun açıldığı an; gönderen yalnız 1. sürümün kopyası varsa bilinir).
 * Bu özellikten önceki raporların geçmişi ilk düzeltmeden sonra başlar.
 */
export function historyOf(
  report: CashReportFields & { revision: number; cashDiff: number; countedByName: string | null; submittedByName: string; createdAt: string; updatedAt: string },
  revisions: CashRevisionRow[],
): { entries: RevisionEntry[]; first: { at: string; by: string | null } } {
  const snaps = [...revisions].filter((r) => r.revision < report.revision).sort((a, b) => a.revision - b.revision);
  const versions = [
    ...snaps.map((s) => ({ revision: s.revision, data: s.data, at: s.submittedAt, by: s.submittedByName })),
    { revision: report.revision, data: revisionDataOf(report), at: report.updatedAt, by: report.submittedByName },
  ];
  const entries: RevisionEntry[] = [];
  for (let i = 1; i < versions.length; i++) {
    const v = versions[i];
    const changes = revisionChanges(versions[i - 1].data, v.data);
    entries.push({ revision: v.revision, at: v.at, by: v.by, changes, late: isLateEdit(report.date, new Date(v.at)) && changes.some((c) => c.sensitive) });
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
  r: CashReportFields & { revision: number; cashDiff: number; countedByName: string | null; updatedAt: string },
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

/** Son düzeltme (şimdiki sürüm ile bir önceki kopya): ertesi gün kasa alanı değiştiyse yönetici uyarılır */
export function lastRevision(
  report: CashReportFields & { revision: number; cashDiff: number; countedByName: string | null; updatedAt: string },
  revisions: CashRevisionRow[],
): { changes: FieldChange[]; late: boolean } | null {
  const prev = revisions.find((r) => r.revision === report.revision - 1);
  if (!prev) return null;
  const changes = revisionChanges(prev.data, revisionDataOf(report));
  return { changes, late: isLateEdit(report.date, new Date(report.updatedAt)) && changes.some((c) => c.sensitive) };
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
  /** Rapora bağlı fotoğraflar */
  photos?: { z: boolean; pos: boolean } | null;
  /** Net okunmuş ama farklı yazılan alanlar (src/lib/photo-read/kasa.ts suspiciousDiffs) */
  photoDiffs?: PhotoDiff[] | null;
  /** Günün kasadan çıkan satırları */
  cashOuts?: (CashOutLine & { photo: boolean })[] | null;
}

/** "📷 Z ve POS fotoğrafı panelde" */
export function photosLine(p: CashReportExtras["photos"]): string | null {
  if (!p || (!p.z && !p.pos)) return null;
  return `📷 ${p.z && p.pos ? "Z ve POS" : p.z ? "Z" : "POS"} fotoğrafı panelde`;
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
 * WhatsApp'a yapıştırılacak ayrıntılı rapor (WhatsApp *kalın* yazar). Kasa farkı, kart farkı ve Z toplamının ödeme
 * türleriyle tutmaması öne çıkarılır.
 */
export function whatsappText(f: CashReportFields, meta: { by: string; revision?: number; waste?: DayWaste | null } & CashReportExtras & CashReportIntegrity): string {
  const c = computeCash(f);
  const head = [`*L'Affogato · Gün sonu kasa raporu*${meta.revision && meta.revision > 1 ? " (güncellendi)" : ""}`, `${longDateTR(f.date)} · ${byLine(meta.by, meta.countedBy)}`];
  const zMeta = [f.zNo ? `Z no: ${f.zNo}` : null, f.receipts ? `${f.receipts} fiş` : null].filter(Boolean).join(" · ");
  if (zMeta) head.push(zMeta);
  const photos = photosLine(meta.photos);
  if (photos) head.push(photos);
  if (meta.photoDiffs?.length) head.push(`⚠️ Fotoğraftan farklı yazılan: ${meta.photoDiffs.map((d) => photoDiffText(d, false)).join("; ")}`);
  if (meta.revision && meta.revision > 1 && meta.changes?.length) head.push(`*Değişen:* ${changesText(meta.changes)}`);
  const outs = cashOutLines(meta.cashOuts);
  const z = ["*Z raporu (ModPOS)*", `Toplam satış: ${money(f.zTotal)}`, ...paymentLines(f).map((p) => `• ${p.label}: ${money(p.amount)}`)];
  if (f.discounts) z.push(`• İndirim: ${money(f.discounts)}`);
  if (f.offRevenue) z.push(`• Ödenmez / ikram (ciro dışı): ${money(f.offRevenue)}`);
  if (Math.abs(c.paymentsDiff) >= CASH_TOLERANCE) z.push(`⚠️ Ödeme türleri toplamı (${money(c.paymentsTotal)}) Z toplamından ${money(Math.abs(c.paymentsDiff))} ${c.paymentsDiff > 0 ? "fazla" : "az"}`);
  const mark = c.kind === "short" ? "🔴" : c.kind === "over" ? "🟠" : "✅";
  const kasa = [
    "*Kasa (nakit)*",
    `Açılış (devir): ${money(f.openingCash)}`,
    ...(meta.carry ? [`⚠️ ${carryWarning(meta.carry)}`] : []),
    `+ Nakit satış: ${money(f.cash)}`,
    ...(f.cashOut || outs.length ? [`− Gün içinde çıkan: ${money(f.cashOut)}${f.cashOutNote ? ` (${f.cashOutNote})` : ""}`, ...outs.map((l) => `  · ${l}`)] : []),
    `= Olması gereken: ${money(c.expectedCash)}`,
    `Sayılan: ${money(f.countedCash)}`,
    `${mark} *${c.kind === "even" ? "Kasa tutuyor" : diffText(c.cashDiff).toLocaleUpperCase("tr")}*`,
    ...(f.handedOver ? [`Teslim edilen: ${money(f.handedOver)} · Ertesi güne devir: ${money(c.carryOver)}`] : [`Ertesi güne devir: ${money(c.carryOver)}`]),
    ...(meta.next ? [`⚠️ ${nextWarning(meta.next)}`] : []),
  ];
  const kart =
    c.cardDiff === null
      ? []
      : [
          "*Kart*",
          `Banka POS gün sonu: ${money(f.bankPos)} ${Math.abs(c.cardDiff) < CASH_TOLERANCE ? "✅ ModPOS ile aynı" : `⚠️ ModPOS'tan ${money(Math.abs(c.cardDiff))} ${c.cardDiff > 0 ? "fazla" : "az"}`}`,
        ];
  const waste = meta.waste?.ikram || meta.waste?.zayi ? ["*Zayi & ikram*", ...(meta.waste.ikram ? [`İkram: ${meta.waste.ikram}`] : []), ...(meta.waste.zayi ? [`Zayi: ${meta.waste.zayi}`] : [])] : [];
  const blocks = [head, z, kasa, kart, waste, f.note ? [`Not: ${f.note}`] : []].filter((b) => b.length);
  return blocks.map((b) => b.join("\n")).join("\n\n");
}

/** E-posta konusu: "Kasa raporu · 21 Ekim Salı · 120 ₺ eksik" */
export function reportSubject(f: CashReportFields, revision = 1): string {
  return `Kasa raporu · ${longDateTR(f.date)} · ${diffText(computeCash(f).cashDiff).replace("Kasa tutuyor", "kasa tutuyor")}${revision > 1 ? " (güncellendi)" : ""}`;
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
