// Çok şubeli AsilPOS kasaları (sahibin kararı, 27 Kasım 2026; docs/ASILPOS.md › Şubeler) ve Ayarlar'ın kasa kartları
// seçili şubeye göre (C P2-2; docs/SUBE.md › Ayarlar'da kasa kartları):
// - saf kural: kasalar kasa kaynağı AsilPOS olan fiziksel şubeler (kapalı şube dahil), hiç yoksa Marina (göç öncesi);
// - her kasanın kendi geçiş günü: bir şubenin günü yalnız kendi geçiş gününden itibaren sayılır, ModPOS şubesininki hiç;
// - kaynak: tek AsilPOS şubesi engeli yok; şube eylemleri önbelleği düşürür, ModPOS'a dönüş onay ister;
// - kart görünümü: tek şubede o şubenin kasası, kullanmayan şubede "Bu şubede kullanılmıyor", "Tümü"de şube adıyla.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, type BranchRow } from "../src/lib/branches";
import { panelWasteCounts } from "../src/lib/asilpos/ikram";
import { asilposSalesCountFrom, mergeSalesSources, otherBranchLists, posCountFroms } from "../src/lib/asilpos/sales";
import { asilposCardView, modposCardView, POS_ELSEWHERE, posElsewhereText } from "../src/lib/pos-cards";
import {
  activePosTillIds,
  countedTillIds,
  earliestSwitchDay,
  isCountedPosDay,
  LEGACY_POS_BRANCH_ID,
  posFromOf,
  posOffConfirmText,
  POS_OFF_CONFIRM_PREFIX,
  posTillIds,
  scopeSwitchDay,
  scopeSwitchDays,
  switchDayFor,
  tillDayKey,
} from "../src/lib/pos/tills";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const b = (id: string, name: string, o: Partial<BranchRow> = {}): BranchRow => ({ id, name, kind: "fiziksel", posSource: "modpos", active: true, openedOn: null, sortOrder: 1, ...o });
const TUZLA = b("tuzla", "Tuzla", { sortOrder: 1 });
const MARINA = b("marina", "Marina", { sortOrder: 2 });
const ONLINE = b("online", "laffogato.net", { kind: "online", posSource: "yok", sortOrder: 3 });

test("saf kural: kasalar kasa kaynağı AsilPOS olan fiziksel şubeler; hiç yoksa Marina (göç 0099 öncesi)", () => {
  assert.equal(LEGACY_POS_BRANCH_ID, "marina");
  assert.deepEqual(posTillIds([TUZLA, MARINA, ONLINE]), ["marina"], "hiç AsilPOS kasası yok: eski kurulumun şubesi");
  assert.deepEqual(posTillIds([TUZLA]), ["marina"], "kütükte Marina yok: yine Marina");
  assert.deepEqual(posTillIds([TUZLA, { ...MARINA, posSource: "asilpos" }, ONLINE]), ["marina"]);
  assert.deepEqual(posTillIds([{ ...TUZLA, posSource: "asilpos" }, MARINA]), ["tuzla"], "Marina ModPOS'a döndü, Tuzla AsilPOS'ta");
  assert.deepEqual(posTillIds([{ ...TUZLA, posSource: "asilpos" }, { ...MARINA, posSource: "asilpos" }]), ["tuzla", "marina"], "iki kasa, kütüğün sırasıyla");
  // Kapalı şubenin geçmiş günleri sayılmaya devam eder; otomasyon yalnız açık kasalarda
  const closed = [{ ...TUZLA, posSource: "asilpos" as const, active: false }, { ...MARINA, posSource: "asilpos" as const }];
  assert.deepEqual(posTillIds(closed), ["tuzla", "marina"]);
  assert.deepEqual(activePosTillIds(closed), ["marina"]);
  // Online kanal kasa olamaz
  assert.deepEqual(posTillIds([{ ...ONLINE, posSource: "asilpos" }, MARINA]), ["marina"]);
});

test("her kasanın kendi geçiş günü: gün yalnız şubenin kasası AsilPOS ve kendi geçiş gününden önce değilse sayılır", () => {
  const days = { marina: "2026-11-22", tuzla: "2027-01-10" };
  assert.equal(switchDayFor(days, "marina"), "2026-11-22");
  assert.equal(switchDayFor(days, "bodrum"), null, "kasası ModPOS olan şube");
  assert.equal(switchDayFor(days, null), "2027-01-10", "şubesiz kayıt Tuzla'nın");
  assert.deepEqual(
    [isCountedPosDay(days, "marina", "2026-11-21"), isCountedPosDay(days, "marina", "2026-11-22"), isCountedPosDay(days, "tuzla", "2026-12-15"), isCountedPosDay(days, "tuzla", "2027-01-10")],
    [false, true, false, true],
  );
  // ModPOS şubesinin deneme günü (anahtarı olan ama kasası ModPOS) hiçbir zaman sayılmaz
  assert.equal(isCountedPosDay({ marina: "2026-11-22" }, "tuzla", "2026-12-15"), false);
  assert.deepEqual(countedTillIds({ marina: "2026-11-22", tuzla: null }), ["marina"]);
  assert.equal(earliestSwitchDay(days), "2026-11-22");
  assert.equal(earliestSwitchDay({ tuzla: null }), null);
  // Görünüm: tek şubede yalnız onunki, "Tümü"de hepsi (metinler için en erkeni)
  assert.deepEqual(scopeSwitchDays(days, "tuzla"), { tuzla: "2027-01-10" });
  assert.deepEqual(scopeSwitchDays(days, "bodrum"), {});
  assert.deepEqual(scopeSwitchDays(days, ALL_BRANCHES), days);
  assert.equal(scopeSwitchDay(days, ALL_BRANCHES), "2026-11-22");
  assert.equal(scopeSwitchDay(days, "tuzla"), "2027-01-10");
  assert.equal(tillDayKey(null, "2026-11-22"), "tuzla|2026-11-22");
  assert.equal(posFromOf({ marina: "2026-11-22" }, "tuzla"), null);
});

test("satışlar: her kasa kendi sayılma günüyle; ModPOS listesi şubenin kendi geçiş gününe göre sayılır", () => {
  const days = { marina: "2026-11-22", tuzla: "2027-01-10" };
  const line = (month: string, branchId: string) => ({ id: 1, month, posName: "X", qty: 1, revenue: 100, productId: null, isService: false, note: null, branchId });
  // Kasa başına sayılma günü kendi listesinin kaydıyla
  const froms = posCountFroms(days, [line("2026-11", "marina"), line("2027-01", "tuzla")], (id): Record<string, string> => (id === "tuzla" ? { "2027-01": "2027-01-15" } : { "2026-11": "2026-11-21" }));
  assert.deepEqual(froms, { marina: "2026-11-22", tuzla: "2027-01-16" });
  assert.equal(asilposSalesCountFrom("2027-01-10", [line("2027-01", "marina")], { "2027-01": "2027-01-15" }, "tuzla"), "2027-01-10", "öteki şubenin listesi bu kasayı kesmez");
  // Aralık: Marina'nın ModPOS listesi sayılmaz (ayın tamamı AsilPOS), Tuzla'nınki sayılır (geçişi Ocak'ta)
  const r = mergeSalesSources({ switchDays: days, salesLines: [line("2026-12", "marina"), line("2026-12", "tuzla")], coverage: {}, asilposLines: [], asilposDays: [] });
  assert.deepEqual(r.salesLines.map((l) => l.branchId), ["tuzla"]);
  // "Tümü"nün ortak dönemi: Ocak'ta geçiş ayındaki Tuzla ModPOS şubesi değil (AsilPOS kasası), Aralık'ta ModPOS şubesi
  const others = otherBranchLists({ switchDays: days, salesLines: [line("2026-12", "tuzla"), line("2027-01", "tuzla")], reportDays: [], coverageOf: () => ({}) });
  assert.deepEqual(others.map((o) => o.month), ["2026-12"]);
  // Paneldeki ürün ikramı yalnız kendi şubesinin gün sonu geldiyse düşer
  const tillDays = new Set([tillDayKey("marina", "2027-01-12")]);
  assert.equal(panelWasteCounts({ date: "2027-01-12", kind: "ikram", productId: 5, branchId: "tuzla" }, tillDays), true);
  assert.equal(panelWasteCounts({ date: "2027-01-12", kind: "ikram", productId: 5, branchId: "marina" }, tillDays), false);
});

test("kaynak: tek AsilPOS şubesi engeli yok; şube eylemleri önbelleği düşürür, AsilPOS'tan ModPOS'a dönüş onay ister", () => {
  const actions = read("src/server/actions/branches.ts");
  assert.doesNotMatch(actions, /asilposSourceError|implicitHolderUsed|yalnız bir şubenin kasası/);
  assert.equal((actions.match(/forgetPosBranches\(\);/g) ?? []).length, 3, "ekle, düzenle, sil");
  assert.match(actions, /if \(posOff && !d\.confirmPosOff\) throw new UserError\(posOffConfirmText\(mevcut\.name\)\);/);
  assert.match(actions, /if \(posOff\) await putBranchSetting\(tx, ASILPOS_GROUP, d\.id, \{ switchDay: null \}, me\.name\);/);
  assert.ok(posOffConfirmText("Marina").startsWith(POS_OFF_CONFIRM_PREFIX));
  assert.match(read("src/app/panel/subeler/branches-admin.tsx"), /sonuc\.error\.startsWith\(POS_OFF_CONFIRM_PREFIX\)/);
  // Eski tek kasa yardımcıları kalktı
  for (const f of ["src/lib/asilpos/switch.ts", "src/server/asilpos/branch.ts"]) assert.doesNotMatch(read(f), /asilposBranchId|asilposBranchOf|asilposSourceError|ASILPOS_BRANCH_ID/, f);
});

test("kasa kartları: tek şubede o şubenin kasası, kullanmayan şubede 'Bu şubede kullanılmıyor', 'Tümü'de şube adıyla", () => {
  const today = [TUZLA, MARINA, ONLINE];
  // AsilPOS: Marina'da kart, Tuzla'da ve online kanalda satır
  assert.deepEqual(asilposCardView("marina", today), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(asilposCardView("tuzla", today), { kind: "elsewhere", users: [{ id: "marina", name: "Marina" }] });
  assert.deepEqual(asilposCardView("online", today), { kind: "elsewhere", users: [{ id: "marina", name: "Marina" }] });
  assert.deepEqual(asilposCardView(ALL_BRANCHES, today), { kind: "show", ids: ["marina"], named: true });
  // ModPOS: bugünkü veride Marina'nın kaynağı ModPOS olabilir (yedek çekim): iki şubede de bölüm; "Tümü"de adlarıyla
  assert.deepEqual(modposCardView("tuzla", today), { kind: "show", ids: ["tuzla"], named: false });
  assert.deepEqual(modposCardView("marina", today), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(modposCardView(ALL_BRANCHES, today), { kind: "show", ids: ["tuzla", "marina"], named: true });
  // Marina AsilPOS'a geçince ModPOS kartı Marina'da satıra iner
  const switched = [TUZLA, { ...MARINA, posSource: "asilpos" as const }, ONLINE];
  assert.deepEqual(modposCardView("marina", switched), { kind: "elsewhere", users: [{ id: "tuzla", name: "Tuzla" }] });
  assert.deepEqual(modposCardView(ALL_BRANCHES, switched), { kind: "show", ids: ["tuzla"], named: true });
  assert.deepEqual(modposCardView("online", switched), { kind: "elsewhere", users: [{ id: "tuzla", name: "Tuzla" }] });
  // İki AsilPOS kasası: her biri kendi şubesinde, "Tümü"de ikisi adlarıyla; ModPOS kartı yalnız ModPOS'taki şubede
  const two = [{ ...TUZLA, posSource: "asilpos" as const }, { ...MARINA, posSource: "asilpos" as const }, ONLINE];
  assert.deepEqual(asilposCardView("tuzla", two), { kind: "show", ids: ["tuzla"], named: false });
  assert.deepEqual(asilposCardView("marina", two), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(asilposCardView(ALL_BRANCHES, two), { kind: "show", ids: ["tuzla", "marina"], named: true });
  // Tek şubeli kurulum: kartlar bugünkü gibi (AsilPOS'un geri düşüş şubesi kütükte yok, satıra inmez; ad yok)
  assert.deepEqual(asilposCardView("tuzla", [TUZLA]), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(asilposCardView(ALL_BRANCHES, [TUZLA]), { kind: "show", ids: ["marina"], named: false });
  assert.deepEqual(modposCardView(ALL_BRANCHES, [TUZLA]), { kind: "show", ids: ["tuzla"], named: false });
  // Tanınmayan seçim "Tümü" gibi
  assert.equal(asilposCardView("eski", today).kind, "show");
  // Metin
  assert.equal(POS_ELSEWHERE, "Bu şubede kullanılmıyor");
  assert.equal(posElsewhereText("AsilPOS", [{ name: "Marina" }]), "AsilPOS Marina şubesinin kasası; ayarları Marina seçiliyken ya da Tümü'nde görünür.");
  assert.equal(
    posElsewhereText("ModPOS", [{ name: "Tuzla" }, { name: "Bodrum" }]),
    "ModPOS Tuzla ve Bodrum şubelerinin kasası; ayarları o şubelerden biri seçiliyken ya da Tümü'nde görünür.",
  );
});

test("kaynak: Ayarlar kasa kartlarına seçimi ve kütüğü verir; kullanılmayan kartta durum okunmaz", () => {
  const page = read("src/app/panel/ayarlar/page.tsx");
  assert.match(page, /scope=\{scope\}\n\s+branches=\{branches\}\n\s+\/>\n\s+<ModposCard scope=\{scope\} branches=\{branches\} \/>/);
  const asilpos = read("src/app/panel/ayarlar/asilpos-card.tsx");
  assert.ok(asilpos.indexOf('if (view.kind === "elsewhere") return <PosElsewhereCard id="asilpos"') < asilpos.indexOf("loadAsilposCard("), "satıra inen kart AsilPOS'u okumaz");
  const modpos = read("src/app/panel/ayarlar/modpos-card.tsx");
  assert.ok(modpos.indexOf('if (view.kind === "elsewhere") return <PosElsewhereCard id="modpos"') < modpos.indexOf("loadModposCard("), "satıra inen kart ModPOS'u okumaz");
  const card = read("src/app/panel/ayarlar/pos-elsewhere.tsx");
  assert.match(card, /summary=\{POS_ELSEWHERE\}/);
  // O şubeyi seçtiren bağlantı (seçici ?sube='yi çereze benimsetir) ve bölümü açar; 44 px
  assert.match(card, /href=\{`\/panel\/ayarlar\?\$\{BRANCH_PARAM\}=\$\{encodeURIComponent\(b\.id\)\}#\$\{id\}`\} variant="secondary" className="min-h-11"/);
});
