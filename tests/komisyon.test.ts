// Komisyon ve hakediş (src/lib/commission/*, src/app/panel/komisyonlar/texts.ts; docs/KOMISYON.md): kanalın bulunması,
// kalemlerin sınıfı, satış ayı, satışın kaynağı (elle yazılan ekstre ya da tek kanalda Z toplamı), gerçek oran ve
// uyarılar, hakediş (beklenen, son gün, durum), zil ve sabah e-postası; kaynak denetimi: ekran ve eylemler yalnız
// yöneticinin, zil ve Bugün hafif yoldan okur, okuyan yol yazmaz.
// Çalıştırma: npx tsx --test tests/komisyon.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  dialogData,
  mealStatSub,
  openPayouts,
  openPayoutsSub,
  payoutText,
  pendingBadge,
  pendingSub,
  platformTillLine,
  ratePartsText,
  sourceLabel,
  statusBadge,
  tillSub,
} from "../src/app/panel/komisyonlar/texts";
import { CHANNELS, channelDef, channelOf, classifyLine, fold } from "../src/lib/commission/channels";
import {
  buildCommissionReport,
  channelMonthChange,
  channelTill,
  commissionAlerts,
  commissionDigestBox,
  commissionLogKey,
  coverMonth,
  effectiveSettings,
  freshAlerts,
  groupInvoiceRows,
  groupOf,
  invoiceView,
  markValues,
  MAX_ALERTS,
  offCycleInvoice,
  overduePayouts,
  parseCommissionSettings,
  payoutOf,
  reportWindow,
  rowOf,
  shownChannels,
  type ChannelMonth,
  type ChannelMonthIn,
  type CommissionAlert,
  type CommissionInput,
  type CommissionInvoiceIn,
  type CommissionInvoiceRow,
  type TillDayIn,
} from "../src/lib/commission/report";
import { COMMISSION_SUPPLIERS } from "../src/server/parasut/mapping";
import { renderDigest } from "../src/server/notify/digest-template";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NBSP = " ";
/** Metindeki bölünmez boşluklar düz boşluk (beklenen metinler okunur kalsın) */
const plain = (s: string | null | undefined) => (s ?? "").replaceAll(NBSP, " ");

// ---------------------------------------------------------------- Yardımcılar

let nextId = 1;
function inv(supplier: string, date: string, amount: number, lines: [string, number, string?][] = [], o: Partial<CommissionInvoiceIn> = {}): CommissionInvoiceIn {
  return {
    id: nextId++,
    date,
    supplier,
    names: [supplier],
    invoiceNo: `NO${nextId}`,
    amount,
    discount: 0,
    payable: Math.round(amount * 1.2 * 100) / 100,
    needsReview: false,
    lines: lines.map(([name, netTotal, description]) => ({ name, description: description ?? null, netTotal })),
    ...o,
  };
}

function days(from: string, to: string, row: (date: string) => Omit<TillDayIn, "date"> = () => ({ mealCard: 500, online: 400 }), skip: string[] = []): TillDayIn[] {
  const out: TillDayIn[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (!skip.includes(date)) out.push({ date, ...row(date) });
  }
  return out;
}

const mark = (channel: ChannelMonthIn["channel"], month: string, o: Partial<ChannelMonthIn> = {}): ChannelMonthIn => ({ channel, month, sales: null, receivedOn: null, received: null, note: null, ...o });

/**
 * Fikstür F1 (plan §9, kesintilere göre): bugün 2 Aralık 2026, takip 10 Kasım'da başladı, kasa raporları 1 Ağustos'tan beri.
 * Ekim'in her günü Z'de yemek kartı 500, online (platformlar) 400. Yemek kartlarının ekstresi elle yazıldı (Z'de iki kart
 * tek toplam), Trendyol tek platform (Z toplamı).
 */
function f1(o: Partial<CommissionInput> = {}): CommissionInput {
  nextId = 1;
  return {
    today: "2026-12-02",
    through: "2026-12-01",
    since: "2026-11-10",
    fromMonth: "2026-01",
    firstReport: "2026-08-01",
    till: days("2026-10-01", "2026-10-31"),
    invoices: [
      inv("PLUXEE TÜRKİYE KURUMSAL HİZMETLER A.Ş.", "2026-10-31", 579, [
        ["Komisyon Bedeli", 279],
        ["Erken Ödeme Komisyonu", 300],
      ]),
      inv("Multinet Up", "2026-11-03", 398, [
        ["Komisyon", 248],
        ["POS Cihaz Kira Bedeli", 150, "Ekim"],
      ]),
      inv("Trendyol Go", "2026-10-06", 300, [["Komisyon", 300]]),
      inv("Trendyol Go", "2026-10-13", 300, [["Komisyon", 300]]),
      inv("Trendyol Go", "2026-10-20", 300, [["Komisyon", 300]]),
      inv("Trendyol Go", "2026-10-27", 340, [
        ["Komisyon", 300],
        ["Online Ödeme Hizmet Bedeli", 40],
      ]),
      inv("Pluxee", "2026-09-30", 270),
      inv("Pluxee", "2026-08-31", 270),
    ],
    marks: [mark("pluxee", "2026-10", { sales: 9300 }), mark("multinet", "2026-10", { sales: 6200 }), mark("pluxee", "2026-09", { sales: 9000 }), mark("pluxee", "2026-08", { sales: 9000 })],
    settings: {},
    ...o,
  };
}

const must = (r: ChannelMonth | null): ChannelMonth => {
  assert.ok(r, "kanal-ay yok");
  return r;
};

// ---------------------------------------------------------------- Kanallar ve kalemler

test("kanal: faturadaki ad ya da tedarikçi kartının adı; ilk eşleşen ad kazanır", () => {
  assert.equal(channelOf(["PLUXEE TÜRKİYE KURUMSAL HİZMETLER A.Ş."]), "pluxee");
  assert.equal(channelOf(["Sodexo Avantaj ve Ödüllendirme"]), "pluxee");
  assert.equal(channelOf(["Set Kart"]), "setcard");
  assert.equal(channelOf(["SETCARD"]), "setcard");
  assert.equal(channelOf(["Yemek Sepeti"]), "yemeksepeti");
  assert.equal(channelOf(["YEMEKSEPETİ ELEKTRONİK İLETİŞİM PERAKENDE GIDA LOJİSTİK A.Ş."]), "yemeksepeti");
  assert.equal(channelOf(["Trendyol Go"]), "trendyol");
  assert.equal(channelOf(["DSM Grup Danışmanlık İletişim ve Satış Tic. A.Ş."]), "trendyol");
  assert.equal(channelOf(["Ticket Restaurant"]), "edenred");
  assert.equal(channelOf(["Migros Yemek"]), "migros");
  assert.equal(channelOf(["Getir Perakende Lojistik A.Ş."]), "getir");
  // Metropol yemek kartı, ama aynı adlı AVM'nin kira faturası değil
  assert.equal(channelOf(["Metropol İstanbul AVM"]), null);
  assert.equal(channelOf(["MetropolCard"]), "metropol");
  assert.equal(channelOf(["Kaldi"]), null);
  assert.equal(channelOf([]), null);
  // Faturadaki ad tanınmazsa kartın adı ve diğer adları; ilk tanınan kazanır
  assert.equal(channelOf(["Kurumsal Hizmetler A.Ş.", null, "Pluxee"]), "pluxee");
  assert.equal(channelOf(["Multinet", "Pluxee"]), "multinet");
  // Paraşüt'ün komisyon platformu listesindeki her ad bir kanala bağlanır (kategori kuralı değişmedi)
  for (const name of COMMISSION_SUPPLIERS) assert.ok(channelOf([name]), name);
  // Kayıt: önce yemek kartları, her anahtar bir kez
  assert.deepEqual(
    CHANNELS.map((c) => c.kind),
    ["meal", "meal", "meal", "meal", "meal", "platform", "platform", "platform", "platform"],
  );
  assert.equal(channelDef("trendyol").label, "Trendyol Go");
  assert.equal(fold("  İŞLEM  Ücreti/Bedeli "), "islem ucreti bedeli");
});

test("kalem sınıfı: yemek kartında komisyon dışı ücret ve erken ödeme, platformda ödeme altyapısı ve reklam", () => {
  const meal = (t: string) => classifyLine(t, "meal");
  const platform = (t: string) => classifyLine(t, "platform");
  assert.equal(meal("Komisyon Bedeli"), "komisyon");
  assert.equal(meal("Hizmet Bedeli"), "komisyon");
  assert.equal(meal("Erken Ödeme Komisyonu"), "erken");
  assert.equal(meal("Aynı Gün Ödeme Hizmeti"), "erken");
  assert.equal(meal("Valör farkı"), "erken");
  assert.equal(meal("POS Cihaz Kira Bedeli"), "yasak");
  assert.equal(meal("Teknik Destek Bedeli"), "yasak");
  assert.equal(meal("Sarf malzemesi"), "yasak");
  assert.equal(meal("Depozito"), "yasak");
  // Zayıf sözcük "komisyon"la birlikteyse komisyon; yalnızsa komisyon dışı
  assert.equal(meal("POS İşlemleri Komisyonu"), "komisyon");
  assert.equal(meal("POS kullanım bedeli"), "yasak");
  assert.equal(meal("Kiraz"), "diger");
  assert.equal(meal("Reklam katılım"), "yasak");
  assert.equal(platform("Online Ödeme Hizmet Bedeli"), "asli");
  assert.equal(platform("Sipariş iletim ücreti"), "asli");
  assert.equal(platform("Öne Çıkarma Reklamı"), "reklam");
  assert.equal(platform("Kampanya katılım payı"), "reklam");
  assert.equal(platform("Komisyon"), "komisyon");
  assert.equal(platform("Erken hakediş bedeli"), "erken");
  // Platformda yemek kartının yasakları aranmaz
  assert.equal(platform("Kira"), "diger");
});

test("satış ayı: ayın 1–5'inde kesilen yemek kartı faturası önceki ayın; platform faturası kendi ayının", () => {
  assert.deepEqual(plainObj(coverMonth("2026-11-03", "meal")), { month: "2026-10", note: "3 Kasım tarihli fatura · Ekim satışları için" });
  assert.deepEqual(coverMonth("2026-10-31", "meal"), { month: "2026-10", note: null });
  assert.deepEqual(coverMonth("2026-11-06", "meal"), { month: "2026-11", note: null });
  assert.deepEqual(coverMonth("2026-11-03", "platform"), { month: "2026-11", note: null });
  assert.equal(coverMonth("2027-01-02", "meal").month, "2026-12");
});

function plainObj(o: { month: string; note: string | null }) {
  return { month: o.month, note: o.note === null ? null : plain(o.note) };
}

test("kalemler faturanın KDV hariç tutarına ölçeklenir; tek 'diğer' kalem komisyondur; kalemsiz faturanın tamamı komisyon", () => {
  const v = invoiceView(inv("Pluxee", "2026-10-31", 140, [["Komisyon", 100], ["Erken ödeme hizmeti", 50]]), "meal");
  assert.deepEqual(
    v.lines.map((l) => [l.cls, l.amount]),
    [
      ["komisyon", 93.33],
      ["erken", 46.67],
    ],
  );
  assert.equal(v.net, 140);
  assert.equal(v.vat, 28);
  assert.equal(v.lines.reduce((a, l) => a + l.amount, 0), 140);
  // Fatura altı iskonto: kalemler 0,01 farkla da faturayı tam verir
  const disc = invoiceView(inv("Pluxee", "2026-10-31", 100, [["A komisyon", 33.33], ["B komisyon", 33.33], ["C komisyon", 33.34]], { discount: 10 }), "meal");
  assert.equal(Math.round(disc.lines.reduce((a, l) => a + l.amount, 0) * 100) / 100, 90);
  assert.equal(invoiceView(inv("Trendyol Go", "2026-10-31", 80, [["Hizmet faturası", 80]]), "platform").lines[0].cls, "komisyon");
  const bare = invoiceView(inv("Pluxee", "2026-09-30", 26.78), "meal");
  assert.equal(bare.lineless, true);
  assert.deepEqual(bare.lines, []);
  // Excel'den gelenlerde KDV sütunu 0: KDV = ödenecek − net
  assert.equal(bare.vat, Math.round((bare.payable - 26.78) * 100) / 100);
});

// ---------------------------------------------------------------- Satış, oran, uyarılar

test("satışın kaynağı: elle yazılan ekstre; yoksa grupta tek kanal varsa Z toplamı; yoksa nedeniyle bilinmiyor", () => {
  const r = buildCommissionReport(f1());
  assert.deepEqual(must(rowOf(r, "pluxee", "2026-10")).sales, { amount: 9300, source: "elle" });
  assert.deepEqual(must(rowOf(r, "multinet", "2026-10")).sales, { amount: 6200, source: "elle" });
  assert.deepEqual(must(rowOf(r, "trendyol", "2026-10")).sales, { amount: 12400, source: "tek" });
  assert.deepEqual(must(rowOf(r, "pluxee", "2026-09")).sales, { amount: 9000, source: "elle" });
  // Elle yazılmış olsa da grupta iki kart varken Z toplamı ipucu olmaz
  assert.equal(must(rowOf(r, "pluxee", "2026-10")).autoSales, null);
  assert.deepEqual(must(rowOf(r, "trendyol", "2026-10")).autoSales, { amount: 12400, source: "tek" });

  // Tek yemek kartı faturası, satış yazılmamış: Z'deki yemek kartı toplamı
  const one = buildCommissionReport(f1({ marks: [], invoices: [inv("Pluxee", "2026-10-31", 300)] }));
  assert.deepEqual(must(rowOf(one, "pluxee", "2026-10")).sales, { amount: 15500, source: "tek" });
  // İki kart, satış yazılmamış: bilinmiyor
  const two = buildCommissionReport(f1({ marks: [] }));
  const p = must(rowOf(two, "pluxee", "2026-10"));
  assert.equal(p.sales, null);
  assert.equal(p.rate, null);
  assert.equal(p.salesReason, "Satış bilinmiyor: Z'de yemek kartları tek toplam ve bu ay 2 kart var. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
  // Gelen hakedişi olan kart da etkindir (satışı ondan da geçmiştir); satışı 0 yazılan değildir
  const received = buildCommissionReport(f1({ marks: [mark("multinet", "2026-10", { receivedOn: "2026-11-20", received: 100 })], invoices: [inv("Pluxee", "2026-10-31", 300)] }));
  assert.equal(must(rowOf(received, "pluxee", "2026-10")).sales, null);
  const zero = buildCommissionReport(f1({ marks: [mark("multinet", "2026-10", { sales: 0 })], invoices: [inv("Pluxee", "2026-10-31", 300)] }));
  assert.deepEqual(must(rowOf(zero, "pluxee", "2026-10")).sales, { amount: 15500, source: "tek" });

  // Kasa raporları ay ortasında başladı: Z toplamı ayın bir kısmı, kullanılmaz
  const partial = buildCommissionReport(f1({ marks: [], invoices: [inv("Pluxee", "2026-10-31", 300)], firstReport: "2026-10-16", till: days("2026-10-16", "2026-10-31") }));
  const pp = must(rowOf(partial, "pluxee", "2026-10"));
  assert.equal(pp.sales, null);
  assert.equal(plain(pp.salesReason), "Satış bilinmiyor: kasa raporları 16 Ekim'de başladı. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
  // O ay kasa raporu yok
  const none = buildCommissionReport(f1({ marks: [], invoices: [inv("Pluxee", "2026-09-30", 300)] }));
  assert.equal(must(rowOf(none, "pluxee", "2026-09")).salesReason, "Satış bilinmiyor: bu ay kasa raporu yok. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
  // Raporlar var ama Z'de yemek kartı yok
  const empty = buildCommissionReport(f1({ marks: [], invoices: [inv("Pluxee", "2026-10-31", 300)], till: days("2026-10-01", "2026-10-31", () => ({ mealCard: 0, online: 400 })) }));
  assert.equal(must(rowOf(empty, "pluxee", "2026-10")).salesReason, "Satış bilinmiyor: bu ayın kasa raporlarında yemek kartı tutarı yok. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
  // Platformda: iki platform
  const plat = buildCommissionReport(f1({ marks: [], invoices: [inv("Trendyol Go", "2026-10-27", 300), inv("Yemek Sepeti", "2026-10-14", 150)] }));
  assert.equal(must(rowOf(plat, "trendyol", "2026-10")).salesReason, "Satış bilinmiyor: Z'deki online (platformlar) tek toplam ve bu ay 2 platform var. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
});

test("öteki kanalın bu aya ait faturası sonraki ayın 1–15'inde kesildiyse o da etkin: Z toplamı tek kanala yazılmaz", () => {
  // Trendyol Go haftalık fatura keser; Yemeksepeti'nin Ekim faturası (ilk ayı) 14 Kasım tarihli
  const weekly = () => ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((d) => inv("Trendyol Go", d, 300));
  const input = (ysDate: string) =>
    f1({ today: "2026-11-27", through: "2026-11-26", since: "2026-10-01", marks: [], till: days("2026-10-01", "2026-11-26"), invoices: [...weekly(), inv("Yemek Sepeti", ysDate, 200)] });
  const r = buildCommissionReport(input("2026-11-14"));
  const t = must(rowOf(r, "trendyol", "2026-10"));
  assert.equal(t.sales, null);
  assert.equal(t.autoSales, null);
  assert.equal(
    plain(t.salesReason),
    "Satış bilinmiyor: Z'deki online (platformlar) tek toplam ve 14 Kasım tarihli Yemeksepeti faturası Ekim satışlarını da kapsıyor olabilir. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.",
  );
  // Hakedişin son günü belli, beklenen tutar yok: Yemeksepeti'nin satışı Trendyol'dan beklenmez
  assert.deepEqual([t.payout.status, t.payout.due, t.payout.expected], ["gecikti", "2026-11-25", null]);
  // Gelen havale yazılınca "eksik geldi" çıkmaz (eskiden Z'deki 12.400 ₺'nin tamamı beklenirdi)
  const paid = buildCommissionReport({ ...input("2026-11-14"), marks: [mark("trendyol", "2026-10", { receivedOn: "2026-11-26", received: 6000 })] });
  assert.equal(must(rowOf(paid, "trendyol", "2026-10")).payout.status, "geldi");
  assert.equal(plain(commissionAlerts(r, "2026-11-27").find((a) => a.key === "gecikti:trendyol:2026-10")?.body), "Son gün 25 Kasım. Geldiyse işaretleyin.");
  assert.deepEqual(groupOf(r, "platform", "2026-10")!.activeChannels, ["yemeksepeti", "trendyol"]);
  // Ayın 15'inden sonra kesilen fatura sonraki ayındır: Ekim'de Trendyol tek platform, satış Z'den
  assert.deepEqual(must(rowOf(buildCommissionReport(input("2026-11-16")), "trendyol", "2026-10")).sales, { amount: 12400, source: "tek" });

  // Yemek kartında: Multinet'in ilk faturası 10 Kasım'da (ayın 1–5'i değil); Pluxee Z'deki toplamın tamamını almaz
  const meal = buildCommissionReport(f1({ today: "2026-11-20", through: "2026-11-19", marks: [], invoices: [inv("Pluxee", "2026-10-31", 300), inv("Multinet", "2026-11-10", 250)] }));
  const p = must(rowOf(meal, "pluxee", "2026-10"));
  assert.equal(p.sales, null);
  assert.equal(
    plain(p.salesReason),
    "Satış bilinmiyor: Z'de yemek kartları tek toplam ve 10 Kasım tarihli Multinet faturası Ekim satışlarını da kapsıyor olabilir. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.",
  );
  assert.deepEqual(statusBadge(p), { text: "Satış bilinmiyor", tone: "gray" });
  assert.deepEqual(groupOf(meal, "meal", "2026-10")!.activeChannels, ["pluxee", "multinet"]);
});

test("kasa raporunun günleri: eksik günler ay başından düne kadar, ay ortasında başlayan ilk ay yarım", () => {
  const t = channelTill(days("2026-10-01", "2026-10-22", undefined, ["2026-10-05"]), "2026-10", "2026-10-22", "2026-08-01");
  assert.deepEqual(t, { meal: 10500, online: 8400, reportDays: 21, missing: ["2026-10-05"], closed: [], partialFrom: null });
  // Süren ayda bugünün raporu girildiyse o da sayılır, yarın eksik sayılmaz
  assert.deepEqual(channelTill(days("2026-10-01", "2026-10-23"), "2026-10", "2026-10-22", null).missing, []);
  assert.equal(channelTill(days("2026-10-16", "2026-10-31"), "2026-10", "2026-11-30", "2026-10-16").partialFrom, "2026-10-16");
  assert.equal(channelTill([], "2026-10", "2026-11-30", null).reportDays, 0);
});

test("gerçek oran ve uyarılar: %6 aşımı, komisyon dışı ücret, erken ödeme, ödeme altyapısı, reklam", () => {
  const r = buildCommissionReport(f1());
  const p = must(rowOf(r, "pluxee", "2026-10"));
  assert.equal(p.feesTotal, 579);
  assert.deepEqual(p.fees, { komisyon: 279, erken: 300, yasak: 0, asli: 0, reklam: 0, diger: 0 });
  assert.ok(Math.abs(p.rate! - 579 / 9300) < 1e-9);
  assert.deepEqual(
    p.flags.map((f) => [f.key, f.level]),
    [
      ["oran-sinir", "bad"],
      ["erken-odeme", "warn"],
    ],
  );
  assert.equal(p.flags[0].text, "Toplam kesinti %6,2: yemek kartında yasal üst sınır %6.");
  assert.equal(plain(p.flags[1].text), "Erken ödeme ücreti 300 ₺ (oranı %3,2 artırıyor). Erken ödemeyi siz mi seçtiniz? Seçmediyseniz kapattırın.");

  const m = must(rowOf(r, "multinet", "2026-10"));
  assert.ok(Math.abs(m.rate! - 398 / 6200) < 1e-9);
  assert.deepEqual(
    m.flags.map((f) => [f.key, f.level]),
    [
      ["oran-sinir", "bad"],
      ["yasak-ucret", "bad"],
    ],
  );
  assert.equal(
    plain(m.flags[1].text),
    "Komisyon dışı ücret olabilir: “POS Cihaz Kira Bedeli” 150 ₺. Yönetmelik komisyon dışında kira, sarf malzemesi, teknik destek, bakım, depozito gibi adlarla ücret alınmasını yasaklıyor.",
  );
  assert.equal(m.invoices[0].month, "2026-10");
  assert.equal(plain(m.invoices[0].coverNote), "3 Kasım tarihli fatura · Ekim satışları için");

  // %6,04: yuvarlamayı yutan pay, uyarı yok
  const edge = buildCommissionReport(f1({ marks: [mark("pluxee", "2026-10", { sales: 10000 })], invoices: [inv("Pluxee", "2026-10-31", 604)] }));
  assert.deepEqual(must(rowOf(edge, "pluxee", "2026-10")).flags, []);

  // Platform: 1 Nisan 2026'dan sonraki faturada ödeme altyapısı ücreti; öncekinde değil
  const t = must(rowOf(r, "trendyol", "2026-10"));
  assert.equal(t.rate, 0.1);
  assert.deepEqual(
    t.flags.map((f) => f.key),
    ["asli-ucret"],
  );
  assert.equal(plain(t.flags[0].text), "“Online Ödeme Hizmet Bedeli” 40 ₺: sipariş ya da ödeme altyapısı ücreti olabilir. 1 Nisan 2026'dan beri bunlar için ayrı ücret alınamıyor.");
  const march = buildCommissionReport(f1({ today: "2026-04-10", through: "2026-04-09", invoices: [inv("Trendyol Go", "2026-03-20", 340, [["Komisyon", 300], ["Online Ödeme Hizmet Bedeli", 40]])], marks: [] }));
  assert.deepEqual(must(rowOf(march, "trendyol", "2026-03")).flags, []);
  const ads = buildCommissionReport(f1({ invoices: [inv("Trendyol Go", "2026-10-27", 360, [["Komisyon", 300], ["Öne Çıkarma Reklamı", 60]])], marks: [] }));
  assert.equal(plain(must(rowOf(ads, "trendyol", "2026-10")).flags[0].text), "Reklam / kampanya ücreti olabilir: 60 ₺. Bunlar isteğe bağlıdır; onay vermediyseniz itiraz edin.");

  // Tek kartın Z toplamı: aşım kesin (Z toplamı kartın satışından az olamaz); eksik günler varsa uyarı ve not
  const sure = buildCommissionReport(f1({ marks: [], invoices: [inv("Pluxee", "2026-10-31", 1000)] }));
  assert.deepEqual(
    must(rowOf(sure, "pluxee", "2026-10")).flags.map((f) => [f.key, f.level]),
    [["oran-sinir", "bad"]],
  );
  const gaps = buildCommissionReport(f1({ marks: [], invoices: [inv("Pluxee", "2026-10-31", 1000)], till: days("2026-10-01", "2026-10-31", undefined, ["2026-10-05", "2026-10-12", "2026-10-19"]) }));
  const g = must(rowOf(gaps, "pluxee", "2026-10"));
  assert.deepEqual(
    g.flags.map((f) => [f.key, f.level]),
    [
      ["oran-sinir", "warn"],
      ["kasa-eksik", "info"],
    ],
  );
  assert.match(g.flags[0].text, /Bazı günlerin kasa raporu eksik; kesin değil, kontrol edin\.$/);
  assert.equal(g.flags[1].text, "3 gün kasa raporu yok; satış eksik kaldıysa oran yüksek görünür.");
  // Toplamda da (tek kart): eksik günde turuncu
  assert.deepEqual(
    groupOf(gaps, "meal", "2026-10")!.flags.map((f) => [f.key, f.level, f.text]),
    [["oran-sinir", "warn", "Ortalama kesinti %7,1: yemek kartında yasal üst sınır %6. Bazı günlerin kasa raporu eksik; kesin değil, kontrol edin."]],
  );
});

test("%6 aşımı ay sonunda kesilmeyen faturada kesin değil: turuncu ve 'olabilir'; zil ve e-posta uyarmaz", () => {
  // Ayın son beş günü ve sonraki ayın ilk beş günü ekstrenin günüdür; iade (eksi) fatura oranı büyütmez, sayılmaz
  const dated = (date: string, net = 10) => ({ date, net });
  assert.equal(offCycleInvoice([dated("2026-10-27"), dated("2026-10-31", 100), dated("2026-11-05", 50)], "2026-10"), null);
  assert.equal(offCycleInvoice([dated("2026-10-31", 100), dated("2026-10-15", 50), dated("2026-10-12", -20)], "2026-10"), "2026-10-15");
  assert.equal(offCycleInvoice([dated("2026-10-26"), dated("2026-11-06")], "2026-10"), "2026-10-26");
  assert.equal(offCycleInvoice([dated("2026-11-06")], "2026-10"), "2026-11-06");
  // Şubat 28 gün: son beş gün 24–28
  assert.equal(offCycleInvoice([dated("2026-02-23")], "2026-02"), "2026-02-23");
  assert.equal(offCycleInvoice([dated("2026-02-24")], "2026-02"), null);

  // Kart: Ekim ekstresi 31 Ekim, 15 Ekim'de Eylül'ün düzeltmesi; satış elle yazıldı
  const today = { today: "2026-11-20", through: "2026-11-19" };
  const card = buildCommissionReport(f1({ ...today, marks: [mark("pluxee", "2026-10", { sales: 9300 })], invoices: [inv("Pluxee", "2026-10-31", 450), inv("Pluxee", "2026-10-15", 150)] }));
  const p = must(rowOf(card, "pluxee", "2026-10"));
  assert.deepEqual(
    p.flags.map((f) => [f.key, f.level, plain(f.text)]),
    [
      [
        "oran-sinir",
        "warn",
        "Toplam kesinti %6,5: yemek kartında yasal üst sınır %6. 15 Ekim tarihli fatura ay sonunda kesilmemiş, başka bir ayın ücretini de taşıyor olabilir; kesin değil, kontrol edin.",
      ],
    ],
  );
  assert.deepEqual(statusBadge(p), { text: "Kontrol edin", tone: "amber" });
  assert.ok(!commissionAlerts(card, "2026-11-20").some((a) => a.kind === "oran"));

  // Toplam: iki kart, Multinet'in faturası ay ortasında; ortalama %6'yı aşıyor ama kesin değil
  const two = buildCommissionReport(f1({ ...today, marks: [], invoices: [inv("Pluxee", "2026-10-31", 600), inv("Multinet", "2026-10-14", 400)] }));
  assert.deepEqual(
    groupOf(two, "meal", "2026-10")!.flags.map((f) => [f.key, f.level, plain(f.text)]),
    [
      [
        "oran-sinir",
        "warn",
        "Ortalama kesinti %6,5: en az bir yemek kartı %6'yı aşıyor olabilir. 14 Ekim tarihli fatura ay sonunda kesilmemiş, başka bir ayın ücretini de taşıyor olabilir; kontrol edin.",
      ],
    ],
  );
  assert.ok(!commissionAlerts(two, "2026-11-20").some((a) => a.kind === "oran"));
  // Aynı tutarlar ay sonunda kesilince kesin: kırmızı, zilde
  const sure = buildCommissionReport(f1({ ...today, marks: [], invoices: [inv("Pluxee", "2026-10-31", 600), inv("Multinet", "2026-11-03", 400)] }));
  assert.equal(groupOf(sure, "meal", "2026-10")!.flags[0].level, "bad");
  assert.deepEqual(
    commissionAlerts(sure, "2026-11-20").map((a) => a.key),
    ["oran:yemek-kartlari:2026-10:65"],
  );
});

test("yemek kartlarının toplamı: Z'deki yemek kartı, bütün yemek kartı faturaları, ortalama oran, beklenen hakediş", () => {
  const r = buildCommissionReport(f1());
  const g = groupOf(r, "meal", "2026-10")!;
  assert.equal(g.zTotal, 15500);
  assert.equal(g.reportDays, 31);
  assert.deepEqual(g.missing, []);
  assert.equal(g.feesTotal, 977);
  assert.equal(g.payable, 1172.4);
  assert.ok(Math.abs(g.rate! - 977 / 15500) < 1e-9);
  assert.equal(g.expected, 14327.6);
  assert.deepEqual(g.activeChannels, ["pluxee", "multinet"]);
  assert.deepEqual(
    g.flags.map((f) => [f.key, f.level, f.text]),
    [["oran-sinir", "bad", "Ortalama kesinti %6,3: en az bir yemek kartı %6'yı aşıyor."]],
  );
  // Platformların özeti: Z'deki online
  assert.equal(groupOf(r, "platform", "2026-10")!.zTotal, 12400);
  // Ay ortasında başlayan ayda ortalama yok
  const partial = buildCommissionReport(f1({ firstReport: "2026-10-16", till: days("2026-10-16", "2026-10-31") }));
  assert.equal(groupOf(partial, "meal", "2026-10")!.rate, null);
  assert.equal(groupOf(partial, "meal", "2026-10")!.expected, null);
});

test("faturası gelmeyen ay: yazılan satış var, fatura yok; sonraki ayın 15'inden sonra", () => {
  const input = (today: string) => f1({ today, through: today, invoices: [], marks: [mark("getir", "2026-10", { sales: 2000 })] });
  const flagOf = (today: string) => must(rowOf(buildCommissionReport(input(today)), "getir", "2026-10")).flags.map((f) => f.key);
  assert.deepEqual(flagOf("2026-11-14"), []);
  assert.deepEqual(flagOf("2026-11-15"), ["fatura-yok"]);
  assert.equal(plain(must(rowOf(buildCommissionReport(input("2026-11-15")), "getir", "2026-10")).flags[0].text), "Ekim ayında 2.000 ₺ satış var ama komisyon faturası gelmedi.");
  // Yemek kartlarının toplamı: Z'de yemek kartı var, hiçbir yemek kartı faturası yok
  const meal = (today: string) => groupOf(buildCommissionReport(f1({ today, through: today, invoices: [], marks: [] })), "meal", "2026-10")!.flags;
  assert.deepEqual(meal("2026-11-14"), []);
  assert.equal(plain(meal("2026-11-15")[0].text), "Ekim'de 15.500 ₺ yemek kartı satışı var ama hiçbir yemek kartı faturası gelmedi.");
});

test("kasa raporu olan ayda Z'deki toplam 0 da bilinir: 'kasa raporu yok' denmez", () => {
  // Aralık'ta platformlara ara verildi: her günün raporu var, online 0; Trendyol'un kartı Kasım'dan ötürü görünür
  const r = buildCommissionReport(
    f1({
      today: "2027-01-05",
      through: "2027-01-04",
      marks: [],
      invoices: [inv("Trendyol Go", "2026-11-20", 300)],
      till: [...days("2026-11-01", "2026-11-30"), ...days("2026-12-01", "2026-12-31", () => ({ mealCard: 0, online: 0 }))],
    }),
  );
  const dec = groupOf(r, "platform", "2026-12")!;
  assert.deepEqual([dec.zTotal, dec.reportDays, dec.rate, dec.invoiceCount], [0, 31, null, 0]);
  assert.equal(plain(platformTillLine(dec)), "Z'deki online (platformlar): 0 ₺ · 31 / 31 gün raporlu");
  assert.equal(plain(mealStatSub(groupOf(r, "meal", "2026-12"))), "Satış 0 ₺");
  // Raporu olmayan ayda grup yok
  assert.equal(groupOf(r, "platform", "2026-10"), null);
  assert.equal(platformTillLine(null), "Kasa raporu yok");
  assert.equal(mealStatSub(null), "Satış bilinmiyor");
  // Karonun alt satırı: oran varsa yalnız satış; yoksa nedeni (ay ortasında başlayan rapor, fatura yok)
  const base = { zTotal: 15500, rate: null, partialFrom: null, invoiceCount: 2 };
  assert.equal(plain(mealStatSub({ ...base, rate: 0.063 })), "Satış 15.500 ₺");
  assert.equal(plain(mealStatSub({ ...base, partialFrom: "2026-10-16" })), "Satış 15.500 ₺ · Z ayın bir kısmı");
  assert.equal(plain(mealStatSub({ ...base, invoiceCount: 0 })), "Satış 15.500 ₺ · fatura yok");
  // İade ayı eksiye düştü (oran yok): "Z ayın bir kısmı" denmez
  assert.equal(plain(mealStatSub(base)), "Satış 15.500 ₺");
});

test("platformun 3 aylık oranı: satışı bilinen en az iki ay", () => {
  const r = buildCommissionReport(
    f1({
      invoices: [inv("Trendyol Go", "2026-08-31", 1000), inv("Trendyol Go", "2026-09-30", 1200), inv("Trendyol Go", "2026-10-27", 1400)],
      marks: [mark("trendyol", "2026-08", { sales: 10000 }), mark("trendyol", "2026-09", { sales: 10000 })],
      till: days("2026-10-01", "2026-10-31"),
    }),
  );
  // Ağustos tek ay: yok; Eylül (Ağu + Eyl): 2.200 / 20.000; Ekim (Ağu + Eyl + Ekim, Ekim Z'den 12.400): 3.600 / 32.400
  assert.equal(must(rowOf(r, "trendyol", "2026-08")).rate3, null);
  assert.ok(Math.abs(must(rowOf(r, "trendyol", "2026-09")).rate3! - 2200 / 20000) < 1e-9);
  assert.ok(Math.abs(must(rowOf(r, "trendyol", "2026-10")).rate3! - 3600 / 32400) < 1e-9);
  // Yemek kartında 3 aylık oran yok
  assert.equal(must(rowOf(buildCommissionReport(f1()), "pluxee", "2026-10")).rate3, null);
  // Seçilen ayın kendi oranı bilinmiyorsa (Ekim'de iki platform) yok: başlıktaki oran yalnız önceki aylardan gelmesin
  const two = buildCommissionReport(
    f1({
      invoices: [inv("Trendyol Go", "2026-08-31", 1000), inv("Trendyol Go", "2026-09-30", 1200), inv("Trendyol Go", "2026-10-27", 1400), inv("Yemek Sepeti", "2026-10-20", 150)],
      marks: [mark("trendyol", "2026-08", { sales: 10000 }), mark("trendyol", "2026-09", { sales: 10000 })],
    }),
  );
  assert.deepEqual([must(rowOf(two, "trendyol", "2026-10")).rate, must(rowOf(two, "trendyol", "2026-10")).rate3], [null, null]);
  assert.ok(Math.abs(must(rowOf(two, "trendyol", "2026-09")).rate3! - 2200 / 20000) < 1e-9);
});

// ---------------------------------------------------------------- Hakediş

test("hakediş: beklenen = satış − faturalar; son gün = son fatura + süre; geldi, eksik, bekliyor, gecikti, takip öncesi", () => {
  const r = buildCommissionReport(f1());
  const p = must(rowOf(r, "pluxee", "2026-10")).payout;
  assert.deepEqual(p, { expected: 8605.2, due: "2026-11-30", received: null, receivedOn: null, status: "gecikti", lateDays: null, daysOverdue: 2 });
  assert.equal(must(rowOf(r, "multinet", "2026-10")).payout.due, "2026-12-03");
  assert.equal(must(rowOf(r, "multinet", "2026-10")).payout.status, "bekliyor");
  // Takip başlamadan geçen son gün alarm vermez
  assert.equal(must(rowOf(r, "pluxee", "2026-09")).payout.status, "takip-oncesi");

  const cm = { sales: { amount: 9300, source: "elle" as const }, payable: 694.8, invoices: [{ date: "2026-10-31" }] };
  const on = (receivedOn: string, received: number) => mark("pluxee", "2026-10", { sales: 9300, receivedOn, received });
  assert.deepEqual(payoutOf(cm, on("2026-11-28", 8605.2), 30, "2026-12-02", "2026-11-10"), {
    expected: 8605.2,
    due: "2026-11-30",
    received: 8605.2,
    receivedOn: "2026-11-28",
    status: "geldi",
    lateDays: null,
    daysOverdue: null,
  });
  assert.equal(payoutOf(cm, on("2026-12-01", 8605.2), 30, "2026-12-02", "2026-11-10").lateDays, 1);
  // Pay: en az 50 ₺, beklenenin %2'si (172,10 ₺)
  assert.equal(payoutOf(cm, on("2026-11-28", 8000), 30, "2026-12-02", "2026-11-10").status, "eksik");
  assert.equal(payoutOf(cm, on("2026-11-28", 8450), 30, "2026-12-02", "2026-11-10").status, "geldi");
  // Fatura yok, satış var: son gün belli değil
  assert.equal(payoutOf({ sales: cm.sales, payable: 0, invoices: [] }, null, 30, "2026-12-02", "2026-11-10").status, "faturasiz");
  assert.equal(payoutOf({ sales: null, payable: 0, invoices: [] }, null, 30, "2026-12-02", "2026-11-10").status, "yok");
  // Satış bilinmiyor: tutarsız ama son günlü
  assert.deepEqual(payoutOf({ sales: null, payable: 694.8, invoices: [{ date: "2026-10-31" }] }, null, 30, "2026-11-20", "2026-11-10"), {
    expected: null,
    due: "2026-11-30",
    received: null,
    receivedOn: null,
    status: "bekliyor",
    lateDays: null,
    daysOverdue: null,
  });
  // Erken gelen havale (fatura ve satış yokken) geldi sayılır
  assert.equal(payoutOf({ sales: null, payable: 0, invoices: [] }, on("2026-10-20", 500), 30, "2026-12-02", "2026-11-10").status, "geldi");

  // Kanalın ödeme süresi (Kanallar): Trendyol 14 gün
  const fast = buildCommissionReport(f1({ settings: { trendyol: { payDays: 14 } } }));
  assert.equal(must(rowOf(fast, "trendyol", "2026-10")).payout.due, "2026-11-10");
  assert.equal(must(rowOf(fast, "trendyol", "2026-10")).payout.daysOverdue, 22);
  // Bekleyen hakedişler: gecikenler ve eksik gelenler, son günü yakın olanlar; en acil önce
  assert.deepEqual(
    r.pending.map((x) => `${x.channel}:${x.month}:${x.payout.status}`),
    ["trendyol:2026-10:gecikti", "pluxee:2026-10:gecikti", "multinet:2026-10:bekliyor"],
  );
  assert.deepEqual(
    overduePayouts(r).map((x) => x.channel),
    ["trendyol", "pluxee"],
  );
});

/**
 * loadCommissionInput'un penceresi bellekteki satırlarda (src/server/data/commission.ts'in üç süzgeci): faturalar ve
 * kasa raporları pencerenin ilk gününden, hakediş işaretleri ilk ayından
 */
function windowed(all: CommissionInput, today: string): CommissionInput {
  const { fromMonth, fromDay } = reportWindow(today);
  return {
    ...all,
    today,
    fromMonth,
    invoices: all.invoices.filter((i) => i.date >= fromDay),
    till: all.till.filter((t) => t.date >= fromDay),
    marks: all.marks.filter((m) => m.month >= fromMonth),
  };
}

test("geciken hakediş işaretlenene kadar zilde, Bugün'de ve e-postada: ay dönünce pencereden düşmez (90 günlük platform da)", () => {
  nextId = 1;
  const base = { through: "2026-07-31", since: "2026-07-01", firstReport: null, till: [], settings: { trendyol: { payDays: 90 } } };
  const pluxee: CommissionInput = { ...base, today: "2026-07-31", fromMonth: "2026-07", invoices: [inv("Pluxee", "2026-07-31", 558)], marks: [mark("pluxee", "2026-07", { sales: 9300 })] };
  const both: CommissionInput = {
    ...pluxee,
    invoices: [...pluxee.invoices, inv("Trendyol Go", "2026-12-31", 2000)],
    marks: [...pluxee.marks, mark("trendyol", "2026-12", { sales: 40000 })],
  };
  const late = (all: CommissionInput, today: string) => {
    const r = buildCommissionReport(windowed(all, today));
    return {
      bell: commissionAlerts(r, today, Infinity).filter((a) => a.kind === "gecikti").map((a) => a.key),
      today: overduePayouts(r).map((x) => `${x.channel}:${x.month}:${x.payout.daysOverdue}`),
    };
  };
  // Pluxee Temmuz, 30 gün: son gün 30 Ağustos. 4 aylık pencere 1 Kasım'da Ağustos'tan başlıyor, gecikme düşüyordu
  assert.deepEqual(late(pluxee, "2026-10-31"), { bell: ["gecikti:pluxee:2026-07"], today: ["pluxee:2026-07:62"] });
  assert.deepEqual(late(pluxee, "2026-11-01"), { bell: ["gecikti:pluxee:2026-07"], today: ["pluxee:2026-07:63"] });
  assert.deepEqual(late(pluxee, "2027-03-15"), { bell: ["gecikti:pluxee:2026-07"], today: ["pluxee:2026-07:197"] });
  // Trendyol Aralık, 90 gün: son gün 31 Mart 2027; ertesi gün Aralık 4 aylık pencerenin dışındaydı, hiç uyarmıyordu
  assert.deepEqual(late(both, "2027-03-31").bell, ["gecikti:pluxee:2026-07"]);
  assert.deepEqual(late(both, "2027-04-01"), { bell: ["gecikti:pluxee:2026-07", "gecikti:trendyol:2026-12"], today: ["pluxee:2026-07:214", "trendyol:2026-12:1"] });
  // Ekranla aynı pencere (13 ay): Temmuz 2026 Ağustos 2027'de ekrandan da zilden de birlikte çıkar
  assert.deepEqual(late(both, "2027-07-31").bell, ["gecikti:pluxee:2026-07", "gecikti:trendyol:2026-12"]);
  assert.deepEqual(late(both, "2027-08-01").bell, ["gecikti:trendyol:2026-12"]);
});

test("ayarlar: varsayılan 30 gün; yemek kartında en çok 30, platformda en çok 90", () => {
  const s = effectiveSettings({ pluxee: { payDays: 45 }, trendyol: { payDays: 120 }, getir: { payDays: 14 }, multinet: { payDays: Number.NaN } });
  assert.equal(s.pluxee.payDays, 30);
  assert.equal(s.trendyol.payDays, 90);
  assert.equal(s.getir.payDays, 14);
  assert.equal(s.multinet.payDays, 30);
  assert.equal(s.edenred.payDays, 30);
  assert.equal(effectiveSettings(null).migros.payDays, 30);
  // Kayıttaki bozuk ya da eski biçim yok sayılır
  assert.deepEqual(parseCommissionSettings({ channels: { pluxee: { payDays: 20 }, bilinmeyen: { payDays: 5 }, getir: { payDays: "x" }, migros: { split: true } } }), { pluxee: { payDays: 20 } });
  assert.deepEqual(parseCommissionSettings(null), {});
  assert.deepEqual(parseCommissionSettings("bozuk"), {});
});

test("kanalı bulunamayan Komisyon faturası (bankanın POS komisyonu) kanallara girmez, listelenir", () => {
  const input = f1();
  input.invoices.push(inv("Garanti BBVA", "2026-10-15", 120));
  const r = buildCommissionReport(input);
  assert.deepEqual(
    r.unmatched.map((u) => [u.supplier, u.date, u.net]),
    [["Garanti BBVA", "2026-10-15", 120]],
  );
  assert.ok(!r.rows.some((x) => x.invoices.some((i) => i.supplier === "Garanti BBVA")));
  // Ekran: açılış ayı son faturalı ay, kartlar son altı ayda etkinliği olan kanallar
  assert.equal(r.defaultMonth, "2026-10");
  assert.deepEqual(shownChannels(r, "meal", "2026-10"), ["pluxee", "multinet"]);
  assert.deepEqual(shownChannels(r, "platform", "2026-10"), ["trendyol"]);
  assert.deepEqual(shownChannels(r, "meal", "2026-04"), []);
  assert.deepEqual(r.dataMonths, ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
});

// ---------------------------------------------------------------- Zil ve sabah e-postası

test("uyarılar: önce gecikenler (en eski son gün önce), sonra en yeni; anahtar oranı ve faturaları taşır; 45 günden eski fatura uyarmaz; en çok beş", () => {
  const r = buildCommissionReport(f1());
  const multinetId = must(rowOf(r, "multinet", "2026-10")).invoices[0].id;
  const alerts = commissionAlerts(r, "2026-12-02");
  assert.deepEqual(
    alerts.map((a) => a.key),
    ["gecikti:trendyol:2026-10", "gecikti:pluxee:2026-10", "oran:multinet:2026-10:64", `yasak:multinet:2026-10:${multinetId}`, "oran:pluxee:2026-10:62"],
  );
  assert.equal(alerts.length, MAX_ALERTS);
  const [, late, rate, banned] = alerts;
  assert.deepEqual(
    { ...late, body: plain(late.body) },
    {
      kind: "gecikti",
      key: "gecikti:pluxee:2026-10",
      level: "danger",
      title: "Hakediş gecikti: Pluxee (Ekim)",
      body: "Son gün 30 Kasım · beklenen ~8.605,20 ₺. Geldiyse işaretleyin.",
      href: "/panel/komisyonlar?ay=2026-10#pluxee",
      date: "2026-11-30",
    },
  );
  assert.equal(plain(alerts[0].body), "Son gün 26 Kasım · beklenen yaklaşık 10.912 ₺. Geldiyse işaretleyin.");
  assert.deepEqual([rate.title, rate.body, rate.level], ["Multinet Ekim: kesinti %6,4", "Yemek kartında yasal üst sınır %6.", "warning"]);
  assert.deepEqual([banned.title, plain(banned.body)], ["Multinet Ekim: komisyon dışı ücret olabilir", "“POS Cihaz Kira Bedeli” 150 ₺"]);
  // 45 günden eski fatura: yalnız gecikmeler (20 Aralık'ta Multinet'in son günü de geçti)
  assert.deepEqual(
    commissionAlerts(buildCommissionReport(f1({ today: "2026-12-20", through: "2026-12-19" })), "2026-12-20").map((a) => a.key),
    ["gecikti:trendyol:2026-10", "gecikti:pluxee:2026-10", "gecikti:multinet:2026-10"],
  );
  // Satışı bilinmeyen gecikme "beklenen" yazmaz
  const unknown = commissionAlerts(buildCommissionReport(f1({ marks: [] })), "2026-12-02").find((a) => a.key === "gecikti:pluxee:2026-10");
  assert.equal(plain(unknown?.body), "Son gün 30 Kasım. Geldiyse işaretleyin.");
  // Kart kart oran yokken yemek kartlarının toplamı uyarır; kart uyarısı varken ikinci kez değil
  const avg = commissionAlerts(buildCommissionReport(f1({ marks: [], since: "2026-12-02" })), "2026-12-02");
  assert.deepEqual(
    avg.map((a) => [a.key, a.title, plain(a.body)]),
    [
      [`yasak:multinet:2026-10:${multinetId}`, "Multinet Ekim: komisyon dışı ücret olabilir", "“POS Cihaz Kira Bedeli” 150 ₺"],
      ["oran:yemek-kartlari:2026-10:63", "Yemek kartları Ekim: ortalama kesinti %6,3", "En az bir yemek kartı yasal üst sınır %6'yı aşıyor."],
    ],
  );
  assert.ok(!commissionAlerts(r, "2026-12-02", Infinity).some((a) => a.key.startsWith("oran:yemek-kartlari")));
  // Sınırsız: e-posta önce gönderilenleri eler, sonra keser
  assert.equal(commissionAlerts(r, "2026-12-02", Infinity).length, 5);
});

test("zil en eski gecikmiş hakedişi gösterir; sığmayanlar tek satırda özetlenir (denetim E-68)", () => {
  nextId = 1;
  // 3 yemek kartı + 2 platform, Ağustos ve Eylül işaretlenmedi: 10 geciken hakediş (son günler faturanın günü + 30)
  const channels: [string, number][] = [
    ["Pluxee", 25],
    ["Multinet", 26],
    ["Edenred", 27],
    ["Trendyol Go", 28],
    ["Getir", 29],
  ];
  const invoices = channels.flatMap(([name, day]) => [inv(name, `2026-08-${day}`, 300), inv(name, `2026-09-${day}`, 300)]);
  const r = buildCommissionReport({ today: "2026-11-20", through: "2026-11-19", since: "2026-08-01", fromMonth: "2026-01", firstReport: null, till: [], invoices, marks: [], settings: {} });
  const all = commissionAlerts(r, "2026-11-20", Infinity);
  assert.equal(all.length, 10);
  // En eski son gün önce (Pluxee Ağustos, 24 Eylül); önceden en yeni beş (Eylül'ünkiler) zildeydi, Ağustos'lar hiç düşmüyordu
  assert.deepEqual(
    all.map((a) => `${a.key}@${a.date}`),
    [
      "gecikti:pluxee:2026-08@2026-09-24",
      "gecikti:multinet:2026-08@2026-09-25",
      "gecikti:edenred:2026-08@2026-09-26",
      "gecikti:trendyol:2026-08@2026-09-27",
      "gecikti:getir:2026-08@2026-09-28",
      "gecikti:pluxee:2026-09@2026-10-25",
      "gecikti:multinet:2026-09@2026-10-26",
      "gecikti:edenred:2026-09@2026-10-27",
      "gecikti:trendyol:2026-09@2026-10-28",
      "gecikti:getir:2026-09@2026-10-29",
    ],
  );
  // Zil (en çok beş): dört en eski tek tek, kalan altısı tek satırda
  const bell = commissionAlerts(r, "2026-11-20");
  assert.equal(bell.length, MAX_ALERTS);
  assert.ok(bell.some((a) => a.key === "gecikti:pluxee:2026-08"));
  assert.deepEqual(
    bell.slice(0, 4).map((a) => a.key),
    ["gecikti:pluxee:2026-08", "gecikti:multinet:2026-08", "gecikti:edenred:2026-08", "gecikti:trendyol:2026-08"],
  );
  const summary = bell[4];
  assert.deepEqual(
    { ...summary, body: plain(summary.body) },
    {
      kind: "gecikti",
      key: "gecikti-diger:getir:2026-09",
      level: "danger",
      title: "6 hakediş daha gecikti",
      body: "Getir (Ağustos), Pluxee (Eylül), Multinet (Eylül) ve 3 hakediş daha. Hepsi Komisyon & hakediş'te ve Bugün'de.",
      href: "/panel/komisyonlar",
      date: "2026-09-28",
      covers: ["gecikti:getir:2026-08", "gecikti:pluxee:2026-09", "gecikti:multinet:2026-09", "gecikti:edenred:2026-09", "gecikti:trendyol:2026-09", "gecikti:getir:2026-09"],
    },
  );
  // En eskisi "geldi" işaretlenince liste kısalır: özetin anahtarı aynı kalır (zil yeniden okunmamış olmaz); içindeki
  // Getir (Ağustos) tek satıra çıkar, özet okunduysa o da okunmuş sayılır (covers)
  const paidOne = buildCommissionReport({
    today: "2026-11-20",
    through: "2026-11-19",
    since: "2026-08-01",
    fromMonth: "2026-01",
    firstReport: null,
    till: [],
    invoices,
    marks: [mark("pluxee", "2026-08", { receivedOn: "2026-11-20", received: 100 })],
    settings: {},
  });
  const bell2 = commissionAlerts(paidOne, "2026-11-20");
  assert.equal(bell2[4].key, summary.key);
  assert.equal(bell2[3].key, "gecikti:getir:2026-08");
  assert.ok(summary.covers?.includes(bell2[3].key));
  // Yeni (daha yeni son günlü) bir gecikme özeti yeniden okunmamış yapar
  const newer = buildCommissionReport({
    today: "2026-11-20",
    through: "2026-11-19",
    since: "2026-08-01",
    fromMonth: "2026-01",
    firstReport: null,
    till: [],
    invoices: [...invoices, inv("Pluxee", "2026-10-15", 300)],
    marks: [],
    settings: {},
  });
  assert.equal(commissionAlerts(newer, "2026-11-20")[4].key, "gecikti-diger:pluxee:2026-10");
  // Tam beş gecikme özetsiz sığar
  const five = buildCommissionReport({ today: "2026-11-20", through: "2026-11-19", since: "2026-08-01", fromMonth: "2026-01", firstReport: null, till: [], invoices: invoices.filter((i) => i.date.startsWith("2026-08")), marks: [], settings: {} });
  assert.deepEqual(
    commissionAlerts(five, "2026-11-20").map((a) => a.key),
    ["gecikti:pluxee:2026-08", "gecikti:multinet:2026-08", "gecikti:edenred:2026-08", "gecikti:trendyol:2026-08", "gecikti:getir:2026-08"],
  );
  // Bugün'ün listesi de en eski önce, hepsi
  assert.equal(overduePayouts(r).length, 10);
  assert.equal(overduePayouts(r)[0].channel, "pluxee");
});

test("sabah e-postasının kutusu: başlık, satırlar, konu parçası (tek gecikme, birden çok gecikme, yalnız uyarı)", () => {
  const r = buildCommissionReport(f1());
  const alerts = commissionAlerts(r, "2026-12-02");
  assert.equal(commissionDigestBox([]), null);
  const box = commissionDigestBox(alerts)!;
  assert.equal(box.title, "Komisyon ve hakediş");
  assert.equal(box.href, "/panel/komisyonlar");
  assert.equal(box.link, "Komisyon & hakediş'te aç");
  assert.equal(box.subjectPart, "2 hakediş gecikti");
  assert.equal(box.headline, "2 hakediş gecikti");
  assert.deepEqual(
    box.lines.map((l) => [l.strong, l.tone]),
    [
      ["Hakediş gecikti: Trendyol Go (Ekim)", "bad"],
      ["Hakediş gecikti: Pluxee (Ekim)", "bad"],
      ["Multinet Ekim: kesinti %6,4", "warn"],
      ["Multinet Ekim: komisyon dışı ücret olabilir", "warn"],
      ["Pluxee Ekim: kesinti %6,2", "warn"],
    ],
  );
  const one = commissionDigestBox(alerts.filter((a) => a.key !== "gecikti:trendyol:2026-10"))!;
  assert.equal(one.subjectPart, "Hakediş gecikti: Pluxee (Ekim)");
  assert.equal(one.headline, "Hakediş gecikti: Pluxee (Ekim)");
  const warnings = commissionDigestBox(alerts.filter((a) => a.kind !== "gecikti"))!;
  assert.equal(warnings.subjectPart, "komisyon uyarısı");
  assert.equal(commissionDigestBox(alerts.slice(2, 3))!.headline, "Multinet Ekim: kesinti %6,4");

  // E-postada: tek haber kutuysa konu ve başlık onun; ödemeyle konunun sonunda
  const mail = renderDigest([], "2026-12-02", null, null, null, { commission: one });
  assert.equal(mail.subject, "Sabah özeti: Hakediş gecikti: Pluxee (Ekim)");
  assert.ok(mail.html.includes(">Komisyon ve hakediş</div>"));
  assert.ok(mail.html.includes("<strong>Hakediş gecikti: Pluxee (Ekim)</strong>"));
  assert.ok(mail.html.includes('href="https://ladmin.laffogato.net/panel/komisyonlar"'));
  assert.ok(mail.text.includes("\nKomisyon ve hakediş\n- Hakediş gecikti: Pluxee (Ekim): Son gün 30"));
  const item = {
    ref: "reminder:1",
    source: "reminder" as const,
    sourceId: 1,
    kind: "kira" as const,
    title: "Kira",
    detail: null,
    amount: 25000,
    dueDate: "2026-12-02",
    daysLeft: 0,
    status: "today" as const,
    remindDaysBefore: 3,
    repeat: "monthly" as const,
  };
  assert.equal(renderDigest([{ item, stage: "due" }], "2026-12-02", null, null, null, { commission: box }).subject, "Ödeme hatırlatması: 1 bugün · 2 hakediş gecikti");
  assert.equal(renderDigest([], "2026-12-02", null, null, null, { commission: warnings }).subject, "Sabah özeti: komisyon uyarısı");
});

test("tohum verisi (Excel'den 10 komisyon faturası; kalem yok, kasa raporu yok): satış bilinmiyor, uyarı yok", () => {
  nextId = 100;
  const excel = [
    inv("Trendyol Go", "2026-09-14", 379.2),
    inv("Trendyol Go", "2026-09-21", 100.8),
    inv("Trendyol Go", "2026-09-28", 272),
    inv("Trendyol Go", "2026-09-30", 243.2),
    inv("Trendyol Go", "2026-09-30", 189.58),
    inv("Set Kart", "2026-09-30", 39.28),
    inv("Pluxee", "2026-09-30", 26.78),
    inv("Trendyol Go", "2026-10-07", 286.4),
    inv("Trendyol Go", "2026-10-14", 283.2),
    inv("Yemek Sepeti", "2026-10-14", 157.3),
  ];
  const r = buildCommissionReport({ today: "2026-10-22", through: "2026-10-21", since: "2026-10-22", fromMonth: "2025-10", invoices: excel, till: [], firstReport: null, marks: [], settings: {} });
  assert.deepEqual(
    r.rows.map((x) => `${x.channel}:${x.month}`),
    ["pluxee:2026-09", "setcard:2026-09", "trendyol:2026-09", "yemeksepeti:2026-10", "trendyol:2026-10"],
  );
  assert.ok(r.rows.every((x) => x.invoices.every((i) => i.lineless) && x.sales === null && x.rate === null));
  assert.equal(must(rowOf(r, "trendyol", "2026-09")).feesTotal, 1184.78);
  assert.equal(must(rowOf(r, "trendyol", "2026-10")).feesTotal, 569.6);
  assert.deepEqual(must(rowOf(r, "pluxee", "2026-09")).payout, { expected: null, due: "2026-10-30", received: null, receivedOn: null, status: "bekliyor", lateDays: null, daysOverdue: null });
  assert.deepEqual(commissionAlerts(r, "2026-10-22"), []);
  assert.equal(r.defaultMonth, "2026-10");
  assert.deepEqual(r.groups.map((g) => `${g.kind}:${g.month}:${g.zTotal}`), ["meal:2026-09:null", "platform:2026-09:null", "platform:2026-10:null"]);
  // Pluxee ve Set Kart Eylül'de iki kart: bilinmiyor (kasa raporu yok önce söylenir)
  assert.equal(must(rowOf(r, "setcard", "2026-09")).salesReason, "Satış bilinmiyor: bu ay kasa raporu yok. Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.");
});

// ---------------------------------------------------------------- Ekranın metinleri

test("ekran metinleri: hakediş satırı, durum rozeti (en kötüsü), satışın kaynağı, oranın parçaları", () => {
  const r = buildCommissionReport(f1());
  const p = must(rowOf(r, "pluxee", "2026-10"));
  assert.deepEqual(
    [plain(payoutText(p).text), plain(payoutText(p).sub), payoutText(p).tone],
    ["Hakediş: beklenen ~8.605,20 ₺ · son gün 30 Kasım · 2 gün gecikti", "Satış 9.300 ₺ − faturalar 694,80 ₺", "bad"],
  );
  const m = must(rowOf(r, "multinet", "2026-10"));
  assert.deepEqual([plain(payoutText(m).text), payoutText(m).tone], ["Hakediş: beklenen ~5.722,40 ₺ · son gün 3 Aralık", "default"]);
  const t = must(rowOf(r, "trendyol", "2026-10"));
  assert.equal(plain(payoutText(t).text), "Hakediş: beklenen yaklaşık 10.912 ₺ · son gün 26 Kasım · 6 gün gecikti");
  assert.equal(plain(payoutText(must(rowOf(r, "pluxee", "2026-09"))).text), "Hakediş: son gün 30 Ekim geçti (takip öncesi). İsterseniz işaretleyin.");
  const with_ = (o: Partial<ChannelMonthIn>) => must(rowOf(buildCommissionReport(f1({ marks: [mark("pluxee", "2026-10", { sales: 9300, ...o })] })), "pluxee", "2026-10"));
  assert.deepEqual(
    [plain(payoutText(with_({ receivedOn: "2026-12-01", received: 8605.2 })).text), payoutText(with_({ receivedOn: "2026-12-01", received: 8605.2 })).tone],
    ["Hakediş geldi: 1 Aralık · 8.605,20 ₺ · 1 gün geç", "good"],
  );
  assert.deepEqual(
    [plain(payoutText(with_({ receivedOn: "2026-11-28", received: 8000 })).text), payoutText(with_({ receivedOn: "2026-11-28", received: 8000 })).tone],
    ["Hakediş geldi: 28 Kasım · 8.000 ₺ · beklenenden 605,20 ₺ az", "warn"],
  );
  const unknown = must(rowOf(buildCommissionReport(f1({ marks: [] })), "pluxee", "2026-10"));
  assert.deepEqual([plain(payoutText(unknown).text), payoutText(unknown).sub], ["Hakediş: son gün 30 Kasım · 2 gün gecikti", "Beklenen tutar satış bilinince çıkar."]);
  const noInvoice = must(rowOf(buildCommissionReport(f1({ invoices: [], marks: [mark("getir", "2026-10", { sales: 2000 })] })), "getir", "2026-10"));
  assert.equal(payoutText(noInvoice).text, "Hakediş: fatura gelince son gün belli olur.");
  assert.equal(payoutText(null).text, "Fatura gelince hakedişin son günü burada çıkar.");

  assert.deepEqual(statusBadge(p), { text: "Sınırın üstünde", tone: "red" });
  assert.deepEqual(statusBadge(t), { text: "Hakediş gecikti", tone: "red" });
  assert.deepEqual(statusBadge(null), { text: "Bu ay fatura yok", tone: "gray" });
  assert.deepEqual(statusBadge(unknown), { text: "Hakediş gecikti", tone: "red" });
  assert.deepEqual(statusBadge(must(rowOf(r, "pluxee", "2026-09"))), { text: "Takip öncesi", tone: "gray" });
  const ok = must(rowOf(buildCommissionReport(f1({ invoices: [inv("Pluxee", "2026-11-20", 300)], marks: [mark("pluxee", "2026-11", { sales: 10000 })] })), "pluxee", "2026-11"));
  assert.deepEqual(statusBadge(ok), { text: "Tamam", tone: "green" });
  const unknownOk = must(rowOf(buildCommissionReport(f1({ invoices: [inv("Pluxee", "2026-11-20", 300), inv("Multinet", "2026-11-20", 300)], marks: [] })), "pluxee", "2026-11"));
  assert.deepEqual(statusBadge(unknownOk), { text: "Satış bilinmiyor", tone: "gray" });
  // Satış yazıldı, fatura henüz gelmedi: satış biliniyor, rozet faturayı bekler
  const early = { today: "2026-11-10", through: "2026-11-09" };
  const typed = must(rowOf(buildCommissionReport(f1({ ...early, invoices: [], marks: [mark("getir", "2026-10", { sales: 2000 })] })), "getir", "2026-10"));
  assert.deepEqual(statusBadge(typed), { text: "Fatura bekleniyor", tone: "gray" });
  // İade faturası ayı eksiye düşürdü (satış ve fatura var, oran yok)
  const refund = must(rowOf(buildCommissionReport(f1({ ...early, invoices: [inv("Pluxee", "2026-10-31", 100), inv("Pluxee", "2026-10-31", -300)], marks: [mark("pluxee", "2026-10", { sales: 9300 })] })), "pluxee", "2026-10"));
  assert.equal(refund.rate, null);
  assert.deepEqual(statusBadge(refund), { text: "Oran yok", tone: "gray" });

  assert.equal(sourceLabel({ source: "elle" }, "meal"), "Kanalın ekstresinden (elle)");
  assert.equal(sourceLabel({ source: "tek" }, "meal"), "Z'deki yemek kartı toplamı (tek kart)");
  assert.equal(sourceLabel({ source: "tek" }, "platform"), "Z'deki online (platformlar) toplamı (tek platform)");
  assert.equal(sourceLabel({ source: "lafpos" }, "meal"), "LafPOS ödemelerinden");
  // Markası belirsiz tutar artık tek kanala yazılmaz (23 Kasım 2026); ModPOS föyünde markası bulunan ödeme yazılır
  assert.equal(sourceLabel({ source: "lafpos", amount: 1800, foy: 300 }, "meal"), "LafPOS ödemeleri ve ModPOS föyünden");
  assert.equal(sourceLabel({ source: "lafpos", amount: 300, foy: 300 }, "platform"), "ModPOS föyünden");
  assert.equal(ratePartsText(p), "Komisyon %3,0 · erken ödeme %3,2");
  assert.equal(ratePartsText(m), "Komisyon %4,0 · komisyon dışı ücret %2,4");
  assert.equal(plain(ratePartsText(unknown)), "Komisyon 279 ₺ · erken ödeme 300 ₺");

  assert.equal(tillSub(groupOf(r, "meal", "2026-10")), "31 / 31 gün raporlu");
  assert.equal(tillSub(null), "kasa raporu yok");
  assert.equal(tillSub({ zTotal: 100, reportDays: 20, missing: ["2026-10-05", "2026-10-06"], partialFrom: null }), "2 gün rapor yok");
  assert.equal(plain(tillSub({ zTotal: 100, reportDays: 16, missing: [], partialFrom: "2026-10-16" })), "kasa raporları 16 Ekim'de başladı");

  assert.deepEqual(pendingBadge(t), { text: "Gecikti", tone: "red" });
  assert.deepEqual(pendingBadge(m), { text: "Bu hafta", tone: "amber" });
  assert.equal(plain(pendingSub(t)), "yaklaşık 10.912 ₺ · son gün 26 Kasım · 6 gün gecikti");
  assert.equal(plain(pendingSub(with_({ receivedOn: "2026-11-28", received: 8000 }))), "Gelen 8.000 ₺ · beklenen ~8.605,20 ₺");
  // Açık hakedişler: gecikenler ve bekleyenler, eksik gelenin kalanı
  assert.deepEqual(openPayouts(r.rows), { total: 8605.2 + 10912 + 5722.4, late: 2, count: 3, unknown: 0 });
  assert.deepEqual(openPayoutsSub(openPayouts(r.rows)), { text: "2 gecikti", bad: true });
  assert.deepEqual(openPayoutsSub({ total: 605.2, late: 0, count: 3, unknown: 2 }), { text: "2 hakedişin tutarı bilinmiyor", bad: false });
  assert.deepEqual(openPayoutsSub({ total: null, late: 0, count: 2, unknown: 2 }), { text: "2 hakediş · tutar bilinmiyor", bad: false });
  assert.deepEqual(openPayoutsSub({ total: null, late: 0, count: 0, unknown: 0 }), { text: "Gecikme yok", bad: false });

  const d = dialogData(channelDef("pluxee"), "2026-10", p);
  assert.deepEqual(d, {
    channel: "pluxee",
    label: "Pluxee",
    kind: "meal",
    month: "2026-10",
    receivedOn: null,
    received: null,
    sales: 9300,
    note: null,
    payable: 694.8,
    invoiced: true,
    autoSales: null,
  });
  assert.equal(dialogData(channelDef("getir"), "2026-10", null).invoiced, false);
});

// ---------------------------------------------------------------- Kayıt, e-posta günlüğü, sorgunun satırları

test("hakediş kaydı: önceki değerler (Geri al), değişikliğin türü ve işlem geçmişinin metni", () => {
  const L = "Pluxee Ekim 2026";
  const empty = markValues(null);
  assert.deepEqual(empty, { received: null, sales: null, note: null });
  assert.deepEqual(markValues({ receivedOn: "2026-11-28", received: 8605.2, sales: 9300, note: "ekstre" }), { received: { on: "2026-11-28", amount: 8605.2 }, sales: 9300, note: "ekstre" });
  // Gün ya da tutarı eksik işaret yok sayılır (veritabanı ikisini birlikte ister)
  assert.equal(markValues({ receivedOn: null, received: 100, sales: null, note: null }).received, null);

  const first = { received: { on: "2026-11-28", amount: 8605.2 }, sales: null, note: null };
  const got = channelMonthChange(empty, first, L);
  assert.deepEqual([got.change, plain(got.log)], ["geldi", "Hakediş geldi: Pluxee Ekim 2026 · 8.605,20 ₺ (28 Kasım)"]);
  // Geri al: önceki (boş) değerler yazılınca işaret kalkar; hepsi boş olduğu için eylem satırı siler
  assert.deepEqual(channelMonthChange(first, empty, L), { change: "kaldirildi", log: "Hakediş işareti kaldırıldı: Pluxee Ekim 2026" });

  // Birden çok değişiklik: türü önce hakediş, sonra satış, sonra not; metin hepsini " · " ile sayar
  const full = { received: { on: "2026-11-28", amount: 100 }, sales: 9300, note: "ekstre" };
  const all = channelMonthChange(empty, full, L);
  assert.equal(all.change, "geldi");
  assert.equal(plain(all.log), "Hakediş geldi: Pluxee Ekim 2026 · 100 ₺ (28 Kasım) · Komisyon kanalı satışı: Pluxee Ekim 2026 → 9.300 ₺ · Not: Pluxee Ekim 2026 → ekstre");
  assert.equal(channelMonthChange(full, { ...full, received: { on: "2026-11-29", amount: 100 } }, L).change, "geldi");
  assert.equal(channelMonthChange(full, { ...full, received: { on: "2026-11-28", amount: 120 } }, L).change, "geldi");
  assert.deepEqual(channelMonthChange(full, { ...full, sales: null, note: null }, L), {
    change: "satis-silindi",
    log: "Komisyon kanalı satışı: Pluxee Ekim 2026 → boş · Not: Pluxee Ekim 2026 → boş",
  });
  assert.equal(channelMonthChange(full, { ...full, sales: 9400 }, L).change, "satis");
  assert.equal(channelMonthChange(full, { ...full, note: "düzeltildi" }, L).change, "not");
  // Aynı değerler (yeni nesne): değişiklik yok, işlem geçmişine yazılmaz
  assert.deepEqual(channelMonthChange(full, { received: { ...full.received }, sales: 9300, note: "ekstre" }, L), { change: "yok", log: null });
});

test("sabah e-postası: daha önce gönderilen uyarılar önce elenir, sonra en çok beş; günlük anahtarı komisyon:<uyarı>", () => {
  const alert = (key: string): CommissionAlert => ({ kind: "gecikti", key, level: "danger", title: key, body: "", href: "/panel/komisyonlar", date: "2026-11-30" });
  assert.equal(commissionLogKey(alert("gecikti:pluxee:2026-10")), "komisyon:gecikti:pluxee:2026-10");
  const seven = ["a", "b", "c", "d", "e", "f", "g"].map(alert);
  // İlk beşi gönderilmiş: kesmek önce olsaydı hiç yeni uyarı kalmazdı
  const sent = new Set(seven.slice(0, 5).map(commissionLogKey));
  assert.deepEqual(
    freshAlerts(seven, sent).map((a) => a.key),
    ["f", "g"],
  );
  assert.deepEqual(
    freshAlerts(seven, new Set()).map((a) => a.key),
    ["a", "b", "c", "d", "e"],
  );
  assert.deepEqual(
    freshAlerts(seven, new Set(["komisyon:b"]), 2).map((a) => a.key),
    ["a", "c"],
  );
  // Anahtarı önekli değilse (başka bir kutunun) eşleşmez
  assert.equal(freshAlerts(seven, new Set(["a", "b"])).length, MAX_ALERTS);
});

test("sorgunun satırları: fatura başına bir kayıt, kalemleri sırasıyla; kalemsiz fatura; kanalın aranacağı adlar", () => {
  const row = (o: Partial<CommissionInvoiceRow>): CommissionInvoiceRow => ({
    id: 1,
    date: "2026-10-31",
    supplier: "Pluxee",
    supplierTaxNumber: null,
    invoiceNo: "PLX1",
    amount: 579,
    discount: 0,
    payable: 694.8,
    needsReview: false,
    lineName: null,
    lineDescription: null,
    lineNet: null,
    ...o,
  });
  const rows = [
    row({ lineName: "Komisyon Bedeli", lineNet: 279 }),
    row({ lineName: "Erken Ödeme Komisyonu", lineDescription: "Ekim", lineNet: 300 }),
    row({ id: 2, date: "2026-11-03", supplier: "Kurumsal Hizmetler A.Ş.", supplierTaxNumber: "1234567890", invoiceNo: null, amount: 398, payable: 477.6 }),
  ];
  const out = groupInvoiceRows(rows);
  assert.deepEqual(
    out.map((i) => [i.id, i.names, i.invoiceNo, i.lines.length]),
    [
      [1, ["Pluxee"], "PLX1", 2],
      [2, ["Kurumsal Hizmetler A.Ş."], null, 0],
    ],
  );
  assert.deepEqual(out[0].lines, [
    { name: "Komisyon Bedeli", description: null, netTotal: 279 },
    { name: "Erken Ödeme Komisyonu", description: "Ekim", netTotal: 300 },
  ]);
  // Tedarikçi kartının adları faturadaki addan sonra: unvanı tanınmayan fatura kartın diğer adıyla kanala bağlanır
  const named = groupInvoiceRows(rows, (supplier, tax) => (tax === "1234567890" ? [supplier, "Multinet", "Multinet Up"] : [supplier]));
  assert.deepEqual(named[1].names, ["Kurumsal Hizmetler A.Ş.", "Multinet", "Multinet Up"]);
  const r = buildCommissionReport(f1({ invoices: named, marks: [] }));
  assert.equal(must(rowOf(r, "multinet", "2026-10")).invoices[0].supplier, "Kurumsal Hizmetler A.Ş.");
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(buildCommissionReport(f1({ invoices: out, marks: [] })).unmatched.map((u) => u.supplier), ["Kurumsal Hizmetler A.Ş."]);
});

// ---------------------------------------------------------------- Kaynak denetimi

test("kaynak: ekran ve eylemler yalnız yönetici; zil yalnız yöneticide, hafif yoldan; okuyan yol yazmaz", () => {
  const page = read("src/app/panel/komisyonlar/page.tsx");
  // İşletmenin raporu ve (şube seçiliyken) şubenin satışı (23 Kasım 2026; tests/hesap-uyumu-faz1.test.ts)
  assert.match(page, /await requireAdmin\(\);\s*const sp = await searchParams;[\s\S]*?featureInScope\("yemek_karti", view\.scope, view\.branches\)[\s\S]*?[\s\S]*?const \[\{ all: report, branch, scope \}, channelView\] = await Promise\.all\(\[loadCommissionReports\(\), branchSettingView\(COMMISSION_GROUP, settingsBranch\)\]\);/);

  const actions = read("src/server/actions/commission.ts");
  assert.ok(actions.startsWith('"use server";'));
  const exported = [...actions.matchAll(/^export (async function|const|function|let|class) (\w+)/gm)];
  assert.deepEqual(
    exported.map((m) => m[1]),
    ["async function", "async function"],
    "use server dosyasında yalnız eylemler dışa açık",
  );
  for (const [, , name] of exported) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    const next = body.indexOf("\nexport async function", 10);
    const fn = next < 0 ? body : body.slice(0, next);
    assert.match(fn, /const me = await requireAdmin\(\);/, `${name} requireAdmin çağırmıyor`);
    assert.match(fn, /refresh\(\);/, `${name} refresh çağırmıyor`);
    assert.match(fn, /await ensureCommissionSince\(\);/, `${name} yazma yolu: takibin başlangıcı`);
  }
  // Geri al ve bildirim saf fonksiyonlardan (aşağıda testli): önceki değerler kayıttaki satırdan, fark ve metin birlikte
  assert.match(actions, /const before = markValues\(prev\);/);
  assert.match(actions, /channelMonthChange\(before, \{ received, sales, note \}, /);
  assert.match(actions, /return \{ previous: \{ channel: data\.channel, month: data\.month, \.\.\.before \}, change \};/);
  // Hepsi boşalınca satır silinir
  assert.match(actions, /if \(!received && sales === null && !note\) \{\s*if \(row\) await tx\.delete\(s\.commissionMonths\)/);

  const bell = read("src/server/actions/notifications.ts");
  const staffReturn = bell.indexOf('if (user.role !== "admin") return');
  assert.ok(staffReturn > 0);
  assert.ok(bell.indexOf("commissionNotifications().catch(() => [])") > staffReturn, "komisyon zili yalnız yönetici dalında");
  assert.match(bell, /\.\.\.payments, \.\.\.commission, \.\.\.invoices, \.\.\.ops,/);
  assert.match(bell, /group: "fatura" as const/);

  const data = read("src/server/data/commission.ts");
  assert.ok(data.startsWith('import "server-only";'));
  // Hafif yol (zil, Bugün, e-posta) bütün faturaları okuyan loadSupplierRefs'i çalıştırmaz; kartların adlarına yalnız
  // adı bir kanala bağlanmayan fatura varsa bakar ("Diğer adlar" orada da geçerli)
  const light = data.slice(data.indexOf("async function loadLightReport"), data.indexOf("export async function loadCommissionAlerts"));
  assert.match(light, /resolveNames: false/);
  assert.match(data.slice(data.indexOf("export async function loadCommissionReport"), data.indexOf("async function loadLightReport")), /resolveNames: true/);
  assert.match(data, /opts\.resolveNames \? supplierNames\(true\) : Promise\.resolve\(null\)/);
  assert.match(data, /pageNames \?\? \(invoiceRows\.some\(\(r\) => !channelOf\(\[r\.supplier\]\)\) \? await supplierNames\(false\) : null\)/);
  assert.match(data, /withRefs \? loadSupplierRefs\(\) : Promise\.resolve<SupplierRef\[\]>\(\[\]\)/);
  assert.equal(data.match(/loadSupplierRefs\(\)/g)?.length, 1, "loadSupplierRefs yalnız ekranın yolunda");
  // E-posta: önce gönderilenler elenir, sonra kesilir (saf, aşağıda testli)
  assert.match(data, /const fresh = freshAlerts\(alerts, sent\);/);
  assert.match(data, /invoices: groupInvoiceRows\(invoiceRows, names\)/);
  // Okuyan yollar yazmaz: takibin başlangıcı yalnız e-postanın gönderiminde (önizlemede değil)
  const reads = data.slice(data.indexOf("export async function loadCommissionInput"), data.indexOf("export async function ensureCommissionSince"));
  assert.doesNotMatch(reads, /\.insert\(|\.update\(|\.delete\(|ensureCommissionSince\(/);
  // Tek pencere (reportWindow, 13 ay): hafif yol ekranın aylarını okur; geciken hakediş ay dönünce zilden, Bugün'den ve
  // e-postadan düşmez. Üç süzgeç testteki windowed() ile aynı
  assert.match(reads, /const \{ fromMonth, fromDay \} = reportWindow\(today\);/);
  assert.doesNotMatch(data, /LIGHT_MONTHS|months:/);
  assert.match(reads, /gte\(s\.invoices\.date, fromDay\)/);
  assert.match(reads, /gte\(s\.commissionMonths\.month, fromMonth\)/);
  assert.match(reads, /gte\(s\.cashReports\.date, fromDay\)/);
  assert.match(data, /if \(!ctx\.preview\) await ensureCommissionSince\(\);/);

  const extras = read("src/server/notify/digest-extras.ts");
  assert.match(extras, /key: "commission",\s+news: true,\s+load: async \(today, ctx\) => \(\(await featureHere\("yemek_karti", ctx\.scope \?\? ALL_BRANCHES\)\) \? loadCommissionDigest\(today, ctx\) : null\),/);

  // Bugün: hafif yükleyici yalnız yöneticinin olgularında
  const today = read("src/server/data/today.ts");
  const admin = today.slice(today.indexOf("async function adminFacts"), today.indexOf("export async function loadToday"));
  assert.match(admin, /safe\(loadOverduePayouts\(\)\)/);
  assert.equal(today.replace(admin, "").replace(/^import .*$/gm, "").includes("loadOverduePayouts("), false);
});
