// Kör sayımı bir şubede geçici olarak kapatır (veritabanı testleri). Tuzla'da kör sayım seçilmemişken açıktır
// (Dalga 2; docs/KASA-RAPORU.md › Kör sayım): personelin raporu önce kilitlenen sayımı bekler. Konusu kör sayım olmayan
// testler (düzeltme isteği, fişsiz çıkış…) personelin raporunu eskisi gibi doğrudan yazar; kör sayımın kendisi
// tests/kor-sayim-db.test.ts'te. Döner: ayarı testten önceki hâline geri yazan işlev (after'da çağrılır).

import { and, eq } from "drizzle-orm";

import type { DB } from "../../src/server/db";
import * as s from "../../src/server/db/schema";

export async function blindCountOff(db: DB, branchId: string): Promise<() => Promise<void>> {
  const where = and(eq(s.branchSettings.branchId, branchId), eq(s.branchSettings.grp, "kasa.kor"));
  const saved = await db.select().from(s.branchSettings).where(where);
  await db.delete(s.branchSettings).where(where);
  await db.insert(s.branchSettings).values({ branchId, grp: "kasa.kor", value: { enabled: false }, secrets: null, sameAs: null, updatedBy: "test" });
  return async () => {
    await db.delete(s.branchSettings).where(where);
    if (saved.length) await db.insert(s.branchSettings).values(saved);
  };
}
