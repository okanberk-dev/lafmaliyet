// Uyuyan bağlantının ilk sorgusu. Vercel işlevi istekler arasında askıya alınır; o sırada Neon'un havuzu (PgBouncer)
// boşta kalan soketi kapatır, postgres.js bunu bilemez (zamanlayıcılar da askıda işlemez). Uyanınca ilk sorgu ölü
// sokete yazar ve "write CONNECTION_CLOSED" / ETIMEDOUT / ECONNRESET ile düşer; Neon'un uyuyan bilgisayarı geç
// uyanırsa bağlantı hiç kurulamaz (CONNECT_TIMEOUT). Canlıda 20 ve 22 Ekim 2026'da görüldü: sayfa "Bir şeyler ters
// gitti" dedi, sitenin pingi kayboldu. postgres.js bir sonraki sorguda yeni bağlantı açar; burada bu hatalarda sorgu bir
// kez daha gönderilir:
// - Okuma (SELECT, ya da yazan bir söz geçmeyen WITH … SELECT) her bağlantı hatasında: iki kez okumak zararsızdır.
// - Yazım yalnız bağlantı hiç kurulamadıysa (CONNECT_TIMEOUT: sorgu gönderilmedi). Soket yolda koptuysa yazım sunucuya
//   ulaşmış olabilir; ikinci kez yazılmaz, hata çağırana gider (ping işi kendisi yeniden dener, src/lib/ping-work.ts).
// - İşlem (transaction) içindeki sorgular sarılmaz: işlemin bağlantısı postgres.js'in kendisidir, yarıda kalan işlem
//   baştan alınmadan yeniden denenemez.
// "server-only" yok: komut satırı betikleri (migrate, yedek) ve testler de kullanır. Testler: tests/veritabani-baglanti.test.ts.

/** postgres.js'in bağlantı hataları ve soket hataları (hata nesnesinin `code` alanı) */
const CONNECTION_CODES = new Set(["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
/** Bağlantı hiç kurulmadı: sorgu sunucuya gönderilmedi, yazım da yeniden denenebilir */
const NOT_SENT_CODES = new Set(["CONNECT_TIMEOUT"]);

/** Hata bir bağlantı hatasıysa kodu (drizzle'ın sardığı hatada `cause`'a da bakılır), değilse null */
export function connectionErrorCode(e: unknown): string | null {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 3; cur = (cur as { cause?: unknown }).cause, depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && CONNECTION_CODES.has(code)) return code;
  }
  return null;
}

/**
 * Yalnız okuyan sorgu: SELECT ya da WITH ile başlar ve içinde yazan, kilitleyen ya da sayaç ilerleten bir söz yok
 * (drizzle'ın ürettiği okumalar böyledir). Emin olunamayan her şey yazım sayılır: yeniden denenmez.
 */
export function isReadOnlyStatement(query: string): boolean {
  const text = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
    .toLowerCase();
  if (!/^\(*\s*(select|with)\b/.test(text)) return false;
  return !/\b(insert|update|delete|merge|truncate|into|nextval|setval|set_config|pg_advisory\w*|share|copy|call|do)\b/.test(text);
}

/** Bu hatada bu sorgu bir kez daha gönderilir mi */
export function shouldRetry(query: string, e: unknown): boolean {
  const code = connectionErrorCode(e);
  return code !== null && (NOT_SENT_CODES.has(code) || isReadOnlyStatement(query));
}

/** postgres.js'in unsafe() yanıtı: beklenebilir, values() ile satırlar dizi dizisi olur (drizzle ikisini de kullanır) */
interface PendingLike extends PromiseLike<unknown> {
  values(): PromiseLike<unknown>;
}

export interface RetryClient {
  unsafe(query: string, params?: unknown[], options?: unknown): PendingLike;
}

export interface RetryOptions {
  /** İkinci denemeden önce bekleme (ms) */
  delayMs?: number;
  /** Yeniden denenen her sorgu için (günlüğe bir satır) */
  onRetry?: (code: string, query: string) => void;
}

/**
 * İstemcinin unsafe()'ini (drizzle bütün sorguları bununla gönderir: postgres-js/session.js) bağlantı hatasında bir
 * kez yeniden deneyen hâliyle değiştirir; öteki her şey (begin, reserve, end, options) istemcinin kendisidir. Dönen
 * nesne unsafe()'in yanıtı gibi tembeldir: beklenince gönderilir, values() satır biçimini seçer.
 */
export function withConnectionRetry<C extends RetryClient>(client: C, opts: RetryOptions = {}): C {
  const delayMs = opts.delayMs ?? 150;
  function unsafe(query: string, params?: unknown[], options?: unknown) {
    let asValues = false;
    let started: Promise<unknown> | null = null;
    const once = () => {
      const q = client.unsafe(query, params, options);
      return asValues ? q.values() : q;
    };
    const run = () =>
      (started ??= (async () => {
        try {
          return await once();
        } catch (e) {
          if (!shouldRetry(query, e)) throw e;
          opts.onRetry?.(connectionErrorCode(e)!, query);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return await once();
        }
      })());
    const pending = {
      values() {
        asValues = true;
        return pending;
      },
      then<A = unknown, B = never>(onFulfilled?: ((v: unknown) => A | PromiseLike<A>) | null, onRejected?: ((e: unknown) => B | PromiseLike<B>) | null) {
        return run().then(onFulfilled, onRejected);
      },
      catch<B = never>(onRejected?: ((e: unknown) => B | PromiseLike<B>) | null) {
        return run().catch(onRejected);
      },
      finally(onFinally?: (() => void) | null) {
        return run().finally(onFinally);
      },
    };
    return pending;
  }
  return new Proxy(client, {
    get(target, prop, receiver) {
      return prop === "unsafe" ? unsafe : Reflect.get(target, prop, receiver);
    },
  });
}
