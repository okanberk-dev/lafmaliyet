"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { planAdminExtras, staffCountIssue } from "@/app/panel/sayim/logic";
import { countFactor } from "@/lib/calc/engine";
import { monthRowEmpty } from "@/lib/cash-month";
import { monthLabel } from "@/lib/format";
import { isCountable } from "@/lib/ingredient-usage";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { hasTillRowsIn } from "@/server/data/cash-reports";
import { activeProductsUsing } from "@/server/data/ingredient-usage";
import { lockExtras } from "@/server/data/stock-extras";
import { currentPhysicalBranch } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMonth, zText } from "./util";

/**
 * Sayım sonuçlarını kaydeder. Personel de kullanabilir (bu ay; geçen ay yalnız ayın ilk 10 gününde: staffCountIssue).
 * qty = null olan satırlar silinir.
 * Her sayımla o anki birim çarpanı (KG/LT = 1000, ADET/DİLİM = 1) saklanır: malzemenin sayım birimi sonradan
 * değişse ya da malzeme pasif yapılsa da geçmiş ayın stok değeri değişmez.
 *
 * `base`: kişinin formu açtığında gördüğü kayıtlı miktar. Arada başkası o satırı kaydettiyse (iki kişi aynı anda
 * sayıyor) üzerine yazılmaz, hata döner ve sayfa yenilenir; kişi yeni değeri görüp isterse yeniden kaydeder.
 */
export async function saveStockCounts(month: string, entries: { ingredientId: number; qty: number | null; base?: number | null }[]) {
  return attempt(async () => {
    const me = await requireUser();
    const m = zMonth.parse(month);
    // Personel bu ayı, geçen ayı yalnız ayın ilk 10 gününde değiştirir (sayim/logic.ts staffCountIssue)
    const monthIssue = staffCountIssue(me.role, m);
    if (monthIssue) throw new UserError(monthIssue);
    const data = z
      .array(
        z.object({
          ingredientId: z.number().int().positive(),
          qty: z.number().finite().min(0, "Miktar negatif olamaz").nullable(),
          base: z.number().finite().nullable().optional(),
        }),
      )
      .max(1000)
      .parse(entries);
    const db = getDb();
    // Sayım şube başına (docs/SUBE.md): seçili şubeye yazılır ("Tümü" ya da online kanal seçiliyken Tuzla). Anahtar
    // (ay, şube, malzeme): şubesiz okuma ya da silme başka şubenin sayımına dokunurdu
    const sube = (await currentPhysicalBranch()).id;
    const buSube = eq(s.stockCounts.branchId, sube);
    const filled = data.filter((x) => x.qty !== null);
    // Ay satırı yalnızca gerçekten sayım yazılınca açılır: yalnızca silen bir kayıt boş ay bırakmasın
    if (filled.length) await db.insert(s.months).values({ month: m, branchId: sube }).onConflictDoNothing();
    const removed = await db.transaction(async (tx) => {
      const checked = data.filter((e) => e.base !== undefined);
      if (checked.length) {
        const current = new Map(
          (
            await tx
              .select({ id: s.stockCounts.ingredientId, qty: s.stockCounts.qty })
              .from(s.stockCounts)
              .where(and(eq(s.stockCounts.month, m), buSube, inArray(s.stockCounts.ingredientId, checked.map((e) => e.ingredientId))))
          ).map((r) => [r.id, r.qty]),
        );
        const stale = checked.filter((e) => {
          const now = current.get(e.ingredientId) ?? null;
          return now !== e.base && now !== e.qty;
        });
        if (stale.length) {
          const names = (
            await tx
              .select({ name: s.ingredients.name })
              .from(s.ingredients)
              .where(inArray(s.ingredients.id, stale.map((e) => e.ingredientId)))
          ).map((r) => r.name);
          // Form yeni değerleri alsın: dokunulmayan satırlar güncellenir, çakışanlar işaretlenir
          refresh();
          throw new UserError(
            `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` ve ${names.length - 3} kalem daha` : ""} bu arada başkası tarafından kaydedildi; hiçbir şey kaydedilmedi. İşaretli satırları kontrol edip yeniden kaydedin.`,
          );
        }
      }
      const clear = data.filter((e) => e.qty === null).map((e) => e.ingredientId);
      const deleted = clear.length
        ? (
            await tx
              .delete(s.stockCounts)
              .where(and(eq(s.stockCounts.month, m), buSube, inArray(s.stockCounts.ingredientId, clear)))
              .returning({ id: s.stockCounts.ingredientId })
          ).length
        : 0;
      if (!filled.length) {
        if (deleted) await dropEmptyStockMonth(tx, m, sube);
        return deleted;
      }
      const ids = filled.map((e) => e.ingredientId);
      const ings = new Map(
        (
          await tx
            .select({ id: s.ingredients.id, name: s.ingredients.name, countUnit: s.ingredients.countUnit, active: s.ingredients.active })
            .from(s.ingredients)
            .where(inArray(s.ingredients.id, ids))
        ).map((i) => [i.id, i]),
      );
      const existing = new Map(
        (
          await tx
            .select({ ingredientId: s.stockCounts.ingredientId, qty: s.stockCounts.qty, factor: s.stockCounts.factor })
            .from(s.stockCounts)
            .where(and(eq(s.stockCounts.month, m), buSube, inArray(s.stockCounts.ingredientId, ids)))
        ).map((c) => [c.ingredientId, c]),
      );
      // Pasif ama aktif bir ürünün reçetesinde geçen malzeme listede kalır (engine.ts countable ile aynı kural)
      const inUse = await activeProductsUsing(
        tx,
        [...ings.values()].filter((i) => !i.active && i.countUnit).map((i) => i.id),
      );
      for (const e of filled) {
        const ing = ings.get(e.ingredientId);
        if (!ing) throw new UserError("Malzeme bulunamadı (sayfayı yenileyin)");
        const prev = existing.get(e.ingredientId);
        const countable = isCountable(ing, inUse.has(ing.id));
        if (!countable && !prev) throw new UserError(`${ing.name} sayım listesinde değil (pasif ya da “Sayılmaz”)`);
        // Pasif / sayılmaz malzemenin eski sayımı ve değişmeyen miktar eski birimiyle kalır; yeni girilen miktar bugünkü birimle
        const factor =
          !countable || (prev && prev.qty === e.qty) ? (prev?.factor ?? countFactor(ing.countUnit)) : countFactor(ing.countUnit);
        await tx
          .insert(s.stockCounts)
          .values({ month: m, branchId: sube, ingredientId: e.ingredientId, qty: e.qty!, factor, countedBy: me.name })
          .onConflictDoUpdate({
            // Benzersiz dizin (ay, şube, malzeme): şubesiz hedef çalışma anında düşer ("no unique or exclusion constraint")
            target: [s.stockCounts.month, s.stockCounts.branchId, s.stockCounts.ingredientId],
            set: { qty: e.qty!, factor, countedBy: me.name, updatedAt: new Date() },
          });
      }
      return deleted;
    });
    // İşlem geçmişi silinen sayımları da söyler ("2 sayım silindi"); hiçbir şey değişmediyse kayıt yazılmaz
    const parts = [filled.length ? `${filled.length} kalem` : "", removed ? `${removed} sayım silindi` : ""].filter(Boolean);
    if (parts.length) await logActivity(me, "Stok sayımı", `${monthLabel(m)}: ${parts.join(", ")}`);
    refresh();
    return { saved: filled.length, removed };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Sayımı silinen ayda başka hiçbir kayıt kalmadıysa (ay bilgisi, satış, gelir-gider, sayım, ek kalem) içi boş ay
 * satırını kaldırır; deneme için açılmış ay ay seçicide kalmaz. Değer taşıyan hiçbir kayıt silinmez (kasa raporu
 * olan ayda elle yazılmış 0 da değerdir: src/lib/cash-month.ts monthRowEmpty).
 */
async function dropEmptyStockMonth(tx: Tx, month: string, sube: string) {
  // Ay satırının anahtarı (ay, şube): şubesiz okuma ya da silme başka şubenin ayını düşürürdü
  const [row] = await tx.select().from(s.months).where(and(eq(s.months.month, month), eq(s.months.branchId, sube)));
  if (!row) return;
  const zeros = row.discounts === 0 || row.offRevenue === 0;
  if (!monthRowEmpty(row, zeros && (await hasTillRowsIn(month, tx)))) return;
  const [counts, extras, lines, pnl] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(s.stockCounts).where(and(eq(s.stockCounts.month, month), eq(s.stockCounts.branchId, sube))),
    tx.select({ n: sql<number>`count(*)::int` }).from(s.stockExtras).where(and(eq(s.stockExtras.month, month), eq(s.stockExtras.branchId, sube))),
    tx.select({ n: sql<number>`count(*)::int` }).from(s.salesLines).where(and(eq(s.salesLines.month, month), eq(s.salesLines.branchId, sube))),
    tx.select({ n: sql<number>`count(*)::int` }).from(s.pnlEntries).where(eq(s.pnlEntries.month, month)),
  ]);
  if ([counts, extras, lines, pnl].some((r) => (r[0]?.n ?? 0) > 0)) return;
  await tx.delete(s.months).where(and(eq(s.months.month, month), eq(s.months.branchId, sube)));
}

/**
 * "Listede olmayanlar", yönetici için (fiyatıyla). Ayı silip yeniden yazmaz: kalemler ad + birimle eşlenir, yalnız
 * yöneticinin formdan kaldırdığı satır silinir (planAdminExtras); arada başkasının kaydettiği liste üzerine yazılmaz.
 * Liste sayım gibi şube başına: seçili fiziksel şubenin listesi okunur, eşlenir ve yazılır; öbür şubenin aynı adlı
 * kalemi güncellenmez, silinmez (21 Kasım denetimi #19/#24).
 */
export async function saveStockExtras(month: string, extras: { name: string; unit: string; qty: number; unitPrice: number }[], base?: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const data = z
      .array(z.object({ name: zText("Ad", 120), unit: zText("Birim", 20), qty: z.number().finite().min(0), unitPrice: z.number().finite().min(0) }))
      .max(100)
      .parse(extras);
    const b = z.string().max(20_000).optional().parse(base);
    const db = getDb();
    const sube = (await currentPhysicalBranch()).id;
    const buSube = and(eq(s.stockExtras.month, m), eq(s.stockExtras.branchId, sube));
    const changed = await db.transaction(async (tx) => {
      const existing = await lockExtras(tx, m, sube, b);
      const res = planAdminExtras(existing, data);
      if (!res.ok) throw new UserError(res.error);
      const { updates, deletes, inserts } = res.plan;
      if (inserts.length) await tx.insert(s.months).values({ month: m, branchId: sube }).onConflictDoNothing();
      for (const u of updates)
        await tx
          .update(s.stockExtras)
          .set({ name: u.name, unit: u.unit, qty: u.qty, unitPrice: u.unitPrice })
          .where(and(eq(s.stockExtras.id, u.id), buSube));
      if (deletes.length) await tx.delete(s.stockExtras).where(and(buSube, inArray(s.stockExtras.id, deletes)));
      if (inserts.length) await tx.insert(s.stockExtras).values(inserts.map((d) => ({ ...d, month: m, branchId: sube })));
      if (!data.length) await dropEmptyStockMonth(tx, m, sube);
      return updates.length + deletes.length + inserts.length;
    });
    // "N kalem" değişen satır sayısı (personelin kaydıyla aynı anlam); değişiklik yoksa kayıt yazılmaz
    if (changed) await logActivity(me, "Sayım ek kalemleri", `${monthLabel(m)}: ${changed} kalem`);
    refresh();
    return null;
  });
}
