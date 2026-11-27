// Hata kaydı (docs/HATA-KAYDI.md; src/lib/error-log.ts, src/lib/client-error-report.ts, src/server/errors/store.ts):
// kişisel veri ve anahtar temizliği (çok satırlı sorgu parametresi dahil), denetim karakterleri, uzun girdide süre,
// kısaltma, aynı hatanın tek satırı (özet; CSP'de sayfa girmez), Next'in hata kancasının girdisi (başlık, çerez, gövde
// yok), eylem ve tarayıcı hataları, yazma kapısı (döngü veritabanını boğmasın; kaynak başına ayrı pay, bozuk satır
// kapıyı kapatmaz), CSP kararı (Çözüldü bekleme süresini atlatmaz, sınır satırı ihlal sayılmaz), e-postanın maddesi ve
// süresi; kaydın isteği hiçbir zaman bozmaması. Veritabanıyla tests/hata-kaydi-db.test.ts.
// Çalıştırma: npx tsx --test tests/hata-kaydi.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { DrizzleQueryError } from "drizzle-orm";

import { clientErrorBody, MAX_REPORTS_PER_PAGE, shouldSend } from "../src/lib/client-error-report";
import { parseCspReports } from "../src/lib/csp";
import {
  actionErrorEntry,
  alertItem,
  alertKey,
  cleanPath,
  cleanStack,
  clientErrorEntry,
  coarseAgent,
  createWriteGate,
  cspEntry,
  cspVerdict,
  describeError,
  errorSummary,
  fingerprintBasis,
  GATE_PER_MINUTE,
  isCritical,
  LIMITS,
  overflowMessage,
  redactText,
  requestErrorEntry,
  sanitizeEntry,
  seenText,
  trDay,
  trDayStart,
  type CspRow,
  type ErrorEntry,
} from "../src/lib/error-log";

const NOW = new Date("2026-11-27T09:30:00Z"); // İstanbul 12:30

test("temizlik: veritabanı parametreleri, bağlantı parolası, anahtarlar ve parola çiftleri", () => {
  const drizzle = 'Failed query: insert into "users" ("email", "name") values ($1, $2)\nparams: ayse@ornek.com,Ayşe Yılmaz';
  const out = redactText(drizzle);
  assert.match(out, /^Failed query: insert into "users"/);
  assert.match(out, /params: \[gizli\]/);
  assert.doesNotMatch(out, /Ayşe|ornek\.com/);
  assert.equal(redactText("connect postgres://kullanici:sifre123@db.neon.tech/main"), "connect postgres://[gizli]@db.neon.tech/main");
  assert.equal(redactText("Authorization: Bearer abc.def-ghi"), "Authorization: [gizli] [gizli]");
  assert.equal(redactText("çerez eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.c2lnbmF0dXJl bozuk"), "çerez [anahtar] bozuk");
  assert.equal(redactText("anahtar sk-ant-api03-AbCdEf123456 reddedildi"), "anahtar [anahtar] reddedildi");
  assert.equal(redactText("re_123abcDEF456 geçersiz"), "[anahtar] geçersiz");
  assert.equal(redactText('password="çok gizli" ve token=abc123; secret: xyz'), 'password=[gizli] ve token=[gizli]; secret: [gizli]');
  // 32+ karakterlik harf-rakam karışık dizgi (belirteç); düz SQL adları dokunulmaz
  assert.equal(redactText("davet 9f8e7d6c5b4a39281706f5e4d3c2b1a0Zz bulunamadı"), "davet [anahtar] bulunamadı");
  assert.equal(redactText('relation "error_log_fingerprint_uq" already exists'), 'relation "error_log_fingerprint_uq" already exists');
});

test("temizlik: adreslerin sorgu dizgesi, e-posta, IBAN, telefon / kimlik / kart numarası", () => {
  assert.equal(redactText("fetch https://api.ornek.com/v1/x?token=abc&u=1#p başarısız"), "fetch https://api.ornek.com/v1/x başarısız");
  assert.equal(redactText("yol /panel/kasa?gun=2026-11-01&s=abc bozuk"), "yol /panel/kasa bozuk");
  assert.equal(redactText("E-posta ayse.yilmaz+kafe@ornek.com.tr kayıtlı"), "E-posta [e-posta] kayıtlı");
  assert.equal(redactText("IBAN TR33 0006 1005 1978 6457 8413 26 geçersiz"), "IBAN [IBAN] geçersiz");
  assert.equal(redactText("tel 0532 123 45 67, tc 12345678901, kart 4111-1111-1111-1111"), "tel [sayı], tc [sayı], kart [sayı]");
  // Kısa sayılar (tutar, kimlik, satır) kalır
  assert.equal(redactText("Fatura 1234 için tutar 15000 çok büyük"), "Fatura 1234 için tutar 15000 çok büyük");
});

test("yol: köken, sorgu ve parça atılır; davet / sıfırlama anahtarı ve UUID gizlenir; kısaltılır", () => {
  assert.equal(cleanPath("https://ladmin.laffogato.net/panel/kasa?gun=2026-11-01#x"), "/panel/kasa");
  assert.equal(cleanPath("/davet/aB3dE5fG7hJ9kL1mN3pQ5rS7?x=1"), "/davet/:anahtar");
  assert.equal(cleanPath("/api/foto/0b9f2c1e-8a1d-4c3e-9f00-123456789abc"), "/api/foto/:anahtar");
  assert.equal(cleanPath("/panel/faturalar/123"), "/panel/faturalar/123");
  assert.equal(cleanPath(""), null);
  assert.equal(cleanPath(null), null);
  assert.equal(cleanPath(`/panel/${"a".repeat(400)}`)!.length, LIMITS.path);
});

test("yığın: yalnız çerçeve satırları, sunucu yolları kısaltılmış, tarayıcı adresleri yola inmiş, sınırlı", () => {
  const server = [
    "Error: params ayse@ornek.com",
    "    at loadModel (/var/task/.next/server/chunks/ssr/app_panel_1a2b.js:12:34)",
    "    at async Page (webpack-internal:///(rsc)/./src/app/panel/page.tsx:40:5)",
    "    at /Users/birisi/Downloads/lafmaliyet/node_modules/postgres/src/connection.js:790:26",
  ].join("\n");
  assert.equal(
    cleanStack(server),
    ["at loadModel (.next/server/chunks/ssr/app_panel_1a2b.js:12:34)", "at async Page (src/app/panel/page.tsx:40:5)", "at node_modules/postgres/src/connection.js:790:26"].join("\n"),
  );
  const browser = "TypeError: x is undefined\nrender@https://ladmin.laffogato.net/_next/static/chunks/abc.js?dpl=dpl_XYZ:1:2345\n@https://ladmin.laffogato.net/_next/static/chunks/def.js:3:4";
  assert.equal(cleanStack(browser), "render@/_next/static/chunks/abc.js:1:2345\n@/_next/static/chunks/def.js:3:4");
  const long = Array.from({ length: 40 }, (_, i) => `    at f${i} (src/x.ts:${i}:1)`).join("\n");
  assert.equal(cleanStack(long)!.split("\n").length, LIMITS.stackLines);
  assert.equal(cleanStack("yalnız ileti, çerçeve yok"), null);
  assert.equal(cleanStack(undefined), null);
});

test("satır: alanlar temizlenir ve kısaltılır; hata kodu yalnız düz biçimde; CSP uyarı düzeyinde", () => {
  const e = sanitizeEntry({
    source: "server",
    name: "PostgresError",
    message: `${"x".repeat(2000)} ayse@ornek.com`,
    path: "/panel/kasa?t=abc",
    detail: "Sayfa\n·\tGET",
    digest: "1234567890",
    stack: "    at a (src/a.ts:1:1)",
  });
  assert.equal(e.level, "error");
  assert.equal(e.message.length, LIMITS.message);
  assert.equal(e.path, "/panel/kasa");
  assert.equal(e.detail, "Sayfa · GET");
  assert.equal(e.digest, "1234567890");
  assert.equal(sanitizeEntry({ source: "server", message: "x", digest: "<script>" }).digest, null);
  assert.equal(sanitizeEntry({ source: "csp", message: "img-src" }).level, "warning");
  assert.equal(sanitizeEntry({ source: "client", message: "  " }).message, "(iletisiz hata)");
});

test("özet: sayıları farklı aynı hata tek satır; yol kalıbı adresin önüne geçer; kaynak ayırır", () => {
  const base: ErrorEntry = { source: "server", name: "Error", message: "Fatura 123 bulunamadı", path: "/panel/faturalar/123" };
  const a = fingerprintBasis(sanitizeEntry(base));
  assert.equal(fingerprintBasis(sanitizeEntry({ ...base, message: "Fatura 9876 bulunamadı", path: "/panel/faturalar/9876" })), a);
  assert.notEqual(fingerprintBasis(sanitizeEntry({ ...base, source: "action" })), a);
  assert.notEqual(fingerprintBasis(sanitizeEntry({ ...base, message: "Ödeme 123 bulunamadı" })), a);
  const routed = fingerprintBasis(sanitizeEntry({ ...base, route: "/panel/faturalar/[id]" }));
  assert.equal(fingerprintBasis(sanitizeEntry({ ...base, path: "/panel/faturalar/55", route: "/panel/faturalar/[id]" })), routed);
  // Yığın özete girmez: yeni yayında satır numarası değişse de aynı satır
  assert.equal(fingerprintBasis(sanitizeEntry({ ...base, stack: "    at a (src/a.ts:1:1)" })), fingerprintBasis(sanitizeEntry({ ...base, stack: "    at a (src/a.ts:99:7)" })));
});

test("hata kancası: istek başlıkları (çerez, yetki) ve gövde kayda hiç girmez; adres yola iner; Next sinyalleri atlanır", () => {
  const err = Object.assign(new Error("Bağlantı koptu"), { digest: "998877" });
  const request = {
    path: "/panel/kasa/2026-11-01?gizli=evet&token=abc",
    method: "POST",
    headers: { cookie: "__Host-laf_oturum=COOKIE-DEGERI", authorization: "Bearer YETKI-DEGERI", "x-forwarded-for": "203.0.113.9" },
  };
  const entry = requestErrorEntry(err, request, { routePath: "/panel/kasa/[gun]", routeType: "render", renderSource: "react-server-components" });
  assert.ok(entry, "kayıt var");
  const clean = sanitizeEntry(entry);
  const all = JSON.stringify(clean);
  for (const leak of ["COOKIE-DEGERI", "YETKI-DEGERI", "203.0.113.9", "gizli=evet", "token"]) assert.ok(!all.includes(leak), `kayıtta yok: ${leak}`);
  assert.equal(clean.path, "/panel/kasa/2026-11-01");
  assert.equal(clean.route, "/panel/kasa/[gun]");
  assert.equal(clean.detail, "Sayfa · react-server-components · POST");
  assert.equal(clean.digest, "998877");
  assert.equal(clean.source, "server");
  // Yönlendirme, 404 ve kesilen bağlantı hata değildir
  assert.equal(requestErrorEntry(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/giris;307;" }), request, {}), null);
  assert.equal(requestErrorEntry(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), request, {}), null);
  assert.equal(requestErrorEntry(Object.assign(new Error("aborted"), { name: "AbortError" }), request, {}), null);
  assert.equal(requestErrorEntry("düz metin", { path: "/api/x", method: "GET" }, { routeType: "route" })?.detail, "API yolu · GET");
});

test("eylem hatası: drizzle'ın sarmaladığı postgres hatasının nedeni ve kodu; sayfa Referer'in yolu", () => {
  const cause = Object.assign(new Error('relation "x" does not exist'), { code: "42P01", name: "PostgresError" });
  const err = Object.assign(new Error('Failed query: select 1\nparams: ayse@ornek.com'), { cause, name: "DrizzleQueryError" });
  const d = describeError(err);
  assert.equal(d.name, "DrizzleQueryError (42P01)");
  assert.match(d.message, /^relation "x" does not exist\nFailed query: select 1/, "önce neden, sorgu sonda");
  const clean = sanitizeEntry(actionErrorEntry(err, "https://ladmin.laffogato.net/panel/kasa?gun=2026-11-01")!);
  assert.equal(clean.path, "/panel/kasa");
  assert.equal(clean.detail, "Sunucu eylemi");
  assert.doesNotMatch(clean.message, /ornek\.com/);
  assert.equal(clean.message, 'relation "x" does not exist\nFailed query: select 1\nparams: [gizli]', "neden params'la silinmez");
  assert.equal(isCritical(clean), true);
});

test("sorgu hatası: çok satırlı parametre (adres, kart, tutar) hiçbir alana girmez; neden önce, e-postanın konusu neden", () => {
  const param = "Kapıda ödeme\nAdres: Moda Cad. 12 D:4 Kadıköy\nKart son 4: 4421, tutar 1.250 TL\nayse@ornek";
  const cause = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014", name: "PostgresError" });
  const sqlText = `select ${Array.from({ length: 40 }, (_, i) => `"invoices"."c${i}"`).join(", ")} from "invoices" where "invoices"."note" = $1`;
  const err = new DrizzleQueryError(sqlText, [param, 1250], cause);
  assert.match(err.message, /Moda Cad/, "drizzle iletiye parametreleri koyar");
  for (const e of [err, new Error("Kasa raporu kaydedilemedi", { cause: err })]) {
    const clean = sanitizeEntry(actionErrorEntry(e, "/panel/kasa")!);
    const all = JSON.stringify(clean);
    for (const leak of ["Moda", "Kadıköy", "4421", "1.250", "Kapıda", "ayse@ornek", "params"]) assert.ok(!all.includes(leak), `kayıtta yok: ${leak}`);
    assert.match(clean.message, /canceling statement due to statement timeout\nFailed query: select "invoices"/);
    assert.ok(clean.stack, "yığın çerçeveleri kalır");
    assert.ok(!alertItem(clean, NOW).title.includes("Moda"), "e-postanın konusunda parametre yok");
  }
  const clean = sanitizeEntry(actionErrorEntry(err, "/panel/kasa")!);
  assert.equal(clean.name, "Error (57014)");
  assert.equal(alertItem(clean, NOW).title, "Panelde hata: canceling statement due to statement timeout");
  // Uzun SQL'de neden kısaltmaya kurban gitmez; aynı sorgunun farklı nedenleri ayrı satır
  assert.ok(clean.message.length <= LIMITS.message);
  const other = sanitizeEntry(actionErrorEntry(new DrizzleQueryError(sqlText, [param], Object.assign(new Error('column "x" does not exist'), { code: "42703" })), "/panel/kasa")!);
  assert.notEqual(fingerprintBasis(other), fingerprintBasis(clean));
  // Farklı parametre değerleri yeni satır açmaz
  const again = sanitizeEntry(actionErrorEntry(new DrizzleQueryError(sqlText, ["Başka adres\nSatır 2"], cause), "/panel/kasa")!);
  assert.equal(fingerprintBasis(again), fingerprintBasis(clean));
  // Yedek: sorgu alanları olmayan düz iletide de params'tan sonrası (çok satırlı) atılır
  assert.equal(redactText("Failed query: select 1\nparams: a\nAdres: Moda\nKart 4421"), "Failed query: select 1\nparams: [gizli]");
});

test("denetim karakterleri atılır (Postgres NUL'u reddeder); uzun girdi temizlikten önce kısaltılır, iş kısa sürer", () => {
  const e = sanitizeEntry({ source: "csp", name: "script-src\u0000x", message: "a\u0000b\u0007c\td\ne", path: "/panel\u0000/kasa", detail: "Report-Only\u0000", stack: "    at f\u0000 (src/a.ts:1:1)" });
  assert.ok(!JSON.stringify(e).includes("\\u0000") && !JSON.stringify(e).includes("\\u0007"), JSON.stringify(e));
  assert.equal(e.message, "abc d\ne");
  assert.equal(e.name, "script-srcx");
  assert.equal(e.path, "/panel/kasa");
  assert.equal(e.stack, "at f (src/a.ts:1:1)");
  // V8 yığınında iletinin "x@y" satırı çerçeve sanılmaz
  assert.equal(cleanStack("Error: kayıt\nkullanici@sunucu\n    at f (src/a.ts:1:1)"), "at f (src/a.ts:1:1)");
  const started = performance.now();
  for (const raw of ["a".repeat(64_000), "a-".repeat(32_000), "@".repeat(64_000), "1 ".repeat(32_000), `TR12${"1".repeat(64_000)}`]) {
    const out = sanitizeEntry({ source: "server", name: raw, message: raw, path: `/${raw}`, detail: raw, stack: `${raw}\n${"    at ".repeat(5_000)}\n${raw.replace(/a/g, "@")}:1:2` });
    assert.ok(out.message.length <= LIMITS.message && (out.stack ?? "").length <= LIMITS.stack);
  }
  const ms = performance.now() - started;
  assert.ok(ms < 1_500, `uzun girdi ${Math.round(ms)} ms sürdü`);
});

test("tarayıcı: bağlantı kopması, eklenti, sunucuda oluşmuş kodlu hata gönderilmez; sayfa başına sınır ve tekrar", () => {
  const err = new TypeError("Cannot read properties of undefined (reading 'x')");
  const body = clientErrorBody("error", err, "/panel/kasa");
  assert.equal(body?.message, "Cannot read properties of undefined (reading 'x')");
  assert.equal(body?.name, "TypeError");
  assert.equal(clientErrorBody("rejection", new TypeError("Failed to fetch"), "/panel"), null);
  assert.equal(clientErrorBody("rejection", new TypeError("Load failed"), "/panel"), null);
  assert.equal(clientErrorBody("error", "Script error.", "/panel"), null);
  assert.equal(clientErrorBody("error", Object.assign(new Error("x"), { stack: "f@chrome-extension://abc/content.js:1:1" }), "/panel"), null);
  assert.equal(clientErrorBody("boundary", Object.assign(new Error("Server Components render"), { digest: "123" }), "/panel"), null, "sunucu kancası yazdı");
  assert.equal(clientErrorBody("rejection", undefined, "/panel"), null);
  assert.equal(clientErrorBody("rejection", "düz metin söz", "/panel")?.message, "düz metin söz");
  const state = { keys: new Set<string>(), count: 0 };
  assert.equal(shouldSend(state, body!), true);
  assert.equal(shouldSend(state, body!), false, "aynı ileti bir kez");
  for (let i = 0; i < 10; i++) shouldSend(state, { ...body!, message: `hata ${i}` });
  assert.equal(state.count, MAX_REPORTS_PER_PAGE);
  // Sunucudaki kayıt: tarayıcının tam kimliği değil ailesi
  const entry = clientErrorEntry({ kind: "boundary", message: "x", path: "/panel/sayim" }, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1");
  assert.equal(entry.detail, "Hata ekranı · Safari · iOS");
  assert.equal(coarseAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36"), "Chrome · Android");
  assert.equal(coarseAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0"), "Edge · Windows");
  assert.equal(coarseAgent(null), null);
  assert.equal(isCritical(sanitizeEntry(entry)), false, "tarayıcı hatası e-posta göndermez");
});

test("yazma kapısı: aynı hata 10 sn'de bir yazılır, aradakiler sonrakine eklenir; dakikada sınır; düşünce bir dakika kapalı", () => {
  const gate = createWriteGate({ perKeyMs: 10_000, perMinute: 3, coolOffMs: 60_000 });
  const t0 = 1_000_000;
  assert.equal(gate.take("a", t0), 1);
  assert.equal(gate.take("a", t0 + 1), null);
  assert.equal(gate.take("a", t0 + 2), null);
  assert.equal(gate.take("a", t0 + 10_000), 3, "iki bekleyen + bu");
  assert.equal(gate.take("b", t0 + 10_001), 1);
  assert.equal(gate.take("c", t0 + 10_002), null, "dakikada en çok 3 yazım (a, a, b)");
  assert.equal(gate.take("c", t0 + 70_002), 2, "bekleyen c de sayıldı");
  // Yazma düştü: artış geri döner, kapı bir dakika kapalı
  gate.failed("c", 2, t0 + 70_003);
  assert.equal(gate.take("d", t0 + 80_000), null);
  assert.equal(gate.take("c", t0 + 140_000), 3, "düşen 2 + bu");
  assert.equal(gate.take("d", t0 + 140_001), 2);
});

test("CSP: rapordan satır; aynı ihlal her sayfada tek satır; eklentinin ihlali kayda girmez", () => {
  const legacy = JSON.stringify({ "csp-report": { "document-uri": "https://ladmin.laffogato.net/panel/kasa?x=1", "effective-directive": "img-src", "blocked-uri": "https://iz.example.com/p.gif?u=ayse", disposition: "report" } });
  const [v] = parseCspReports(legacy);
  const e = sanitizeEntry(cspEntry(v)!);
  assert.deepEqual([e.source, e.level, e.name, e.message, e.path, e.detail], ["csp", "warning", "img-src", "img-src https://iz.example.com/p.gif", "/panel/kasa", "Report-Only"]);
  assert.equal(isCritical(e), false, "CSP e-posta göndermez");
  // Sayfa özete girmez: /panel/kasa/2026-11-01 ve /panel/ayarlar aynı satır; engellenen kaynak ayırır
  const at = (page: string, blocked = v.blocked) => fingerprintBasis(sanitizeEntry(cspEntry({ ...v, page, blocked })!));
  assert.equal(at("/panel/kasa/2026-11-01"), at("/panel/ayarlar"));
  assert.notEqual(at("/panel/kasa", "https://baska.example.com/p.gif"), at("/panel/kasa"));
  const report = (body: Record<string, unknown>) => parseCspReports(JSON.stringify([{ type: "csp-violation", body: { documentURL: "https://x/panel", effectiveDirective: "script-src-elem", disposition: "report", ...body } }]))[0];
  const ext = report({ blockedURL: "chrome-extension://abcdef/inject.js" });
  assert.equal(ext.blocked, "eklenti");
  assert.equal(cspEntry(ext), null, "eklentinin engellenen kaynağı");
  // Eklentinin satır içi betiği panelin satır içi ihlaliyle aynı özeti paylaşamaz: hiç yazılmaz
  const extInline = report({ blockedURL: "inline", sourceFile: "chrome-extension://abcdef/content.js", lineNumber: 3 });
  assert.equal(extInline.source, "eklenti:3");
  assert.equal(cspEntry(extInline), null, "eklentinin betik dosyası");
  const own = cspEntry(report({ blockedURL: "inline", sourceFile: "https://x/_next/static/chunks/eklenti-listesi.js", lineNumber: 3 }));
  assert.ok(own, "panelin dosyası (adında 'eklenti' geçse de) yazılır");
  // Oturumsuz gövdenin denetim karakterleri günlüğe ve kayda gitmez
  const nul = report({ blockedURL: "https://iz.example.com/a", effectiveDirective: "script-src\u0000x\n[csp] sahte satır" });
  assert.equal(nul.directive, "script-src x [csp] sahte satır");
});

test("CSP kararı: 7 gün kanıt, ihlal varken açılmaz, temizse açılır; uygulanıyorken engellemeler", () => {
  const day = 86_400_000;
  const row = (o: Partial<CspRow>): CspRow => ({ count: 2, lastSeen: new Date(NOW.getTime() - day), resolvedAt: null, overflow: false, ...o });
  const since8 = new Date(NOW.getTime() - 8 * day).toISOString();
  const since3 = new Date(NOW.getTime() - 3 * day).toISOString();
  assert.deepEqual(
    [cspVerdict([], { enforced: false, since: null, now: NOW }).tone, cspVerdict([], { enforced: false, since: null, now: NOW }).title],
    ["neutral", "Güvenlik politikası: kanıt toplanıyor (0/7 gün)"],
  );
  assert.equal(cspVerdict([], { enforced: false, since: since3, now: NOW }).title, "Güvenlik politikası: kanıt toplanıyor (3/7 gün)");
  const clean = cspVerdict([row({ lastSeen: new Date(NOW.getTime() - 9 * day) }), row({ lastSeen: new Date(NOW.getTime() - 8 * day), resolvedAt: NOW })], { enforced: false, since: since8, now: NOW });
  assert.equal(clean.tone, "good");
  assert.equal(clean.title, "Güvenlik politikası uygulanabilir: son 7 günde ihlal yok");
  assert.match(clean.tech, /CSP_ENFORCE = 1/);
  const dirty = cspVerdict([row({}), row({ count: 3 })], { enforced: false, since: since8, now: NOW });
  assert.equal(dirty.tone, "warn");
  assert.equal(dirty.violations, 5);
  assert.equal(dirty.title, "Güvenlik politikası henüz uygulanmasın: son 7 günde 5 ihlal (2 farklı)");
  assert.equal(cspVerdict([row({})], { enforced: false, since: since3, now: NOW }).tone, "warn", "ihlal varsa beklemeden söylenir");
  assert.equal(cspVerdict([row({})], { enforced: true, since: since8, now: NOW }).title, "Güvenlik politikası uygulanıyor: son 7 günde 2 engelleme (1 farklı)");
  assert.equal(cspVerdict([], { enforced: true, since: null, now: NOW }).tone, "good");
  // Çözüldü bekleme süresini atlatmaz: dün görülüp bugün çözülen ihlal temiz günleri dünden başlatır
  const tidied = cspVerdict([row({ resolvedAt: NOW }), row({ count: 9, lastSeen: new Date(NOW.getTime() - 3 * day), resolvedAt: NOW })], { enforced: false, since: since8, now: NOW });
  assert.deepEqual([tidied.tone, tidied.violations, tidied.title], ["neutral", 0, "Güvenlik politikası: kanıt toplanıyor (1/7 gün)"]);
  assert.match(tidied.text, /Çözüldü/);
  assert.equal(cspVerdict([row({ lastSeen: new Date(NOW.getTime() - 7 * day - 60_000), resolvedAt: NOW })], { enforced: false, since: since8, now: NOW }).tone, "good", "7 gün dolunca");
  // Günün "sınır doldu" satırı ihlal sayılmaz ama "uygulanabilir" de denmez
  const capped = cspVerdict([row({ overflow: true, count: 3, lastSeen: new Date(NOW.getTime() - 2 * day) })], { enforced: false, since: since8, now: NOW });
  assert.deepEqual([capped.tone, capped.violations, capped.title], ["neutral", 0, "Güvenlik politikası: kanıt toplanıyor (2/7 gün)"]);
  assert.match(capped.text, /Vercel günlüğünde/);
  const mixed = cspVerdict([row({}), row({ overflow: true, count: 40 })], { enforced: false, since: since8, now: NOW });
  assert.equal(mixed.title, "Güvenlik politikası henüz uygulanmasın: son 7 günde 2 ihlal (1 farklı)");
  assert.equal(cspVerdict([row({ overflow: true })], { enforced: true, since: since8, now: NOW }).tone, "warn");
});

test("ekran ve e-posta: özet satırı, saat metni, günlük e-postanın anahtarı ve maddesi", () => {
  const r = (o: Partial<{ source: "server" | "client" | "csp"; level: "error" | "warning"; lastSeen: Date; resolvedAt: Date | null }>) => ({
    source: "server" as const,
    level: "error" as const,
    lastSeen: NOW,
    resolvedAt: null,
    count: 1,
    ...o,
  });
  assert.deepEqual(errorSummary([], NOW), { text: "Açık hata yok" });
  assert.deepEqual(errorSummary([r({ resolvedAt: NOW })], NOW), { text: "Açık hata yok" });
  assert.deepEqual(errorSummary([r({}), r({ source: "client" })], NOW), { text: "Son 24 saatte bir sunucu / işlem hatası", tone: "bad" });
  assert.deepEqual(errorSummary([r({}), r({}), r({ source: "client" })], NOW), { text: "Son 24 saatte 2 farklı sunucu / işlem hatası", tone: "bad" });
  assert.deepEqual(errorSummary([r({ lastSeen: new Date(NOW.getTime() - 2 * 86_400_000) }), r({ source: "client" })], NOW), { text: "2 açık hata", tone: "warn" });
  assert.deepEqual(errorSummary([r({ source: "csp", level: "warning" })], NOW), { text: "1 açık uyarı (CSP)" });
  assert.equal(seenText(new Date("2026-11-27T08:05:00Z"), NOW), "bugün 11:05");
  assert.equal(seenText(new Date("2026-11-26T20:59:00Z"), NOW), "dün 23:59");
  assert.equal(seenText(new Date("2026-11-26T21:01:00Z"), NOW), "bugün 00:01", "İstanbul gece yarısı");
  assert.match(seenText(new Date("2026-11-20T08:05:00Z"), NOW), /^20 Kas 11:05$/);
  assert.equal(trDay(new Date("2026-11-26T21:30:00Z")), "2026-11-27");
  assert.equal(trDayStart(NOW).toISOString(), "2026-11-26T21:00:00.000Z");
  const item = alertItem(sanitizeEntry({ source: "server", message: "Bağlantı koptu\nikinci satır", path: "/panel/kasa/2026-11-01", route: "/panel/kasa/[gun]", digest: "42" }), NOW);
  assert.equal(item.key, alertKey("2026-11-27"));
  assert.equal(item.key, "hata-kaydi:2026-11-27");
  assert.equal(item.title, "Panelde hata: Bağlantı koptu");
  assert.match(item.body, /^Sunucu · \/panel\/kasa\/\[gun\] · 12:30 · hata kodu 42\. Bugün başka hata olursa ayrı e-posta gelmez/);
  // "Sınır doldu" satırı 30 gün durur: "bugün" değil gün; CSP büyük harfle
  assert.equal(overflowMessage("csp", "2026-11-27"), "Günlük sınır doldu (27 Kas): o gün 30 farklı CSP ihlalinden sonrakiler ayrı satır açmadı, yalnız sayıldı");
  assert.match(overflowMessage("server", "2026-11-01"), /^Günlük sınır doldu \(1 Kas\): o gün 50 farklı sunucu hatasından/);
});

test("kayıt isteği bozmaz: hazırlık, yazma ve takılan veritabanı dışarı hata çıkarmaz; kapalıysa hiç denenmez", async () => {
  const { recordError, reportError } = await import("../src/server/errors/store");
  const gate = createWriteGate({ perKeyMs: 0 });
  const throwing = { update: () => { throw new Error("veritabanı yok"); } } as unknown as import("../src/server/db").DB;
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.equal(await recordError({ source: "server", message: "x" }, { db: throwing, gate, alert: async () => assert.fail("e-posta denenmez") }), "error");
    assert.ok(errors.length === 1 && !JSON.stringify(errors).includes("params"), "yalnız tek satır günlük");
    // Takılan veritabanı: reportError en çok sınır kadar bekler
    const hanging = { update: () => ({ set: () => ({ where: () => ({ returning: () => new Promise(() => {}) }) }) }) } as unknown as import("../src/server/db").DB;
    const started = Date.now();
    assert.equal(await reportError({ source: "server", message: "y" }, { db: hanging, gate: createWriteGate({ perKeyMs: 0 }), timeoutMs: 50 }), "timeout");
    assert.ok(Date.now() - started < 1_000);
    // Girdi işlevi fırlatsa da
    assert.equal(await reportError(() => { throw new Error("girdi bozuk"); }, { db: throwing, gate }), "error");
    assert.equal(await reportError(() => null, { db: throwing, gate }), "skipped");
  } finally {
    console.error = orig;
  }
  // Kapatılmış kayıt (ERROR_LOG_DISABLED) veritabanına hiç gitmez
  process.env.ERROR_LOG_DISABLED = "1";
  try {
    assert.equal(await recordError({ source: "server", message: "z" }), "skipped");
  } finally {
    delete process.env.ERROR_LOG_DISABLED;
  }
});

test("hata kancası: yalnız Node.js ortamında, beklemeden; kayıt kapalıyken de Next'in akışını bozmaz", async () => {
  process.env.ERROR_LOG_DISABLED = "1";
  const prev = process.env.NEXT_RUNTIME;
  try {
    const { onRequestError } = await import("../src/instrumentation");
    const ctx = { routerKind: "App Router", routePath: "/panel", routeType: "render", renderSource: "server-rendering", revalidateReason: undefined, renderType: "dynamic" } as const;
    for (const runtime of ["nodejs", "edge", undefined]) {
      if (runtime) process.env.NEXT_RUNTIME = runtime;
      else delete process.env.NEXT_RUNTIME;
      await assert.doesNotReject(async () => onRequestError(new Error("x"), { path: "/panel?x=1", method: "GET", headers: { cookie: "a=b" } }, ctx));
    }
  } finally {
    if (prev === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = prev;
    delete process.env.ERROR_LOG_DISABLED;
  }
});

test("kapı kaynak başına: CSP yağmuru sunucu ve işlem hatasının payını tüketemez; bozuk satır kapıyı kapatmaz", async () => {
  const { recordError, resetErrorGates } = await import("../src/server/errors/store");
  const ok = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 1 }] }) }) }) } as unknown as import("../src/server/db").DB;
  const noAlert = async () => {};
  resetErrorGates();
  const outcomes: string[] = [];
  for (let i = 0; i < 40; i++) outcomes.push(await recordError({ source: "csp", name: "img-src", message: `img-src https://h${String.fromCharCode(97 + (i % 26))}${i >= 26 ? "x" : ""}.example` }, { db: ok, now: NOW }));
  assert.equal(outcomes.filter((o) => o === "updated").length, GATE_PER_MINUTE.csp);
  assert.equal(await recordError({ source: "server", message: "gerçek hata" }, { db: ok, now: NOW, alert: noAlert }), "updated", "sunucu hatası yine yazılır");
  assert.equal(await recordError({ source: "action", message: "işlem hatası" }, { db: ok, now: NOW, alert: noAlert }), "updated");
  resetErrorGates();
  // Satırın kendisi yazılamıyor (veri hatası, drizzle'ın sarmaladığı 22021): kapı açık kalır
  const orig = console.error;
  console.error = () => {};
  try {
    const bad = { update: () => { throw new DrizzleQueryError("update", [], Object.assign(new Error("invalid byte sequence"), { code: "22021" })); } } as unknown as import("../src/server/db").DB;
    const gate = createWriteGate({ perKeyMs: 0 });
    assert.equal(await recordError({ source: "server", message: "bozuk" }, { db: bad, now: NOW, gate, alert: noAlert }), "error");
    assert.equal(await recordError({ source: "server", message: "sonraki" }, { db: ok, now: NOW, gate, alert: noAlert }), "updated", "kapı açık");
    // Bağlantı düştü: o kaynağın kapısı bir dakika kapanır
    const down = { update: () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); } } as unknown as import("../src/server/db").DB;
    assert.equal(await recordError({ source: "server", message: "a" }, { db: down, now: NOW, gate, alert: noAlert }), "error");
    assert.equal(await recordError({ source: "server", message: "b" }, { db: ok, now: NOW, gate, alert: noAlert }), "throttled");
  } finally {
    console.error = orig;
  }
});

test("kritik hatanın e-postası yazımdan ayrı sınırlı: takılan e-posta kaydı en çok kendi süresi kadar bekletir", async () => {
  const { recordError } = await import("../src/server/errors/store");
  const ok = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 1 }] }) }) }) } as unknown as import("../src/server/db").DB;
  const started = Date.now();
  const outcome = await recordError({ source: "server", message: "x" }, { db: ok, now: NOW, gate: createWriteGate({ perKeyMs: 0 }), alert: () => new Promise(() => {}), alertTimeoutMs: 50 });
  assert.equal(outcome, "updated");
  assert.ok(Date.now() - started < 1_000);
});
