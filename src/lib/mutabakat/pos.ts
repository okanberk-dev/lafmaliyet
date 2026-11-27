/**
 * Banka POS hakediş mutabakatı (saf; tests/mutabakat.test.ts, docs/MUTABAKAT.md): kasa raporlarındaki kart satışı
 * (gün gün, şube şube) ile banka ekstresindeki POS girişleri. Beklenen net = kart satışı × (1 − şubenin POS komisyon
 * oranı); valör günü = satış günü + bloke günü (hafta sonuna denk gelirse pazartesi). Karşılaştırma valör gününe göre:
 * o gün bankaya giren POS tutarı (komisyon ayrı kesiliyorsa kesinti düşülmüş). Yemek kartı ve platform hakedişi başka
 * ekranda (docs/KOMISYON.md): onlar aylık ve fatura üzerinden izlenir.
 */
import { addDays, daysBetween } from "../reminders";

export interface PosSaleDay {
  /** Kasanın iş günü */
  date: string;
  branchId: string;
  /** Kart satışı (KDV dahil, brüt) */
  card: number;
  /** Tutarın kaynağı: banka gün sonu fişi ya da Z'nin kart satırı */
  source: "banka-fisi" | "z";
}

export interface PosSettings {
  /** Bloke günü: satıştan kaç gün sonra hesaba geçer (0 = aynı gün, 1 = ertesi gün) */
  blockDays: number;
  /** Şubenin banka POS komisyon oranı (0,02 = %2; branches.pos_rate) */
  rates: Readonly<Record<string, number>>;
  /**
   * Günün oranı (Şubeler › POS oranı "şu aydan itibaren", docs/AYARLAR.md): verilirse `rates`'in yerine; null dönerse
   * `rates`
   */
  rateAt?: (branchId: string, date: string) => number | null;
  defaultRate: number;
}

export const DEFAULT_BLOCK_DAYS = 1;
export const BLOCK_DAYS_MAX = 60;

export function blockDaysError(v: number): string | null {
  if (!Number.isInteger(v)) return "Bloke gününü tam sayı yazın";
  if (v < 0) return "Bloke günü eksi olamaz";
  if (v > BLOCK_DAYS_MAX) return `Bloke günü en çok ${BLOCK_DAYS_MAX}`;
  return null;
}

export interface PosInflow {
  date: string;
  /** + giren hakediş; − ayrı kesilen komisyon, iade */
  amount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * Valör günü: satış günü + bloke günü; cumartesi ya da pazara denk gelirse pazartesi (bankalar hafta sonu ödeme
 * yapmaz). Resmi tatiller bilinmez: tatil sonrasına kayan ödeme "geç geldi" görünür.
 */
export function settlementDay(saleDay: string, blockDays: number): string {
  let d = addDays(saleDay, blockDays);
  const w = weekdayOf(d);
  if (w === 6) d = addDays(d, 2);
  else if (w === 0) d = addDays(d, 1);
  return d;
}

export type PosStatus = "tamam" | "fark" | "gecikti" | "gec-geldi" | "bekleniyor" | "beklenmeyen";

export const POS_STATUS_LABEL: Record<PosStatus, string> = {
  tamam: "Tamam",
  fark: "Fark var",
  gecikti: "Gecikti",
  "gec-geldi": "Geç geldi",
  bekleniyor: "Ekstre bekleniyor",
  beklenmeyen: "Beklenmeyen giriş",
};

export interface PosSale extends PosSaleDay {
  rate: number;
  net: number;
}

export interface PosRow {
  /** Valör günü (beklenmeyen girişte paranın geldiği gün) */
  due: string;
  sales: PosSale[];
  gross: number;
  /** Beklenen net */
  expected: number;
  /** Bankaya gelen (kesinti düşülmüş) */
  received: number;
  /** Gelen − beklenen */
  diff: number;
  status: PosStatus;
  /** Paranın geldiği gün (valörden farklıysa) */
  receivedOn: string | null;
  /** Gecikme (gün): gecikti = ekstrenin son gününe kadar gelmedi; geç geldi = valörden kaç gün sonra */
  lateDays: number;
}

export interface PosTotals {
  gross: number;
  expected: number;
  received: number;
  diff: number;
  /** Geciken (ekstrede görünmeyen) beklenen net ve valör günü sayısı */
  lateAmount: number;
  lateCount: number;
  /** Ekstrenin henüz kapsamadığı beklenen net */
  waitingAmount: number;
  /** Gerçekleşen kesinti oranı: parası gelen günlerde 1 − gelen ÷ brüt; hesaplanamıyorsa null */
  effectiveRate: number | null;
}

/** Beklenenle gelen arasında "tamam" sayılan fark: 1 ₺ ya da beklenenin binde 5'i (kuruş yuvarlaması, küçük oran farkı) */
export const posTolerance = (expected: number) => Math.max(1, Math.abs(expected) * 0.005);
/** Geç gelen ödeme valörden en çok bu kadar gün sonra aranır */
export const POS_LATE_SEARCH_DAYS = 5;

export interface PosInput {
  days: readonly PosSaleDay[];
  inflows: readonly PosInflow[];
  settings: PosSettings;
  /** Banka ekstrelerinin kapsadığı günler (ilk ve son hareket); ekstre yoksa null */
  coverage: { from: string; to: string } | null;
  today: string;
}

/**
 * Valör gününe göre satırlar (eski gün önce) ve dönemin toplamı. Ekstrenin kapsadığı günlerden önceki valörler
 * çıkarılır (parası ekstreden önce gelmiştir, bilinemez); sonraki valörler "ekstre bekleniyor" (toplama girmez).
 */
export function posReconciliation(input: PosInput): { rows: PosRow[]; totals: PosTotals } {
  const { coverage, settings, today } = input;
  const byDue = new Map<string, PosRow>();
  for (const d of input.days) {
    if (!(d.card > 0)) continue;
    const due = settlementDay(d.date, settings.blockDays);
    if (due > today) continue;
    if (coverage && due < coverage.from) continue;
    const rate = settings.rateAt?.(d.branchId, d.date) ?? settings.rates[d.branchId] ?? settings.defaultRate;
    const net = r2(d.card * (1 - rate));
    let row = byDue.get(due);
    if (!row) {
      row = { due, sales: [], gross: 0, expected: 0, received: 0, diff: 0, status: "bekleniyor", receivedOn: null, lateDays: 0 };
      byDue.set(due, row);
    }
    row.sales.push({ ...d, rate, net });
    row.gross = r2(row.gross + d.card);
    row.expected = r2(row.expected + net);
  }
  const inflow = new Map<string, number>();
  for (const i of input.inflows) inflow.set(i.date, r2((inflow.get(i.date) ?? 0) + i.amount));
  const usedDates = new Set<string>();
  const rows = [...byDue.values()].sort((a, b) => a.due.localeCompare(b.due));
  const covered = (row: PosRow) => coverage !== null && row.due <= coverage.to;

  // 1. Valör gününde gelen
  for (const row of rows) {
    if (!covered(row)) continue;
    const got = inflow.get(row.due);
    if (got === undefined) continue;
    row.received = got;
    usedDates.add(row.due);
  }
  // 2. Gelmeyen gün: sonraki günlerde, beklenene eşit, başka valöre denk gelmeyen giriş (tatil, bankanın gecikmesi)
  for (const row of rows) {
    if (!covered(row) || usedDates.has(row.due)) continue;
    for (let k = 1; k <= POS_LATE_SEARCH_DAYS; k++) {
      const day = addDays(row.due, k);
      const got = inflow.get(day);
      if (got === undefined || usedDates.has(day) || byDue.has(day)) continue;
      if (Math.abs(got - row.expected) > posTolerance(row.expected)) continue;
      row.received = got;
      row.receivedOn = day;
      row.lateDays = k;
      usedDates.add(day);
      break;
    }
  }
  for (const row of rows) {
    row.sales.sort((a, b) => a.date.localeCompare(b.date) || a.branchId.localeCompare(b.branchId));
    row.diff = r2(row.received - row.expected);
    if (!covered(row)) {
      row.status = "bekleniyor";
      row.diff = 0;
    } else if (row.receivedOn) row.status = "gec-geldi";
    else if (Math.abs(row.diff) <= posTolerance(row.expected)) row.status = "tamam";
    else if (Math.abs(row.received) < 0.005) {
      row.lateDays = daysBetween(row.due, coverage!.to);
      // Ekstrenin son günü: ekstre gün içinde indirildiyse para henüz düşmemiş olabilir
      row.status = row.lateDays >= 1 ? "gecikti" : "bekleniyor";
      if (row.status === "bekleniyor") row.diff = 0;
    } else row.status = "fark";
  }
  // 3. Hiçbir valöre denk gelmeyen giriş
  for (const [day, got] of inflow) {
    if (usedDates.has(day) || Math.abs(got) < 0.005) continue;
    rows.push({ due: day, sales: [], gross: 0, expected: 0, received: got, diff: got, status: "beklenmeyen", receivedOn: null, lateDays: 0 });
  }
  rows.sort((a, b) => a.due.localeCompare(b.due));

  const totals: PosTotals = { gross: 0, expected: 0, received: 0, diff: 0, lateAmount: 0, lateCount: 0, waitingAmount: 0, effectiveRate: null };
  let paidGross = 0;
  let paidReceived = 0;
  for (const row of rows) {
    if (row.status === "bekleniyor") {
      totals.waitingAmount = r2(totals.waitingAmount + row.expected);
      continue;
    }
    totals.gross = r2(totals.gross + row.gross);
    totals.expected = r2(totals.expected + row.expected);
    totals.received = r2(totals.received + row.received);
    if (row.status === "gecikti") {
      totals.lateAmount = r2(totals.lateAmount + row.expected);
      totals.lateCount++;
    } else if (row.gross > 0 && row.received > 0) {
      paidGross += row.gross;
      paidReceived += row.received;
    }
  }
  totals.diff = r2(totals.received - totals.expected);
  totals.effectiveRate = paidGross > 0 ? Math.round((1 - paidReceived / paidGross) * 10000) / 10000 : null;
  return { rows, totals };
}

/** Kasa raporundan günün kart satışı: banka gün sonu fişi yazıldıysa o (POS cihazından geçen), yoksa Z'nin kart satırı */
export function posCardOf(report: { card: number; bankPos: number | null }): { card: number; source: PosSaleDay["source"] } {
  return report.bankPos !== null && report.bankPos > 0 ? { card: r2(report.bankPos), source: "banka-fisi" } : { card: r2(report.card), source: "z" };
}

/** Kasa raporlarının okunacağı ilk gün: ekstrenin ilk valörüne denk gelebilecek en eski satış günü */
export const posSalesFrom = (coverageFrom: string, blockDays: number) => addDays(coverageFrom, -(blockDays + 3));
