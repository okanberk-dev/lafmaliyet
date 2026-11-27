import "server-only";

import { and, asc, count, eq, isNotNull, isNull, ne, or } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { getDb, schema as s } from "@/server/db";

/** Kullanıcılar & roller'in satırı (parola özeti yalnız davetin durumunu okumak için; istemciye gitmez) */
export interface UserListRow {
  id: number;
  name: string;
  email: string;
  role: (typeof s.users.$inferSelect)["role"];
  branchId: string | null;
  active: boolean;
  lastLoginAt: Date | null;
  totpEnabled: boolean;
  lockedUntil: Date | null;
  passwordHash: string;
}

/**
 * Kullanıcılar & roller'in hesap listesi (şube ayrımı doğrulaması, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı): "Tümü"de
 * bütün hesaplar; tek şube seçiliyken o şubenin hesapları ve şubesiz hesaplar (yönetici, muhasebeci, şubesi seçilmemiş
 * personel: her şubede görünür, `assignablePeople` gibi). Öbür şubelerin hesapları listede yok, sayısı `elsewhere`'de
 * ("Öbür şubelerin N hesabı Tümü'de"). Önceden Marina seçiliyken Tuzla'nın müdürü ve personeli de listeleniyordu.
 * Hesabın yazımı (saveUser, rol, şube) seçimden bağımsız: eylemler hesabın kimliğiyle çalışır
 */
export async function loadUserRows(scope: BranchScope): Promise<{ rows: UserListRow[]; elsewhere: number }> {
  const u = s.users;
  const db = getDb();
  const [rows, [other]] = await Promise.all([
    db
      .select({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        branchId: u.branchId,
        active: u.active,
        lastLoginAt: u.lastLoginAt,
        totpEnabled: u.totpEnabled,
        lockedUntil: u.lockedUntil,
        passwordHash: u.passwordHash,
      })
      .from(u)
      .where(scope === ALL_BRANCHES ? undefined : or(isNull(u.branchId), eq(u.branchId, scope)))
      .orderBy(asc(u.id)),
    scope === ALL_BRANCHES
      ? Promise.resolve([{ n: 0 }])
      : db
          .select({ n: count() })
          .from(u)
          .where(and(isNotNull(u.branchId), ne(u.branchId, scope))),
  ]);
  return { rows, elsewhere: other?.n ?? 0 };
}
