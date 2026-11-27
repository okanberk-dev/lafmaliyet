/**
 * Hata kaydının saf kuralları (docs/HATA-KAYDI.md; tests/hata-kaydi.test.ts sınar). Sunucu hataları, sunucu eylemlerinin
 * beklenmeyen hataları, tarayıcı hataları ve CSP ihlal raporları veritabanında kısa ömürlü bir tabloya (`error_log`)
 * yazılır; burada yazılacak satırın temizlenmesi (kişisel veri ve anahtar yok, metinler kısaltılır), aynı hatanın
 * özeti (gruplama), sınırlar, sunucu örneği başına yazma kapısı ve ekrandaki metinler var. Veritabanı ve `node:crypto`
 * yok: tarayıcı bileşenleri de içe aktarabilir (tests/csp.test.ts). Yazan: src/server/errors/store.ts.
 */

export type ErrorSource = "server" | "action" | "client" | "csp";
export type ErrorLevel = "error" | "warning";

export const ERROR_SOURCES: readonly ErrorSource[] = ["server", "action", "client", "csp"];

/** Ekrandaki ve e-postadaki adları */
export const SOURCE_LABELS: Record<ErrorSource, string> = {
  server: "Sunucu",
  action: "İşlem",
  client: "Tarayıcı",
  csp: "CSP",
};

/** Kayda girecek hata (temizlenmemiş) */
export interface ErrorEntry {
  source: ErrorSource;
  level?: ErrorLevel;
  /** Hatanın adı (TypeError…) ya da CSP yönergesi */
  name?: string | null;
  message: string;
  /** Sayfanın ya da yolun adresi; sorgu dizgesi atılır */
  path?: string | null;
  /** Gruplamada adresin yerine geçen yol kalıbı (Next'in `routePath`: /panel/faturalar/[id]); saklanmaz */
  route?: string | null;
  /** Bağlam (sayfa / API yolu / eylem, tarayıcı, CSP kaynağı) */
  detail?: string | null;
  digest?: string | null;
  stack?: string | null;
}

/** Temizlenmiş, yazılmaya hazır hata */
export interface CleanEntry {
  source: ErrorSource;
  level: ErrorLevel;
  name: string | null;
  message: string;
  path: string | null;
  route: string | null;
  detail: string | null;
  digest: string | null;
  stack: string | null;
}

// ---------------------------------------------------------------- Sınırlar

export const LIMITS = {
  message: 500,
  name: 80,
  path: 200,
  detail: 200,
  digest: 64,
  stackLines: 12,
  stackLine: 200,
  stack: 1500,
} as const;

/** Kaynak başına günde (İstanbul) en çok bu kadar YENİ satır; aşılınca tek bir "sınır doldu" satırı sayılır */
export const DAILY_NEW_CAP: Record<ErrorSource, number> = { server: 50, action: 50, client: 30, csp: 30 };
/** Bu kadar gündür görülmeyen satır sabah işinde silinir */
export const RETENTION_DAYS = 30;
/** Tablo en çok bu kadar satır tutar (fazlası en eski son görülüşten silinir) */
export const MAX_ROWS = 2000;
/** Yazma en çok bu kadar beklenir (istek beklemez; işlevin açık kalma süresi) */
export const WRITE_TIMEOUT_MS = 3_000;
/** Tarayıcının gönderdiği gövde en çok (bayt) */
export const CLIENT_BODY_MAX = 8 * 1024;
/** Ekranda listelenen satır */
export const LIST_LIMIT = 50;

/** "Sınır doldu" satırının özeti: kaynak ve gün başına bir tane */
export const overflowFingerprint = (source: ErrorSource, day: string) => `sinir:${source}:${day}`;
export const isOverflowFingerprint = (fp: string) => fp.startsWith("sinir:");

const TR_OFFSET_MS = 3 * 3600_000;
/** İstanbul'a göre gün (YYYY-MM-DD; UTC+3, yaz saati yok) */
export const trDay = (at: Date) => new Date(at.getTime() + TR_OFFSET_MS).toISOString().slice(0, 10);
/** İstanbul'da günün başı */
export const trDayStart = (at: Date) => new Date(Date.parse(`${trDay(at)}T00:00:00Z`) - TR_OFFSET_MS);

// ---------------------------------------------------------------- Temizleme

const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/** Adresin yolu: köken, sorgu dizgesi ve parça atılır; anahtar gibi görünen kesim `:anahtar` olur */
export function cleanPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let v = raw.trim();
  try {
    if (/^[a-z][\w+.-]*:\/\//i.test(v)) v = new URL(v).pathname;
  } catch {
    // olduğu gibi
  }
  v = v.replace(/[?#][\s\S]*$/, "");
  const parts = v.split("/").map((seg) => (looksSecret(seg) ? ":anahtar" : seg));
  return cut(parts.join("/") || "/", LIMITS.path);
}

/** Yol kesimi bir anahtar mı (davet / sıfırlama bağlantısı, uzun rastgele dizgi, UUID) */
function looksSecret(seg: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  return seg.length >= 20 && /^[A-Za-z0-9_~.%-]+$/.test(seg) && /[A-Za-z]/.test(seg) && /\d/.test(seg);
}

/** Gruplamada yol: sayısal kesimler `:n` (aynı hatanın /faturalar/12 ve /faturalar/13'te tek satır olması) */
const groupPath = (p: string | null) => (p ? p.replace(/\/\d+(?=\/|$)/g, "/:n") : "");

const SECRET_KEYS = "password|passwd|parola|şifre|sifre|secret|token|api[_-]?key|apikey|authorization|cookie|session|signature|imza|otp";

/**
 * Metindeki kişisel veri ve anahtarlar: veritabanı hatasının parametreleri (drizzle'ın "params:" satırı: kayda giden
 * ad, tutar, e-posta), bağlantı adresindeki parola, Bearer / JWT / API anahtarı, `parola=…` gibi çiftler, adreslerin
 * sorgu dizgesi, e-posta, IBAN, telefon / kimlik / kart gibi uzun sayılar.
 */
export function redactText(raw: string): string {
  let v = raw;
  // Drizzle: "Failed query: <sql>\nparams: a,b,c" (sorgu parametreli, değerler yalnız params'ta)
  v = v.replace(/(^|\n)\s*params:[^\n]*(\n|$)/gi, "$1params: [gizli]$2");
  v = v.replace(/\b(postgres(?:ql)?|mysql|redis|rediss|mongodb(?:\+srv)?|amqp):\/\/[^\s@/]+@/gi, "$1://[gizli]@");
  // Adresler: köken + yol (sorgu ve parça atılır); anahtar çiftlerinden önce, adres bütün kalsın
  v = v.replace(/\bhttps?:\/\/[^\s"'<>()]+/gi, (url) => {
    try {
      const u = new URL(url);
      return `${u.origin}${cleanPath(u.pathname) ?? ""}`;
    } catch {
      return url.replace(/[?#].*$/, "");
    }
  });
  // Şemasız yol + sorgu dizgesi: /panel/x?t=… → /panel/x
  v = v.replace(/(\/[\w\-./%~]*)\?[^\s"'<>)]*/g, "$1");
  v = v.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [gizli]");
  v = v.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.?[A-Za-z0-9_-]*/g, "[anahtar]");
  v = v.replace(/\b(?:sk|pk|rk|re|whsec|vercel_blob_rw)[-_][A-Za-z0-9_-]{10,}/g, "[anahtar]");
  v = v.replace(new RegExp(`\\b(${SECRET_KEYS})(["']?\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s,;&)]+)`, "gi"), "$1$2[gizli]");
  v = v.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-posta]");
  v = v.replace(/\bTR\d{2}(?:\s?[0-9]{2,4}){5,7}\b/gi, "[IBAN]");
  // Geriye bakış yok: eski Safari'de (iOS < 16.4) düzenli ifade modülü hiç yükletmezdi
  v = v.replace(/(^|[^\w.])\+?\d(?:[ -]?\d){9,}(?![\w.])/g, "$1[sayı]");
  // Harf ve rakam karışık uzun rastgele dizgi (anahtar, belirteç)
  v = v.replace(/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b/g, "[anahtar]");
  return v;
}

/** Tek satırlık kısa metin: temizlenir, boşluklar sadeleşir, kısaltılır */
function cleanLine(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = redactText(raw).replace(/\s+/g, " ").trim();
  return v ? cut(v, max) : null;
}

/** İleti: temizlenir, satır sonları korunur (en çok 500 karakter) */
function cleanMessage(raw: unknown): string {
  const v = typeof raw === "string" ? redactText(raw).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
  return v ? cut(v, LIMITS.message) : "(iletisiz hata)";
}

/** Yığın satırı mı (V8: "    at f (file:1:2)"; Safari / Firefox: "f@https://…:1:2") */
const FRAME = /^\s*at\s|@\S*:\d+:\d+\s*$|^\s*\S*@\S+$/;

/**
 * Yığının ilk satırları: yalnız çerçeve satırları (ileti yinelenmez), sunucudaki mutlak yollar `src/`, `.next/`,
 * `node_modules/`'tan başlar, tarayıcıdaki adresler yola iner (sorgu dizgesi yok), her satır kısaltılır.
 */
export function cleanStack(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const lines = raw
    .split("\n")
    .filter((l) => FRAME.test(l))
    .slice(0, LIMITS.stackLines)
    .map((l) => {
      let v = l.trim();
      v = v.replace(/webpack-internal:\/\/\/(?:\([^)]*\)\/)?\.?\/?/g, "");
      v = v.replace(/(^|[\s(])(?:file:\/\/)?(?:\/[^\s/():]+)*?\/((?:\.next|node_modules|src)\/)/g, "$1$2");
      v = v.replace(/\bhttps?:\/\/[^/\s)]+(\/[^\s?#)]*)(?:[?#][^\s:)]*)?/g, "$1");
      return cut(redactText(v), LIMITS.stackLine);
    });
  if (!lines.length) return null;
  return cut(lines.join("\n"), LIMITS.stack);
}

/** Hatayı yazılmaya hazırlar: her alan temizlenir ve kısaltılır */
export function sanitizeEntry(e: ErrorEntry): CleanEntry {
  return {
    source: e.source,
    level: e.level ?? (e.source === "csp" ? "warning" : "error"),
    name: cleanLine(e.name, LIMITS.name),
    message: cleanMessage(e.message),
    path: cleanPath(e.path),
    route: cleanPath(e.route),
    detail: cleanLine(e.detail, LIMITS.detail),
    digest: typeof e.digest === "string" && /^[\w;:.-]{1,64}$/.test(e.digest) ? e.digest : null,
    stack: cleanStack(e.stack),
  };
}

/**
 * Aynı hatanın özeti (src/server/errors/store.ts bunun sha256'sını alır): kaynak, ad, iletinin sayıları atılmış hâli ve
 * yol kalıbı (yoksa sayısal kesimleri atılmış adres). Yığın girmez: her yayında satır numarası değişir, aynı hata yeni
 * satır açmasın.
 */
export function fingerprintBasis(e: CleanEntry): string {
  const message = e.message
    .replace(/[0-9a-f]{8,}/gi, "#")
    .replace(/\d+/g, "#")
    .slice(0, 300);
  return [e.source, e.name ?? "", message, e.route ?? groupPath(e.path)].join("|");
}

/** Yöneticiye e-postayla bildirilecek hata: sunucuda (sayfa, API yolu, eylem) olan hata */
export function isCritical(e: Pick<CleanEntry, "source" | "level">): boolean {
  return (e.source === "server" || e.source === "action") && e.level === "error";
}

// ---------------------------------------------------------------- Sunucu ve eylem hataları

/** Next'in kendi akış sinyalleri (yönlendirme, 404, dinamik oluşturma): hata değildir */
const FRAMEWORK_DIGEST = /^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|NEXT_PRERENDER_INTERRUPTED|HANGING_PROMISE_REJECTION|NEXT_STATIC_GEN_BAILOUT)/;

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Hatanın adı, iletisi (sarmalanmış hatanın nedeni dahil: drizzle → postgres), yığını ve kodu */
export function describeError(err: unknown): { name: string | null; message: string; stack: string | null; digest: string | null } {
  const o = asObject(err);
  if (!o) return { name: null, message: typeof err === "string" ? err : String(err), stack: null, digest: null };
  const cause = asObject(o.cause);
  const own = str(o.message) ?? "";
  const causeMsg = cause ? str(cause.message) : null;
  // Neden ayrı satırda: drizzle'ın "params:" satırı temizlenirken neden silinmesin
  const message = causeMsg && !own.includes(causeMsg) ? (own ? `${own}\n${causeMsg}` : causeMsg) : own;
  const code = str(o.code) ?? (cause ? str(cause.code) : null);
  const name = str(o.name) ?? (err instanceof Error ? err.constructor.name : null);
  return { name: code && name ? `${name} (${code})` : name, message, stack: str(o.stack), digest: str(o.digest) };
}

/** Bağlantı kesildi (kullanıcı sayfadan çıktı): hata sayılmaz */
const isAbort = (name: string | null, message: string) => /^(AbortError|ResponseAborted)/.test(name ?? "") || /^(aborted|The operation was aborted)/i.test(message);

const ROUTE_TYPES: Record<string, string> = { render: "Sayfa", route: "API yolu", action: "Sunucu eylemi", proxy: "Ara katman" };

/**
 * `onRequestError` (src/instrumentation.ts) girdisinden kayıt. İsteğin başlıkları (çerez, oturum, yetki) ve gövdesi
 * hiç okunmaz; adres yola iner. Next'in akış sinyalleri ve kesilen bağlantı kaydedilmez (null).
 */
export function requestErrorEntry(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string; routeType?: string; renderSource?: string },
): ErrorEntry | null {
  const d = describeError(err);
  if (d.digest && FRAMEWORK_DIGEST.test(d.digest)) return null;
  if (isAbort(d.name, d.message)) return null;
  const type = ROUTE_TYPES[context.routeType ?? ""] ?? context.routeType ?? null;
  const detail = [type, context.renderSource, request.method].filter(Boolean).join(" · ");
  return { source: "server", name: d.name, message: d.message, stack: d.stack, digest: d.digest, path: request.path ?? null, route: context.routePath ?? null, detail };
}

/** `attempt()`'in yakaladığı beklenmeyen hata: adres eylemin çağrıldığı sayfa (Referer'in yolu) */
export function actionErrorEntry(err: unknown, page: string | null): ErrorEntry | null {
  const d = describeError(err);
  if (d.digest && FRAMEWORK_DIGEST.test(d.digest)) return null;
  return { source: "action", name: d.name, message: d.message, stack: d.stack, digest: d.digest, path: page, detail: "Sunucu eylemi" };
}

// ---------------------------------------------------------------- Tarayıcı hataları

/** Tarayıcının gönderdiği hata türü */
export const CLIENT_KINDS = { error: "Sayfa hatası", rejection: "Yakalanmamış söz", boundary: "Hata ekranı" } as const;
export type ClientKind = keyof typeof CLIENT_KINDS;

/** Tarayıcı ailesi ve işletim sistemi (tam kullanıcı aracısı saklanmaz) */
export function coarseAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /FxiOS|Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  return [browser, os].filter(Boolean).join(" · ") || null;
}

/** Tarayıcının gönderdiği gövde (src/lib/client-error-report.ts kurar, /api/hata doğrular) */
export interface ClientErrorBody {
  kind: ClientKind;
  name?: string | null;
  message: string;
  stack?: string | null;
  path: string;
  digest?: string | null;
}

/** `/api/hata` gövdesinden kayıt */
export function clientErrorEntry(b: ClientErrorBody, userAgent: string | null): ErrorEntry {
  const detail = [CLIENT_KINDS[b.kind], coarseAgent(userAgent)].filter(Boolean).join(" · ");
  return { source: "client", name: b.name ?? null, message: b.message, stack: b.stack ?? null, path: b.path, digest: b.digest ?? null, detail };
}

// ---------------------------------------------------------------- CSP ihlalleri

/** Tarayıcı eklentisinin ürettiği ihlal (panelin kodu değil; karara girmez) */
export const EXTENSION_MARK = "eklenti";

/** CSP raporundan kayıt (src/lib/csp.ts parseCspReports'un çıktısı) */
export function cspEntry(v: { directive: string; blocked: string; page: string; disposition: string; source: string | null }): ErrorEntry {
  const extension = v.blocked === EXTENSION_MARK || (v.source ?? "").startsWith(EXTENSION_MARK);
  const enforce = v.disposition === "enforce";
  return {
    source: "csp",
    level: enforce ? "error" : "warning",
    name: v.directive,
    message: `${v.directive} ${v.blocked}`,
    path: v.page,
    detail: [enforce ? "Engellendi" : "Report-Only", v.source ? `kaynak ${v.source}` : null, extension ? EXTENSION_MARK : null].filter(Boolean).join(" · "),
  };
}

export interface CspRow {
  message: string;
  detail: string | null;
  count: number;
  lastSeen: Date;
  resolvedAt: Date | null;
}

/** CSP kararının penceresi: bu kadar gün temiz kalırsa `CSP_ENFORCE=1` önerilir */
export const CSP_CLEAN_DAYS = 7;

export interface CspVerdict {
  tone: "good" | "warn" | "neutral";
  /** Sonuç, sade dille */
  title: string;
  text: string;
  /** Geliştiricinin yapacağı (değişken adı) */
  tech: string;
  /** Pencerede sayılan ihlaller (eklenti ve çözülmüşler hariç) */
  violations: number;
}

const ENFORCE_HOW = "Vercel › Settings › Environment Variables › CSP_ENFORCE = 1 (Production), sonra yeniden yayın. Geri almak: değişkeni silip yeniden yayın (docs/DEPLOY.md › Güvenlik başlıkları).";

/**
 * `CSP_ENFORCE` kararı kanıtla (docs/DEPLOY.md › Güvenlik başlıkları): kayıt en az 7 gündür tutuluyorsa ve son 7 günde
 * panelin kendi kodundan (eklenti değil) çözülmemiş ihlal yoksa açılabilir. `since`: kaydın başladığı an
 * (integration_state › errors.since).
 */
export function cspVerdict(rows: readonly CspRow[], i: { enforced: boolean; since: string | null; now: Date }): CspVerdict {
  const from = i.now.getTime() - CSP_CLEAN_DAYS * 86_400_000;
  const live = rows.filter((r) => !r.resolvedAt && r.lastSeen.getTime() >= from && !(r.detail ?? "").includes(EXTENSION_MARK));
  const violations = live.reduce((a, r) => a + r.count, 0);
  const kinds = live.length;
  const days = `son ${CSP_CLEAN_DAYS} günde`;
  if (i.enforced) {
    return violations
      ? {
          tone: "warn",
          violations,
          title: `Güvenlik politikası uygulanıyor: ${days} ${violations} engelleme (${kinds} farklı)`,
          text: "Bir ekranın bir parçası yüklenmemiş olabilir; aşağıdaki CSP satırlarına bakın.",
          tech: "CSP_ENFORCE=1. Geri almak: Vercel'de değişkeni silip yeniden yayın.",
        }
      : { tone: "good", violations, title: `Güvenlik politikası uygulanıyor; ${days} engelleme yok`, text: "Başka kökenden betik, istek ve görsel yüklenemez.", tech: "CSP_ENFORCE=1." };
  }
  if (violations) {
    return {
      tone: "warn",
      violations,
      title: `Güvenlik politikası henüz uygulanmasın: ${days} ${violations} ihlal (${kinds} farklı)`,
      text: "Uygulansaydı bu kaynaklar engellenirdi. Önce düzeltilsin, satırlar Çözüldü işaretlensin; 7 gün temiz kalınca uygulanabilir.",
      tech: "CSP_ENFORCE açılmaz; politika Report-Only kalır.",
    };
  }
  const sinceMs = i.since ? Date.parse(i.since) : NaN;
  if (!Number.isFinite(sinceMs) || sinceMs > from) {
    const elapsed = Number.isFinite(sinceMs) ? Math.max(0, Math.floor((i.now.getTime() - sinceMs) / 86_400_000)) : 0;
    return {
      tone: "neutral",
      violations,
      title: `Güvenlik politikası: kanıt toplanıyor (${elapsed}/${CSP_CLEAN_DAYS} gün)`,
      text: `Tarayıcılar politikanın engelleyeceği her kaynağı bildirir; ${CSP_CLEAN_DAYS} gün boyunca panelin kendi kodundan bildirim gelmezse uygulanabilir.`,
      tech: "CSP_ENFORCE kapalı (Report-Only); kayıt başlangıcı integration_state › errors.since.",
    };
  }
  return {
    tone: "good",
    violations,
    title: `Güvenlik politikası uygulanabilir: ${days} ihlal yok`,
    text: "Geliştirici politikayı açabilir; bir şey bozulursa geri almak tek bir ayardır.",
    tech: ENFORCE_HOW,
  };
}

// ---------------------------------------------------------------- Yazma kapısı (sunucu örneği başına)

export interface WriteGate {
  /** Bu hata şimdi yazılsın mı: yazılacaksa artış (bekleyenler + 1), yazılmayacaksa null (bekleyene eklenir) */
  take(key: string, now: number): number | null;
  /** Yazma düştü: artış bekleyene geri döner, kapı bir süre kapanır (veritabanı yoksa her istek denemesin) */
  failed(key: string, increment: number, now: number): void;
}

/**
 * Döngüdeki bir hata veritabanını boğmasın: aynı hata `perKeyMs` içinde bir kez yazılır (aradakiler sayılır, sonraki
 * yazıma eklenir), örnek başına dakikada en çok `perMinute` yazım; yazma düşünce `coolOffMs` hiç denenmez. Sayı bu yüzden
 * yaklaşıktır (yazılmadan kapanan örneğin bekleyenleri kaybolur).
 */
export function createWriteGate({ perKeyMs = 10_000, perMinute = 30, coolOffMs = 60_000, maxKeys = 500 } = {}): WriteGate {
  const keys = new Map<string, { last: number; pending: number }>();
  let windowStart = 0;
  let writes = 0;
  let closedUntil = 0;
  const hold = (key: string, now: number, n = 1) => {
    const k = keys.get(key) ?? { last: 0, pending: 0 };
    k.pending += n;
    keys.set(key, k);
    if (keys.size > maxKeys) {
      for (const [id, v] of keys) {
        if (keys.size <= maxKeys) break;
        if (now - v.last >= perKeyMs || !v.pending) keys.delete(id);
      }
    }
  };
  return {
    take(key, now) {
      if (now < closedUntil) {
        hold(key, now);
        return null;
      }
      const k = keys.get(key);
      if (k && now - k.last < perKeyMs) {
        k.pending += 1;
        return null;
      }
      if (now - windowStart >= 60_000) {
        windowStart = now;
        writes = 0;
      }
      if (writes >= perMinute) {
        hold(key, now);
        return null;
      }
      writes += 1;
      const increment = (k?.pending ?? 0) + 1;
      keys.delete(key);
      keys.set(key, { last: now, pending: 0 });
      return increment;
    },
    failed(key, increment, now) {
      closedUntil = now + coolOffMs;
      const k = keys.get(key) ?? { last: now, pending: 0 };
      k.pending += increment;
      keys.set(key, k);
    },
  };
}

// ---------------------------------------------------------------- Ekran ve e-posta

/** Ekrandaki satır */
export interface ErrorRow {
  id: number;
  source: ErrorSource;
  level: ErrorLevel;
  name: string | null;
  message: string;
  path: string | null;
  detail: string | null;
  digest: string | null;
  stack: string | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  resolvedAt: Date | null;
  overflow: boolean;
}

/** Ayarlar › Hata kaydı'nın telefondaki kapalı satırı ve tonu: son 24 saatte açık sunucu hatası varsa kırmızı */
export function errorSummary(rows: readonly Pick<ErrorRow, "source" | "level" | "lastSeen" | "resolvedAt" | "count">[], now: Date): { text: string; tone?: "warn" | "bad" } {
  const open = rows.filter((r) => !r.resolvedAt);
  if (!open.length) return { text: "Açık hata yok" };
  const day = now.getTime() - 86_400_000;
  const recentCritical = open.filter((r) => isCritical(r) && r.lastSeen.getTime() >= day).length;
  if (recentCritical) return { text: `Son 24 saatte ${recentCritical} sunucu hatası`, tone: "bad" };
  const errors = open.filter((r) => r.level === "error").length;
  return errors ? { text: `${errors} açık hata`, tone: "warn" } : { text: `${open.length} açık uyarı (CSP)` };
}

/** "bugün 11:40" / "dün 09:12" / "25 Kas 10:02" (İstanbul) */
export function seenText(at: Date, now: Date): string {
  const day = trDay(at);
  const today = trDay(now);
  const yesterday = trDay(new Date(now.getTime() - 86_400_000));
  const time = at.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
  if (day === today) return `bugün ${time}`;
  if (day === yesterday) return `dün ${time}`;
  return `${at.toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" })} ${time}`;
}

/** Kritik hata e-postasının anahtarı (notification_log): günde bir */
export const alertKey = (day: string) => `hata-kaydi:${day}`;

/** Kritik hata e-postasının maddesi: ilk hatanın kısa iletisi, kaynağı, yeri */
export function alertItem(e: Pick<CleanEntry, "source" | "name" | "message" | "path" | "route" | "digest">, at: Date): { key: string; title: string; body: string } {
  const time = at.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
  const where = e.route ?? e.path;
  const first = e.message.split("\n")[0];
  return {
    key: alertKey(trDay(at)),
    title: `Panelde hata: ${cut(first, 90)}`,
    body: [
      `${SOURCE_LABELS[e.source]}${where ? ` · ${where}` : ""} · ${time}${e.digest ? ` · hata kodu ${e.digest}` : ""}.`,
      "Bugün başka hata olursa ayrı e-posta gelmez; hepsi sayısı, ilk ve son görülüşüyle Ayarlar › Hata kaydı'nda.",
    ].join(" "),
  };
}
