/**
 * Dönem kapanışının saf kuralları (docs/DONEM-KAPANISI.md): hangi ay kapanabilir, kapanmış aya sonradan gelen kayıt
 * hesaplarda nerede sayılır, kapanıştaki sağlama bugünküyle tutuyor mu. Veritabanı yok; hem sunucu hem tarayıcı
 * kullanır, tests/donem-kapanisi.test.ts sınar.
 *
 * Kural (en tutucusu): ay kapandıktan SONRA açılan ve tarihi o aya düşen fatura ya da harcama reddedilmez ama hesaplara
 * girmez ("Kapalı döneme düşenler" kutusu). Yönetici karar verir: "Bu aya al" (kayıt karar gününün ayında sayılır,
 * belgenin tarihi değişmez) ya da "Kapalı aya işle" (kapalı ayın rakamı bilerek değişir). Ay yeniden açılırsa bekleyen
 * kayıtlar kendiliğinden o aya girer.
 */

/** integration_state anahtarı */
export const CLOSED_PERIODS_KEY = "donem.kapali";

/** Kapanış anındaki sağlama: ayın fatura ve harcama sayısı ile toplamı (kuruşa yuvarlı) */
export interface PeriodCheck {
  invoices: number;
  invoiceTotal: number;
  expenses: number;
  expenseTotal: number;
}

export interface ClosedPeriod {
  /** Kapanış anı (ISO) */
  at: string;
  /** Kapatan yöneticinin adı */
  by: string;
  check?: PeriodCheck;
}

/** Ay (YYYY-MM) → kapanış */
export interface ClosedPeriods {
  months: Record<string, ClosedPeriod>;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isMonthKey = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);
export const isDayKey = (v: unknown): v is string => typeof v === "string" && DAY.test(v);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Kayıtlı değer; bozuk ay atlanır, hiç yoksa boş */
export function parseClosedPeriods(v: unknown): ClosedPeriods {
  const months: ClosedPeriods["months"] = {};
  const raw = (v as { months?: unknown } | null | undefined)?.months;
  if (!raw || typeof raw !== "object") return { months };
  for (const [month, value] of Object.entries(raw as Record<string, unknown>)) {
    const x = value as Partial<ClosedPeriod> | null;
    if (!isMonthKey(month) || !x || typeof x !== "object" || typeof x.at !== "string" || Number.isNaN(Date.parse(x.at))) continue;
    const c = x.check as Partial<PeriodCheck> | undefined;
    months[month] = {
      at: x.at,
      by: typeof x.by === "string" && x.by.trim() ? x.by : "Yönetici",
      ...(c && typeof c === "object" ? { check: { invoices: num(c.invoices), invoiceTotal: num(c.invoiceTotal), expenses: num(c.expenses), expenseTotal: num(c.expenseTotal) } } : {}),
    };
  }
  return { months };
}

/** Kapalı aylar, yeniden eskiye */
export function closedMonths(p: ClosedPeriods): string[] {
  return Object.keys(p.months).sort().reverse();
}

const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
/** "2026-10" → "Ekim 2026" */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1] ?? month} ${y}`;
}

/** Bir önceki ay ("2026-01" → "2025-12") */
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Ayın son günü (YYYY-MM-DD) */
export function monthLastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Ay kapanabilir mi: yalnız bitmiş ay (bugünün ayı ve sonrası kapanmaz: içinde daha kayıt açılacak). Kapanamıyorsa
 * nedeni, kapanabiliyorsa null. `today`: iş günü (YYYY-MM-DD).
 */
export function closeRefusal(month: string, today: string, p: ClosedPeriods): string | null {
  if (!isMonthKey(month)) return "Ay seçin";
  if (month >= today.slice(0, 7)) return `${monthTitle(month)} daha bitmedi; yalnız bitmiş ay kapanır`;
  if (p.months[month]) return `${monthTitle(month)} zaten kapalı`;
  return null;
}

/** Kapatılabilecek aylar: bugünün ayından önceki son `count` ay, kapalı olmayanlar (yeniden eskiye) */
export function closableMonths(today: string, p: ClosedPeriods, count = 12): string[] {
  const out: string[] = [];
  let m = prevMonth(today.slice(0, 7));
  for (let i = 0; i < count; i++) {
    if (!p.months[m]) out.push(m);
    m = prevMonth(m);
  }
  return out;
}

/** Kaydın kapalı dönemle ilgisi */
export type PeriodState =
  /** Dönemle işi yok: ayı açık ya da kayıt kapanıştan önce açılmış */
  | { kind: "normal" }
  /** Kapalı aya kapanıştan sonra düştü, karar bekliyor: hesaplara girmez */
  | { kind: "held"; month: string }
  /** Yönetici kapalı aya işledi: kendi tarihinde sayılır */
  | { kind: "accepted"; month: string }
  /** Yönetici açık aya aldı: `on` gününde sayılır */
  | { kind: "moved"; month: string; on: string };

export interface PeriodRecord {
  /** Belgenin tarihi (YYYY-MM-DD) */
  date: string;
  /** Kaydın panelde açıldığı an */
  createdAt: Date | string;
  /** Yöneticinin kararı (YYYY-MM-DD) ya da boş */
  periodDate: string | null;
}

export function periodStateOf(r: PeriodRecord, p: ClosedPeriods): PeriodState {
  const month = r.date.slice(0, 7);
  if (r.periodDate && isDayKey(r.periodDate)) return r.periodDate === r.date ? { kind: "accepted", month } : { kind: "moved", month, on: r.periodDate };
  const closed = p.months[month];
  if (!closed) return { kind: "normal" };
  const created = typeof r.createdAt === "string" ? Date.parse(r.createdAt) : r.createdAt.getTime();
  // Kapanış anında ve öncesinde açılan kayıt ayın rakamındadır; okunamayan an tutucu sayılır (bekler)
  return created <= Date.parse(closed.at) ? { kind: "normal" } : { kind: "held", month };
}

/** Kaydın hesaplarda sayıldığı gün; bekleyen kayıtta null (hiçbir hesaba girmez) */
export function accountDate(r: PeriodRecord, p: ClosedPeriods): string | null {
  const st = periodStateOf(r, p);
  if (st.kind === "held") return null;
  return st.kind === "moved" ? st.on : r.date;
}

/**
 * Elle düzeltme ve silme kilidi: kaydın sayıldığı gün (ya da taşınacağı yeni gün) kapalı aydaysa nedeni. Bekleyen kayıt
 * kilitli değildir (hesapta yok; düzeltilebilir, silinebilir). `dates`: kaydın bugünkü hesap günü ve varsa yeni günü.
 */
export function lockRefusal(dates: readonly (string | null | undefined)[], p: ClosedPeriods): string | null {
  for (const d of dates) {
    if (!d) continue;
    const month = d.slice(0, 7);
    if (p.months[month]) return `${monthTitle(month)} dönemi kapalı; bu ayın kayıtları değiştirilemez. Değiştirmek için Ayarlar › Dönem kapanışı'ndan dönemi açın.`;
  }
  return null;
}

const tl = (v: number) => `${v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
export const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Kapanıştaki sağlama bugünküyle tutmuyorsa ne değişti (tek cümle); tutuyorsa null. Kilidin yakalayamadığı yolları
 * (Paraşüt'te sonradan değişen ya da iptal edilen fatura, eski kayıtta tarih değişikliği) görünür kılar.
 */
export function checkDrift(saved: PeriodCheck | undefined, now: PeriodCheck): string | null {
  if (!saved) return null;
  const parts: string[] = [];
  if (saved.invoices !== now.invoices || Math.abs(saved.invoiceTotal - now.invoiceTotal) >= 0.01)
    parts.push(`faturalar ${saved.invoices} adet ${tl(saved.invoiceTotal)} idi, şimdi ${now.invoices} adet ${tl(now.invoiceTotal)}`);
  if (saved.expenses !== now.expenses || Math.abs(saved.expenseTotal - now.expenseTotal) >= 0.01)
    parts.push(`harcamalar ${saved.expenses} adet ${tl(saved.expenseTotal)} idi, şimdi ${now.expenses} adet ${tl(now.expenseTotal)}`);
  return parts.length ? `Kapanıştan sonra değişti: ${parts.join("; ")}.` : null;
}

/** Bekleyen kayıtların zildeki ve kutudaki tek satırı */
export function heldSummary(n: { invoices: number; expenses: number }): string | null {
  const parts = [n.invoices ? `${n.invoices} fatura` : null, n.expenses ? `${n.expenses} harcama` : null].filter(Boolean);
  return parts.length ? `${parts.join(" ve ")} kapalı döneme düştü; hesaplara girmedi, kararınızı bekliyor.` : null;
}
