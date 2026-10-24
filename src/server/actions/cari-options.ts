"use server";

import { and, asc, desc, eq, gt, gte, ilike, isNotNull, lte, or } from "drizzle-orm";
import { z } from "zod";

import { splitSupplier, supplierMatchKey } from "@/app/panel/faturalar/rules";
import { COMMISSION_CATEGORY, SEPARATE_CATEGORIES } from "@/lib/constants";
import { addDays } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { cardResolver } from "@/server/cari/settle";
import { loadKasaHandled } from "@/server/data/cari";
import { getDb, schema as s } from "@/server/db";

import { attempt, zDate } from "./util";

// Cari pencerelerinin okumaları (yalnız yönetici): Borç ekle'nin harcama kayıtları ve Ödeme ekle'nin Kasa satırları.
// Pencere açılınca ve gün değişince çağrılır; yazım src/server/actions/cari.ts'te.

const zId = z.number().int().positive();

/**
 * Borç ekle'nin seçenekleri (§3.1.3, §3.1.6): alım gününün ±31 günündeki, Kasa'dan yazılmamış ve başka bir borcun
 * olmayan Aylık harcamalar kayıtları ("Gideri zaten girildi" adayları ve kopya uyarısı) ve o ayın Gelir-gider ›
 * "DİĞER (market / nakit alımlar)" hücresi.
 */
export async function loadDebtOptions(input: { date: string; debtId?: number | null }) {
  return attempt(async () => {
    await requireAdmin();
    const date = zDate.parse(input.date);
    const own = zId.nullish().parse(input.debtId) ?? null;
    const db = getDb();
    const [rows, [diger]] = await Promise.all([
      db
        .select({
          id: s.expenseEntries.id,
          date: s.expenseEntries.date,
          amount: s.expenseEntries.amount,
          categoryId: s.expenseEntries.categoryId,
          categoryName: s.expenseCategories.name,
          section: s.expenseCategories.section,
          description: s.expenseEntries.description,
          supplierEntryId: s.expenseEntries.supplierEntryId,
          cashOutId: s.expenseEntries.cashOutId,
        })
        .from(s.expenseEntries)
        .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
        .where(and(gte(s.expenseEntries.date, addDays(date, -31)), lte(s.expenseEntries.date, addDays(date, 31))))
        .orderBy(asc(s.expenseEntries.date), asc(s.expenseEntries.id)),
      db
        .select({ amount: s.pnlEntries.amount })
        .from(s.pnlEntries)
        .where(and(eq(s.pnlEntries.month, date.slice(0, 7)), eq(s.pnlEntries.rowKey, "manual:diger_mal")))
        .limit(1),
    ]);
    return {
      expenses: rows.filter((r) => r.cashOutId === null && (r.supplierEntryId === null || r.supplierEntryId === own)),
      digerMal: diger && Math.abs(diger.amount) >= 0.005 ? diger.amount : null,
    };
  });
}

/**
 * Ödeme ekle › Kasadan: o günün işlenmemiş Teslim satırları (başka ödemeye bağlı değil, "Ayrı tut" denmemiş);
 * tedarikçinin adlarıyla eşleşenler önce. `paymentId`: düzeltilen ödemenin kendi satırı da listede kalır.
 */
export async function loadKasaLines(input: { date: string; names: string[]; paymentId?: number | null }) {
  return attempt(async () => {
    await requireAdmin();
    const date = zDate.parse(input.date);
    const keys = new Set(z.array(z.string().max(300)).max(40).parse(input.names).map(supplierMatchKey).filter(Boolean));
    const own = zId.nullish().parse(input.paymentId) ?? null;
    const db = getDb();
    const [lines, handled, mine] = await Promise.all([
      db
        .select({ id: s.cashOuts.id, date: s.cashOuts.date, amount: s.cashOuts.amount, store: s.cashOuts.store, createdByName: s.cashOuts.createdByName })
        .from(s.cashOuts)
        .where(and(eq(s.cashOuts.date, date), eq(s.cashOuts.kind, "teslim")))
        .orderBy(asc(s.cashOuts.id)),
      loadKasaHandled(),
      own ? db.select({ cashOutId: s.supplierEntries.cashOutId }).from(s.supplierEntries).where(eq(s.supplierEntries.id, own)).limit(1) : Promise.resolve([]),
    ]);
    const keep = mine[0]?.cashOutId ?? null;
    return lines
      .filter((l) => l.id === keep || !handled.has(l.id))
      .map((l) => ({ ...l, match: Boolean(l.store && keys.has(supplierMatchKey(l.store))) }))
      .sort((a, b) => Number(b.match) - Number(a.match) || a.id - b.id);
  });
}

/**
 * Faturası geldi › Başka faturalar (R3d): bu kartın grubunda olmayan, bağlanabilecek faturalarda arama (tedarikçi
 * adı ya da fatura no; en yeni önce, en çok 20). Her sonuç faturanın nerede göründüğünü söyler: kartsız adda
 * `alias` (bu kartın diğer adı olabilir; o adla kaç fatura geçeceği), başka kartta o kartın adı.
 */
export async function searchLinkInvoices(input: { cardId: number; q: string }) {
  return attempt(async () => {
    await requireAdmin();
    const cardId = zId.parse(input.cardId);
    const q = z.string().trim().min(2, "En az iki harf yazın").max(80).parse(input.q);
    const db = getDb();
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [resolve, rows, linked] = await Promise.all([
      cardResolver(db),
      db
        .select({
          id: s.invoices.id,
          date: s.invoices.date,
          invoiceNo: s.invoices.invoiceNo,
          supplier: s.invoices.supplier,
          tax: s.invoices.supplierTaxNumber,
          payable: s.invoices.payable,
          amount: s.invoices.amount,
          discount: s.invoices.discount,
          category: s.invoices.category,
        })
        .from(s.invoices)
        .where(and(gt(s.invoices.payable, 0), or(ilike(s.invoices.supplier, like), ilike(s.invoices.invoiceNo, like))))
        .orderBy(desc(s.invoices.date), desc(s.invoices.id))
        .limit(200),
      db.select({ invoiceId: s.supplierEntries.invoiceId }).from(s.supplierEntries).where(isNotNull(s.supplierEntries.invoiceId)),
    ]);
    const taken = new Set(linked.map((r) => r.invoiceId));
    const hits = rows.filter((r) => !taken.has(r.id) && r.category !== COMMISSION_CATEGORY && !SEPARATE_CATEGORIES.includes(r.category) && resolve(r.supplier, r.tax) !== cardId).slice(0, 20);
    if (!hits.length) return [];
    const owners = [...new Set(hits.flatMap((h) => (resolve(h.supplier, h.tax) !== null ? [resolve(h.supplier, h.tax)!] : [])))];
    const names = owners.length ? await db.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers) : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    // Kartsız adın faturası: o adla (anahtarıyla) kaç fatura bu karta geçer
    const all = await db.select({ supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices);
    return hits.map((h) => {
      const owner = resolve(h.supplier, h.tax);
      const alias = splitSupplier(h.supplier).base.trim() || h.supplier;
      const key = supplierMatchKey(alias);
      return {
        id: h.id,
        date: h.date,
        invoiceNo: h.invoiceNo,
        supplier: h.supplier,
        payable: h.payable,
        amount: h.amount,
        discount: h.discount,
        category: h.category,
        owner: owner === null ? null : { cardId: owner, name: nameOf.get(owner) ?? "" },
        alias: owner === null ? { name: alias, count: all.filter((x) => resolve(x.supplier, x.tax) === null && supplierMatchKey(x.supplier) === key).length } : null,
      };
    });
  });
}
