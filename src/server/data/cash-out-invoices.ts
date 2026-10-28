import { and, desc, eq, gte, inArray, isNotNull, lte, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { supplierResolver } from "@/app/panel/tedarikciler/logic";
import { CASH_OUT_INVOICE_WINDOW, cashOutInvoiceDay, matchCashOutInvoices, nameKey, sameStoreName, type CashOutDocType } from "@/lib/cash-outs";
import { addDays } from "@/lib/reminders";
import { getDb, schema as s, type DB } from "@/server/db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/*
 * Kasadan faturalı alımlar (denetim 26 Eki, E-42; docs/KASA-RAPORU.md "Faturalı alımlar"): personelin Kasa'ya girdiği
 * fatura ya da e-Arşiv belgeli alışveriş Aylık harcamalar'a yazılmaz (staffToExpenses: Paraşüt'ten de gelir, iki kez
 * sayılmasın). Ama e-Arşiv ve kâğıt fatura Paraşüt'e kendiliğinden düşmez (docs/PARASUT.md): eşleşen faturası
 * gelmeyen satır hiçbir hesaba girmezdi. Bekleyen liste: belgesi fatura ya da e-Arşiv, Aylık harcamalar'da kaydı yok,
 * bir tedarikçi ödemesine bağlı değil, yöneticinin elle kapatmadığı ve aynı mağazadan ±7 gün, ±1 ₺ içinde faturası
 * olmayan satırlar. Zil, Bugün ve Faturalar'ın Kontrol süzgeci gösterir; eşleşen fatura gelince kendiliğinden kalkar.
 */

/**
 * Yöneticinin kapattığı satırlar (integration_state): "Listeden çıkar" (`invoiceId` yok) ya da "Faturalar'a ekle" ile
 * açılan fatura (`invoiceId`; fatura silinirse satır yeniden bekler). En yeni CASH_OUT_INVOICE_LIMIT kayıt tutulur.
 */
export const CASH_OUT_INVOICE_KEY = "cashOuts.invoiceHandled";
export const CASH_OUT_INVOICE_LIMIT = 2000;

const handledSchema = z.array(z.object({ id: z.number().int().positive(), invoiceId: z.number().int().positive().nullish(), by: z.string(), at: z.string() }));
export type HandledCashOut = z.infer<typeof handledSchema>[number];

function parseHandled(value: unknown): HandledCashOut[] {
  if (!Array.isArray(value)) return [];
  // Bozuk bir satır listenin kalanını düşürmesin
  return value.flatMap((v) => {
    const r = handledSchema.element.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

/** Kapatılmış satırlar */
export async function loadHandledCashOuts(db: DB | Tx = getDb()): Promise<HandledCashOut[]> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, CASH_OUT_INVOICE_KEY)).limit(1);
  return parseHandled(row?.value);
}

/**
 * Kapatılmış satırlara ekler ya da çıkarır (aynı satırın eski kaydının yerine yenisi); durum satırı kilitli okunur (iki
 * sekme aynı anda yazınca biri ötekini ezmesin)
 */
export async function updateHandledCashOuts(tx: Tx, change: { add?: readonly Omit<HandledCashOut, "at">[]; remove?: readonly number[] }) {
  if (!change.add?.length && !change.remove?.length) return;
  await tx.insert(s.integrationState).values({ key: CASH_OUT_INVOICE_KEY, value: [] }).onConflictDoNothing();
  const [row] = await tx.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, CASH_OUT_INVOICE_KEY)).for("update").limit(1);
  const drop = new Set([...(change.remove ?? []), ...(change.add ?? []).map((a) => a.id)]);
  const at = new Date().toISOString();
  const next = [...parseHandled(row?.value).filter((h) => !drop.has(h.id)), ...(change.add ?? []).map((a) => ({ ...a, at }))].slice(-CASH_OUT_INVOICE_LIMIT);
  await tx.update(s.integrationState).set({ value: next, updatedAt: new Date() }).where(eq(s.integrationState.key, CASH_OUT_INVOICE_KEY));
}

/** Bekleyen satır (yalnız yönetici görür: tutar ve belge) */
export interface PendingCashOutInvoice {
  id: number;
  date: string;
  receiptDate: string | null;
  store: string | null;
  description: string | null;
  amount: number;
  vat: number | null;
  docType: CashOutDocType;
  receiptNo: string | null;
  photoId: number | null;
  createdByName: string;
  /** Aynı yerin son Kasa harcamasının kategorisi ("Aylık harcamalar'a yaz"ın önerisi); yoksa null */
  suggestedCategoryId: number | null;
}

/** Listenin en çok bu kadar satırı okunur (en yeniler); eşleşmeyen eski satırlar da bunlara dahil */
const MAX_ROWS = 500;

/**
 * Bekleyen kasadan faturalı alımlar, yeniden eskiye. `ids` verilirse yalnız onlara bakılır (eylemlerin denetimi:
 * satır hâlâ bekliyor mu).
 */
export async function loadPendingCashOutInvoices(db: DB | Tx = getDb(), opts: { ids?: readonly number[] } = {}): Promise<PendingCashOutInvoice[]> {
  if (opts.ids && !opts.ids.length) return [];
  const co = s.cashOuts;
  const [rows, handled] = await Promise.all([
    db
      .select({
        id: co.id,
        date: co.date,
        receiptDate: co.receiptDate,
        store: co.store,
        description: co.description,
        amount: co.amount,
        vat: co.vat,
        docType: co.docType,
        receiptNo: co.receiptNo,
        photoId: co.photoId,
        createdByName: co.createdByName,
      })
      .from(co)
      .where(
        and(
          eq(co.kind, "harcama"),
          inArray(co.docType, ["fatura", "e_arsiv"]),
          opts.ids ? inArray(co.id, [...opts.ids]) : undefined,
          // Aylık harcamalar'a yazılmış (personel kuralı dışında yöneticinin anahtarıyla ya da buradan) satır sayıldı
          notExists(db.select({ one: sql`1` }).from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, co.id))),
          // Tedarikçi ödemesine bağlı satır cari hesabında izlenir (borç, faturası orada bağlanır)
          notExists(db.select({ one: sql`1` }).from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, co.id))),
        ),
      )
      .orderBy(desc(co.date), desc(co.id))
      .limit(MAX_ROWS),
    loadHandledCashOuts(db),
  ]);
  if (!rows.length) return [];
  // Kapatılanlar: "Listeden çıkar" ya da hâlâ duran bir faturayla "Faturalar'a ekle"
  const linkedIds = [...new Set(handled.map((h) => h.invoiceId).filter((x): x is number => typeof x === "number"))];
  const alive = new Set(
    linkedIds.length ? (await db.select({ id: s.invoices.id }).from(s.invoices).where(inArray(s.invoices.id, linkedIds))).map((r) => r.id) : [],
  );
  const closed = new Set(handled.filter((h) => !h.invoiceId || alive.has(h.invoiceId)).map((h) => h.id));
  const open = rows.filter((r) => !closed.has(r.id));
  if (!open.length) return [];

  // Pencerenin faturaları (±7 gün) ve tedarikçi kartları (diğer adları, vergi no): aynı karta giden ad aynı mağazadır
  const days = open.map(cashOutInvoiceDay).sort();
  const from = addDays(days[0], -CASH_OUT_INVOICE_WINDOW.days);
  const to = addDays(days[days.length - 1], CASH_OUT_INVOICE_WINDOW.days);
  const [invoices, cards, refs, recent] = await Promise.all([
    db
      .select({ id: s.invoices.id, date: s.invoices.date, supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber, payable: s.invoices.payable })
      .from(s.invoices)
      .where(and(gte(s.invoices.date, from), lte(s.invoices.date, to))),
    db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber }).from(s.suppliers),
    db.selectDistinct({ supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber }).from(s.invoices),
    // Aynı yerin son Kasa harcamalarının kategorisi (öneri)
    db
      .select({ store: s.cashOuts.store, categoryId: s.expenseEntries.categoryId })
      .from(s.expenseEntries)
      .innerJoin(s.cashOuts, eq(s.cashOuts.id, s.expenseEntries.cashOutId))
      .where(isNotNull(s.cashOuts.store))
      .orderBy(desc(s.expenseEntries.date), desc(s.expenseEntries.id))
      .limit(300),
  ]);
  const { resolve } = supplierResolver(cards, refs);
  const storeGroup = new Map<string, string>();
  const groupOfStore = (store: string) => {
    if (!storeGroup.has(store)) storeGroup.set(store, resolve(store, null).id);
    return storeGroup.get(store)!;
  };
  // "Faturalar'a ekle" ile başka bir satırdan açılmış fatura o satırındır, bir başkasını kapatmaz
  const candidates = invoices.filter((i) => !alive.has(i.id));
  const { pending } = matchCashOutInvoices(open, candidates, (o, i) => sameStoreName(o.store ?? "", i.supplier) || groupOfStore(o.store ?? "") === resolve(i.supplier, i.supplierTaxNumber).id);
  const suggested = new Map<string, number>();
  for (const r of recent) {
    const k = r.store ? nameKey(r.store) : "";
    if (k && !suggested.has(k)) suggested.set(k, r.categoryId);
  }
  return pending.map((r) => ({ ...r, suggestedCategoryId: (r.store && suggested.get(nameKey(r.store))) || null }));
}
