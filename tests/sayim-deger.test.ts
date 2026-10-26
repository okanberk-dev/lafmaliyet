// Stok sayımının değeri ve listesi (denetim 26 Eki 2026, parti B02): aktif reçetedeki pasif malzeme sayım listesinde
// kalır (E-04), pasif yapma engelinin metni, "reçetede yok" yalnız aktif ürünlere bakar (E-58), yıl toplamı bu aya kadar
// ve tek kuraldan (E-16, NEW-02). Saf: motor ve yardımcılar.
// Veritabanındaki eylemler: tests/sayim-deger-db.test.ts. FIFO başlangıç ayı (E-05): tests/stok-fifo.test.ts.
// Çalıştırma: npx tsx --test tests/sayim-deger.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildWorkbook } from "../src/app/api/export/workbook";
import { dayTasks, type DayFacts, type DayTask } from "../src/app/panel/bugun/logic";
import { loggedItems, staffLateEditNotice, unpricedExtrasNotice, type StaffLateEdit, type UnpricedExtras } from "../src/app/panel/sayim/logic";
import { createModel } from "../src/lib/calc/engine";
import { missingRevenueText, yearTotals, yearTrend } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { activeUses, isCountable, passiveRefusal, productListText, usageText } from "../src/lib/ingredient-usage";
import { yearSummary } from "../src/lib/mcp/answers/month";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
function close(actual: number, expected: number, label: string, tol = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${label}: beklenen ${expected}, bulunan ${actual}`);
}
const linesOf = (ds: Dataset, month: string) =>
  createModel(ds)
    .stockSheet(month)
    .groups.flatMap((g) => g.lines);

// Reçetede kullanılan, sayım birimi olan bir malzeme ve onu kullanan ürünler
const used = base.ingredients.find((i) => i.active && i.countUnit && base.recipeItems.some((r) => r.ingredientId === i.id))!;
const users = new Set(base.recipeItems.filter((r) => r.ingredientId === used.id).map((r) => r.productId));

test("E-04: aktif ürünün reçetesindeki pasif malzeme sayım listesinde kalır, 'Pasif · reçetede' işaretiyle", () => {
  assert.ok(used, "reçetede kullanılan sayım kalemi var");
  const passive: Dataset = { ...base, ingredients: base.ingredients.map((i) => (i.id === used.id ? { ...i, active: false } : i)) };
  const line = linesOf(passive, "2026-11").find((l) => l.ingredient.id === used.id);
  assert.ok(line, "sonraki ayın sayım listesinde");
  assert.equal(line!.archived, false, "salt okunur değil: sayılır");
  assert.equal(line!.passiveInUse, true);
  assert.equal(linesOf(base, "2026-11").find((l) => l.ingredient.id === used.id)!.passiveInUse, false, "aktifken işaret yok");
  // Onu kullanan bütün ürünler de pasifse listeden düşer (geçmiş ayın kayıtlı sayımı arşivde kalır)
  const retired: Dataset = { ...passive, products: passive.products.map((p) => (users.has(p.id) ? { ...p, active: false } : p)) };
  assert.equal(linesOf(retired, "2026-11").find((l) => l.ingredient.id === used.id), undefined, "emekli üründe sayılmaz");
  const counted: Dataset = { ...retired, stockCounts: [{ month: "2026-11", ingredientId: used.id, qty: 2, factor: 1000 }] };
  assert.equal(linesOf(counted, "2026-11").find((l) => l.ingredient.id === used.id)!.archived, true, "kayıtlı sayım arşivde");
  // "Sayılmaz" (sayım birimi yok) her durumda listede değil
  const notCounted: Dataset = { ...passive, ingredients: passive.ingredients.map((i) => (i.id === used.id ? { ...i, countUnit: null } : i)) };
  assert.equal(linesOf(notCounted, "2026-11").find((l) => l.ingredient.id === used.id), undefined);
});

test("Sayım formu (inceleme B02-U4): personel 'Pasif' görmez, 'sayın' der; yöneticiye rozet ve açıklaması görünür", () => {
  const form = readFileSync(join(root, "src/app/panel/sayim/stock-form.tsx"), "utf8");
  assert.match(form, /\{l\.passiveInUse && !isAdmin \? <p className="mt-0\.5 text-xs font-medium text-ink-soft">Satışta kullanılıyor, sayın<\/p> : null\}/);
  // Rozet ve açıklaması yalnız yöneticiye, etiketin dışında; açıklama yalnız title'da değil (dokunmatikte görünmez):
  // InfoTip. Satır sarar: 390 px'te ad kelimenin ortasından bölünmesin, rozet alta insin
  assert.match(
    form,
    /<\/label>\s+\{\/\*[^]*?\*\/\}\s+\{l\.passiveInUse && isAdmin \? \(\s+<span className="inline-flex shrink-0 items-center gap-1">\s+<Badge tone="gray">Pasif · reçetede<\/Badge>\s+<InfoTip text="Hammaddeler'de pasif ama aktif bir ürünün reçetesinde/,
  );
  assert.match(form, /<div className="flex flex-wrap items-center gap-x-1\.5 gap-y-1">\s+<label htmlFor=\{inputId\}/);
  assert.ok(!/title="Hammaddeler'de pasif/.test(form));
});

test("E-04: isCountable tek kural; pasif yapma engelinin metni ürünleri sayar", () => {
  assert.equal(isCountable({ active: true, countUnit: "KG" }, false), true);
  assert.equal(isCountable({ active: false, countUnit: "KG" }, true), true);
  assert.equal(isCountable({ active: false, countUnit: "KG" }, false), false);
  assert.equal(isCountable({ active: true, countUnit: null }, true), false);
  assert.equal(passiveRefusal("Lime şurubu", []), null);
  const six = ["M", "L"].flatMap((size) => ["Lemon Tea", "Ice Tea", "Limonata"].map((name, k) => ({ id: k, name, size })));
  assert.equal(productListText(six), "Lemon Tea · M, Ice Tea · M, Limonata · M ve 3 ürün daha");
  assert.equal(productListText([{ id: 1, name: "Lemon Tea" }]), "Lemon Tea");
  assert.equal(
    passiveRefusal("Lime şurubu", six),
    "“Lime şurubu” 6 aktif ürünün reçetesinde kullanılıyor (Lemon Tea · M, Ice Tea · M, Limonata · M ve 3 ürün daha). Pasif yapmadan önce bu reçetelerden çıkarın ya da yerine başka malzeme yazın; yoksa ürünler onu tüketmeye devam eder.",
  );
});

test("E-58: usedInActive yalnız aktif ürünlerin reçeteleri; usedIn (silme engeli) hepsi", () => {
  const retired: Dataset = { ...base, products: base.products.map((p) => (users.has(p.id) ? { ...p, active: false } : p)) };
  const m = createModel(retired);
  assert.deepEqual(new Set(m.usedIn.get(used.id)), users, "silme engeli pasif ürünleri de sayar");
  assert.equal(m.usedInActive.has(used.id), false);
  assert.equal(createModel(base).usedInActive.get(used.id)!.length, createModel(base).usedIn.get(used.id)!.length);
  assert.equal(activeUses({ usedIn: [] }), 0);
  assert.equal(activeUses({ usedIn: [{ active: true }, { active: false }, { active: true }] }), 2);
  // Düzenleme penceresinin alt başlığı çiple aynı kuralla (inceleme B02-U6)
  assert.equal(usageText({ usedIn: [{ active: true }, { active: false }, { active: true }] }), "2 aktif üründe kullanılıyor · 1 pasif ürün");
  assert.equal(usageText({ usedIn: [{ active: true }] }), "1 aktif üründe kullanılıyor");
  assert.equal(usageText({ usedIn: [{ active: false }, { active: false }, { active: false }] }), "Aktif reçetede yok · 3 pasif ürün");
  assert.equal(usageText({ usedIn: [] }), "Reçetede yok");
  const client = readFileSync(join(root, "src/app/panel/hammaddeler/ingredients-client.tsx"), "utf8");
  assert.ok(client.includes("`${row.category} · ${usageText(row)}`"), "alt başlık usageText");
  assert.ok(!client.includes("üründe kullanılıyor` :"), "eski alt başlık (pasif ürünleri de sayan) yok");
  // Pasif ama aktif reçetede: silme penceresi "pasif yapmak için" demez, tüketildiğini ve listede durduğunu söyler (U5)
  assert.match(client, /Malzeme pasif ama \$\{num\(activeProducts\.length\)\} aktif ürünün reçetesinde: satıldıkça tüketiliyor ve sayım listesinde duruyor\./);
});

test("E-04 ekran: Hammaddeler'in sil penceresi ve 'Aktif' kutusu aktif ürünü olan malzemeyi pasif yaptırmaz", () => {
  const src = readFileSync(join(root, "src/app/panel/hammaddeler/ingredients-client.tsx"), "utf8");
  assert.ok(src.includes("const canPassivate = row.active && !inActive;"), "Pasif yap yalnız aktif ürünü yoksa");
  assert.ok(src.includes('confirmLabel={canPassivate ? "Pasif yap" : "Tamam"}'));
  assert.ok(!src.includes("Reçeteler ve ürün maliyetleri aynı kalır"), "eski yanıltıcı metin kalktı");
  assert.ok(src.includes('id="i-active"'), "Aktif kutusunun hatası");
  // Sunucu iki yoldan da reddeder (eylem kaynağı)
  const actions = readFileSync(join(root, "src/server/actions/ingredients.ts"), "utf8");
  assert.equal(actions.match(/passiveRefusal\(/g)?.length, 2, "setIngredientActive ve saveIngredient");
});

// ---------------------------------------------------------------- Yıl toplamı (E-16, NEW-02)

const esp = base.ingredients.find((i) => i.name === "Espresso çekirdeği")!;
/** Excel verisi + Ekim'de (bu ay) sayılmış 100 KG espresso: Kasım'ın açılışı dolu, Kasım henüz başlamadı */
const octCounted: Dataset = { ...base, stockCounts: [{ month: "2026-10", ingredientId: esp.id, qty: 100, factor: 1000 }] };

test("E-16: bu ay sayılınca sonraki ay aktif olmaz, yıl toplamına girmez", () => {
  const m = createModel(octCounted);
  assert.ok(m.pnlMonth("2026-11").expenses > 0, "Kasım'ın açılış stoğu gider gibi duruyor (tablo)");
  const nov = yearTrend(m, 2026)[10];
  assert.equal(nov.month, "2026-11");
  assert.deepEqual([nov.future, nov.active, nov.missingRevenue, nov.expenses], [true, false, false, 0]);
  const yt = yearTotals(m, 2026);
  assert.ok(!yt.counted.includes("2026-11"));
  assert.deepEqual(yt.missingRevenue, [], "Kasım 'ciro girilmedi' de sayılmaz");
  const through = ["2026-07", "2026-08", "2026-09", "2026-10"].map((x) => m.pnlMonth(x));
  close(yt.expenses, through.reduce((a, c) => a + c.expenses, 0), "yıl gideri Ekim'e kadar");
  close(yt.profit, through.reduce((a, c) => a + c.profit, 0), "yıl kârı Ekim'e kadar");
  close(yt.cogs, through.reduce((a, c) => a + c.cogs, 0), "yıl mal maliyeti");
  assert.deepEqual(yt.counted, ["2026-07", "2026-08", "2026-09", "2026-10"]);
  // Ekim sayıldı, öncekiler sayılmadı: mal maliyeti tahmini
  assert.deepEqual(yt.uncounted, ["2026-07", "2026-08", "2026-09"]);
  // Gelecek ay currentMonth değişince sayılır
  const novNow = createModel({ ...octCounted, currentMonth: "2026-11" });
  assert.equal(yearTrend(novNow, 2026)[10].missingRevenue, true, "Kasım başladı, ciro yok");
  assert.match(missingRevenueText(yearTotals(novNow, 2026).missingRevenue[0]), /^Kasım 2026: ciro girilmedi; [\d.]+\s₺ gider kâra girmedi$/);
});

test("NEW-02: Gelir-gider kartı, Genel bakış ve Claude'un yıl toplamı aynı rakam; cirosuz geçmiş ay kâra girmez", () => {
  // Haziran'a mal faturası: gider var, POS cirosu yok
  const ds: Dataset = {
    ...octCounted,
    invoices: [...octCounted.invoices, { ...octCounted.invoices.find((i) => i.category === "Hammadde & İçecek")!, id: 990_001, date: "2026-06-15", amount: 12_000, discount: 0 }],
  };
  const m = createModel(ds);
  const yt = yearTotals(m, 2026);
  assert.equal(yt.missingRevenue.length, 1);
  assert.equal(yt.missingRevenue[0].month, "2026-06");
  close(yt.missingRevenue[0].expenses, m.pnlMonth("2026-06").expenses, "Haziran gideri");
  assert.ok(!yt.counted.includes("2026-06"));
  // Claude (ay_ozeti, yil) aynı toplamı söyler
  const ys = yearSummary(m, 2026, { base: "https://ladmin.laffogato.net" });
  close(ys.toplam.kar, Math.round(yt.profit * 100) / 100, "Claude kâr", 1e-9);
  close(ys.toplam.gider, Math.round(yt.expenses * 100) / 100, "Claude gider", 1e-9);
  assert.ok(ys.kaynak.some((k) => k.includes("Haziran 2026: ciro girilmedi")), "kaynakta not");
  // Genel bakış: yearTrend'in aktif aylarının toplamı = yearTotals
  const trend = yearTrend(m, 2026).filter((x) => x.active);
  close(trend.reduce((a, x) => a + x.profit, 0), yt.profit, "Genel bakış grafiği");
  // Sayfalar aynı yardımcıyı kullanır (kaynak)
  const gg = readFileSync(join(root, "src/app/panel/gelir-gider/page.tsx"), "utf8");
  assert.ok(gg.includes("const yt = yearTotals(model, year);") && gg.includes("const { revenueNet, online, expenses, profit } = yt;"));
  assert.ok(/m <= current && \(calcs\[i\]\.revenue/.test(gg), "aktif aylar bu aya kadar");
  assert.ok(readFileSync(join(root, "src/app/panel/page.tsx"), "utf8").includes("<YearTotals totals={yearSum} />"));
});

/** Excel'in Gelir-Gider sayfasında bir satırın YILI hücresi (15. sütun) */
function yearCell(ws: import("exceljs").Worksheet, label: string): number {
  let row: import("exceljs").Row | undefined;
  ws.eachRow((r) => {
    if (r.getCell(2).value === label) row = r;
  });
  assert.ok(row, label);
  return row!.getCell(15).value as number;
}

test("E-16: Excel'in yıl sütunu bu aya kadar; başlık notu toplanan ayları söyler", () => {
  const m = createModel({ ...octCounted, settings: { ...octCounted.settings, kdvHizmet: octCounted.settings.kdv } });
  const wb = buildWorkbook(m, "2026-10", { investments: [], findings: [], now: new Date("2026-10-26T10:00:00Z") });
  const ws = wb.getWorksheet("Gelir-Gider 2026")!;
  const through = ["2026-07", "2026-08", "2026-09", "2026-10"].map((x) => m.pnlMonth(x).profit).reduce((a, b) => a + b, 0);
  close(yearCell(ws, "KÂR / ZARAR"), through, "YILI = Temmuz–Ekim (Kasım'ın açılış stoğu yok)");
  assert.match(String(ws.getCell("O1").note ?? ""), /^Ekim 2026 ve öncesi, POS cirosu girilmiş 4 ay \(panelin yıl kartları, Genel bakış ve Claude ile aynı\)\.\nSonraki aylar henüz başlamadı\./);
});

test("İnceleme B02-D4: Excel'in yıl sütunu, Gelir-gider tablosunun yıl sütunu ve yıl kartı aynı: cirosuz ay toplanmaz", () => {
  // Kasım başladı (bu ay), ciro girilmedi; Haziran'da mal faturası var, ciro yok
  const ds: Dataset = {
    ...octCounted,
    currentMonth: "2026-11",
    settings: { ...octCounted.settings, kdvHizmet: octCounted.settings.kdv },
    invoices: [...octCounted.invoices, { ...octCounted.invoices.find((i) => i.category === "Hammadde & İçecek")!, id: 990_002, date: "2026-06-15", amount: 12_000, discount: 0 }],
  };
  const m = createModel(ds);
  const yt = yearTotals(m, 2026);
  assert.deepEqual(
    yt.missingRevenue.map((x) => x.month),
    ["2026-06", "2026-11"],
  );
  assert.ok(m.pnlMonth("2026-11").expenses > 0, "Kasım'ın açılış stoğu gider gibi duruyor (tablonun ay sütunu)");
  const ws = buildWorkbook(m, "2026-11", { investments: [], findings: [], now: new Date("2026-11-01T10:00:00Z") }).getWorksheet("Gelir-Gider 2026")!;
  close(yearCell(ws, "KÂR / ZARAR"), yt.profit, "Excel YILI kâr = yıl kartı");
  close(yearCell(ws, "GİDERLER GENEL TOPLAMI"), yt.expenses, "Excel YILI gider = yıl kartı");
  const note = String(ws.getCell("O1").note ?? "");
  assert.match(note, /Haziran 2026: ciro girilmedi; [\d.]+\s₺ gider kâra girmedi\./);
  assert.match(note, /Kasım 2026: ciro girilmedi;/);
  // Gelir-gider tablosu: yıl sütunu (totalOf) varsayılan olarak yıl kartlarının aylarından
  const gg = readFileSync(join(root, "src/app/panel/gelir-gider/page.tsx"), "utf8");
  assert.ok(gg.includes("const totalOf = (key: string, idx: number[] = countedIdx): number | null => {"), "tablo yıl sütunu = yıl kartları");
  assert.ok(/yearNote=\{\s+yt\.counted\.length < activeMonths\.length/.test(gg), "toplanmayan ay varsa başlıkta söylenir");
});

// ---------------------------------------------------------------- Yöneticiye sayım uyarıları (E-22, E-19'un bildirimi)

const at = (local: string) => new Date(`${local}:00+03:00`);
const STOCK = { month: "2026-11", counted: 0, total: 72, prevMonth: "2026-10", prevHasData: true, prevCounted: 72, prevTotal: 72 };
const facts = (role: "admin" | "staff", now: Date, o: Partial<DayFacts> = {}): DayFacts => ({
  role,
  now,
  cash: { today: null, yesterday: null, firstDate: null },
  stock: STOCK,
  ...(role === "admin" ? { system: [], payments: [], invoices: { review: 0 } } : { waste: { count: 0, zayi: null, ikram: null } }),
  ...o,
});
const rowOf = (tasks: DayTask[], key: string) => tasks.find((t) => t.key === key);

test("E-22: fiyatsız ek kalem yöneticinin zil satırı ve Bugün'ü; fiyat girilince kalkar; personelde yok", () => {
  const oct: UnpricedExtras = { month: "2026-10", count: 2, names: ["Bulaşık deterjanı", "Kağıt havlu"], newestId: 41 };
  const n = unpricedExtrasNotice(oct)!;
  assert.deepEqual(n, {
    id: "sayim-ek-fiyatsiz-2026-10-2-41",
    title: "Ekim 2026: 2 ek kalemin fiyatı yok",
    body: "Bulaşık deterjanı, Kağıt havlu · Birim fiyatı girilmezse kapanış stoğuna 0 ₺ girer, ayın mal maliyeti o kadar yüksek çıkar.",
    href: "/panel/sayim?ay=2026-10#listede-olmayanlar",
  });
  assert.equal(unpricedExtrasNotice({ ...oct, count: 0, names: [] }), null, "fiyat girilince satır yok");
  assert.match(unpricedExtrasNotice({ ...oct, count: 5, names: ["A", "B", "C"] })!.body, /^A, B, C ve 2 kalem daha · /);
  // Bugün: yalnız yönetici
  const now = at("2026-11-03T10:00");
  const row = rowOf(dayTasks(facts("admin", now, { countAlerts: { extras: [oct], late: null } })), "sayim-ek-fiyat")!;
  assert.deepEqual([row.title, row.status, row.badge, row.href, row.action], ["Sayımda fiyatı olmayan ek kalemler", "todo", "2 kalem", n.href, "Fiyatı gir"]);
  assert.equal(row.detail, `${n.title}: ${n.body}`);
  const two = rowOf(dayTasks(facts("admin", now, { countAlerts: { extras: [{ ...oct, month: "2026-11", newestId: 50 }, oct], late: null } })), "sayim-ek-fiyat")!;
  assert.equal(two.badge, "4 kalem");
  assert.match(two.detail, /^Kasım 2026: 2 ek kalemin fiyatı yok · Ekim 2026: 2 ek kalemin fiyatı yok\. Birim fiyatı/);
  assert.equal(rowOf(dayTasks(facts("staff", now, { countAlerts: { extras: [oct], late: null } })), "sayim-ek-fiyat"), undefined, "personelde yok");
  assert.equal(rowOf(dayTasks(facts("admin", now, { countAlerts: { extras: [], late: null } })), "sayim-ek-fiyat"), undefined);
});

test("Personelin geçen aya geç kaydı: yöneticinin zil satırı, son üç gün Bugün'de; personelde yok", () => {
  assert.equal(loggedItems("Ekim 2026: 3 kalem, 1 sayım silindi"), 4);
  assert.equal(loggedItems("Ekim 2026: 2 sayım silindi"), 2);
  assert.equal(loggedItems(null), 0);
  const edits: StaffLateEdit[] = [
    { name: "Ayşe", saves: 2, items: 5, lastAt: "2026-11-03T07:10:00.000Z", lastId: 912 },
    { name: "Mehmet", saves: 1, items: 1, lastAt: "2026-11-02T08:00:00.000Z", lastId: 900 },
  ];
  const n = staffLateEditNotice("2026-10", edits)!;
  assert.equal(n.id, "sayim-personel-2026-10-912");
  assert.equal(n.title, "Ayşe ve Mehmet, Ekim 2026 sayımını değiştirdi");
  assert.equal(n.body, "Ay bittikten sonra 3 kayıt, 6 kalem. Geçen ayın kapanışı mal maliyetini, kârı ve bu ayın açılışını değiştirir: kontrol edin.");
  assert.equal(n.href, "/panel/sayim?ay=2026-10");
  assert.equal(staffLateEditNotice("2026-10", []), null);
  const late = { month: "2026-10", edits };
  const row = rowOf(dayTasks(facts("admin", at("2026-11-04T10:00"), { countAlerts: { extras: [], late } })), "sayim-personel")!;
  assert.deepEqual([row.title, row.badge, row.action], [n.title, "Kontrol et", "Sayıma bak"]);
  assert.equal(rowOf(dayTasks(facts("admin", at("2026-11-07T10:00"), { countAlerts: { extras: [], late } })), "sayim-personel"), undefined, "3 günden eski: yalnız zilde");
  assert.equal(rowOf(dayTasks(facts("staff", at("2026-11-04T10:00"), { countAlerts: { extras: [], late } })), "sayim-personel"), undefined);
});
