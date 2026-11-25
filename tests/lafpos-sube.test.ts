// LafPOS'un şubesi kütükten (şube kapsamı B6; docs/LAFPOS.md › Şubeler) ve Ayarlar'ın kasa kartları seçili şubeye göre
// (C P2-2; docs/SUBE.md › Ayarlar'da kasa kartları):
// - saf kural: kasa kaynağı LafPOS olan etkin fiziksel şube, yoksa geri düşüş Marina (bugünkü veride davranış aynı);
// - yardımcılar türetilmiş şubeyi alır, verilmezse sabite düşer;
// - kaynak: sunucu ve sayfalar sabiti doğrudan kullanmaz; geçiş gününü şubeye uygulayan her çağrı LafPOS'un şubesini
//   verir; şube eylemleri ikinci LafPOS şubesini reddeder ve önbelleği düşürür;
// - kart görünümü: tek şubede o şubenin kasası, kullanmayan şubede "Bu şubede kullanılmıyor", "Tümü"de şube adıyla.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, type BranchRow } from "../src/lib/branches";
import { panelWasteCounts } from "../src/lib/lafpos/ikram";
import { lafposSalesCountFrom, mergeSalesSources } from "../src/lib/lafpos/sales";
import { branchSwitchDay, isLafposBranch, LAFPOS_BRANCH_ID, lafposBranchOf, lafposSourceError, scopeSwitchDay } from "../src/lib/lafpos/switch";
import { lafposCardView, modposCardView, POS_ELSEWHERE, posElsewhereText } from "../src/lib/pos-cards";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const b = (id: string, name: string, o: Partial<BranchRow> = {}): BranchRow => ({ id, name, kind: "fiziksel", posSource: "modpos", active: true, openedOn: null, sortOrder: 1, ...o });
const TUZLA = b("tuzla", "Tuzla", { sortOrder: 1 });
const MARINA = b("marina", "Marina", { sortOrder: 2 });
const ONLINE = b("online", "laffogato.net", { kind: "online", posSource: "yok", sortOrder: 3 });
const S = "2026-12-01";

test("saf kural: LafPOS'un şubesi kasa kaynağı LafPOS olan etkin fiziksel şube, yoksa Marina", () => {
  assert.equal(LAFPOS_BRANCH_ID, "marina", "geri düşüş değeri değişmez");
  // Bugünkü veri: Marina'nın kaynağı ModPOS (föyün yedek çekimi) ya da LafPOS; ikisinde de Marina
  assert.equal(lafposBranchOf([TUZLA, MARINA, ONLINE]), "marina");
  assert.equal(lafposBranchOf([TUZLA, { ...MARINA, posSource: "lafpos" }, ONLINE]), "marina");
  assert.equal(lafposBranchOf([]), "marina", "kütük okunamadıysa ya da boşsa");
  assert.equal(lafposBranchOf([TUZLA]), "marina", "tek şubeli eski kurulum: bugünkü gibi");
  // Kaynak başka şubeye geçince o şube
  assert.equal(lafposBranchOf([{ ...TUZLA, posSource: "lafpos" }, MARINA, ONLINE]), "tuzla");
  assert.equal(lafposBranchOf([TUZLA, MARINA, b("bodrum", "Bodrum", { posSource: "lafpos", sortOrder: 4 })]), "bodrum");
  // Pasif ya da online kayıt sayılmaz
  assert.equal(lafposBranchOf([{ ...TUZLA, posSource: "lafpos", active: false }, MARINA]), "marina");
  // Birden çoksa (eski veri; eylem kaydettirmez) geri düşüş aralarındaysa o, değilse kütüğün sırasıyla ilki
  assert.equal(lafposBranchOf([{ ...TUZLA, posSource: "lafpos" }, { ...MARINA, posSource: "lafpos" }]), "marina");
  assert.equal(lafposBranchOf([{ ...TUZLA, posSource: "lafpos" }, b("bodrum", "Bodrum", { posSource: "lafpos" })]), "tuzla");
});

test("ikinci LafPOS şubesi kaydedilmez; LafPOS'a geçmeyen değişiklik serbest", () => {
  const all = [{ ...TUZLA, posSource: "lafpos" as const }, MARINA, ONLINE];
  assert.match(lafposSourceError({ id: "marina", kind: "fiziksel", posSource: "lafpos", active: true }, all) ?? "", /yalnız bir şubenin kasası olabilir; Tuzla şubesinin kasası zaten LafPOS/);
  assert.equal(lafposSourceError({ id: "tuzla", kind: "fiziksel", posSource: "lafpos", active: true }, all), null, "kendisi");
  assert.equal(lafposSourceError({ id: "marina", kind: "fiziksel", posSource: "modpos", active: true }, all), null);
  assert.equal(lafposSourceError({ id: "marina", kind: "fiziksel", posSource: "lafpos", active: false }, all), null, "pasif şube");
  assert.equal(lafposSourceError({ id: "marina", kind: "fiziksel", posSource: "lafpos", active: true }, [{ ...TUZLA, posSource: "lafpos", active: false }]), null, "pasif sahibi saymaz");
});

test("geri düşüşle LafPOS'un şubesi olan Marina (kütükte ModPOS) LafPOS'u kullanıyorsa Tuzla ya da yeni şube LafPOS olamaz", () => {
  // Bugünkü kurulum: iki şube de ModPOS, LafPOS'un şubesi geri düşüşle Marina
  const today = [TUZLA, MARINA, ONLINE];
  assert.equal(lafposBranchOf(today), "marina");
  const tuzla = { id: "tuzla", kind: "fiziksel" as const, posSource: "lafpos" as const, active: true };
  assert.match(lafposSourceError(tuzla, today) ?? "", /LafPOS günleri Marina şubesine yazılıyor/, "varsayılan: kullanıyor sayılır");
  assert.match(lafposSourceError(tuzla, today, true) ?? "", /Marina şubesinin LafPOS günleri hesaptan düşer/);
  assert.match(lafposSourceError({ ...tuzla, id: "bodrum" }, today, true) ?? "", /Marina/, "yeni şube de");
  assert.equal(lafposSourceError(tuzla, today, false), null, "Marina'da geçiş günü ve LafPOS günü yoksa LafPOS taşınabilir");
  assert.equal(lafposSourceError({ ...tuzla, id: "marina" }, today, true), null, "Marina'nın kendisi LafPOS olabilir");
  assert.equal(lafposSourceError(tuzla, [TUZLA, { ...MARINA, active: false }, ONLINE], true), null, "kapalı Marina tutmaz");
  assert.equal(lafposSourceError(tuzla, [TUZLA, ONLINE], true), null, "kütükte Marina yoksa (tek şubeli eski kurulum) serbest");
});

test("yardımcılar türetilmiş şubeyi alır; verilmezse geri düşüş (bugünkü davranış)", () => {
  // Verilmeyince Marina
  assert.equal(isLafposBranch("marina"), true);
  assert.equal(branchSwitchDay(S, "tuzla"), null);
  // Tuzla LafPOS'ta
  assert.equal(isLafposBranch("tuzla", "tuzla"), true);
  assert.equal(isLafposBranch("marina", "tuzla"), false);
  assert.equal(isLafposBranch(null, "tuzla"), true, "şubesiz eski kayıt Tuzla'nın");
  assert.equal(branchSwitchDay(S, "tuzla", "tuzla"), S);
  assert.equal(branchSwitchDay(S, "marina", "tuzla"), null);
  assert.equal(scopeSwitchDay(S, "marina", "tuzla"), null);
  assert.equal(scopeSwitchDay(S, ALL_BRANCHES, "tuzla"), S);
  // Panel ikramı: yalnız LafPOS'un şubesinin günü düşer
  const ikram = { date: "2026-12-02", kind: "ikram" as const, productId: 1 };
  const days = new Set(["2026-12-02"]);
  assert.equal(panelWasteCounts({ ...ikram, branchId: "tuzla" }, days, "tuzla"), false);
  assert.equal(panelWasteCounts({ ...ikram, branchId: "marina" }, days, "tuzla"), true);
  // Satış listeleri: geçiş günü yalnız LafPOS'un şubesinin listesini keser
  const line = (branchId: string) => ({ id: 1, month: "2026-12", posName: "LATTE", qty: 1, revenue: 100, productId: null, isService: false, note: null, branchId });
  const kept = (lafposBranch?: string) => mergeSalesSources({ switchDay: "2026-11-01", salesLines: [line("tuzla"), line("marina")], coverage: {}, lafposLines: [], lafposDays: [], lafposBranch }).salesLines.map((l) => l.branchId);
  assert.deepEqual(kept(), ["tuzla"], "varsayılan: Marina'nın listesi sayılmaz");
  assert.deepEqual(kept("tuzla"), ["marina"], "Tuzla LafPOS'tayken Tuzla'nınki sayılmaz");
  assert.equal(lafposSalesCountFrom("2026-12-10", [{ month: "2026-12", branchId: "tuzla" }], { "2026-12": "2026-12-15" }, "tuzla"), "2026-12-16");
  assert.equal(lafposSalesCountFrom("2026-12-10", [{ month: "2026-12", branchId: "tuzla" }], { "2026-12": "2026-12-15" }), "2026-12-10", "Marina'nın listesi yok");
});

/** src altındaki .ts/.tsx dosyaları */
function sources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** `name(` çağrılarının argüman sayıları (tanımlar hariç; iç içe parantez sayılır) */
function callArgs(src: string, name: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`\\b${name}\\(`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 10), m.index))) continue;
    let depth = 1;
    let args = 1;
    let i = re.lastIndex;
    let last = "";
    for (; depth > 0; i++) {
      const c = src[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (c === "," && depth === 1) args++;
      if (depth > 0 && c.trim()) last = c;
    }
    out.push(last === "," ? args - 1 : args);
  }
  return out;
}

test("kaynak: sunucu ve sayfalar sabiti kullanmaz; geçiş gününü şubeye uygulayan her çağrı LafPOS'un şubesini verir", () => {
  const files = sources();
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  // Sabit yalnız saf geri düşüşlerde (verilmeyen parametrenin değeri) ve eski kaydın tarihsel sahibinde
  const allowed = new Set([
    "src/lib/lafpos/switch.ts",
    "src/lib/lafpos/cash-moves.ts",
    "src/lib/lafpos/foto.ts",
    "src/lib/lafpos/personel.ts",
    "src/lib/lafpos/modpos-gunler.ts",
    "src/lib/branch-settings/groups.ts",
    // stok_tahmini özelliği ayrı dilim (docs/SUBE.md › Sırada ne var); tahmin LafPOS'un şubesi değilse çalışmaz
    "src/lib/stock-estimate.ts",
  ]);
  const users = files.filter((f) => /\bLAFPOS_BRANCH_ID\b/.test(code(f)));
  assert.deepEqual(users.filter((f) => !allowed.has(f)), [], "sabit sunucuda ya da sayfada kullanılmaz (lafposBranchId / lafposBranchOf)");
  // Çağrılar: şube parametresiz çağrı yok (saf dosyanın kendi içi hariç)
  const want: Record<string, number> = { branchSwitchDay: 3, isLafposBranch: 2, scopeSwitchDay: 3, panelWasteCounts: 3, listDiscountOf: 3, modposMismatches: 4, classifyWorkedStaff: 4, lafposSalesCountFrom: 4, commissionScopeDays: 3 };
  const short: string[] = [];
  for (const f of files) {
    if (f === "src/lib/lafpos/switch.ts") continue;
    const src = code(f);
    for (const [name, n] of Object.entries(want)) for (const a of callArgs(src, name)) if (a < n) short.push(`${f}: ${name} (${a})`);
  }
  assert.deepEqual(short, [], "LafPOS'un şubesi verilmeyen çağrı");
  // Nesne parametreli yardımcılar da şubeyi alır
  for (const f of files) {
    const src = code(f);
    for (const m of src.matchAll(/\b(staffLafposEntryClosed|staffBeforeLafposDayEnd)\(\{([^}]*)\}\)/g)) assert.match(m[2], /lafposBranch/, `${f}: ${m[1]}`);
  }
});

test("kaynak: okuyucu önbellekli; ingest, gün sonu ve uçlar kütüğün şubesini okur; şube eylemleri reddeder ve önbelleği düşürür", () => {
  const reader = read("src/server/lafpos/branch.ts");
  assert.match(reader, /^import "server-only";/m);
  assert.match(reader, /export async function lafposBranchId\(db: Reader = getDb\(\), now: number = Date\.now\(\)\): Promise<string>/);
  assert.match(reader, /if \(hit && now - hit\.at < LAFPOS_BRANCH_CACHE_MS\) return hit\.id;/);
  assert.match(reader, /const id = lafposBranchOf\(rows\);/, "kural tek yerde (saf)");
  assert.match(reader, /export function forgetLafposBranch\(\): void/);
  const ingest = read("src/server/lafpos/ingest.ts");
  assert.match(ingest, /const expected = await lafposBranchId\(db\);/);
  assert.match(ingest, /await onLafposDaySaved\(tx, day\.date, day\.z, now, soldSince, branchId\);/);
  const dayEnd = read("src/server/lafpos/gun-sonu.ts");
  assert.equal((dayEnd.match(/const branchId = await lafposBranchId\(db\);/g) ?? []).length, 7, "otomatik rapor, gün sonu, Pavo, fotoğraf ve çalışan e-postası, durum, bekleyenler");
  assert.match(read("src/server/lafpos/modpos-gunler.ts"), /expected: await lafposBranchId\(\)/);
  assert.match(read("src/server/lafpos/personel.ts"), /expected: await lafposBranchId\(\)/);
  assert.match(read("src/server/data/dataset.ts"), /const lafposBranch = lafposBranchOf\(branches\);/);
  assert.match(read("src/server/data/dataset.ts"), /\n {4}lafposBranch,\n {4}currentMonth,/, "veri kümesi motora verir (Dataset.lafposBranch)");
  const actions = read("src/server/actions/branches.ts");
  assert.equal((actions.match(/forgetLafposBranch\(\);/g) ?? []).length, 3, "ekle, düzenle, sil");
  assert.match(actions, /const lafposHata = lafposSourceError\(\{ id: d\.id\.trim\(\), kind: d\.kind, posSource: d\.posSource, active: true \}, mevcut, await implicitHolderUsed\(db, mevcut, d\.posSource\)\);/);
  // Geri düşüşle tutan şube (kütükte ModPOS) LafPOS'u kullanıyorsa (geçiş günü ya da kayıtlı gün) başka şube LafPOS olamaz
  assert.match(actions, /lafposSourceError\(\{ id: d\.id, kind: d\.kind, posSource: d\.posSource, active: d\.active \}, hepsi, await implicitHolderUsed\(db, hepsi, d\.posSource\)\)/);
  assert.match(actions, /return lafposInUse\(lafposBranchOf\(others\), db\);/);
  assert.match(reader, /export async function lafposInUse\(branchId: string, db: Reader = getDb\(\)\): Promise<boolean>/);
  assert.match(actions, /const lafposOlur = d\.posSource === "lafpos" && d\.active && \(mevcut\.posSource !== "lafpos" \|\| !mevcut\.active\);/);
  // Eski kaydın sahibi tarihseldir: türetilmez
  assert.match(read("src/lib/branch-settings/groups.ts"), /return group\.legacy === "lafpos" \? LAFPOS_BRANCH_ID : DEFAULT_BRANCH_ID;/);
});

test("kasa kartları: tek şubede o şubenin kasası, kullanmayan şubede 'Bu şubede kullanılmıyor', 'Tümü'de şube adıyla", () => {
  const today = [TUZLA, MARINA, ONLINE];
  // LafPOS: Marina'da kart, Tuzla'da ve online kanalda satır
  assert.deepEqual(lafposCardView("marina", today), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(lafposCardView("tuzla", today), { kind: "elsewhere", users: [{ id: "marina", name: "Marina" }] });
  assert.deepEqual(lafposCardView("online", today), { kind: "elsewhere", users: [{ id: "marina", name: "Marina" }] });
  assert.deepEqual(lafposCardView(ALL_BRANCHES, today), { kind: "show", ids: ["marina"], named: true });
  // ModPOS: bugünkü veride Marina'nın kaynağı ModPOS olabilir (yedek çekim): iki şubede de bölüm; "Tümü"de adlarıyla
  assert.deepEqual(modposCardView("tuzla", today), { kind: "show", ids: ["tuzla"], named: false });
  assert.deepEqual(modposCardView("marina", today), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(modposCardView(ALL_BRANCHES, today), { kind: "show", ids: ["tuzla", "marina"], named: true });
  // Marina LafPOS'a geçince ModPOS kartı Marina'da satıra iner
  const switched = [TUZLA, { ...MARINA, posSource: "lafpos" as const }, ONLINE];
  assert.deepEqual(modposCardView("marina", switched), { kind: "elsewhere", users: [{ id: "tuzla", name: "Tuzla" }] });
  assert.deepEqual(modposCardView(ALL_BRANCHES, switched), { kind: "show", ids: ["tuzla"], named: true });
  assert.deepEqual(modposCardView("online", switched), { kind: "elsewhere", users: [{ id: "tuzla", name: "Tuzla" }] });
  // Tek şubeli kurulum: kartlar bugünkü gibi (LafPOS'un geri düşüş şubesi kütükte yok, satıra inmez; ad yok)
  assert.deepEqual(lafposCardView("tuzla", [TUZLA]), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(lafposCardView(ALL_BRANCHES, [TUZLA]), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(modposCardView(ALL_BRANCHES, [TUZLA]), { kind: "show", ids: ["tuzla"], named: false });
  // Tanınmayan seçim "Tümü" gibi
  assert.equal(lafposCardView("eski", today).kind, "show");
  // Metin
  assert.equal(POS_ELSEWHERE, "Bu şubede kullanılmıyor");
  assert.equal(posElsewhereText("LafPOS", [{ name: "Marina" }]), "LafPOS Marina şubesinin kasası; ayarları Marina seçiliyken ya da Tümü'nde görünür.");
  assert.equal(
    posElsewhereText("ModPOS", [{ name: "Tuzla" }, { name: "Bodrum" }]),
    "ModPOS Tuzla ve Bodrum şubelerinin kasası; ayarları o şubelerden biri seçiliyken ya da Tümü'nde görünür.",
  );
});

test("kaynak: Ayarlar kasa kartlarına seçimi ve kütüğü verir; kullanılmayan kartta durum okunmaz", () => {
  const page = read("src/app/panel/ayarlar/page.tsx");
  assert.match(page, /scope=\{scope\}\n\s+branches=\{branches\}\n\s+\/>\n\s+<ModposCard scope=\{scope\} branches=\{branches\} \/>/);
  const lafpos = read("src/app/panel/ayarlar/lafpos-card.tsx");
  assert.ok(lafpos.indexOf('if (view.kind === "elsewhere") return <PosElsewhereCard id="lafpos"') < lafpos.indexOf("loadLafposCard("), "satıra inen kart LafPOS'u okumaz");
  const modpos = read("src/app/panel/ayarlar/modpos-card.tsx");
  assert.ok(modpos.indexOf('if (view.kind === "elsewhere") return <PosElsewhereCard id="modpos"') < modpos.indexOf("loadModposCard("), "satıra inen kart ModPOS'u okumaz");
  const card = read("src/app/panel/ayarlar/pos-elsewhere.tsx");
  assert.match(card, /summary=\{POS_ELSEWHERE\}/);
  // O şubeyi seçtiren bağlantı (seçici ?sube='yi çereze benimsetir) ve bölümü açar; 44 px
  assert.match(card, /href=\{`\/panel\/ayarlar\?\$\{BRANCH_PARAM\}=\$\{encodeURIComponent\(b\.id\)\}#\$\{id\}`\} variant="secondary" className="min-h-11"/);
});
