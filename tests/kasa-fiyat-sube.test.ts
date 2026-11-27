// Kasada bekleyen fiyat şube başına (şube kapsamı A3, 24 Kasım 2026; docs/FIYATLAR.md › Kasaya işle): seçimin kasalarının
// toplamı (combineTillPos), Bugün satırının kasa başına sayısı (posRow) ve kaynak kuralları: okuyucular bir şubenin
// kasasına bakar, işaret eylemi formun kasasını alır, göç eski değerleri Tuzla'ya ve (süzgeçle) Marina'ya kopyalar.
// Veritabanıyla gidip gelen kurallar tests/kasa-fiyat-sube-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/kasa-fiyat-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayTasks, type DayFacts } from "../src/app/panel/bugun/logic";
import { combineTillPos, tillPosCounts, type TillPosSummary } from "../src/lib/prices/pos";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const at = (iso: string) => new Date(iso);

const tuzla = (o: Partial<TillPosSummary> = {}): TillPosSummary => ({ count: 3, oldest: at("2026-11-20T10:00:00Z"), newest: at("2026-11-23T10:00:00Z"), kasa: "ModPOS", name: "Tuzla", ...o });
const marina = (o: Partial<TillPosSummary> = {}): TillPosSummary => ({ count: 1, oldest: at("2026-11-22T02:00:00Z"), newest: at("2026-11-24T10:00:00Z"), kasa: "AsilPOS", name: "Marina", ...o });

test("toplam: tek kasada bugünkü gibi (kasa başına sayı yok)", () => {
  const one = combineTillPos([{ ...tuzla(), name: null }]);
  assert.equal(one.count, 3);
  assert.equal(one.kasa, "ModPOS");
  assert.equal(one.byBranch, null);
  assert.equal(one.oldest?.toISOString(), "2026-11-20T10:00:00.000Z");
  const empty = combineTillPos([{ ...marina(), count: 0, oldest: null, newest: null, name: null }]);
  assert.equal(empty.count, 0);
  assert.equal(empty.kasa, "AsilPOS", "bekleyen yokken de kasanın adı");
  assert.equal(empty.oldest, null);
});

test("toplam: Tümü'de iki kasa; sayı toplanır, en eski ve en yeni kasalar arasında, ModPOS kasası öne geçer", () => {
  const both = combineTillPos([tuzla(), marina()]);
  assert.equal(both.count, 4);
  assert.equal(both.oldest?.toISOString(), "2026-11-20T10:00:00.000Z");
  assert.equal(both.newest?.toISOString(), "2026-11-24T10:00:00.000Z");
  assert.equal(both.kasa, "ModPOS", "elle işlenecek iş ModPOS'ta");
  assert.deepEqual(both.byBranch, [
    { name: "Tuzla", count: 3 },
    { name: "Marina", count: 1 },
  ]);
  // Yalnız Marina bekliyorsa: kasa AsilPOS, Tuzla sayılmaz
  const onlyMarina = combineTillPos([tuzla({ count: 0, oldest: null, newest: null }), marina()]);
  assert.equal(onlyMarina.kasa, "AsilPOS");
  assert.deepEqual(onlyMarina.byBranch, [{ name: "Marina", count: 1 }]);
  assert.equal(tillPosCounts(both.byBranch), "Tuzla 3, Marina 1");
  assert.equal(tillPosCounts(null), "");
});

test("Bugün: Tümü'de kasa başına sayı satırın açıklamasında; tek kasada bugünkü metin", () => {
  const NOON = at("2026-11-24T11:00:00Z");
  const stock = { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: true, prevCounted: 40, prevTotal: 40 };
  const base: DayFacts = { role: "admin", now: NOON, cash: { today: null, yesterday: null, firstDate: null }, stock, system: [], payments: [], invoices: { review: 0 } };
  const row = (pos: DayFacts["pos"]) => dayTasks({ ...base, pos }).find((t) => t.key === "modpos");
  const both = combineTillPos([tuzla(), marina()]);
  const r = row({ count: both.count, oldest: both.oldest!.toISOString(), kasa: both.kasa, byBranch: both.byBranch });
  assert.ok(r, "satır var");
  assert.match(r.detail, /^Kasada değişecek 4 fiyat \(Tuzla 3, Marina 1\): ModPOS'ta elle değiştirip/);
  const single = row({ count: 3, oldest: tuzla().oldest!.toISOString(), kasa: "ModPOS", byBranch: null });
  assert.match(single!.detail, /^Kasada değişecek 3 fiyat: ModPOS'ta elle/);
  // Personel: yalnız ModPOS kasaları (today-ops süzer), sayı yine kasa başına
  const staff = dayTasks({ role: "staff", now: NOON, cash: { today: null, yesterday: null, firstDate: null }, stock, waste: { count: 0, zayi: null, ikram: null }, pos: { count: 3, oldest: null, kasa: "ModPOS", byBranch: [{ name: "Tuzla", count: 3 }] } }).find(
    (t) => t.key === "modpos",
  );
  assert.equal(staff?.detail, "ModPOS'ta değişecek 3 fiyat (Tuzla 3); değiştirdikçe işaretleyin.");
});

test("kaynak: okuyucular bir şubenin kasasına bakar (pos_stale ve şube), işaretler kasanın şubesini yazar", () => {
  const prices = read("src/server/data/prices.ts");
  const staff = read("src/server/data/pos-staff.ts");
  for (const [name, src] of [
    ["posPendingSummary", prices],
    ["loadPosChecklist", prices],
    ["loadStaffPosList", staff],
    ["staffPosSummary", staff],
  ] as const) {
    const start = src.indexOf(`export async function ${name}`);
    const body = src.slice(start, src.indexOf("\nexport ", start + 1));
    assert.match(body, /\.innerJoin\(s\.posStale, posStaleJoin\(sc\)\)/, `${name}: şubenin kasası`);
  }
  // Son işaretlenenler ve personelin son işaretleri: seçimin kasaları, aynı şubenin kasa satırı
  assert.match(prices, /inArray\(m\.branchId, branchIds\)/);
  assert.match(prices, /\.leftJoin\(s\.posStale, and\(eq\(s\.posStale\.productId, m\.productId\), eq\(s\.posStale\.branchId, m\.branchId\)\)\)/);
  assert.match(prices, /selectDistinctOn\(\[m\.productId, m\.branchId\]/, "son işaret şube başına");
  assert.match(staff, /eq\(s\.posMarks\.branchId, branchId\)/);
  const till = read("src/server/data/till-scope.ts");
  assert.match(till, /return and\(eq\(s\.posStale\.productId, s\.products\.id\), eq\(s\.posStale\.branchId, till\.branchId\)\)!;/);
  // "Tümü"de birden çok kasa açıkken her kasa ayrı; tek şubede (kilitli personelde) onunki
  assert.match(till, /if \(scope !== ALL_BRANCHES \|\| tills\.length < 2\) return \[await loadTillScope\(db, now\)\];/);
  // İşaret eylemi formun kasasını alır; "Tümü"de birden çok kasada kasa sorulur
  const action = read("src/server/actions/pos-marks.ts");
  assert.match(action, /const till = await formBranch\(zFormBranch\.parse\(branchId\), "till", \{ requireExplicit: true \}\);/);
  assert.match(action, /markPos\(getDb\(\), \{ id: me\.id, name: me\.name, role: me\.role \}, data, new Date\(\), till\)/);
  const core = read("src/server/prices/pos-marks.ts");
  assert.match(core, /\.where\(and\(eq\(m\.productId, mark\.productId\), eq\(m\.branchId, mark\.branchId\)\)\)/, "geri almada son işaret şubenin");
  // Sayfalar ve ürün kartı kasanın kimliğini gönderir
  assert.match(read("src/components/panel/pos-checklist.tsx"), /markPosDone\([^\n]*, props\.branchId\)/);
  assert.match(read("src/app/panel/urunler/[id]/price-history-card.tsx"), /markPosDone\(\[\{ productId: product\.id, price: history\.price! \}\], till\.branchId\)/);
  assert.match(read("src/app/panel/urunler/fiyatlar/page.tsx"), /branchId=\{t\.branchId\} branchName=\{t\.name\}/);
  assert.match(read("src/app/panel/kasa/fiyatlar/page.tsx"), /branchId=\{scope\.branchId\} branchName=\{scope\.name\}/);
});

test("kaynak: göç tek veri adımı; Tuzla'ya hepsi, Marina'ya okuyucunun süzgeciyle; ürün sütunları silinmez", () => {
  const schema = read("drizzle/0078_kasa_fiyat_sube.sql");
  assert.match(schema, /CREATE TABLE "pos_stale"/);
  assert.match(schema, /ALTER TABLE "pos_marks" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;/);
  assert.doesNotMatch(schema, /DROP COLUMN|pos_stale_price/, "eski sütunlar bir sürüm durur");
  const data = read("drizzle/0079_kasa_fiyat_sube_veri.sql");
  assert.match(data, /INSERT INTO "pos_stale" \("branch_id", "product_id", "stale_price", "stale_since"\)/);
  assert.match(data, /b\."id" <> 'marina'/);
  assert.match(data, /p\."site_menu_id" IS NULL/);
  assert.match(data, /pp\."on_site" = false AND pp\."changed_at" >= \(l\."gun" \|\| 'T05:00:00\+03:00'\)::timestamptz/);
  assert.match(data, /ON CONFLICT \("branch_id", "product_id"\) DO NOTHING;/);
  assert.doesNotMatch(data, /UPDATE "products"|DELETE FROM/);
  // Şube kimliği ve geçiş gününün en erkeni kodla aynı
  assert.match(read("src/lib/pos/tills.ts"), /export const LEGACY_POS_BRANCH_ID = "marina";/);
  assert.match(read("src/lib/constants.ts"), /export const ASILPOS_SWITCH_MIN = "2026-10-01";/);
  assert.match(data, />= '2026-10-01'/);
});
