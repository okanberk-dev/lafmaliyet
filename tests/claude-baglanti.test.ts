// Claude bağlantısı (salt okunur MCP; docs/CLAUDE-BAGLANTISI.md): panelin kendi OAuth sunucusunun saf kuralları
// (src/lib/mcp/oauth.ts) ve anahtar yardımcıları (src/server/mcp/tokens.ts): metaveri belgeleri, dönüş adresi izin
// listesi, CIMD belgesi ve otomatik kayıt, yetki isteğinin sırası, PKCE, yenileme anahtarı kararı, Origin kuralı,
// onay ekranının ve Son sorular'ın metinleri, yeni bağlantı e-postası.
// Çalıştırma: npx tsx --test tests/claude-baglanti.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessExpiry,
  authServerMetadata,
  callSummary,
  canonicalResource,
  checkAuthorize,
  CIMD_FETCH_INIT,
  CIMD_MAX_AGE_H,
  CIMD_MAX_BYTES,
  cleanName,
  codeRedirect,
  connectionLabel,
  consentLines,
  errorRedirect,
  grantExpiry,
  HOSTED_CALLBACKS,
  isAllowedCimdUrl,
  isAllowedOrigin,
  isAllowedRedirect,
  isLoopbackUri,
  isUrlClientId,
  loopbackAllowed,
  mcpEnabled,
  mcpUrls,
  parseScope,
  protectedResourceMetadata,
  readAuthRequest,
  readCimdResponse,
  redirectMatches,
  refreshDecision,
  refreshExpiry,
  REQUEST_TTL_S,
  resolveCimd,
  TOOL_LABELS,
  validateCimdDocument,
  validateRegistration,
  whenLabel,
  type AuthRequest,
  type CimdRead,
} from "../src/lib/mcp/oauth";
import { renderConnectedNotice } from "../src/server/mcp/notice";
import { hashMcpToken, isMcpTokenShaped, mcpTokenMatches, newClientId, newToken, pkceMatches, pkceS256 } from "../src/server/mcp/tokens";

const BASE = "https://ladmin.laffogato.net";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

/** Claude'un yayımlanmış kimlik belgesi (22 Ekim 2026'da okunan hâli; docs/planlar/mcp.md §1.1) */
const CLAUDE_CIMD_URL = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CIMD = {
  client_id: CLAUDE_CIMD_URL,
  client_name: "Claude",
  client_uri: "https://claude.ai",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};
const CLAUDE_CODE_URL = "https://claude.ai/oauth/claude-code-client-metadata";
const CLAUDE_CODE_CIMD = {
  client_id: CLAUDE_CODE_URL,
  client_name: "Claude Code",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

// ---------------------------------------------------------------- Metaveri ve açılış

test("metaveri: yetkilendirme sunucusu S256, CIMD, açık istemci, kayıt ucu; korunan kaynak belgesi panelin MCP adresi", () => {
  const as = authServerMetadata(BASE);
  assert.equal(as.issuer, BASE);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.ok((as.token_endpoint_auth_methods_supported as string[]).includes("none"));
  assert.equal(as.registration_endpoint, `${BASE}/oauth/register`);
  assert.equal(as.authorization_endpoint, `${BASE}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${BASE}/oauth/token`);
  assert.equal(as.revocation_endpoint, `${BASE}/oauth/revoke`);
  assert.equal(as.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(as.grant_types_supported, ["authorization_code", "refresh_token"]);
  // Claude offline_access'i ancak listede görünce ister
  assert.deepEqual(as.scopes_supported, ["panel:oku", "offline_access"]);

  const prm = protectedResourceMetadata(BASE);
  assert.equal(prm.resource, `${BASE}/api/mcp`);
  assert.deepEqual(prm.authorization_servers, [BASE]);
  assert.deepEqual(prm.bearer_methods_supported, ["header"]);
  assert.equal(mcpUrls(BASE).prm, `${BASE}/.well-known/oauth-protected-resource/api/mcp`);
});

test("açılış: önizlemede ve MCP_DISABLED'da kapalı; localhost dönüşü yerelde açık, canlıda yalnız MCP_ALLOW_LOCALHOST=1", () => {
  assert.equal(mcpEnabled({ VERCEL_ENV: "production" }), true);
  assert.equal(mcpEnabled({}), true);
  assert.equal(mcpEnabled({ VERCEL_ENV: "preview" }), false);
  assert.equal(mcpEnabled({ MCP_DISABLED: "1" }), false);
  assert.equal(mcpEnabled({ MCP_DISABLED: "true", VERCEL_ENV: "production" }), false);
  assert.equal(mcpEnabled({ MCP_DISABLED: "0" }), true);
  assert.equal(loopbackAllowed({ NODE_ENV: "development" }), true);
  assert.equal(loopbackAllowed({ NODE_ENV: "production" }), false);
  assert.equal(loopbackAllowed({ NODE_ENV: "production", MCP_ALLOW_LOCALHOST: "1" }), true);
});

test("canonicalResource: şema ve sunucu küçük harf, varsayılan port ve sondaki / yok; parça reddedilir", () => {
  assert.equal(canonicalResource("HTTPS://LADMIN.laffogato.net/api/mcp/"), `${BASE}/api/mcp`);
  assert.equal(canonicalResource("https://ladmin.laffogato.net:443/api/mcp"), `${BASE}/api/mcp`);
  assert.equal(canonicalResource("http://localhost:3000/api/mcp"), "http://localhost:3000/api/mcp");
  assert.equal(canonicalResource(`${BASE}/api/mcp#x`), null);
  assert.equal(canonicalResource("https://user:pw@ladmin.laffogato.net/api/mcp"), null);
  assert.equal(canonicalResource("ftp://ladmin.laffogato.net/api/mcp"), null);
  assert.equal(canonicalResource("bozuk"), null);
});

// ---------------------------------------------------------------- Dönüş adresleri

test("izinli dönüş adresi: yalnız Claude'un iki adresi harfi harfine; localhost yalnız izin varken", () => {
  const ok = (u: string, loopback = false) => isAllowedRedirect(u, { loopback });
  for (const u of HOSTED_CALLBACKS) assert.ok(ok(u), u);
  assert.equal(ok("http://claude.ai/api/mcp/auth_callback"), false);
  assert.equal(ok("https://claude.ai/api/mcp/auth_callback/x"), false);
  assert.equal(ok("https://claude.ai/api/mcp/auth_callback?x=1"), false);
  assert.equal(ok("https://claude.ai.evil.com/api/mcp/auth_callback"), false);
  assert.equal(ok("https://claude.ai@evil.com/"), false);
  assert.equal(ok("https://claude.ai/api/mcp/auth_callback#frag"), false);
  assert.equal(ok("https://CLAUDE.AI/api/mcp/auth_callback"), false);
  assert.equal(ok("https://evil.example/cb"), false);
  assert.equal(ok("http://localhost:6274/oauth/callback"), false);
  assert.equal(ok("http://localhost:6274/oauth/callback", true), true);
  assert.equal(ok("http://127.0.0.1:53111/callback", true), true);
  assert.equal(ok("http://[::1]:8080/cb", true), true);
  assert.equal(ok("https://localhost/callback", true), false, "localhost'ta https yok");
  assert.equal(ok("http://localhost.evil.com/cb", true), false);
  assert.equal(ok("http://user@localhost/cb", true), false);
  assert.equal(isLoopbackUri("http://127.0.0.1/callback"), true);
  assert.equal(isLoopbackUri("http://10.0.0.1/callback"), false);
});

test("redirectMatches: birebir; localhost kayıtlarında port sayılmaz (RFC 8252 §7.3), yol ve sunucu sayılır", () => {
  assert.ok(redirectMatches(CLAUDE, [CLAUDE]));
  assert.equal(redirectMatches("https://claude.com/api/mcp/auth_callback", [CLAUDE]), false);
  assert.ok(redirectMatches("http://localhost:53111/callback", ["http://localhost/callback"]));
  assert.ok(redirectMatches("http://127.0.0.1:9/callback", ["http://127.0.0.1/callback"]));
  assert.equal(redirectMatches("http://127.0.0.1:9/callback", ["http://localhost/callback"]), false);
  assert.equal(redirectMatches("http://localhost:9/baska", ["http://localhost/callback"]), false);
  assert.equal(redirectMatches("https://claude.ai:8443/api/mcp/auth_callback", [CLAUDE]), false);
});

test("kapsam: yalnız panel:oku ve offline_access; bilinmeyenler düşer, panel:oku her zaman var", () => {
  assert.equal(parseScope(null), "panel:oku");
  assert.equal(parseScope(""), "panel:oku");
  assert.equal(parseScope("panel:oku offline_access"), "panel:oku offline_access");
  assert.equal(parseScope("offline_access"), "panel:oku offline_access");
  assert.equal(parseScope("admin:yaz panel:sil"), "panel:oku");
});

// ---------------------------------------------------------------- CIMD ve otomatik kayıt

test("CIMD adresi: https, claude.ai / claude.com, /oauth/ yolu; başka sunucu, port, IP, sorgu reddedilir", () => {
  assert.ok(isAllowedCimdUrl(CLAUDE_CIMD_URL));
  assert.ok(isAllowedCimdUrl("https://claude.com/oauth/mcp-oauth-client-metadata"));
  for (const u of [
    "http://claude.ai/oauth/mcp-oauth-client-metadata",
    "https://evil.com/oauth/x",
    "https://claude.ai:8443/oauth/x",
    "https://10.0.0.1/oauth/x",
    "https://claude.ai/baska/x",
    "https://claude.ai/oauth/x?y=1",
    "https://claude.ai/oauth/x#y",
    "https://x@claude.ai/oauth/x",
    "https://claude.ai.evil.com/oauth/x",
  ])
    assert.equal(isAllowedCimdUrl(u), false, u);
  assert.ok(isUrlClientId(CLAUDE_CIMD_URL));
  assert.equal(isUrlClientId("mcp_abc"), false);
});

test("CIMD belgesi: Claude'unki geçer; client_id başka, izinli dönüşü olmayan, gizli anahtar isteyen reddedilir; izinsiz ek dönüş saklanmaz; Claude Code yalnız localhost izniyle", () => {
  const v = validateCimdDocument(CLAUDE_CIMD_URL, CLAUDE_CIMD, { loopback: false });
  assert.deepEqual(v, { ok: true, name: "Claude", redirectUris: [CLAUDE], ignored: [] });
  assert.equal(validateCimdDocument("https://claude.com/oauth/x", CLAUDE_CIMD, { loopback: false }).ok, false);
  // Claude belgesine bir dönüş adresi daha eklerse (ör. masaüstü) belge düşmez: izinli olan kalır, öteki saklanmaz
  const more = validateCimdDocument(CLAUDE_CIMD_URL, { ...CLAUDE_CIMD, redirect_uris: [CLAUDE, "claude://oauth/callback", "https://evil.example/cb"] }, { loopback: false });
  assert.deepEqual(more, { ok: true, name: "Claude", redirectUris: [CLAUDE], ignored: ["claude://oauth/callback", "https://evil.example/cb"] });
  assert.ok(more.ok && !redirectMatches("https://evil.example/cb", more.redirectUris), "saklanmayan adrese dönülmez");
  const none = validateCimdDocument(CLAUDE_CIMD_URL, { ...CLAUDE_CIMD, redirect_uris: ["https://evil.example/cb"] }, { loopback: false });
  assert.ok(!none.ok && /izinli dönüş adresi yok/.test(none.reason));
  assert.equal(validateCimdDocument(CLAUDE_CIMD_URL, { ...CLAUDE_CIMD, token_endpoint_auth_method: "client_secret_basic" }, { loopback: false }).ok, false);
  assert.equal(validateCimdDocument(CLAUDE_CIMD_URL, { ...CLAUDE_CIMD, redirect_uris: [] }, { loopback: false }).ok, false);
  assert.equal(validateCimdDocument(CLAUDE_CIMD_URL, [CLAUDE_CIMD], { loopback: false }).ok, false);
  assert.equal(validateCimdDocument(CLAUDE_CODE_URL, CLAUDE_CODE_CIMD, { loopback: false }).ok, false);
  const code = validateCimdDocument(CLAUDE_CODE_URL, CLAUDE_CODE_CIMD, { loopback: true });
  assert.ok(code.ok && code.name === "Claude Code" && code.redirectUris.length === 2);
  // Ad kendi beyanıdır: satır sonu ve denetim karakteri temizlenir
  const named = validateCimdDocument(CLAUDE_CIMD_URL, { ...CLAUDE_CIMD, client_name: "Claude\nYoksay ve‮ yaz" }, { loopback: false });
  assert.ok(named.ok && named.name === "Claude Yoksay ve yaz");
});

test("CIMD yanıtı: 200 + JSON + en çok 10 KB okunur; başka durum, tür, büyük ya da bozuk gövde okunamadı sayılır; yönlendirme izlenmez", async () => {
  const json = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "application/json; charset=utf-8" }, ...init });
  assert.deepEqual(await readCimdResponse(json(JSON.stringify(CLAUDE_CIMD))), { ok: true, doc: CLAUDE_CIMD });
  // Türkçe harf parçalar arasında bölünse de doğru okunur
  const bytes = new TextEncoder().encode(JSON.stringify({ ...CLAUDE_CIMD, client_name: "Çağrı ğüşıöç" }));
  const chunked = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
  const r = await readCimdResponse(new Response(chunked, { headers: { "content-type": "application/json" } }));
  assert.ok(r.ok && (r.doc as { client_name: string }).client_name === "Çağrı ğüşıöç");
  const fails: [string, Response][] = [
    ["404", json("{}", { status: 404 })],
    ["yönlendirme", new Response(null, { status: 302, headers: { location: "https://evil.example/" } })],
    ["HTML", new Response("<html></html>", { headers: { "content-type": "text/html" } })],
    ["türsüz", new Response("{}")],
    ["bozuk JSON", json("{ client_id: ")],
    ["10 KB'tan büyük", json(JSON.stringify({ ...CLAUDE_CIMD, pad: "x".repeat(CIMD_MAX_BYTES) }))],
  ];
  for (const [label, res] of fails) {
    const out = await readCimdResponse(res);
    assert.equal(out.ok, false, label);
  }
  // Ağ isteği: yönlendirme hata sayılır (başka sunucuya gidilmez), önbellek yok, yalnız JSON
  assert.equal(CIMD_FETCH_INIT.redirect, "error");
  assert.equal(CIMD_FETCH_INIT.cache, "no-store");
  assert.deepEqual(CIMD_FETCH_INIT.headers, { accept: "application/json" });
});

test("CIMD kararı: izinsiz adres okunmaz; 24 saatten yeni önbellek; eskiyse okunur ve kaydedilir; okunamazsa eski kayıt, geçersizse hiçbiri", async () => {
  const NOW = new Date("2026-10-23T09:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
  type Row = { id: number; fetchedAt: Date | null; redirectUris: string[] };
  /** Sahte okuma / kayıt: kim çağrıldı, ne kaydedildi */
  function io(cached: Row | null, read: CimdRead) {
    const calls = { cached: 0, fetch: 0, saved: [] as { name: string; redirectUris: string[] }[], warn: [] as string[] };
    return {
      calls,
      io: {
        cached: async () => (calls.cached++, cached),
        fetchDocument: async () => (calls.fetch++, read),
        save: async (v: { name: string; redirectUris: string[] }) => (calls.saved.push(v), { id: 2, fetchedAt: NOW, redirectUris: v.redirectUris }),
        warn: (m: string) => void calls.warn.push(m),
      },
    };
  }
  const good: CimdRead = { ok: true, doc: CLAUDE_CIMD };
  const down: CimdRead = { ok: false, reason: "HTTP 503" };
  const stale: Row = { id: 1, fetchedAt: hoursAgo(CIMD_MAX_AGE_H + 1), redirectUris: [CLAUDE] };

  // İzinsiz adres: ne önbelleğe ne ağa gidilir
  let t = io(stale, good);
  assert.equal(await resolveCimd("https://evil.example/oauth/x", NOW, { loopback: false }, t.io), null);
  assert.deepEqual([t.calls.cached, t.calls.fetch], [0, 0]);
  // Taze önbellek: ağa gidilmez
  const fresh: Row = { id: 1, fetchedAt: hoursAgo(1), redirectUris: [CLAUDE] };
  t = io(fresh, good);
  assert.equal(await resolveCimd(CLAUDE_CIMD_URL, NOW, { loopback: false }, t.io), fresh);
  assert.equal(t.calls.fetch, 0);
  // Eski önbellek (ya da okunuş anı yok): okunur, kaydedilir
  for (const row of [stale, { ...stale, fetchedAt: null }, null]) {
    t = io(row, good);
    const out = await resolveCimd(CLAUDE_CIMD_URL, NOW, { loopback: false }, t.io);
    assert.equal(out?.id, 2);
    assert.deepEqual(t.calls.saved, [{ name: "Claude", redirectUris: [CLAUDE] }]);
  }
  // Belge okunamadı (Claude'un sunucusu o an kapalı): eski kayıt kullanılır, hiç yoksa tanınmaz
  t = io(stale, down);
  assert.equal(await resolveCimd(CLAUDE_CIMD_URL, NOW, { loopback: false }, t.io), stale);
  assert.deepEqual(t.calls.saved, []);
  assert.match(t.calls.warn[0], /okunamadı \(HTTP 503\); önbellekteki kullanıldı/);
  t = io(null, down);
  assert.equal(await resolveCimd(CLAUDE_CIMD_URL, NOW, { loopback: false }, t.io), null);
  // Okunup geçersiz çıkan belge (başka client_id, izinli dönüş yok): eski kayda dönülmez
  for (const doc of [{ ...CLAUDE_CIMD, client_id: "https://claude.ai/oauth/baska" }, { ...CLAUDE_CIMD, redirect_uris: ["https://evil.example/cb"] }]) {
    t = io(stale, { ok: true, doc });
    assert.equal(await resolveCimd(CLAUDE_CIMD_URL, NOW, { loopback: false }, t.io), null);
    assert.deepEqual(t.calls.saved, []);
    assert.match(t.calls.warn[0], /reddedildi/);
  }
  // İzinsiz ek dönüş adresi: yalnız izinli olan kaydedilir, günlüğe yazılır
  t = io(null, { ok: true, doc: { ...CLAUDE_CIMD, redirect_uris: [CLAUDE, "claude://oauth/callback"] } });
  assert.equal((await resolveCimd(CLAUDE_CIMD_URL, NOW, { loopback: false }, t.io))?.id, 2);
  assert.deepEqual(t.calls.saved, [{ name: "Claude", redirectUris: [CLAUDE] }]);
  assert.match(t.calls.warn[0], /saklanmadı: claude:\/\/oauth\/callback/);
});

test("otomatik kayıt (DCR): izinli adresler geçer; yabancı adres invalid_redirect_uri; kod akışı yoksa invalid_client_metadata; uzun ad kesilir", () => {
  const ok = validateRegistration({ client_name: "Claude", redirect_uris: [CLAUDE], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, { loopback: false });
  assert.deepEqual(ok, { ok: true, name: "Claude", redirectUris: [CLAUDE] });
  // Claude'un kimlik belgesindeki gibi fazladan akış (jwt-bearer) reddedilmez, düşer (yanıt yalnız kod + yenileme der)
  const extra = validateRegistration(
    { client_name: "Claude", redirect_uris: [CLAUDE], grant_types: CLAUDE_CIMD.grant_types, response_types: ["code"], token_endpoint_auth_method: "none", scope: "panel:oku offline_access" },
    { loopback: false },
  );
  assert.deepEqual(extra, { ok: true, name: "Claude", redirectUris: [CLAUDE] });
  const noCode = validateRegistration({ redirect_uris: [CLAUDE], grant_types: ["refresh_token"] }, { loopback: false });
  assert.ok(!noCode.ok && noCode.error === "invalid_client_metadata");
  const foreign = validateRegistration({ redirect_uris: [CLAUDE, "https://evil.example/cb"] }, { loopback: false });
  assert.ok(!foreign.ok && foreign.error === "invalid_redirect_uri");
  const cc = validateRegistration({ redirect_uris: [CLAUDE], grant_types: ["client_credentials"] }, { loopback: false });
  assert.ok(!cc.ok && cc.error === "invalid_client_metadata");
  const token = validateRegistration({ redirect_uris: [CLAUDE], response_types: ["token"] }, { loopback: false });
  assert.ok(!token.ok && token.error === "invalid_client_metadata");
  assert.ok(!validateRegistration({ redirect_uris: [] }, { loopback: false }).ok);
  assert.ok(!validateRegistration({ redirect_uris: Array(6).fill(CLAUDE) }, { loopback: false }).ok);
  assert.ok(!validateRegistration("metin", { loopback: false }).ok);
  // İstemci gizli anahtar istese de açık istemci kaydedilir (yanıt hep "none")
  assert.ok(validateRegistration({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "client_secret_post" }, { loopback: false }).ok);
  const long = validateRegistration({ redirect_uris: [CLAUDE], client_name: "A".repeat(300) }, { loopback: false });
  assert.ok(long.ok && long.name.length === 100 && long.name.endsWith("…"));
  const loop = validateRegistration({ redirect_uris: ["http://localhost:6274/oauth/callback"] }, { loopback: true });
  assert.ok(loop.ok && loop.name === "Adsız uygulama");
  assert.ok(!validateRegistration({ redirect_uris: ["http://localhost:6274/oauth/callback"] }, { loopback: false }).ok);
});

// ---------------------------------------------------------------- Yetki isteği

const client = { id: 7, clientId: "mcp_abc", name: "Claude", redirectUris: [CLAUDE] };
const ctx = { base: BASE, loopback: false, now: Date.UTC(2026, 9, 22, 12) };
const q = (o: Record<string, string>) =>
  new URLSearchParams({ response_type: "code", client_id: "mcp_abc", redirect_uri: CLAUDE, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s1", ...o });
const redirected = (r: ReturnType<typeof checkAuthorize>) => {
  assert.ok(!r.ok && r.redirect, JSON.stringify(r));
  return new URL(r.to);
};

test("yetki isteği: istemci ya da dönüş adresi güvenilmezse kendi sayfası; öteki hatalar state ve iss ile istemciye", () => {
  const unknown = checkAuthorize(q({}), null, ctx);
  assert.ok(!unknown.ok && !unknown.redirect && unknown.title === "Uygulama tanınmadı");
  const foreign = checkAuthorize(q({ redirect_uri: "https://evil.example/cb" }), client, ctx);
  assert.ok(!foreign.ok && !foreign.redirect && foreign.status === 400);
  const missing = checkAuthorize(q({ redirect_uri: "" }), client, ctx);
  assert.ok(!missing.ok && !missing.redirect);
  // Kayıtlı ama artık izin listesinde olmayan adres de sayfada kalır
  const stale = checkAuthorize(q({ redirect_uri: "http://localhost:9/cb" }), { ...client, redirectUris: ["http://localhost:9/cb"] }, ctx);
  assert.ok(!stale.ok && !stale.redirect);

  const tokenFlow = redirected(checkAuthorize(q({ response_type: "token" }), client, ctx));
  assert.equal(tokenFlow.searchParams.get("error"), "unsupported_response_type");
  assert.equal(tokenFlow.searchParams.get("state"), "s1");
  assert.equal(tokenFlow.searchParams.get("iss"), BASE);
  assert.equal(`${tokenFlow.origin}${tokenFlow.pathname}`, CLAUDE);
  assert.equal(redirected(checkAuthorize(q({ code_challenge_method: "plain" }), client, ctx)).searchParams.get("error"), "invalid_request");
  assert.equal(redirected(checkAuthorize(q({ code_challenge: "" }), client, ctx)).searchParams.get("error"), "invalid_request");
  assert.equal(redirected(checkAuthorize(q({ code_challenge: "kisa" }), client, ctx)).searchParams.get("error"), "invalid_request");
  assert.equal(redirected(checkAuthorize(q({ resource: "https://baska.example/api/mcp" }), client, ctx)).searchParams.get("error"), "invalid_target");
  assert.equal(redirected(checkAuthorize(q({ state: "x".repeat(1001) }), client, ctx)).searchParams.get("error"), "invalid_request");
  const dup = q({});
  dup.append("code_challenge", CHALLENGE);
  assert.equal(redirected(checkAuthorize(dup, client, ctx)).searchParams.get("error"), "invalid_request");
});

test("yetki isteği: geçerli istek mühürlenecek isteğe döner (host, kapsam, kaynak, 10 dakika)", () => {
  const r = checkAuthorize(q({ scope: "panel:oku offline_access", resource: "https://LADMIN.laffogato.net/api/mcp/" }), client, ctx);
  assert.ok(r.ok);
  assert.equal(r.req.host, "claude.ai");
  assert.equal(r.req.scope, "panel:oku offline_access");
  assert.equal(r.req.resource, `${BASE}/api/mcp`);
  assert.equal(r.req.issuer, BASE);
  assert.equal(r.req.loopback, false);
  assert.equal(r.req.state, "s1");
  assert.equal(r.req.exp, ctx.now + REQUEST_TTL_S * 1000);
  // Kaynak gönderilmezse panelin MCP adresi; state yoksa null
  const plain = new URLSearchParams(q({}));
  plain.delete("state");
  const p = checkAuthorize(plain, client, ctx);
  assert.ok(p.ok && p.req.state === null && p.req.resource === `${BASE}/api/mcp` && p.req.scope === "panel:oku");
});

test("mühürden çıkan istek: biçim, süre ve 10 dakikalık üst sınır denetlenir", () => {
  const r = checkAuthorize(q({}), client, ctx);
  assert.ok(r.ok);
  const plain = JSON.stringify(r.req);
  assert.deepEqual(readAuthRequest(plain, ctx.now), r.req);
  assert.equal(readAuthRequest(plain, r.req.exp), null, "süresi doldu");
  assert.equal(readAuthRequest(JSON.stringify({ ...r.req, exp: ctx.now + REQUEST_TTL_S * 1000 + 60_000 }), ctx.now), null, "10 dakikadan uzun");
  assert.equal(readAuthRequest(JSON.stringify({ ...r.req, codeChallenge: "kisa" }), ctx.now), null);
  assert.equal(readAuthRequest(JSON.stringify({ ...r.req, clientDbId: "7" } as unknown as AuthRequest), ctx.now), null);
  assert.equal(readAuthRequest("{bozuk", ctx.now), null);
  assert.equal(readAuthRequest(null, ctx.now), null);
});

test("dönüş adresleri: kod ve hata state ve iss ile; mevcut sorgu korunur", () => {
  const c = new URL(codeRedirect(CLAUDE, "lafac_x", "s1", BASE));
  assert.deepEqual([c.searchParams.get("code"), c.searchParams.get("state"), c.searchParams.get("iss")], ["lafac_x", "s1", BASE]);
  const noState = new URL(codeRedirect("http://localhost:9/cb?a=1", "k", null, BASE));
  assert.equal(noState.searchParams.get("a"), "1");
  assert.equal(noState.searchParams.has("state"), false);
  const e = new URL(errorRedirect(CLAUDE, "access_denied", "Kullanıcı reddetti", "s2", BASE));
  assert.deepEqual([e.searchParams.get("error"), e.searchParams.get("state"), e.searchParams.get("iss")], ["access_denied", "s2", BASE]);
});

// ---------------------------------------------------------------- Anahtarlar ve PKCE

test("PKCE S256: RFC 7636 Ek B örneği; 42 karakterlik ve yanlış doğrulayıcı reddedilir", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(pkceS256(verifier), CHALLENGE);
  assert.ok(pkceMatches(verifier, CHALLENGE));
  assert.equal(pkceMatches(verifier.slice(0, 42), pkceS256(verifier.slice(0, 42))), false);
  assert.equal(pkceMatches(`${verifier}x`, CHALLENGE), false);
  assert.equal(pkceMatches(undefined, CHALLENGE), false);
  assert.equal(pkceMatches(`${verifier.slice(0, 42)}!`, CHALLENGE), false);
});

test("anahtarlar: türü önekte, 256 bit; özet sabit ve türler ayrı; sabit süreli karşılaştırma", () => {
  const at = newToken("at");
  assert.match(at, /^lafat_[A-Za-z0-9_-]{43}$/);
  assert.ok(isMcpTokenShaped(at, "at"));
  assert.equal(isMcpTokenShaped(at, "rt"), false, "erişim anahtarı yenileme yerine geçmez");
  assert.equal(isMcpTokenShaped(`${at}x`, "at"), false);
  assert.equal(isMcpTokenShaped(42, "at"), false);
  assert.notEqual(newToken("at"), at);
  assert.equal(hashMcpToken(at), hashMcpToken(at));
  assert.match(hashMcpToken(at), /^[0-9a-f]{64}$/);
  const rt = `lafrt_${at.slice(6)}`;
  assert.notEqual(hashMcpToken(rt), hashMcpToken(at));
  assert.ok(mcpTokenMatches(at, hashMcpToken(at)));
  assert.equal(mcpTokenMatches(at, hashMcpToken(rt)), false);
  assert.equal(mcpTokenMatches(at, ""), false);
  assert.match(newClientId(), /^mcp_[A-Za-z0-9_-]{22}$/);
});

test("yenileme anahtarı kararı: yeni → değiştir; 60 sn içinde ve halef kullanılmadıysa → pay; değilse → yeniden kullanım", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const later = new Date("2026-11-20T12:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  const row = (o: Partial<Parameters<typeof refreshDecision>[0]>) => ({ expiresAt: later, rotatedAt: null, revokedAt: null, successorUsed: false, ...o });
  assert.equal(refreshDecision(row({}), now), "rotate");
  assert.equal(refreshDecision(row({ rotatedAt: ago(30) }), now), "grace");
  assert.equal(refreshDecision(row({ rotatedAt: ago(30), successorUsed: true }), now), "reuse");
  assert.equal(refreshDecision(row({ rotatedAt: ago(120) }), now), "reuse");
  assert.equal(refreshDecision(row({ expiresAt: ago(1) }), now), "expired");
  assert.equal(refreshDecision(row({ revokedAt: ago(5), rotatedAt: ago(5) }), now), "revoked");
});

test("süreler: erişim 1 saat, yenileme 30 gün, bağlantı 90 gün; hiçbiri bağlantının bitişini geçmez", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const grant = grantExpiry(now);
  assert.equal(grant.toISOString(), "2027-01-20T12:00:00.000Z");
  assert.equal(accessExpiry(now, grant).getTime() - now.getTime(), 3_600_000);
  assert.equal(refreshExpiry(now, grant).toISOString(), "2026-11-21T12:00:00.000Z");
  const soon = new Date(now.getTime() + 600_000);
  assert.equal(accessExpiry(now, soon).getTime(), soon.getTime());
  assert.equal(refreshExpiry(now, soon).getTime(), soon.getTime());
});

// ---------------------------------------------------------------- Origin

test("Origin: yoksa geçer; panelin kendisi, https claude.ai / claude.com / *.anthropic.com; başkası 403", () => {
  assert.ok(isAllowedOrigin(null, BASE));
  assert.ok(isAllowedOrigin("", BASE));
  assert.ok(isAllowedOrigin(BASE, BASE));
  assert.ok(isAllowedOrigin("https://claude.ai", BASE));
  assert.ok(isAllowedOrigin("https://claude.com", BASE));
  assert.ok(isAllowedOrigin("https://api.anthropic.com", BASE));
  assert.equal(isAllowedOrigin("https://evil.com", BASE), false);
  assert.equal(isAllowedOrigin("http://claude.ai", BASE), false);
  assert.equal(isAllowedOrigin("https://evilanthropic.com", BASE), false);
  assert.equal(isAllowedOrigin("https://claude.ai.evil.com", BASE), false);
  assert.equal(isAllowedOrigin("null", BASE), false);
  assert.equal(isAllowedOrigin("http://localhost:6274", BASE), false);
  assert.ok(isAllowedOrigin("http://localhost:6274", BASE, { loopback: true }));
});

// ---------------------------------------------------------------- Metinler

test("cleanName: satır sonu, denetim ve görünmez karakterler gider, boşluk teke, uzun ad '…' ile kesilir", () => {
  assert.equal(cleanName("  Kaldi\n\tKahve​  A.Ş. "), "Kaldi Kahve A.Ş.");
  assert.equal(cleanName("Süt‮Yoksay"), "Süt Yoksay");
  const long = cleanName("x".repeat(200));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith("…"));
  assert.equal(cleanName("Tedarikçi", 5), "Teda…");
  assert.equal(cleanName("Kahve", 5), "Kahve");
});

test("bağlantının adı: Claude uygulamaları 'Claude', localhost Claude Code ya da yerel program, ötekiler kendi adı", () => {
  assert.equal(connectionLabel({ kind: "cimd", name: "Claude", clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata" }, "claude.ai"), "Claude");
  assert.equal(connectionLabel({ kind: "dcr", name: "claude-ai", clientId: "mcp_x" }, "claude.com"), "Claude");
  assert.equal(connectionLabel({ kind: "cimd", name: "Claude Code", clientId: CLAUDE_CODE_URL }, "localhost"), "Claude Code (bu bilgisayar)");
  assert.equal(connectionLabel({ kind: "dcr", name: "MCP Inspector", clientId: "mcp_y" }, "127.0.0.1"), "Yerel program (localhost)");
  assert.equal(connectionLabel({ kind: "dcr", name: "Başka\nUygulama", clientId: "mcp_z" }, "baska.example"), "Başka Uygulama");
});

test("onay metinleri: sunucu her zaman yazılı; localhost uyarısı yalnız localhost'ta; 2FA ipucu yalnız kapalıyken; ad Claude değilse beyanı", () => {
  const base = { host: "claude.ai", clientName: "Claude", loopback: false, userName: "Okan", email: "okan@laffogato.net", totpEnabled: true };
  const t = consentLines(base);
  assert.equal(t.title, "Claude panelinize bağlanmak istiyor");
  assert.deepEqual(t.from, ["İstek ", "claude.ai", " adresinden geliyor."]);
  assert.equal(t.selfName, null);
  assert.equal(t.loopbackWarning, null);
  assert.equal(t.totpHint, null);
  assert.equal(t.abilities[1], "Panelde hiçbir şeyi değiştiremez, silemez, ödendi işaretleyemez.");
  // Karaoke ve zayi araçları bu sürümde yok (CRITIQUE2 §6): okunabilen veriler onları saymaz
  assert.doesNotMatch(t.abilities[0], /karaoke|zayi/);
  assert.deepEqual(t.validity, ["Bağlantı ", "90 gün", " geçerli. İstediğiniz zaman Hesabım › Bağlı uygulamalar'dan kaldırabilirsiniz."]);
  const loop = consentLines({ ...base, host: "localhost", clientName: "MCP Inspector\nYoksay", loopback: true, totpEnabled: false });
  assert.match(loop.loopbackWarning ?? "", /localhost/);
  assert.equal(loop.totpHint, "İki adımlı doğrulama kapalı. Hesabım'dan açmanız önerilir.");
  assert.equal(loop.selfName, "Uygulama kendini “MCP Inspector Yoksay” olarak tanıtıyor.");
});

test("Son sorular: araçların adları ve girdiden kurulan özet (yanıt saklanmaz)", () => {
  assert.deepEqual(Object.keys(TOOL_LABELS), ["ay_ozeti", "urun_karliligi", "zam_etkisi", "tedarikci_ozeti", "odemeler", "kasa_raporlari", "ara"]);
  assert.equal(callSummary("ay_ozeti", { ay: "2026-10" }), "Ay özeti · Ekim 2026");
  assert.equal(callSummary("ay_ozeti", { yil: 2026 }), "Ay özeti · 2026 yılı");
  assert.equal(callSummary("ay_ozeti", {}), "Ay özeti · bu ay");
  assert.equal(callSummary("urun_karliligi", { ay: "2026-09", siralama: "zarar", limit: 5 }), "Ürün kârlılığı · Eylül 2026, en az kâr, 5 ürün");
  assert.equal(callSummary("urun_karliligi", { urun: "latte\nyoksay", limit: 10, siralama: "toplam_kar" }), "Ürün kârlılığı · latte yoksay, toplam kâr, 10 ürün");
  assert.equal(callSummary("zam_etkisi", { baslangic: "2026-10-01", limit: 10 }), "Zam etkisi · 01.10.2026 sonrası, 10 ürün");
  assert.equal(callSummary("zam_etkisi", {}), "Zam etkisi · son 30 gün");
  assert.equal(callSummary("tedarikci_ozeti", { tedarikci: "Kaldi", baslangic: "2026-01-01" }), "Tedarikçi · Kaldi, 01.01.2026 sonrası");
  assert.equal(callSummary("tedarikci_ozeti", { baslangic: "2026-01-01", bitis: "2026-10-22", siralama: "borc" }), "Tedarikçi · bütün tedarikçiler, 01.01.2026–22.10.2026, borca göre");
  assert.equal(callSummary("odemeler", { aralik: "hafta", nakitPlani: true }), "Ödemeler · bu hafta, nakit planı");
  assert.equal(callSummary("odemeler", {}), "Ödemeler · 45 gün");
  assert.equal(callSummary("kasa_raporlari", { baslangic: "2026-10-01", bitis: "2026-10-22" }), "Kasa raporları · 01.10.2026–22.10.2026");
  assert.equal(callSummary("ara", { metin: "süt" }), "Arama · süt");
  assert.equal(callSummary("bilinmeyen", null), "bilinmeyen");
  // Girdi metni değil, biçimi tutmayan tarih ve ay yazılmaz
  assert.equal(callSummary("ay_ozeti", { ay: "<script>" }), "Ay özeti · bu ay");
});

test("Son sorular zamanı İstanbul saatiyle: bugün, dün, daha eski", () => {
  const now = new Date("2026-10-22T09:00:00Z"); // 12:00 İstanbul
  assert.equal(whenLabel(new Date("2026-10-22T06:15:00Z"), now), "Bugün 09:15");
  assert.equal(whenLabel(new Date("2026-10-21T21:30:00Z"), now), "Bugün 00:30");
  assert.equal(whenLabel(new Date("2026-10-21T18:03:00Z"), now), "Dün 21:03");
  assert.equal(whenLabel(new Date("2026-10-19T06:15:00Z"), now), "19.10.2026 09:15");
});

test("yeni bağlantı e-postası: ne zaman, hangi uygulama, kendisi yapmadıysa ne yapacağı ve Hesabım bağlantısı", () => {
  const m = renderConnectedNotice({ name: "Okan", label: "Claude", host: "claude.ai", at: new Date("2026-10-22T11:05:00Z"), base: BASE });
  assert.equal(m.subject, "Panelinize Claude bağlandı");
  assert.match(m.text, /Okan, 22\.10\.2026 14:05 itibarıyla Claude \(claude\.ai\) L'Affogato panelinizi salt okunur olarak okuyabiliyor\./);
  assert.match(m.text, /Bunu siz yapmadıysanız hemen Hesabım › Bağlı uygulamalar'dan kaldırın ve parolanızı değiştirin: https:\/\/ladmin\.laffogato\.net\/panel\/hesap#bagli-uygulamalar/);
  assert.match(m.html, /href="https:\/\/ladmin\.laffogato\.net\/panel\/hesap#bagli-uygulamalar"/);
  assert.match(m.html, />Bağlı uygulamalar</);
  // Ad HTML'e kaçışla girer
  assert.doesNotMatch(renderConnectedNotice({ name: "<b>x</b>", label: "Claude", host: "claude.ai", at: new Date(), base: BASE }).html, /<b>x<\/b>/);
});
