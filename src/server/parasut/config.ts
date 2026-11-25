import "server-only";

import { and, eq, isNotNull, or } from "drizzle-orm";

import { DEFAULT_PARASUT_ACCOUNT, parasutKey, parseInvoiceScope, type ParasutInvoiceScope } from "@/lib/parasut/accounts";
import {
  missingSettings,
  PARASUT_SETTING_KEYS,
  PARASUT_SETTINGS,
  resolveParasutSettings,
  settingsView,
  type PanelValues,
  type ParasutSettingsView,
  type ResolvedSettings,
} from "@/lib/parasut/settings";
import { appUrl } from "@/server/auth/tokens";
import { getDb, schema as s } from "@/server/db";
import { open, seal } from "@/server/secret-box";

/**
 * Paraşüt API v4 bağlantı ayarları (docs/PARASUT.md § 1). client_id, client_secret, firma numarası ve ilk eşitleme
 * başlangıcı panelden girilebilir (integration_state › parasut.settings); panelde olmayan alan ortam değişkeninden
 * okunur (kurallar src/lib/parasut/settings.ts). Adres ve izin ayarları yalnız ortamda. client_secret veritabanında
 * şifreli durur ve hiçbir zaman istemciye gönderilmez; ekranda yalnız "kayıtlı mı, nereden" görünür.
 *
 * Kimlik: OAuth 2.0 Authorization Code + PKCE (id.parasut.com). İstemci DevHub'dan alınır ve gizli (confidential)
 * olduğu için client_secret ile birlikte kullanılır.
 *
 * İsteğe bağlı adres değişkenleri (PARASUT_ISSUER, PARASUT_REDIRECT_URI, …) yanlış yazılmışsa ayarlar yine okunur:
 * değer yok sayılır ve `invalid`'e yazılır. Böylece kayıtlı oturumla süren eşitleme bozulmaz; hesabı bağlama ise
 * düzeltilene kadar başlamaz (connect.ts).
 */

/**
 * Panelden girilen ayarlar. client_secret şifreli (amaç "parasut-settings"); öteki alanlar düz metin. Yedeğe girmez
 * (src/lib/backup/format.ts › EXCLUDED_STATE_PREFIXES): şifreli değer başka AUTH_SECRET'la açılmaz, geri yüklemeden
 * sonra oturum da yeniden bağlanır; ayarlar o sırada panelden yeniden girilir (ortamda varsa onlar kullanılır).
 *
 * Şube başına Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı; src/lib/parasut/accounts.ts): her hesabın
 * kaydı ayrı (`parasutKey`): varsayılan şubeninki eski adla ("parasut.settings"), öbürleri "parasut.settings:<hesap>".
 * Ortam değişkenleri (PARASUT_CLIENT_ID, …) yalnız varsayılan hesabın yedeğidir: ikinci şubenin hesabı Vercel'deki
 * istemciyi sessizce devralmasın.
 */
const SETTINGS_KEY = "parasut.settings";

interface StoredSettings {
  clientId?: string;
  /** Şifreli */
  clientSecret?: string;
  companyId?: string;
  syncFrom?: string;
  /** Hesabın faturaları: "shared" işletme geneli (yoksa tek şubenin hesabıysa o şubenin; invoiceBranchOf) */
  invoices?: ParasutInvoiceScope;
  updatedAt?: string;
  updatedBy?: string;
}

type Exec = Pick<ReturnType<typeof getDb>, "select" | "insert" | "delete">;

const settingsKey = (account: string) => parasutKey(SETTINGS_KEY, account);

async function storedSettings(account: string, db: Pick<Exec, "select">): Promise<StoredSettings> {
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, settingsKey(account))).limit(1);
  return (row?.value ?? {}) as StoredSettings;
}

/** Hesabın ortam değişkenleri: yalnız varsayılan hesap ortamdan okur */
export const envOf = (account: string): Record<string, string | undefined> => (account === DEFAULT_PARASUT_ACCOUNT ? process.env : {});

/** Panelde kayıtlı değerler; şifreli client_secret açılamazsa (AUTH_SECRET değişmiş) yok sayılır ve söylenir */
export async function loadPanelSettings(account: string, db: Pick<Exec, "select"> = getDb()): Promise<{ values: PanelValues; secretUnreadable: boolean }> {
  const v = await storedSettings(account, db);
  const values: PanelValues = {};
  for (const key of PARASUT_SETTING_KEYS) {
    if (key === "clientSecret" || typeof v[key] !== "string" || !v[key]) continue;
    values[key] = v[key];
  }
  const secret = typeof v.clientSecret === "string" && v.clientSecret ? open(v.clientSecret, "parasut-settings") : null;
  if (secret) values.clientSecret = secret;
  return { values, secretUnreadable: Boolean(v.clientSecret) && !secret };
}

/** Hesabın faturalarının kapsam seçimi (Paraşüt ekranı; yoksa "branch") */
export async function loadInvoiceScope(account: string, db: Pick<Exec, "select"> = getDb()): Promise<ParasutInvoiceScope> {
  return parseInvoiceScope((await storedSettings(account, db)).invoices);
}

/**
 * Panel ayarlarını yazar (client_secret şifrelenir); boş kalan kayıt silinir. Faturaların kapsam seçimi
 * (`invoices`) verilmezse kayıttaki kalır
 */
export async function writePanelSettings(account: string, values: PanelValues, by: string, db: Exec = getDb(), invoices?: ParasutInvoiceScope) {
  const before = await storedSettings(account, db);
  const value: StoredSettings = {};
  for (const key of PARASUT_SETTING_KEYS) {
    const v = values[key]?.trim();
    if (v) value[key] = key === "clientSecret" ? seal(v, "parasut-settings") : v;
  }
  const scope = invoices ?? parseInvoiceScope(before.invoices);
  if (scope === "shared") value.invoices = "shared";
  const key = settingsKey(account);
  if (!Object.keys(value).length) {
    await db.delete(s.integrationState).where(eq(s.integrationState.key, key));
    return;
  }
  Object.assign(value, { updatedAt: new Date().toISOString(), updatedBy: by });
  await db
    .insert(s.integrationState)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/**
 * Hesabın faturalarının kapsam seçimini yazar; kayıttaki öbür alanlara (şifreli client_secret dahil, açılamasa bile)
 * dokunmaz
 */
export async function writeInvoiceScope(account: string, scope: ParasutInvoiceScope, by: string, db: Exec = getDb()) {
  const value: StoredSettings = { ...(await storedSettings(account, db)), updatedAt: new Date().toISOString(), updatedBy: by };
  if (scope === "shared") value.invoices = "shared";
  else delete value.invoices;
  const key = settingsKey(account);
  await db
    .insert(s.integrationState)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/** Kullanılacak ayarlar: alan alan önce panel, yoksa (yalnız varsayılan hesapta) ortam değişkeni */
export async function loadParasutSettings(account: string, db: Pick<Exec, "select"> = getDb()): Promise<{ resolved: ResolvedSettings; secretUnreadable: boolean }> {
  const { values, secretUnreadable } = await loadPanelSettings(account, db);
  return { resolved: resolveParasutSettings(values, envOf(account)), secretUnreadable };
}

/**
 * Hesaptan gelmiş (ya da hesaba bağlanmış) fatura var mı: varsa firma numarası panelden değiştirilemez, şube başka
 * şubenin hesabına bağlanamaz. Eski kayıtlarda hesap yok sayılmaz: göç (0083) Paraşüt'e bağlı her faturaya varsayılan
 * hesabı yazdı
 */
export async function hasParasutInvoices(account: string, db: Pick<Exec, "select"> = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: s.invoices.id })
    .from(s.invoices)
    .where(and(eq(s.invoices.parasutAccount, account), or(eq(s.invoices.source, "parasut"), isNotNull(s.invoices.externalId), isNotNull(s.invoices.eInvoiceId))))
    .limit(1);
  return Boolean(row);
}

/** Bağlantı kartının ayar görünümü (client_secret'ın değeri yok) */
export async function parasutSettingsView(account: string): Promise<ParasutSettingsView> {
  const [{ resolved, secretUnreadable }, invoices] = await Promise.all([loadParasutSettings(account), hasParasutInvoices(account)]);
  return settingsView(resolved, { secretUnreadable, hasParasutInvoices: invoices });
}

/**
 * Paraşüt'ün yeni kimlik sunucusu (Keycloak, "parasut" alanı). Keşif belgesi {issuer}/.well-known/openid-configuration;
 * alan adının kökünde keşif belgesi yok (404), bu yüzden yol /realms/parasut ile biter.
 */
export const DEFAULT_ISSUER = "https://id.parasut.com/realms/parasut";
/**
 * Varsayılan izinler. offline_access olmadan Keycloak'ın verdiği refresh_token tarayıcı oturumuna bağlıdır ve
 * oturum boşta kalınca (dakikalar, en çok saatler) düşer; sabah eşitlemesi ertesi gün bağlantıyı kaybederdi.
 * offline_access keşif belgesinin scopes_supported listesinde var ve oturumdan bağımsız, her kullanımda uzayan
 * çevrimdışı belirteç verir.
 */
export const DEFAULT_SCOPE = "openid offline_access";
/** DevHub'a kaydedilecek dönüş adresi bu yola kurulur */
export const PARASUT_CALLBACK_PATH = "/panel/parasut/baglan/geri";

export interface ParasutConfig {
  /** Hesap (sahibi şube; src/lib/parasut/accounts.ts): oturum ve eşitleme durumu bu adla saklanır */
  account: string;
  clientId: string;
  clientSecret: string;
  companyId: string;
  /** Veri API'si; varsayılan https://api.parasut.com */
  baseUrl: string;
  /** Kimlik sunucusu; varsayılan https://id.parasut.com/realms/parasut */
  issuer: string;
  /** Keşif belgesine ulaşılamazsa elle verilebilir (normalde null) */
  authorizeUrl: string | null;
  tokenUrl: string | null;
  /** DevHub'daki kayıtla **harfi harfine** aynı olmalı */
  redirectUri: string;
  /** Varsayılan "openid offline_access" */
  scope: string;
  /** Geçerli bir https adresi olmadığı için yok sayılan isteğe bağlı değişkenler (boşsa her şey yolunda) */
  invalid: string[];
  /** İlk eşitlemede bu tarihten (YYYY-MM-DD) itibaren faturalar alınır */
  syncFrom: string | null;
}

/** Hesabın zorunlu üç ayarı (client_id, client_secret, firma numarası) panelde ya da (varsayılanda) ortamda var mı */
export async function isParasutConfigured(account: string): Promise<boolean> {
  const { resolved } = await loadParasutSettings(account);
  return missingSettings(resolved).length === 0;
}

/** Yalnız https adresi kabul edilir; yanlış yazılmışsa değer yok sayılır ve `invalid: true` döner */
function readHttps(name: string): { value: string | null; invalid: boolean } {
  const raw = process.env[name]?.trim();
  if (!raw) return { value: null, invalid: false };
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return { value: null, invalid: true };
    return { value: u.toString().replace(/\/+$/, ""), invalid: false };
  } catch {
    return { value: null, invalid: true };
  }
}

/** DevHub'a kaydedilmesi gereken dönüş adresi (ayarlar eksikken de ekranda gösterilir); yanlış yazılmışsa hata */
export function parasutRedirectUri(): string {
  const r = readHttps("PARASUT_REDIRECT_URI");
  if (r.invalid) throw new Error("PARASUT_REDIRECT_URI geçerli bir https adresi değil");
  return r.value ?? `${appUrl()}${PARASUT_CALLBACK_PATH}`;
}

/**
 * Hesabı bağlamadan ve yeni yöntemle belirteç istemeden önce: yanlış yazılmış adres değişkeni varsa açık hata.
 * `only` verilirse yalnız o değişkenlere bakılır (yenileme için dönüş adresi gerekmez).
 */
export function assertOidcSettings(cfg: Pick<ParasutConfig, "invalid">, only?: readonly string[]) {
  const bad = only ? cfg.invalid.filter((name) => only.includes(name)) : cfg.invalid;
  if (bad.length) {
    throw new Error(`${bad.join(", ")} geçerli bir https adresi değil. Vercel'de düzeltip yeniden deploy edin ya da boş bırakın.`);
  }
}

/**
 * Kullanılacak ayarlardan bağlantı yapılandırması. Yalnız zorunlu üç ayar eksikse hata atar; isteğe bağlı
 * değişkenlerin yanlışı uygulamayı durdurmaz.
 */
export function configFrom(r: ResolvedSettings, account: string = DEFAULT_PARASUT_ACCOUNT): ParasutConfig {
  const missing = missingSettings(r);
  if (missing.length) {
    throw new Error(`Paraşüt bağlantı ayarları eksik: ${missing.map((k) => PARASUT_SETTINGS[k].label).join(", ")}. Paraşüt entegrasyonu › Bağlantı kartından girin.`);
  }
  const invalid: string[] = [];
  const https = (name: string) => {
    const x = readHttps(name);
    if (x.invalid) invalid.push(name);
    return x.value;
  };
  return {
    account,
    clientId: r.clientId.value!,
    clientSecret: r.clientSecret.value!,
    companyId: r.companyId.value!,
    baseUrl: (process.env.PARASUT_BASE_URL?.trim() || "https://api.parasut.com").replace(/\/+$/, ""),
    issuer: https("PARASUT_ISSUER") ?? DEFAULT_ISSUER,
    authorizeUrl: https("PARASUT_AUTHORIZE_URL"),
    tokenUrl: https("PARASUT_TOKEN_URL"),
    redirectUri: https("PARASUT_REDIRECT_URI") ?? `${appUrl()}${PARASUT_CALLBACK_PATH}`,
    scope: process.env.PARASUT_SCOPE?.trim() || DEFAULT_SCOPE,
    syncFrom: r.syncFrom.value,
    invalid,
  };
}

/** Hesabın bağlantı yapılandırması (panel ayarları + varsayılanda ortam); zorunlu ayar eksikse hata */
export async function readParasutConfig(account: string): Promise<ParasutConfig> {
  return configFrom((await loadParasutSettings(account)).resolved, account);
}
