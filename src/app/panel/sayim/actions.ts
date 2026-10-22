"use server";

import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { countUnitsFor } from "@/lib/calc/engine";
import { BASE_UNIT, cleanName, COUNT_ITEM_NAME_MAX, COUNT_ITEM_NAME_MIN, duplicateMessage, findDuplicate, groupDefaults, nextSortOrder } from "@/lib/count-item";
import { dateTR, monthLabel } from "@/lib/format";
import { logActivity } from "@/server/actions/log";
import { attempt, UserError, zMonth, zOptText, zText } from "@/server/actions/util";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { planStaffExtras, staffCountMonths, todayTR } from "./logic";

const countItemSchema = z.object({
  month: zMonth,
  name: z
    .string({ message: "Kalemin adını yazın" })
    .transform(cleanName)
    .pipe(z.string().min(COUNT_ITEM_NAME_MIN, `Ad en az ${COUNT_ITEM_NAME_MIN} harf olmalı`).max(COUNT_ITEM_NAME_MAX, "Ad çok uzun")),
  group: zText("Grup", 80),
  countUnit: z.enum(["KG", "LT", "ADET", "DİLİM"], { message: "Sayım birimini seçin" }),
  packageDesc: zOptText(160),
  packageSize: z.number({ message: "Paket içeriğini yazın" }).finite("Paket içeriğini yazın").positive("Paket içeriği 0'dan büyük olmalı").max(1_000_000, "Paket içeriği çok büyük"),
});

/**
 * Stok sayımı › "Listeye ekle" (yönetici ve personel): kalemi hemen hammadde olarak açar, onay beklemez; bu aydan
 * itibaren her ay sayım listesinde çıkar. Fiyatı bilinmediği için paket fiyatı 0 ve "Tahmini"; yönetici Hammaddeler'den
 * girer (zilde "Fiyatı girilmemiş N hammadde"). Fiyat geçmişine 0 yazılmaz: ilk gerçek fiyat zam gibi görünmesin
 * (price-impact.ts ingredientChanges ilk satırı başlangıç sayar). Personel yalnız sayımını değiştirebildiği ayda ekler.
 * Aynı ad (Türkçe büyük/küçük harf ve boşluk farkı gözetmeden; pasif ya da "Sayılmaz" olanlar dahil) varsa eklenmez.
 */
export async function addCountItem(input: z.input<typeof countItemSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = countItemSchema.parse(input);
    const m = data.month;
    if (me.role !== "admin" && !staffCountMonths().includes(m)) {
      throw new UserError("Personel yalnız bu ayın ve geçen ayın sayımına kalem ekleyebilir; daha eski bir ay için yöneticiye yazın");
    }
    const unit = BASE_UNIT[data.countUnit];
    if (!countUnitsFor(unit).includes(data.countUnit)) throw new UserError("Sayım birimini seçin");
    const created = await getDb().transaction(async (tx) => {
      // Aynı adı iki kişi aynı anda eklemesin (büyük/küçük harf farkı ad sütununun benzersiz dizininden kaçar)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sayim-listeye-ekle'))`);
      const rows = await tx
        .select({
          name: s.ingredients.name,
          category: s.ingredients.category,
          vatRate: s.ingredients.vatRate,
          active: s.ingredients.active,
          countUnit: s.ingredients.countUnit,
          countGroup: s.ingredients.countGroup,
          sortOrder: s.ingredients.sortOrder,
        })
        .from(s.ingredients)
        .orderBy(asc(s.ingredients.sortOrder), asc(s.ingredients.id));
      const dup = findDuplicate(data.name, rows);
      if (dup) throw new UserError(duplicateMessage(dup, me.role));
      if (!rows.some((r) => r.countGroup === data.group)) throw new UserError("Bu sayım grubu bulunamadı; sayfayı yenileyin");
      const defaults = groupDefaults(rows, data.group);
      const [row] = await tx
        .insert(s.ingredients)
        .values({
          name: data.name,
          category: defaults.category,
          supplier: null,
          packageDesc: data.packageDesc,
          packagePrice: 0,
          packageSize: data.packageSize,
          unit,
          vatRate: defaults.vatRate,
          note: `Sayım listesine ${me.name} ekledi (${dateTR(todayTR())}).`,
          isEstimate: true,
          priceSource: "manual",
          countUnit: data.countUnit,
          countGroup: data.group,
          sortOrder: nextSortOrder(rows),
          active: true,
        })
        .returning({ id: s.ingredients.id, name: s.ingredients.name });
      return row;
    });
    await logActivity(me, "Sayım listesine eklendi", `${created.name} · ${data.group} · ${data.countUnit}`);
    refresh();
    return { id: created.id, name: created.name, group: data.group };
  });
}

/**
 * "Listede olmayanlar" kaydı, personel için (yönetici `saveStockExtras` ile fiyatıyla birlikte kaydeder).
 * Personel ad, birim ve miktar yazar; fiyatı görmez, değiştiremez. Kural `planStaffExtras`'ta:
 * kayıtlı satırın yalnızca miktarı değişir, yeni satırın fiyatı aynı kalemin son fiyatından gelir (yoksa 0),
 * fiyatlı satır personelce silinemez.
 */
export async function saveStaffStockExtras(month: string, extras: { name: string; unit: string; qty: number }[]) {
  return attempt(async () => {
    const me = await requireUser();
    const m = zMonth.parse(month);
    if (me.role !== "admin" && !staffCountMonths().includes(m)) {
      throw new UserError("Personel yalnız bu ayın ve geçen ayın sayımını değiştirebilir; daha eski bir ay için yöneticiye yazın");
    }
    const data = z
      .array(z.object({ name: zText("Kalem adı", 120), unit: zText("Birim", 20), qty: z.number().finite().min(0, "Miktar negatif olamaz") }))
      .max(100)
      .parse(extras);
    const db = getDb();
    const saved = await db.transaction(async (tx) => {
      const existing = await tx.select().from(s.stockExtras).where(eq(s.stockExtras.month, m)).orderBy(asc(s.stockExtras.id));
      const history = await tx.select().from(s.stockExtras).where(lt(s.stockExtras.month, m));
      const res = planStaffExtras(existing, data, history);
      if (!res.ok) throw new UserError(res.error);
      const { updates, deletes, inserts } = res.plan;
      for (const u of updates) await tx.update(s.stockExtras).set({ qty: u.qty }).where(and(eq(s.stockExtras.id, u.id), eq(s.stockExtras.month, m)));
      if (deletes.length) await tx.delete(s.stockExtras).where(and(eq(s.stockExtras.month, m), inArray(s.stockExtras.id, deletes)));
      if (inserts.length) await tx.insert(s.stockExtras).values(inserts.map((x) => ({ ...x, month: m })));
      return tx.select().from(s.stockExtras).where(eq(s.stockExtras.month, m)).orderBy(asc(s.stockExtras.id));
    });
    await logActivity(me, "Sayım ek kalemleri", `${monthLabel(m)}: ${saved.length} kalem`);
    refresh();
    return saved.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, priced: e.unitPrice > 0 }));
  });
}
