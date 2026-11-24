import "server-only";

import { asc, desc, like } from "drizzle-orm";

import type { StaffLinkOptions } from "@/lib/staff-link";
import { getDb, schema as s } from "@/server/db";

/**
 * Maaşlar'ın Vardiya / hesap seçicisinin seçenekleri (Faz 5; src/lib/staff-link.ts): panel hesapları (ad, e-posta, şube)
 * ve Vardiya'da hesabı olmadan adıyla yazılmış kişiler (şube başına, en son yazılan adıyla). Yalnız yönetici ekranı okur;
 * hiçbiri kendiliğinden seçilmez.
 */
export async function loadStaffLinkOptions(): Promise<StaffLinkOptions> {
  const db = getDb();
  const [users, shiftNames] = await Promise.all([
    db
      .select({ id: s.users.id, name: s.users.name, email: s.users.email, branchId: s.users.branchId, active: s.users.active })
      .from(s.users)
      .orderBy(asc(s.users.name)),
    db
      .selectDistinctOn([s.shifts.branchId, s.shifts.personRef], { ref: s.shifts.personRef, name: s.shifts.personName, branchId: s.shifts.branchId })
      .from(s.shifts)
      .where(like(s.shifts.personRef, "n:%"))
      .orderBy(asc(s.shifts.branchId), asc(s.shifts.personRef), desc(s.shifts.date)),
  ]);
  return { users, names: shiftNames.sort((a, b) => a.name.localeCompare(b.name, "tr")) };
}
