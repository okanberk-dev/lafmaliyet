/*
 * Claude bağlantısı (salt okunur MCP; docs/CLAUDE-BAGLANTISI.md): panel kendi OAuth yetkilendirme sunucusudur. Bu dosya
 * saf kurallardır (sunucu bağımlılığı yok, tests/claude-baglanti.test.ts sınar): uç adresleri ve metaveri belgeleri,
 * dönüş adresi izin listesi, CIMD belgesi ve otomatik kayıt (DCR) denetimi, yetki isteğinin sırası, yenileme anahtarının
 * kararı, Origin kuralı ve ekran metinleri. Veritabanı tarafı src/server/mcp/store.ts'te.
 */

import { z } from "zod";

import { dateTR, monthLabel } from "../format";
import { addDays, todayTR } from "../reminders";

/** Tek kapsam: paneli okumak. offline_access yenileme anahtarı isteyen istemciler için listede (Claude ekler) */
export const MCP_SCOPE = "panel:oku";
export const OFFLINE_SCOPE = "offline_access";
/** Erişim anahtarı 1 saat */
export const ACCESS_TTL_S = 3600;
/** Yenileme anahtarı 30 gün; her kullanımda yenisiyle değişir (30 gün kullanılmayan bağlantı düşer) */
export const REFRESH_TTL_DAYS = 30;
/** Bağlantı en çok 90 gün; sonra Claude "Yeniden bağlan" der */
export const GRANT_MAX_DAYS = 90;
/** Yetki kodu 2 dakika, tek kullanım */
export const CODE_TTL_S = 120;
/** Onay ekranındaki isteğin ömrü */
export const REQUEST_TTL_S = 600;
/** Ağ hatasında aynı yenileme anahtarı bu kadar saniye içinde bir kez daha kabul edilir (yenisi kullanılmadıysa) */
export const REUSE_GRACE_S = 60;
/** Claude'un yayımlanmış kimlik belgesi (CIMD) bu kadar saat önbellekte */
export const CIMD_MAX_AGE_H = 24;
/** Bir yöneticinin en çok bu kadar etkin bağlantısı olur */
export const MAX_ACTIVE_GRANTS = 10;
/** Otomatik kayıt: IP başına saatte 10, bağlanmamış istemci günde en çok 50 (veritabanında sayılır) */
export const DCR_PER_IP_HOUR = 10;
export const DCR_PENDING_PER_DAY = 50;
/** Claude uygulamalarının dönüş adresleri (Anthropic: claude.ai'den claude.com'a geçebilir, ikisi de) */
export const HOSTED_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"] as const;
/** CIMD belgesi yalnız bu sunuculardan okunur (SSRF: başka adrese istek atılmaz) */
export const CIMD_HOSTS = ["claude.ai", "claude.com"] as const;
/** Claude Code'un yayımlanmış kimliği (yerel geliştirmede; dönüşü localhost) */
export const CLAUDE_CODE_CIMD = "https://claude.ai/oauth/claude-code-client-metadata";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- Adresler ve açılış

export interface McpUrls {
  issuer: string;
  /** MCP sunucusunun adresi (RFC 8707 resource) */
  resource: string;
  /** RFC 9728 belgesi, yola göre (401'deki resource_metadata) */
  prm: string;
  prmRoot: string;
  asMetadata: string;
  authorize: string;
  token: string;
  register: string;
  revoke: string;
  consent: string;
}

/** `base`: panelin kökü, sonunda / yok (canlıda https://ladmin.laffogato.net) */
export function mcpUrls(base: string): McpUrls {
  return {
    issuer: base,
    resource: `${base}/api/mcp`,
    prm: `${base}/.well-known/oauth-protected-resource/api/mcp`,
    prmRoot: `${base}/.well-known/oauth-protected-resource`,
    asMetadata: `${base}/.well-known/oauth-authorization-server`,
    authorize: `${base}/oauth/authorize`,
    token: `${base}/oauth/token`,
    register: `${base}/oauth/register`,
    revoke: `${base}/oauth/revoke`,
    consent: `${base}/baglan`,
  };
}

/** Önizlemede (canlı veritabanını paylaşır) ve acil kapatmada (MCP_DISABLED=1) bütün uçlar 404 */
export function mcpEnabled(env: Record<string, string | undefined>): boolean {
  const off = (env.MCP_DISABLED ?? "").trim().toLowerCase();
  return off !== "1" && off !== "true" && env.VERCEL_ENV !== "preview";
}

/** Claude Code ve MCP Inspector'ın localhost dönüşü: yerelde açık, canlıda yalnız MCP_ALLOW_LOCALHOST=1 ile */
export function loopbackAllowed(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" || env.MCP_ALLOW_LOCALHOST === "1";
}

/**
 * RFC 8707 resource'un karşılaştırılan biçimi: şema ve sunucu küçük harf, varsayılan port yok, sondaki / yok. Parça
 * (#…), kullanıcı bilgisi ya da http(s) dışı şema varsa null.
 */
export function canonicalResource(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || raw.includes("#") || u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}${u.search}`;
}

// ---------------------------------------------------------------- Metaveri belgeleri

/** RFC 9728: korunan kaynağın belgesi (iki yolda aynı) */
export function protectedResourceMetadata(base: string): Record<string, unknown> {
  const u = mcpUrls(base);
  return {
    resource: u.resource,
    authorization_servers: [u.issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "L'Affogato Panel",
  };
}

/**
 * RFC 8414: yetkilendirme sunucusunun belgesi. Claude, client_id_metadata_document_supported ve "none" birlikteyse
 * yayımlanmış kimliğini (CIMD) kullanır, değilse kendini kaydeder (DCR).
 */
export function authServerMetadata(base: string): Record<string, unknown> {
  const u = mcpUrls(base);
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorize,
    token_endpoint: u.token,
    registration_endpoint: u.register,
    revocation_endpoint: u.revoke,
    scopes_supported: [MCP_SCOPE, OFFLINE_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

// ---------------------------------------------------------------- Dönüş adresleri

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Bu bilgisayardaki bir programın dönüşü: http, localhost / 127.0.0.1 / [::1], her port ve yol */
export function isLoopbackUri(uri: string): boolean {
  const u = parse(uri);
  return Boolean(u && u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname) && !u.username && !u.password && !uri.includes("#"));
}

/**
 * İzinli dönüş adresi: Claude'un iki adresinden biri, harfi harfine; ya da (izin varsa) localhost. Başka her adres
 * (claude.ai.evil.com, http://claude.ai, sonuna ek, #parça, kullanıcı@) reddedilir: kod başka bir siteye gidemez.
 */
export function isAllowedRedirect(uri: string, opts: { loopback: boolean }): boolean {
  if ((HOSTED_CALLBACKS as readonly string[]).includes(uri)) return true;
  return opts.loopback && isLoopbackUri(uri);
}

/** İstenen adres kayıtlılardan biri mi: birebir; localhost kayıtlarında port sayılmaz (RFC 8252 §7.3) */
export function redirectMatches(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  if (!isLoopbackUri(requested)) return false;
  const r = parse(requested)!;
  return registered.some((x) => {
    if (!isLoopbackUri(x)) return false;
    const u = parse(x)!;
    return u.hostname === r.hostname && u.pathname === r.pathname && u.search === r.search;
  });
}

/** İstenen kapsam: yalnız panel:oku ve offline_access tutulur, panel:oku her zaman vardır (bilinmeyenler düşer) */
export function parseScope(raw: string | null | undefined): string {
  const asked = new Set((raw ?? "").split(/\s+/).filter(Boolean));
  return asked.has(OFFLINE_SCOPE) ? `${MCP_SCOPE} ${OFFLINE_SCOPE}` : MCP_SCOPE;
}

// ---------------------------------------------------------------- İstemciler: CIMD ve DCR

/** CIMD adresi: https, claude.ai ya da claude.com, yol /oauth/ ile başlar; port, sorgu, parça, kullanıcı bilgisi yok */
export function isAllowedCimdUrl(raw: string): boolean {
  const u = parse(raw);
  if (!u || u.href !== raw) return false;
  return (
    u.protocol === "https:" &&
    (CIMD_HOSTS as readonly string[]).includes(u.hostname) &&
    !u.port &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    u.pathname.startsWith("/oauth/")
  );
}

/** URL biçiminde (https://…) istemci kimliği: CIMD sayılır; izinli değilse istemci tanınmaz */
export const isUrlClientId = (clientId: string) => /^https?:\/\//i.test(clientId);

type ClientCheck = { ok: true; name: string; redirectUris: string[] } | { ok: false; reason: string };

/**
 * Okunan CIMD belgesi: client_id adresin kendisi, dönüş adreslerinin hepsi izinli (localhost portsuz da olur; port
 * eşleşmede sayılmaz), istemci açık (token_endpoint_auth_method yok ya da "none"). Ad kendi beyanıdır, temizlenir.
 */
export function validateCimdDocument(url: string, doc: unknown, opts: { loopback: boolean }): ClientCheck {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, reason: "belge bir nesne değil" };
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url) return { ok: false, reason: "client_id belgenin adresi değil" };
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((x): x is string => typeof x === "string" && x.length <= 2000)) {
    return { ok: false, reason: "redirect_uris geçersiz" };
  }
  const bad = uris.find((x) => !isAllowedRedirect(x, opts));
  if (bad) return { ok: false, reason: `izinsiz dönüş adresi: ${cleanName(bad, 120)}` };
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== "none") return { ok: false, reason: "istemci gizli anahtar istiyor" };
  const name = typeof d.client_name === "string" ? cleanName(d.client_name, 100) : "";
  return { ok: true, name: name || (parse(url)?.hostname ?? "Claude"), redirectUris: [...new Set(uris)] };
}

const registrationSchema = z
  .object({
    redirect_uris: z.array(z.string().min(1).max(2000)).min(1).max(5),
    client_name: z.string().max(2000).optional(),
    grant_types: z.array(z.string().max(200)).max(10).optional(),
    response_types: z.array(z.string().max(200)).max(10).optional(),
    token_endpoint_auth_method: z.string().max(200).optional(),
  })
  .loose();

/**
 * RFC 7591 otomatik kayıt: dönüş adresleri 1–5, hepsi izinli; kod akışı (authorization_code, "code") istenmeli. İstemci
 * ne isterse istesin açık istemci olarak, yalnız kod + yenileme akışıyla kaydedilir (yanıtta token_endpoint_auth_method
 * hep "none", grant_types hep bu ikisi; RFC 7591 §3.2.1 sunucunun kendi değerini koymasına izin verir). Fazladan istenen
 * akış reddedilmez, düşer: Claude'un kimlik belgesi jwt-bearer'ı da sayar, kaydı da sayabilir.
 */
export function validateRegistration(
  body: unknown,
  opts: { loopback: boolean },
): { ok: true; name: string; redirectUris: string[] } | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string } {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    const onUris = parsed.error.issues.some((i) => i.path[0] === "redirect_uris");
    return onUris
      ? { ok: false, error: "invalid_redirect_uri", description: "redirect_uris 1–5 adres olmalı" }
      : { ok: false, error: "invalid_client_metadata", description: "Kayıt bilgisi okunamadı" };
  }
  const v = parsed.data;
  if (v.redirect_uris.some((u) => !isAllowedRedirect(u, opts))) {
    return { ok: false, error: "invalid_redirect_uri", description: "Bu dönüş adresine izin verilmiyor" };
  }
  if (v.grant_types && !v.grant_types.includes("authorization_code")) return { ok: false, error: "invalid_client_metadata", description: "authorization_code gerekli" };
  if (v.response_types && !v.response_types.includes("code")) return { ok: false, error: "invalid_client_metadata", description: "response_types içinde code gerekli" };
  const name = v.client_name ? cleanName(v.client_name, 100) : "";
  return { ok: true, name: name || "Adsız uygulama", redirectUris: [...new Set(v.redirect_uris)] };
}

// ---------------------------------------------------------------- Yetki isteği (/oauth/authorize)

/** Onay ekranına giden, mühürlenmiş istek (/baglan?istek=…) */
export interface AuthRequest {
  clientDbId: number;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string;
  /** Dönüş adresinin sunucusu (onay ekranında kalın) */
  host: string;
  clientName: string;
  loopback: boolean;
  /** Yetkilendirme sunucusunun adresi (dönüşteki iss; istemcinin metaveride gördüğüyle aynı) */
  issuer: string;
  /** Bitiş anı (ms) */
  exp: number;
}

const authRequestSchema = z.object({
  clientDbId: z.number().int().positive(),
  clientId: z.string().min(1).max(500),
  redirectUri: z.string().min(1).max(2000),
  state: z.string().max(1000).nullable(),
  codeChallenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  scope: z.string().min(1).max(100),
  resource: z.string().min(1).max(500),
  host: z.string().min(1).max(300),
  clientName: z.string().max(200),
  loopback: z.boolean(),
  issuer: z.string().min(1).max(500),
  exp: z.number(),
});

/**
 * Mühürden çıkan istek (/baglan?istek=…): biçimi tutmuyorsa, süresi dolduysa ya da bitişi şimdiden 10 dakikadan
 * uzaksa null. Mühür (AES-GCM, AUTH_SECRET) src/server/mcp/base.ts'te açılır; burada yalnız içerik denetlenir.
 */
export function readAuthRequest(plain: string | null, now: number): AuthRequest | null {
  if (!plain) return null;
  try {
    const parsed = authRequestSchema.safeParse(JSON.parse(plain));
    if (!parsed.success) return null;
    const req = parsed.data;
    return req.exp > now && req.exp <= now + REQUEST_TTL_S * 1000 ? req : null;
  } catch {
    return null;
  }
}

export type AuthorizeCheck =
  | { ok: true; req: AuthRequest }
  | { ok: false; redirect: false; status: 400 | 429; title: string; text: string }
  | { ok: false; redirect: true; to: string };

const CHALLENGE = /^[A-Za-z0-9._~-]{43,128}$/;

const page = (title: string, text: string): AuthorizeCheck => ({ ok: false, redirect: false, status: 400, title, text });

/**
 * Yetki isteğinin denetimi, RFC 6749 §4.1.2.1 sırasıyla: istemci ya da dönüş adresi güvenilmezse hata panelin kendi
 * sayfasında gösterilir (kimseye yönlendirilmez); ötekiler hata koduyla istemciye döner (state ve iss ile).
 */
export function checkAuthorize(
  params: URLSearchParams,
  client: { id: number; clientId: string; name: string; redirectUris: readonly string[] } | null,
  ctx: { base: string; loopback: boolean; now: number },
): AuthorizeCheck {
  if (!client) return page("Uygulama tanınmadı", "Bu bağlantı isteği tanınan bir uygulamadan gelmiyor. Claude'a dönüp bağlayıcının yanındaki “Bağlan”a yeniden dokunun.");
  if (params.getAll("client_id").length > 1 || params.getAll("redirect_uri").length > 1) return page("Bağlantı isteği geçersiz", "İstekte aynı bilgi birden çok kez var.");
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri || !redirectMatches(redirectUri, client.redirectUris) || !isAllowedRedirect(redirectUri, { loopback: ctx.loopback })) {
    return page("Bağlantı isteği geçersiz", "Dönüş adresi bu uygulamaya ait değil ya da izin verilmiyor. Claude'a dönüp yeniden deneyin.");
  }
  const iss = ctx.base;
  const rawState = params.get("state");
  const state = rawState !== null && rawState.length <= 1000 ? rawState : null;
  const fail = (error: string, description: string): AuthorizeCheck => ({ ok: false, redirect: true, to: errorRedirect(redirectUri, error, description, state, iss) });
  if (rawState !== null && rawState.length > 1000) return fail("invalid_request", "state çok uzun");
  for (const k of ["response_type", "code_challenge", "code_challenge_method", "scope", "resource", "state"]) {
    if (params.getAll(k).length > 1) return fail("invalid_request", `${k} birden çok kez var`);
  }
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Yalnız response_type=code");
  const challenge = params.get("code_challenge");
  if (!challenge || !CHALLENGE.test(challenge) || params.get("code_challenge_method") !== "S256") return fail("invalid_request", "PKCE S256 gerekli");
  const resource = mcpUrls(ctx.base).resource;
  const asked = params.get("resource");
  if (asked !== null && canonicalResource(asked) !== resource) return fail("invalid_target", "Bu sunucunun adresi değil");
  const host = parse(redirectUri)!.hostname;
  return {
    ok: true,
    req: {
      clientDbId: client.id,
      clientId: client.clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
      scope: parseScope(params.get("scope")),
      resource,
      host,
      clientName: client.name,
      loopback: isLoopbackUri(redirectUri),
      issuer: ctx.base,
      exp: ctx.now + REQUEST_TTL_S * 1000,
    },
  };
}

/** Hatayı istemciye döndüren adres (RFC 6749 §4.1.2.1, RFC 9207 iss) */
export function errorRedirect(redirectUri: string, error: string, description: string, state: string | null, iss: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", description);
  if (state !== null) u.searchParams.set("state", state);
  u.searchParams.set("iss", iss);
  return u.href;
}

/** İzin verildi: kodla dönüş adresi (state ve iss ile) */
export function codeRedirect(redirectUri: string, code: string, state: string | null, iss: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set("code", code);
  if (state !== null) u.searchParams.set("state", state);
  u.searchParams.set("iss", iss);
  return u.href;
}

// ---------------------------------------------------------------- Yenileme anahtarı

export type RefreshDecision = "rotate" | "grace" | "reuse" | "expired" | "revoked";

/**
 * Yenileme anahtarı geldiğinde ne yapılır: kullanılmamışsa yenisiyle değişir (rotate). Kullanılmışsa: son 60 saniyede
 * ve yerine verilen henüz kullanılmadıysa ağ hatası sayılır (grace: bir çift daha verilir, öncekisi de geçerli kalır);
 * değilse çalınmış olabilir (reuse: bağlantı kapatılır).
 */
export function refreshDecision(row: { expiresAt: Date; rotatedAt: Date | null; revokedAt: Date | null; successorUsed: boolean }, now: Date): RefreshDecision {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (!row.rotatedAt) return "rotate";
  if (now.getTime() - row.rotatedAt.getTime() <= REUSE_GRACE_S * 1000 && !row.successorUsed) return "grace";
  return "reuse";
}

/** Yeni yenileme anahtarının bitişi: 30 gün, bağlantının bitişini geçmez */
export function refreshExpiry(now: Date, grantExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + REFRESH_TTL_DAYS * DAY_MS, grantExpiresAt.getTime()));
}

/** Yeni erişim anahtarının bitişi: 1 saat, bağlantının bitişini geçmez */
export function accessExpiry(now: Date, grantExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + ACCESS_TTL_S * 1000, grantExpiresAt.getTime()));
}

export function grantExpiry(now: Date): Date {
  return new Date(now.getTime() + GRANT_MAX_DAYS * DAY_MS);
}

// ---------------------------------------------------------------- Origin (/api/mcp)

/**
 * /api/mcp'de Origin kuralı (MCP: "Origin varsa ve geçersizse 403"): sunucudan sunucuya istekte Origin yok, geçer;
 * varsa panelin kendisi, https claude.ai / claude.com ya da *.anthropic.com olmalı; yerelde localhost da.
 */
export function isAllowedOrigin(origin: string | null, base: string, opts: { loopback?: boolean } = {}): boolean {
  if (origin === null || origin === "") return true;
  const u = parse(origin);
  if (!u || u.origin === "null") return false;
  if (u.origin === parse(base)?.origin) return true;
  if (opts.loopback && (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOSTS.has(u.hostname)) return true;
  if (u.protocol !== "https:") return false;
  return u.hostname === "claude.ai" || u.hostname === "claude.com" || u.hostname.endsWith(".anthropic.com");
}

// ---------------------------------------------------------------- Metinler

/**
 * Dışarıdan gelen ad (istemci adı, tedarikçi, ürün, fatura no): Unicode NFC, denetim ve görünmez biçim karakterleri
 * (satır sonu, sağdan sola işaretleri, sıfır genişlikli) boşluğa, boşluklar teke; uzunsa "…" ile kesilir.
 */
export function cleanName(s: string, max = 80): string {
  const flat = s
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…` : flat;
}

/** Bağlantının Hesabım'daki adı: Claude uygulamaları "Claude", localhost Claude Code ya da yerel program */
export function connectionLabel(c: { kind: "dcr" | "cimd"; name: string; clientId: string }, host: string): string {
  if (host === "claude.ai" || host === "claude.com") return "Claude";
  if (LOOPBACK_HOSTS.has(host)) return c.clientId === CLAUDE_CODE_CIMD || /claude code/i.test(c.name) ? "Claude Code (bu bilgisayar)" : "Yerel program (localhost)";
  return cleanName(c.name, 40) || host;
}

/** Ortası kalın yazılan cümle: [önce, kalın, sonra] */
export type Rich = readonly [string, string, string];

export interface ConsentText {
  title: string;
  /** "İstek **claude.ai** adresinden geliyor." */
  from: Rich;
  host: string;
  /** Uygulama kendini başka adla tanıtıyorsa */
  selfName: string | null;
  abilitiesTitle: string;
  abilities: readonly [string, string, string];
  account: { name: string; email: string };
  validity: Rich;
  warning: Rich;
  loopbackWarning: string | null;
  totpHint: string | null;
}

/** Onay ekranının metinleri (sunucu ve sayfa aynı kaynaktan; host her zaman görünür) */
export function consentLines(i: { host: string; clientName: string; loopback: boolean; userName: string; email: string; totpEnabled: boolean }): ConsentText {
  const self = cleanName(i.clientName, 40);
  return {
    title: "Claude panelinize bağlanmak istiyor",
    from: ["İstek ", i.host, " adresinden geliyor."],
    host: i.host,
    selfName: self && self !== "Claude" ? `Uygulama kendini “${self}” olarak tanıtıyor.` : null,
    abilitiesTitle: "Claude neler yapabilir?",
    abilities: [
      "Maliyet, kâr, satış, fatura, tedarikçi, ödeme ve kasa verilerinizi okuyabilir.",
      "Panelde hiçbir şeyi değiştiremez, silemez, ödendi işaretleyemez.",
      "Parolalar, e-posta adresleri, IBAN ve telefon gibi bilgiler gönderilmez.",
    ],
    account: { name: i.userName, email: i.email },
    validity: ["Bağlantı ", `${GRANT_MAX_DAYS} gün`, " geçerli. İstediğiniz zaman Hesabım › Bağlı uygulamalar'dan kaldırabilirsiniz."],
    warning: ["Bu isteği siz başlatmadıysanız (Claude'da az önce “Bağlan”a siz dokunmadıysanız) ", "Reddet", "'e dokunun."],
    loopbackWarning: i.loopback
      ? "Bu istek bu bilgisayardaki bir programdan geliyor (localhost). Claude Code ya da MCP Inspector'ı siz başlatmadıysanız Reddet'e dokunun."
      : null,
    totpHint: i.totpEnabled ? null : "İki adımlı doğrulama kapalı. Hesabım'dan açmanız önerilir.",
  };
}

/** Hesabım › Bağlı uygulamalar'daki satır: istemci kimliği ve anahtar hiç yok, tarihler metin olarak hazır */
export interface ConnectionView {
  id: number;
  label: string;
  host: string;
  connected: string;
  lastUsed: string | null;
  expires: string;
}

/** Hesabım › Son sorular satırı (girdiden kurulur; yanıt saklanmaz) */
export interface CallView {
  when: string;
  summary: string;
  ok: boolean;
}

/** Son sorular'daki zaman, İstanbul saatiyle: "Bugün 15:12", "Dün 21:03", "20.10.2026 09:15" */
export function whenLabel(at: Date, now: Date): string {
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const day = todayTR(at);
  const today = todayTR(now);
  if (day === today) return `Bugün ${time}`;
  if (day === addDays(today, -1)) return `Dün ${time}`;
  return `${dateTR(day)} ${time}`;
}

/** Araçların Hesabım › Son sorular'daki adları */
export const TOOL_LABELS: Record<string, string> = {
  ay_ozeti: "Ay özeti",
  urun_karliligi: "Ürün kârlılığı",
  zam_etkisi: "Zam etkisi",
  tedarikci_ozeti: "Tedarikçi",
  odemeler: "Ödemeler",
  kasa_raporlari: "Kasa raporları",
  ara: "Arama",
};

const ODEME_ARALIK: Record<string, string> = { gecikmis: "gecikenler", hafta: "bu hafta", ay: "bu ay", "45gun": "45 gün" };
const SIRALAMA: Record<string, string> = { toplam_kar: "toplam kâr", birim_kar: "birim kâr", marj: "marj", adet: "adet", zarar: "en az kâr" };

const str = (v: unknown) => (typeof v === "string" ? cleanName(v, 40) : null);
const monthOr = (v: unknown) => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? monthLabel(v) : null);
const dayOr = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dateTR(v) : null);
/** "01.01.2026–22.10.2026", yalnız başlangıç "01.01.2026 sonrası", yalnız bitiş "bitiş 22.10.2026" */
const period = (from: unknown, to: unknown) => {
  const a = dayOr(from);
  const b = dayOr(to);
  return a && b ? `${a}–${b}` : a ? `${a} sonrası` : b ? `bitiş ${b}` : null;
};

/** "Son sorular" satırı: "Ürün kârlılığı · Eylül 2026, 5 ürün" (girdiden; yanıt saklanmaz) */
export function callSummary(tool: string, args: Record<string, unknown> | null | undefined): string {
  const a = args ?? {};
  const label = TOOL_LABELS[tool] ?? cleanName(tool, 40);
  const parts: (string | null)[] = [];
  switch (tool) {
    case "ay_ozeti":
      parts.push(typeof a.yil === "number" ? `${a.yil} yılı` : (monthOr(a.ay) ?? "bu ay"));
      break;
    case "urun_karliligi":
      parts.push(monthOr(a.ay), str(a.urun), str(a.kategori), typeof a.siralama === "string" ? (SIRALAMA[a.siralama] ?? null) : null, typeof a.limit === "number" ? `${a.limit} ürün` : null);
      break;
    case "zam_etkisi":
      parts.push(dayOr(a.baslangic) ? `${dayOr(a.baslangic)} sonrası` : "son 30 gün", typeof a.limit === "number" ? `${a.limit} ürün` : null);
      break;
    case "tedarikci_ozeti":
      parts.push(str(a.tedarikci) ?? "bütün tedarikçiler", period(a.baslangic, a.bitis), !a.tedarikci && a.siralama === "borc" ? "borca göre" : null);
      break;
    case "odemeler":
      parts.push(typeof a.aralik === "string" ? (ODEME_ARALIK[a.aralik] ?? null) : "45 gün", a.nakitPlani === true ? "nakit planı" : null);
      break;
    case "kasa_raporlari":
      parts.push(period(a.baslangic, a.bitis));
      break;
    case "ara":
      parts.push(str(a.metin));
      break;
  }
  const rest = parts.filter((p): p is string => Boolean(p));
  if (!rest.length) return label;
  const [first, ...more] = rest;
  return more.length ? `${label} · ${first}, ${more.join(", ")}` : `${label} · ${first}`;
}
