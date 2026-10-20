import "server-only";

import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

import { generateToken, hashToken, isTokenShaped, tokenExpiry, tokenMatches, type TokenKind } from "./tokens";

/**
 * Davet ve sıfırlama bağlantılarının veritabanı tarafı. Bir kullanıcının aynı anda tek geçerli bağlantısı olur:
 * yenisi oluşunca eskilerinin süresi hemen biter (kaybolan bağlantı yeniden oluşturulunca eskisi çalışmaz; satır
 * kalır ki saatlik sıfırlama sınırı sayılabilsin). 30 günden eski satırlar silinir.
 */
export async function issueUserToken(userId: number, kind: TokenKind, hours: number): Promise<{ raw: string; expiresAt: Date }> {
  const raw = generateToken();
  const expiresAt = tokenExpiry(hours);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.delete(s.userTokens).where(lt(s.userTokens.expiresAt, new Date(now.getTime() - 30 * 86_400_000)));
    await tx
      .update(s.userTokens)
      .set({ expiresAt: now })
      .where(and(eq(s.userTokens.userId, userId), isNull(s.userTokens.usedAt), gt(s.userTokens.expiresAt, now)));
    await tx.insert(s.userTokens).values({ userId, kind, tokenHash: hashToken(raw), expiresAt });
  });
  return { raw, expiresAt };
}

export type LoadedToken = {
  token: typeof s.userTokens.$inferSelect;
  user: { id: number; name: string; email: string; active: boolean; passwordHash: string };
};

/** Ham anahtarın kaydı ve sahibi; biçimi tutmayan ya da bilinmeyen anahtar için null */
export async function loadToken(raw: unknown): Promise<LoadedToken | null> {
  if (!isTokenShaped(raw)) return null;
  const [row] = await getDb()
    .select({
      token: s.userTokens,
      user: { id: s.users.id, name: s.users.name, email: s.users.email, active: s.users.active, passwordHash: s.users.passwordHash },
    })
    .from(s.userTokens)
    .innerJoin(s.users, eq(s.users.id, s.userTokens.userId))
    .where(eq(s.userTokens.tokenHash, hashToken(raw)))
    .limit(1);
  // Dizin araması özetle yapılır; eşleşme yine de sabit süreli karşılaştırmayla doğrulanır
  if (!row || !tokenMatches(raw, row.token.tokenHash)) return null;
  return row;
}

/** Parola denemesini sayar (bağlantı başına sınır); yeni deneme sayısını döndürür */
export async function countTokenAttempt(tokenId: number): Promise<number> {
  const [row] = await getDb()
    .update(s.userTokens)
    .set({ attempts: sql`${s.userTokens.attempts} + 1` })
    .where(eq(s.userTokens.id, tokenId))
    .returning({ attempts: s.userTokens.attempts });
  return row?.attempts ?? Number.POSITIVE_INFINITY;
}

/**
 * Bağlantıyı kullanılmış sayar ve parolayı yazar (tek işlem). Bağlantı bu arada kullanıldıysa ya da süresi
 * dolduysa false. Kişinin oturum sürümü artar (açık oturumları kapanır), hatalı deneme kilidi açılır, kalan
 * bağlantılarının süresi biter. Oturum açılmaz: aynı tarayıcıdaki başka sekmelerin çerezine dokunulmaz.
 */
export async function consumeTokenAndSetPassword(tokenId: number, userId: number, passwordHash: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const [used] = await tx
      .update(s.userTokens)
      .set({ usedAt: now })
      .where(and(eq(s.userTokens.id, tokenId), isNull(s.userTokens.usedAt), gt(s.userTokens.expiresAt, now)))
      .returning({ id: s.userTokens.id });
    if (!used) return false;
    await tx
      .update(s.users)
      .set({ passwordHash, failedLogins: 0, lockedUntil: null, sessionVersion: sql`${s.users.sessionVersion} + 1` })
      .where(eq(s.users.id, userId));
    await tx
      .update(s.userTokens)
      .set({ expiresAt: now })
      .where(and(eq(s.userTokens.userId, userId), isNull(s.userTokens.usedAt), gt(s.userTokens.expiresAt, now), ne(s.userTokens.id, tokenId)));
    return true;
  });
}

/** Kişiye son `minutes` dakikada oluşturulan sıfırlama bağlantısı sayısı ("Parolamı unuttum" sınırı) */
export async function recentResetCount(userId: number, minutes: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.userTokens)
    .where(and(eq(s.userTokens.userId, userId), eq(s.userTokens.kind, "reset"), gt(s.userTokens.createdAt, new Date(Date.now() - minutes * 60_000))));
  return row?.n ?? 0;
}
