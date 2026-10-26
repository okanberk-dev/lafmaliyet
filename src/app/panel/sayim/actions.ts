"use server";

import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { countItemLogDetail } from "@/lib/count-item";
import { monthLabel } from "@/lib/format";
import { logActivity } from "@/server/actions/log";
import { attempt, UserError, zMonth, zText } from "@/server/actions/util";
import { requireUser } from "@/server/auth/dal";
import { countItemSchema, createCountItem } from "@/server/data/count-item";
import { getDb, schema as s } from "@/server/db";

import { planStaffExtras, staffCountIssue } from "./logic";

/**
 * Stok sayımı › "Listeye ekle" (yönetici ve personel): kalemi hemen hammadde olarak açar, onay beklemez. Kurallar ortak
 * çekirdekte (src/server/data/count-item.ts createCountItem; reçete önerisindeki "Yeni malzeme" de onu çağırır):
 * personel yalnız sayımını değiştirebildiği ayda ekler, aynı ad eklenmez, kalem gösterilen aydan itibaren listede,
 * paket fiyatı isteğe bağlı (yazılmazsa 0; ikisinde de "Tahmini"; yazılan fiyat fiyat geçmişinin başlangıcı olur, zam
 * uyarısı onu taban saymaz; yönetici Hammaddeler'den düzeltince başlangıç düzelir).
 */
export async function addCountItem(input: z.input<typeof countItemSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = countItemSchema.parse(input);
    const created = await createCountItem(me, data, "sayim");
    await logActivity(me, "Sayım listesine eklendi", countItemLogDetail({ ...created, countUnit: data.countUnit }));
    refresh();
    return { id: created.id, name: created.name, group: created.group, existed: created.existed, priced: created.packagePrice !== null };
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
    // Personel bu ayı, geçen ayı yalnız ayın ilk 10 gününde değiştirir (sayim/logic.ts staffCountIssue)
    const monthIssue = staffCountIssue(me.role, m);
    if (monthIssue) throw new UserError(monthIssue);
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
