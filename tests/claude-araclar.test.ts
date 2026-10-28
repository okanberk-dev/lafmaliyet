// Claude bağlantısının araç yanıtları (src/lib/mcp/answers/*): Excel seed verisiyle ekranlarla aynı rakamlar (ikinci
// hesap yolu yok), hesap / kaynak / uyarı satırları, aralık kuralları, çıktının boyu ve sızıntı taraması: IBAN, vergi
// no, telefon, e-posta, not, personel ya da müşteri adı hiçbir yanıta girmez (CRITIQUE2 §5).
// Çalıştırma: npx tsx --test tests/claude-araclar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { groupSuppliers, type SupplierCard } from "../src/app/panel/tedarikciler/logic";
import { createModel } from "../src/lib/calc/engine";
import { dashboard, MENU_CLASS_INFO, menuEngineering } from "../src/lib/calc/insights";
import { ingredientChanges, productImpacts, type PriceHistoryRow } from "../src/lib/calc/price-impact";
import { priceLoss } from "../src/lib/calc/price-loss";
import type { Dataset } from "../src/lib/calc/types";
import { cashReportSummary, type CashReportLike } from "../src/lib/mcp/answers/cash";
import { checkRange, CUT_NOTE, fitOutput, pct, salesFor, tl, ToolInputError, unpricedInRecipes, unpricedWarnings } from "../src/lib/mcp/answers/common";
import { monthSummary, yearSummary } from "../src/lib/mcp/answers/month";
import { isEstimatedDue, upcomingPayments } from "../src/lib/mcp/answers/payments";
import { priceRiseImpact, readableUnit, type PriceAlertsLike } from "../src/lib/mcp/answers/prices";
import { productProfitability } from "../src/lib/mcp/answers/products";
import { safeHint, searchResults } from "../src/lib/mcp/answers/search";
import { supplierSummary, type LedgerGroupLike } from "../src/lib/mcp/answers/suppliers";
import { araInput, kasaRaporlariInput, odemelerInput, tedarikciOzetiInput, urunKarliligiInput, zamEtkisiInput } from "../src/lib/mcp/schemas";
import { upcomingItems, type ReminderRow } from "../src/lib/reminders";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { productLabel } from "../src/lib/waste";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);
const ctx = { base: "https://ladmin.laffogato.net" };
const close = (a: number | null | undefined, b: number, msg: string, eps = 0.006) => {
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
};
const urun = (input: Record<string, unknown>) => productProfitability(model, { ...urunKarliligiInput.parse(input), ay: (input.ay as string) ?? "2026-10" }, ctx);

// ---------------------------------------------------------------- Sızıntı taraması için gizli bilgili veriler

const IBAN = "TR330006100519786457841326";
const VKN = "1234567890";
const PHONE = "05321112233";
const SECRETS = [IBAN, "TR33 0006", VKN, PHONE, "0532 111 22 33", "satis@kaldi", "gizli-not", "kapı kodu", "Ayşe Yılmaz", "Mehmet Personel", "Ali Kasiyer", "neye çıktı", "fatura-aciklama"];
const FORBIDDEN_KEYS = /^(email|eposta|iban|phone|telefon|vergi|vergiNo|taxNumber|note|not|notes|password|parola|token|hash|giren|countedBy|countedByName|submittedBy|submittedByName|contactName|address|adres|customerName|musteri)$/i;

function assertNoLeak(label: string, out: unknown) {
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /[\w.+-]+@[\w-]+\.[\w.-]+/, `${label}: e-posta`);
  assert.doesNotMatch(json, /TR\d{2}\s?\d{4}/, `${label}: IBAN`);
  for (const s of SECRETS) assert.ok(!json.includes(s), `${label}: "${s}" sızdı`);
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        assert.doesNotMatch(k, FORBIDDEN_KEYS, `${label}: yasak alan ${k}`);
        walk(x);
      }
  };
  walk(out);
}

const card = (o: Partial<SupplierCard> & Pick<SupplierCard, "id" | "name">): SupplierCard => ({
  aliases: [],
  legalName: null,
  taxNumber: null,
  taxOffice: null,
  iban: null,
  bankName: null,
  accountHolder: null,
  contactName: null,
  phone: null,
  email: null,
  address: null,
  paymentTermDays: null,
  paymentMethod: null,
  paidOnDelivery: false,
  note: null,
  hiddenOn: null,
  ...o,
});
const KALDI_CARD = card({
  id: 1,
  name: "Kaldi",
  legalName: "KALDI KAHVE A.Ş.",
  taxNumber: VKN,
  iban: IBAN,
  bankName: "Ziraat",
  accountHolder: "Ayşe Yılmaz",
  contactName: "Ayşe Yılmaz",
  phone: "0532 111 22 33",
  email: "satis@kaldi.example",
  address: "Gizli Sk. No: 5, kapı kodu 4455",
  paymentTermDays: 45,
  paymentMethod: "havale",
  note: "gizli-not",
});

/** Seed faturaları (açıklama ve not dolu) + kartlar → Tedarikçiler ekranının grupları */
function ledger(today = "2026-10-22", cards: SupplierCard[] = [KALDI_CARD]) {
  const invoices = ds.invoices.map((i) => ({ ...i, description: "fatura-aciklama satis@kaldi.example", note: "gizli-not", outstanding: null, supplierTaxNumber: null }));
  const groups = groupSuppliers(invoices, cards, { today, termDays: 30 }).map((g) => ({ ...g, termDays: g.card?.paymentTermDays ?? 30 }));
  return { today, groups: groups as unknown as LedgerGroupLike[] };
}

// ---------------------------------------------------------------- ay_ozeti

test("ay özeti, Ekim 2026: Gelir-gider ve Genel bakış'la aynı rakamlar; hesap satırları gerçek rakamlarla", () => {
  const m = monthSummary(model, "2026-10", ctx);
  const pm = model.pnlMonth("2026-10");
  const d = dashboard(model, "2026-10");
  assert.equal(m.durum, "suruyor");
  close(m.gerceklesen?.kar, pm.profit, "kâr = pnlMonth");
  close(m.gerceklesen?.kar, -39003.92, "Excel seed kârı");
  assert.equal(m.gerceklesen?.toplamCiroKdvHaric, 267190);
  close(m.gerceklesen?.toplamGider, pm.expenses, "gider = pnlMonth");
  assert.equal(m.teorik, null);
  close(m.tahmin?.aySonuCiroKdvDahil, d.forecast!.projectedRevenue, "tahmin = dashboard");
  close(m.tahmin?.aySonuCiroKdvDahil, 569448.69, "Excel seed tahmini");
  close(m.basaBas.gunlukCiroKdvDahil, d.breakEvenDaily!, "başabaş = dashboard");
  assert.ok(m.uyarilar.includes("Ekim 2026 için ürün satış listesi yok: reçeteye göre kâr hesaplanamadı."));
  assert.ok(m.uyarilar.includes("Ekim 2026 sayımı girilmedi: kapanış stoğu 0 sayıldı, alınan malın tamamı maliyet."));
  assert.match(m.hesap[0], /267\.190/);
  assert.match(m.hesap[0], /306\.194/);
  assert.match(m.hesap[1], /÷ 1,10 = 267\.190/);
  assert.ok(m.hesap.some((h) => h === "Sabit giderler açık güne göre: 16 / 31 gün"));
  assert.equal(m.kaynak[0], "Ciro ve açık gün: Satışlar'a girilen ay bilgisi");
  assert.deepEqual(m.veriOlanAylar, ["2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.equal(m.panelAdresi, `${ctx.base}/panel?ay=2026-10`);
  // JSON'da bölünmez boşluk yok (okunaklı)
  assert.doesNotMatch(JSON.stringify(m), / /);
});

test("ay özeti, Eylül 2026: reçeteye göre net kâr Genel bakış'la aynı; en çok kazandıranlar", () => {
  const m = monthSummary(model, "2026-09", ctx);
  close(m.teorik?.netKar, dashboard(model, "2026-09").theoretical!.netProfit, "net kâr = dashboard");
  assert.equal(m.durum, "bitti");
  assert.ok(m.enCokKazandiran.length > 0 && m.enCokKazandiran.length <= 5);
  assert.equal(m.tahmin, null);
});

test("yıl özeti 2026: 12 ay, ciro yalnız Temmuz–Ekim; toplam cirosu girilmiş ayların toplamı", () => {
  const y = yearSummary(model, 2026, ctx);
  assert.equal(y.aylar.length, 12);
  assert.deepEqual(
    y.aylar.filter((a) => a.ciroGirildi).map((a) => a.ay),
    ["2026-07", "2026-08", "2026-09", "2026-10"],
  );
  close(
    y.toplam.kar,
    y.aylar.reduce((a, x) => a + (x.kar ?? 0), 0),
    "kâr toplamı",
    0.02,
  );
  close(y.aylar.find((a) => a.ay === "2026-10")!.kar, -39003.92, "Ekim");
  assert.equal(y.aylar[0].kar, null);
});

/** Ayın laffogato.net online satışı (kafe; KDV dahil 2.350 ₺, içindeki KDV 213,64 ₺ → KDV hariç 2.136,36 ₺) */
function siteMonth(month: string): SiteSalesMonth {
  const none = { orders: 0, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
  return {
    month,
    pulledAt: `${month}-01T06:00:00.000Z`,
    now: `${month}-01T06:00:00.000Z`,
    from: `${month}-01`,
    to: `${month}-30`,
    closed: false,
    cafe: { ...none, orders: 3, grossMinor: 235_000, netMinor: 235_000, kdvMinor: 21_364, lines: [] },
    shop: none,
    karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
    manual: { orders: 0, grossMinor: 0, netMinor: 0 },
  };
}

test("ay özeti: POS cirosu girilmemiş, yalnız online satışı olan ay (her ayın 1'i) kâr ve marj vermez, 'POS cirosu girilmedi' der", () => {
  // Faturasız: eski hâli %100 marjla 2.136 ₺ kâr derdi; ilk mal faturası gelince büyük zarar
  const onlyOnline = monthSummary(createModel({ ...ds, currentMonth: "2026-11", siteSales: [siteMonth("2026-11")] }), "2026-11", ctx);
  assert.equal(onlyOnline.gerceklesen?.kar, null);
  assert.equal(onlyOnline.gerceklesen?.karMarjiYuzde, null);
  close(onlyOnline.gerceklesen?.onlineKdvHaric, 2136.36, "online, KDV hariç");

  const goods = ds.invoices.find((i) => i.category === "Hammadde & İçecek")!;
  const invoice = { ...goods, id: 999_001, date: "2026-11-01", amount: 10_000, discount: 0, payable: 11_000 };
  const nov = createModel({ ...ds, currentMonth: "2026-11", siteSales: [siteMonth("2026-11")], invoices: [...ds.invoices, invoice] });
  const pm = nov.pnlMonth("2026-11");
  assert.equal(pm.revenue, null);
  assert.ok(pm.site && pm.expenses >= 10_000, "online satış ve mal faturası var");
  // Panelin kuralı: Genel bakış "Faturaya göre" kârı göstermez, Gelir-gider yıl şeridi ayı saymaz
  assert.equal(dashboard(nov, "2026-11").actual.hasRevenue, false);
  assert.equal(yearSummary(nov, 2026, ctx).aylar.find((a) => a.ay === "2026-11")!.kar, null);

  const m = monthSummary(nov, "2026-11", ctx);
  const g = m.gerceklesen!;
  assert.ok(g, "online satış ve giderler yine görünür");
  assert.equal(g.kar, null);
  assert.equal(g.karMarjiYuzde, null);
  assert.equal(g.ciroKdvDahil, null);
  assert.equal(g.ciroKdvHaric, null);
  assert.equal(g.toplamCiroKdvHaric, null);
  close(g.onlineKdvHaric, 2136.36, "online, KDV hariç");
  close(g.toplamGider, pm.expenses, "gider = pnlMonth");
  assert.ok(m.uyarilar.includes("Kasım 2026 için POS cirosu girilmedi (Satışlar'daki ay bilgisi ya da kasa raporu): faturaya göre kâr hesaplanmadı."), m.uyarilar.join(" | "));
  assert.ok(!m.hesap.some((h) => h.startsWith("Kâr =")), "kâr hesap satırı yok");
  assert.ok(m.hesap.includes("laffogato.net online satışı 2.136 ₺ (KDV hariç); POS cirosu girilmediği için kâr hesaplanmadı"), m.hesap.join(" | "));
  assert.ok(m.hesap.some((h) => h.startsWith("Giderler = mal maliyeti")));

  // Ne POS cirosu ne online satış: aynı uyarı, gerçekleşen yok
  const dec = monthSummary(nov, "2026-12", ctx);
  assert.equal(dec.gerceklesen, null);
  assert.ok(dec.uyarilar.includes("Aralık 2026 için POS cirosu girilmedi (Satışlar'daki ay bilgisi ya da kasa raporu): faturaya göre kâr hesaplanmadı."));
  // POS cirosu girilmiş ayda uyarı yok
  assert.ok(!monthSummary(model, "2026-10", ctx).uyarilar.some((u) => /POS cirosu girilmedi/.test(u)));
});

// ---------------------------------------------------------------- urun_karliligi

test("ürün kârlılığı: Ekim'de satış listesi yok → Eylül adetleri ve notu; 'zarar' sırası en az kâr bırakan beş ürün", () => {
  const p = urun({ siralama: "zarar", limit: 5 });
  assert.equal(p.satisAyi, "2026-09");
  assert.equal(p.satisAyiNotu, "Ekim 2026 için ürün satış listesi yok; Eylül 2026 adetleri kullanıldı.");
  assert.deepEqual(
    p.urunler.map((u) => u.ad),
    ["Hindistan Cevizli Bar", "Kakao Protein Bar", "Kruvasanlı Hindi Füme Sandviç", "Koska Fındık", "Extra Shot"],
  );
  assert.equal(p.toplam.satilanAdet, 2426);
  close(p.toplam.ortalamaKatkiPayi, 112.13, "satış ağırlıklı ortalama katkı");
  assert.match(p.hesap.at(-1)!, /= 1 ÷ 129 ürün × 0,7/);
  assert.equal(p.urunler[0].panelAdresi, `${ctx.base}/panel/urunler/${ds.products.find((x) => x.name === "Hindistan Cevizli Bar")!.id}?ay=2026-09`);
});

test("ürün kârlılığı: menü sınıfı Analiz'deki menü mühendisliğiyle aynı; ürün araması Türkçe harf duyarlı", () => {
  const me = menuEngineering(model, "2026-09");
  const cls = new Map(me.items.map((x) => [`${x.p.product.name} ${x.p.product.size}`, MENU_CLASS_INFO[x.cls].label]));
  const p = urun({ ay: "2026-09", siralama: "toplam_kar", limit: 50 });
  assert.equal(p.urunler.length, 50);
  for (const u of p.urunler) assert.equal(u.menuSinifi, cls.get(`${u.ad} ${u.boy}`), u.ad);
  // Toplam kâr sırası azalan
  for (let i = 1; i < p.urunler.length; i++) assert.ok((p.urunler[i - 1].toplamKar ?? -Infinity) >= (p.urunler[i].toplamKar ?? -Infinity));
  const latte = urun({ ay: "2026-09", urun: "LATTE", limit: 50 });
  assert.ok(latte.urunler.length > 10 && latte.urunler.every((u) => /latte/i.test(u.ad)));
  // Menüdeki İngilizce adlar: Türkçe küçük harfte "I" "ı" olur; "ice", "ICE" ve "İce" hepsi Ice Latte'yi bulur
  for (const q of ["ice latte", "ICE LATTE", "İce latte"]) {
    const ice = urun({ ay: "2026-09", urun: q, limit: 50 });
    assert.ok(ice.urunler.filter((u) => u.ad === "Ice Latte").length === 2, q);
    assert.ok(ice.urunler.every((u) => /ice latte/i.test(u.ad)), q);
  }
  // Aksan ve Türkçe harf: "sicak cikolata" "Sıcak Çikolata"yı bulur
  const hot = ds.products.find((p) => /^S[ıi]cak/.test(p.name));
  if (hot) assert.ok(urun({ ay: "2026-09", urun: "sicak", limit: 50 }).urunler.some((u) => u.ad === hot.name));
  // Bilinmeyen kategori: kullanıcıya söylenen hata ve kategorilerin adları
  assert.throws(() => urun({ kategori: "yokböyle" }), (e: Error) => e instanceof ToolInputError && /adında kategori yok/.test(e.message));
});

/** Adı verilen hammaddelerin fiyatı girilmemiş (ekle'nin kuralı: elle, paket fiyatı 0) */
const unpricedDs = (base: Dataset, ...names: string[]): Dataset => ({
  ...base,
  ingredients: base.ingredients.map((i) => (names.includes(i.name) ? { ...i, packagePrice: 0, priceSource: "manual" as const } : i)),
});
/** Reçetesinde `name` geçen etkin ürünlerin adları ("Latte M"; tek boyda yalnız ad), modeldeki sırayla */
const usersOf = (m: ReturnType<typeof createModel>, name: string, filter: (product: string) => boolean = () => true) =>
  m.activeProducts.filter((x) => filter(x.product.name) && x.lines.some((l) => l.ingredient?.name === name)).map((x) => productLabel(x.product));

test("fiyatı girilmemiş hammadde reçetede: ürün kârlılığı 'maliyet eksik' der, ürünleri ve satırında maliyetEksik (ekle)", () => {
  const milk = ds.ingredients.find((i) => i.name === "Süt %2,5")!;
  const unpriced = createModel(unpricedDs(ds, "Süt %2,5"));
  const withMilk = usersOf(unpriced, "Süt %2,5");
  assert.ok(withMilk.length > 5);
  assert.deepEqual(unpricedInRecipes(unpriced.activeProducts), { ingredients: ["Süt %2,5"], products: withMilk });
  assert.deepEqual(unpricedInRecipes(model.activeProducts), { ingredients: [], products: [] });
  const p = productProfitability(unpriced, { ...urunKarliligiInput.parse({}), ay: "2026-09" }, ctx);
  assert.ok(p.uyarilar.includes("1 hammaddenin fiyatı girilmemiş; maliyet eksik"), p.uyarilar.join(" | "));
  assert.ok(p.uyarilar.includes("Fiyatı girilmemiş: Süt %2,5."));
  assert.ok(p.uyarilar.includes(`Maliyeti eksik ${withMilk.length} ürün (kârı olduğundan yüksek görünür): ${withMilk.slice(0, 5).join(", ")} ve ${withMilk.length - 5} ürün daha.`), p.uyarilar.join(" | "));
  for (const u of p.urunler) assert.equal(u.maliyetEksik, withMilk.includes(productLabel({ name: u.ad, size: u.boy })), u.ad);
  // Reçetede olmayan fiyatsız kalem (sayım için eklenen) uyarı vermez
  const extra = createModel({ ...ds, ingredients: [...ds.ingredients, { ...milk, id: 99_999, name: "Sayım kalemi", packagePrice: 0, priceSource: "manual" as const }] });
  assert.deepEqual(unpricedInRecipes(extra.activeProducts).ingredients, []);
  assert.deepEqual(unpricedWarnings({ ingredients: [], products: [] }), []);
});

test("maliyet eksik uyarısı yalnız cevaptaki ürünler için: Latte M'ye başka ürünün sosu yüzünden 'eksik' denmez; sıralama bütün listeden", () => {
  const m = createModel(unpricedDs(ds, "Karamel sos"));
  // "latte" araması karamelli latteleri de kapsar: uyarı onlar için, satırda yalnız onlar işaretli
  const caramelLattes = usersOf(m, "Karamel sos", (n) => /latte/i.test(n));
  assert.ok(caramelLattes.length >= 2 && caramelLattes.length < usersOf(m, "Karamel sos").length, "kapsam dışında karamelli ürün de var");
  const latte = productProfitability(m, { ...urunKarliligiInput.parse({ urun: "latte", limit: 50 }), ay: "2026-09" }, ctx);
  assert.equal(latte.urunler.find((u) => u.ad === "Latte" && u.boy === "M")!.maliyetEksik, false, "Latte M'nin reçetesi tam");
  assert.deepEqual(latte.urunler.filter((u) => u.maliyetEksik).map((u) => productLabel({ name: u.ad, size: u.boy })).sort(), [...caramelLattes].sort());
  assert.ok(latte.uyarilar.includes("1 hammaddenin fiyatı girilmemiş; maliyet eksik"));
  assert.ok(latte.uyarilar.includes("Fiyatı girilmemiş: Karamel sos."));
  assert.ok(latte.uyarilar.includes(`Maliyeti eksik ${caramelLattes.length} ürün (kârı olduğundan yüksek görünür): ${caramelLattes.join(", ")}.`), latte.uyarilar.join(" | "));
  // Karamel sos kullanmayan lattelerde uyarı yok
  const spanish = productProfitability(m, { ...urunKarliligiInput.parse({ urun: "spanish" }), ay: "2026-09" }, ctx);
  assert.ok(spanish.urunler.length > 0 && spanish.urunler.every((u) => !u.maliyetEksik));
  assert.ok(!spanish.uyarilar.some((u) => /fiyatı girilmemiş|Maliyeti eksik/i.test(u)), spanish.uyarilar.join(" | "));
  // Süzgeçsiz sıralama bütün menüden yapılır: ilk 3'te karamelli ürün olmasa da eksik maliyet sıralamayı etkiler, uyarı var
  const top = productProfitability(m, { ...urunKarliligiInput.parse({ limit: 3 }), ay: "2026-09" }, ctx);
  assert.ok(top.uyarilar.includes("1 hammaddenin fiyatı girilmemiş; maliyet eksik"));
});

// ---------------------------------------------------------------- zam_etkisi

const milk = ds.ingredients.find((i) => i.name === "Süt %2,5")!;
const row = (ingredientId: number, packagePrice: number, packageSize: number, changedAt: string): PriceHistoryRow => ({
  ingredientId,
  packagePrice,
  packageSize,
  changedAt,
  changedBy: "Excel",
  note: null,
});
function milkAlerts(month: string | null, base: Dataset = ds): { model: ReturnType<typeof createModel>; alerts: PriceAlertsLike } {
  const m = createModel({ ...base, ingredients: base.ingredients.map((i) => (i.id === milk.id ? { ...i, packagePrice: 60 } : i)) });
  const changes = ingredientChanges(
    m.ds.ingredients,
    [row(milk.id, milk.packagePrice, milk.packageSize, "2026-09-01T09:00:00.000Z"), row(milk.id, 60, 1000, "2026-10-15T09:00:00.000Z")],
    "2026-09-22T00:00:00.000Z",
  );
  return { model: m, alerts: { changes, impacts: productImpacts(m, changes).map((i) => ({ ...i, acknowledged: false })), loss: priceLoss(m, changes, month) } };
}

test("zam etkisi: süt +%16 → ürünler aylık kayba göre; hammadde L ile; hesap ve kaynak satırları insight'ın hesabından", () => {
  const { model: m, alerts } = milkAlerts("2026-09");
  const z = priceRiseImpact(m, alerts, { baslangic: "2026-09-22", bitis: "2026-10-22", limit: 10 }, ctx);
  assert.equal(z.dayanak.satisAyi, "2026-09");
  assert.equal(z.dayanak.olcek, 1);
  close(z.toplamAylikKayip, alerts.loss.totalLoss, "toplam = insight");
  assert.ok(z.urunler.length === 10);
  for (let i = 1; i < z.urunler.length; i++) assert.ok((z.urunler[i - 1].aylikKayip ?? 0) >= (z.urunler[i].aylikKayip ?? 0));
  const h = z.hammaddeler[0];
  assert.equal(h.ad, "Süt %2,5");
  assert.equal(h.birim, "L");
  close(h.yeniBirimFiyat, 60, "yeni ₺/L");
  close(h.artisYuzde, Math.round(alerts.loss.ingredients[0].pct * 1000) / 10, "artış %");
  assert.ok(Math.abs((h.aylikKayip ?? 0) - 690) < 20, `süt ayda ≈ 690 ₺: ${h.aylikKayip}`);
  assert.equal(z.hesap[0], "Ayda kâr kaybı = (yeni − eski birim fiyat) × reçetedeki miktar × (1 + fire) × ayda satılan adet");
  assert.match(z.hesap[1], /^Süt %2,5: .* → 60,00 ₺\/L \(\+%16\), ayda .* L kullanım → ayda ≈ /);
  // Yüzde eksiz yazılır (iyelik eki sayının okunuşuna göre değişir: "%3,2'si", "%16'sı")
  assert.match(z.hesap.at(-1)!, /^Toplam ≈ [\d.]+ ₺\/ay \(brüt kâra oranı %\d+(,\d)?\)$/);
  assert.equal(z.hesap.at(-1), `Toplam ≈ ${tl(alerts.loss.totalLoss)}/ay (brüt kâra oranı ${pct(alerts.loss.totalLoss / alerts.loss.grossProfit!)})`);
  assert.equal(z.kaynak[1], "Eylül 2026 satışlarına göre (ayda 30 açık gün).");
  assert.equal(z.panelAdresi, `${ctx.base}/panel/urunler#zamlar`);
  assert.equal(readableUnit("gr").label, "kg");
  assert.equal(readableUnit("adet").factor, 1);
});

test("zam etkisi: satış listesi yoksa aylık tutarlar null, yalnız birim maliyet farkı; kaynak bunu söyler", () => {
  const { model: m, alerts } = milkAlerts(null);
  const z = priceRiseImpact(m, alerts, { baslangic: "2026-09-22", bitis: "2026-10-22", limit: 5 }, ctx);
  assert.equal(z.toplamAylikKayip, null);
  assert.equal(z.dayanak.olcek, null);
  assert.ok(z.urunler.every((u) => u.aylikKayip === null && u.aylikAdet === null && u.birimMaliyetArtisi > 0));
  assert.equal(z.kaynak[1], "Satış listesi yok: aylık tutar hesaplanamadı, yalnız birim maliyet farkı var.");
  // Zam yoksa bir cümle; "Toplam ≈ 0 ₺/ay" satırı yok
  const none = priceRiseImpact(model, { changes: [], impacts: [], loss: priceLoss(model, [], "2026-09") }, { baslangic: "2026-09-22", bitis: "2026-10-22", limit: 5 }, ctx);
  assert.ok(none.uyarilar.includes("Bu dönemde fiyatı %5'ten fazla artan hammadde yok."));
  assert.ok(!none.hesap.some((h) => h.startsWith("Toplam")), none.hesap.join(" | "));
  assert.doesNotMatch(JSON.stringify(none.hesap), /%[\d,]+'/);
});

test("zam etkisi: fiyatı girilmemiş hammadde yalnız zamdan etkilenen ürünlerde uyarı verir; satırında maliyetEksik", () => {
  // Süt zammı + Karamel sos fiyatsız: karamelli sütlü ürünlerin birim kârı ve önerilen fiyatı eksik maliyetle
  const { model: m, alerts } = milkAlerts("2026-09", unpricedDs(ds, "Karamel sos"));
  const affected = new Set(alerts.loss.products.map((p) => p.productId));
  const caramel = m.activeProducts.filter((x) => affected.has(x.product.id) && x.lines.some((l) => l.ingredient?.name === "Karamel sos")).map((x) => productLabel(x.product));
  assert.ok(caramel.length > 0);
  const z = priceRiseImpact(m, alerts, { baslangic: "2026-09-22", bitis: "2026-10-22", limit: 200 }, ctx);
  assert.ok(z.uyarilar.includes("1 hammaddenin fiyatı girilmemiş; maliyet eksik"), z.uyarilar.join(" | "));
  assert.ok(z.uyarilar.includes("Fiyatı girilmemiş: Karamel sos."));
  assert.deepEqual(z.urunler.filter((u) => u.maliyetEksik).map((u) => productLabel({ name: u.ad, size: u.boy })).sort(), [...caramel].sort());
  // Zamdan etkilenmeyen bir ürünün fiyatsız hammaddesi (Su (PET) yalnız şişe suda) uyarı vermez
  const { alerts: a2, model: m2 } = milkAlerts("2026-09", unpricedDs(ds, "Su (PET)"));
  const z2 = priceRiseImpact(m2, a2, { baslangic: "2026-09-22", bitis: "2026-10-22", limit: 10 }, ctx);
  assert.ok(!z2.uyarilar.some((u) => /fiyatı girilmemiş|Maliyeti eksik/i.test(u)), z2.uyarilar.join(" | "));
  assert.ok(z2.urunler.every((u) => !u.maliyetEksik));
});

// ---------------------------------------------------------------- tedarikci_ozeti

test("tedarikçi özeti: Kaldi 2026 → 8 fatura, 156.840,23 ₺; ödendi 145.323,46 ₺; kalan 11.516,77 ₺ (tahmini vade)", () => {
  const r = supplierSummary(ledger(), { tedarikci: "Kaldi", baslangic: "2026-01-01", bitis: "2026-10-22", limit: 20 }, ctx);
  assert.ok("tedarikci" in r);
  assert.equal(r.ozet.faturaSayisi, 8);
  close(r.ozet.faturaToplamiKdvDahil, 156840.23, "fatura toplamı");
  close(r.ozet.odendiIsaretli, 145323.46, "ödendi işaretli");
  assert.equal(r.ozet.odendiFaturaSayisi, 7);
  close(r.ozet.acikBorc, 11516.77, "kalan borç");
  assert.equal(r.tedarikci.vadeGunu, 45);
  assert.equal(r.tedarikci.odemeSekli, "Havale / EFT");
  assert.equal(r.hesap[0], "Dönemde 8 fatura, toplam 156.840,23 ₺ (KDV dahil)");
  assert.equal(r.hesap[1], "Ödendi işaretli 7 fatura = 145.323,46 ₺");
  assert.match(r.hesap[2], /^Kalan borç 1 fatura = 11\.516,77 ₺ \(14\.08\.2026 faturası; vade 28\.09\.2026, tahmini: fatura günü \+ 45 gün\)$/);
  const open = r.faturalar.find((f) => f.durum === "ödenmedi")!;
  assert.equal(open.vade, "2026-09-28");
  assert.equal(open.vadeTahmini, true);
  assert.ok(r.faturalar.filter((f) => f.durum === "ödendi").every((f) => f.vade === null && f.vadeTahmini === false));
  assert.equal(r.panelAdresi, `${ctx.base}/panel/tedarikciler/kaldi`);
  assert.match(r.kaynak[0], /banka hareketi değil/);
});

test("tedarikçi özeti: birden çok eşleşme aday listesi, bilinmeyen ad yakın adaylar; bütün tedarikçiler fatura ya da borç sırasıyla", () => {
  const L = ledger();
  const many = supplierSummary(L, { tedarikci: "a", baslangic: "2026-01-01", bitis: "2026-10-22", limit: 20 }, ctx);
  assert.ok("birdenFazla" in many && many.adaylar.length === 5);
  const none = supplierSummary(L, { tedarikci: "Kaldiye", baslangic: "2026-01-01", bitis: "2026-10-22", limit: 20 }, ctx);
  assert.ok("bulunamadi" in none && none.adaylar.some((a) => a.ad === "Kaldi"));
  const all = supplierSummary(L, { baslangic: "2026-01-01", bitis: "2026-10-22", limit: 5 }, ctx);
  assert.ok("tedarikciler" in all);
  assert.equal(all.tedarikciler.length, 5);
  for (let i = 1; i < 5; i++) assert.ok(all.tedarikciler[i - 1].faturaToplamiKdvDahil >= all.tedarikciler[i].faturaToplamiKdvDahil);
  const debt = supplierSummary(L, { baslangic: "2026-01-01", bitis: "2026-10-22", limit: 5, siralama: "borc" }, ctx);
  assert.ok("tedarikciler" in debt && debt.tedarikciler[0].ad === "Kaldi" && debt.tedarikciler[0].toplamAcikBorc > 0);
  assert.ok(debt.hesap.includes("Sıra: bütün açık borç büyükten küçüğe"));
  assert.throws(() => supplierSummary(L, { baslangic: "2026-10-22", bitis: "2026-01-01", limit: 5 }, ctx), ToolInputError);
});

// ---------------------------------------------------------------- odemeler

const reminders: ReminderRow[] = [
  { id: 1, title: "Kira", kind: "kira", amount: 50_000, dueDate: "2026-10-25", anchorDate: "2026-10-25", repeat: "monthly", remindDaysBefore: 3, note: `IBAN ${IBAN} satis@kaldi.example`, active: true },
  { id: 2, title: "Elektrik", kind: "fatura", amount: null, dueDate: "2026-11-10", anchorDate: "2026-11-10", repeat: "none", remindDaysBefore: 3, note: "gizli-not", active: true },
  { id: 3, title: "Gecikmiş SGK", kind: "vergi", amount: 12_000, dueDate: "2026-10-15", anchorDate: "2026-10-15", repeat: "none", remindDaysBefore: 3, note: null, active: true },
];
const unpaid = [{ id: 9, supplier: "Kaldi", invoiceNo: "KLA1", date: "2026-10-01", dueDate: null, payable: 1000, termDays: 30 }];

test("ödemeler: Ödemeler ekranının özeti ve aralığı; tutarsız hatırlatıcı sayılır; notlar gönderilmez", () => {
  const items = upcomingItems(reminders, unpaid, "2026-10-22", { invoiceTermDays: 30 });
  const r = upcomingPayments({ today: "2026-10-22", items, invoiceTermDays: 30 }, odemelerInput.parse({}), null, ctx);
  assert.deepEqual(r.ozet.gecikmis, { adet: 1, toplam: 12_000 });
  assert.equal(r.kalemler.length, 3, "45 gün: geciken hariç");
  assert.equal(r.tutariGirilmemis, 1);
  const inv = r.kalemler.find((k) => k.tur === "fatura")!;
  assert.equal(inv.tahminiVade, true);
  assert.equal(inv.vade, "2026-10-31");
  assert.equal(r.kalemler.find((k) => k.baslik === "Kira")!.tekrar, "Her ay");
  assert.equal(r.nakitPlani, undefined, "istenmedikçe nakit planı yok");
  assert.equal(r.panelAdresi, `${ctx.base}/panel/hatirlaticilar?aralik=45gun`);
  const late = upcomingPayments({ today: "2026-10-22", items, invoiceTermDays: 30 }, odemelerInput.parse({ aralik: "gecikmis", kaynak: "hatirlatici" }), null, ctx);
  assert.deepEqual(
    late.kalemler.map((k) => k.baslik),
    ["Gecikmiş SGK"],
  );
  const onlyInvoices = upcomingPayments({ today: "2026-10-22", items, invoiceTermDays: 30 }, odemelerInput.parse({ kaynak: "fatura" }), null, ctx);
  assert.ok(onlyInvoices.kalemler.every((k) => k.tur === "fatura"));
  // Nakit planı istendi ama okunamadı: null ve kaynakta söylenir
  const noPlan = upcomingPayments({ today: "2026-10-22", items, invoiceTermDays: 30 }, odemelerInput.parse({ nakitPlani: true }), null, ctx);
  assert.equal(noPlan.nakitPlani, null);
  assert.ok(noPlan.kaynak.includes("Nakit planı şu an okunamadı"));
  assert.ok(isEstimatedDue({ source: "invoice", detail: "Fatura KLA1 · vade tahmini (30 gün)" }));
  assert.equal(isEstimatedDue({ source: "reminder", detail: "vade tahmini" }), false);
  assertNoLeak("odemeler", r);
});

// ---------------------------------------------------------------- kasa_raporlari

const report = (date: string, o: Partial<CashReportLike> = {}): CashReportLike & Record<string, unknown> => ({
  date,
  zTotal: 10_000,
  cash: 3_000,
  card: 6_000,
  mealCard: 500,
  online: 500,
  other: 0,
  openingCash: 1_000,
  cashIn: 0,
  cashOut: 200,
  countedCash: 3_800,
  handedOver: 2_800,
  cashDiff: 0,
  revision: 1,
  // Yanıta girmemesi gerekenler
  countedByName: "Mehmet Personel",
  submittedByName: "Ali Kasiyer",
  note: "gizli-not",
  cashOutNote: "neye çıktı: avans",
  ...o,
});

test("kasa raporları: toplamlar, fark türleri, eksik günler (ilk rapordan düne), devir ve düzeltme işaretleri; ad ve not yok", () => {
  const reports = [
    report("2026-10-18"),
    report("2026-10-19", { cashDiff: -150, countedCash: 3_650, cashIn: 250 }),
    // açılış önceki devirle (3.650 − 2.800 = 850) tutmuyor; sonradan düzeltilmiş
    report("2026-10-21", { openingCash: 1_000, cashDiff: 40, revision: 2 }),
  ];
  const r = cashReportSummary(reports, {
    from: "2026-10-15",
    to: "2026-10-22",
    through: "2026-10-21",
    firstReport: "2026-10-17",
    before: { date: "2026-10-17", amount: 1_000 },
    base: ctx.base,
  });
  assert.equal(r.raporSayisi, 3);
  assert.deepEqual(r.eksikGunler, ["2026-10-17", "2026-10-20"], "ilk rapordan önce ve bugün eksik sayılmaz");
  assert.equal(r.toplam.zToplam, 30_000);
  assert.equal(r.toplam.kasaFarkiToplam, -110);
  assert.equal(r.toplam.gunIcindeGiren, 250);
  assert.equal(r.toplam.gunIcindeCikan, 600);
  assert.match(r.hesap[0], /^Kasa farkı = sayılan nakit − \(açılış \+ nakit satış \+ gün içinde giren − gün içinde çıkan\)/);
  assert.deepEqual([r.toplam.eksikGun, r.toplam.fazlaGun, r.toplam.tutanGun], [1, 1, 1]);
  assert.deepEqual(
    r.gunluk.map((g) => [g.tarih, g.fark, g.acilisDevirleTutmuyor, g.sonradanDuzeltildi]),
    [
      ["2026-10-18", "tutuyor", false, false],
      ["2026-10-19", "eksik", false, false],
      ["2026-10-21", "fazla", true, true],
    ],
  );
  assert.ok(r.uyarilar.some((u) => u.startsWith("2 günün raporu yok")));
  assert.ok(r.uyarilar.some((u) => u.startsWith("1 günde açılış önceki raporun devriyle tutmuyor")));
  assert.match(r.kaynak[1], /Z'deki online: platform satışları/);
  assertNoLeak("kasa_raporlari", r);
  assert.ok(!("giren" in r.gunluk[0]));
});

test("aralık kuralları: en çok 92 gün, bitiş başlangıçtan önce olamaz, bugünden sonra olamaz; girdi şemaları", () => {
  assert.throws(() => checkRange("2026-01-01", "2026-04-03", { maxDays: 92 }), { message: "Tarih aralığı en çok 92 gün olabilir" });
  assert.doesNotThrow(() => checkRange("2026-01-01", "2026-04-02", { maxDays: 92 }));
  assert.throws(() => checkRange("2026-10-10", "2026-10-01", { maxDays: 92 }), { message: "Bitiş tarihi başlangıçtan önce olamaz" });
  assert.throws(() => checkRange("2026-10-10", "2026-10-23", { maxDays: 92, today: "2026-10-22" }), { message: "Bitiş tarihi bugünden sonra olamaz" });
  assert.equal(kasaRaporlariInput.safeParse({ baslangic: "2026-02-30", bitis: "2026-03-01" }).success, false, "takvimde olmayan gün");
  assert.equal(kasaRaporlariInput.safeParse({ baslangic: "2026-10-01", bitis: "2026-10-22", fazla: 1 }).success, false, "bilinmeyen alan");
  assert.equal(zamEtkisiInput.parse({}).limit, 10);
  assert.equal(tedarikciOzetiInput.parse({}).siralama, "fatura");
  assert.equal(urunKarliligiInput.safeParse({ limit: 51 }).success, false);
  assert.equal(araInput.safeParse({ metin: "a" }).success, false, "en az 2 harf");
  assert.equal(odemelerInput.parse({}).aralik, "45gun");
});

// ---------------------------------------------------------------- ara

test("arama: ürün, hammadde, tedarikçi; vergi no ipucundan düşer ve aranamaz; adı aranan metinle başlayan önce", () => {
  const entries = [
    { kind: "supplier" as const, label: "Sütaş", hint: `Tedarikçi · SÜTAŞ SÜT A.Ş. · ${VKN} · Sütaş Gıda`, href: "/panel/tedarikciler/sutas" },
    { kind: "ingredient" as const, label: "Süt %2,5", hint: "Hammadde · Süt", href: "/panel/hammaddeler?ara=S%C3%BCt" },
    { kind: "product" as const, label: "Sütlü Kahve", hint: "Ürün", href: "/panel/urunler/5" },
    { kind: "product" as const, label: "Alternatif Süt", hint: "Ürün", href: "/panel/urunler/6" },
  ];
  const r = searchResults(entries, "süt", ctx);
  assert.equal(r.toplam, 4);
  assert.equal(r.sonuclar[0].tur, "tedarikçi");
  assert.equal(r.sonuclar[0].ipucu, "Tedarikçi · SÜTAŞ SÜT A.Ş. · Sütaş Gıda");
  assert.equal(r.sonuclar.at(-1)!.ad, "Alternatif Süt", "adın ortasında geçen sonra");
  assert.equal(searchResults(entries, VKN, ctx).toplam, 0, "vergi noyla aranamaz");
  assert.equal(safeHint(`Tedarikçi · 123 456 78 90 · Kaldi`), "Tedarikçi · Kaldi");
  assertNoLeak("ara", r);
});

// ---------------------------------------------------------------- Çıktının boyu

test("çıktının boyu: sınırı aşan liste yarıya inerek kısalır, kesildi yazılır, sonuç sınırın altında", () => {
  const big = { panelAdresi: "x", satirlar: Array.from({ length: 200 }, (_, i) => ({ i, metin: "x".repeat(400) })) };
  const text = fitOutput(big, 20_000);
  assert.ok(text.length <= 20_000);
  const parsed = JSON.parse(text);
  assert.equal(parsed.kesildi, CUT_NOTE);
  assert.ok(parsed.satirlar.length > 0 && parsed.satirlar.length < 200);
  assert.equal(fitOutput({ a: 1 }), '{"a":1}');
  // Kısaltılamayan tek büyük değer: listesiz özet
  const blob = JSON.parse(fitOutput({ panelAdresi: "p", metin: "x".repeat(100) }, 50));
  assert.deepEqual(blob, { kesildi: CUT_NOTE, panelAdresi: "p" });
});

test("satış dayanağı tek yerden (salesFor): ayın listesi yoksa önceki son ay ve notu; hiç yoksa adetler 0", () => {
  const oct = salesFor(model, "2026-10");
  assert.equal(oct.salesMonth, "2026-09");
  assert.equal(oct.note, "Ekim 2026 için ürün satış listesi yok; Eylül 2026 adetleri kullanıldı.");
  assert.equal(salesFor(model, "2026-09").note, null);
  const empty = createModel({ ...ds, salesLines: [] });
  const none = salesFor(empty, "2026-10");
  assert.equal(none.salesMonth, null);
  assert.equal(none.qtyByProduct.size, 0);
});

// ---------------------------------------------------------------- Sızıntı taraması

test("sızıntı taraması: bütün araç yanıtlarında IBAN, vergi no, telefon, e-posta, not, kişi adı ve yasak alan yok", () => {
  const L = ledger();
  assertNoLeak("ay_ozeti", monthSummary(model, "2026-10", ctx));
  assertNoLeak("ay_ozeti (yıl)", yearSummary(model, 2026, ctx));
  assertNoLeak("urun_karliligi", urun({ ay: "2026-09", limit: 50 }));
  const { model: m, alerts } = milkAlerts("2026-09");
  assertNoLeak("zam_etkisi", priceRiseImpact(m, alerts, { baslangic: "2026-09-22", bitis: "2026-10-22", limit: 30 }, ctx));
  assertNoLeak("tedarikci_ozeti (Kaldi)", supplierSummary(L, { tedarikci: "Kaldi", baslangic: "2026-01-01", bitis: "2026-10-22", limit: 100 }, ctx));
  assertNoLeak("tedarikci_ozeti (hepsi)", supplierSummary(L, { baslangic: "2026-01-01", bitis: "2026-10-22", limit: 100 }, ctx));
  assertNoLeak("tedarikci_ozeti (unvanla)", supplierSummary(L, { tedarikci: "KALDI KAHVE", baslangic: "2026-01-01", bitis: "2026-10-22", limit: 100 }, ctx));
  const items = upcomingItems(reminders, unpaid, "2026-10-22", { invoiceTermDays: 30 });
  assertNoLeak("odemeler", upcomingPayments({ today: "2026-10-22", items, invoiceTermDays: 30 }, odemelerInput.parse({ aralik: "ay" }), null, ctx));
  assertNoLeak(
    "kasa_raporlari",
    cashReportSummary([report("2026-10-20"), report("2026-10-21")], { from: "2026-10-01", to: "2026-10-22", through: "2026-10-21", firstReport: "2026-10-20", before: null, base: ctx.base }),
  );
});
