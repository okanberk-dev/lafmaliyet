import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";
import { open, seal } from "@/server/secret-box";

import { assertOidcSettings, readParasutConfig, type ParasutConfig } from "./config";
import type { ListResponse, ShowResponse } from "./jsonapi";
import { parasutEndpoints } from "./oidc";

/**
 * Paraşüt API v4 istemcisi (https://apidocs.parasut.com).
 * - Kimlik: OAuth 2.0 Authorization Code + PKCE (id.parasut.com). Yetkilendirme bir kez tarayıcıdan yapılır
 *   (connect.ts), dönen refresh_token integration_state'te şifreli durur ve 30 gün içinde düzenli yenilenir.
 *   Erişim belirteci ~2 saat geçerli. Kayıtlı oturum yoksa istek atılmaz: "Paraşüt hesabını bağla" hatası verilir.
 * - Uç noktalar: {baseUrl}/v4/{company_id}/<kaynak>, JSON:API (include, filter[..], sort, page[number|size]).
 * - Hız sınırı: belgelere göre 10 saniyede 10 istek; istekler arasında en az PACING.minGapMs beklenir, 429'da
 *   Retry-After'a uyulur, 5xx'te geri çekilerek yeniden denenir.
 * - Her yenilemede yeni bir refresh_token döner (döndürmeli); en son gelen hemen veritabanına yazılır.
 */

const TOKEN_KEY = "parasut.token";
/** Yenilemeleri sıraya sokan Postgres danışma kilidi (iki eşitleme aynı refresh_token'ı harcamasın) */
const TOKEN_LOCK = 7_340_211;

type Exec = Pick<ReturnType<typeof getDb>, "select" | "insert" | "delete">;
/**
 * İstekler arası en az bekleme ve 429/5xx'te Retry-After yoksa geri çekilmenin tabanı (2^deneme ile çarpılır). Yalnız
 * sahte Paraşüt'le koşan veritabanı testi (tests/parasut-esitleme-db.test.ts) sıfırlar; canlıda değişmez
 */
export const PACING = { minGapMs: 1050, retryBaseMs: 1000 };
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 15_000;
/** Paraşüt'ün sayfa başına izin verdiği en büyük kayıt sayısı */
export const PAGE_SIZE = 25;

interface StoredToken {
  access: string;
  refresh: string | null;
  /** epoch ms */
  expiresAt: number;
  clientId: string;
  /** Belirteci veren kimlik sunucusu; issuer değişirse (eski altyapıdan kalan) belirteç kullanılmaz */
  issuer: string;
  /** En son alınma/yenilenme anı (epoch ms): refresh_token 30 gün geçerli, panelde yaşı gösterilir */
  refreshedAt: number;
}

export interface ParasutTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  created_at?: number;
}

/** Paraşüt'ün refresh_token'ı için verdiği süre: bu kadar yenilenmezse bağlantı düşer */
export const REFRESH_MAX_DAYS = 30;

export class ParasutError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

/** Belirteç isteği reddi (iptal edilmiş istemci, geçersiz secret): include denemesiyle karıştırılmasın, yeniden denenmez */
export class ParasutAuthError extends ParasutError {}

/**
 * refresh_token artık geçerli değil: kullanıcı Paraşüt'te "DURDUR" dedi, 30 günlük süre doldu ya da client_secret
 * yenilendi. Paraşüt bunu `invalid_grant` ile söyler; kayıtlı belirteç silinir ve yeniden yetkilendirme istenir.
 */
export class ParasutRevokedError extends ParasutAuthError {}

/** Kayıtlı oturum yok ya da iptal edilmiş: yönetici tarayıcıdan yeniden bağlamalı (tek seferlik) */
export class ParasutNotConnectedError extends ParasutAuthError {
  constructor(message = "Paraşüt hesabı bağlı değil. Ayarlar › Paraşüt entegrasyonu ekranından “Paraşüt hesabını bağla”yı kullanın.") {
    super(message, 401);
  }
}

/** Süre dolmak üzereyken yeni istek/yeniden deneme yapılmaz; eşitleme kaldığı yerden sonra sürer */
export class ParasutDeadlineError extends ParasutError {
  constructor() {
    super("Süre doldu; eşitleme kaldığı yerden sürecek.", 0);
  }
}

/** Paraşüt yanıtından Türkçe bir hata cümlesi */
export function parasutErrorText(status: number, body: string): string {
  let detail = "";
  try {
    const j = JSON.parse(body) as { errors?: { title?: string; detail?: string }[]; error_description?: string; error?: string };
    detail = j.errors?.map((e) => e.detail || e.title).filter(Boolean).join("; ") || j.error_description || j.error || "";
  } catch {
    detail = body.slice(0, 200);
  }
  if (status === 401) return `Paraşüt girişi reddedildi (istemci bilgileri hatalı ya da erişim iptal edilmiş). ${detail}`.trim();
  // Yeni altyapıda 403'ün en sık nedeni: bağlantıyı kuran kullanıcıda "Uygulama Entegrasyonları" yetkisi yok
  if (status === 403) return `Bu kullanıcının bu firmaya ya da kaynağa erişim yetkisi yok (Paraşüt'te Ayarlar › Kullanıcılar › Düzenle › Uygulama Entegrasyonları yetkisi açık mı?). ${detail}`.trim();
  if (status === 404) return `Kayıt ya da firma bulunamadı (firma numarası doğru mu?). ${detail}`.trim();
  if (status === 429) return "Paraşüt istek sınırına takıldı; biraz sonra yeniden denenecek.";
  if (status >= 500) return "Paraşüt şu an yanıt vermiyor; biraz sonra yeniden deneyin.";
  return `Paraşüt isteği kabul etmedi (HTTP ${status}). ${detail}`.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Zaman aşımı ve ağ hatalarını Türkçe, hangi isteğin takıldığını söyleyen bir ParasutError'a çevirir */
async function fetchParasut(label: string, url: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ParasutError(`Paraşüt ${REQUEST_TIMEOUT_MS / 1000} saniye içinde yanıt vermedi (${label}). Paraşüt şu an yavaş olabilir; biraz sonra yeniden deneyin.`, 0);
    }
    throw new ParasutError(`Paraşüt'e bağlanılamadı (${label}): ${(e as Error)?.message ?? e}`, 0);
  }
}

/**
 * Belirteç isteği: POST {token_endpoint} (adres keşif belgesinden gelir, oidc.ts). İstemci DevHub'da gizli
 * (confidential) açıldığı için client_secret gövdede gider; yetki kodu değişiminde ayrıca code_verifier ve
 * redirect_uri gönderilir. 400/401 yeniden denenmez; `invalid_grant` ParasutRevokedError olur.
 */
export async function postParasutToken(cfg: ParasutConfig, params: Record<string, string>): Promise<ParasutTokenResponse> {
  // Belirteç ucunu belirleyen değişkenler yanlışsa yanlış adrese gidilmez (dönüş adresi bağlanırken denetlenir)
  assertOidcSettings(cfg, ["PARASUT_ISSUER", "PARASUT_TOKEN_URL"]);
  const { tokenUrl } = await parasutEndpoints(cfg);
  const res = await fetchParasut(params.grant_type === "refresh_token" ? "oturum yenileme" : "yetki kodu", tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
  });
  const body = await res.text();
  if (!res.ok) {
    let code = "";
    try {
      code = String((JSON.parse(body) as { error?: string }).error ?? "");
    } catch {
      code = "";
    }
    const text = parasutErrorText(res.status === 400 ? 401 : res.status, body);
    throw code === "invalid_grant" ? new ParasutRevokedError(text, res.status, body) : new ParasutAuthError(text, res.status, body);
  }
  return JSON.parse(body) as ParasutTokenResponse;
}

/** Belirteci şifreleyip integration_state'e yazar */
async function writeToken(t: StoredToken, db: Exec) {
  const value = { sealed: seal(JSON.stringify(t)) };
  await db
    .insert(s.integrationState)
    .values({ key: TOKEN_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/** Şifreli belirteci okur; yoksa, mühür açılamıyorsa (AUTH_SECRET değişmiş) ya da bozuksa null */
async function readToken(db: Pick<Exec, "select">): Promise<StoredToken | null> {
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, TOKEN_KEY)).limit(1);
  const sealed = (row?.value as { sealed?: string } | undefined)?.sealed;
  const plain = sealed ? open(sealed) : null;
  if (!plain) return null;
  try {
    return JSON.parse(plain) as StoredToken;
  } catch {
    return null;
  }
}

/** Belirteç yanıtını saklanacak biçime çevirir */
function tokenFrom(j: ParasutTokenResponse, owner: Pick<StoredToken, "clientId" | "issuer">): StoredToken {
  const created = j.created_at ? j.created_at * 1000 : Date.now();
  return {
    access: j.access_token,
    refresh: j.refresh_token ?? null,
    expiresAt: created + (j.expires_in ?? 7200) * 1000,
    ...owner,
    refreshedAt: Date.now(),
  };
}

/** Paraşüt'ün verdiği belirteç yanıtını saklanacak biçime çevirir ve yazar */
export async function saveParasutToken(cfg: ParasutConfig, j: ParasutTokenResponse, db: Exec = getDb()): Promise<StoredToken> {
  const t = tokenFrom(j, { clientId: cfg.clientId, issuer: cfg.issuer });
  await writeToken(t, db);
  return t;
}

/** Kayıtlı oturum bu istemciye ve kimlik sunucusuna mı ait (başka bir client_id ile alınmış belirteç kullanılmaz) */
const isSessionOf = (t: StoredToken | null, cfg: Pick<ParasutConfig, "clientId" | "issuer">): t is StoredToken =>
  Boolean(t && t.clientId === cfg.clientId && t.issuer === cfg.issuer);

export interface ParasutConnection {
  /** Kayıtlı ve bu istemciye ait bir refresh_token var mı */
  connected: boolean;
  /** En son yenilenme (ISO); refresh_token'ın yaşı buradan görülür */
  refreshedAt: string | null;
  /** 30 günlük yenileme süresinin sonuna yaklaşıldı mı (eşitleme uzun süre çalışmamış) */
  stale: boolean;
}

/**
 * Panelde gösterilecek bağlantı durumu. Belirteçlerin kendisi hiçbir zaman dışarı verilmez; yalnız "bağlı mı" ve son
 * yenilenme anı döner. Ayarlar eksikse, kayıtlı oturum başka bir client_id'ninse ya da mühür açılamıyorsa (AUTH_SECRET
 * değişmiş) bağlı değil sayılır.
 */
export async function parasutConnection(now = Date.now(), config?: ParasutConfig | null): Promise<ParasutConnection> {
  const none: ParasutConnection = { connected: false, refreshedAt: null, stale: false };
  // `config`: çağıran ayarları zaten okuduysa (null: ayarlar eksik); verilmezse burada okunur
  if (config === null) return none;
  let cfg: ParasutConfig;
  try {
    cfg = config ?? (await readParasutConfig());
  } catch {
    return none;
  }
  const t = await readToken(getDb());
  if (!isSessionOf(t, cfg) || !t.refresh) return none;
  const refreshedAt = t.refreshedAt ? new Date(t.refreshedAt) : null;
  const ageDays = refreshedAt ? (now - refreshedAt.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
  return { connected: true, refreshedAt: refreshedAt?.toISOString() ?? null, stale: ageDays > REFRESH_MAX_DAYS - 7 };
}

export class ParasutClient {
  private lastCall = 0;
  private token: StoredToken | null = null;
  /** epoch ms; bu andan sonra beklenecek bir istek başlatılmaz */
  private deadlineAt = Number.POSITIVE_INFINITY;

  /** Ayarlar çağırandan gelir (`await readParasutConfig()`): panelden girilenler veritabanında */
  constructor(private readonly cfg: ParasutConfig) {}

  setDeadline(at: number) {
    this.deadlineAt = at;
  }

  private ensureTime(waitMs = 0) {
    // İstek en fazla REQUEST_TIMEOUT_MS sürer; bitişi süre sınırını aşacaksa başlatılmaz
    if (Date.now() + waitMs + REQUEST_TIMEOUT_MS > this.deadlineAt) throw new ParasutDeadlineError();
  }

  get companyId() {
    return this.cfg.companyId;
  }

  // ------------------------------------------------------------ belirteç
  private async loadStored(db: Pick<Exec, "select"> = getDb()): Promise<StoredToken | null> {
    const t = await readToken(db);
    // Başka bir istemci ya da kimlik sunucusu için alınmış belirteç kullanılmaz (client_id değişince eski oturum
    // kendiliğinden düşer)
    return isSessionOf(t, this.cfg) ? t : null;
  }

  /**
   * Geçerli erişim belirteci. Kayıtlı belirtecin süresi dolmak üzereyse refresh_token ile yenilenir; kayıtlı oturum
   * yoksa ya da Paraşüt erişimi kaldırdıysa ParasutNotConnectedError atılır.
   */
  private async accessToken(force = false): Promise<string> {
    if (!force) {
      this.token ??= await this.loadStored();
      // Süresine 2 dakikadan az kalan belirteç yenilenir
      if (this.token && this.token.expiresAt - Date.now() > 120_000) return this.token.access;
    }
    const stale = this.token?.access ?? null;
    // Her yenileme yeni bir refresh_token döndürür; kilit altında yeniden okunur, bu arada başka bir çağrı
    // yenilediyse onunki kullanılır. Silme ve hata işlemin **dışında**: içeriden atılan hata yenilemenin yazdığını
    // da geri alırdı, iptal edilen belirteç de silinmiş sayılmazdı.
    const outcome = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${TOKEN_LOCK})`);
      const current = await this.loadStored(tx);
      if (current && current.access !== stale && current.expiresAt - Date.now() > 120_000) {
        this.token = current;
        return { kind: "ok" as const, access: current.access };
      }
      const refresh = current?.refresh ?? this.token?.refresh ?? null;
      if (!refresh) return { kind: "none" as const };
      try {
        const t = await saveParasutToken(this.cfg, await postParasutToken(this.cfg, { grant_type: "refresh_token", refresh_token: refresh }), tx);
        this.token = t;
        return { kind: "ok" as const, access: t.access };
      } catch (e) {
        // Paraşüt yenilemeyi kalıcı olarak reddetti (izin kaldırıldı, 30 gün doldu, secret yenilendi): kayıtlı
        // oturum işe yaramaz. Geçici ağ/5xx hatasında belirteç korunur, hata yukarı çıkar.
        if (e instanceof ParasutRevokedError) return { kind: "revoked" as const };
        throw e;
      }
    });
    if (outcome.kind === "ok") return outcome.access;
    if (outcome.kind === "none") throw new ParasutNotConnectedError();
    await forgetParasutToken();
    this.token = null;
    throw new ParasutNotConnectedError(
      "Paraşüt erişimi sona ermiş (izin kaldırılmış, client_secret yenilenmiş ya da 30 günlük yenileme süresi dolmuş). Ayarlar › Paraşüt entegrasyonu ekranından yeniden bağlayın.",
    );
  }

  // ------------------------------------------------------------ istek
  private async throttle() {
    const wait = this.lastCall + PACING.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
  }

  /**
   * GET {base}/v4/{company}/{path}?query. Oturum düşmüşse bir kez yenilenir, 429/5xx'te geri çekilerek yeniden
   * denenir. 204 (ör. PDF hazırlanıyor) ve `nullOn` durumlarında null döner.
   */
  private async send(
    path: string,
    query: Record<string, string | number | undefined>,
    { root = false, accept = "application/json", nullOn = [] }: { root?: boolean; accept?: string; nullOn?: number[] } = {},
  ): Promise<Response | null> {
    const prefix = root ? `${this.cfg.baseUrl}/v4/` : `${this.cfg.baseUrl}/v4/${encodeURIComponent(this.cfg.companyId)}/`;
    const url = new URL(`${prefix}${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      this.ensureTime();
      await this.throttle();
      const token = await this.accessToken();
      const res = await fetchParasut(path.split("/")[0] || path, url, {
        headers: { Authorization: `Bearer ${token}`, Accept: accept },
      });
      if (res.status === 204 || nullOn.includes(res.status)) return null;
      if (res.ok) return res;
      const body = await res.text();
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : PACING.retryBaseMs * 2 ** attempt;
        this.ensureTime(wait);
        await sleep(wait);
        continue;
      }
      throw new ParasutError(parasutErrorText(res.status, body), res.status, body);
    }
  }

  /** GET {base}/v4/{company}/{path}?query — JSON:API yanıtı. `root: true` firmasız uç noktalar için (/v4/me) */
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}, { root = false }: { root?: boolean } = {}): Promise<T> {
    // 204: içerik yok (ör. PDF henüz hazırlanıyor); çağıran null'ı ele alır
    const res = await this.send(path, query, { root });
    return (res ? await res.json() : null) as T;
  }

  /**
   * JSON olmayan uçlar (ör. `e_invoices/{id}/signed_ubl` ZIP verir). Kayıt yoksa (404) ya da içerik hazır değilse
   * (204) null; `maxBytes`tan büyük dosya reddedilir.
   */
  async getBytes(path: string, maxBytes = 15 * 1024 * 1024): Promise<{ bytes: Buffer; contentType: string } | null> {
    const res = await this.send(path, {}, { accept: "*/*", nullOn: [404] });
    if (!res) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    // 413: belgeye özgü kalıcı hata (yeniden denenmez; geçici sayılsaydı okuma sırasını tıkardı)
    if (declared > maxBytes) throw new ParasutError(`Paraşüt'ün verdiği dosya çok büyük (${Math.round(declared / 1048576)} MB).`, 413);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      const name = (e as Error)?.name;
      throw new ParasutError(name === "TimeoutError" || name === "AbortError" ? `Paraşüt dosyayı ${REQUEST_TIMEOUT_MS / 1000} saniyede göndermedi (${path.split("/")[0]}).` : "Paraşüt dosyası okunamadı.", 0);
    }
    if (bytes.length > maxBytes) throw new ParasutError("Paraşüt'ün verdiği dosya çok büyük.", 413);
    return { bytes, contentType: res.headers.get("content-type") ?? "" };
  }

  /**
   * Sayfalı liste. `stop` bir sayfadaki kayıtlara bakıp daha eski sayfalara gerek olmadığını söyleyebilir
   * (ör. tarihe göre azalan sıralamada pencerenin başına gelince).
   */
  async *pages<A>(path: string, query: Record<string, string | number | undefined>, maxPages = 200, startPage = 1) {
    for (let page = startPage; page < startPage + maxPages; page++) {
      const res = await this.get<ListResponse<A>>(path, { ...query, "page[number]": page, "page[size]": PAGE_SIZE });
      yield Object.assign(res, { page });
      const total = res.meta?.total_pages;
      if (!res.data.length || (total !== undefined && page >= total)) return;
    }
  }

  async show<A>(path: string, query: Record<string, string | number | undefined> = {}) {
    return this.get<ShowResponse<A>>(path, query);
  }

  /**
   * Bağlantı denemesi: eşitlemeyle aynı yoldan (kayıtlı oturum varsa yeniden giriş yapmadan) firmayı ve bir faturayı
   * okur. Hata olursa hangi adımda takıldığı söylenir.
   */
  async ping(): Promise<{ total: number | null; company: string | null; ms: number }> {
    const t0 = Date.now();
    const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ParasutError) {
          e.message = `${e.message}`.includes(label) ? e.message : `${label}: ${e.message}`;
          throw e;
        }
        throw e;
      }
    };
    await step("Giriş", () => this.accessToken());
    let company: string | null = null;
    let companies: { id: string; name: string }[] = [];
    try {
      const me = await this.get<ShowResponse>("me", { include: "companies" }, { root: true });
      companies = (me.included ?? [])
        .filter((r) => r.type === "companies")
        .map((r) => ({ id: r.id, name: String((r.attributes as { name?: string }).name ?? r.id) }));
      company = companies.find((c) => c.id === this.cfg.companyId)?.name ?? null;
    } catch {
      // /me okunamazsa yalnızca fatura isteğiyle devam
    }
    try {
      // Eşitlemenin ilk isteğiyle aynı sıralama: Paraşüt sırasız listede çok yavaş yanıt verebiliyor
      const res = await step("Fatura listesi", () => this.get<ListResponse>("purchase_bills", { sort: "-issue_date", "page[size]": 1, "page[number]": 1 }));
      return { total: res.meta?.total_count ?? null, company, ms: Date.now() - t0 };
    } catch (e) {
      if (e instanceof ParasutError && (e.status === 404 || e.status === 403) && companies.length) {
        throw new ParasutError(`${e.message} Bu kullanıcının eriştiği firmalar: ${companies.map((c) => `${c.name} (${c.id})`).join(", ")}`, e.status, e.body);
      }
      throw e;
    }
  }
}

/** Kayıtlı belirteci siler (istemci ayarları değişince ya da bağlantı kesilince) */
export async function forgetParasutToken(db: Pick<Exec, "delete"> = getDb()) {
  await db.delete(s.integrationState).where(eq(s.integrationState.key, TOKEN_KEY));
}

