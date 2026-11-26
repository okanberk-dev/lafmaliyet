// Oturum taklidi yapan veritabanı testleri için src/server/auth/dal'ın yetenek kapıları (docs/ROLLER.md): requireCan ve
// requireRole, taklit edilen oturumun rolünü src/lib/roles.ts'in tablosuyla sorar. Yetkisizde hata fırlatır (gerçek kapı
// kişiyi ana ekranına yönlendirirdi; testte ikisi de eylemi durdurur).

import type { Role } from "../../src/lib/constants";
import { can, type Capability } from "../../src/lib/roles";

export function dalCapabilities<T extends { role: string }>(user: () => T | Promise<T>) {
  return {
    requireCan: async (cap: Capability): Promise<T> => {
      const u = await user();
      if (!can(u.role as Role, cap)) throw new Error(`NEXT_REDIRECT yetkisiz (${cap})`);
      return u;
    },
    requireRole: async (...roles: Role[]): Promise<T> => {
      const u = await user();
      if (!roles.includes(u.role as Role)) throw new Error("NEXT_REDIRECT yetkisiz");
      return u;
    },
  };
}
