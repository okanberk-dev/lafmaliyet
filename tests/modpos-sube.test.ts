// ModPOS'un şube şube ayrılması (docs/MODPOS-API.md › Şubeler; src/lib/modpos/sube.ts): şube başına anahtar (Tuzla'nınkine
// düşülmez, ortak anahtar kullanılmaz), föyün kasaların şube adına göre ayrılması, sabah işinin şube şube sonuçlarının
// birleşmesi; rapor ↔ föy eşleşmesinin (şube, gün) olması (zil, Bugün, Kasa) ve ay rakamına yedekte öncelik ayıklamasının
// şube içinde kalması. Kaynak bekçileri: çekim şubenin anahtarı, hakkı, kirası ve günleriyle yürür.
// Çalıştırma: npx tsx --test tests/modpos-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { BranchRow } from "../src/lib/branches";
import { tillMonths, type TillRow } from "../src/lib/cash-month";
import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import { modposAnyKey, modposKeyFrom, modposKeyProblem } from "../src/lib/modpos/request";
import { modposCardSummary, modposStateKey, parseModposState } from "../src/lib/modpos/status";
import {
  combineModposResults,
  modposBranchIds,
  modposKeyEnv,
  parseModposSubeMap,
  resolveModposSube,
  splitFoyByBranch,
  splitNoticeText,
  subeKey,
} from "../src/lib/modpos/sube";
import { modposKeyAlert, modposMismatchBell, modposMismatchBranchDays, modposMismatchDates, modposMismatchDigestText, modposMismatches, modposPairKey } from "../src/lib/modpos/zil";
import { sheetCanonical } from "../src/lib/modpos/z";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const TUZLA_KEY = "sk_tuzla_0123456789abcdef";
const MARINA_KEY = "sk_marina_0123456789abcdef";

const BRANCHES: BranchRow[] = [
  { id: "tuzla", name: "Tuzla", kind: "fiziksel", posSource: "modpos", active: true, openedOn: null, sortOrder: 1 },
  { id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", active: true, openedOn: null, sortOrder: 2 },
  { id: "online", name: "laffogato.net", kind: "online", posSource: "yok", active: true, openedOn: null, sortOrder: 3 },
];

function fixture(name: string): KasaFoyu {
  const r = parseKasaFoyu(read(`tests/fixtures/modpos/${name}.xml`));
  assert.ok(r.ok, `${name} okunamadı`);
  return r.foy;
}

/** İki kasalı föy: KASA-1 Tuzla'nın, KASA-2 Marina'nın (marka anahtarı) */
function twoBranchFoy(): KasaFoyu {
  const f = fixture("iki-kasa");
  return {
    ...f,
    kasalar: [
      { ...f.kasalar[0], sube: "LAF FOGATO TUZLA" },
      { ...f.kasalar[1], sube: "Laffogato Marina Şb." },
    ],
    ekAlanlar: [
      { yol: "kasa.0.satis.yeniAlan", deger: "1" },
      { yol: "kasa.1.satis.yeniAlan", deger: "2" },
      { yol: "yeniKok", deger: "kök" },
    ],
  };
}

const resolve = (map = new Map<string, string>()) => (n: string) => resolveModposSube(n, BRANCHES, map);

// ---------------------------------------------------------------- Anahtar şubenindir

test("anahtar: Tuzla MODPOS_API_KEY, öteki şube MODPOS_API_KEY_<KİMLİK>; şubenin anahtarı yoksa Tuzla'nınkine düşülmez", () => {
  assert.equal(modposKeyEnv("tuzla"), "MODPOS_API_KEY");
  assert.equal(modposKeyEnv("marina"), "MODPOS_API_KEY_MARINA");
  assert.equal(modposKeyEnv("laffogato-marina"), "MODPOS_API_KEY_LAFFOGATO_MARINA");
  const env = { MODPOS_API_KEY: TUZLA_KEY };
  assert.equal(modposKeyProblem(env), null, "varsayılan Tuzla");
  assert.equal(modposKeyProblem(env, "tuzla"), null);
  assert.equal(modposKeyProblem(env, "marina"), "missing", "Marina Tuzla'nın anahtarını kullanmaz");
  assert.equal(modposKeyFrom(env, "marina"), null);
  const both = { MODPOS_API_KEY: TUZLA_KEY, MODPOS_API_KEY_MARINA: ` ${MARINA_KEY}\n` };
  assert.equal(modposKeyProblem(both, "marina", ["tuzla", "marina"]), null);
  assert.equal(modposKeyFrom(both, "marina"), MARINA_KEY);
  assert.equal(modposKeyFrom(both, "tuzla"), TUZLA_KEY);
  assert.equal(modposKeyProblem({ MODPOS_API_KEY_MARINA: "sk_kisa" }, "marina"), "format");
  // Tuzla'nın anahtarı yokken Marina'nınki tek başına çalışır
  assert.equal(modposKeyProblem({ MODPOS_API_KEY_MARINA: MARINA_KEY }, "marina", ["tuzla", "marina"]), null);
  assert.equal(modposKeyProblem({ MODPOS_API_KEY_MARINA: MARINA_KEY }, "tuzla"), "missing");
});

test("anahtar: başka şubeninkiyle aynı anahtar ortaktır (aynı föy iki şubeye yazılmasın); Tuzla'nınki hep geçerli", () => {
  const env = { MODPOS_API_KEY: TUZLA_KEY, MODPOS_API_KEY_MARINA: ` ${TUZLA_KEY} ` };
  assert.equal(modposKeyProblem(env, "marina", ["tuzla", "marina"]), "shared");
  assert.equal(modposKeyProblem(env, "marina"), "shared", "Tuzla'yla her zaman karşılaştırılır");
  assert.equal(modposKeyProblem(env, "tuzla", ["tuzla", "marina"]), null, "ilk sahibi kullanır");
  // Sırada önceki şube kazanır
  const three = { MODPOS_API_KEY_MARINA: MARINA_KEY, MODPOS_API_KEY_KADIKOY: MARINA_KEY };
  assert.equal(modposKeyProblem(three, "marina", ["tuzla", "marina", "kadikoy"]), null);
  assert.equal(modposKeyProblem(three, "kadikoy", ["tuzla", "marina", "kadikoy"]), "shared");
});

test("anahtar: herhangi bir şubenin anahtarı sabah işini başlatır; ModPOS şubeleri açık, fiziksel ve kasası ModPOS olanlar", () => {
  assert.equal(modposAnyKey({}), false);
  assert.equal(modposAnyKey({ MODPOS_API_KEY: "sk_kisa" }), false);
  assert.equal(modposAnyKey({ MODPOS_API_KEY_MARINA: MARINA_KEY }), true);
  assert.equal(modposAnyKey({ MODPOS_API_KEY: TUZLA_KEY }), true);
  assert.equal(modposAnyKey({ MODPOS_API_URL: "https://x.example/" }), false);
  assert.deepEqual(modposBranchIds(BRANCHES), ["tuzla", "marina"]);
  assert.deepEqual(modposBranchIds(BRANCHES.map((b) => (b.id === "marina" ? { ...b, posSource: "asilpos" as const } : b))), ["tuzla"]);
  assert.deepEqual(modposBranchIds(BRANCHES.map((b) => (b.id === "marina" ? { ...b, active: false } : b))), ["tuzla"]);
});

test("durum, kota ve kira şube başına: Tuzla eski anahtarda, öteki şube kendi anahtarında", () => {
  assert.equal(modposStateKey("tuzla"), "modpos");
  assert.equal(modposStateKey("marina"), "modpos:marina");
  const store = read("src/server/modpos/store.ts");
  assert.match(store, /return branchId === DEFAULT_BRANCH_ID \? MODPOS_LEASE_KEY : `\$\{MODPOS_LEASE_KEY\}:\$\{branchId\}`;/);
  assert.match(store, /\.where\(eq\(s\.integrationState\.key, modposStateKey\(branchId\)\)\)/);
  // Planlayıcının girdisi hep tek şube: başka şubenin günü bu şubenin "çekildi" günü sayılmaz
  const index = store.slice(store.indexOf("export async function loadModposIndex("), store.indexOf("export async function recentModposSheets("));
  assert.match(index, /\.where\(eq\(s\.modposCashSheets\.branchId, branchId\)\);/);
  assert.doesNotMatch(index, /subeKosulu|currentBranch/, "seçiciye bağlı değil");
  // Tek günün föyü hep tek şubenin: "Tümü"de rastgele şube dönmez
  const one = store.slice(store.indexOf("export async function loadModposSheet("), store.indexOf("export async function loadModposSheets("));
  assert.match(one, /eq\(s\.modposCashSheets\.branchId, await gunSubesi\(o\.branchId\)\)/);
});

test("kart: şubenin anahtar değişkeni metinlerde; ortak anahtar kırmızı, çekim kapalı", () => {
  const base = { now: new Date("2026-11-16T10:00:00+03:00"), preview: false, state: parseModposState({}), from: "2026-11-01", stored: { count: 0, first: null, last: null }, missing: 0 };
  const missing = modposCardSummary({ ...base, keyProblem: "missing", keyEnv: "MODPOS_API_KEY_MARINA" });
  assert.equal(missing.badge, "Kurulmadı");
  assert.match(missing.lines[0], /MODPOS_API_KEY_MARINA eklenip/);
  assert.match(modposCardSummary({ ...base, keyProblem: "format", keyEnv: "MODPOS_API_KEY_MARINA" }).headline, /^MODPOS_API_KEY_MARINA'in biçimi bozuk/);
  const shared = modposCardSummary({ ...base, keyProblem: "shared", keyEnv: "MODPOS_API_KEY_MARINA", sharedText: "aynı anahtar" });
  assert.deepEqual([shared.tone, shared.badge, shared.canFetch, shared.fetchBlocked, shared.lines], ["red", "Ortak anahtar", false, "Anahtar başka şubeyle ortak", ["aynı anahtar"]]);
  // Tuzla'nın metni değişmedi
  assert.match(modposCardSummary({ ...base, keyProblem: "missing" }).lines[0], /\(yalnız Production\) MODPOS_API_KEY eklenip/);
});

test("zil: anahtar uyarısı şubeyle (kimlik ve başlık); Tuzla'nın kimliği değişmedi", () => {
  const state = parseModposState({ lastError: { at: "2026-11-16T08:00:00+03:00", day: null, kod: "ANAHTAR_GECERSIZ", text: "geçersiz", keyError: true } });
  const tuzla = modposKeyAlert({ keyProblem: null, preview: false, state });
  assert.equal(tuzla?.id, "modpos-anahtar-ANAHTAR_GECERSIZ-0");
  assert.equal(tuzla?.title, "ModPOS API'den veri çekilemiyor");
  const marina = modposKeyAlert({ keyProblem: null, preview: false, state, branch: { id: "marina", name: "Marina" } });
  assert.equal(marina?.id, "modpos-anahtar-ANAHTAR_GECERSIZ-0-marina");
  assert.equal(marina?.title, "ModPOS API'den veri çekilemiyor (Marina)");
  const shared = modposKeyAlert({ keyProblem: "shared", preview: false, state: null, branch: { id: "marina", name: "Marina" }, sharedText: "ortak" });
  assert.deepEqual([shared?.id, shared?.body], ["modpos-anahtar-ortak-marina", "ortak"]);
  assert.equal(modposKeyAlert({ keyProblem: "shared", preview: true, state: null }), null, "önizleme susar");
  assert.match(modposKeyAlert({ keyProblem: "format", preview: false, state: null, keyEnv: "MODPOS_API_KEY_MARINA" })!.body, /^MODPOS_API_KEY_MARINA'in biçimi bozuk/);
});

// ---------------------------------------------------------------- Föyün içi şube şube

test("ad eşlemesi: Türkçe harfler ve noktalama düzleşir; adın içinde şubenin adı ya da kimliği; elle eşleme önce", () => {
  assert.equal(subeKey("LAF FOGATO TUZLA ŞB."), "laffogatotuzlasb");
  assert.equal(subeKey("Marina İskele"), "marinaiskele");
  const r = resolve();
  assert.equal(r("LAF FOGATO TUZLA"), "tuzla");
  assert.equal(r("Laffogato Marina Şb."), "marina");
  assert.equal(r("TUZLA"), "tuzla");
  assert.equal(r("Örnek Şube"), null, "bilinmeyen ad");
  assert.equal(r("Tuzla Marina"), null, "iki şube birden geçiyor: belirsiz");
  assert.equal(r("laffogato.net"), null, "online kanal kasası olmaz");
  assert.equal(r(""), null);
  const map = parseModposSubeMap({ MODPOS_SUBELER: "Sahil Şube=marina; Merkez = tuzla\nBozuk;=x;Yok=kadikoy" });
  assert.deepEqual([...map], [["sahilsube", "marina"], ["merkez", "tuzla"], ["yok", "kadikoy"]]);
  const m = resolve(map);
  assert.equal(m("SAHİL ŞUBE"), "marina");
  assert.equal(m("Merkez"), "tuzla");
  assert.equal(m("Yok"), null, "eşleme bilinmeyen şubeye: yazılmaz");
  // Elle eşleme addan önce
  assert.equal(resolve(parseModposSubeMap({ MODPOS_SUBELER: "LAF FOGATO TUZLA=marina" }))("LAF FOGATO TUZLA"), "marina");
});

test("tek şube adlı föy olduğu gibi çekenin şubesine (aynı nesne, parmak izi değişmez); bilinmeyen tek ad da", () => {
  const foy = fixture("iki-kasa");
  for (const own of ["tuzla", "marina"]) {
    const s = splitFoyByBranch(foy, { own, resolve: resolve() });
    assert.deepEqual([...s.parts.keys()], [own]);
    assert.equal(s.parts.get(own), foy);
    assert.deepEqual([s.unmatched, s.skipped], [[], []]);
  }
  // Adı bilinen tek şube de olduğu gibi kalır (Tuzla'nın anahtarı yalnız Tuzla'yı veriyor)
  const tuzlaOnly: KasaFoyu = { ...foy, kasalar: foy.kasalar.map((k) => ({ ...k, sube: "LAF FOGATO TUZLA" })) };
  assert.equal(splitFoyByBranch(tuzlaOnly, { own: "tuzla", resolve: resolve() }).parts.get("tuzla"), tuzlaOnly);
  // Boş föy (kasa açılmadı)
  const empty: KasaFoyu = { ...foy, kasalar: [], foysuzGunler: [] };
  assert.equal(splitFoyByBranch(empty, { own: "tuzla", resolve: resolve() }).parts.get("tuzla"), empty);
});

test("marka anahtarı: iki şubenin kasası ayrılır, her biri kendi föyünde; özet boş, tanınmayan alan kasasıyla", () => {
  const foy = twoBranchFoy();
  const s = splitFoyByBranch(foy, { own: "tuzla", resolve: resolve() });
  assert.deepEqual([...s.parts.keys()], ["tuzla", "marina"]);
  const t = s.parts.get("tuzla")!;
  const m = s.parts.get("marina")!;
  assert.deepEqual(t.kasalar.map((k) => k.kasaAdi), ["KASA-1"]);
  assert.deepEqual(m.kasalar.map((k) => k.kasaAdi), ["KASA-2"]);
  assert.equal(t.ozet, null, "ModPOS'un özeti iki şubenin toplamı: şubenin değil");
  assert.equal(m.ozet, null);
  assert.deepEqual(t.ekAlanlar, [{ yol: "kasa.0.satis.yeniAlan", deger: "1" }, { yol: "yeniKok", deger: "kök" }]);
  assert.deepEqual(m.ekAlanlar, [{ yol: "kasa.1.satis.yeniAlan", deger: "2" }]);
  assert.equal(t.kasaGunu, foy.kasaGunu);
  assert.deepEqual(m.kota, foy.kota);
  // Hiçbir kasa iki şubede birden yok, hiçbiri kaybolmadı
  assert.equal(t.kasalar.length + m.kasalar.length, foy.kasalar.length);
  // Marina'nın anahtarı çekse de aynı ayrım (çeken Marina): Tuzla'nın kasası Tuzla'ya
  const fromMarina = splitFoyByBranch(foy, { own: "marina", resolve: resolve() });
  assert.deepEqual([...fromMarina.parts.keys()], ["marina", "tuzla"]);
  // Çeken kim olursa olsun şubenin kasaları aynı (kök alanlar çekenin föyüne gider)
  const noRoot = (f: KasaFoyu) => sheetCanonical({ ...f, ekAlanlar: (f.ekAlanlar ?? []).filter((e) => e.yol.startsWith("kasa.")) });
  assert.equal(noRoot(fromMarina.parts.get("tuzla")!), noRoot(t));
  assert.deepEqual(fromMarina.parts.get("marina")!.ekAlanlar, [{ yol: "kasa.1.satis.yeniAlan", deger: "2" }, { yol: "yeniKok", deger: "kök" }]);
});

test("kendi anahtarı olan şubenin kasası başka anahtarın föyünden alınmaz; çekenin föyü kasasız da olsa yazılır", () => {
  const foy = twoBranchFoy();
  const s = splitFoyByBranch(foy, { own: "tuzla", resolve: resolve(), keyed: new Set(["tuzla", "marina"]) });
  assert.deepEqual([...s.parts.keys()], ["tuzla"]);
  assert.deepEqual(s.parts.get("tuzla")!.kasalar.map((k) => k.kasaAdi), ["KASA-1"]);
  assert.deepEqual(s.skipped, ["marina"]);
  // Tuzla'nın anahtarı yalnız Marina'nın kasasını verdiyse: Tuzla'nın günü boş föy, Marina'nınki dolu
  const onlyMarina: KasaFoyu = { ...foy, kasalar: [foy.kasalar[1]], ekAlanlar: [] };
  const s2 = splitFoyByBranch(onlyMarina, { own: "tuzla", resolve: resolve() });
  assert.deepEqual([...s2.parts.keys()], ["tuzla", "marina"]);
  assert.deepEqual(s2.parts.get("tuzla")!.kasalar, []);
  assert.equal(s2.parts.get("marina")!.kasalar.length, 1);
});

test("çok adlı föyde bağlanamayan şube hiçbir şubeye yazılmaz (yanlış şubeye yazmaktansa), uyarısı çalışmaya", () => {
  const foy = twoBranchFoy();
  const odd: KasaFoyu = { ...foy, kasalar: [foy.kasalar[0], { ...foy.kasalar[1], sube: "Sahil Şube" }] };
  const s = splitFoyByBranch(odd, { own: "tuzla", resolve: resolve() });
  assert.deepEqual([...s.parts.keys()], ["tuzla"]);
  assert.deepEqual(s.parts.get("tuzla")!.kasalar.map((k) => k.kasaAdi), ["KASA-1"], "Sahil'in kasası Tuzla'ya girmedi");
  assert.deepEqual(s.unmatched, ["Sahil Şube"]);
  assert.match(splitNoticeText(s)!, /"Sahil Şube" şubesi panelde bir şubeyle eşleşmedi, kasası hiçbir şubeye yazılmadı: Vercel'de MODPOS_SUBELER'e/);
  assert.equal(splitNoticeText({ unmatched: [] }), null);
  // Elle eşlemeyle Marina'ya
  const mapped = splitFoyByBranch(odd, { own: "tuzla", resolve: resolve(parseModposSubeMap({ MODPOS_SUBELER: "Sahil Şube=marina" })) });
  assert.deepEqual([...mapped.parts.keys()], ["tuzla", "marina"]);
  assert.deepEqual(mapped.unmatched, []);
});

test("föysüz satış (kasası açılmamış şube) da şubesine gider", () => {
  const foy = fixture("foysuz-gun");
  const two: KasaFoyu = {
    ...foy,
    kasalar: foy.kasalar.map((k) => ({ ...k, sube: "LAF FOGATO TUZLA" })),
    foysuzGunler: foy.foysuzGunler.map((f) => ({ ...f, sube: "LAF FOGATO MARINA" })),
  };
  const s = splitFoyByBranch(two, { own: "tuzla", resolve: resolve() });
  assert.deepEqual(s.parts.get("tuzla")!.foysuzGunler, []);
  assert.equal(s.parts.get("marina")!.foysuzGunler.length, foy.foysuzGunler.length);
  assert.deepEqual(s.parts.get("marina")!.kasalar, []);
});

// ---------------------------------------------------------------- Sabah işinin birleşik sonucu

test("sabah işi: şube şube sonuçlar tek adım; bir şubenin hatası ötekini durdurmaz", () => {
  type R = Parameters<typeof combineModposResults<string>>[0][number];
  const run = (branchId: string, status: R["result"]["status"], o: Partial<R["result"]> = {}): R => ({
    branchId,
    name: branchId === "tuzla" ? "Tuzla" : "Marina",
    result: { status, days: [], left: null, ...o },
  });
  assert.deepEqual(combineModposResults([]), { status: "off", days: [], left: null });
  assert.equal(combineModposResults([run("tuzla", "preview")]).status, "preview");
  assert.deepEqual(combineModposResults([run("tuzla", "ok", { days: ["t"], left: 0 }), run("marina", "ok", { days: ["m"], left: 1 })]), { status: "ok", days: ["t", "m"], left: 0 });
  const mixed = combineModposResults([run("tuzla", "ok", { left: 1 }), run("marina", "error", { error: "anahtar geçersiz" })]);
  assert.deepEqual([mixed.status, mixed.error], ["partial", "Marina: anahtar geçersiz"]);
  assert.equal(combineModposResults([run("tuzla", "error", { error: "a" }), run("marina", "error", { error: "b" })]).error, "Tuzla: a · Marina: b");
  assert.equal(combineModposResults([run("tuzla", "error", { error: "a" }), run("marina", "error", { error: "b" })]).status, "error");
  assert.equal(combineModposResults([run("tuzla", "kota"), run("marina", "nothing")]).status, "kota");
  assert.equal(combineModposResults([run("tuzla", "nothing"), run("marina", "busy")]).status, "busy");
  assert.equal(combineModposResults([run("tuzla", "off"), run("marina", "ok", { left: 1 })]).left, 1);
  // Tek şubede hata metni şubesiz (bugünkü gibi)
  assert.equal(combineModposResults([run("tuzla", "error", { error: "a" })]).error, "a");
});

test("kaynak: çekim şubenin anahtarı, hakkı, kirası ve günleriyle; föy ayrılıp her parça kendi şubesine", () => {
  const sync = read("src/server/modpos/sync.ts");
  assert.match(sync, /const lease = await takeModposLease\(db, undefined, branchId\);/);
  assert.match(sync, /await releaseModposLease\(db, lease, branchId\);/);
  assert.match(sync, /readModposState\(db, branchId\),\n\s+loadModposIndex\(db, branchId\),/);
  // AsilPOS'a geçiş günü yalnız AsilPOS'un şubesinin föyünü keser (denetim 21 Kasım #5): Marina'nın föyü çekilmeye devam eder
  assert.match(sync, /loadBranchSwitchDay\(branchId, db\),/);
  assert.match(sync, /planFoyDays\(\{ now, from, have, left, until: switchDay, failed \}\)/);
  assert.match(sync, /fetchKasaFoyu\(day, \{ now, timeoutMs: remaining - 1_000, fetchImpl: o\.fetchImpl, env, branchId \}\)/);
  assert.match(sync, /const split = splitFoyByBranch\(r\.foy, \{ own: branchId, resolve, keyed, modposIds: new Set\(b\.peers\) \}\);/);
  assert.match(sync, /const stored = await storeFoy\(db, split\.parts\.get\(branchId\)!, now, r\.raw, branchId\);/);
  assert.match(sync, /for \(const \[id, part\] of split\.parts\) if \(id !== branchId\) await storeFoy\(db, part, now, null, id\);/);
  assert.match(sync, /if \(modposKeyProblem\(env, branchId, peers\) === "shared"\) \{/);
  assert.match(sync, /noteModposRun\(db, \{ lastCronAt: started\.toISOString\(\) \}, null, undefined, branchId\)/);
  assert.match(sync, /run, dayResults, branchId\);/);
  // Sabah işi: anahtarı olmayan şube atlanır, bir şubenin istisnası ötekini durdurmaz
  const all = sync.slice(sync.indexOf("export async function syncModposAll("));
  assert.match(all, /for \(const id of modposBranchIds\(branches\)\) \{\s+if \(modposKeyProblem\(env, id\) === "missing"\) continue;/);
  assert.match(all, /\.catch\(\s*\(e: Error\): ModposSyncResult => \(\{ status: "error", days: \[\], left: null, error: e\.message \}\),\s*\);/);
  // İstemci şubenin anahtarını gönderir
  const client = read("src/server/modpos/client.ts");
  assert.match(client, /const key = modposKeyFrom\(env, branchId\)!;/);
});

// ---------------------------------------------------------------- Rapor ↔ föy: (şube, gün)

function sample(day: string): KasaFoyu {
  return { ...fixture("belge-ornegi"), kasaGunu: day };
}
const sameReport = (date: string, branchId?: string) => ({
  date,
  revision: 1,
  ...(branchId ? { branchId } : {}),
  zNo: "312",
  receipts: 214,
  zTotal: 28450.5,
  cash: 8210,
  card: 16120.5,
  mealCard: 0,
  online: 0,
  other: 0,
  offRevenue: 145,
  openingCash: 500,
  cashIn: 0,
  cashOut: 0,
  countedCash: 7820,
  discounts: null,
});

test("rapor yalnız kendi şubesinin föyüyle karşılaştırılır: Marina'nın raporu Tuzla'nın föyüyle 'farklı' çıkmaz", () => {
  const day = "2026-11-01";
  const tuzla = { day, branchId: "tuzla", foy: sample(day), revision: 1 };
  // Marina'nın aynı günkü raporu bambaşka rakamlarla; Marina'nın föyü yok
  const marina = { ...sameReport(day, "marina"), zTotal: 5000, cash: 5000, card: 0, receipts: 20 };
  assert.deepEqual(modposMismatches([marina], [tuzla], {}), [], "Tuzla'nın föyü Marina'nın raporuna uygulanmaz");
  // Tuzla'nın raporu kendi föyüyle aynı; şubesiz eski rapor Tuzla'nındır
  assert.deepEqual(modposMismatches([sameReport(day, "tuzla"), sameReport(day)], [tuzla], {}), []);
  // Marina'nın föyü gelince Marina'nın raporu onunla karşılaştırılır
  const marinaSheet = { day, branchId: "marina", foy: sample(day), revision: 1 };
  const m = modposMismatches([marina, sameReport(day, "tuzla")], [tuzla, marinaSheet], {});
  assert.equal(m.length, 1);
  assert.equal(m[0].report.branchId, "marina");
  assert.equal(m[0].sheet, marinaSheet);
  assert.deepEqual([...modposMismatchDates([marina], [tuzla, marinaSheet], {})], [day]);
  // Bugün'ün şube şube işaretleri (şube, gün) anahtarıyla
  assert.deepEqual([...modposMismatchBranchDays([marina, sameReport(day, "tuzla")], [tuzla, marinaSheet], {})], [`marina:${day}`]);
  // Sabah e-postası: birden çok kasada şubenin adıyla, verilmezse bugünkü metin
  assert.match(modposMismatchDigestText(day, m[0].diffs, "Marina"), /^Kasa raporu ModPOS API'den farklı \(Marina\)\. 1\sKasım · /);
  assert.match(modposMismatchDigestText(day, m[0].diffs), /^Kasa raporu ModPOS API'den farklı\. 1\sKasım · /);
  assert.equal(modposPairKey(undefined, day), "tuzla|2026-11-01");
  assert.equal(modposPairKey("marina", day), "marina|2026-11-01");
});

test("AsilPOS'a geçiş günü yalnız Marina'nın kasasını keser: Tuzla'nın raporu föyüyle karşılaştırılmaya devam eder (21 Kasım kararı)", () => {
  const day = "2026-12-02";
  const switchDay = "2026-12-01";
  const marinaSheet = { day, branchId: "marina", foy: sample(day), revision: 1 };
  const tuzlaSheet = { day, branchId: "tuzla", foy: sample(day), revision: 1 };
  const marina = { ...sameReport(day, "marina"), cash: 8190 };
  const tuzla = { ...sameReport(day, "tuzla"), cash: 8190 };
  const branchless = { ...sameReport(day), cash: 8190 };
  // Tuzla ModPOS'ta: farkı görünür (şubesiz eski rapor da Tuzla'nındır, Tuzla'nın föyüyle); Marina AsilPOS'ta: atlanır
  const m = modposMismatches([marina, tuzla, branchless], [marinaSheet, tuzlaSheet], { marina: switchDay });
  assert.deepEqual(
    m.map((x) => x.report.branchId ?? null),
    ["tuzla", null],
  );
  assert.equal(m[1].sheet, tuzlaSheet, "şubesiz rapor Tuzla'nın föyüyle");
  assert.deepEqual([...modposMismatchBranchDays([marina, tuzla], [marinaSheet, tuzlaSheet], { marina: switchDay })], [`tuzla:${day}`]);
  // Geçiş gününden önce ikisi de karşılaştırılır
  const before = "2026-11-30";
  const sheets = [
    { day: before, branchId: "marina", foy: sample(before), revision: 1 },
    { day: before, branchId: "tuzla", foy: sample(before), revision: 1 },
  ];
  assert.equal(modposMismatches([{ ...marina, date: before }, { ...tuzla, date: before }], sheets, { marina: switchDay }).length, 2);
});

test("zilin satırı: Tuzla'nın kimliği ve adresi değişmedi; öteki şubenin kimliğinde ve adresinde şube", () => {
  const day = "2026-11-01";
  const sheet = { day, foy: sample(day), revision: 2 };
  const diffs = modposMismatches([{ ...sameReport(day, "marina"), cash: 8190 }], [{ ...sheet, branchId: "marina" }], {})[0];
  const bell = modposMismatchBell(diffs, "Marina");
  assert.equal(bell.id, "kasa-modpos-2026-11-01-marina-r1-s2");
  assert.equal(bell.href, "/panel/kasa?gun=2026-11-01&sube=marina");
  assert.match(bell.body, /^Marina · 1 Kasım/);
  const t = modposMismatches([{ ...sameReport(day, "tuzla"), cash: 8190 }], [{ ...sheet, branchId: "tuzla" }], {})[0];
  assert.deepEqual([modposMismatchBell(t).id, modposMismatchBell(t).href], ["kasa-modpos-2026-11-01-r1-s2", "/panel/kasa?gun=2026-11-01"]);
});

test("kaynak: Kasa ekranı föyü ekrandaki raporun şubesinden; günden güne liste (şube, gün) ile", () => {
  const day = read("src/server/data/modpos-day.ts");
  assert.match(day, /return withZ\(await loadModposSheet\(date, db, \{ raw: true, branchId: sube \}\)\);/);
  assert.match(day, /out\.set\(modposPairKey\(sheet\.branchId, sheet\.day\), withZ\(sheet\)\);/);
  assert.match(day, /const b = branchId \?\? sube;/);
  assert.match(day, /out\.get\(modposPairKey\(b, date\)\)/);
  // Geçiş günü günün kasasının şubesine göre (denetim 21 Kasım #5): Marina'nın föyü geçiş gününden sonra da okunur
  assert.match(day, /if \(isAsilposDay\(date, switchDayFor\(switchDays, sube\)\)\) return NO_MODPOS;/);
  assert.match(day, /return isAsilposDay\(date, switchDayFor\(switchDays, b\)\) \? NO_MODPOS/);
  assert.match(day, /for \(const sheet of await loadModposSheets\(from, to, db\)\)/, "aralık geçiş gününe kırpılmaz");
  // Raporun DTO'su şubesini taşır
  assert.match(read("src/server/data/cash-reports.ts"), /id: r\.id,\n\s+branchId: r\.branchId,/);
});

// ---------------------------------------------------------------- Ay rakamına yedek: öncelik şube içinde

test("ay rakamına yedek: Tuzla'nın raporu Marina'nın aynı günkü föyünü düşürmez; şubesiz satırlar bugünkü gibi", () => {
  const r = (date: string, o: Partial<TillRow> = {}): TillRow => ({ date, zTotal: 10_000, card: 5_000, mealCard: 0, discounts: null, offRevenue: 0, ...o });
  const rows: TillRow[] = [
    r("2026-11-01", { branchId: "tuzla" }),
    r("2026-11-02", { branchId: "tuzla" }),
    r("2026-11-01", { branchId: "marina", zTotal: 4_000, source: "modpos" }),
    r("2026-11-02", { branchId: "marina", zTotal: 3_000, source: "modpos" }),
    // Tuzla'nın kendi föyü raporuna yenilir
    r("2026-11-02", { branchId: "tuzla", zTotal: 99_999, source: "modpos" }),
  ];
  const [m] = tillMonths(rows, "2026-11-02", "2026-11-01", undefined, undefined, "2026-11-01");
  assert.equal(m.posRevenue, 27_000, "iki Tuzla raporu + Marina'nın iki föyü; Tuzla'nın föyü sayılmaz");
  // Şubesiz (eski) satırlarda aynı gün tek anahtar: rapor kazanır
  const [old] = tillMonths(
    [r("2026-11-01"), r("2026-11-01", { zTotal: 4_000, source: "modpos" })],
    "2026-11-01",
    "2026-11-01",
    undefined,
    undefined,
    "2026-11-01",
  );
  assert.equal(old.posRevenue, 10_000);
});
