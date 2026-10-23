// Claude bağlantısının veritabanı tarafı (src/server/mcp/store.ts), gerçek Postgres'te: kayıt → kod → anahtar (yanlış
// doğrulayıcı, dönüş adresi, kaynak, istemci reddedilir) → erişim → yenileme (değiştir, ağ hatası payı, yeniden
// kullanım bağlantıyı kapatır) → kod tekrarı → oturum sürümü ve rol değişince kapanma → anahtar iadesi → Hesabım
// (liste, kaldır, hepsini kaldır, çağrı kaydı) → günlük temizlik. Kendi kullanıcısını ve istemcilerini açar, sonunda siler.
//
// MCP_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı, ör. R3'ün kopyası).
// Çalıştırma: MCP_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_mcp npx tsx --test tests/claude-baglanti-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import {
  activeGrantCount,
  exchangeCode,
  findClient,
  issueCode,
  listConnections,
  logCall,
  pendingDcrCount,
  pruneMcp,
  recentCalls,
  refreshGrant,
  registerDcrClient,
  revokeAllGrants,
  revokeByToken,
  revokeGrant,
  touchGrant,
  upsertCimdClient,
  verifyAccess,
  type TokenResult,
} from "../src/server/mcp/store";
import { hashMcpToken, newToken, pkceS256 } from "../src/server/mcp/tokens";

const URL = process.env.MCP_TEST_DATABASE_URL;
const RESOURCE = "http://localhost:3000/api/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const T0 = new Date("2026-10-22T09:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

type Ok = Extract<TokenResult, { ok: true }>;
const ok = (r: TokenResult): Ok["body"] => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.body;
};

describe("Claude bağlantısı: veritabanında akış", { skip: !URL && "MCP_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let userId = 0;
  let otherId = 0;
  const clientIds: number[] = [];
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;

  async function client(name = "Claude") {
    const c = await registerDcrClient(db, { name, redirectUris: [REDIRECT] });
    clientIds.push(c.id);
    return c;
  }

  async function sessionVersion(id = userId) {
    const [u] = await db.select({ v: s.users.sessionVersion }).from(s.users).where(eq(s.users.id, id));
    return u.v;
  }

  /** İzin verilmiş bağlantı: kod → anahtar (doğrulayıcıyla) */
  async function connect(c: { id: number; clientId: string }, now = T0, uid = userId) {
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode(
      db,
      { userId: uid, clientDbId: c.id, redirectUri: REDIRECT, codeChallenge: pkceS256(verifier), scope: "panel:oku offline_access", resource: RESOURCE, sessionVersion: await sessionVersion(uid) },
      now,
    );
    const r = await exchangeCode(db, { code: code.raw, clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE }, now);
    return { code, verifier, r, body: ok(r) };
  }

  async function grantOf(accessToken: string) {
    const [t] = await db.select({ grantId: s.mcpTokens.grantId }).from(s.mcpTokens).where(eq(s.mcpTokens.tokenHash, hashMcpToken(accessToken)));
    const [g] = await db.select().from(s.mcpGrants).where(eq(s.mcpGrants.id, t.grantId));
    return g;
  }

  before(async () => {
    db = createDb(URL!, 2);
    const rows = await db
      .insert(s.users)
      .values([
        { name: "MCP Deneme", email: `mcp-deneme-${tag}@example.test`, passwordHash: "!", role: "admin", active: true },
        { name: "MCP Öteki", email: `mcp-oteki-${tag}@example.test`, passwordHash: "!", role: "admin", active: true },
      ])
      .returning({ id: s.users.id });
    [userId, otherId] = rows.map((r) => r.id);
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.mcpCalls).where(inArray(s.mcpCalls.userId, [userId, otherId]));
    await db.delete(s.users).where(inArray(s.users.id, [userId, otherId]));
    if (clientIds.length) await db.delete(s.mcpClients).where(inArray(s.mcpClients.id, clientIds));
    await db.$client.end();
  });

  test("kod → anahtar: yanlış doğrulayıcı, dönüş adresi, kaynak ve istemci reddedilir; doğrusu bağlantı açar", async () => {
    const c = await client();
    const other = await client("Başka");
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode(
      db,
      { userId, clientDbId: c.id, redirectUri: REDIRECT, codeChallenge: pkceS256(verifier), scope: "panel:oku offline_access", resource: RESOURCE, sessionVersion: await sessionVersion() },
      T0,
    );
    const base = { code: code.raw, clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE };
    const bad = async (o: Partial<typeof base>, error: string) => {
      const r = await exchangeCode(db, { ...base, ...o }, T0);
      assert.ok(!r.ok && r.error === error, `${JSON.stringify(o)} → ${JSON.stringify(r)}`);
    };
    await bad({ codeVerifier: randomBytes(32).toString("base64url") }, "invalid_grant");
    await bad({ redirectUri: "https://claude.com/api/mcp/auth_callback" }, "invalid_grant");
    await bad({ resource: "http://baska.example/api/mcp" }, "invalid_target");
    await bad({ clientId: other.clientId }, "invalid_grant");
    await bad({ code: newToken("ac") }, "invalid_grant");
    await bad({ code: "lafat_x" }, "invalid_grant");
    // Bunlar kodu harcamadı: doğru istek geçer
    const r = await exchangeCode(db, base, T0);
    const body = ok(r);
    assert.equal(r.ok && r.event?.kind, "created");
    assert.match(body.access_token, /^lafat_/);
    assert.match(body.refresh_token, /^lafrt_/);
    assert.equal(body.expires_in, 3600);
    assert.equal(body.scope, "panel:oku offline_access");
    // Ham anahtar hiçbir satırda yok, yalnız özeti
    const [stored] = await db.select().from(s.mcpTokens).where(eq(s.mcpTokens.tokenHash, hashMcpToken(body.access_token)));
    assert.ok(stored && stored.tokenHash !== body.access_token);
    const g = await grantOf(body.access_token);
    assert.equal(g.redirectHost, "claude.ai");
    assert.equal(g.expiresAt.toISOString(), "2027-01-20T09:00:00.000Z");
    assert.ok((await findClient(db, c.clientId))?.lastUsedAt);

    const p = await verifyAccess(db, body.access_token, at(10));
    assert.ok(p);
    assert.equal(p.userId, userId);
    assert.equal(p.resource, RESOURCE);
    assert.deepEqual(p.scopes, ["panel:oku", "offline_access"]);
    assert.equal(p.clientId, c.clientId);
    assert.equal(await verifyAccess(db, body.access_token, at(3601)), null, "1 saat sonra");
    assert.equal(await verifyAccess(db, body.refresh_token, at(10)), null, "yenileme anahtarı erişim yerine geçmez");
    assert.equal(await verifyAccess(db, newToken("at"), at(10)), null);
  });

  test("yenileme: değiştir → eski anahtar 60 sn içinde bir kez daha (ağ hatası) → halef kullanılınca eskisi bağlantıyı kapatır", async () => {
    const c = await client();
    const { body } = await connect(c);
    const r1 = ok(await refreshGrant(db, { refreshToken: body.refresh_token, clientId: c.clientId, resource: RESOURCE, scope: null }, at(100)));
    assert.notEqual(r1.refresh_token, body.refresh_token);
    const grace = await refreshGrant(db, { refreshToken: body.refresh_token, clientId: c.clientId, resource: null, scope: null }, at(130));
    assert.ok(grace.ok, "60 sn içinde, halef kullanılmadı");
    const other = await client("Başka");
    const foreign = await refreshGrant(db, { refreshToken: r1.refresh_token, clientId: other.clientId, resource: null, scope: null }, at(140));
    assert.ok(!foreign.ok && foreign.error === "invalid_grant", "başka istemci");
    const wide = await refreshGrant(db, { refreshToken: r1.refresh_token, clientId: c.clientId, resource: null, scope: "panel:oku panel:yaz" }, at(140));
    assert.ok(!wide.ok && wide.error === "invalid_scope");
    const r2 = ok(await refreshGrant(db, { refreshToken: r1.refresh_token, clientId: c.clientId, resource: null, scope: "panel:oku" }, at(150)));
    assert.ok(await verifyAccess(db, r2.access_token, at(160)));
    const reuse = await refreshGrant(db, { refreshToken: body.refresh_token, clientId: c.clientId, resource: null, scope: null }, at(170));
    assert.ok(!reuse.ok && reuse.error === "invalid_grant");
    assert.equal(!reuse.ok && reuse.event?.kind, "security-revoked");
    assert.equal(!reuse.ok && reuse.event?.why, "eski anahtar yeniden kullanıldı");
    assert.equal(await verifyAccess(db, r2.access_token, at(180)), null, "bağlantı kapandı");
    assert.equal((await grantOf(r2.access_token)).revokedReason, "yeniden-kullanim");
    const dead = await refreshGrant(db, { refreshToken: r2.refresh_token, clientId: c.clientId, resource: null, scope: null }, at(190));
    assert.ok(!dead.ok && dead.error === "invalid_grant");
  });

  test("yenileme anahtarı 60 sn'den sonra yeniden: halef kullanılmasa da bağlantı kapanır; süresi dolan anahtar invalid_grant", async () => {
    const c = await client();
    const { body } = await connect(c);
    ok(await refreshGrant(db, { refreshToken: body.refresh_token, clientId: c.clientId, resource: null, scope: null }, at(100)));
    const late = await refreshGrant(db, { refreshToken: body.refresh_token, clientId: c.clientId, resource: null, scope: null }, at(200));
    assert.ok(!late.ok && late.event?.kind === "security-revoked");
    const c2 = await client();
    const { body: b2 } = await connect(c2);
    const expired = await refreshGrant(db, { refreshToken: b2.refresh_token, clientId: c2.clientId, resource: null, scope: null }, at(31 * 86_400));
    assert.ok(!expired.ok && expired.error === "invalid_grant");
  });

  test("kod tekrarı: aynı kod ikinci kez → invalid_grant ve o koddan açılan bağlantı kapanır; süresi dolan kod geçmez", async () => {
    const c = await client();
    const { code, verifier, body } = await connect(c);
    const again = await exchangeCode(db, { code: code.raw, clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE }, at(30));
    assert.ok(!again.ok && again.error === "invalid_grant");
    assert.equal(!again.ok && again.event?.why, "kod iki kez kullanıldı");
    assert.equal(await verifyAccess(db, body.access_token, at(31)), null);
    assert.equal((await grantOf(body.access_token)).revokedReason, "kod-tekrari");

    const verifier2 = randomBytes(32).toString("base64url");
    const old = await issueCode(
      db,
      { userId, clientDbId: c.id, redirectUri: REDIRECT, codeChallenge: pkceS256(verifier2), scope: "panel:oku", resource: RESOURCE, sessionVersion: await sessionVersion() },
      T0,
    );
    const expired = await exchangeCode(db, { code: old.raw, clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: verifier2, resource: null }, at(121));
    assert.ok(!expired.ok && expired.error === "invalid_grant" && !expired.event);
  });

  test("oturum sürümü, pasif ya da personel: erişim düşer, yenileme bağlantıyı 'oturum' nedeniyle kapatır", async () => {
    const c = await client();
    const { body } = await connect(c);
    await db.update(s.users).set({ sessionVersion: (await sessionVersion()) + 1 }).where(eq(s.users.id, userId));
    assert.equal(await verifyAccess(db, body.access_token, at(10)), null);
    const r = await refreshGrant(db, { refreshToken: body.refresh_token, clientId: c.clientId, resource: null, scope: null }, at(20));
    assert.ok(!r.ok && r.error === "invalid_grant");
    assert.equal((await grantOf(body.access_token)).revokedReason, "oturum");

    const { body: b2 } = await connect(c);
    await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, userId));
    assert.equal(await verifyAccess(db, b2.access_token, at(10)), null, "personel olunca");
    await db.update(s.users).set({ role: "admin", active: false }).where(eq(s.users.id, userId));
    assert.equal(await verifyAccess(db, b2.access_token, at(10)), null, "pasif olunca");
    await db.update(s.users).set({ active: true }).where(eq(s.users.id, userId));
    assert.ok(await verifyAccess(db, b2.access_token, at(10)), "geri gelince (oturum sürümü aynı) yine geçer");
    // Kod verildikten sonra sürüm değişirse kod da geçmez
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode(
      db,
      { userId, clientDbId: c.id, redirectUri: REDIRECT, codeChallenge: pkceS256(verifier), scope: "panel:oku", resource: RESOURCE, sessionVersion: await sessionVersion() },
      T0,
    );
    await db.update(s.users).set({ sessionVersion: (await sessionVersion()) + 1 }).where(eq(s.users.id, userId));
    const ex = await exchangeCode(db, { code: code.raw, clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: null }, at(5));
    assert.ok(!ex.ok && ex.error === "invalid_grant");
  });

  test("anahtar iadesi (RFC 7009): erişim anahtarı yalnız kendisi, yenileme anahtarı bütün bağlantı; bilinmeyen sessiz", async () => {
    const c = await client();
    const { body } = await connect(c);
    await revokeByToken(db, { token: body.access_token, clientId: c.clientId }, at(5));
    assert.equal(await verifyAccess(db, body.access_token, at(6)), null);
    const fresh = ok(await refreshGrant(db, { refreshToken: body.refresh_token, clientId: c.clientId, resource: null, scope: null }, at(7)));
    assert.ok(await verifyAccess(db, fresh.access_token, at(8)), "bağlantı açık kaldı");
    const other = await client("Başka");
    await revokeByToken(db, { token: fresh.refresh_token, clientId: other.clientId }, at(9));
    assert.ok(await verifyAccess(db, fresh.access_token, at(10)), "başka istemcinin iadesi etkisiz");
    await revokeByToken(db, { token: fresh.refresh_token, clientId: c.clientId }, at(11));
    assert.equal(await verifyAccess(db, fresh.access_token, at(12)), null);
    assert.equal((await grantOf(fresh.access_token)).revokedReason, "istemci");
    await revokeByToken(db, { token: newToken("rt"), clientId: null }, at(13));
    await revokeByToken(db, { token: "bozuk", clientId: null }, at(13));
  });

  test("Hesabım: liste, son kullanım, çağrı kaydı, kaldır (yalnız kendi), hepsini kaldır, etkin bağlantı sayısı", async () => {
    await revokeAllGrants(db, { userId, reason: "kullanici" }, T0);
    const c = await client();
    const a = await connect(c, at(1));
    const b = await connect(c, at(2));
    const now = at(10);
    assert.equal(await activeGrantCount(db, userId, now), 2);
    const list = await listConnections(db, userId, now);
    assert.equal(list.length, 2);
    assert.ok(list[0].createdAt >= list[1].createdAt, "en yeni önce");
    assert.equal(list[0].host, "claude.ai");
    const ga = await grantOf(a.body.access_token);
    await touchGrant(db, ga.id, at(20));
    await touchGrant(db, ga.id, at(30));
    assert.equal((await grantOf(a.body.access_token)).lastUsedAt?.toISOString(), at(20).toISOString(), "dakikada bir yazılır");
    await logCall(db, { grantId: ga.id, userId, tool: "ay_ozeti", args: { ay: "2026-10" }, ok: true, error: null, ms: 12.6, chars: 900 });
    await logCall(db, { grantId: ga.id, userId, tool: "kasa_raporlari", args: { baslangic: "2026-01-01", bitis: "2026-10-22" }, ok: false, error: "Tarih aralığı en çok 92 gün olabilir", ms: 1, chars: null });
    const calls = await recentCalls(db, userId, 20);
    assert.deepEqual(
      calls.slice(0, 2).map((x) => [x.tool, x.ok]),
      [
        ["kasa_raporlari", false],
        ["ay_ozeti", true],
      ],
    );
    // Başkasının bağlantısı kaldırılamaz
    assert.equal(await revokeGrant(db, { userId: otherId, grantId: ga.id, reason: "kullanici" }, at(40)), null);
    assert.deepEqual(await revokeGrant(db, { userId, grantId: ga.id, reason: "kullanici" }, at(40)), { host: "claude.ai" });
    assert.equal(await revokeGrant(db, { userId, grantId: ga.id, reason: "kullanici" }, at(41)), null, "zaten kapalı");
    assert.equal(await verifyAccess(db, a.body.access_token, at(42)), null);
    assert.ok(await verifyAccess(db, b.body.access_token, at(42)));
    assert.equal(await revokeAllGrants(db, { userId, reason: "kullanici" }, at(50)), 1);
    assert.equal(await verifyAccess(db, b.body.access_token, at(51)), null);
    assert.equal(await activeGrantCount(db, userId, at(52)), 0);
  });

  test("istemciler: CIMD satırı güncellenir (aynı satır); bağlanmamış otomatik kayıtlar sayılır", async () => {
    const url = `https://claude.ai/oauth/deneme-${tag}`;
    const first = await upsertCimdClient(db, url, { name: "Claude", redirectUris: [REDIRECT] }, T0);
    clientIds.push(first.id);
    const second = await upsertCimdClient(db, url, { name: "Claude 2", redirectUris: [REDIRECT, "https://claude.com/api/mcp/auth_callback"] }, at(60));
    assert.equal(second.id, first.id);
    assert.equal(second.kind, "cimd");
    assert.equal(second.name, "Claude 2");
    assert.equal(second.fetchedAt?.toISOString(), at(60).toISOString());
    const since = new Date(Date.now() - 60_000);
    const before = await pendingDcrCount(db, since);
    const c = await client();
    assert.equal(await pendingDcrCount(db, since), before + 1);
    await connect(c);
    assert.equal(await pendingDcrCount(db, since), before, "bağlanınca bekleyen sayılmaz");
  });

  test("günlük temizlik: eski kod ve anahtarlar silinir, süresi dolan bağlantı kapanır, eski kapalı bağlantı ve kayıtlar gider", async () => {
    const now = new Date();
    const day = 86_400_000;
    const c = await client();
    const { code, body } = await connect(c, new Date(now.getTime() - 100 * day));
    const g = await grantOf(body.access_token);
    // Kod 100 gün önce verildi (süresi çoktan doldu); anahtarlar da 100 gün önce
    const [codeRow] = await db.select().from(s.mcpCodes).where(eq(s.mcpCodes.id, code.id));
    assert.ok(codeRow);
    const fresh = await connect(c, now);
    const gFresh = await grantOf(fresh.body.access_token);
    // Süresi geçmiş ama kapatılmamış bağlantı (90 günü dolmuş)
    await db.update(s.mcpGrants).set({ expiresAt: new Date(now.getTime() - day) }).where(eq(s.mcpGrants.id, g.id));
    // 91 gün önce kapatılmış bağlantı
    const old = await connect(c, now);
    const gOld = await grantOf(old.body.access_token);
    await db.update(s.mcpGrants).set({ revokedAt: new Date(now.getTime() - 91 * day), revokedReason: "kullanici" }).where(eq(s.mcpGrants.id, gOld.id));
    // Hiç bağlanmamış eski otomatik kayıt
    const stale = await client("Eski");
    await db.update(s.mcpClients).set({ createdAt: new Date(now.getTime() - 2 * day) }).where(eq(s.mcpClients.id, stale.id));
    // 181 günlük çağrı kaydı
    await logCall(db, { grantId: gFresh.id, userId, tool: "ara", args: { metin: "süt" }, ok: true, error: null, ms: 3, chars: 10 });
    const [call] = await db.select({ id: s.mcpCalls.id }).from(s.mcpCalls).where(and(eq(s.mcpCalls.userId, userId), eq(s.mcpCalls.tool, "ara")));
    await db.update(s.mcpCalls).set({ at: new Date(now.getTime() - 181 * day) }).where(eq(s.mcpCalls.id, call.id));

    const out = await pruneMcp(db, now);
    assert.ok(out.codes >= 1 && out.tokens >= 2 && out.expired >= 1 && out.grants >= 1 && out.clients >= 1 && out.calls >= 1, JSON.stringify(out));
    assert.equal((await db.select().from(s.mcpCodes).where(eq(s.mcpCodes.id, code.id))).length, 0, "eski kod silindi");
    const [expired] = await db.select().from(s.mcpGrants).where(eq(s.mcpGrants.id, g.id));
    assert.equal(expired.revokedReason, "suresi-doldu");
    assert.equal((await db.select().from(s.mcpGrants).where(eq(s.mcpGrants.id, gOld.id))).length, 0, "91 günlük kapalı bağlantı silindi");
    assert.equal(await findClient(db, stale.clientId), null, "bağlanmamış eski kayıt silindi");
    assert.ok(await findClient(db, c.clientId), "bağlantısı olan istemci kalır");
    assert.equal((await db.select().from(s.mcpCalls).where(eq(s.mcpCalls.id, call.id))).length, 0, "181 günlük çağrı silindi");
    assert.ok(await verifyAccess(db, fresh.body.access_token, new Date(now.getTime() + 1000)), "güncel bağlantı yerinde");
  });
});
