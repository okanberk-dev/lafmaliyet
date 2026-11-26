/**
 * Panelin Content-Security-Policy başlıkları (saf; next.config.ts derlemede kurar, tests/csp.test.ts kilitler).
 * Ayrıntı ve karar: docs/DEPLOY.md › Güvenlik başlıkları.
 *
 * Neden nonce yok: panel `cacheComponents` ve `partialPrefetching` ile önceden çizilmiş kabuklar sunar; Next'in
 * kılavuzuna göre nonce her sayfayı her istekte çizmeye zorlar ve önceden çizilmiş kabukla (PPR) bağdaşmaz. Next'in
 * sayfaya gömdüğü satır içi betikler (RSC verisi) ve koyu tema betiği (src/lib/theme.ts) bu yüzden `'unsafe-inline'`
 * ile çalışır; motion ve Recharts satır içi stil yazar. Kazanç yine büyük: başka kökenden betik, bağlantı (fetch),
 * görsel, çerçeve ve eklenti yüklenemez; `<base>` ve form hedefi kaçırılamaz; panel başka sitede çerçeveye alınamaz.
 *
 * İki başlık:
 * - **Uygulanan çekirdek** (her zaman): `frame-ancestors 'none'`, `base-uri 'self'`, `form-action` (panel ve Paraşüt'ün
 *   kimlik sunucusu: "Paraşüt hesabını bağla" formu Paraşüt'ün onay ekranına 303 ile gider; tarayıcılar form hedefini
 *   yönlendirmede de denetler). Bu üçü hiçbir kaynak yüklemesini değiştirmez, ekranı bozamaz.
 * - **Tam politika** (kaynaklar): `CSP_ENFORCE=1` değilken `Content-Security-Policy-Report-Only` olarak gider:
 *   tarayıcı hiçbir şeyi engellemez, yalnız ihlali `/api/csp-rapor`'a bildirir (Vercel günlüklerinde `[csp]`). Günlük
 *   temiz kalınca `CSP_ENFORCE=1` ile uygulanır; geri almak değişkeni silmektir (ikisi de yeniden deploy).
 */

/** İhlal raporlarının gittiği uç (src/app/api/csp-rapor/route.ts) */
export const CSP_REPORT_PATH = "/api/csp-rapor";
/** Reporting API'deki uç adı (`report-to`) */
export const CSP_REPORT_GROUP = "csp";

/** Paraşüt'ün kimlik sunucusunun öntanımlı kökeni (src/server/parasut/config.ts DEFAULT_ISSUER) */
const PARASUT_ID_ORIGIN = "https://id.parasut.com";

/** Ortamdaki adresin https kökeni (yoksa, bozuksa ya da https değilse null) */
function httpsOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * "Paraşüt hesabını bağla" formunun gidebileceği kökenler: öntanımlı kimlik sunucusu, ortamda verilmişse
 * `PARASUT_ISSUER` ve `PARASUT_AUTHORIZE_URL`'nin kökeni. Keşif belgesi yetki ucunu yayıncıyla aynı alan adında
 * verebilir (src/lib/parasut/oidc.ts sameSite): `*.parasut.com` da izinli
 */
export function parasutFormOrigins(env: Record<string, string | undefined>): string[] {
  const list = [PARASUT_ID_ORIGIN, "https://*.parasut.com", httpsOrigin(env.PARASUT_ISSUER), httpsOrigin(env.PARASUT_AUTHORIZE_URL)];
  return [...new Set(list.filter((x): x is string => Boolean(x)))];
}

const join = (directives: Record<string, string[]>) =>
  Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");

/** Uygulanan çekirdek: kaynak yüklemesine dokunmayan üç yönerge */
export function coreDirectives(env: Record<string, string | undefined>): Record<string, string[]> {
  return {
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...parasutFormOrigins(env)],
  };
}

/**
 * Tam politika: her şey kendi kökeninden. `blob:` ve `data:` görseller (fotoğraf önizlemesi, sıkıştırma, QR), `blob:`
 * çerçeve (fatura belgesinin PDF önizlemesi) ve işçi; servis çalışanı `/sw.js`. Geliştirmede React hata ayıklaması
 * `eval` ve sıcak yenileme websocket'i ister. `frame-ancestors` yalnız uygulanan başlıkta geçerlidir (Report-Only'de
 * tarayıcı yok sayıp uyarı yazar): çekirdekte
 */
export function fullDirectives(opts: { dev: boolean; env: Record<string, string | undefined> }): Record<string, string[]> {
  const core = coreDirectives(opts.env);
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(opts.dev ? ["ws:", "wss:"] : [])],
    "media-src": ["'self'", "blob:", "data:"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": core["base-uri"],
    "form-action": core["form-action"],
  };
}

/**
 * Sayfalara giden başlıklar. `enforce`: tam politika uygulanır (çekirdekle birleşik tek başlık); değilse çekirdek
 * uygulanır, tam politika Report-Only. Raporlar `report-uri` (Firefox, Safari) ve `report-to` (Chromium) ile aynı uca
 */
export function cspHeaders(opts: { enforce: boolean; dev: boolean; env: Record<string, string | undefined> }): { key: string; value: string }[] {
  const report = { "report-uri": [CSP_REPORT_PATH], "report-to": [CSP_REPORT_GROUP] };
  const full = fullDirectives(opts);
  const reporting = { key: "Reporting-Endpoints", value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` };
  if (opts.enforce) {
    return [{ key: "Content-Security-Policy", value: join({ ...full, "frame-ancestors": ["'none'"], ...report }) }, reporting];
  }
  return [
    { key: "Content-Security-Policy", value: join({ ...coreDirectives(opts.env), ...report }) },
    { key: "Content-Security-Policy-Report-Only", value: join({ ...full, ...report }) },
    reporting,
  ];
}

/** `CSP_ENFORCE` açık mı ("1", "true", "evet") */
export function cspEnforced(env: Record<string, string | undefined>): boolean {
  return /^(1|true|evet|on)$/i.test(env.CSP_ENFORCE?.trim() ?? "");
}

// ---------------------------------------------------------------- ihlal raporları

/** Günlüğe yazılan ihlal: kişisel veri ve sorgu dizgesi yok (adres yalnız köken + yol) */
export interface CspViolation {
  /** Çiğnenen yönerge (script-src-elem, img-src…) */
  directive: string;
  /** Engellenen kaynak: köken + yol ya da inline / eval / data / blob */
  blocked: string;
  /** İhlalin olduğu sayfanın yolu */
  page: string;
  /** "report" (Report-Only) ya da "enforce" */
  disposition: string;
  /** Betik dosyası ve satırı (varsa; köken + yol) */
  source: string | null;
}

const MAX_FIELD = 160;

/** Adres: yalnız köken + yol (sorgu ve parça atılır); anahtar sözcükler olduğu gibi; boşsa "?" */
function safeUrl(raw: unknown, pathOnly = false): string {
  if (typeof raw !== "string" || !raw.trim()) return "?";
  const v = raw.trim();
  if (/^(inline|eval|wasm-eval|trusted-types-[\w-]+|self|data|blob)$/i.test(v)) return v.toLowerCase();
  try {
    const u = new URL(v);
    if (u.protocol === "data:" || u.protocol === "blob:") return u.protocol.slice(0, -1);
    return (pathOnly ? u.pathname : `${u.origin}${u.pathname}`).slice(0, MAX_FIELD);
  } catch {
    return v.replace(/[?#].*$/, "").slice(0, MAX_FIELD);
  }
}

const text = (v: unknown, fallback = "?") => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_FIELD) : fallback);

/**
 * Tarayıcının gönderdiği ihlal raporları: `report-uri` (application/csp-report: `{ "csp-report": {…} }`) ya da
 * Reporting API (application/reports+json: `[{ type: "csp-violation", body: {…} }]`). Bozuk gövde boş liste; en çok 20
 */
export function parseCspReports(raw: string): CspViolation[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: CspViolation[] = [];
  const legacy = (json as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (legacy && typeof legacy === "object") {
    out.push({
      directive: text(legacy["effective-directive"] ?? legacy["violated-directive"]),
      blocked: safeUrl(legacy["blocked-uri"]),
      page: safeUrl(legacy["document-uri"], true),
      disposition: text(legacy.disposition, "enforce"),
      source: legacy["source-file"] ? `${safeUrl(legacy["source-file"])}:${Number(legacy["line-number"]) || 0}` : null,
    });
  } else if (Array.isArray(json)) {
    for (const r of json.slice(0, 20) as ({ type?: unknown; body?: Record<string, unknown> } | null)[]) {
      if (!r || r.type !== "csp-violation" || !r.body || typeof r.body !== "object") continue;
      const b = r.body;
      out.push({
        directive: text(b.effectiveDirective),
        blocked: safeUrl(b.blockedURL),
        page: safeUrl(b.documentURL, true),
        disposition: text(b.disposition, "enforce"),
        source: b.sourceFile ? `${safeUrl(b.sourceFile)}:${Number(b.lineNumber) || 0}` : null,
      });
    }
  }
  return out;
}

/** Günlük satırı: `[csp] report img-src https://x.example/a.png · /panel/kasa (kaynak …)` */
export function cspLogLine(v: CspViolation): string {
  return `[csp] ${v.disposition} ${v.directive} ${v.blocked} · ${v.page}${v.source ? ` (kaynak ${v.source})` : ""}`;
}
