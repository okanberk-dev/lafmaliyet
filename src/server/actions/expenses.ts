"use server";

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { activeFromRange, currentMonthTR, fixedMonthly, shiftMonth } from "@/lib/calc/engine";
import { panelGroupOf } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, FIXED_ESTIMATE_DESCRIPTION, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { EXPENSE_SHARED, zFormBranch } from "@/lib/branches";
import { dateTR, monthLabel, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { currentExpenseBranch, formBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadModel } from "@/server/data/dataset";
import { linkedUntil } from "@/lib/photo-rules";
import { addDays, todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { getPhoto, keepPhoto, releasePhoto } from "@/server/storage/photos";
import { assertNotHeld } from "@/server/staff-requests/core";

import { logActivity } from "./log";
import { attempt, UserError, zAmount, zDate, zMonth, zOptText, zSignedAmount, zText } from "./util";

// ---------------------------------------------------------------- Harcama kayıtları

const entrySchema = z.object({
  id: z.number().int().positive().nullable(),
  date: zDate,
  categoryId: z.number().int().positive({ message: "Kategori seçin" }),
  description: zOptText(200),
  // Eksi tutar bilerek serbest (iade, düzeltme); fazladan yazılmış sıfıra karşı en çok ±100.000.000 ₺ (FC-06)
  amount: zSignedAmount.refine((v) => v !== 0, "Tutar girin"),
  paymentMethod: z.enum(["nakit", "kart", "havale", "diger"]).nullable(),
  note: zOptText(500),
  /**
   * Formda seçilen şube: şube kimliği ya da "isletme" (işletme geneli; EXPENSE_SHARED). Gönderilmezse (eski sekme, asistan)
   * seçili şube, "Tümü"de işletme geneli; düzeltmede şube değişmez
   */
  branchId: zFormBranch,
  /**
   * Yeni kayda bağlanacak fiş fotoğrafı ve fişten okunan KDV (panel asistanının fiş kartı; docs/ASISTAN-ISLEMLER.md ›
   * Fiş fotoğrafı). Fotoğraf fiş türünde, bağlanmamış, süresi işleyen ve bir isteğin tutmadığı olmalı; düzeltmede yok sayılır
   */
  photoId: z.number().int().positive().nullish(),
  vat: zAmount.nullish(),
});

/** Harcamanın en ileri tarihi: bugünden bu kadar gün sonrası (gelecek ayın ödemesi önceden girilebilir; 2030 girilemez) */
const EXPENSE_AHEAD_DAYS = 31;

/** Cari borcun tedarikçisi, iyelik ekiyle ("Sütaş tedarikçisinin") */
async function ownerName(supplierEntryId: number): Promise<string> {
  const [r] = await getDb()
    .select({ name: s.suppliers.name })
    .from(s.supplierEntries)
    .innerJoin(s.suppliers, eq(s.supplierEntries.supplierId, s.suppliers.id))
    .where(eq(s.supplierEntries.id, supplierEntryId))
    .limit(1);
  return r ? `${r.name} tedarikçisinin` : "bir tedarikçinin";
}

export async function saveExpenseEntry(input: z.input<typeof entrySchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, branchId: rawBranch, photoId, vat, ...data } = entrySchema.parse(input);
    if (data.date > addDays(todayTR(), EXPENSE_AHEAD_DAYS)) throw new UserError("Tarih bir aydan daha ileri olamaz");

    const db = getDb();
    const [cat] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, data.categoryId)).limit(1);
    if (!cat) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
    // Pasif kategoriye yeni harcama yazılmaz (açılır liste yalnız etkinleri gösterir; eski açık form gönderebilir)
    if (!id && !cat.active) throw new UserError(`${cat.name} pasif; yeni harcama yazılmaz. Başka kategori seçin ya da kategoriyi etkinleştirin`);
    const values = { ...data, description: data.description || null, note: data.note || null };
    let saved: { id: number };
    /** Yazılan şube (yeni kayıt ya da şubesi değişen düzeltme); null işletme geneli */
    let moved: { branch: string | null } | null = null;
    if (id) {
      // Kasadan çıkan bir fişten yazılan kaydın tutarı ve tarihi kasada düzeltilir (iki yer ayrışmasın)
      const [prev] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, id)).limit(1);
      if (prev?.cashOutId && (Math.abs(prev.amount - data.amount) >= 0.005 || prev.date !== data.date)) {
        throw new UserError("Bu harcama kasadan çıkan bir fişten; tutarı ve tarihi Kasa raporu'nda düzeltin");
      }
      // Cari borcun gideri: tutarı, günü ve kategorisi borçla birlikte Tedarikçiler'de değişir (açıklama ve not serbest)
      if (prev?.supplierEntryId && (Math.abs(prev.amount - data.amount) >= 0.005 || prev.date !== data.date || prev.categoryId !== data.categoryId)) {
        throw new UserError(`Bu harcama ${await ownerName(prev.supplierEntryId)} faturasız alımından; tutarını, gününü ve kategorisini Tedarikçiler'de düzeltin`);
      }
      // Şube formda değiştiyse (gönderilmediyse ya da aynıysa dokunulmaz: kapanmış şubenin eski kaydı da düzeltilir).
      // Kaynağa bağlı kaydın şubesi kaynağın şubesidir: kasadan çıkanınki o kasanın, cari giderinki Tedarikçiler'de seçilen
      if (prev && rawBranch && rawBranch !== (prev.branchId ?? EXPENSE_SHARED)) {
        if (prev.cashOutId) throw new UserError("Bu harcama kasadan çıkan bir fişten; şubesi o kasanın şubesidir, değiştirilemez");
        if (prev.supplierEntryId) throw new UserError(`Bu harcama ${await ownerName(prev.supplierEntryId)} faturasız alımından; şubesini Tedarikçiler'de düzeltin`);
        moved = { branch: await formBranch(rawBranch, "expense") };
      }
      // Çevirmenin tahmini kaydı: tutarı ya da günü düzeltilince ödenen tutar olur (nakit planı ödenmiş sayar; E-13)
      if (
        prev?.description === FIXED_ESTIMATE_DESCRIPTION &&
        values.description === FIXED_ESTIMATE_DESCRIPTION &&
        (Math.abs(prev.amount - data.amount) >= 0.005 || prev.date !== data.date)
      ) {
        values.description = null;
      }
      const [row] = await db
        .update(s.expenseEntries)
        .set({ ...values, ...(moved ? { branchId: moved.branch } : {}), updatedAt: new Date() })
        .where(eq(s.expenseEntries.id, id))
        .returning({ id: s.expenseEntries.id });
      if (!row) throw new UserError("Harcama bulunamadı; silinmiş olabilir");
      saved = row;
    } else {
      // Yeni harcama formun şubesine (docs/SUBE.md › Yazarken hangi şube): gönderim anındaki seçim değil. Şube
      // göndermeyen eski sekmede ve asistanda seçili şube, "Tümü"nde işletme geneli
      moved = { branch: await formBranch(rawBranch, "expense") };
      const branch = moved.branch;
      if (photoId) {
        // Fişli yeni kayıt (asistanın fiş kartı): fotoğraf aynı işlemde denetlenir ve bağlanır (kasadan çıkanın fişi gibi)
        saved = await db.transaction(async (tx) => {
          const p = await getPhoto(photoId, tx);
          if (!p || p.kind !== "fis" || p.linkedAt !== null || p.expiresAt === null || p.expiresAt.getTime() <= Date.now()) {
            throw new UserError("Fiş fotoğrafı bulunamadı, süresi doldu ya da başka bir kayda bağlandı; fotoğrafı yeniden ekleyin");
          }
          await assertNotHeld(tx, p.id);
          await keepPhoto(p.id, linkedUntil("fis", data.date, todayTR()), tx);
          const [row] = await tx
            .insert(s.expenseEntries)
            .values({ ...values, branchId: branch, createdBy: me.name, photoId: p.id, vat: vat ?? null })
            .returning({ id: s.expenseEntries.id });
          return row;
        });
      } else {
        [saved] = await db.insert(s.expenseEntries).values({ ...values, branchId: branch, createdBy: me.name }).returning({ id: s.expenseEntries.id });
      }
    }
    const where = moved ? ` · ${moved.branch ? ((await listBranches()).find((b) => b.id === moved.branch)?.name ?? moved.branch) : "İşletme geneli"}` : "";
    await logActivity(me, id ? "Harcama düzeltildi" : "Harcama eklendi", `${cat.name} · ${dateTR(data.date)} · ${tl(data.amount, 2)}${where}${data.description ? ` · ${data.description}` : ""}`);
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
  /** Fişli / kasadan çıkan kaydın bağları (geri alınca yeniden kurulur) */
  photoId?: number | null;
  vat?: number | null;
  cashOutId?: number | null;
  /** Giderin şubesi (null = işletme geneli); geri alınca yerine döner */
  branchId?: string | null;
};

/**
 * Siler; geri almak için kaydın kopyası döner (restoreExpenseEntry). Kasadan çıkan bir fişten yazılmışsa kasa satırı
 * kalır (fotoğrafı da onunla); fotoğrafı başka kayıt kullanmıyorsa 7 gün daha saklanır.
 */
export async function deleteExpenseEntry(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const entryId = z.number().int().positive().parse(id);
    // Cari borcun gideri burada silinmez: borç silinince ya da "Faturası gelecek" yapılınca kalkar
    const [owned] = await getDb().select({ owner: s.expenseEntries.supplierEntryId }).from(s.expenseEntries).where(eq(s.expenseEntries.id, entryId)).limit(1);
    if (owned?.owner) throw new UserError(`Bu harcama ${await ownerName(owned.owner)} faturasız alımının gideri; orada silin ya da 'Faturası gelecek' yapın`);
    const row = await getDb().transaction(async (tx) => {
      const [row] = await tx.delete(s.expenseEntries).where(and(eq(s.expenseEntries.id, entryId), isNull(s.expenseEntries.supplierEntryId))).returning();
      if (!row) throw new UserError("Harcama bulunamadı; silinmiş olabilir");
      if (row.photoId) {
        const [used] = await tx.select({ id: s.cashOuts.id }).from(s.cashOuts).where(eq(s.cashOuts.photoId, row.photoId)).limit(1);
        if (!used) await releasePhoto(row.photoId, undefined, tx);
      }
      return row;
    });
    await logActivity(me, "Harcama silindi", `${dateTR(row.date)} · ${tl(row.amount, 2)}${row.description ? ` · ${row.description}` : ""}${row.cashOutId ? " · kasa satırı kalır" : ""}`);
    refresh();
    const snap: ExpenseEntrySnapshot = {
      date: row.date,
      categoryId: row.categoryId,
      description: row.description,
      amount: row.amount,
      paymentMethod: row.paymentMethod,
      note: row.note,
      photoId: row.photoId,
      vat: row.vat,
      cashOutId: row.cashOutId,
      branchId: row.branchId,
    };
    return snap;
  });
}

const linkSchema = z.object({
  photoId: z.number().int().positive().nullish(),
  vat: zAmount.nullish(),
  cashOutId: z.number().int().positive().nullish(),
});

/**
 * Silinen kaydı geri getirir. Kasadan çıkan satırı hâlâ varsa ve başka kayda bağlanmadıysa yeniden bağlanır;
 * fotoğrafı bırakılmışsa yeniden saklanır. Bağlar kurulamazsa kayıt bağsız döner.
 */
export async function restoreExpenseEntry(snap: ExpenseEntrySnapshot) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = entrySchema.omit({ id: true }).parse({ ...snap, description: snap.description ?? "", note: snap.note ?? "" });
    const link = linkSchema.parse({ photoId: snap.photoId, vat: snap.vat, cashOutId: snap.cashOutId });
    const db = getDb();
    const [cat] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, data.categoryId)).limit(1);
    if (!cat) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
    // Şube yerine döner (kütükte yoksa işletme geneli); eski anlık görüntüde şube yoksa seçili şube
    const branchId =
      snap.branchId === undefined ? await currentExpenseBranch() : snap.branchId && (await listBranches()).some((b) => b.id === snap.branchId) ? snap.branchId : null;
    const saved = await db.transaction(async (tx) => {
      let cashOutId: number | null = null;
      let photoId: number | null = null;
      if (link.cashOutId) {
        const [out] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, link.cashOutId)).limit(1);
        const [taken] = await tx.select({ id: s.expenseEntries.id }).from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, link.cashOutId)).limit(1);
        if (out && !taken) {
          cashOutId = out.id;
          photoId = out.photoId;
        }
      } else if (link.photoId) {
        const p = await getPhoto(link.photoId, tx);
        if (p && p.kind === "fis" && p.linkedAt === null && (p.expiresAt === null || p.expiresAt.getTime() > Date.now())) {
          // Onay bekleyen bir isteğin tuttuğu fiş harcamaya bağlanmaz
          await assertNotHeld(tx, p.id);
          photoId = p.id;
          await keepPhoto(p.id, linkedUntil("fis", data.date, todayTR()), tx);
        }
      }
      const [row] = await tx
        .insert(s.expenseEntries)
        .values({ ...data, description: data.description || null, note: data.note || null, createdBy: me.name, photoId, cashOutId, vat: link.vat ?? null, branchId })
        .returning({ id: s.expenseEntries.id });
      return row;
    });
    await logActivity(me, "Harcama eklendi", `${cat.name} · ${dateTR(data.date)} · ${tl(data.amount, 2)}${data.description ? ` · ${data.description}` : ""}`);
    refresh();
    return { id: saved.id };
  });
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
            // Sabit gider kaleminin şubesi (boşsa işletme geneli) harcamaya geçer
            branchId: fe.branchId,
          })),
        );
      }
      if (overrides.length) await tx.delete(s.pnlEntries).where(and(eq(s.pnlEntries.rowKey, key), gte(s.pnlEntries.month, month)));
      let estimated = false;
      // Başlangıç ayına elle yazılmış her tutar (0 dahil: "bu ay reklam yok") gerçektir; tahmin yalnız boş ayda yazılır
      if (!overrides.some((o) => o.month === month) && planned) {
        await tx
          .insert(s.expenseEntries)
          .values({ date: `${month}-01`, categoryId: cat!.id, description: FIXED_ESTIMATE_DESCRIPTION, amount: planned, createdBy: me.name, branchId: fe.branchId });
        estimated = true;
      }
      // Saklı `active` sütunu da bitiş ayıyla (Ödemeler › Sabit giderlerden ekle bitmiş kalemi önermesin; E-62)
      const endMonth = shiftMonth(month, -1);
      await tx.update(s.fixedExpenses).set({ endMonth, active: activeFromRange(endMonth, currentMonthTR()) }).where(eq(s.fixedExpenses.id, fe.id));
      return { categoryId: cat!.id, moved: moved.length, estimated };
    });
    await logActivity(me, "Sabit gider aylık girişe çevrildi", `${fe.name}: ${monthLabel(month)}'dan itibaren Aylık harcamalar'da`);
    refresh();
    return { ...result, planned };
  });
}
