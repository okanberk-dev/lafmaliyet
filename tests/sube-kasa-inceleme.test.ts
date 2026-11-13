// P03 incelemesinin düzeltmeleri, saf kısımlar (denetim 13 Kasım 2026): Bugün'ün kasa satırları "Tümü"de şube şube
// (bir şubenin raporu ötekinin satırını "gönderildi" yapmaz, işaretler birleşmez); Nakit planı'nın bakiye ipucu her
// kasanın devrini yazar; Claude'un kasa_raporlari'nda ve yazarkasanın ay satırında gün günde bir sayılır. Veritabanıyla:
// tests/sube-kasa-inceleme-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-kasa-inceleme.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { CASH_FLAGS, dayTasks, type CashLite, type DayFacts, type DayTask } from "../src/app/panel/bugun/logic";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { carryHint, tillCarries } from "../src/lib/cash-plan";
import { cashReportSummary, type CashReportLike } from "../src/lib/mcp/answers/cash";
import { okcMonth, type OkcRow } from "../src/lib/okc-z";

const plain = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const NOON = tr("2026-10-22T14:00");
const EVENING = tr("2026-10-22T21:00");
const STOCK = { month: "2026-10", counted: 0, total: 40, prevMonth: "2026-09", prevHasData: true, prevCounted: 40, prevTotal: 40 };
const lite = (date: string, o: Partial<CashLite> = {}): CashLite => ({ date, cashDiff: 0, zTotal: 12_400, cash: 3_100, card: 9_300, submittedByName: "Mehmet", revision: 1, note: null, ...o });
const byKey = (tasks: DayTask[]) => Object.fromEntries(tasks.map((t) => [t.key, t])) as Record<string, DayTask>;

test("Bugün (yönetici, Tümü): her şubenin dünkü ve bugünkü raporu kendi satırında; Marina'nın raporu Tuzla'nın eksiğini kapatmaz", () => {
  // Yalnız Marina girdi: Tuzla'nın dünkü raporu yok, Marina'nınki 120 ₺ eksik ve açılışı tutmuyor
  const facts: DayFacts = {
    role: "admin",
    now: EVENING,
    stock: STOCK,
    system: [],
    payments: [],
    invoices: { review: 0 },
    cash: {
      today: null,
      yesterday: null,
      firstDate: "2026-10-01",
      branch: "Tuzla",
      others: [{ id: "marina", branch: "Marina", today: lite("2026-10-22", { submittedByName: "Deniz" }), yesterday: lite("2026-10-21", { cashDiff: -120, flags: [CASH_FLAGS.carry] }), firstDate: "2026-10-15", closed: null }],
    },
  };
  const rows = byKey(dayTasks(facts));
  assert.equal(rows["kasa-dun"].title, "Dünkü kasa raporu · Tuzla");
  assert.equal(rows["kasa-dun"].badge, "Girilmedi");
  assert.equal(rows["kasa-dun-marina"].title, "Dünkü kasa raporu · Marina");
  assert.equal(rows["kasa-dun-marina"].status, "warn");
  assert.match(plain(rows["kasa-dun-marina"].badge!), /^120 ₺ eksik$/);
  assert.match(rows["kasa-dun-marina"].detail, /Açılış devirle tutmuyor/);
  // Bugünkü: Tuzla girilmedi (akşam), Marina gönderdi
  assert.equal(rows.kasa.title, "Bugünkü kasa raporu · Tuzla");
  assert.equal(rows.kasa.badge, "Girilmedi");
  assert.equal(rows["kasa-marina"].status, "done");
  assert.match(rows["kasa-marina"].detail, /^Deniz · Z/);
  // Öteki şubenin kapalı günü kendi satırında: onaylıysa satır yok, Tuzla'nınki kalır
  const closed = byKey(dayTasks({ ...facts, cash: { ...facts.cash!, others: [{ ...facts.cash!.others![0], yesterday: null, closed: { state: "approved", by: "Deniz", requestId: 4 } }] } }));
  assert.equal(closed["kasa-dun-marina"], undefined);
  assert.equal(closed["kasa-dun"].badge, "Girilmedi");
  // Tek şubede bugünkü gibi: başlıkta şube yok, tek satır
  const single = dayTasks({ ...facts, cash: { today: null, yesterday: lite("2026-10-21"), firstDate: "2026-10-01" } });
  assert.deepEqual(
    single.filter((t) => t.key.startsWith("kasa")).map((t) => `${t.key}:${t.title}`),
    ["kasa-dun:Dünkü kasa raporu", "kasa:Bugünkü kasa raporu"],
  );
});

test("Bugün (personel): yalnız yazdığı şubenin raporu; öteki şubeler gelse de satır çıkmaz", () => {
  const facts: DayFacts = {
    role: "staff",
    now: NOON,
    stock: STOCK,
    waste: { count: 0, zayi: null, ikram: null },
    cash: { today: null, yesterday: null, firstDate: "2026-10-01", branch: "Tuzla", others: [{ id: "marina", branch: "Marina", today: lite("2026-10-22"), yesterday: lite("2026-10-21"), firstDate: "2026-10-01", closed: null }] },
  };
  const tasks = dayTasks(facts);
  assert.ok(!tasks.some((t) => t.key.endsWith("-marina")));
  const kasa = byKey(tasks).kasa;
  assert.equal(kasa.title, "Kasa raporu · Tuzla");
  assert.equal(kasa.status, "later", "Tuzla'nın raporu girilmedi: gönderildi değil");
  assert.equal(byKey(tasks).zayi.status, "later", "zayi satırı da Tuzla'nın raporuna bakar");
});

test("Nakit planı: bakiye ipucu her açık kasanın devrini ve toplamını yazar; tek kasada bugünkü gibi", () => {
  const branches = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));
  const carries = new Map([
    ["marina", { date: "2026-11-12", amount: 500 }],
    ["tuzla", { date: "2026-11-12", amount: 1_000 }],
  ]);
  const list = tillCarries(carries, branches);
  assert.deepEqual(
    list.map((c) => c.branch),
    ["Tuzla", "Marina"],
  );
  assert.equal(plain(carryHint(list)!), "Kasalar ertesi güne 1.500 ₺ devretti: Tuzla 1.000 ₺ (12 Kasım), Marina 500 ₺ (12 Kasım).");
  // Marina kapalı (pasif): son devri elde değil; tek kasa, şube adı yok
  const one = tillCarries(carries, branches.map((b) => (b.id === "marina" ? { ...b, active: false } : b)));
  assert.equal(plain(carryHint(one)!), "Son kasa raporu (12 Kasım): ertesi güne 1.000 ₺ devretti.");
  assert.equal(carryHint([]), null);
});

test("Claude kasa_raporlari: kasa farkı günleri günde bir; iki şubenin raporu olan gün en kötüsüyle sayılır", () => {
  const r = (date: string, branchId: string, cashDiff: number): CashReportLike => ({
    date,
    branchId,
    zTotal: 1_000,
    cash: 400,
    card: 600,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 0,
    cashIn: 0,
    cashOut: 0,
    countedCash: 400 + cashDiff,
    handedOver: 400,
    cashDiff,
    revision: 1,
  });
  const reports = [r("2026-11-02", "tuzla", 0), r("2026-11-02", "marina", -50), r("2026-11-03", "tuzla", 30), r("2026-11-03", "marina", 0), r("2026-11-04", "tuzla", 0), r("2026-11-04", "marina", 0)];
  const out = cashReportSummary(reports, { from: "2026-11-02", to: "2026-11-04", through: "2026-11-04", firstReport: "2026-11-02", before: null, base: "https://ladmin.laffogato.net" });
  assert.equal(out.raporSayisi, 6);
  assert.deepEqual([out.toplam.eksikGun, out.toplam.fazlaGun, out.toplam.tutanGun], [1, 1, 1], "3 raporlu gün, 6 rapor değil");
  assert.match(plain(out.hesap[2]), /1 gün eksik, 1 gün fazla, 1 gün tuttu$/);
});

test("yazarkasanın ay satırı: iki şubenin aynı günü bir gün; tutarlar toplanır; kümülatif zincir şubeler arasında kurulmaz", () => {
  const row = (date: string, branchId: string, o: Partial<OkcRow> = {}): OkcRow => ({
    date,
    branchId,
    zTotal: 1_000,
    okcZNo: branchId === "tuzla" ? "0100" : "0050",
    okcTotal: 1_000,
    okcVatTotal: 100,
    okcVat: [{ rate: 10, total: 1_000, vat: 100 }],
    ...o,
  });
  const rows = [
    row("2026-11-02", "tuzla", { okcCumTotal: 50_000 }),
    row("2026-11-02", "marina", { okcVat: null, okcCumTotal: 9_000 }),
    row("2026-11-03", "tuzla"),
    row("2026-11-03", "marina", { okcTotal: null, okcVat: null, okcVatTotal: null }),
    row("2026-10-31", "marina", { okcCumTotal: 8_000 }),
  ];
  const m = okcMonth(rows, "2026-11");
  assert.equal(m.reportDays, 2, "iki gün (dört rapor değil)");
  assert.equal(m.days, 2);
  assert.deepEqual(m.missing, ["2026-11-03"]);
  assert.deepEqual(m.vatMissing, ["2026-11-02"]);
  assert.equal(m.total, 3_000);
  // Eksik dökümün tahmini yalnız dökümsüz satırın tutarından (aynı günün öteki şubesi sayılmaz)
  assert.equal(m.byRateEstimated?.[0].total, 1_000);
  assert.equal(m.chain, null, "Tuzla'nın kümülatifi Marina'nınkinden düşülmez");
  // Tek şubede bugünkü gibi: zincir kurulur
  const tuzla = okcMonth([row("2026-10-31", "tuzla", { okcCumTotal: 48_000 }), row("2026-11-02", "tuzla", { okcCumTotal: 50_000 })], "2026-11");
  assert.deepEqual(tuzla.chain?.total, 2_000);
});
