import "server-only";

import { and, asc, gt, isNull, lt } from "drizzle-orm";

import type { UserRow } from "@/app/panel/kullanicilar/users-client";
import type { AdayHesap } from "@/app/yonetim/(konsol)/yoneticiler/yoneticiler-client";
import { adminTwoFactorRequired } from "@/lib/admin-security";
import { isAnaAdminEmail } from "@/lib/asil-yonetici";
import { dateTimeTR } from "@/lib/format";
import { isPendingInvite, MAX_TOKEN_ATTEMPTS } from "@/server/auth/tokens";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { isEmailConfigured } from "@/server/notify/resend";

/*
 * Yönetim konsolu › Yöneticiler'in verisi (docs/ROLLER.md › Yönetici hesapları; sayfa
 * src/app/yonetim/(konsol)/yoneticiler/page.tsx). Satırlar ladmin › Kullanıcılar'ın satırıyla aynı biçimde (UserRow):
 * aynı "Giriş bilgileri" penceresi, aynı onay metinleri. Parola özeti, iki adımlı anahtarı ve kurtarma kodlarının
 * özetleri istemciye gitmez; kalan kurtarma kodu yalnız sayı olarak. "Giriş bilgileri"ndeki panel adresi sunucunun
 * döndürdüğü APP_URL'dir (konsol bağlantıyı kendi adresinden kurmaz).
 */

export interface YoneticiVerisi {
  /** Yönetici rolündeki hesaplar (asıl yönetici başta) */
  yoneticiler: UserRow[];
  adaylar: AdayHesap[];
  /** Müdürün (zorunlu) ve personelin (isteğe bağlı) bağlanabileceği şubeler: etkin fiziksel şubeler */
  subeler: { id: string; name: string }[];
  /** Asıl yöneticinin kendi hesabı: iki adımlı açık mı, açıksa kalan kurtarma kodu */
  benim: { ikiAdim: boolean; kalanKod: number };
  emailConfigured: boolean;
  twoFactorRequired: boolean;
}

export async function yoneticiHesaplariVerisi(meId: number): Promise<YoneticiVerisi> {
  const db = getDb();
  const now = new Date();
  const u = s.users;
  const [rows, links, deviceLocks, branches] = await Promise.all([
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
        recoveryCodes: u.recoveryCodes,
      })
      .from(u)
      .orderBy(asc(u.name), asc(u.id)),
    // Kullanılmamış, süresi geçmemiş, deneme sınırına takılmamış bağlantılar (Kullanıcılar sayfasıyla aynı kural)
    db
      .select({ userId: s.userTokens.userId, kind: s.userTokens.kind, until: s.userTokens.expiresAt })
      .from(s.userTokens)
      .where(and(isNull(s.userTokens.usedAt), gt(s.userTokens.expiresAt, now), lt(s.userTokens.attempts, MAX_TOKEN_ATTEMPTS)))
      .orderBy(asc(s.userTokens.expiresAt)),
    db.selectDistinct({ userId: s.loginDeviceLocks.userId }).from(s.loginDeviceLocks).where(gt(s.loginDeviceLocks.lockedUntil, now)),
    listBranches(db),
  ]);
  const live = new Map(links.map((l) => [l.userId, { kind: l.kind, until: dateTimeTR(l.until) }]));
  const deviceLocked = new Set(deviceLocks.map((l) => l.userId));
  const yoneticiler: UserRow[] = rows
    .filter((r) => r.role === "admin")
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      branchId: null,
      active: r.active,
      lastLoginAt: r.lastLoginAt ? dateTimeTR(r.lastLoginAt) : null,
      twoFactor: r.totpEnabled,
      locked: r.lockedUntil && r.lockedUntil > now ? "account" : deviceLocked.has(r.id) ? "device" : null,
      invite: isPendingInvite(r.passwordHash) ? (live.has(r.id) ? "pending" : "expired") : "none",
      liveLink: live.get(r.id) ?? null,
      anaAdmin: isAnaAdminEmail(r.email),
    }));
  // Asıl yönetici başta, sonra ada göre
  yoneticiler.sort((a, b) => Number(Boolean(b.anaAdmin)) - Number(Boolean(a.anaAdmin)));
  const adaylar: AdayHesap[] = rows.flatMap((r) =>
    r.role === "admin" ? [] : [{ id: r.id, name: r.name, email: r.email, role: r.role, active: r.active, branchId: r.branchId ?? null }],
  );
  const self = rows.find((r) => r.id === meId);
  return {
    yoneticiler,
    adaylar,
    subeler: branches.filter((b) => b.kind === "fiziksel" && b.active).map((b) => ({ id: b.id, name: b.name })),
    benim: { ikiAdim: Boolean(self?.totpEnabled), kalanKod: self?.totpEnabled ? (self.recoveryCodes?.length ?? 0) : 0 },
    emailConfigured: isEmailConfigured(),
    twoFactorRequired: adminTwoFactorRequired(),
  };
}
