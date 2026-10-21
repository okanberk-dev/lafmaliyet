import { money } from "./format";
import { addDays, longDateTR, todayTR } from "./reminders";

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
 * WhatsApp'a yapıştırılacak ayrıntılı rapor (WhatsApp *kalın* yazar). Kasa farkı, kart farkı ve Z toplamının ödeme
 * türleriyle tutmaması öne çıkarılır.
 */
export function whatsappText(f: CashReportFields, meta: { by: string; revision?: number; waste?: DayWaste | null }): string {
  const c = computeCash(f);
  const head = [`*L'Affogato · Gün sonu kasa raporu*${meta.revision && meta.revision > 1 ? " (güncellendi)" : ""}`, `${longDateTR(f.date)} · ${meta.by}`];
  const zMeta = [f.zNo ? `Z no: ${f.zNo}` : null, f.receipts ? `${f.receipts} fiş` : null].filter(Boolean).join(" · ");
  if (zMeta) head.push(zMeta);
  const z = ["*Z raporu (ModPOS)*", `Toplam satış: ${money(f.zTotal)}`, ...paymentLines(f).map((p) => `• ${p.label}: ${money(p.amount)}`)];
  if (f.offRevenue) z.push(`• Ödenmez / ikram (ciro dışı): ${money(f.offRevenue)}`);
  if (Math.abs(c.paymentsDiff) >= CASH_TOLERANCE) z.push(`⚠️ Ödeme türleri toplamı (${money(c.paymentsTotal)}) Z toplamından ${money(Math.abs(c.paymentsDiff))} ${c.paymentsDiff > 0 ? "fazla" : "az"}`);
  const mark = c.kind === "short" ? "🔴" : c.kind === "over" ? "🟠" : "✅";
  const kasa = [
    "*Kasa (nakit)*",
    `Açılış (devir): ${money(f.openingCash)}`,
    `+ Nakit satış: ${money(f.cash)}`,
    ...(f.cashOut ? [`− Gün içinde çıkan: ${money(f.cashOut)}${f.cashOutNote ? ` (${f.cashOutNote})` : ""}`] : []),
    `= Olması gereken: ${money(c.expectedCash)}`,
    `Sayılan: ${money(f.countedCash)}`,
    `${mark} *${c.kind === "even" ? "Kasa tutuyor" : diffText(c.cashDiff).toLocaleUpperCase("tr")}*`,
    ...(f.handedOver ? [`Teslim edilen: ${money(f.handedOver)} · Ertesi güne devir: ${money(c.carryOver)}`] : [`Ertesi güne devir: ${money(c.carryOver)}`]),
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
