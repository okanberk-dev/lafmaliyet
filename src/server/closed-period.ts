import "server-only";

import { and, eq, gte, isNotNull, isNull, lte, or, type AnyColumn } from "drizzle-orm";

import {
  accountDate,
  CLOSED_PERIODS_KEY,
  lockRefusal,
  monthLastDay,
  parseClosedPeriods,
  periodStateOf,
  round2,
  type ClosedPeriods,
  type PeriodCheck,
  type PeriodRecord,
} from "@/lib/closed-period";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

/*
 * Dönem kapanışının veritabanı tarafı (docs/DONEM-KAPANISI.md; kurallar src/lib/closed-period.ts): kapalı aylar
 * integration_state'te ("donem.kapali"), kararlar faturanın ve harcamanın `period_date` sütununda. Hesaplar kaydı
 * accountDate ile okur (src/server/data/dataset.ts); bekleyen kayıt hiçbir hesaba girmez.
 */

/** Okuma yapan her şey: veritabanı ya da açık bir işlem */
type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export async function loadClosedPeriods(db: Reader = getDb()): Promise<ClosedPeriods> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, CLOSED_PERIODS_KEY)).limit(1);
  return parseClosedPeriods(row?.value);
}

export async function saveClosedPeriods(db: Reader, value: ClosedPeriods): Promise<void> {
  await db
    .insert(s.integrationState)
    .values({ key: CLOSED_PERIODS_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/**
 * Elle düzeltme ve silme kilidi: kaydın sayıldığı gün ya da yeni günü kapalı aydaysa UserError. `rec` verilirse sayıldığı
 * gün ondan (birden çok kayıtta biri yeter; bekleyen kayıt kilitli değil), `dates` taşınacağı yeni günler.
 */
export async function assertPeriodOpen(db: Reader, rec: PeriodRecord | readonly PeriodRecord[] | null, dates: readonly (string | null | undefined)[] = []): Promise<void> {
  const p = await loadClosedPeriods(db);
  if (!Object.keys(p.months).length) return;
  const recs: readonly PeriodRecord[] = rec === null ? [] : Array.isArray(rec) ? rec : [rec as PeriodRecord];
  const refusal = lockRefusal([...recs.map((r) => accountDate(r, p)), ...dates], p);
  if (refusal) throw new UserError(refusal);
}

const monthRange = (month: string) => ({ from: `${month}-01`, to: monthLastDay(month) });

/**
 * Ayın sağlaması: hesapta o aya düşen faturalar (ödenecek toplamı) ve harcamalar. Belgenin tarihi ya da yöneticinin
 * kararı o aydaysa okunur, sayıldığı ay accountDate ile süzülür. Kapanışta saklanır, Ayarlar bugünküyle karşılaştırır.
 */
export async function periodCheckOf(db: Reader, month: string, p: ClosedPeriods): Promise<PeriodCheck> {
  const { from, to } = monthRange(month);
  const inMonth = (date: AnyColumn, periodDate: AnyColumn) => or(and(gte(date, from), lte(date, to)), and(gte(periodDate, from), lte(periodDate, to)));
  const [invoices, expenses] = await Promise.all([
    db
      .select({ date: s.invoices.date, createdAt: s.invoices.createdAt, periodDate: s.invoices.periodDate, payable: s.invoices.payable })
      .from(s.invoices)
      .where(inMonth(s.invoices.date, s.invoices.periodDate)),
    db
      .select({ date: s.expenseEntries.date, createdAt: s.expenseEntries.createdAt, periodDate: s.expenseEntries.periodDate, amount: s.expenseEntries.amount })
      .from(s.expenseEntries)
      .where(inMonth(s.expenseEntries.date, s.expenseEntries.periodDate)),
  ]);
  const counted = <T extends PeriodRecord>(rows: T[]) => rows.filter((r) => accountDate(r, p)?.slice(0, 7) === month);
  const inv = counted(invoices);
  const exp = counted(expenses);
  return {
    invoices: inv.length,
    invoiceTotal: round2(inv.reduce((a, r) => a + r.payable, 0)),
    expenses: exp.length,
    expenseTotal: round2(exp.reduce((a, r) => a + r.amount, 0)),
  };
}

/** Kapalı döneme düşen, karar bekleyen kayıt (Ayarlar › Dönem kapanışı kutusu) */
export interface HeldRecord {
  kind: "invoice" | "expense";
  id: number;
  date: string;
  month: string;
  /** Fatura: tedarikçi; harcama: kategori adı ve açıklama */
  title: string;
  detail: string | null;
  amount: number;
  createdAt: string;
  /** Paraşüt'ten mi, elle mi (faturada) */
  source: string | null;
}

/**
 * Bekleyen kayıtlar: kapalı aya tarihli, kapanıştan sonra açılmış, kararı olmayan faturalar ve harcamalar (eskiden
 * yeniye). Kapalı ay yoksa sorgu yok.
 */
export async function loadHeldRecords(db: Reader = getDb(), periods?: ClosedPeriods): Promise<HeldRecord[]> {
  const p = periods ?? (await loadClosedPeriods(db));
  const months = Object.keys(p.months).sort();
  if (!months.length) return [];
  const from = `${months[0]}-01`;
  const to = monthLastDay(months[months.length - 1]);
  const [invoices, expenses] = await Promise.all([
    db
      .select({
        id: s.invoices.id,
        date: s.invoices.date,
        createdAt: s.invoices.createdAt,
        periodDate: s.invoices.periodDate,
        supplier: s.invoices.supplier,
        invoiceNo: s.invoices.invoiceNo,
        payable: s.invoices.payable,
        source: s.invoices.source,
      })
      .from(s.invoices)
      .where(and(isNull(s.invoices.periodDate), gte(s.invoices.date, from), lte(s.invoices.date, to))),
    db
      .select({
        id: s.expenseEntries.id,
        date: s.expenseEntries.date,
        createdAt: s.expenseEntries.createdAt,
        periodDate: s.expenseEntries.periodDate,
        description: s.expenseEntries.description,
        amount: s.expenseEntries.amount,
        category: s.expenseCategories.name,
      })
      .from(s.expenseEntries)
      .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(and(isNull(s.expenseEntries.periodDate), gte(s.expenseEntries.date, from), lte(s.expenseEntries.date, to))),
  ]);
  const held = (r: PeriodRecord) => periodStateOf(r, p).kind === "held";
  const out: HeldRecord[] = [
    ...invoices.filter(held).map((r) => ({
      kind: "invoice" as const,
      id: r.id,
      date: r.date,
      month: r.date.slice(0, 7),
      title: r.supplier,
      detail: r.invoiceNo,
      amount: r.payable,
      createdAt: r.createdAt.toISOString(),
      source: r.source,
    })),
    ...expenses.filter(held).map((r) => ({
      kind: "expense" as const,
      id: r.id,
      date: r.date,
      month: r.date.slice(0, 7),
      title: r.category ?? "Harcama",
      detail: r.description,
      amount: r.amount,
      createdAt: r.createdAt.toISOString(),
      source: null,
    })),
  ];
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

/** Bekleyenlerin sayısı (zil, Bugün): kapalı ay yoksa sorgu yok */
export async function heldCounts(db: Reader = getDb()): Promise<{ invoices: number; expenses: number }> {
  const held = await loadHeldRecords(db);
  return { invoices: held.filter((h) => h.kind === "invoice").length, expenses: held.filter((h) => h.kind === "expense").length };
}

/**
 * Hesap günü kendi tarihinden farklı olan faturalar (id → gün; bekleyen null): kararı olanlar ve kapalı aya tarihli
 * olanlar okunur, küçük bir küme. Stok değerlemesinin partileri bununla taşınır (redateLots)
 */
export async function invoiceAccountDates(db: Reader, p: ClosedPeriods): Promise<Map<number, string | null>> {
  const months = Object.keys(p.months).sort();
  const rows = await db
    .select({ id: s.invoices.id, date: s.invoices.date, createdAt: s.invoices.createdAt, periodDate: s.invoices.periodDate })
    .from(s.invoices)
    .where(months.length ? or(isNotNull(s.invoices.periodDate), and(gte(s.invoices.date, `${months[0]}-01`), lte(s.invoices.date, monthLastDay(months[months.length - 1])))) : isNotNull(s.invoices.periodDate));
  const out = new Map<number, string | null>();
  for (const r of rows) {
    const d = accountDate(r, p);
    if (d !== r.date) out.set(r.id, d);
  }
  return out;
}
