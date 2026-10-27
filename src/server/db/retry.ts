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
//   baştan alınmadan yeniden denenemez. İşlemin kendisi ise BEGIN bağlantı hatasıyla düştüyse ve gövdesi hiç
//   çalışmadıysa bir kez yeniden başlatılır: BEGIN tek başına hiçbir şey yazmaz, gövdenin hiçbir sorgusu gönderilmedi.
// - Neon'un "Authentication timed out" hatası (08P01; uyuyan bilgisayar kimlik doğrulama süresinde uyanmadı) bağlantı
//   hatasıdır ve bağlantı hiç kurulmadığı için gönderilmemiş sayılır: yazım da yeniden denenir. Canlıda 24 Ekim 2026'da
//   Bugün'ün ilk sorgusunda görüldü (denetim E-50). Çıplak 08P01 eklenmez: genel protokol hatası kodudur, kurulmuş bir
//   bağlantıda da gelir; yalnız bu mesajla birlikte sayılır.
// "server-only" yok: komut satırı betikleri (migrate, yedek) ve testler de kullanır. Testler: tests/veritabani-baglanti.test.ts.

/** postgres.js'in bağlantı hataları ve soket hataları (hata nesnesinin `code` alanı) */
const CONNECTION_CODES = new Set(["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
/** Neon'un kimlik doğrulama zaman aşımı için verilen kod (sunucunun kodu 08P01 + mesajı; bkz. isAuthTimeout) */
export const AUTH_TIMEOUT = "AUTH_TIMEOUT";
/** Bağlantı hiç kurulmadı: sorgu sunucuya gönderilmedi, yazım da yeniden denenebilir */
const NOT_SENT_CODES = new Set(["CONNECT_TIMEOUT", AUTH_TIMEOUT]);

/** Neon'un "Authentication timed out" hatası: kod 08P01 ve bu mesaj (yalnız kod yetmez) */
function isAuthTimeout(err: { code?: unknown; message?: unknown }): boolean {
  return err.code === "08P01" && typeof err.message === "string" && /authentication timed out/i.test(err.message);
}

/** Hata bir bağlantı hatasıysa kodu (drizzle'ın sardığı hatada `cause`'a da bakılır), değilse null */
export function connectionErrorCode(e: unknown): string | null {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 3; cur = (cur as { cause?: unknown }).cause, depth++) {
    const err = cur as { code?: unknown; message?: unknown };
    if (typeof err.code === "string" && CONNECTION_CODES.has(err.code)) return err.code;
    if (isAuthTimeout(err)) return AUTH_TIMEOUT;
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
  /** postgres.js'in işlemi: begin([seçenekler], gövde); drizzle'ın transaction()'ı bununla açar */
  begin?(...args: never[]): unknown;
}

export interface RetryOptions {
  /** İkinci denemeden önce bekleme (ms) */
  delayMs?: number;
  /** Yeniden denenen her sorgu ve işlem için (günlüğe bir satır; işlemde sorgu "begin") */
  onRetry?: (code: string, query: string) => void;
}

/**
 * İstemcinin unsafe()'ini (drizzle bütün sorguları bununla gönderir: postgres-js/session.js) bağlantı hatasında bir
 * kez yeniden deneyen hâliyle değiştirir; begin()'i gövdesi çalışmadan bağlantı hatasıyla düşen işlemi bir kez yeniden
 * başlatan hâliyle sarar; öteki her şey (reserve, end, options) istemcinin kendisidir. Dönen nesne unsafe()'in yanıtı
 * gibi tembeldir: beklenince gönderilir, values() satır biçimini seçer.
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
  /**
   * İşlem: BEGIN bağlantı hatasıyla düşer ve gövde hiç çağrılmadıysa (bağlantı kurulamadı ya da BEGIN ölü sokete
   * yazıldı) bir kez daha açılır. Gövde çağrıldıysa hata olduğu gibi gider: gövdenin yazımı sunucuya ulaşmış ya da
   * COMMIT gönderilmiş olabilir.
   */
  async function begin(...args: unknown[]) {
    const call = (client.begin as (...a: unknown[]) => Promise<unknown>).bind(client);
    const fn = args[args.length - 1];
    if (typeof fn !== "function") return call(...args);
    const head = args.slice(0, -1);
    let entered = false;
    const body = (...a: unknown[]) => {
      entered = true;
      return fn(...a);
    };
    try {
      return await call(...head, body);
    } catch (e) {
      const code = connectionErrorCode(e);
      if (entered || code === null) throw e;
      opts.onRetry?.(code, "begin");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return await call(...head, fn);
    }
  }
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "unsafe") return unsafe;
      if (prop === "begin" && typeof target.begin === "function") return begin;
      return Reflect.get(target, prop, receiver);
    },
  });
}
