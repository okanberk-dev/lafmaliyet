import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

import { readParasutConfig, type ParasutConfig } from "./config";
import type { ListResponse, ShowResponse } from "./jsonapi";
import { open, seal } from "@/server/secret-box";

/**
 * Paraşüt API v4 istemcisi (https://apidocs.parasut.com).
 * - Kimlik: OAuth2 "password" akışı (client_id + client_secret + kullanıcı e-postası/parolası), belirteç
 *   yaklaşık 2 saat geçerli; "refresh_token" ile yenilenir. Belirteçler integration_state'te şifreli durur.
 * - Uç noktalar: {baseUrl}/v4/{company_id}/<kaynak>, JSON:API (include, filter[..], sort, page[number|size]).
 * - Hız sınırı: belgelere göre 10 saniyede 10 istek; istekler arasında en az MIN_GAP_MS beklenir, 429'da
 *   Retry-After'a uyulur, 5xx'te geri çekilerek yeniden denenir.
 * - Her yenilemede yeni bir refresh_token döner (döndürmeli); en son gelen hemen veritabanına yazılır.
 */

const TOKEN_KEY = "parasut.token";
/** Yenilemeleri sıraya sokan Postgres danışma kilidi (iki eşitleme aynı refresh_token'ı harcamasın) */
const TOKEN_LOCK = 7_340_211;

type Exec = Pick<ReturnType<typeof getDb>, "select" | "insert">;
const MIN_GAP_MS = 1050;
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
  username: string;
}

export class ParasutError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

/** /oauth/token reddi (yanlış parola, iptal edilmiş istemci): include denemesiyle karıştırılmasın, yeniden denenmez */
export class ParasutAuthError extends ParasutError {}

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
  if (status === 401) return `Paraşüt girişi reddedildi (kullanıcı, parola ya da istemci bilgileri hatalı). ${detail}`.trim();
  if (status === 403) return `Bu kullanıcının bu firmaya ya da kaynağa erişim yetkisi yok. ${detail}`.trim();
  if (status === 404) return `Kayıt ya da firma bulunamadı (PARASUT_COMPANY_ID doğru mu?). ${detail}`.trim();
  if (status === 429) return "Paraşüt istek sınırına takıldı; biraz sonra yeniden denenecek.";
  if (status >= 500) return "Paraşüt şu an yanıt vermiyor; biraz sonra yeniden deneyin.";
  return `Paraşüt isteği kabul etmedi (HTTP ${status}). ${detail}`.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ParasutClient {
  private lastCall = 0;
  private token: StoredToken | null = null;
  /** epoch ms; bu andan sonra beklenecek bir istek başlatılmaz */
  private deadlineAt = Number.POSITIVE_INFINITY;

  constructor(private readonly cfg: ParasutConfig = readParasutConfig()) {}

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
  private async loadStored(db: Exec = getDb()): Promise<StoredToken | null> {
    const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, TOKEN_KEY)).limit(1);
    const sealed = (row?.value as { sealed?: string } | undefined)?.sealed;
    if (!sealed) return null;
    const plain = open(sealed);
    if (!plain) return null;
    try {
      const t = JSON.parse(plain) as StoredToken;
      // Başka bir hesap/istemci için alınmış belirteç kullanılmaz
      if (t.clientId !== this.cfg.clientId || t.username !== this.cfg.username) return null;
      return t;
    } catch {
      return null;
    }
  }

  private async store(t: StoredToken, db: Exec = getDb()) {
    const value = { sealed: seal(JSON.stringify(t)) };
    await db
      .insert(s.integrationState)
      .values({ key: TOKEN_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
  }

  private async requestToken(params: Record<string, string>, db: Exec = getDb()): Promise<StoredToken> {
    const res = await fetch(`${this.cfg.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, redirect_uri: "urn:ietf:wg:oauth:2.0:oob", ...params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.text();
    if (!res.ok) throw new ParasutAuthError(parasutErrorText(res.status === 400 ? 401 : res.status, body), res.status, body);
    const j = JSON.parse(body) as { access_token: string; refresh_token?: string; expires_in?: number; created_at?: number };
    const created = j.created_at ? j.created_at * 1000 : Date.now();
    const t: StoredToken = {
      access: j.access_token,
      refresh: j.refresh_token ?? null,
      expiresAt: created + (j.expires_in ?? 7200) * 1000,
      clientId: this.cfg.clientId,
      username: this.cfg.username,
    };
    await this.store(t, db);
    return t;
  }

  private async accessToken(force = false): Promise<string> {
    if (!force) {
      this.token ??= await this.loadStored();
      // Süresine 2 dakikadan az kalan belirteç yenilenir
      if (this.token && this.token.expiresAt - Date.now() > 120_000) return this.token.access;
    }
    const stale = this.token?.access ?? null;
    // Her yenileme yeni bir refresh_token döndürür; kilit altında yeniden okunur, bu arada başka bir çağrı
    // yenilediyse onunki kullanılır
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${TOKEN_LOCK})`);
      const current = await this.loadStored(tx);
      if (current && current.access !== stale && current.expiresAt - Date.now() > 120_000) {
        this.token = current;
        return current.access;
      }
      const refresh = current?.refresh ?? this.token?.refresh;
      if (refresh) {
        try {
          this.token = await this.requestToken({ grant_type: "refresh_token", refresh_token: refresh }, tx);
          return this.token.access;
        } catch (e) {
          // yenileme reddedildiyse (invalid_grant) parolayla yeniden giriş; ağ hatasında tekrar deneme yapılmaz
          if (!(e instanceof ParasutAuthError)) throw e;
        }
      }
      this.token = await this.requestToken({ grant_type: "password", username: this.cfg.username, password: this.cfg.password }, tx);
      return this.token.access;
    });
  }

  // ------------------------------------------------------------ istek
  private async throttle() {
    const wait = this.lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
  }

  /** GET {base}/v4/{company}/{path}?query — JSON:API yanıtı. `root: true` firmasız uç noktalar için (/v4/me) */
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}, { root = false }: { root?: boolean } = {}): Promise<T> {
    const prefix = root ? `${this.cfg.baseUrl}/v4/` : `${this.cfg.baseUrl}/v4/${encodeURIComponent(this.cfg.companyId)}/`;
    const url = new URL(`${prefix}${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      this.ensureTime();
      await this.throttle();
      const token = await this.accessToken();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as T;
      const body = await res.text();
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        this.ensureTime(wait);
        await sleep(wait);
        continue;
      }
      throw new ParasutError(parasutErrorText(res.status, body), res.status, body);
    }
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
   * Bağlantı testi: belirteç alınır, kullanıcının eriştiği firmalar (/v4/me) okunur ve tanımlı firmanın bir sayfa
   * gider faturası istenir. Firma numarası yanlışsa erişilebilen firmalar hata mesajında listelenir.
   */
  async ping(): Promise<{ total: number | null; company: string | null }> {
    await this.accessToken(true);
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
      const res = await this.get<ListResponse>("purchase_bills", { "page[size]": 1, "page[number]": 1 });
      return { total: res.meta?.total_count ?? null, company };
    } catch (e) {
      if (e instanceof ParasutError && (e.status === 404 || e.status === 403) && companies.length) {
        throw new ParasutError(`${e.message} Bu kullanıcının eriştiği firmalar: ${companies.map((c) => `${c.name} (${c.id})`).join(", ")}`, e.status, e.body);
      }
      throw e;
    }
  }
}

/** Kayıtlı belirteci siler (ayarlar değişince ya da bağlantı kesilince) */
export async function forgetParasutToken() {
  await getDb().delete(s.integrationState).where(eq(s.integrationState.key, TOKEN_KEY));
}
