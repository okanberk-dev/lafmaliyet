// İki şubenin kasa satırları ay bilgisinde (denetim 13 Kasım 2026, P02; src/lib/cash-month.ts, src/lib/calc/engine.ts):
// "Tümü"de açık gün günde bir kez sayılır (HM-01, KP-03, KP-X1), kaynak önceliği (gün, şube) için (HM-03), elle yazılan
// şube şube çözülüp toplanır (HM-02), yeni şubenin açılış ayı açılış gününden sayılır (HM-04), oran ayın gününü aşmaz
// ve biten ay ayın sonuna kadar oranlanır (HM-10). Veritabanıyla: tests/sube-kasa-ay-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-kasa-ay.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { monthDays } from "../src/app/panel/dashboard-daily";
import { prorationDays } from "../src/lib/calc/engine";
import { ALL_BRANCHES, monthTotalsLocked, tillOpenedOn } from "../src/lib/branches";
import { kasaMonthLine, manualOf, resolveBranchMonths, resolveMonths, tillMonths, type MonthEntry, type TillRow } from "../src/lib/cash-month";
import { addDays } from "../src/lib/reminders";

const row = (date: string, branchId: string, o: Partial<TillRow> = {}): TillRow => ({
  date,
  branchId,
  zTotal: branchId === "tuzla" ? 10_000 : 6_000,
  card: branchId === "tuzla" ? 6_000 : 3_000,
  mealCard: 0,
  discounts: null,
  offRevenue: null,
  ...o,
});

/** [from, to] günleri, ikisi de dahil */
const span = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/** 1–12 Kasım her gün: Tuzla 10.000, Marina 6.000 (denetçinin senaryosu) */
const twelve = (): TillRow[] => span("2026-11-01", "2026-11-12").flatMap((d) => [row(d, "tuzla"), row(d, "marina")]);

const entry = (month: string, o: Partial<MonthEntry> = {}): MonthEntry => ({ month, openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null, ...o });

/** Satırların en eski günü */
const first = (rows: readonly TillRow[]): string | null => rows.reduce<string | null>((a, r) => (a === null || r.date < a ? r.date : a), null);

/**
 * "Tümü": şube şube tillMonths, bütün satırların ayı ve şube altkümelerinin günleri (src/server/data/dataset.ts ile aynı
 * kurgu; açılış günü tillOpenedOn ile: boşsa Tuzla dışındaki şube ilk satırında açılmış sayılır)
 */
function tumu(rows: TillRow[], through: string, entries: (MonthEntry & { branchId: string })[] = [], opened: Record<string, string | null> = {}) {
  const ids = [...new Set([...rows.map((r) => r.branchId!), ...entries.map((e) => e.branchId)])];
  const of = (rs: TillRow[], id: string | undefined) =>
    tillMonths(rs, through, undefined, undefined, undefined, undefined, undefined, id ? tillOpenedOn(id, opened[id] ?? null, first(rs)) : null);
  const rowsOf = (sel: readonly string[]) => rows.filter((r) => sel.includes(r.branchId!));
  const earliestBranch = (rs: TillRow[]) => rs.find((r) => r.date === first(rs))?.branchId;
  return resolveBranchMonths(
    ids.map((id) => ({ branchId: id, entries: entries.filter((e) => e.branchId === id), tills: of(rowsOf([id]), id) })),
    of(rows, earliestBranch(rows)),
    (sel) => of(rowsOf(sel), earliestBranch(rowsOf(sel))),
  );
}

test("açık gün günde bir kez: iki şube aynı gün açıkken bir gün; ciro toplam (HM-01, KP-03)", () => {
  const [t] = tillMonths(twelve(), "2026-11-12");
  assert.equal(t.openDays, 12, "24 satır, 12 gün");
  assert.equal(t.reported, 12);
  assert.equal(t.posRevenue, 192_000);
  // Tek şubesi Z'siz olan gün yine açık (öteki şube satış yaptı)
  const [u] = tillMonths([...twelve(), row("2026-11-13", "tuzla", { zTotal: 0, card: 0 }), row("2026-11-13", "marina")], "2026-11-13");
  assert.equal(u.openDays, 13);
  assert.equal(u.reported, 13);
});

test("kaynak önceliği (gün, şube): Tuzla'nın raporu Marina'nın aynı günkü föyünü ve LafPOS gün sonunu düşürmez (HM-03)", () => {
  const rows = [
    ...twelve().filter((r) => !(r.branchId === "marina" && r.date === "2026-11-12")),
    row("2026-11-12", "marina", { source: "modpos", zTotal: 9_000, card: 5_000, receipts: 70 }),
    // Aynı şubenin aynı günü: rapor föyü yener
    row("2026-11-11", "tuzla", { source: "modpos", zTotal: 99_999, card: 0, receipts: 1 }),
  ];
  const [t] = tillMonths(rows, "2026-11-12");
  assert.equal(t.posRevenue, 120_000 + 66_000 + 9_000, "Marina'nın föyü sayıldı, Tuzla'nın föyü raporun altında kaldı");
  assert.equal(t.openDays, 12);
  assert.deepEqual(t.modpos, ["2026-11-12"]);
  // LafPOS gün sonu da şube şube
  const lafpos = [...twelve().filter((r) => !(r.branchId === "marina" && r.date === "2026-11-05")), row("2026-11-05", "marina", { source: "lafpos", zTotal: 7_000, receipts: 40 })];
  assert.equal(tillMonths(lafpos, "2026-11-12")[0].posRevenue, 120_000 + 66_000 + 7_000);
});

test("föyün kesintisiz başı şube şube: öteki şubenin raporu bir şubenin eski föylerini saydırmaz", () => {
  // Tuzla Ekim'den beri raporlu; Marina'nın föyü 1-3 Kasım, 4 Kasım boşluk, raporu 5 Kasım'dan
  const rows = [
    ...span("2026-10-25", "2026-11-10").map((d) => row(d, "tuzla")),
    ...span("2026-11-01", "2026-11-03").map((d) => row(d, "marina", { source: "modpos", receipts: 10 })),
    ...span("2026-11-05", "2026-11-10").map((d) => row(d, "marina")),
  ];
  const [, nov] = tillMonths(rows, "2026-11-10");
  assert.equal(nov.posRevenue, 10 * 10_000 + 6 * 6_000, "Marina'nın kopuk föyleri sayılmadı");
  const [marina] = tillMonths(
    rows.filter((r) => r.branchId === "marina"),
    "2026-11-10",
  );
  assert.equal(marina.posRevenue, 6 * 6_000, "şubenin kendi ayıyla aynı");
});

test("şubesi olmayan satır varsa (eski çağıran) satırlar tek şubenin: aynı günün föyü raporun altında kalır", () => {
  const rows: TillRow[] = [
    { date: "2026-11-01", zTotal: 10_000, card: 6_000, mealCard: 0, discounts: null, offRevenue: null },
    { date: "2026-11-01", branchId: "tuzla", zTotal: 9_000, card: 5_000, mealCard: 0, discounts: null, offRevenue: 0, source: "modpos", receipts: 70 },
  ];
  const [t] = tillMonths(rows, "2026-11-01");
  assert.equal(t.posRevenue, 10_000);
  assert.equal(t.modpos, undefined);
});

test("açılış günü: 5 Kasım'da açılan şube o günden beri raporluysa ay yarım değil, ciro ve açık gün kasadan (HM-04)", () => {
  const marina = span("2026-11-05", "2026-11-12").map((d) => row(d, "marina"));
  const [before] = tillMonths(marina, "2026-11-12");
  assert.equal(before.partialFrom, "2026-11-05", "açılış günü bilinmezken eski kural: elle girilir");
  const [t] = tillMonths(marina, "2026-11-12", undefined, undefined, undefined, undefined, undefined, "2026-11-05");
  assert.equal(t.partialFrom, null);
  assert.equal(t.from, "2026-11-05");
  const [m] = resolveMonths([], [t]);
  assert.deepEqual([m.openDays, m.posRevenue, m.sources?.posRevenue], [8, 48_000, "kasa"]);
  assert.equal(kasaMonthLine(m), "Bu ayın açık gün ve cirosu kasa raporlarından");
  // Açılıştan sonra başlayan raporlar yine yarım (o günler bilinmiyor)
  assert.equal(tillMonths(marina.slice(2), "2026-11-12", undefined, undefined, undefined, undefined, undefined, "2026-11-05")[0].partialFrom, "2026-11-07");
  // "Tümü": Marina'nın açılış ayı da toplamda
  const [all] = tumu([...span("2026-11-01", "2026-11-12").map((d) => row(d, "tuzla")), ...marina], "2026-11-12", [], { marina: "2026-11-05" });
  assert.deepEqual([all.openDays, all.posRevenue], [12, 168_000]);
});

test("açılış günü boş: Tuzla başından beri, öteki şube ilk satırında açılmış sayılır; Tümü'nün cirosundan düşmez", () => {
  assert.equal(tillOpenedOn("marina", "2026-11-03", "2026-11-05"), "2026-11-03", "yazılı açılış günü geçer");
  assert.equal(tillOpenedOn("marina", null, "2026-11-05"), "2026-11-05");
  assert.equal(tillOpenedOn("tuzla", null, "2026-10-20"), null, "Tuzla'nın eski verisi: ilk ayı yarım kalır");
  const tuzla = span("2026-11-01", "2026-11-12").map((d) => row(d, "tuzla"));
  const marina = span("2026-11-05", "2026-11-11").map((d) => row(d, "marina"));
  // İncelemedeki durum: Marina'nın açılış günü boş, raporları 5 Kasım'dan. Tümü 120.000 değil 162.000
  const [all] = tumu([...tuzla, ...marina], "2026-11-12");
  assert.deepEqual([all.openDays, all.posRevenue, all.sources?.posRevenue], [12, 120_000 + 42_000, "kasa"]);
  assert.equal(all.byBranch?.marina.kasa?.till.partialFrom, null);
  assert.equal(all.posRevenue, all.kasa?.values.posRevenue, "kasa bilgisi ve ciro aynı");
  // Açılış günü yazılı ama raporlar sonra başladıysa ay yarım: Tümü'de yalnız Tuzla, Marina elle girilir
  const [late] = tumu([...tuzla, ...marina], "2026-11-12", [], { marina: "2026-11-01" });
  assert.equal(late.byBranch?.marina.kasa?.till.partialFrom, "2026-11-05");
  assert.equal(late.posRevenue, 120_000);
});

test("Tümü'nün açık günü: kasadan gelen şubelerin günleri birleşir; elle daha az gün yazan şubenin kasa günleri girmez", () => {
  // Tuzla 1-10 Kasım, Marina 11-20 Kasım kasadan; Marina açık günü elle 5 yazdı
  const rows = [...span("2026-11-01", "2026-11-10").map((d) => row(d, "tuzla")), ...span("2026-11-11", "2026-11-20").map((d) => row(d, "marina"))];
  const [both] = tumu(rows, "2026-11-20", [], { marina: "2026-11-11" });
  assert.equal(both.openDays, 20, "ikisi de kasadan: günlerin birleşimi");
  const [typed] = tumu(rows, "2026-11-20", [{ ...entry("2026-11", { openDays: 5 }), branchId: "marina" }], { marina: "2026-11-11" });
  assert.equal(typed.byBranch?.marina.openDays, 5);
  assert.equal(typed.openDays, 10, "Tuzla'nın 10 günü ile Marina'nın yazdığı 5'in büyüğü; Marina'nın kasa günleri sayılmaz");
  assert.equal(typed.kasa?.till.openDays, 20, "kasa bilgisi yine bütün şubelerin");
});

test("Tümü'de ciro ve açık gün yalnız tek şube açıkken yazılır (birden çok şubenin toplamı kilitli)", () => {
  const b = (kind: "fiziksel" | "online", active = true) => ({ kind, active });
  assert.equal(monthTotalsLocked(ALL_BRANCHES, [b("fiziksel"), b("fiziksel"), b("online")]), true);
  assert.equal(monthTotalsLocked("marina", [b("fiziksel"), b("fiziksel")]), false, "şube seçiliyken yazılır");
  assert.equal(monthTotalsLocked(ALL_BRANCHES, [b("fiziksel"), b("fiziksel", false), b("online")]), false, "tek açık şube: Tümü o şube");
});

test("Tümü şubelerin toplamı: bir şubenin elle yazdığı öteki şubenin kasa cirosunu ezmez (HM-02)", () => {
  const rows = twelve();
  const [plain] = tumu(rows, "2026-11-12");
  assert.deepEqual([plain.openDays, plain.posRevenue, plain.cardShare, plain.sources?.posRevenue], [12, 192_000, 0.5625, "kasa"]);
  const [m] = tumu(rows, "2026-11-12", [{ ...entry("2026-11", { openDays: 12, posRevenue: 80_000, cardShare: 0.25 }), branchId: "marina" }]);
  assert.equal(m.posRevenue, 120_000 + 80_000, "Tuzla'nın kasası + Marina'nın elle yazdığı");
  assert.equal(m.openDays, 12);
  assert.equal(m.sources?.posRevenue, "manual");
  // Kartlı oran ciro ağırlıklı: (0,6 × 120.000 + 0,25 × 80.000) ÷ 200.000
  assert.equal(m.cardShare, 0.46);
  // Şube şube sonuç: "Tümü"de yazan form kendi şubesininkini gösterir
  assert.equal(manualOf(m.byBranch?.tuzla, "posRevenue"), null, "Tuzla'nın elle yazdığı yok");
  assert.equal(manualOf(m.byBranch?.marina, "posRevenue"), 80_000);
  assert.equal(m.byBranch?.tuzla.posRevenue, 120_000);
  // İndirim ve ödenmez de toplanır
  const [d] = tumu(rows, "2026-11-12", [
    { ...entry("2026-11", { discounts: 300, offRevenue: 50 }), branchId: "tuzla" },
    { ...entry("2026-11", { discounts: 200 }), branchId: "marina" },
  ]);
  assert.deepEqual([d.discounts, d.offRevenue], [500, 50]);
});

test("Tümü: elle yazılan açık gün günleri bilinmediği için şubelerin en büyüğü; ayın gününü aşmaz", () => {
  const rows = span("2026-11-01", "2026-11-12").map((d) => row(d, "tuzla"));
  const [m] = tumu(rows, "2026-11-30", [{ ...entry("2026-11", { openDays: 30, posRevenue: 150_000 }), branchId: "marina" }]);
  assert.equal(m.openDays, 30);
  assert.equal(m.posRevenue, 270_000);
});

test("tek şube: Tümü'nün çözümü eskisiyle aynı (yalnız şube şube sonuç eklenir)", () => {
  const rows = span("2026-11-01", "2026-11-12").map((d) => row(d, "tuzla", { discounts: 10 }));
  const e = entry("2026-11", { note: "not", offRevenue: 25 });
  const [one] = tumu(rows, "2026-11-12", [{ ...e, branchId: "tuzla" }]);
  const [old] = resolveMonths([e], tillMonths(rows, "2026-11-12"));
  const { byBranch, ...rest } = one;
  assert.deepEqual(rest, old);
  assert.deepEqual(Object.keys(byBranch ?? {}), ["tuzla"]);
});

test("oran ayın gününü aşmaz; biten ay ayın sonuna kadar oranlanır (KP-X1, HM-10)", () => {
  const [t] = tillMonths(twelve(), "2026-11-12");
  const [m] = resolveMonths([], [t]);
  assert.equal(prorationDays(m), 12, "süren ay: bugüne kadar, şube sayısıyla katlanmaz");
  // Elle yazılmış açık gün de ayın gününde kalır
  assert.equal(prorationDays({ month: "2026-11", openDays: 62, sources: undefined, kasa: null }), 30);
  // 1 Aralık 01:00: Kasım bitti ama son günün raporu daha beklenir (iş günü 05:00'te değişir): kasa 29 Kasım'a kadar
  const [nov] = resolveMonths([], tillMonths(span("2026-11-01", "2026-11-29").map((d) => row(d, "tuzla")), "2026-11-29"));
  assert.equal(prorationDays(nov), 29);
  assert.equal(prorationDays(nov, true), 30, "biten ay ayın sonuna kadar");
  // Açılış ayında biten ay açılış gününden ayın sonuna kadar
  const [opened] = resolveMonths([], tillMonths(span("2026-11-05", "2026-11-29").map((d) => row(d, "marina")), "2026-11-29", undefined, undefined, undefined, undefined, undefined, "2026-11-05"));
  assert.equal(prorationDays(opened, true), 26);
});

test("günlük ciro grafiği: aynı günün şubeleri tek çubuk, toplamı ay cirosu (HM-06)", () => {
  const rows = twelve();
  const days = monthDays(rows, "2026-11");
  assert.equal(days.length, 12);
  assert.deepEqual(days[0], { date: "2026-11-01", revenue: 16_000 });
  assert.equal(new Set(days.map((d) => d.date)).size, days.length, "anahtar (gün) yinelenmez");
  const [t] = tillMonths(rows, "2026-11-12");
  assert.equal(days.reduce((a, d) => a + d.revenue, 0), t.posRevenue);
  assert.equal(days.length, t.openDays);
});
