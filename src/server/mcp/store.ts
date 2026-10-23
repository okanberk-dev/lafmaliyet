// "server-only" yok: veritabanıyla gidip gelen test (tests/claude-baglanti-db.test.ts) bu dosyayı doğrudan çalıştırır
// (yedeğin src/server/backup/core.ts'i gibi). Her işlev veritabanını parametre alır; "use client" dosyası buraya
// uzanamaz (tests/claude-guvenlik.test.ts).

import { and, count, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  accessExpiry,
  canonicalResource,
  CODE_TTL_S,
  grantExpiry,
  refreshDecision,
  refreshExpiry,
} from "@/lib/mcp/oauth";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

import { hashMcpToken, isMcpTokenShaped, mcpTokenMatches, newClientId, newToken, pkceMatches } from "./tokens";

/*
 * Claude bağlantısının veritabanı tarafı (docs/CLAUDE-BAGLANTISI.md): istemciler, yetki kodları, bağlantılar,
 * anahtarlar ve araç çağrılarının kaydı. Kurallar src/lib/mcp/oauth.ts'te (saf); burada yazımlar tek işlemde ve
 * koşullu UPDATE'lerle yapılır: aynı kod ya da yenileme anahtarıyla eşzamanlı iki istek ikisi birden geçemez.
 * Ham anahtar hiçbir zaman yazılmaz (yalnız sha256 özeti), günlüğe de düşmez.
 */

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Db = DB | Tx;

export type ClientRow = typeof s.mcpClients.$inferSelect;

/** Doğrulanmış erişim anahtarının sahibi (araçlar ve çağrı kaydı bunu kullanır) */
export interface Principal {
  grantId: number;
  userId: number;
  userName: string;
  clientId: string;
  scopes: string[];
  resource: string;
  /** Anahtarın bitişi (saniye) */
  expiresAt: number;
}

/** İşlem geçmişine düşecek olay: yeni bağlantı ya da güvenlik için kapatılan bağlantı */
export type GrantEvent = { kind: "created" | "security-revoked"; grantId: number; userName: string; host: string; why?: string };

export type TokenError = "invalid_grant" | "invalid_client" | "invalid_request" | "invalid_target" | "invalid_scope";

export type TokenResult =
  | {
      ok: true;
      body: { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };
      event?: GrantEvent;
    }
  | { ok: false; status: 400 | 401; error: TokenError; description: string; event?: GrantEvent };

/** kullanici | istemci | yeniden-kullanim | kod-tekrari | oturum | suresi-doldu */
export type RevokeReason = "kullanici" | "istemci" | "yeniden-kullanim" | "kod-tekrari" | "oturum" | "suresi-doldu";

const fail = (error: TokenError, description: string, event?: GrantEvent): TokenResult => ({ ok: false, status: 400, error, description, ...(event ? { event } : {}) });

// ---------------------------------------------------------------- İstemciler

export async function findClient(db: Db, clientId: string): Promise<ClientRow | null> {
  const [row] = await db.select().from(s.mcpClients).where(eq(s.mcpClients.clientId, clientId)).limit(1);
  return row ?? null;
}

export async function registerDcrClient(db: Db, v: { name: string; redirectUris: string[] }): Promise<ClientRow> {
  const [row] = await db.insert(s.mcpClients).values({ clientId: newClientId(), kind: "dcr", name: v.name, redirectUris: v.redirectUris }).returning();
  return row;
}

/** `since`tan sonra kaydolup hiç bağlanmamış (bağlantısı olmayan) DCR istemcileri: günlük kayıt tavanı */
export async function pendingDcrCount(db: Db, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(s.mcpClients)
    .where(
      and(
        eq(s.mcpClients.kind, "dcr"),
        gt(s.mcpClients.createdAt, since),
        sql`not exists (select 1 from ${s.mcpGrants} where ${s.mcpGrants.clientId} = ${s.mcpClients.id})`,
      ),
    );
  return row?.n ?? 0;
}

/** CIMD belgesinin okunuşu: istemci yoksa eklenir, varsa adı, dönüş adresleri ve okunuş anı yenilenir */
export async function upsertCimdClient(db: Db, url: string, v: { name: string; redirectUris: string[] }, now: Date): Promise<ClientRow> {
  const [row] = await db
    .insert(s.mcpClients)
    .values({ clientId: url, kind: "cimd", name: v.name, redirectUris: v.redirectUris, fetchedAt: now })
    .onConflictDoUpdate({ target: s.mcpClients.clientId, set: { name: v.name, redirectUris: v.redirectUris, fetchedAt: now } })
    .returning();
  return row;
}

// ---------------------------------------------------------------- Yetki kodu

/** Onay ekranında "İzin ver": 2 dakikalık tek kullanımlık kod (ham kod yalnız Claude'a döner) */
export async function issueCode(
  db: Db,
  v: { userId: number; clientDbId: number; redirectUri: string; codeChallenge: string; scope: string; resource: string; sessionVersion: number },
  now: Date,
): Promise<{ raw: string; id: number }> {
  const raw = newToken("ac");
  const [row] = await db
    .insert(s.mcpCodes)
    .values({
      codeHash: hashMcpToken(raw),
      userId: v.userId,
      clientId: v.clientDbId,
      redirectUri: v.redirectUri,
      codeChallenge: v.codeChallenge,
      scope: v.scope,
      resource: v.resource,
      sessionVersion: v.sessionVersion,
      expiresAt: new Date(now.getTime() + CODE_TTL_S * 1000),
    })
    .returning({ id: s.mcpCodes.id });
  return { raw, id: row.id };
}

/** Bağlantı hâlâ geçerli mi: kapatılmamış, süresi dolmamış, kullanıcı etkin yönetici ve oturum sürümü aynı */
const liveGrant = (now: Date) =>
  and(
    isNull(s.mcpGrants.revokedAt),
    gt(s.mcpGrants.expiresAt, now),
    eq(s.users.active, true),
    eq(s.users.role, "admin"),
    eq(s.users.sessionVersion, s.mcpGrants.sessionVersion),
  );

export async function activeGrantCount(db: Db, userId: number, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(s.mcpGrants)
    .innerJoin(s.users, eq(s.users.id, s.mcpGrants.userId))
    .where(and(eq(s.mcpGrants.userId, userId), liveGrant(now)));
  return row?.n ?? 0;
}

/** Bağlantıyı ve bütün anahtarlarını kapatır (zaten kapalıysa dokunmaz); kapandıysa satırı */
async function closeGrant(tx: Db, grantId: number, reason: RevokeReason, now: Date): Promise<{ redirectHost: string; userId: number } | null> {
  const [g] = await tx
    .update(s.mcpGrants)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(s.mcpGrants.id, grantId), isNull(s.mcpGrants.revokedAt)))
    .returning({ redirectHost: s.mcpGrants.redirectHost, userId: s.mcpGrants.userId });
  await tx
    .update(s.mcpTokens)
    .set({ revokedAt: now })
    .where(and(eq(s.mcpTokens.grantId, grantId), isNull(s.mcpTokens.revokedAt)));
  return g ?? null;
}

async function userName(tx: Db, userId: number): Promise<string> {
  const [u] = await tx.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, userId)).limit(1);
  return u?.name ?? "?";
}

/** Erişim ve yenileme anahtarı çifti (ikisi de bağlantının bitişini geçmez) */
async function issuePair(tx: Db, grant: { id: number; expiresAt: Date; scope: string }, now: Date) {
  const access = newToken("at");
  const refresh = newToken("rt");
  const accessExp = accessExpiry(now, grant.expiresAt);
  const rows = await tx
    .insert(s.mcpTokens)
    .values([
      { grantId: grant.id, kind: "access", tokenHash: hashMcpToken(access), expiresAt: accessExp },
      { grantId: grant.id, kind: "refresh", tokenHash: hashMcpToken(refresh), expiresAt: refreshExpiry(now, grant.expiresAt) },
    ])
    .returning({ id: s.mcpTokens.id, kind: s.mcpTokens.kind });
  const r = rows.find((x) => x.kind === "refresh")!;
  return {
    refreshId: r.id,
    body: {
      access_token: access,
      token_type: "Bearer" as const,
      expires_in: Math.max(1, Math.floor((accessExp.getTime() - now.getTime()) / 1000)),
      refresh_token: refresh,
      scope: grant.scope,
    },
  };
}

/**
 * Kodu anahtarlara çevirir (RFC 6749 §4.1.3 + PKCE). Sıra: kod, istemci, dönüş adresi, doğrulayıcı (PKCE) ve kaynak
 * tutmalı; sonra kod koşullu UPDATE ile tek kullanımlık harcanır. Doğrulayıcısı tutan ikinci kullanım kod tekrarıdır:
 * o koddan açılan bağlantı kapatılır. Kullanıcı hâlâ etkin yönetici ve oturum sürümü değişmemiş olmalı.
 */
export async function exchangeCode(
  db: DB,
  v: { code: unknown; clientId: string; redirectUri: string | null; codeVerifier: unknown; resource: string | null },
  now: Date,
): Promise<TokenResult> {
  if (!isMcpTokenShaped(v.code, "ac")) return fail("invalid_grant", "Kod geçersiz");
  const raw = v.code;
  return db.transaction(async (tx) => {
    const [code] = await tx.select().from(s.mcpCodes).where(eq(s.mcpCodes.codeHash, hashMcpToken(raw))).limit(1);
    if (!code || !mcpTokenMatches(raw, code.codeHash)) return fail("invalid_grant", "Kod geçersiz");
    const [client] = await tx.select().from(s.mcpClients).where(eq(s.mcpClients.id, code.clientId)).limit(1);
    if (!client || client.clientId !== v.clientId) return fail("invalid_grant", "Kod bu uygulamaya verilmedi");
    if (v.redirectUri !== code.redirectUri) return fail("invalid_grant", "Dönüş adresi tutmuyor");
    if (!pkceMatches(v.codeVerifier, code.codeChallenge)) return fail("invalid_grant", "PKCE doğrulaması tutmadı");
    if (v.resource !== null && canonicalResource(v.resource) !== code.resource) return fail("invalid_target", "Bu sunucunun adresi değil");

    const [used] = await tx
      .update(s.mcpCodes)
      .set({ usedAt: now })
      .where(and(eq(s.mcpCodes.id, code.id), isNull(s.mcpCodes.usedAt), gt(s.mcpCodes.expiresAt, now)))
      .returning({ id: s.mcpCodes.id });
    if (!used) {
      const [cur] = await tx.select({ usedAt: s.mcpCodes.usedAt, grantId: s.mcpCodes.grantId }).from(s.mcpCodes).where(eq(s.mcpCodes.id, code.id)).limit(1);
      if (!cur?.usedAt) return fail("invalid_grant", "Kodun süresi doldu");
      // Kod tekrarı: kod sızmış olabilir, ondan açılan bağlantı kapatılır (RFC 6749 §4.1.2)
      if (cur.grantId) {
        const closed = await closeGrant(tx, cur.grantId, "kod-tekrari", now);
        if (closed) {
          const event: GrantEvent = { kind: "security-revoked", grantId: cur.grantId, userName: await userName(tx, closed.userId), host: closed.redirectHost, why: "kod iki kez kullanıldı" };
          return fail("invalid_grant", "Kod daha önce kullanıldı", event);
        }
      }
      return fail("invalid_grant", "Kod daha önce kullanıldı");
    }

    const [user] = await tx
      .select({ name: s.users.name, active: s.users.active, role: s.users.role, sessionVersion: s.users.sessionVersion })
      .from(s.users)
      .where(eq(s.users.id, code.userId))
      .limit(1);
    if (!user || !user.active || user.role !== "admin" || user.sessionVersion !== code.sessionVersion) return fail("invalid_grant", "Hesap değişti; yeniden bağlanın");

    const host = new URL(code.redirectUri).hostname;
    const [grant] = await tx
      .insert(s.mcpGrants)
      .values({
        userId: code.userId,
        clientId: client.id,
        scope: code.scope,
        resource: code.resource,
        redirectHost: host,
        sessionVersion: code.sessionVersion,
        expiresAt: grantExpiry(now),
      })
      .returning();
    await tx.update(s.mcpCodes).set({ grantId: grant.id }).where(eq(s.mcpCodes.id, code.id));
    await tx.update(s.mcpClients).set({ lastUsedAt: now }).where(eq(s.mcpClients.id, client.id));
    const pair = await issuePair(tx, grant, now);
    return { ok: true, body: pair.body, event: { kind: "created", grantId: grant.id, userName: user.name, host } } satisfies TokenResult;
  });
}

/**
 * Yenileme anahtarı → yeni çift (RFC 6749 §6, yenileme anahtarı her kullanımda değişir). Kullanılmış anahtar 60 sn
 * içinde ve yerine verilen kullanılmadıysa bir kez daha geçer (ağ hatası); değilse bağlantı güvenlik için kapanır.
 * Kullanıcı pasif, yönetici değil ya da oturum sürümü değiştiyse bağlantı "oturum" nedeniyle kapanır.
 */
export async function refreshGrant(db: DB, v: { refreshToken: unknown; clientId: string; resource: string | null; scope: string | null }, now: Date): Promise<TokenResult> {
  if (!isMcpTokenShaped(v.refreshToken, "rt")) return fail("invalid_grant", "Yenileme anahtarı geçersiz");
  const raw = v.refreshToken;
  const hash = hashMcpToken(raw);
  return db.transaction(async (tx) => {
    // İki tur: koşullu UPDATE'i eşzamanlı bir istek kazandıysa satır yeniden okunur ve karar yeniden verilir
    for (let round = 0; round < 2; round++) {
      const [row] = await tx
        .select({
          token: s.mcpTokens,
          grant: s.mcpGrants,
          clientId: s.mcpClients.clientId,
          user: { name: s.users.name, active: s.users.active, role: s.users.role, sessionVersion: s.users.sessionVersion },
        })
        .from(s.mcpTokens)
        .innerJoin(s.mcpGrants, eq(s.mcpGrants.id, s.mcpTokens.grantId))
        .innerJoin(s.mcpClients, eq(s.mcpClients.id, s.mcpGrants.clientId))
        .innerJoin(s.users, eq(s.users.id, s.mcpGrants.userId))
        .where(and(eq(s.mcpTokens.tokenHash, hash), eq(s.mcpTokens.kind, "refresh")))
        .limit(1);
      if (!row || !mcpTokenMatches(raw, row.token.tokenHash)) return fail("invalid_grant", "Yenileme anahtarı geçersiz");
      // Başka istemcinin anahtarı: ayrıntı verilmez
      if (row.clientId !== v.clientId) return fail("invalid_grant", "Yenileme anahtarı geçersiz");
      const g = row.grant;
      if (g.revokedAt || g.expiresAt.getTime() <= now.getTime()) return fail("invalid_grant", "Bağlantı kapalı; yeniden bağlanın");
      if (!row.user.active || row.user.role !== "admin" || row.user.sessionVersion !== g.sessionVersion) {
        await closeGrant(tx, g.id, "oturum", now);
        return fail("invalid_grant", "Hesap değişti; yeniden bağlanın");
      }
      if (v.resource !== null && canonicalResource(v.resource) !== g.resource) return fail("invalid_target", "Bu sunucunun adresi değil");
      if (v.scope) {
        const granted = new Set(g.scope.split(" "));
        if (v.scope.split(/\s+/).filter(Boolean).some((x) => !granted.has(x))) return fail("invalid_scope", "Bağlantının kapsamından fazlası istendi");
      }
      let successorUsed = false;
      if (row.token.replacedBy) {
        const [next] = await tx
          .select({ rotatedAt: s.mcpTokens.rotatedAt, revokedAt: s.mcpTokens.revokedAt })
          .from(s.mcpTokens)
          .where(eq(s.mcpTokens.id, row.token.replacedBy))
          .limit(1);
        successorUsed = Boolean(next?.rotatedAt || next?.revokedAt);
      }
      const decision = refreshDecision({ expiresAt: row.token.expiresAt, rotatedAt: row.token.rotatedAt, revokedAt: row.token.revokedAt, successorUsed }, now);
      if (decision === "revoked" || decision === "expired") return fail("invalid_grant", "Yenileme anahtarının süresi doldu; yeniden bağlanın");
      if (decision === "reuse") {
        const closed = await closeGrant(tx, g.id, "yeniden-kullanim", now);
        const event: GrantEvent | undefined = closed ? { kind: "security-revoked", grantId: g.id, userName: row.user.name, host: g.redirectHost, why: "eski anahtar yeniden kullanıldı" } : undefined;
        return fail("invalid_grant", "Yenileme anahtarı daha önce kullanıldı", event);
      }
      if (decision === "rotate") {
        const [claimed] = await tx
          .update(s.mcpTokens)
          .set({ rotatedAt: now })
          .where(and(eq(s.mcpTokens.id, row.token.id), isNull(s.mcpTokens.rotatedAt), isNull(s.mcpTokens.revokedAt)))
          .returning({ id: s.mcpTokens.id });
        if (!claimed) continue;
        const pair = await issuePair(tx, g, now);
        await tx.update(s.mcpTokens).set({ replacedBy: pair.refreshId }).where(eq(s.mcpTokens.id, row.token.id));
        return { ok: true, body: pair.body } satisfies TokenResult;
      }
      // grace: ağ hatasında aynı anahtar; önceki halef de geçerli kalır
      const pair = await issuePair(tx, g, now);
      return { ok: true, body: pair.body } satisfies TokenResult;
    }
    return fail("invalid_grant", "Yenileme anahtarı geçersiz");
  });
}

/**
 * RFC 7009: erişim anahtarı yalnız kendisi, yenileme anahtarı bütün bağlantıyla kapanır. Bilinmeyen ya da başka
 * istemcinin anahtarı için de sessizce biter (yanıt her durumda 200).
 */
export async function revokeByToken(db: DB, v: { token: string; clientId: string | null }, now: Date): Promise<void> {
  const kind = isMcpTokenShaped(v.token, "at") ? "access" : isMcpTokenShaped(v.token, "rt") ? "refresh" : null;
  if (!kind) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: s.mcpTokens.id, grantId: s.mcpTokens.grantId, hash: s.mcpTokens.tokenHash, clientId: s.mcpClients.clientId })
      .from(s.mcpTokens)
      .innerJoin(s.mcpGrants, eq(s.mcpGrants.id, s.mcpTokens.grantId))
      .innerJoin(s.mcpClients, eq(s.mcpClients.id, s.mcpGrants.clientId))
      .where(and(eq(s.mcpTokens.tokenHash, hashMcpToken(v.token)), eq(s.mcpTokens.kind, kind)))
      .limit(1);
    if (!row || !mcpTokenMatches(v.token, row.hash)) return;
    if (v.clientId && v.clientId !== row.clientId) return;
    if (kind === "access") await tx.update(s.mcpTokens).set({ revokedAt: now }).where(and(eq(s.mcpTokens.id, row.id), isNull(s.mcpTokens.revokedAt)));
    else await closeGrant(tx, row.grantId, "istemci", now);
  });
}

// ---------------------------------------------------------------- /api/mcp

/** Erişim anahtarını doğrular: anahtar ve bağlantı açık ve süresi dolmamış, kullanıcı etkin yönetici, oturum sürümü aynı */
export async function verifyAccess(db: Db, raw: string, now: Date): Promise<Principal | null> {
  if (!isMcpTokenShaped(raw, "at")) return null;
  const [row] = await db
    .select({
      hash: s.mcpTokens.tokenHash,
      tokenExpires: s.mcpTokens.expiresAt,
      grantId: s.mcpGrants.id,
      userId: s.mcpGrants.userId,
      scope: s.mcpGrants.scope,
      resource: s.mcpGrants.resource,
      userName: s.users.name,
      clientId: s.mcpClients.clientId,
    })
    .from(s.mcpTokens)
    .innerJoin(s.mcpGrants, eq(s.mcpGrants.id, s.mcpTokens.grantId))
    .innerJoin(s.users, eq(s.users.id, s.mcpGrants.userId))
    .innerJoin(s.mcpClients, eq(s.mcpClients.id, s.mcpGrants.clientId))
    .where(and(eq(s.mcpTokens.tokenHash, hashMcpToken(raw)), eq(s.mcpTokens.kind, "access"), isNull(s.mcpTokens.revokedAt), gt(s.mcpTokens.expiresAt, now), liveGrant(now)))
    .limit(1);
  if (!row || !mcpTokenMatches(raw, row.hash)) return null;
  return {
    grantId: row.grantId,
    userId: row.userId,
    userName: row.userName,
    clientId: row.clientId,
    scopes: row.scope.split(" ").filter(Boolean),
    resource: row.resource,
    expiresAt: Math.floor(row.tokenExpires.getTime() / 1000),
  };
}

/** Son kullanım (Hesabım): en çok dakikada bir yazılır */
export async function touchGrant(db: Db, grantId: number, now: Date): Promise<void> {
  const before = new Date(now.getTime() - 60_000);
  await db
    .update(s.mcpGrants)
    .set({ lastUsedAt: now })
    .where(and(eq(s.mcpGrants.id, grantId), or(isNull(s.mcpGrants.lastUsedAt), lt(s.mcpGrants.lastUsedAt, before))));
}

/** Araç çağrısının kaydı; hata verirse yalnız günlüğe yazılır (cevabı bozmaz) */
export async function logCall(
  db: Db,
  v: { grantId: number; userId: number; tool: string; args: Record<string, unknown> | null; ok: boolean; error: string | null; ms: number; chars: number | null },
): Promise<void> {
  try {
    await db.insert(s.mcpCalls).values({
      grantId: v.grantId,
      userId: v.userId,
      tool: v.tool.slice(0, 60),
      args: v.args,
      ok: v.ok,
      error: v.error?.slice(0, 300) ?? null,
      ms: Math.max(0, Math.round(v.ms)),
      chars: v.chars,
    });
  } catch (e) {
    console.error("[mcp] çağrı kaydı yazılamadı", e);
  }
}

// ---------------------------------------------------------------- Hesabım

export interface ConnectionRow {
  id: number;
  kind: "dcr" | "cimd";
  name: string;
  clientId: string;
  host: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

/** Kullanıcının geçerli bağlantıları, en yeni önce */
export async function listConnections(db: Db, userId: number, now: Date): Promise<ConnectionRow[]> {
  return db
    .select({
      id: s.mcpGrants.id,
      kind: s.mcpClients.kind,
      name: s.mcpClients.name,
      clientId: s.mcpClients.clientId,
      host: s.mcpGrants.redirectHost,
      createdAt: s.mcpGrants.createdAt,
      lastUsedAt: s.mcpGrants.lastUsedAt,
      expiresAt: s.mcpGrants.expiresAt,
    })
    .from(s.mcpGrants)
    .innerJoin(s.mcpClients, eq(s.mcpClients.id, s.mcpGrants.clientId))
    .innerJoin(s.users, eq(s.users.id, s.mcpGrants.userId))
    .where(and(eq(s.mcpGrants.userId, userId), liveGrant(now)))
    .orderBy(desc(s.mcpGrants.createdAt), desc(s.mcpGrants.id));
}

export interface CallRow {
  at: Date;
  tool: string;
  args: Record<string, unknown> | null;
  ok: boolean;
}

/** Kullanıcının son araç çağrıları (bütün bağlantılarından), en yeni önce */
export async function recentCalls(db: Db, userId: number, limit = 20): Promise<CallRow[]> {
  return db
    .select({ at: s.mcpCalls.at, tool: s.mcpCalls.tool, args: s.mcpCalls.args, ok: s.mcpCalls.ok })
    .from(s.mcpCalls)
    .where(eq(s.mcpCalls.userId, userId))
    .orderBy(desc(s.mcpCalls.at), desc(s.mcpCalls.id))
    .limit(limit);
}

/** Hesabım › Kaldır: yalnız kendi bağlantısı; kapandıysa dönüş sunucusu */
export async function revokeGrant(db: DB, v: { userId: number; grantId: number; reason: RevokeReason }, now: Date): Promise<{ host: string } | null> {
  return db.transaction(async (tx) => {
    const [own] = await tx
      .select({ id: s.mcpGrants.id })
      .from(s.mcpGrants)
      .where(and(eq(s.mcpGrants.id, v.grantId), eq(s.mcpGrants.userId, v.userId), isNull(s.mcpGrants.revokedAt)))
      .limit(1);
    if (!own) return null;
    const closed = await closeGrant(tx, own.id, v.reason, now);
    return closed ? { host: closed.redirectHost } : null;
  });
}

/** Hesabım › Hepsini kaldır: kullanıcının açık bağlantılarının hepsi; kapanan (süresi dolmamış) sayısı */
export async function revokeAllGrants(db: DB, v: { userId: number; reason: RevokeReason }, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(s.mcpGrants)
      .set({ revokedAt: now, revokedReason: v.reason })
      .where(and(eq(s.mcpGrants.userId, v.userId), isNull(s.mcpGrants.revokedAt)))
      .returning({ id: s.mcpGrants.id, expiresAt: s.mcpGrants.expiresAt });
    if (!rows.length) return 0;
    await tx
      .update(s.mcpTokens)
      .set({ revokedAt: now })
      .where(and(inArray(s.mcpTokens.grantId, rows.map((r) => r.id)), isNull(s.mcpTokens.revokedAt)));
    return rows.filter((r) => r.expiresAt.getTime() > now.getTime()).length;
  });
}

// ---------------------------------------------------------------- Günlük temizlik

const DAY = 86_400_000;

/**
 * Sabah işinin kuyruğunda (en çok 3 sn; sonucu yalnız yanıtta, body.mcp): süresi dolan kod ve anahtarlar, süresi
 * dolan ya da kullanıcısı değişen bağlantıların kapatılması, eski kapalı bağlantılar, bağlanmamış istemciler ve 180
 * günden eski çağrı kayıtları.
 */
export async function pruneMcp(db: Db, now: Date): Promise<Record<string, number>> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const codes = await db.delete(s.mcpCodes).where(lt(s.mcpCodes.expiresAt, ago(1))).returning({ id: s.mcpCodes.id });
  const tokens = await db.delete(s.mcpTokens).where(lt(s.mcpTokens.expiresAt, ago(7))).returning({ id: s.mcpTokens.id });
  const expired = await db
    .update(s.mcpGrants)
    .set({ revokedAt: now, revokedReason: "suresi-doldu" })
    .where(and(isNull(s.mcpGrants.revokedAt), lt(s.mcpGrants.expiresAt, now)))
    .returning({ id: s.mcpGrants.id });
  const session = await db
    .update(s.mcpGrants)
    .set({ revokedAt: now, revokedReason: "oturum" })
    .where(
      and(
        isNull(s.mcpGrants.revokedAt),
        sql`exists (select 1 from ${s.users} where ${s.users.id} = ${s.mcpGrants.userId} and (not ${s.users.active} or ${s.users.role} <> 'admin' or ${s.users.sessionVersion} <> ${s.mcpGrants.sessionVersion}))`,
      ),
    )
    .returning({ id: s.mcpGrants.id });
  const closedIds = [...expired, ...session].map((g) => g.id);
  if (closedIds.length) await db.update(s.mcpTokens).set({ revokedAt: now }).where(and(inArray(s.mcpTokens.grantId, closedIds), isNull(s.mcpTokens.revokedAt)));
  const grants = await db.delete(s.mcpGrants).where(lt(s.mcpGrants.revokedAt, ago(90))).returning({ id: s.mcpGrants.id });
  const dcr = await db
    .delete(s.mcpClients)
    .where(
      and(
        eq(s.mcpClients.kind, "dcr"),
        lt(s.mcpClients.createdAt, ago(1)),
        sql`not exists (select 1 from ${s.mcpGrants} where ${s.mcpGrants.clientId} = ${s.mcpClients.id})`,
        sql`not exists (select 1 from ${s.mcpCodes} where ${s.mcpCodes.clientId} = ${s.mcpClients.id})`,
      ),
    )
    .returning({ id: s.mcpClients.id });
  const cimd = await db
    .delete(s.mcpClients)
    .where(
      and(
        eq(s.mcpClients.kind, "cimd"),
        // Son kullanım, son okunuş ya da kayıt: hangisi en yeniyse (onay ekranı arasında silinmesin)
        // Ham SQL'de tarih ISO metniyle gider (sürücü Date'i toString ile yazar, Postgres okuyamaz)
        sql`greatest(${s.mcpClients.lastUsedAt}, ${s.mcpClients.fetchedAt}, ${s.mcpClients.createdAt}) < ${ago(180).toISOString()}::timestamptz`,
        sql`not exists (select 1 from ${s.mcpGrants} where ${s.mcpGrants.clientId} = ${s.mcpClients.id})`,
      ),
    )
    .returning({ id: s.mcpClients.id });
  const calls = await db.delete(s.mcpCalls).where(lt(s.mcpCalls.at, ago(180))).returning({ id: s.mcpCalls.id });
  return {
    codes: codes.length,
    tokens: tokens.length,
    expired: expired.length,
    session: session.length,
    grants: grants.length,
    clients: dcr.length + cimd.length,
    calls: calls.length,
  };
}
