// Telefon görünümünün saf mantığı: Genel bakış "Bu ayın işleri" kısa listesi, Ayarlar akordeonunun özet satırları,
// QR menü fiyat sütunları. Excel verisi (bugün = Ekim 2026) üzerinde.
// Çalıştırma: npx tsx --test tests/mobil-genel.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, type WaterCost } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import { phoneChecklist, taskSummary, type MonthTask } from "../src/app/panel/dashboard-tasks";
import { needsPin, pinTarget } from "../src/app/panel/ayarlar/pin-scroll";
import { categoriesSummary, logSummary, measuresSummary, ratesSummary, waterSummary } from "../src/app/panel/ayarlar/summaries";
import { hasSizeColumns, menuPrice, menuPrices, type MenuItem } from "../src/app/menu/menu-rows";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);

const NBSP = " ";

const task = (key: MonthTask["key"], status: MonthTask["status"]): MonthTask => ({ key, status, title: key, detail: `${key} ayrıntı`, href: `/panel#${key}`, action: "Git" });

// ---------------------------------------------------------------- Bu ayın işleri (telefon)

test("Telefon listesi: sıradaki iş (önce sorun) DOM'da da ilk (yalnızca telefonda), geniş ekranda kendi yerinde", () => {
  const tasks = [task("satis", "todo"), task("gun", "done"), task("fatura", "warn"), task("su", "later"), task("sayim", "todo"), task("odeme", "done")];
  const p = phoneChecklist(tasks);
  // Telefonda görünen sıra = DOM sırası (CSS ile yeniden sıralama yok): sıradaki iş başta
  const phone = p.rows.filter((r) => r.view !== "wide").map((r) => r.task.key);
  assert.deepEqual(phone, ["fatura", "satis", "gun", "su", "sayim", "odeme"], "telefonda sorunlu iş en üstte");
  // Geniş ekranda listedeki sıra korunur
  const wide = p.rows.filter((r) => r.view !== "phone").map((r) => r.task.key);
  assert.deepEqual(wide, tasks.map((t) => t.key), "geniş ekranda sıra değişmez");
  assert.equal(p.rows[0].view, "phone");
  assert.equal(p.rows.find((r) => r.task.key === "fatura" && r.view === "wide")?.next, true, "geniş ekrandaki kopya da sıradaki iş olarak vurgulanır");
  assert.deepEqual(
    [...new Set(p.rows.filter((r) => r.next).map((r) => r.task.key))],
    ["fatura"],
    "sorunlu iş, yapılacaklardan önce sıradaki iş",
  );
  assert.equal(p.rows.find((r) => r.next)?.task.key, taskSummary(tasks).next?.key, "özet kartındaki sıradaki işle aynı");
  assert.ok(p.rows.every((r) => r.compact === !r.next));
  assert.equal(p.toggle, true);
  assert.equal(p.waiting, 2, "tek satıra inen açık işler: satış raporu + sayım");
  // Her satırın anahtarı tekil (iki kopya aynı React anahtarını almaz)
  const keys = p.rows.map((r) => `${r.task.key}-${r.view}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("Telefon listesi: sıradaki iş zaten ilkse kopya yok", () => {
  const tasks = [task("satis", "warn"), task("gun", "todo"), task("fatura", "done")];
  const p = phoneChecklist(tasks);
  assert.deepEqual(
    p.rows.map((r) => [r.task.key, r.view]),
    [
      ["satis", "all"],
      ["gun", "all"],
      ["fatura", "all"],
    ],
  );
  assert.equal(p.rows[0].next, true);
  assert.equal(p.waiting, 1);
});

test("Telefon listesi: bütün işler bitince sıradaki iş yok, hepsi tek satır, bekleyen iş sayılmaz", () => {
  const tasks = [task("satis", "done"), task("gun", "done"), task("su", "later")];
  const p = phoneChecklist(tasks);
  assert.ok(p.rows.every((r) => !r.next && r.compact && r.view === "all"));
  assert.equal(p.rows.length, 3);
  assert.equal(p.toggle, true, "biten işlerin ayrıntısı da açılabilir");
  assert.equal(p.waiting, 0);
});

test("Telefon listesi: tek iş açıksa ayrıntı düğmesi gerekmez", () => {
  const p = phoneChecklist([task("odeme", "warn")]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].next, true);
  assert.equal(p.toggle, false);
  assert.equal(phoneChecklist([]).toggle, false);
});

// ---------------------------------------------------------------- Ayarlar özetleri

test("Oranlar özeti: beş oran kayıtlı değerleriyle, yüzde biçiminde", () => {
  const s = { ...model.settings, kdv: 0.1, komisyon: 0.025, kartOrani: 0.856, hedefMaliyet: 0.3, fire: 0.05 };
  assert.equal(ratesSummary(s), "KDV %10 / hizmet %20 · POS %2,5 · Kartlı %85,6 · Hedef %30 · Fire %5");
});

test("Reçete ölçüleri özeti: shot, pompa, açık gün ve ölçülmemiş varsayım sayısı", () => {
  const s = { ...model.settings, shotTek: 9, shotCift: 18, pompa: 10, acikGun: 30 };
  assert.equal(measuresSummary(s), "Shot 9 / 18 gr · Pompa 10 ml · 30 açık gün · 3 varsayım");
  // Ondalıklı ölçü Türkçe virgülle
  assert.match(measuresSummary({ ...s, shotTek: 8.5 }), /^Shot 8,5 \/ 18 gr/);
});

test("Su özeti: litre maliyeti 4 ondalık ve kaynağın kısa adı", () => {
  const base: WaterCost = { perLiter: 0.1234, month: "2026-09", bill: 1000, liters: 8100, reason: "ok", latestBillMonth: "2026-09" };
  assert.equal(waterSummary(base), `0,1234${NBSP}₺/L · Eylül 2026 su faturasından`);
  assert.equal(waterSummary({ ...base, reason: "override" }), `0,1234${NBSP}₺/L · Ayarlar'dan elle`);
  // Hesaplanamayan maliyet "0,0000 ₺/L" diye yazılmaz: yalnızca neden
  assert.equal(waterSummary({ ...base, perLiter: 0, reason: "no-bill", month: null, latestBillMonth: null }), "Su faturası girilmedi");
  assert.equal(waterSummary({ ...base, perLiter: 0, reason: "no-usage", month: null, latestBillMonth: "2026-10" }), "Ekim 2026 faturası var, satış listesi yok");
  // Elle yazılmış 0 bilinçli bir değer: yazılır
  assert.equal(waterSummary({ ...base, perLiter: 0, reason: "override" }), `0,0000${NBSP}₺/L · Ayarlar'dan elle`);
  // Excel verisinin kendi su maliyeti de okunur bir özet verir (sıfır maliyet yazılmaz)
  assert.ok(waterSummary(model.water).length > 0);
  assert.doesNotMatch(waterSummary(model.water), /0,0000/);
});

test("Kategoriler ve işlem geçmişi özetleri", () => {
  assert.equal(categoriesSummary([{ count: 31 }, { count: 8 }, { count: 0 }]), "3 kategori · 39 ürün");
  assert.equal(categoriesSummary([]), "Kategori yok");
  assert.equal(logSummary([{ dayLabel: "Bugün", time: "08:28", userName: "Okan" }, { dayLabel: "Dün", time: "21:00", userName: null }]), "Son işlem: Bugün 08:28 · Okan");
  assert.equal(logSummary([{ dayLabel: "17 Ekim 2026 Cumartesi", time: "09:05", userName: null }]), "Son işlem: 17 Ekim 2026 Cumartesi 09:05 · Sistem");
  assert.equal(logSummary([]), "Henüz işlem yok");
});

// ---------------------------------------------------------------- Ayarlar #bölüm kaydırması

test("#bölüm: hedef konum öğenin üstü eksi kaydırma payı; sayfa sınırlarında kırpılır", () => {
  // Telefonda #olculer: kart sayfanın 459.5px'inde, üst çubuk payı 80px → 379.5
  assert.equal(pinTarget({ scrollY: 0, top: 459.5, margin: 80, scrollHeight: 2055, viewport: 812 }), 379.5);
  // Kaydırılmış sayfada aynı hedef (görünür konum + kaydırma)
  assert.equal(pinTarget({ scrollY: 363.5, top: 96, margin: 80, scrollHeight: 2055, viewport: 812 }), 379.5);
  // Bölüm henüz açılmamışken (kısa sayfa) alt sınırda kırpılır: QA'nın gördüğü 363.5
  assert.equal(pinTarget({ scrollY: 0, top: 459.5, margin: 80, scrollHeight: 1175.5, viewport: 812 }), 363.5);
  // En üstteki bölüm 0'ın altına inmez; sayfa ekrandan kısaysa 0
  assert.equal(pinTarget({ scrollY: 0, top: 40, margin: 80, scrollHeight: 2000, viewport: 812 }), 0);
  assert.equal(pinTarget({ scrollY: 0, top: 300, margin: 80, scrollHeight: 600, viewport: 812 }), 0);
});

test("#bölüm: 2px'ten küçük fark düzeltilmez (kırpılmış hedefte döngü olmaz)", () => {
  assert.equal(needsPin(379.5, 379.5), false);
  assert.equal(needsPin(378, 379.5), false);
  assert.equal(needsPin(363.5, 379.5), true);
  assert.equal(needsPin(0, 379.5), true);
});

// ---------------------------------------------------------------- QR menü

test("QR menü: boylu kategoride Medium / Large sütunu, tek boylu ürün Medium'da, eksik boy boş", () => {
  const items: MenuItem[] = [
    { name: "Latte", sizes: [{ size: "M", price: 195 }, { size: "L", price: 210 }] },
    { name: "L'Affogato", sizes: [{ size: "L", price: 300 }] },
    { name: "Espresso", sizes: [{ size: "Tek", price: 135 }] },
  ];
  assert.equal(hasSizeColumns(items), true);
  assert.deepEqual(menuPrices(items[0], true), [`195${NBSP}₺`, `210${NBSP}₺`]);
  assert.deepEqual(menuPrices(items[1], true), [null, `300${NBSP}₺`]);
  assert.deepEqual(menuPrices(items[2], true), [`135${NBSP}₺`, null]);
});

test("QR menü: tek boylu kategoride tek fiyat; binlik ayırıcı ve bölünmez boşluk", () => {
  const items: MenuItem[] = [
    { name: "Cheesecake", sizes: [{ size: "Tek", price: 1250 }] },
    { name: "Eski kayıt", sizes: [{ size: "M", price: 90 }] },
  ];
  assert.equal(hasSizeColumns([items[0]]), false);
  assert.deepEqual(menuPrices(items[0], false), [`1.250${NBSP}₺`]);
  assert.deepEqual(menuPrices(items[1], false), [`90${NBSP}₺`], "tek sütunda boylu fiyat da gösterilir");
  assert.deepEqual(menuPrices({ name: "Fiyatsız", sizes: [] }, false), [null]);
  assert.equal(menuPrice(5), `5${NBSP}₺`);
});

test("QR menü: yayında değilken ya da boşken laffogato.net/menu'ye gider (önizleme hariç); yayındayken alerjen bağlantısı", () => {
  const page = readFileSync(join(root, "src/app/menu/page.tsx"), "utf8");
  assert.match(page, /const siteMenu = `\$\{siteUrl\(\)\}\/menu`;\s*if \(!preview && \(!menu\.published \|\| menu\.categories\.length === 0\)\) redirect\(siteMenu\);/);
  assert.doesNotMatch(page, /Menümüz çok yakında burada/, "çıkmaz sayfa yok");
  assert.match(page, /Alerjen bilgisi ve fiyat listesinin tarihi:\{" "\}\s*<a href=\{siteMenu\}/);
  // Ayarlar kartı panelin kendi adresini yazar (laffogato.net/menu sitenin menüsüdür)
  const settings = readFileSync(join(root, "src/app/panel/ayarlar/settings-client.tsx"), "utf8");
  assert.match(settings, /description=\{bareUrl\(menuUrls\.panel\)\}/);
  assert.doesNotMatch(settings, /description="laffogato\.net\/menu"/);
});
