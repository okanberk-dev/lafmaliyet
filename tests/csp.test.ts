// Content-Security-Policy (src/lib/csp.ts; docs/DEPLOY.md › Güvenlik başlıkları): uygulanan çekirdek + Report-Only tam
// politika (CSP_ENFORCE=1 ile uygulanır), Paraşüt'ün kimlik sunucusu form hedefinde, ihlal raporları kişisel veri ve
// sorgu dizgesi olmadan günlüğe.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { coreDirectives, cspEnforced, cspHeaders, cspLogLine, fullDirectives, parasutFormOrigins, parseCspReports } from "../src/lib/csp";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const header = (list: { key: string; value: string }[], key: string) => list.find((h) => h.key === key)?.value ?? null;
const directives = (value: string) => new Map(value.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

test("öntanımlı: çekirdek uygulanır, tam politika Report-Only; ikisi de aynı uca rapor eder", () => {
  const h = cspHeaders({ enforce: false, dev: false, env: {} });
  const core = directives(header(h, "Content-Security-Policy")!);
  assert.deepEqual([...core.keys()], ["frame-ancestors", "base-uri", "form-action", "report-uri", "report-to"], "çekirdek yalnız kaynak yüklemesine dokunmayan yönergeler");
  assert.deepEqual(core.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(core.get("form-action"), ["'self'", "https://id.parasut.com", "https://*.parasut.com"]);
  const full = directives(header(h, "Content-Security-Policy-Report-Only")!);
  assert.deepEqual(full.get("default-src"), ["'self'"]);
  assert.deepEqual(full.get("script-src"), ["'self'", "'unsafe-inline'"], "üretimde eval yok");
  assert.deepEqual(full.get("connect-src"), ["'self'"], "başka kökene istek yok");
  assert.deepEqual(full.get("img-src"), ["'self'", "blob:", "data:"]);
  assert.deepEqual(full.get("frame-src"), ["'self'", "blob:"], "PDF önizlemesi (blob)");
  assert.deepEqual(full.get("object-src"), ["'none'"]);
  assert.equal(full.has("frame-ancestors"), false, "Report-Only'de yok sayılır, uyarı yazdırmasın");
  assert.deepEqual(full.get("report-uri"), ["/api/csp-rapor"]);
  assert.equal(header(h, "Reporting-Endpoints"), 'csp="/api/csp-rapor"');
});

test("CSP_ENFORCE=1: tek uygulanan başlık (tam politika + çerçeve yasağı); geliştirmede eval ve websocket", () => {
  assert.equal(cspEnforced({ CSP_ENFORCE: "1" }), true);
  assert.equal(cspEnforced({ CSP_ENFORCE: " evet " }), true);
  assert.equal(cspEnforced({ CSP_ENFORCE: "0" }), false);
  assert.equal(cspEnforced({}), false);
  const h = cspHeaders({ enforce: true, dev: false, env: {} });
  assert.equal(header(h, "Content-Security-Policy-Report-Only"), null);
  const csp = directives(header(h, "Content-Security-Policy")!);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.deepEqual(csp.get("form-action"), coreDirectives({})["form-action"]);
  const dev = fullDirectives({ dev: true, env: {} });
  assert.ok(dev["script-src"].includes("'unsafe-eval'") && dev["connect-src"].includes("ws:"));
});

test("Paraşüt form hedefi: öntanımlı kimlik sunucusu, ortamdaki https adresleri; bozuk ya da http değer alınmaz", () => {
  assert.deepEqual(parasutFormOrigins({ PARASUT_ISSUER: "https://kimlik.example.com/realms/x", PARASUT_AUTHORIZE_URL: "https://kimlik.example.com/auth?x=1" }), [
    "https://id.parasut.com",
    "https://*.parasut.com",
    "https://kimlik.example.com",
  ]);
  assert.deepEqual(parasutFormOrigins({ PARASUT_ISSUER: "http://id.parasut.com", PARASUT_AUTHORIZE_URL: "çöp" }), ["https://id.parasut.com", "https://*.parasut.com"]);
});

test("ihlal raporu: iki biçim de okunur; adres köken + yol, sorgu ve kişisel veri günlüğe girmez", () => {
  const legacy = JSON.stringify({
    "csp-report": {
      "document-uri": "https://ladmin.laffogato.net/panel/kasa?gun=2026-11-26&ad=Ay%C5%9Fe",
      "violated-directive": "img-src",
      "effective-directive": "img-src",
      "blocked-uri": "https://iz.example.com/p.gif?u=ayse@example.com",
      disposition: "report",
      "source-file": "https://ladmin.laffogato.net/_next/static/chunks/a.js?v=1",
      "line-number": 12,
    },
  });
  assert.deepEqual(parseCspReports(legacy), [
    { directive: "img-src", blocked: "https://iz.example.com/p.gif", page: "/panel/kasa", disposition: "report", source: "https://ladmin.laffogato.net/_next/static/chunks/a.js:12" },
  ]);
  const modern = JSON.stringify([
    { type: "csp-violation", body: { documentURL: "https://ladmin.laffogato.net/giris?next=%2Fpanel", effectiveDirective: "script-src-elem", blockedURL: "inline", disposition: "enforce" } },
    { type: "deprecation", body: {} },
    { type: "csp-violation", body: { documentURL: "https://ladmin.laffogato.net/panel", effectiveDirective: "img-src", blockedURL: "data:image/png;base64,AAAA" } },
  ]);
  const got = parseCspReports(modern);
  assert.deepEqual(got, [
    { directive: "script-src-elem", blocked: "inline", page: "/giris", disposition: "enforce", source: null },
    { directive: "img-src", blocked: "data", page: "/panel", disposition: "enforce", source: null },
  ]);
  assert.equal(cspLogLine(got[0]), "[csp] enforce script-src-elem inline · /giris");
  assert.deepEqual(parseCspReports("çöp"), []);
  assert.deepEqual(parseCspReports("null"), []);
  assert.equal(parseCspReports(JSON.stringify(Array.from({ length: 50 }, () => JSON.parse(modern)[0]))).length, 20, "en çok 20");
});

test("kaynak: başlıklar derlemede next.config'te, yalnız sayfalara; rapor ucu oturumsuz, sınırlı, hep 204, hata kaydına yazar", () => {
  const config = read("next.config.ts");
  assert.match(config, /const CSP_HEADERS = cspHeaders\(\{ enforce: cspEnforced\(process\.env\), dev: process\.env\.NODE_ENV === "development", env: process\.env \}\);/);
  assert.match(config, /\{ source: "\/\(\(\?!api\/\|_next\/\)\.\*\)", headers: CSP_HEADERS \}/, "API ve derlenmiş dosyalar hariç (fotoğrafın sandbox CSP'si korunur)");
  const route = read("src/app/api/csp-rapor/route.ts");
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(route, /getCurrentUser|requireUser|requireAdmin|getDb/, "oturum yok; veritabanına yalnız hata kaydı (beklemeden) yazar");
  assert.match(route, /const MAX_BYTES = 16 \* 1024;/);
  // Sınırlı satırlar hem günlüğe hem hata kaydına (docs/HATA-KAYDI.md; davranışı tests/hata-kaydi-db.test.ts)
  assert.match(route, /if \(logged >= PER_MINUTE\) break;\s*logged\+\+;\s*console\.warn\(cspLogLine\(v\)\);\s*void reportError\(cspEntry\(v\)\);/);
  assert.doesNotMatch(read("src/proxy.ts"), /csp-rapor/, "oturum ara katmanı rapor ucuna dokunmaz");
  // Fotoğraf ucu kendi kısıtlı politikasını taşır
  assert.match(read("src/app/api/foto/[id]/route.ts"), /"Content-Security-Policy": "default-src 'none'; sandbox"/);
});

test("tarayıcıda zod eval denemesi yapmaz: politikada 'unsafe-eval' yok, her sayfa ihlal raporu ürettirmesin", () => {
  // Yerel denetimde (next start + Chromium) her sayfada tek ihlal zod'un `Function("")` denemesiydi
  const instrumentation = read("src/instrumentation-client.ts");
  assert.match(instrumentation, /^import \{ config \} from "zod\/v4\/core";/m);
  assert.match(instrumentation, /^config\(\{ jitless: true \}\);/m, "uygulama kodundan önce, üst düzeyde ve eşzamanlı");
  assert.ok(!fullDirectives({ dev: false, env: {} })["script-src"].includes("'unsafe-eval'"), "üretimde eval'e izin verilmez");
});

/** src altındaki .ts/.tsx dosyaları ve metinleri */
function sources(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e.name)) out.set(p, readFileSync(p, "utf8"));
  }
  return out;
}

test("tarayıcı bileşenleri node:crypto'ya ulaşmaz: paketleyicinin crypto-browserify'ı her açılışta eval ihlali ürettirir", () => {
  // Yerel denetimde Şube ayarları'nın LafPOS kartı imza modülünü (node:crypto) içe aktarıyordu: sayfaya ~0,5 MB
  // crypto-browserify ve onunla gelen `Function(...)` denemesi (script-src eval) gidiyordu
  const src = join(root, "src");
  const text = sources(src);
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(src, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
    if (!base) return null;
    return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((c) => text.has(c)) ?? null;
  };
  // Değer içe aktarmaları (yalnız tür olanlar paketlenmez)
  const IMPORT = /^\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm;
  const rel = (f: string) => f.slice(src.length + 1);
  const seen = new Map<string, string | null>();
  /** Dosyadan node:crypto'ya giden yol ("a → b → c") ya da null */
  const pathToCrypto = (file: string, stack: Set<string>): string | null => {
    if (seen.has(file)) return seen.get(file)!;
    if (stack.has(file)) return null;
    const body = text.get(file)!;
    // Sunucu eylemi tarayıcıya yalnız başvuru olarak gider; server-only tarayıcıya hiç giremez (derleme durur)
    if (/^\s*["']use server["']/.test(body) || /^import "server-only";/m.test(body)) return null;
    stack.add(file);
    let found: string | null = null;
    for (const m of body.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (spec === "crypto" || spec === "node:crypto") found = `${rel(file)} → node:crypto`;
      else {
        const next = resolve(file, spec);
        const deeper = next ? pathToCrypto(next, stack) : null;
        if (deeper) found = `${rel(file)} → ${deeper}`;
      }
      if (found) break;
    }
    stack.delete(file);
    seen.set(file, found);
    return found;
  };
  const clients = [...text.keys()].filter((f) => /^\s*["']use client["']/.test(text.get(f)!));
  assert.ok(clients.length > 50, `tarayıcı bileşenleri bulunamadı (${clients.length})`);
  assert.deepEqual(clients.map((f) => pathToCrypto(f, new Set())).filter(Boolean), [], "tarayıcı bileşeninden node:crypto'ya giden yol");
  // Denetimin kendisi: LafPOS isteğinin denetimi imza modülü üzerinden node:crypto'ya ulaşır
  assert.equal(pathToCrypto(join(src, "lib/lafpos/request.ts"), new Set()), "lib/lafpos/request.ts → lib/karaoke/signature.ts → node:crypto");
});
