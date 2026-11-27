// Şube fiyatı (LM-5; hesap sözleşmesi §8, sitenin docs/PANEL-MENU.md "Şube fiyatı"): sitenin okumasındaki şube
// satırları (`branchPrices`) ve yazma duyurusu (`writes.branchPrice`), AsilPOS gün sonundaki dondurulan liste fiyatları
// (`lines[].listPrices`), şube fiyatı yazımının gövdesi (tek ve toplu, iptal), "Geçerlilik"in varsayılanı (sonraki iş
// günü 05:00 İstanbul), toplu değişikliğin şube engelleri, "Eski fiyattan satılanlar" ve değişikliğin durumu (Bekliyor /
// Uygulandı · gün / Uygulanmadı / Bilinmiyor; yalnız listPrices'tan, ciro / adetten asla). Saf; veritabanı tarafı
// tests/sube-fiyat-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-fiyat.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";

import { tabOf } from "../src/app/panel/urunler/fiyatlar/logic";
import { parsePosDay } from "../src/lib/asilpos/day";
import { blockReason, previewRows, type BulkRow } from "../src/lib/prices/bulk";
import {
  branchBulkRows,
  branchChangeReports,
  branchFailureMessage,
  branchDialogSeed,
  branchDialogSet,
  branchPriceAt,
  branchSlotFacts,
  cancelBranchBody,
  defaultEffectiveFrom,
  effectiveFromText,
  effectiveLocalValue,
  oldPriceSales,
  parseEffectiveLocal,
  planBranchPrice,
  statusText,
  type BranchSaleRow,
  type PriceSources,
} from "../src/lib/prices/branch";
import { parseBranchPriceAnswer, parseSiteMenuList, type SiteBranchPrice, type SiteMenuItem } from "../src/lib/site-menu/schema";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { ablativeTR, locativeTR } from "../src/lib/format";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const item = (o: Partial<SiteMenuItem> = {}): SiteMenuItem => ({
  id: "mnu-0011",
  name: "Latte",
  categoryKey: "sicak",
  categoryLabel: "Sıcak kahveler",
  priceMinor: 19_500,
  priceMinorL: 21_000,
  isActive: true,
  sortOrder: 1,
  updatedAt: "2026-11-20T10:00:00.000Z",
  ...o,
});
const row = (o: Partial<SiteBranchPrice> = {}): SiteBranchPrice => ({
  id: "mnu-0011",
  branch: "marina",
  priceMinor: 20_500,
  priceMinorL: 0,
  effectiveFrom: "2026-11-25T02:00:00.000Z",
  createdAt: "2026-11-23T18:00:00.000Z",
  ...o,
});

// ---------------------------------------------------------------- Sitenin okuması

test("okuma: branchPrices ve writes.branchPrice okunur; yoksa ya da bozuksa liste yine kabul edilir", () => {
  const base = { version: 1, now: "2026-11-24T09:00:00.000Z", items: [item()] };
  const full = parseSiteMenuList({ ...base, writes: { expect: true, branch: true, branchPrice: true }, branchPrices: [row(), row({ priceMinor: null, effectiveFrom: "2026-12-01T02:00:00.000Z" })] });
  assert.equal(full.writesBranchPrice, true);
  assert.equal(full.writesExpect, true);
  assert.deepEqual(full.branchPrices, [row(), row({ priceMinor: null, effectiveFrom: "2026-12-01T02:00:00.000Z" })]);
  // Eski site: alan yok, duyuru yok; şube fiyatı yazımı önerilmez
  const old = parseSiteMenuList({ ...base, writes: { expect: true } });
  assert.equal(old.writesBranchPrice, false);
  assert.equal(old.branchPrices, null);
  // Bozuk satırlar listeyi düşürmez (fiyat listesi şube fiyatından önemlidir); satırlar yok sayılır
  const broken = parseSiteMenuList({ ...base, writes: { branchPrice: "evet" }, branchPrices: [{ id: "mnu-0011", branch: "marina", priceMinor: -5 }] });
  assert.equal(broken.writesBranchPrice, false);
  assert.equal(broken.branchPrices, null);
});

test("yazma yanıtı: 200 ve 409 stale gövdesindeki branchPrices okunur; kalem şubenin görünümüdür, tabanın kopyasına yazılmaz", () => {
  const ok = parseBranchPriceAnswer({ item: { ...item({ priceMinor: 20_500 }), basePriceMinor: 19_500, basePriceMinorL: 21_000, priceFrom: null }, branchPrices: [row()] });
  assert.deepEqual(ok.branchPrices, [row()]);
  assert.equal(parseBranchPriceAnswer({ error: "stale", item: item(), branchPrices: [] }).branchPrices?.length, 0);
  assert.equal(parseBranchPriceAnswer({ error: "stale" }).branchPrices, null);
});

// ---------------------------------------------------------------- AsilPOS gün sonu: listPrices

const NOW = new Date("2026-11-23T12:00:00+03:00");

test("gün sonu: lines[].listPrices okunur (altın gövde AsilPOS claude/sube-fiyati-kasa'dan); bozuk alan günü reddetmez", () => {
  const r = parsePosDay(read("tests/fixtures/asilpos-gun.golden.json"), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const priced = r.data.lines.filter((l) => l.listPrices);
  assert.ok(priced.length > 0, "altın gövdenin satırlarında listPrices var");
  assert.deepEqual(r.data.lines.find((l) => l.posName === priced[0].posName)?.listPrices, priced[0].listPrices);
  assert.ok(r.data.lines.filter((l) => l.isService).every((l) => l.listPrices === undefined), "hizmet satırında alan yok");
  const body = JSON.parse(read("tests/fixtures/asilpos-gun.golden.json")) as { lines: Record<string, unknown>[] };
  body.lines[0].listPrices = [{ price: -1, qty: 2 }];
  body.lines[1].listPrices = Array.from({ length: 21 }, (_, i) => ({ price: i, qty: 1 }));
  body.lines[2].listPrices = "195";
  const bad = parsePosDay(JSON.stringify(body), NOW);
  assert.ok(bad.ok, bad.ok ? "" : bad.field);
  assert.deepEqual([bad.data.lines[0].listPrices, bad.data.lines[1].listPrices, bad.data.lines[2].listPrices], [undefined, undefined, undefined]);
});

test("gün sonu: okunamayan lines[].listPrices günlüğe yazılır (öteki Faz 2 satır alanları gibi)", () => {
  const body = JSON.parse(read("tests/fixtures/asilpos-gun.golden.json")) as { lines: Record<string, unknown>[] };
  body.lines[0].listPrices = [{ price: -1, qty: 2 }];
  body.lines[1].listPrices = Array.from({ length: 21 }, (_, i) => ({ price: i, qty: 1 }));
  const warn = mock.method(console, "warn", () => {});
  try {
    const r = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(r.ok, r.ok ? "" : r.field);
    const lines = warn.mock.calls.map((c) => c.arguments.map(String).join(" "));
    const dropped = lines.find((l) => l.includes("okunamayan alanlar yazılmadı"));
    assert.ok(dropped, "uyarı yazıldı");
    assert.match(dropped!, /lines\.0\.listPrices, lines\.1\.listPrices/);
  } finally {
    warn.mock.restore();
  }
});

test("kabul günü: listPrices okunur; Σ price × qty = gross (mutlu saat yok)", () => {
  const r = parsePosDay(read("tests/fixtures/kabul-gunu-2026-11-22.json"), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const priced = r.data.lines.filter((l) => l.listPrices && !l.isAddon);
  assert.ok(priced.length > 0);
  for (const l of priced) {
    const sum = Math.round(l.listPrices!.reduce((a, p) => a + p.price * p.qty, 0) * 100) / 100;
    assert.equal(sum, l.gross, l.posName);
  }
});

// ---------------------------------------------------------------- Geçerlilik

test("Geçerlilik: varsayılan sonraki iş günü 05:00 İstanbul (gece 05:00'ten önce iş günü dündür)", () => {
  assert.equal(defaultEffectiveFrom(new Date("2026-11-24T14:00:00+03:00")), "2026-11-25T05:00:00+03:00");
  assert.equal(defaultEffectiveFrom(new Date("2026-11-25T03:30:00+03:00")), "2026-11-25T05:00:00+03:00");
  assert.equal(defaultEffectiveFrom(new Date("2026-11-30T23:59:00+03:00")), "2026-12-01T05:00:00+03:00");
  assert.equal(effectiveLocalValue("2026-11-25T02:00:00.000Z"), "2026-11-25T05:00");
});

test("Geçerlilik: ekrandaki yerel saat +03:00 ile gider; 5 dakikadan eski ve 90 günden ileri reddedilir", () => {
  const now = new Date("2026-11-24T14:00:00+03:00");
  assert.deepEqual(parseEffectiveLocal("2026-11-25T05:00", now), { ok: true, iso: "2026-11-25T05:00:00+03:00" });
  assert.equal(parseEffectiveLocal("2026-11-24T13:50", now).ok, false);
  assert.equal(parseEffectiveLocal("2026-11-24T13:57", now).ok, true, "saat farkı payı 5 dakika");
  assert.equal(parseEffectiveLocal("2027-03-01T05:00", now).ok, false);
  assert.equal(parseEffectiveLocal("2026-02-30T05:00", now).ok, false);
  assert.equal(parseEffectiveLocal("", now).ok, false);
});

// ---------------------------------------------------------------- Şubedeki fiyat (sitenin priceAtBranch'ı)

test("şubedeki fiyat: anı gelmiş en son satır; null satır tabana döner; satırın L'si 0 ise taban L; tek boyda L yok", () => {
  const base = { priceMinor: 19_500, priceMinorL: 21_000 };
  const rows = [row(), row({ priceMinor: 21_000, priceMinorL: 23_000, effectiveFrom: "2026-11-28T02:00:00.000Z" }), row({ priceMinor: null, effectiveFrom: "2026-12-05T02:00:00.000Z" })];
  assert.deepEqual(branchPriceAt(base, rows, Date.parse("2026-11-24T00:00:00Z")), { priceMinor: 19_500, priceMinorL: 21_000, from: null });
  assert.deepEqual(branchPriceAt(base, rows, Date.parse("2026-11-25T02:00:00Z")), { priceMinor: 20_500, priceMinorL: 21_000, from: "2026-11-25T02:00:00.000Z" });
  assert.deepEqual(branchPriceAt(base, rows, Date.parse("2026-11-30T00:00:00Z")), { priceMinor: 21_000, priceMinorL: 23_000, from: "2026-11-28T02:00:00.000Z" });
  assert.deepEqual(branchPriceAt(base, rows, Date.parse("2026-12-06T00:00:00Z")), { priceMinor: 19_500, priceMinorL: 21_000, from: null });
  assert.deepEqual(branchPriceAt({ priceMinor: 19_500, priceMinorL: 0 }, [row({ priceMinorL: 23_000 })], Date.parse("2026-11-26T00:00:00Z")), { priceMinor: 20_500, priceMinorL: 0, from: "2026-11-25T02:00:00.000Z" });
});

test("asistanın fiyat kartı: boyun şubedeki durumu (kendi fiyatı mı, tabanı mı izliyor) ve bu boyu değiştiren planlı satırlar", () => {
  const base = { priceMinor: 19_500, priceMinorL: 21_000 };
  const rows = [row(), row({ priceMinor: 21_000, priceMinorL: 23_000, effectiveFrom: "2026-11-28T02:00:00.000Z" }), row({ priceMinor: null, effectiveFrom: "2026-12-05T02:00:00.000Z" })];
  const t = Date.parse("2026-11-26T00:00:00Z");
  // M: kendi fiyatı 205; planlı 210 (28 Kas) ve tabana dönüş (5 Ara)
  assert.deepEqual(branchSlotFacts(base, rows, t, "M"), {
    priceMinor: 20_500,
    own: true,
    from: "2026-11-25T02:00:00.000Z",
    planned: [
      { effectiveFrom: "2026-11-28T02:00:00.000Z", priceMinor: 21_000 },
      { effectiveFrom: "2026-12-05T02:00:00.000Z", priceMinor: null },
    ],
  });
  // L: satırın L'si 0, tabanı izliyor (taban değişince şubede de değişir); 28 Kas'ta kendi L'si 230, 5 Ara'da tabana döner
  assert.deepEqual(branchSlotFacts(base, rows, t, "L"), {
    priceMinor: 21_000,
    own: false,
    from: null,
    planned: [
      { effectiveFrom: "2026-11-28T02:00:00.000Z", priceMinor: 23_000 },
      { effectiveFrom: "2026-12-05T02:00:00.000Z", priceMinor: null },
    ],
  });
  // L'yi değiştirmeyen planlı satır L için yazılmaz
  assert.deepEqual(branchSlotFacts(base, [row({ effectiveFrom: "2026-11-27T02:00:00.000Z" })], t, "L").planned, []);
  // Satırı olmayan şube: taban, plan yok
  assert.deepEqual(branchSlotFacts(base, [], t, "M"), { priceMinor: 19_500, own: false, from: null, planned: [] });
});

// ---------------------------------------------------------------- Yazımın gövdesi

const AT = "2026-11-25T05:00:00+03:00";

test("gövde: tek kalem M ve L'yi birlikte taşır; değişmeyen boy şubenin yürürlükteki değeriyle (yoksa taban L = 0)", () => {
  const p = planBranchPrice({ item: item(), rows: [], branch: "marina", effectiveFrom: AT, set: { M: 205 }, actor: "Selin" });
  assert.equal(p.kind, "push");
  assert.deepEqual(p.kind === "push" && p.body, { id: "mnu-0011", branch: "marina", actor: "Selin", branchPrice: { priceMinor: 20_500, priceMinorL: 0, effectiveFrom: AT } });
  assert.equal(JSON.stringify(p.kind === "push" && p.body), '{"id":"mnu-0011","branch":"marina","actor":"Selin","branchPrice":{"priceMinor":20500,"priceMinorL":0,"effectiveFrom":"2026-11-25T05:00:00+03:00"}}');
  // Şubenin kendi L'si varsa yalnız M değişince L korunur
  const own = [row({ priceMinor: 20_000, priceMinorL: 22_500, effectiveFrom: "2026-11-20T02:00:00.000Z" })];
  const m = planBranchPrice({ item: item(), rows: own, branch: "marina", effectiveFrom: AT, set: { M: 210 }, actor: "Selin" });
  assert.deepEqual(m.kind === "push" && m.body.branchPrice, { priceMinor: 21_000, priceMinorL: 22_500, effectiveFrom: AT });
  // Yalnız L değişince M o anki fiyatında sabitlenir (satırın M'si boş olamaz)
  const l = planBranchPrice({ item: item(), rows: [], branch: "marina", effectiveFrom: AT, set: { L: 225 }, actor: "Selin" });
  assert.deepEqual(l.kind === "push" && l.body.branchPrice, { priceMinor: 19_500, priceMinorL: 22_500, effectiveFrom: AT });
  // Tabana dön: priceMinor null, L 0
  const back = planBranchPrice({ item: item(), rows: own, branch: "marina", effectiveFrom: AT, set: { base: true }, actor: "Selin" });
  assert.deepEqual(back.kind === "push" && back.body.branchPrice, { priceMinor: null, priceMinorL: 0, effectiveFrom: AT });
  assert.deepEqual(back.kind === "push" && [back.before, back.after], [{ M: 200, L: 225 }, { M: 195, L: 210 }]);
});

test("gövde: değişmeyen fiyat gönderilmez; tek boya L, 0 fiyat, Tuzla ve seçenek kalemi reddedilir", () => {
  assert.equal(planBranchPrice({ item: item(), rows: [], branch: "marina", effectiveFrom: AT, set: { M: 195 }, actor: "Selin" }).kind, "none");
  assert.equal(planBranchPrice({ item: item(), rows: [], branch: "marina", effectiveFrom: AT, set: { base: true }, actor: "Selin" }).kind, "none");
  const refuse = (p: ReturnType<typeof planBranchPrice>) => (p.kind === "refuse" ? p.error : "");
  assert.match(refuse(planBranchPrice({ item: item({ priceMinorL: 0 }), rows: [], branch: "marina", effectiveFrom: AT, set: { L: 230 }, actor: "Selin" })), /tek boy/);
  assert.match(refuse(planBranchPrice({ item: item(), rows: [], branch: "marina", effectiveFrom: AT, set: { M: 0 }, actor: "Selin" })), /0/);
  assert.match(refuse(planBranchPrice({ item: item(), rows: [], branch: "tuzla", effectiveFrom: AT, set: { M: 205 }, actor: "Selin" })), /Tuzla/);
  assert.match(refuse(planBranchPrice({ item: item({ id: "mnu-0081" }), rows: [], branch: "marina", effectiveFrom: AT, set: { M: 30 }, actor: "Selin" })), /Seçenek/);
});

test("Değiştir penceresi: yalnız dokunulan boy gider; alanlar Geçerlilik anındaki fiyatla dolar (bugünkü değil)", () => {
  // Latte taban 195 / 210, Marina'nın satırı yok: yalnız M 205 yapılır → L gönderilmez, taban L (0) olarak kalır
  const onlyM = branchDialogSet({ toBase: false, hasL: true, M: 205, L: null });
  assert.deepEqual(onlyM, { M: 205 });
  const p = planBranchPrice({ item: item(), rows: [], branch: "marina", effectiveFrom: AT, set: onlyM, actor: "Selin" });
  assert.deepEqual(p.kind === "push" && p.body.branchPrice, { priceMinor: 20_500, priceMinorL: 0, effectiveFrom: AT }, "L taban L'yi izler, 210'da sabitlenmez");
  // 26 Kas'tan L 230 planlı; 30 Kas için yalnız M 210 → planlı L 230 korunur
  const planned = [row({ priceMinor: 20_500, priceMinorL: 23_000, effectiveFrom: "2026-11-26T02:00:00.000Z" })];
  const at30 = "2026-11-30T05:00:00+03:00";
  const seed = branchDialogSeed({ base: { M: 195, L: 210 }, rows: planned }, at30);
  assert.deepEqual(seed, { M: 205, L: 230 }, "alanlar 30 Kas'taki fiyatla dolar");
  const m210 = planBranchPrice({ item: item(), rows: planned, branch: "marina", effectiveFrom: at30, set: branchDialogSet({ toBase: false, hasL: true, M: 210, L: null }), actor: "Selin" });
  assert.deepEqual(m210.kind === "push" && [m210.body.branchPrice, m210.after], [{ priceMinor: 21_000, priceMinorL: 23_000, effectiveFrom: at30 }, { M: 210, L: 230 }]);
  // Elle aynı değer yazılan boy gönderilir; tek boyda L hiç gitmez; tabana dön tek başına
  assert.deepEqual(branchDialogSet({ toBase: false, hasL: true, M: null, L: 210 }), { L: 210 });
  assert.deepEqual(branchDialogSet({ toBase: false, hasL: false, M: 200, L: 250 }), { M: 200 });
  assert.deepEqual(branchDialogSet({ toBase: true, hasL: true, M: 200, L: 250 }), { base: true });
  assert.deepEqual(branchDialogSet({ toBase: false, hasL: true, M: null, L: null }), {});
  assert.deepEqual(branchDialogSeed({ base: { M: 195, L: 0 }, rows: [] }, "bozuk"), { M: 195, L: 0 });
});

test("Türkçe ekler: saatin okunuşuna göre 'ten / 'dan, şubenin adına göre 'da / 'de", () => {
  const ab = (hhmm: string) => effectiveFromText(`2026-11-25T${hhmm}:00+03:00`).replace("25\u00a0Kasım ", "");
  assert.deepEqual(
    ["05:00", "10:00", "06:00", "09:30", "13:15", "00:00", "14:40", "12:00", "07:00", "08:00", "03:00", "04:00", "05:50", "11:20"].map(ab),
    ["05:00'ten", "10:00'dan", "06:00'dan", "09:30'dan", "13:15'ten", "00:00'dan", "14:40'tan", "12:00'den", "07:00'den", "08:00'den", "03:00'ten", "04:00'ten", "05:50'den", "11:20'den"],
  );
  assert.equal(effectiveFromText("2026-11-25T05:00:00+03:00"), "25\u00a0Kasım 05:00'ten");
  assert.deepEqual(
    ["Marina", "Kadıköy", "Tuzla", "Moda Sahil", "Beşiktaş", "Ataşehir", "Göztepe", "Bostancı", "Kalamış"].map(locativeTR),
    ["Marina'da", "Kadıköy'de", "Tuzla'da", "Moda Sahil'de", "Beşiktaş'ta", "Ataşehir'de", "Göztepe'de", "Bostancı'da", "Kalamış'ta"],
  );
  assert.deepEqual(
    ["Marina", "Kadıköy", "Beşiktaş", "25\u00a0Kasım", "1\u00a0Eylül", "3\u00a0Ağustos", "9\u00a0Ocak"].map(ablativeTR),
    ["Marina'dan", "Kadıköy'den", "Beşiktaş'tan", "25\u00a0Kasım'dan", "1\u00a0Eylül'den", "3\u00a0Ağustos'tan", "9\u00a0Ocak'tan"],
  );
});

test("iptal gövdesi ve sitenin hataları Türkçe", () => {
  assert.equal(
    JSON.stringify(cancelBranchBody({ id: "mnu-0011", branch: "marina", effectiveFrom: "2026-11-25T02:00:00.000Z", actor: "Selin" })),
    '{"id":"mnu-0011","branch":"marina","actor":"Selin","branchPrice":{"effectiveFrom":"2026-11-25T02:00:00.000Z","cancel":true}}',
  );
  assert.match(branchFailureMessage({ kind: "http", status: 409, error: "stale" }, "fiyat yazılmadı"), /aynı anda/);
  assert.match(branchFailureMessage({ kind: "http", status: 409, error: "stale" }, "iptal edilmedi", true), /yürürlüğe girmiş ya da sitede yok/);
  assert.match(branchFailureMessage({ kind: "http", status: 400, field: "branchPrice.effectiveFrom" }, "fiyat yazılmadı"), /5 dakikadan eski/);
  assert.match(branchFailureMessage({ kind: "http", status: 400, field: "id" }, "fiyat yazılmadı"), /Seçenek/);
  assert.match(branchFailureMessage({ kind: "http", status: 403, error: "forbidden" }, "fiyat yazılmadı"), /anahtar/);
  assert.match(branchFailureMessage({ kind: "network" }, "fiyat yazılmadı"), /ulaşılamadı/);
});

// ---------------------------------------------------------------- Toplu değişiklik: şube

const bulkRow = (o: Partial<BulkRow> = {}): BulkRow => ({
  id: 1,
  name: "Latte",
  size: "M",
  categoryId: 1,
  category: "Kahve",
  active: true,
  price: 195,
  cost: 40,
  suggestedPrice: 0,
  site: "linked",
  note: null,
  siteText: "Sitede",
  monthlyQty: 0,
  siteMenuId: "mnu-0011",
  siteMenuSlot: "M",
  ...o,
});

test("toplu, şube: önizlemenin bugünkü fiyatı şubenin Geçerlilik anındaki fiyatı; bağlı olmayan ve seçenek engelli", () => {
  const rows = [bulkRow(), bulkRow({ id: 2, size: "L", price: 210, siteMenuSlot: "L" }), bulkRow({ id: 3, name: "Kurabiye", site: "none", siteMenuId: null, siteMenuSlot: null, price: 90 }), bulkRow({ id: 4, name: "Extra Shot", siteMenuId: "mnu-0081", price: 30 })];
  const items = { "mnu-0011": { priceMinor: 19_500, priceMinorL: 21_000 }, "mnu-0081": { priceMinor: 3_000, priceMinorL: 0 } };
  const branchRows = branchBulkRows(rows, { items, rows: [row({ effectiveFrom: "2026-11-24T02:00:00.000Z" })], branch: "marina", at: Date.parse(AT) });
  assert.deepEqual(branchRows.map((r) => r.price), [205, 210, 90, 30]);
  const preview = previewRows(branchRows, { kind: "amount", value: 10, rounding: { step: 1, mode: "nearest" } }, new Map(), new Set(), DEFAULT_SETTINGS, { siteConfigured: true, branch: true });
  assert.deepEqual(
    preview.map((p) => [p.newPrice, p.blocked]),
    [
      [215, null],
      [220, null],
      [100, "Şube fiyatı yalnız siteye bağlı üründe değişir"],
      [40, "Seçenek fiyatı şubeye göre değişmez (her şubede sitenin tabanı)"],
    ],
  );
  // Taban (Tümü) değişikliğinde engel yok
  assert.equal(blockReason({ newPrice: 100, site: "none" }, { siteConfigured: true }), null);
});

// ---------------------------------------------------------------- Eski fiyattan satılanlar ve durum

/** 25 Kas 05:00'ten Marina latte M 205 (taban 195), L taban 210 */
const sources = (rows: SiteBranchPrice[] = [row()], baseChanges: PriceSources["base"]["M"]["changes"] = []): Map<string, PriceSources> =>
  new Map([["mnu-0011", { base: { M: { current: 195, changes: baseChanges }, L: { current: 210, changes: [] } }, rows }]]);
const sale = (date: string, prices: [number, number][] | null, slot: "M" | "L" = "M"): BranchSaleRow => ({
  date,
  siteMenuId: "mnu-0011",
  slot,
  qty: (prices ?? [[0, 3]]).reduce((a, [, q]) => a + q, 0),
  listPrices: prices ? prices.map(([price, qty]) => ({ price, qty })) : null,
});
const NOW_MS = Date.parse("2026-11-28T12:00:00+03:00");

test("durum: yeni fiyatla ilk satış günü Uygulandı; geçiş günü eski fiyat sayılmaz", () => {
  const sales = [sale("2026-11-24", [[195, 10]]), sale("2026-11-25", [[205, 7]]), sale("2026-11-26", [[205, 9]])];
  const r = branchChangeReports({ rows: [row()], sources: sources(), sales, now: NOW_MS });
  assert.deepEqual(
    r.map((c) => [c.slot, c.before, c.after, c.status]),
    [["M", 195, 205, { kind: "uygulandi", day: "2026-11-25" }]],
  );
  assert.equal(statusText(r[0].status), "Uygulandı · 25\u00a0Kasım");
});

test("durum: sonraki tam günlerde yalnız eski fiyat Uygulanmadı; satış yoksa ya da an gelmediyse Bekliyor; listPrices yoksa Bilinmiyor", () => {
  const status = (sales: BranchSaleRow[], now = NOW_MS) => branchChangeReports({ rows: [row()], sources: sources(), sales, now })[0].status;
  assert.deepEqual(status([sale("2026-11-25", [[195, 4]]), sale("2026-11-26", [[195, 6]])]), { kind: "uygulanmadi", day: "2026-11-25" });
  assert.deepEqual(status([sale("2026-11-24", [[195, 4]])]), { kind: "bekliyor" }, "geçiş gününden önceki satış sayılmaz");
  assert.deepEqual(status([sale("2026-11-26", [[205, 1]])], Date.parse("2026-11-24T12:00:00+03:00")), { kind: "bekliyor" }, "an gelmedi");
  assert.deepEqual(status([sale("2026-11-25", null), sale("2026-11-26", null)]), { kind: "bilinmiyor" }, "eski AsilPOS: ciro / adetten çıkarılmaz");
  // Eski günde yalnız eski fiyat, sonra yeni fiyat: Uygulandı ve gün yeni fiyatın ilk günü
  assert.deepEqual(status([sale("2026-11-25", [[195, 4]]), sale("2026-11-27", [[205, 2]])]), { kind: "uygulandi", day: "2026-11-27" });
  assert.deepEqual([statusText({ kind: "bekliyor" }), statusText({ kind: "uygulanmadi", day: "2026-11-25" }), statusText({ kind: "bilinmiyor" })], ["Bekliyor", "Uygulanmadı", "Bilinmiyor"]);
});

test("durum: yalnız değişen boy raporlanır; sonraki değişiklik öncekinin değerlendirmesini keser", () => {
  const rows = [row(), row({ priceMinor: 21_500, effectiveFrom: "2026-11-27T02:00:00.000Z" })];
  const sales = [sale("2026-11-27", [[215, 3]]), sale("2026-11-27", [[210, 2]], "L")];
  const r = branchChangeReports({ rows, sources: sources(rows), sales, now: NOW_MS });
  assert.deepEqual(
    r.map((c) => [c.effectiveFrom, c.slot, c.status.kind]),
    [
      ["2026-11-27T02:00:00.000Z", "M", "uygulandi"],
      ["2026-11-25T02:00:00.000Z", "M", "bekliyor"],
    ],
    "yeniden eskiye; ilk değişikliğin penceresi ikincinin anında biter, L değişmediği için yok",
  );
});

test("durum: gün ortasındaki değişiklikte geçiş gününün eski fiyatı Uygulanmadı sayılmaz; ertesi tam gün sayılır", () => {
  // 25 Kas 14:00'te M 205: 25'i geçiş günü, sabah 195'ten satılanlar değişiklikten önce satılmış olabilir
  const midday = [row({ effectiveFrom: "2026-11-25T11:00:00.000Z" })];
  const status = (sales: BranchSaleRow[]) => branchChangeReports({ rows: midday, sources: sources(midday), sales, now: NOW_MS })[0].status;
  assert.deepEqual(status([sale("2026-11-25", [[195, 6]])]), { kind: "bekliyor" }, "yalnız geçiş günü, yalnız eski fiyat");
  assert.deepEqual(status([sale("2026-11-25", [[195, 6]]), sale("2026-11-26", [[195, 2]])]), { kind: "uygulanmadi", day: "2026-11-26" });
  assert.deepEqual(status([sale("2026-11-25", [[195, 6], [205, 1]])]), { kind: "uygulandi", day: "2026-11-25" });
});

test("durum: değişikliğin penceresi o boyu değiştiren sonraki satırda biter (yalnız L'yi değiştiren satır M'yi kesmez)", () => {
  // 25 Kas M 205 / L taban, 26 Kas M 205 / L 230 (yalnız L değişti)
  const rows = [row(), row({ priceMinor: 20_500, priceMinorL: 23_000, effectiveFrom: "2026-11-26T02:00:00.000Z" })];
  const sales = [sale("2026-11-26", [[205, 5]]), sale("2026-11-27", [[205, 3]]), sale("2026-11-27", [[230, 2]], "L")];
  const r = branchChangeReports({ rows, sources: sources(rows), sales, now: NOW_MS });
  assert.deepEqual(
    r.map((c) => [c.effectiveFrom, c.slot, c.before, c.after, c.status]),
    [
      ["2026-11-26T02:00:00.000Z", "L", 210, 230, { kind: "uygulandi", day: "2026-11-27" }],
      ["2026-11-25T02:00:00.000Z", "M", 195, 205, { kind: "uygulandi", day: "2026-11-26" }],
    ],
  );
  // Tabanı izleyen boyun penceresi tabanın değişikliğinde biter: 25 Kas M 205 / L taban, 27 Kas taban L 210 → 220
  const base = new Map<string, PriceSources>([
    ["mnu-0011", { base: { M: { current: 195, changes: [] }, L: { current: 220, changes: [{ at: Date.parse("2026-11-27T05:00:00+03:00"), before: 210, after: 220 }] } }, rows: [row({ priceMinorL: 22_500 })] }],
  ]);
  const own = [row({ priceMinorL: 22_500 }), row({ priceMinor: 20_500, priceMinorL: 0, effectiveFrom: "2026-11-26T02:00:00.000Z" })];
  base.get("mnu-0011")!.rows = own;
  const lr = branchChangeReports({ rows: own, sources: base, sales: [sale("2026-11-27", [[210, 4]], "L")], now: NOW_MS });
  assert.deepEqual(
    lr.filter((c) => c.slot === "L").map((c) => [c.effectiveFrom, c.after, c.status]),
    [
      ["2026-11-26T02:00:00.000Z", 210, { kind: "bekliyor" }],
      ["2026-11-25T02:00:00.000Z", 225, { kind: "bekliyor" }],
    ],
    "26 Kas L tabana (210) döndü; 27 Kas taban 220 olunca pencere biter, 27'sinin 210'u ne uygulandı ne uygulanmadı",
  );
});

test("eski fiyattan satılanlar: o gün geçerli fiyatlardan farklı fiyat; gün ortasındaki geçişte iki fiyat da doğru; taban değişikliği de geçiştir", () => {
  const sales = [
    sale("2026-11-24", [[195, 10]]),
    sale("2026-11-25", [[195, 2], [205, 5]]),
    sale("2026-11-26", [[195, 3], [205, 9]]),
    sale("2026-11-26", [[210, 4]], "L"),
    sale("2026-11-27", null),
  ];
  // Değişiklik 25 Kas 05:00'te, günün başında: 25'i tam gündür, 195 eski fiyattır
  assert.deepEqual(oldPriceSales({ sales, sources: sources() }), [
    { date: "2026-11-26", siteMenuId: "mnu-0011", slot: "M", price: 195, qty: 3, expected: 205, loss: 30 },
    { date: "2026-11-25", siteMenuId: "mnu-0011", slot: "M", price: 195, qty: 2, expected: 205, loss: 20 },
  ]);
  // Gün ortasında (25 Kas 14:00) değişince 25'i geçiş günü: iki fiyat da doğru
  const midday = [row({ effectiveFrom: "2026-11-25T11:00:00.000Z" })];
  assert.deepEqual(oldPriceSales({ sales, sources: sources(midday) }), [{ date: "2026-11-26", siteMenuId: "mnu-0011", slot: "M", price: 195, qty: 3, expected: 205, loss: 30 }]);
  // Taban 22 Kas 15:00'te 190 → 195 (şube tabanı izliyor): o gün 190 da doğru, ertesi gün 190 eski fiyat
  const base = sources([], [{ at: Date.parse("2026-11-22T15:00:00+03:00"), before: 190, after: 195 }]);
  assert.deepEqual(
    oldPriceSales({ sales: [sale("2026-11-22", [[190, 2], [195, 1]]), sale("2026-11-23", [[190, 1]])], sources: base }),
    [{ date: "2026-11-23", siteMenuId: "mnu-0011", slot: "M", price: 190, qty: 1, expected: 195, loss: 5 }],
  );
});

test("Fiyatlar sekmeleri: Şube fiyatı ve Eski fiyattan satılanlar", () => {
  assert.equal(tabOf("sube"), "sube");
  assert.equal(tabOf("eski"), "eski");
  assert.equal(tabOf("x"), "toplu");
});
