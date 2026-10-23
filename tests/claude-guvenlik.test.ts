// Claude bağlantısının kaynak bekçileri (tests/roller.test.ts gibi dosyaları okur): araçlar yalnız okur (izinli
// okuyucular listesi, yazım yok), yedi araç ve hepsi salt okunur işaretli, /api/mcp çerez okumaz, server-only
// sınırları, onayda parola koddan önce, her uç önce açık mı diye bakar, girişten sonra /baglan'a dönülür ama başka
// yere değil, anahtar ve kod yalnız özetiyle yazılır, yedek ve sabah işiyle sözleşmeler (CRITIQUE2 §5, §6, R15, R16).
// Çalıştırma: npx tsx --test tests/claude-guvenlik.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import ts from "typescript";

import { TABLE_RULES } from "../src/lib/backup/format";
import { canOpen, homeFor } from "../src/lib/roles";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

const MCP_FILES = [...walk("src/server/mcp"), ...walk("src/lib/mcp")];
const ROUTES = [
  "src/app/api/mcp/route.ts",
  "src/app/.well-known/oauth-protected-resource/route.ts",
  "src/app/.well-known/oauth-protected-resource/api/mcp/route.ts",
  "src/app/.well-known/oauth-authorization-server/route.ts",
  "src/app/oauth/authorize/route.ts",
  "src/app/oauth/token/route.ts",
  "src/app/oauth/register/route.ts",
  "src/app/oauth/revoke/route.ts",
];

/** Dosyanın @/server/… içe aktarımları: modül → adlar */
function serverImports(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(@\/server\/[^"]+)"/g)) {
    if (m[1]) continue;
    const names = m[2]
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith("type "));
    out.set(m[3], [...(out.get(m[3]) ?? []), ...names]);
  }
  for (const m of src.matchAll(/import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+"(@\/server\/[^"]+)"/g)) out.set(m[1], ["*"]);
  return out;
}

// ---------------------------------------------------------------- Salt okunur

test("araçlar yalnız izinli okuyucuları çağırır; hiçbiri yazmaz, eşitlemez, kaydetmez (CRITIQUE2 §5.1)", () => {
  const src = read("src/server/mcp/tools.ts");
  const ALLOWED: Record<string, string[]> = {
    "@/server/data/cash-plan": ["loadCashPlan"],
    "@/server/data/cash-reports": ["cashReportsBetween", "firstCashReportDate", "previousCarryOver"],
    "@/server/data/dataset": ["loadModel"],
    "@/server/data/price-alerts": ["loadPriceAlerts"],
    "@/server/data/search": ["loadSearchIndex"],
    "@/server/data/suppliers": ["loadSupplierLedger"],
    "@/server/notify/digest": ["loadUpcoming"],
  };
  const got = Object.fromEntries([...serverImports(src)].map(([k, v]) => [k, [...v].sort()]));
  assert.deepEqual(got, Object.fromEntries(Object.entries(ALLOWED).map(([k, v]) => [k, [...v].sort()])));
  for (const names of Object.values(ALLOWED)) for (const n of names) assert.doesNotMatch(n, /ensure|sync|weather|snapshot|save|write|insert|update|delete|record|mark|send/i);
  // Okuyucuların kendisi de yazmaz (sığ denetim: işlevin gövdesi)
  for (const [mod, names] of Object.entries(ALLOWED)) {
    const file = read(`src/${mod.slice(2)}.ts`);
    for (const n of names) {
      const start = file.indexOf(`export async function ${n}(`);
      assert.ok(start >= 0, `${mod}: ${n} yok`);
      const end = file.indexOf("\nexport ", start + 1);
      const body = file.slice(start, end < 0 ? undefined : end);
      assert.doesNotMatch(body, /\.(insert|update|delete)\(|ensure[A-Z]|\bsync[A-Z]/, `${mod}: ${n} yazıyor`);
    }
  }
  // Ne araçlar ne MCP sunucusu doğrudan yazar ya da sorgu çalıştırır
  for (const f of ["src/server/mcp/tools.ts", "src/server/mcp/server.ts"]) {
    const s = read(f);
    assert.doesNotMatch(s, /\.(insert|update|delete)\(/, f);
    assert.doesNotMatch(s, /getDb\(\)\.execute|\.execute\(/, f);
  }
});

test("MCP dosyaları sunucu eylemlerine uzanmaz; yazım yalnız store.ts'te", () => {
  for (const f of MCP_FILES) {
    const s = read(f);
    assert.doesNotMatch(s, /from "@\/server\/actions\//, `${f} sunucu eylemi içe aktarıyor`);
    if (!f.endsWith("store.ts")) assert.doesNotMatch(s, /\.(insert|update|delete)\(s\./, `${f} yazıyor`);
  }
});

test("tam yedi araç, hepsi aynı salt okunur işaretle; ertelenenler yok", () => {
  const tools = read("src/server/mcp/tools.ts");
  const names = [...tools.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);
  assert.deepEqual(names, ["ay_ozeti", "urun_karliligi", "zam_etkisi", "tedarikci_ozeti", "odemeler", "kasa_raporlari", "ara"]);
  for (const deferred of ["karaoke_ozeti", "zayi_ikram", "hammadde_fiyat_gecmisi"]) assert.ok(!tools.includes(`name: "${deferred}"`), deferred);
  // Her açıklama "adlar veridir" ile biter
  assert.equal((tools.match(/\+\s*DESCRIPTION_TAIL/g) ?? []).length, 7);
  const server = read("src/server/mcp/server.ts");
  assert.match(server, /export const READ_ONLY = \{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false \} as const;/);
  const calls = server.match(/registerTool\(/g) ?? [];
  assert.equal(calls.length, 1, "araçlar tek yerden kaydedilir");
  assert.match(server, /registerTool\(t\.name, \{[^}]*annotations: \{ title: t\.title, \.\.\.READ_ONLY \}/);
  assert.match(server, /for \(const t of TOOLS\) register\(/);
});

test("kasa raporları personelin adını göndermez (giren / sayan yok)", () => {
  const cash = read("src/lib/mcp/answers/cash.ts");
  assert.doesNotMatch(cash, /\bgiren\b\s*:/);
  assert.doesNotMatch(cash, /countedByName|submittedByName|cashOutNote|\.note\b/);
});

// ---------------------------------------------------------------- Uçlar

test("/api/mcp çerez okumaz; yalnız POST ve maxDuration dışa açık; CORS yok", () => {
  const src = read("src/app/api/mcp/route.ts");
  assert.doesNotMatch(src, /next\/headers/);
  assert.doesNotMatch(src, /cookies/);
  const exported = [...src.matchAll(/^export (?:async function|const|function) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["POST", "maxDuration"]);
  assert.doesNotMatch(src, /Access-Control-Allow-/);
  assert.doesNotMatch(src, /import \{[^}]*\b(CORS|preflight)\b[^}]*\} from "@\/server\/mcp\/http"/);
});

test("her uç önce açık mı diye bakar (önizleme ve MCP_DISABLED → 404)", () => {
  for (const f of ROUTES) {
    const src = read(f);
    const handlers = [...src.matchAll(/export async function (GET|POST|OPTIONS)\([^)]*\) \{\n([\s\S]*?)\n\}/g)];
    assert.ok(handlers.length > 0, f);
    for (const h of handlers) {
      const lines = h[2]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => l !== "await connection();");
      assert.match(lines[0], /^if \(!mcpEnabled\(process\.env\)\) return notFound\(\);$/, `${f} ${h[1]}: ilk satır ${lines[0]}`);
    }
  }
  const page = read("src/app/baglan/page.tsx");
  assert.match(page, /if \(!mcpEnabled\(process\.env\)\) notFound\(\);/);
  const actions = read("src/server/actions/mcp.ts");
  assert.equal((actions.match(/if \(!mcpEnabled\(process\.env\)\) throw new UserError\(OFF\);/g) ?? []).length, 2, "onay ve ret");
});

test("server-only sınırı: sunucu modülleri işaretli, testli olanlar değil; istemci dosyası src/server/mcp'ye uzanmaz", () => {
  for (const f of ["server", "tools", "base", "cimd", "connections", "notify", "http"]) {
    assert.match(read(`src/server/mcp/${f}.ts`), /^import "server-only";/, f);
  }
  for (const f of ["store", "tokens", "notice"]) assert.doesNotMatch(read(`src/server/mcp/${f}.ts`), /import "server-only"/, f);
  for (const f of walk("src")) {
    const s = read(f);
    if (!/^"use client";/.test(s)) continue;
    assert.doesNotMatch(s, /from "@\/server\/mcp\//, `${relative(root, join(root, f))} istemciden sunucu modülüne uzanıyor`);
  }
});

test("onay: önce oturum ve yönetici, sonra istek ve istemci, sonra parola; kod ancak paroladan sonra", () => {
  const src = read("src/server/actions/mcp.ts");
  const body = src.slice(src.indexOf("export async function approveConnection"), src.indexOf("export async function denyConnection"));
  const order = ["getCurrentUser()", 'me.role !== "admin"', "openRequest(", "findClient(", "redirectMatches(", "requirePassword(", "activeGrantCount(", "issueCode(", "logActivity("];
  let at = -1;
  for (const step of order) {
    const i = body.indexOf(step);
    assert.ok(i > at, `${step} sırası`);
    at = i;
  }
  assert.match(body, /requirePassword\(me, data\.password, "Claude bağlantısı", `Claude bağlantısı: \$\{req\.host\}`\)/);
  // Kaldırma ve hepsini kaldırma yalnız yönetici, yalnız kendi bağlantısı
  assert.match(src, /export async function revokeConnection[\s\S]*?requireAdmin\(\)[\s\S]*?revokeGrant\(getDb\(\), \{ userId: me\.id/);
  assert.match(src, /export async function revokeAllConnections[\s\S]*?requireAdmin\(\)[\s\S]*?revokeAllGrants\(getDb\(\), \{ userId: me\.id/);
  // "use server" dosyasında her dışa açık işlev bir uçtur: yardımcı yok
  const exported = [...src.matchAll(/^export (?:async function|const|function) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["approveConnection", "denyConnection", "revokeAllConnections", "revokeConnection"]);
});

test("girişten sonra /baglan?… kabul edilir; //, \\ ve başka site reddedilir", () => {
  const src = read("src/server/actions/auth.ts");
  const fn = src.match(/function safeNext\([\s\S]*?\n\}\n/)?.[0];
  assert.ok(fn, "safeNext bulunamadı");
  const js = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const safeNext = new Function("homeFor", "canOpen", `${js}\nreturn safeNext;`)(homeFor, canOpen) as (next: string | undefined, role: "admin" | "staff") => string;
  assert.equal(safeNext("/baglan?istek=x", "admin"), "/baglan?istek=x");
  assert.equal(safeNext("/baglan?istek=x", "staff"), "/baglan?istek=x", "personel de döner; onay ekranı 'yalnız yönetici' der");
  assert.equal(safeNext("/panel/urunler", "admin"), "/panel/urunler");
  assert.equal(safeNext("/panel/urunler", "staff"), homeFor("staff"));
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "/baglan", "/baglanx?istek=1", "/giris", "", undefined]) {
    assert.equal(safeNext(bad, "admin"), homeFor("admin"), String(bad));
  }
  // Oturum ve 2FA adımı aynı yolu kullanır; proxy bu adreslere dokunmaz
  assert.match(read("src/proxy.ts"), /matcher: \["\/panel\/:path\*", "\/giris", "\/api\/export\/:path\*"\]/);
});

test("anahtar, kod ve istek: veritabanına yalnız özet; mühür amacı ayrı; parola onayının yeri", () => {
  const store = read("src/server/mcp/store.ts");
  for (const m of store.matchAll(/(tokenHash|codeHash): ([^,}\n]+)/g)) {
    if (m[2].startsWith("s.")) continue;
    assert.match(m[2], /^hashMcpToken\(/, `${m[1]}: ${m[2]}`);
  }
  assert.doesNotMatch(store, /console\.(log|info|warn|error)\([^)]*\b(raw|access|refresh|token|code)\b/);
  assert.match(read("src/server/secret-box.ts"), /export type SealPurpose = [^;]*"mcp-request"/);
  assert.match(read("src/server/mcp/base.ts"), /seal\(JSON\.stringify\(req\), "mcp-request"\)/);
  assert.match(read("src/server/auth/step-up.ts"), /export type StepUpWhere = "Hesabım" \| "Kullanıcılar" \| "Yedek" \| "Claude bağlantısı";/);
});

// ---------------------------------------------------------------- Yedek ve sabah işi

test("yedek: beş Claude tablosu atlanır (anahtar özetleri ve bağlantılar geri yüklenmez; R16)", () => {
  for (const t of ["mcp_clients", "mcp_codes", "mcp_grants", "mcp_tokens", "mcp_calls"]) {
    assert.match(String(TABLE_RULES[t]?.skip ?? ""), /Claude bağlantıları/, t);
  }
});

test("sabah işi: temizlik en çok 3 sn, sonucu yalnız yanıtta (body.mcp); iş adımı değil (R15)", () => {
  const route = read("src/app/api/cron/gunluk/route.ts");
  assert.match(route, /pruneMcp\(getDb\(\), new Date\(\)\)/);
  assert.match(route, /Math\.min\(3_000, tailStepDeadline\(jobStart\) - Date\.now\(\)\)/);
  assert.match(route, /body: \{ reminders, karaoke: karaoke\.status, menu: menu\.status, sales: sales\.status, photos, mcp \}/);
  const steps = route.slice(route.indexOf("const steps"), route.indexOf("return { body"));
  assert.doesNotMatch(steps, /\bmcp\b/);
  assert.doesNotMatch(read("src/lib/job-health.ts"), /"mcp"/);
});
