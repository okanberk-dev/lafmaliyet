import "server-only";

import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import type { StaffLinkOptions } from "@/lib/staff-link";
import { branchWhere, currentBranchScope } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Maaşlar'ın Vardiya / hesap seçicisinin seçenekleri (Faz 5; src/lib/staff-link.ts): panel hesapları (ad, e-posta, şube)
 * ve Vardiya'da hesabı olmadan adıyla yazılmış kişiler (şube başına, en son yazılan adıyla). Yalnız yönetici ekranı okur;
 * hiçbiri kendiliğinden seçilmez.
 *
 * Tek şube seçiliyken (şube ayrımı doğrulaması, 27 Kasım 2026) o şubenin ve şubesiz hesaplar (yönetici, muhasebeci,
 * şubesi seçilmemiş personel: her şubede çalışabilir) ve yalnız o şubenin vardiyasındaki adlar; Maaşlar'ın listesi de
 * o şubenin. Önceden Marina seçiliyken seçici Tuzla'nın hesaplarını ve Tuzla'nın vardiyasındaki adları da listeliyordu.
 * `scope` verilmezse isteğin seçimi
 */
export async function loadStaffLinkOptions(scope?: BranchScope): Promise<StaffLinkOptions> {
  const db = getDb();
  const sc = scope ?? (await currentBranchScope());
  const [users, shiftNames] = await Promise.all([
    db
      .select({ id: s.users.id, name: s.users.name, email: s.users.email, branchId: s.users.branchId, active: s.users.active })
      .from(s.users)
      .where(sc === ALL_BRANCHES ? undefined : or(isNull(s.users.branchId), eq(s.users.branchId, sc)))
      .orderBy(asc(s.users.name)),
    db
      .selectDistinctOn([s.shifts.branchId, s.shifts.personRef], { ref: s.shifts.personRef, name: s.shifts.personName, branchId: s.shifts.branchId })
      .from(s.shifts)
      .where(and(like(s.shifts.personRef, "n:%"), branchWhere(s.shifts.branchId, sc)))
      .orderBy(asc(s.shifts.branchId), asc(s.shifts.personRef), desc(s.shifts.date)),
  ]);
  return { users, names: shiftNames.sort((a, b) => a.name.localeCompare(b.name, "tr")) };
}

/**
 * Maaş satırı bağlantılarının işlem kilidi (inceleme bulgusu 6). staff.user_id'de veritabanı tekilliği yok: kural "bir hesap
 * bir şubede aynı ayda tek satıra" (bir şubede aralığı çakışan iki satır aynı kişiyi gösteremez), aralığa bağlı olduğundan
 * bir indeksle yazılamaz. Denetim (checkStaffLinks, linkConflict) ve yazım bu kilidi tutan işlemde yapılır; kilidi tutan öteki kayıt
 * (saveStaff, endStaff, deleteUser) bitene kadar beklenir ve READ COMMITTED'da sonraki okuma onun yazdığını görür. Böylece iki
 * yöneticinin aynı anda kaydı aynı hesabı aralığı çakışan iki satıra bağlayamaz, maaş satırına o an bağlanan hesap da
 * silinemez (denetim bulgusu 47).
 *
 * Biten satır ile "Devam ettir"in açtığı yeni satır (aralıkları ayrık) aynı hesaba bağlı kalabilir: eski satırın geçmiş
 * ayları kendi bağlantısıyla sayılır. Bu yüzden bir hesaba bir şubede birden çok satır düşebilir; LM-4b'nin personel listesi
 * (GET /api/panel/pos/personel?sube=…, "bu ay ve geçen ay aralıktaki satırlar") şubede hesap başına TEK öğe vermelidir
 * (docs/VARDIYA.md).
 */
export async function lockStaffLinks(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('personel-baglanti'))`);
}

/** Hesaba bağlı maaş satırlarının adları, biten satırlar da (geçmiş ayların ücreti ve yemek kartı günü bu bağlantıdan) */
export async function staffLinkedTo(db: Pick<DB, "select">, userId: number): Promise<string[]> {
  const rows = await db.select({ name: s.staff.name }).from(s.staff).where(eq(s.staff.userId, userId)).orderBy(asc(s.staff.id));
  return [...new Set(rows.map((r) => r.name))];
}
