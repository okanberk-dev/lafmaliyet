/**
 * Tarayıcı hatalarını panelin hata kaydına gönderir (docs/HATA-KAYDI.md; uç src/app/api/hata/route.ts). Yakalanmayan
 * hata ve söz (src/instrumentation-client.ts) ile hata ekranına düşen çizim hatası (src/components/panel/error-view.tsx).
 * Yalnız panelde (/panel: oturum açık; uç da oturum ister), sayfa yüklemesi başına en çok 5 kez, aynı ileti bir kez.
 * Bağlantı kopması ("Failed to fetch"), eklenti hataları ve Next'in yönlendirme sinyalleri gönderilmez. Sunucuda
 * oluşup hata ekranına kodla gelen hata (digest) zaten sunucu kancasıyla kayıtlı: yinelenmez.
 *
 * Gönderim hiçbir zaman fırlatmaz (hata dinleyicisinde fırlatılan hata yeniden "error" olayı olur; döngü olmasın).
 * Bu modül tarayıcıda her sayfaya yüklenir: içe aktarması yalnız tür (src/lib/error-log.ts'in düzenli ifadeleri sunucuda).
 */

import type { ClientErrorBody, ClientKind } from "./error-log";

export const CLIENT_ERROR_PATH = "/api/hata";
/** Sayfa yüklemesi başına en çok */
export const MAX_REPORTS_PER_PAGE = 5;

const MAX = { name: 120, message: 1000, stack: 3500, path: 300, digest: 64 } as const;

/** Gönderilmeyen hatalar: bağlantı kopması, eklenti, çapraz köken "Script error.", Next'in akış sinyalleri */
const IGNORED_MESSAGE = /^(Script error\.?|ResizeObserver loop|Failed to fetch|Load failed|NetworkError when attempting|The network connection was lost|The Internet connection appears to be offline|cancell?ed|iptal edildi|The operation was aborted|AbortError|NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/i;
const EXTENSION = /(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//i;

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Hata değerinden gövde (gönderilmeyecekse null) */
export function clientErrorBody(kind: ClientKind, err: unknown, pathname: string): ClientErrorBody | null {
  const o = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const message = text(o ? o.message : typeof err === "string" ? err : err === undefined ? null : String(err), MAX.message);
  if (!message) return null;
  const name = o ? text(o.name, MAX.name) : null;
  const stack = o ? text(o.stack, MAX.stack) : null;
  const digest = o ? text(o.digest, MAX.digest) : null;
  if (IGNORED_MESSAGE.test(message) || name === "AbortError") return null;
  if (EXTENSION.test(stack ?? "") || EXTENSION.test(message)) return null;
  // Sunucuda oluşan hata hata ekranına kodla gelir; sunucu kancası onu zaten yazdı
  if (kind === "boundary" && digest) return null;
  return { kind, name, message, stack, path: pathname.slice(0, MAX.path), digest };
}

/** Sayfa yüklemesinin sayacı: en çok MAX_REPORTS_PER_PAGE, aynı ileti bir kez */
export function shouldSend(state: { keys: Set<string>; count: number }, body: ClientErrorBody): boolean {
  if (state.count >= MAX_REPORTS_PER_PAGE) return false;
  const key = `${body.kind}|${body.name ?? ""}|${body.message.slice(0, 200)}`;
  if (state.keys.has(key)) return false;
  state.keys.add(key);
  state.count += 1;
  return true;
}

const state = { keys: new Set<string>(), count: 0 };

/** Hatayı gönderir (yalnız panelde); beklenmez, fırlatmaz */
export function reportClientError(kind: ClientKind, err: unknown): void {
  try {
    if (typeof window === "undefined" || !window.location.pathname.startsWith("/panel")) return;
    const body = clientErrorBody(kind, err, window.location.pathname);
    if (!body || !shouldSend(state, body)) return;
    void fetch(CLIENT_ERROR_PATH, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      // Sayfa kapanırken de gitsin (gövde 64 KB'ın çok altında)
      keepalive: true,
    }).catch(() => {});
  } catch {
    // gönderim hiçbir zaman hata üretmez
  }
}

/** Yakalanmayan hata ve sözün dinleyicileri (src/instrumentation-client.ts; bir kez) */
export function installClientErrorReporter(): void {
  try {
    if (typeof window === "undefined") return;
    window.addEventListener("error", (ev) => reportClientError("error", ev.error ?? ev.message));
    window.addEventListener("unhandledrejection", (ev) => reportClientError("rejection", ev.reason));
  } catch {
    // eski tarayıcı
  }
}
