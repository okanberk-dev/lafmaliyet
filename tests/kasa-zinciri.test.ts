// Kasa zinciri (Faz 3, 23 Kasım 2026; docs/LAFPOS.md › Kasa zinciri, Kasadan çıkanlar LafPOS'tan): gövdenin açılış alanları
// (z.expectedOpening, z.openingDiff, z.openingReason) ve kasa hareketleri (cashMoves) okunur, bozuk gelen günü reddetmez;
// ertesi günün beklenen açılışı (nextOpening) kayıtlı Kasa raporundan ya da LafPOS'un sayımından, LafPOS'un otomatik
// raporunda gelen gövdenin değeriyle (rapor yanıttan sonra yazılır); kasa hareketlerinin "Kasadan çıkanlar"a planı
// (kimlikle, elle girilmiş eşi bire bir sahiplenilir, gelmeyen LafPOS satırı kalkar, giriş satıra girmez); kilit metni;
// otomatik raporun notu ve gün görünümü. Veritabanı tarafı tests/kasa-zinciri-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/kasa-zinciri.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { LAFPOS_CASH_OUT_TEXT, lafposCashOutChange, planLafposCashOuts, type LafposCashOutRow } from "../src/lib/lafpos/cash-moves";
import { parsePosDay, type PosCashMove } from "../src/lib/lafpos/day";
import { nextOpeningOf } from "../src/lib/lafpos/devir";
import { lafposDayDetail } from "../src/lib/lafpos/gun-ayrinti";
import { autoValuesOf, autoValuesOfReport, dayHash, mergeAuto, type AutoValues } from "../src/lib/lafpos/gun-sonu";
import { money } from "../src/lib/format";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Gövdelerin denetlendiği an: 23 Kasım 2026 öğlen */
const NOW = new Date("2026-11-23T12:00:00+03:00");
const golden = () => JSON.parse(read("tests/fixtures/lafpos-gun.golden.json")) as Record<string, unknown> & { z: Record<string, unknown>; cashMoves: Record<string, unknown>[] };
const parse = (body: unknown) => {
  const r = parsePosDay(JSON.stringify(body), NOW);
  assert.ok(r.ok, r.ok ? "" : `400: ${r.field}`);
  return r.data;
};
/** Okunamayan alanların günlüğü (parsePosDay console.warn'a yazar) */
function quiet<T>(fn: () => T): { value: T; warned: string[] } {
  const warned: string[] = [];
  const real = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(" "));
  try {
    return { value: fn(), warned };
  } finally {
    console.warn = real;
  }
}

// ---------------------------------------------------------------- Gövde

test("gövde: Faz 3 alanları isteğe bağlı (eski LafPOS göndermez); gelince açılışın beklenen tutarı, işaretli farkı ve nedeni, kasa hareketleri okunur", () => {
  const old: Record<string, unknown> & { z: Record<string, unknown> } = golden();
  delete old.cashMoves;
  for (const k of ["expectedOpening", "openingDiff", "openingReason"]) delete old.z[k];
  const o = parse(old);
  assert.deepEqual([o.z.expectedOpening, o.z.openingDiff, o.z.openingReason, o.cashMoves], [undefined, undefined, undefined, undefined]);

  const b = golden();
  b.z.openingDiff = -20.556;
  b.z.openingReason = `  ${"x".repeat(300)}  `;
  const d = parse(b);
  assert.equal(d.z.openingDiff, -20.56, "fark işaretli, iki ondalık");
  assert.equal(d.z.openingReason?.length, 200, "neden 200 karaktere kırpılır");
  b.z.expectedOpening = null;
  b.z.openingDiff = null;
  b.z.openingReason = "";
  const n = parse(b);
  assert.deepEqual([n.z.expectedOpening, n.z.openingDiff, n.z.openingReason], [null, null, null], "beklenen yok; boş neden null");
  assert.deepEqual(parse({ ...golden(), cashMoves: [] }).cashMoves, [], "hareketsiz gün boş dizi (eski LafPOS'tan ayrı)");
  const m = parse(golden()).cashMoves!;
  assert.deepEqual(m[0], { id: "01M5WDWP40S3V9J8M2N4P6Q8T0", kind: "harcama", amount: 120, description: "Buz", at: "2026-10-26T15:40:00.000Z", categoryId: 1 });
});

test("gövde: bozuk Faz 3 alanı günü reddetmez (400 LafPOS'ta kalıcı): alan düşer, günlüğe yazılır; bozuk tek hareket bütün listeyi düşürür", () => {
  const cases: [string, (b: ReturnType<typeof golden>) => void, string][] = [
    ["eksi beklenen", (b) => void (b.z.expectedOpening = -5), "z.expectedOpening"],
    ["metin fark", (b) => void (b.z.openingDiff = "100"), "z.openingDiff"],
    ["sayı neden", (b) => void (b.z.openingReason = 12), "z.openingReason"],
    ["dizi değil", (b) => void ((b as Record<string, unknown>).cashMoves = { id: 1 }), "cashMoves"],
    ["kimlik ULID değil", (b) => void (b.cashMoves[0].id = "hareket-1"), "cashMoves"],
    ["bilinmeyen tür", (b) => void (b.cashMoves[1].kind = "iade"), "cashMoves"],
    ["sıfır tutar", (b) => void (b.cashMoves[2].amount = 0), "cashMoves"],
    ["kesirli kategori", (b) => void (b.cashMoves[0].categoryId = 1.5), "cashMoves"],
    ["aynı kimlik iki kez", (b) => void (b.cashMoves[2].id = b.cashMoves[0].id), "cashMoves"],
  ];
  for (const [name, edit, field] of cases) {
    const b = golden();
    edit(b);
    const { value: r, warned } = quiet(() => parsePosDay(JSON.stringify(b), NOW));
    assert.ok(r.ok, `${name}: gün reddedilmez`);
    const dropped = field.startsWith("z.") ? r.data.z[field.slice(2) as "expectedOpening"] : r.data.cashMoves;
    assert.equal(dropped, undefined, `${name}: alan düşer`);
    assert.ok(warned.some((w) => w.includes(field)), `${name}: günlükte ${field}`);
  }
});

// ---------------------------------------------------------------- Ertesi günün beklenen açılışı (nextOpening)

const Z = { countedCash: 1_279.5 };
const report = { id: 7, countedCash: 1_279.5, handedOver: 0 };
/** LafPOS'un otomatik raporunun son yazdığı değerler (lafpos_day_ends.autoValues) */
const auto = (counted: number | null, handed = 0) => ({ reportId: 7, autoValues: { countedCash: counted, handedOver: handed } as unknown as AutoValues });

test("devir: sayılmayan gün (geçişten önce) null; rapor yoksa LafPOS'un sayımı, sayım da yoksa null", () => {
  assert.equal(nextOpeningOf({ counted: false, z: Z, report, auto: null }), null);
  assert.deepEqual(nextOpeningOf({ counted: true, z: Z, report: null, auto: null }), { amount: 1_279.5, source: "lafpos" });
  assert.equal(nextOpeningOf({ counted: true, z: { countedCash: null }, report: null, auto: null }), null);
  assert.equal(nextOpeningOf({ counted: true, z: null, report: null, auto: null }), null);
});

test("devir: kişinin yazdığı ya da üstlendiği Kasa raporu geçer (sayılan − teslim)", () => {
  const human = { id: 9, countedCash: 1_500, handedOver: 300 };
  assert.deepEqual(nextOpeningOf({ counted: true, z: Z, report: human, auto: null }), { amount: 1_200, source: "kasa_raporu" });
  // Rapor LafPOS'un otomatiğiydi ama kişi üstlendi (durum başka raporu gösteriyor ya da otomatik değer silinmiş)
  assert.deepEqual(nextOpeningOf({ counted: true, z: Z, report: human, auto: { reportId: 3, autoValues: null } }), { amount: 1_200, source: "kasa_raporu" });
  assert.deepEqual(nextOpeningOf({ counted: true, z: Z, report: { ...human, id: 7 }, auto: { reportId: 7, autoValues: null } }), { amount: 1_200, source: "kasa_raporu" });
});

test("devir: LafPOS'un elle değişmemiş otomatik raporunda gelen gövdenin sayımı (rapor yanıttan sonra yazılır; yeniden sayımın yanıtı eskiyi söylemez)", () => {
  // İlk gönderim 1.279,50 saydı, rapor öyle yazıldı; yeniden sayım 1.300,00 diyor: rapor da 1.300,00 olacak
  assert.deepEqual(nextOpeningOf({ counted: true, z: { countedCash: 1_300 }, report, auto: auto(1_279.5) }), { amount: 1_300, source: "kasa_raporu" });
  // Sayımsız yeniden kapanış: rapor sayımını korur
  assert.deepEqual(nextOpeningOf({ counted: true, z: { countedCash: null }, report, auto: auto(1_279.5) }), { amount: 1_279.5, source: "kasa_raporu" });
  // Kişi otomatik raporun sayımını düzeltti (1.250,00): düzeltmesi kalır
  assert.deepEqual(nextOpeningOf({ counted: true, z: { countedCash: 1_300 }, report: { ...report, countedCash: 1_250 }, auto: auto(1_279.5) }), { amount: 1_250, source: "kasa_raporu" });
  // Kişi teslim yazdı (200): sayım yeni gövdeden, teslim kişiden
  assert.deepEqual(nextOpeningOf({ counted: true, z: { countedCash: 1_300 }, report: { ...report, handedOver: 200 }, auto: auto(1_279.5) }), { amount: 1_100, source: "kasa_raporu" });
});

test("devir: otomatik raporun hesabı birleştirmenin (mergeAuto) aynısı", () => {
  const base = { ...autoValuesOf("2026-11-22", zOf(1_279.5), { count: 0, total: 0, note: null }, null) };
  const scenarios: [string, Partial<AutoValues>, number | null][] = [
    ["değişmemiş, yeni sayım", {}, 1_300],
    ["sayım elle düzeltildi", { countedCash: 1_250 }, 1_300],
    ["teslim elle yazıldı", { handedOver: 150 }, 1_300],
    ["sayımsız yeniden kapanış", {}, null],
  ];
  for (const [name, edited, next] of scenarios) {
    const current = { ...base, ...edited } as AutoValues;
    const merged = mergeAuto(current, base, autoValuesOf("2026-11-22", zOf(next), { count: 0, total: 0, note: null }, null)).values;
    const got = nextOpeningOf({
      counted: true,
      z: { countedCash: next },
      report: { id: 7, countedCash: Number(current.countedCash), handedOver: Number(current.handedOver) },
      auto: { reportId: 7, autoValues: base },
    });
    assert.deepEqual(got, { amount: Math.round((Number(merged.countedCash) - Number(merged.handedOver)) * 100) / 100, source: "kasa_raporu" }, name);
  }
  // autoValuesOfReport'un okuduğu rapor alanlarıyla da aynı (sayılan ve teslim)
  assert.equal(autoValuesOfReport({ ...base, countedCash: 10, handedOver: 2 } as never).countedCash, 10);
});

function zOf(countedCash: number | null) {
  return {
    zNo: 11,
    receipts: 26,
    zTotal: 6_285,
    cash: 1_255,
    card: 5_030,
    mealCard: 0,
    online: 0,
    other: 0,
    offRevenue: 1_065,
    discounts: 90,
    openingCash: 1_120,
    cashOut: 800,
    countedCash,
    handedOver: 0,
    cashDiff: countedCash === null ? null : -295.5,
  };
}

// ---------------------------------------------------------------- Kasadan çıkanlar: plan

const move = (id: string, kind: PosCashMove["kind"], amount: number, categoryId: number | null = null): PosCashMove => ({
  id: id.padEnd(26, "0"),
  kind,
  amount,
  description: kind,
  at: "2026-11-22T13:45:00.000Z",
  categoryId,
});
const row = (id: number, kind: "harcama" | "teslim", amount: number, lafposId: string | null = null, createdAt = `2026-11-22T0${id}:00:00.000Z`): LafposCashOutRow => ({
  id,
  kind,
  amount,
  lafposId: lafposId && lafposId.padEnd(26, "0"),
  createdAt: new Date(createdAt),
});

test("plan: yeni hareket satır olur, aynı kimlik yeniden gelince satırı günceller (eklemez); giriş satıra girmez", () => {
  const moves = [move("01A", "harcama", 800, 3), move("01B", "teslim", 200), move("01C", "giris", 50)];
  const first = planLafposCashOuts(moves, []);
  assert.deepEqual(
    first.insert.map((m) => [m.id.slice(0, 3), m.kind]),
    [
      ["01A", "harcama"],
      ["01B", "teslim"],
    ],
  );
  assert.deepEqual([first.adopt, first.update, first.remove], [[], [], []]);
  const again = planLafposCashOuts(moves, [row(1, "harcama", 800, "01A"), row(2, "teslim", 200, "01B")]);
  assert.deepEqual([again.insert, again.adopt, again.update, again.remove], [[], [], [], []], "aynı gövde: değişiklik yok");
  const changed = planLafposCashOuts([move("01A", "harcama", 850, 3), move("01B", "teslim", 200)], [row(1, "harcama", 800, "01A"), row(2, "teslim", 200, "01B")]);
  assert.deepEqual(
    changed.update.map((u) => [u.rowId, u.move.amount]),
    [[1, 850]],
  );
});

test("plan: elle girilmiş eş (aynı tür, aynı tutar, LafPOS'a bağlanmamış) bire bir sahiplenilir, en eskisi önce; tutmayan elle satır kalır", () => {
  const rows = [row(1, "harcama", 800), row(2, "harcama", 800), row(3, "teslim", 800), row(4, "harcama", 120.01)];
  const p = planLafposCashOuts([move("01A", "harcama", 800, 3), move("01B", "harcama", 120)], rows);
  assert.deepEqual(
    p.adopt.map((a) => [a.rowId, a.move.id.slice(0, 3)]),
    [[1, "01A"]],
    "en eski eş; teslim ve 1 kuruş farklı satır sahiplenilmez",
  );
  assert.deepEqual(
    p.insert.map((m) => m.id.slice(0, 3)),
    ["01B"],
  );
  // İki aynı hareket iki ayrı elle satırı sahiplenir (bire bir)
  const two = planLafposCashOuts([move("01A", "harcama", 800), move("01B", "harcama", 800), move("01C", "harcama", 800)], rows);
  assert.deepEqual(
    two.adopt.map((a) => a.rowId),
    [1, 2],
  );
  assert.equal(two.insert.length, 1);
  // Başka LafPOS satırı (kimliği gövdede yok) sahiplenilmez, kaldırılır
  const gone = planLafposCashOuts([move("01A", "harcama", 800)], [row(5, "harcama", 800, "01Z")]);
  assert.deepEqual([gone.adopt, gone.insert.length, gone.remove], [[], 1, [5]]);
});

test("plan: gövdede olmayan LafPOS satırı kaldırılır; elle girilmiş satıra dokunulmaz", () => {
  const p = planLafposCashOuts([move("01A", "harcama", 800)], [row(1, "harcama", 800, "01A"), row(2, "teslim", 200, "01B"), row(3, "harcama", 45)]);
  assert.deepEqual([p.remove, p.insert, p.adopt, p.update], [[2], [], [], []]);
  assert.deepEqual(planLafposCashOuts([], [row(1, "harcama", 800, "01A"), row(3, "harcama", 45)]).remove, [1], "hareketsiz gün: LafPOS satırları kalkar");
});

test("kilit: LafPOS satırının tutarı, türü ve günü değişmez; yer, belge, fotoğraf ve kategori serbest; elle satır serbest", () => {
  const prev = { lafposId: "01M81R1GV0K7Q2W9X4Y6Z8A0B2", kind: "harcama" as const, amount: 800, date: "2026-11-22" };
  assert.equal(lafposCashOutChange(prev, { kind: "harcama", amount: 800, date: "2026-11-22" }), null);
  assert.equal(lafposCashOutChange(prev, { kind: "harcama", amount: 800.004, date: "2026-11-22" }), null, "kuruş altı yuvarlama");
  assert.equal(lafposCashOutChange(prev, { kind: "harcama", amount: 750, date: "2026-11-22" }), LAFPOS_CASH_OUT_TEXT.locked);
  assert.equal(lafposCashOutChange(prev, { kind: "teslim", amount: 800, date: "2026-11-22" }), LAFPOS_CASH_OUT_TEXT.locked);
  assert.equal(lafposCashOutChange(prev, { kind: "harcama", amount: 800, date: "2026-11-21" }), LAFPOS_CASH_OUT_TEXT.locked);
  assert.equal(lafposCashOutChange({ ...prev, lafposId: null }, { kind: "teslim", amount: 1, date: "2026-11-01" }), null);
  for (const t of Object.values(LAFPOS_CASH_OUT_TEXT)) assert.match(t, /LafPOS/, "metin satırın kaynağını söyler");
});

// ---------------------------------------------------------------- Otomatik rapor ve gün görünümü

const NO_OUTS = { count: 0, total: 0, note: null };
const fullZ = (o: Record<string, unknown> = {}) => ({ ...zOf(1_279.5), ...o });

test("otomatik rapor: açılış farkının nedeni nota yazılır; panelin devir denetimi yoksa LafPOS'un farkı da", () => {
  // Panelde önceki rapor yok: LafPOS'un beklediği ve farkı nota
  const v = autoValuesOf("2026-11-23", fullZ({ openingCash: 1_300, expectedOpening: 1_279.5, openingDiff: 20.5, openingReason: "Bozuk para eklendi" }), NO_OUTS, null);
  assert.match(String(v.note), /Açılış LafPOS'ta beklenenden 20,50\s₺ fazla \(beklenen 1\.279,50\s₺\); neden: Bozuk para eklendi\./);
  // Panelin devriyle de tutmuyor: panelin cümlesi ve LafPOS'ta yazılan neden
  const c = autoValuesOf("2026-11-23", fullZ({ openingCash: 1_300, expectedOpening: 1_279.5, openingDiff: 20.5, openingReason: "Bozuk para eklendi" }), NO_OUTS, { date: "2026-11-22", amount: 1_279.5 });
  assert.match(String(c.note), /Açılış önceki raporun devrinden 20,50\s₺ fazla; LafPOS'taki açılış yazıldı\. Neden \(LafPOS\): Bozuk para eklendi\./);
  assert.doesNotMatch(String(c.note), /beklenenden/, "aynı fark iki kez yazılmaz");
  // Fark yok, neden yok: not değişmez
  const plain = autoValuesOf("2026-11-23", fullZ({ expectedOpening: 1_120, openingDiff: 0, openingReason: null }), NO_OUTS, null);
  assert.equal(plain.note, autoValuesOf("2026-11-23", fullZ(), NO_OUTS, null).note);
});

test("gün sonu e-postasının özeti Faz 3 alanlarıyla değişmez (yükseltmeden sonra yeniden gelen gün 'Düzeltildi' demez)", () => {
  const z = fullZ();
  const before = dayHash({ z, payments: [], ikram: [] });
  assert.equal(dayHash({ z: { ...z, expectedOpening: null, openingDiff: null, openingReason: null }, payments: [], ikram: [] }), before);
  assert.notEqual(dayHash({ z: { ...z, countedCash: 1_300 }, payments: [], ikram: [] }), before, "sayım değişti");
});

test("gün görünümü: açılışın beklenen tutarı, farkı ve nedeni; hareketler türüne göre (giriş yalnız burada)", () => {
  const d = parse(golden());
  const detail = lafposDayDetail(d);
  const sec = (t: string) => Object.fromEntries(detail.sections.find((x) => x.title === t)?.rows ?? []);
  assert.deepEqual(sec("Kasa açılışı (LafPOS)"), { "Beklenen açılış": money(1_400), "Açılış farkı": `+${money(100)}`, "Farkın nedeni": "Sabah bozuk para eklendi" });
  assert.deepEqual(sec("Kasa hareketleri (LafPOS)"), { Harcama: `1 · ${money(120)}`, Teslim: `1 · ${money(200)}`, "Kasaya giren (giriş)": `1 · ${money(50)}` });
  const kabul = parse(JSON.parse(read("tests/fixtures/kabul-gunu-2026-11-22.json")));
  const k = lafposDayDetail(kabul);
  const ks = (t: string) => Object.fromEntries(k.sections.find((x) => x.title === t)?.rows ?? []);
  assert.deepEqual(ks("Kasa açılışı (LafPOS)"), { "Beklenen açılış": "bilinmiyor" });
  assert.deepEqual(ks("Kasa hareketleri (LafPOS)"), { Harcama: `1 · ${money(800)}`, Teslim: "yok", "Kasaya giren (giriş)": "yok" });
  // Eski LafPOS'un gününde bölüm yok (uydurulmaz)
  const old: Record<string, unknown> & { z: Record<string, unknown> } = golden();
  delete old.cashMoves;
  for (const key of ["expectedOpening", "openingDiff", "openingReason"]) delete old.z[key];
  const titles = lafposDayDetail(parse(old)).sections.map((x) => x.title);
  assert.ok(!titles.includes("Kasa açılışı (LafPOS)") && !titles.includes("Kasa hareketleri (LafPOS)"), titles.join(", "));
});
