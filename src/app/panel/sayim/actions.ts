"use server";

import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_ID_MAX } from "@/lib/branches";
import { countItemLogDetail } from "@/lib/count-item";
import { monthLabel } from "@/lib/format";
import { logActivity } from "@/server/actions/log";
import { attempt, UserError, zMonth, zText } from "@/server/actions/util";
import { requireUser } from "@/server/auth/dal";
import { formCountBranch, withBranchScope } from "@/server/branch-scope";
import { countItemSchema, createCountItem } from "@/server/data/count-item";
import { lockExtras } from "@/server/data/stock-extras";
import { getDb, schema as s } from "@/server/db";

import { planStaffExtras, staffCountIssue } from "./logic";

/** Formun gösterdiği sayım şubesi (docs/SUBE.md › Yazarken hangi şube); göndermeyen eski sekmede seçili fiziksel şube */
const zFormBranch = z.string().max(BRANCH_ID_MAX).nullish();
const addSchema = countItemSchema.extend({ branchId: zFormBranch });

/**
 * Stok sayımı › "Listeye ekle" (yönetici ve personel): kalemi hemen hammadde olarak açar, onay beklemez. Kurallar ortak
 * çekirdekte (src/server/data/count-item.ts createCountItem; reçete önerisindeki "Yeni malzeme" de onu çağırır):
 * personel yalnız sayımını değiştirebildiği ayda ekler, aynı ad eklenmez, kalem gösterilen aydan itibaren listede,
 * paket fiyatı isteğe bağlı (yazılmazsa 0; ikisinde de "Tahmini"; yazılan fiyat fiyat geçmişinin başlangıcı olur, zam
 * uyarısı onu taban saymaz; yönetici Hammaddeler'den düzeltince başlangıç düzelir). Kalem işletme genelidir; aynı adlı
 * ek kalem uyarısı formun gösterdiği şubenin listesine bakar (`branchId`, formCountBranch).
 */
export async function addCountItem(input: z.input<typeof addSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const { branchId, ...data } = addSchema.parse(input);
    const sube = await formCountBranch(branchId);
    const created = await withBranchScope(sube, () => createCountItem(me, data, "sayim"));
    await logActivity(me, "Sayım listesine eklendi", countItemLogDetail({ ...created, countUnit: data.countUnit }));
    refresh();
    return {
      id: created.id,
      name: created.name,
      group: created.group,
      existed: created.existed,
      priced: created.packagePrice !== null,
      extraTwin: created.extraTwin ?? null,
    };
  });
}

/**
 * "Listede olmayanlar" kaydı, personel için (yönetici `saveStockExtras` ile fiyatıyla birlikte kaydeder).
 * Personel ad, birim ve miktar yazar; fiyatı görmez, değiştiremez. Kural `planStaffExtras`'ta:
 * kayıtlı satırın yalnızca miktarı değişir, yeni satırın fiyatı aynı kalemin son fiyatından gelir (yoksa 0),
 * fiyatlı satır personelce silinemez. Liste sayım gibi şube başına (docs/SUBE.md): formun gösterdiği şubenin listesi
 * okunur ve yazılır (`branchId`, formCountBranch: gönderim anındaki seçim değil; şubesine kilitli personelde yalnız kendi
 * şubesi). Göndermeyen eski sekmede seçili fiziksel şube ("Tümü" ya da online kanal seçiliyken Tuzla). Öbür şubenin
 * kalemi eşlenmez, ezilmez, silinmez (21 Kasım denetimi #19/#24).
 */
export async function saveStaffStockExtras(month: string, extras: { name: string; unit: string; qty: number }[], base?: string, branchId?: string | null) {
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
    const b = z.string().max(20_000).optional().parse(base);
    const sube = await formCountBranch(zFormBranch.parse(branchId));
    return withBranchScope(sube, async () => {
      const db = getDb();
      const buSube = and(eq(s.stockExtras.month, m), eq(s.stockExtras.branchId, sube));
      const { saved, changed } = await db.transaction(async (tx) => {
        // Aynı anda tek kayıt; formun gördüğü liste değiştiyse yazılmaz (yöneticinin kaydıyla aynı kapı)
        const existing = await lockExtras(tx, m, sube, b);
        // Fiyat geçmişi işletme geneli: fiyat şubeye göre değişmez, Marina'nın yeni satırı Tuzla'nın son fiyatını alır
        const history = await tx.select().from(s.stockExtras).where(lt(s.stockExtras.month, m));
        const res = planStaffExtras(existing, data, history);
        if (!res.ok) throw new UserError(res.error);
        const { updates, deletes, inserts } = res.plan;
        for (const u of updates) await tx.update(s.stockExtras).set({ qty: u.qty }).where(and(eq(s.stockExtras.id, u.id), buSube));
        if (deletes.length) await tx.delete(s.stockExtras).where(and(buSube, inArray(s.stockExtras.id, deletes)));
        if (inserts.length) {
          // Ay satırı da sayımın şubesinin (şubesiz yazılsaydı Marina'nın sayımı Tuzla'ya ay açardı)
          await tx.insert(s.months).values({ month: m, branchId: sube }).onConflictDoNothing();
          await tx.insert(s.stockExtras).values(inserts.map((x) => ({ ...x, month: m, branchId: sube })));
        }
        const rows = await tx.select().from(s.stockExtras).where(buSube).orderBy(asc(s.stockExtras.id));
        return { saved: rows, changed: updates.length + deletes.length + inserts.length };
      });
      // "N kalem" değişen satır sayısıdır (yöneticinin geç kayıt uyarısı bunu toplar; listenin tamamı değil). Değişiklik
      // yoksa kayıt yazılmaz
      if (changed) await logActivity(me, "Sayım ek kalemleri", `${monthLabel(m)}: ${changed} kalem`);
      refresh();
      return saved.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, priced: e.unitPrice > 0 }));
    });
  });
}
