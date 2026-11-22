/**
 * Paraşüt'ün eski kimlik yöntemi için GEÇİCİ yedeğin saf kuralları: hangi yolun seçileceği, son tarih, eski uca giden
 * gövde ve eski ucun retlerinin Türkçe metni. Ağa çıkmaz, ortam değişkeni okumaz (o iş src/server/parasut/legacy.ts'te).
 *
 * Eski yöntem: `grant_type=password` (client_id + client_secret + Paraşüt kullanıcısının e-postası ve parolası,
 * `api.parasut.com/oauth/token`). Yeni yöntem (Authorization Code + PKCE, src/server/parasut/connect.ts) sahibin
 * DevHub'da istemci açıp panelde "Paraşüt hesabını bağla"ya basmasını bekliyor. O güne kadar sabah eşitlemesi durmasın
 * diye: kayıtlı yeni oturum yoksa ve eski kullanıcı adı/parola tanımlıysa eski yöntem çalışmaya devam eder. Paraşüt eski
 * yöntemi 10 Aralık 2026'da kapatıyor; o andan sonra hiç denenmez, açık bir "yeniden bağlayın" hatası verilir.
 *
 * 10 Aralık 2026'dan sonra bu dosya, src/server/parasut/legacy.ts ve çağrıldıkları yerler silinir
 * (docs/planlar/parasut-kimlik-gecisi.md, "Geçici yedek").
 */

/** Paraşüt'ün eski yöntemi kapattığı gün (İstanbul) */
export const LEGACY_DEADLINE_DAY = "2026-12-10";

/**
 * Eski yöntemin denenebileceği son an: 10 Aralık 2026 00:00 İstanbul (UTC+3). Yalnız sahte Paraşüt'le koşan
 * veritabanı testi (tests/parasut-esitleme-db.test.ts) son tarihten sonrasını denemek için değiştirir; canlıda değişmez.
 */
export const PARASUT_LEGACY = { endsAt: Date.parse(`${LEGACY_DEADLINE_DAY}T00:00:00+03:00`) };

/** Eski yöntemle alınan belirtecin `issuer` alanı: yeni kimlik sunucusunun belirteciyle hiçbir zaman karışmaz */
export const LEGACY_ISSUER = "legacy:password";

/**
 * - `oidc`: kayıtlı yeni oturum (refresh_token) var; yalnız o kullanılır, eski yönteme hiç dönülmez.
 * - `legacy`: yeni oturum yok, eski kullanıcı adı/parola tanımlı ve son tarih gelmedi: geçici yedek.
 * - `legacy-closed`: yeni oturum yok, eski ayarlar duruyor ama son tarih geçti: istek atılmaz, yeniden bağlanmalı.
 * - `none`: ikisi de yok: hesap bağlanmalı.
 */
export type ParasutAuthPath = "oidc" | "legacy" | "legacy-closed" | "none";

export function chooseParasutAuth(x: { oidcSession: boolean; legacyConfigured: boolean; now: number }): ParasutAuthPath {
  if (x.oidcSession) return "oidc";
  if (!x.legacyConfigured) return "none";
  return x.now < PARASUT_LEGACY.endsAt ? "legacy" : "legacy-closed";
}

/** Panelde eski yöntemin durumu: hesap bağlıyken ya da eski ayar yokken null */
export function legacyStatus(x: { connected: boolean; legacyConfigured: boolean; now: number }): "active" | "closed" | null {
  const path = chooseParasutAuth({ oidcSession: x.connected, legacyConfigured: x.legacyConfigured, now: x.now });
  return path === "legacy" ? "active" : path === "legacy-closed" ? "closed" : null;
}

const RECONNECT = "Ayarlar › Paraşüt entegrasyonu ekranından “Paraşüt hesabını bağla” ile yeniden bağlayın.";

/** Son tarih geçince (istek atılmadan) verilen hata */
export const LEGACY_CLOSED_TEXT = `Paraşüt eski kullanıcı adı ve parola yöntemini 10 Aralık 2026'da kapattı; faturalar bu yolla artık alınamıyor. ${RECONNECT}`;

/**
 * Eski ucun kalıcı reddinin Türkçe metni (429 ve 5xx geçicidir, buraya gelmez). `unsupported_grant_type`, 401 ve
 * istemci retleri yöntemin kapandığını (ya da Vercel'deki istemcinin artık DevHub'ınki olduğunu) söyler;
 * `invalid_grant` parolanın kabul edilmediğini. Hepsinde çözüm aynı: hesabı yeni yöntemle bağlamak.
 */
export function legacyRejectionText(status: number, body: string): string {
  let code = "";
  let detail = "";
  try {
    const j = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    code = typeof j.error === "string" ? j.error : "";
    detail = typeof j.error_description === "string" ? j.error_description.slice(0, 200) : "";
  } catch {
    code = "";
  }
  const why = detail || code;
  if (status === 401 || code === "unsupported_grant_type" || code === "invalid_client" || code === "unauthorized_client") {
    return `Paraşüt eski kullanıcı adı ve parola yöntemini artık kabul etmiyor${why ? ` (${why})` : ""}. ${RECONNECT}`;
  }
  if (code === "invalid_grant") {
    return `Paraşüt eski kullanıcı adı ve parolayı kabul etmedi (parola değişmiş olabilir). Bu yöntem 10 Aralık 2026'da zaten kapanıyor. ${RECONNECT}`;
  }
  return `Paraşüt eski yöntemle girişi kabul etmedi (HTTP ${status}${why ? `, ${why}` : ""}). ${RECONNECT}`;
}

export interface LegacyCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  /** Eski uç bu adresin altında: {baseUrl}/oauth/token */
  baseUrl: string;
}

/** Eski belirteç ucu (yeni yöntemin ucu keşif belgesinden gelir, bu değil) */
export const legacyTokenUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/oauth/token`;

/** Eski uca giden gövde: refresh_token varsa onunla yenileme, yoksa kullanıcı adı ve parolayla giriş */
export function legacyGrantBody(c: LegacyCredentials, refresh: string | null): URLSearchParams {
  const grant: Record<string, string> = refresh
    ? { grant_type: "refresh_token", refresh_token: refresh }
    : { grant_type: "password", username: c.username, password: c.password };
  return new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: "urn:ietf:wg:oauth:2.0:oob", ...grant });
}
