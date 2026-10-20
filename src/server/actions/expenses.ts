"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { fixedMonthly, shiftMonth } from "@/lib/calc/engine";
import { panelGroupOf } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { dateTR, monthLabel, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zMonth, zMoney, zOptText, zText } from "./util";

// ---------------------------------------------------------------- Harcama kayıtları

const entrySchema = z.object({
  id: z.number().int().positive().nullable(),
  date: zDate,
  categoryId: z.number().int().positive({ message: "Kategori seçin" }),
  description: zOptText(200),
  amount: zMoney.refine((v) => v !== 0, "Tutar girin"),
  paymentMethod: z.enum(["nakit", "kart", "havale", "diger"]).nullable(),
  note: zOptText(500),
});

export async function saveExpenseEntry(input: z.input<typeof entrySchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = entrySchema.parse(input);
    const db = getDb();
    const [cat] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, data.categoryId)).limit(1);
    if (!cat) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
    const values = { ...data, description: data.description || null, note: data.note || null };
    let saved: { id: number };
    if (id) {
      const [row] = await db.update(s.expenseEntries).set({ ...values, updatedAt: new Date() }).where(eq(s.expenseEntries.id, id)).returning({ id: s.expenseEntries.id });
      if (!row) throw new UserError("Harcama bulunamadı; silinmiş olabilir");
      saved = row;
    } else {
      [saved] = await db.insert(s.expenseEntries).values({ ...values, createdBy: me.name }).returning({ id: s.expenseEntries.id });
    }
    await logActivity(me, id ? "Harcama düzeltildi" : "Harcama eklendi", `${cat.name} · ${dateTR(data.date)} · ${tl(data.amount, 2)}${data.description ? ` · ${data.description}` : ""}`);
    refresh();
    return { id: saved.id };
  });
}

export type ExpenseEntrySnapshot = {
  date: string;
  categoryId: number;
  description: string | null;
  amount: number;
  paymentMethod: "nakit" | "kart" | "havale" | "diger" | null;
  note: string | null;
};

/** Siler; geri almak için kaydın kopyası döner (restoreExpenseEntry) */
export async function deleteExpenseEntry(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [row] = await getDb().delete(s.expenseEntries).where(eq(s.expenseEntries.id, z.number().int().positive().parse(id))).returning();
    if (!row) throw new UserError("Harcama bulunamadı; silinmiş olabilir");
    await logActivity(me, "Harcama silindi", `${dateTR(row.date)} · ${tl(row.amount, 2)}${row.description ? ` · ${row.description}` : ""}`);
    refresh();
    const snap: ExpenseEntrySnapshot = { date: row.date, categoryId: row.categoryId, description: row.description, amount: row.amount, paymentMethod: row.paymentMethod, note: row.note };
    return snap;
  });
}

export async function restoreExpenseEntry(snap: ExpenseEntrySnapshot) {
  return saveExpenseEntry({ id: null, ...snap, description: snap.description ?? "", note: snap.note ?? "" });
}

// ---------------------------------------------------------------- Kategoriler

/** Harcama kategorisine bağlanabilecek fatura kategorileri: mal, komisyon ve kafe dışı faturalar zaten ayrı sayılır */
const MAPPABLE_INVOICE_CATEGORIES = INVOICE_CATEGORIES.filter((c) => !GOODS_CATEGORIES.includes(c) && c !== COMMISSION_CATEGORY && !SEPARATE_CATEGORIES.includes(c));

const categorySchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Kategori adı", 60),
  section: z.enum(["mal", "personel", "faturalar", "kira", "genel"]),
  panelGroup: z.enum(["kira", "personel", "reklam", "diger"]),
  invoiceCategory: z.string().nullable(),
  monthly: z.boolean(),
  active: z.boolean(),
});

const fold = (t: string) =>
  t
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export async function saveExpenseCategory(input: z.input<typeof categorySchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = categorySchema.parse(input);
    if (data.invoiceCategory && !MAPPABLE_INVOICE_CATEGORIES.includes(data.invoiceCategory)) {
      throw new UserError(`"${data.invoiceCategory}" faturaları zaten gelir-gidere giriyor ya da kafe dışı; harcamaya bağlanamaz`);
    }
    const db = getDb();
    const all = await db.select().from(s.expenseCategories);
    const dup = all.find((c) => c.id !== id && fold(c.name) === fold(data.name));
    if (dup) throw new UserError(`"${dup.name}" adında bir kategori zaten var`);
    const taken = data.invoiceCategory ? all.find((c) => c.id !== id && c.invoiceCategory === data.invoiceCategory) : null;
    if (taken) throw new UserError(`"${data.invoiceCategory}" faturaları zaten "${taken.name}" kategorisinde sayılıyor; iki kez sayılmasın`);
    let savedId: number;
    if (id) {
      const [row] = await db.update(s.expenseCategories).set(data).where(eq(s.expenseCategories.id, id)).returning({ id: s.expenseCategories.id });
      if (!row) throw new UserError("Kategori bulunamadı");
      savedId = row.id;
    } else {
      const sortOrder = Math.max(0, ...all.map((c) => c.sortOrder)) + 1;
      [{ id: savedId }] = await db.insert(s.expenseCategories).values({ ...data, sortOrder }).returning({ id: s.expenseCategories.id });
    }
    await logActivity(me, id ? "Harcama kategorisi düzenlendi" : "Harcama kategorisi eklendi", data.name);
    refresh();
    return { id: savedId };
  });
}

/** Harcaması olmayan kategori silinir; olan kategori silinmez (pasif yapılabilir: geçmiş aylar korunur) */
export async function deleteExpenseCategory(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const cid = z.number().int().positive().parse(id);
    const db = getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(s.expenseEntries).where(eq(s.expenseEntries.categoryId, cid));
    if (n) throw new UserError(`Bu kategoride ${n} harcama var; silmek yerine pasif yapın (geçmiş aylar korunur)`);
    const [row] = await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, cid)).returning();
    if (row) await logActivity(me, "Harcama kategorisi silindi", row.name);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Sabit gideri aylık girişe çevir

/**
 * Her ay aynı tutarla sayılan bir sabit gideri (ör. Instagram reklamı, Influencer) `fromMonth`tan itibaren aylık
 * girilen harcamaya çevirir: sabit kalem bir önceki ayda biter (geçmiş aylar aynı kalır), aynı adlı kategori açılır
 * (varsa o kullanılır). Gelir-gider'de bu aylara elle yazılmış tutarlar harcama olarak taşınır, çift sayılmasın diye
 * hücrelerden silinir. `fromMonth`ta tutar yoksa sabit tutar tahmini harcama olarak yazılır (gerçeği girilene kadar
 * kâr birden yükselmesin).
 */
export async function convertFixedToMonthly(fixedId: number, fromMonth: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const fid = z.number().int().positive().parse(fixedId);
    const month = zMonth.parse(fromMonth);
    const model = await loadModel();
    const fe = model.ds.fixedExpenses.find((f) => f.id === fid);
    if (!fe) throw new UserError("Sabit gider bulunamadı");
    if (fe.endMonth && fe.endMonth < month) throw new UserError(`${fe.name} ${monthLabel(fe.endMonth)} ayında zaten bitmiş`);
    const planned = fixedMonthly(model.fixedAtMonth(fe, month), model.settings);
    const db = getDb();
    const key = `fixed:${fe.id}`;
    const result = await db.transaction(async (tx) => {
      const cats = await tx.select().from(s.expenseCategories);
      let cat = cats.find((c) => fold(c.name) === fold(fe.name));
      if (!cat) {
        const sortOrder = Math.max(0, ...cats.map((c) => c.sortOrder)) + 1;
        [cat] = await tx
          .insert(s.expenseCategories)
          .values({ name: fe.name, section: fe.section, panelGroup: panelGroupOf(fe), monthly: true, sortOrder })
          .returning();
      } else if (!cat.monthly || !cat.active) {
        await tx.update(s.expenseCategories).set({ monthly: true, active: true }).where(eq(s.expenseCategories.id, cat.id));
      }
      // Bu aylara Gelir-gider'de elle yazılmış tutarlar harcamaya taşınır
      const overrides = await tx.select().from(s.pnlEntries).where(and(eq(s.pnlEntries.rowKey, key), gte(s.pnlEntries.month, month)));
      const moved = overrides.filter((o) => o.amount);
      if (moved.length) {
        await tx.insert(s.expenseEntries).values(
          moved.map((o) => ({
            date: `${o.month}-01`,
            categoryId: cat!.id,
            description: o.note ? `Gelir-gider tablosundan · ${o.note}` : "Gelir-gider tablosundan aktarıldı",
            amount: o.amount,
            createdBy: me.name,
          })),
        );
      }
      if (overrides.length) await tx.delete(s.pnlEntries).where(and(eq(s.pnlEntries.rowKey, key), gte(s.pnlEntries.month, month)));
      let estimated = false;
      if (!moved.some((o) => o.month === month) && planned) {
        await tx.insert(s.expenseEntries).values({ date: `${month}-01`, categoryId: cat!.id, description: "Sabit giderdeki tutar (tahmini): gerçeğini yazın", amount: planned, createdBy: me.name });
        estimated = true;
      }
      await tx.update(s.fixedExpenses).set({ endMonth: shiftMonth(month, -1) }).where(eq(s.fixedExpenses.id, fe.id));
      return { categoryId: cat!.id, moved: moved.length, estimated };
    });
    await logActivity(me, "Sabit gider aylık girişe çevrildi", `${fe.name}: ${monthLabel(month)}'dan itibaren Aylık harcamalar'da`);
    refresh();
    return { ...result, planned };
  });
}
