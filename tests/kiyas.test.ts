// Genel bakış ve Bugün › "Kıyas" kartı (src/lib/kiyas.ts, src/app/panel/kiyas-card.tsx): gösterilen gün (05:00 kuralı),
// önceki gün / geçen hafta / geçen ay kıyası, dönem kıyasları (toplam ciro), eksik gün ("veri yok"), satış yok (beklenen
// bütün şubeler biliniyorsa), ay sonu (31 → 30), "Tümü" toplamı, açılmamış şube, fiş sayısı, Marina'nın geçiş günü ve
// rakamın Genel bakış'ın günlük cirosuyla aynılığı. Kartın metni sunucuda çizilip denetlenir (0 ₺ yazılmaz, etiketler).
// Çalıştırma: npx tsx --test tests/kiyas.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { monthDays } from "../src/app/panel/dashboard-daily";
import type { TillRow } from "../src/lib/cash-month";
import { businessDate } from "../src/lib/cash-report";
import { changeSpeech, changeText, diffText, kiyasSummary, mondayOf, pickKiyasDay, sameDayLastMonth, type KiyasInput, type KiyasSummary } from "../src/lib/kiyas";
import { addDays } from "../src/lib/reminders";

const TODAY = "2026-11-22"; // pazar
const DAY = "2026-11-21"; // cumartesi: bugün kapanmadıysa gösterilen gün
const TUZLA = { id: "tuzla", name: "Tuzla", openedOn: null };
const MARINA = { id: "marina", name: "Marina", openedOn: null };

/** Kasa raporu satırı (ödemeler Z'yi tutar: ödenmez düşülmez) */
function row(branchId: string, date: string, zTotal: number, over: Partial<TillRow> = {}): TillRow {
  return { date, branchId, zTotal, card: zTotal, mealCard: 0, discounts: 0, offRevenue: null, payments: zTotal, ...over };
}

function input(rows: TillRow[], over: Partial<KiyasInput> = {}): KiyasInput {
  return { rows, branches: [TUZLA], today: TODAY, switchDay: null, ...over };
}

const find = (s: KiyasSummary, key: string) => [...s.days, ...s.periods].find((r) => r.key === key)!;

/** Kartı sunucuda çizer; düz metin (etiketsiz, varlıklar çözülmüş, bölünmez boşluk boşluk) */
async function render(s: KiyasSummary, branchNames = ["Tuzla"]): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { KiyasCard } = await import("../src/app/panel/kiyas-card");
  return renderToStaticMarkup(createElement(KiyasCard, { data: s, branchNames }));
}
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Kartın n'inci satırı (0–2 gün satırları, 3–5 dönem satırları) */
const li = (html: string, n: number) => plain(html.split("<li").slice(1)[n].replace(/^[^>]*>/, ""));
/** "0 ₺" (10.000 ₺'nin sonu değil) */
const ZERO = /(^|[^\d.,])0 ₺/;

test("biçim: ok, işaret ve Türkçe yüzde; ₺ fark işaretli; ekran okuyucu hapla aynı eşikte", () => {
  assert.equal(changeText(0.831), "↑ +%83,1");
  assert.equal(changeText(-0.634), "↓ %63,4");
  assert.equal(changeText(0), "→ %0,0");
  assert.equal(diffText(1234.4), "+1.234 ₺");
  assert.equal(diffText(-950), "−950 ₺");
  assert.equal(changeSpeech(0.124), "artış %12,4");
  assert.equal(changeSpeech(-0.081), "düşüş %8,1");
  // Hap "→ %0,0" diyorsa ekran okuyucu "değişim yok" der (eskiden 0,0004'te "artış" diyordu)
  for (const g of [0, 0.0004, -0.0004]) {
    assert.equal(changeText(g), "→ %0,0");
    assert.equal(changeSpeech(g), "değişim yok");
  }
  assert.equal(changeText(0.0005), "↑ +%0,1");
  assert.equal(changeSpeech(0.0005), "artış %0,1");
});

test("takvim: pazartesi, geçen ayın aynı tarihi (31 → yok)", () => {
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(sameDayLastMonth("2026-11-21"), "2026-10-21");
  assert.equal(sameDayLastMonth("2026-12-31"), null);
  assert.equal(sameDayLastMonth("2026-03-30"), null);
  assert.equal(sameDayLastMonth("2026-03-28"), "2026-02-28");
  assert.equal(sameDayLastMonth("2026-01-15"), "2025-12-15");
});

test("gösterilen gün: bugün kapanmadıysa dün; bütün şubeler kapattıysa bugün", () => {
  assert.equal(pickKiyasDay(input([row("tuzla", DAY, 1000)])), DAY);
  assert.equal(pickKiyasDay(input([row("tuzla", TODAY, 1000)])), TODAY);
  // Tümü: Marina bugünü kapatmadıysa yarım günün toplamı gösterilmez
  assert.equal(pickKiyasDay(input([row("tuzla", TODAY, 1000)], { branches: [TUZLA, MARINA] })), DAY);
  assert.equal(pickKiyasDay(input([row("tuzla", TODAY, 1000), row("marina", TODAY, 500)], { branches: [TUZLA, MARINA] })), TODAY);
  // Yalnız kapalı işareti olan bugün (önceden işaretlenmiş tatil) gün sonu sayılmaz
  assert.equal(pickKiyasDay(input([], { isClosed: (_, d) => d === TODAY })), DAY);
});

test("05:00 kuralı: gece 00:00–05:00 arası iş günü önceki takvim günü", () => {
  // 23 Kasım 02:30 (Türkiye): iş günü hâlâ 22 Kasım. 22'nin gün sonu geldiyse o gösterilir ("Bugün"), gelmediyse 21
  const night = businessDate(new Date("2026-11-23T02:30:00+03:00"));
  assert.equal(night, "2026-11-22");
  const closed22 = kiyasSummary(input([row("tuzla", "2026-11-22", 5_000), row("tuzla", "2026-11-21", 4_000)], { today: night }));
  assert.equal(closed22.day.date, "2026-11-22");
  assert.equal(closed22.day.isToday, true);
  assert.equal(find(closed22, "dun").label, "Dün");
  assert.equal(find(closed22, "dun").prevFrom, "2026-11-21");
  const open22 = kiyasSummary(input([row("tuzla", "2026-11-21", 4_000)], { today: night }));
  assert.equal(open22.day.date, "2026-11-21");
  assert.equal(find(open22, "dun").label, "Önceki gün");
  // 04:59 hâlâ 22, 05:00'te 23: 23'ün gün sonu yok, gösterilen gün 22 ("Dün"), etiketler "Önceki gün"
  assert.equal(businessDate(new Date("2026-11-23T04:59:00+03:00")), "2026-11-22");
  const morning = businessDate(new Date("2026-11-23T05:00:00+03:00"));
  assert.equal(morning, "2026-11-23");
  const m = kiyasSummary(input([row("tuzla", "2026-11-22", 5_000)], { today: morning }));
  assert.equal(m.day.date, "2026-11-22");
  assert.equal(m.day.isToday, false);
});

test("bilinen günlerle beklenen yüzdeler ve ₺ farkı", () => {
  const s = kiyasSummary(
    input([row("tuzla", DAY, 10_000, { receipts: undefined }), row("tuzla", addDays(DAY, -1), 8_000), row("tuzla", addDays(DAY, -7), 12_500), row("tuzla", "2026-10-21", 5_000)], {
      receipts: new Map([
        ["tuzla|2026-11-21", 50],
        ["tuzla|2026-11-20", 40],
        ["tuzla|2026-11-14", 50],
        ["tuzla|2026-10-21", 25],
      ]),
    }),
  );
  assert.equal(s.day.date, DAY);
  assert.equal(s.day.isToday, false);
  assert.equal(s.day.revenue, 10_000);
  assert.equal(s.day.receipts, 50);
  assert.equal(s.day.avgReceipt, 200);
  const dun = find(s, "dun");
  assert.equal(dun.state, "ok");
  assert.equal(dun.prev?.revenue, 8_000);
  assert.equal(dun.prevAll?.revenue, 8_000);
  assert.equal(dun.diff, 2_000);
  assert.equal(changeText(dun.change!), "↑ +%25,0");
  // Fiş 40 → 50 (+%25), ortalama 200 → 200
  assert.equal(changeText(dun.receiptsChange!), "↑ +%25,0");
  assert.equal(dun.avgReceiptChange, 0);
  const hafta = find(s, "gecen-hafta");
  assert.equal(hafta.prevFrom, "2026-11-14");
  assert.equal(hafta.diff, -2_500);
  assert.equal(changeText(hafta.change!), "↓ %20,0");
  const ay = find(s, "gecen-ay");
  assert.equal(ay.prevFrom, "2026-10-21");
  assert.equal(changeText(ay.change!), "↑ +%100,0");
  // Fiş: geçen ay 25 fiş × 200 ₺; ortalama aynı, fiş iki katı
  assert.equal(ay.receiptsChange, 1);
});

test("eksik gün 'veri yok': sıfır sayılmaz, kıyasa girmez", () => {
  const s = kiyasSummary(input([row("tuzla", DAY, 10_000), row("tuzla", addDays(DAY, -7), 9_000)]));
  const dun = find(s, "dun");
  assert.equal(dun.state, "veri-yok");
  assert.equal(dun.change, null);
  assert.equal(dun.prev, null);
  assert.deepEqual(dun.excluded, [{ id: "tuzla", name: "Tuzla", days: 1, curDays: 0, prevDays: 1 }]);
  // Bu hafta: yalnız iki tarafı da bilinen gün (cumartesi ↔ geçen cumartesi) kıyaslanır; eksik günler sıfır değil
  const hafta = find(s, "bu-hafta");
  assert.equal(hafta.cur?.revenue, 10_000);
  assert.equal(hafta.prev?.revenue, 9_000);
  assert.equal(hafta.cur?.days, 1);
  assert.deepEqual(hafta.excluded, [{ id: "tuzla", name: "Tuzla", days: 5, curDays: 5, prevDays: 5 }]);
  // Gösterilen günde veri yoksa gün "veri yok"
  const bos = kiyasSummary(input([row("tuzla", addDays(DAY, -1), 5_000)]));
  assert.equal(bos.day.state, "veri-yok");
  assert.equal(bos.day.revenue, null);
});

test("satış yok: kapalı işaretli gün ya da Z'si sıfır gün; yüzde verilmez", () => {
  const closed = kiyasSummary(input([row("tuzla", DAY, 10_000)], { isClosed: (_, d) => d === addDays(DAY, -1) }));
  assert.equal(find(closed, "dun").state, "onceki-satis-yok");
  assert.equal(find(closed, "dun").change, null);
  assert.deepEqual(find(closed, "dun").sides, { cur: "satis", prev: "satis-yok" });
  const zero = kiyasSummary(input([row("tuzla", DAY, 10_000), row("tuzla", addDays(DAY, -1), 0)]));
  assert.equal(find(zero, "dun").state, "onceki-satis-yok");
  // Gösterilen gün satışsız: "satış yok", eksi %100 yazılmaz; tutarı null (0 değil)
  const today0 = kiyasSummary(input([row("tuzla", DAY, 0), row("tuzla", addDays(DAY, -1), 7_000)]));
  assert.equal(today0.day.state, "satis-yok");
  assert.equal(today0.day.revenue, null);
  assert.equal(find(today0, "dun").state, "satis-yok");
  assert.equal(find(today0, "dun").change, null);
  assert.equal(find(today0, "dun").prevAll?.revenue, 7_000);
});

test("Tümü: bir şubenin verisi yokken öteki kapalıysa gün ve kıyas 'veri yok', 'satış yok' değil", () => {
  const both = { branches: [TUZLA, MARINA] };
  const prevDay = addDays(DAY, -1);
  // Gösterilen gün: Tuzla'nın Z'si 0, Marina'nın gün sonu yok → bilinmiyor
  const rows = [row("tuzla", DAY, 0), row("tuzla", prevDay, 5_000), row("marina", prevDay, 4_000)];
  const s = kiyasSummary(input(rows, both));
  assert.equal(s.day.state, "veri-yok");
  assert.equal(s.day.revenue, null);
  assert.deepEqual(s.day.missing, [{ id: "marina", name: "Marina" }]);
  assert.deepEqual(s.day.noSale, [{ id: "tuzla", name: "Tuzla" }]);
  assert.equal(find(s, "dun").state, "veri-yok");
  assert.deepEqual(find(s, "dun").sides, { cur: "bilinmiyor", prev: "satis" });
  // Marina da kapalı işaretliyse beklenen bütün şubeler biliniyor: satış yok
  const closed = kiyasSummary(input(rows, { ...both, isClosed: (b, d) => b === "marina" && d === DAY }));
  assert.equal(closed.day.state, "satis-yok");
  assert.equal(find(closed, "dun").state, "satis-yok");
  // Kıyaslanan gün: Tuzla kapalı, Marina'nın verisi yok → veri yok ("o gün satış yok" denmez); ikisi de kapalıysa satış yok
  const cur = [row("tuzla", DAY, 6_000), row("marina", DAY, 4_000)];
  assert.equal(find(kiyasSummary(input([...cur, row("tuzla", prevDay, 0)], both)), "dun").state, "veri-yok");
  assert.equal(find(kiyasSummary(input([...cur, row("tuzla", prevDay, 0), row("marina", prevDay, 0)], both)), "dun").state, "onceki-satis-yok");
  // Gösterilen günde satan Marina'nın eşi bilinmiyor, kapalı Tuzla'nınki biliniyor: kıyaslananların bir tarafı satışsız,
  // ama gün satışsız değil → yüzde yok, satış yok da denmez
  const mixed = kiyasSummary(input([row("tuzla", DAY, 0), row("marina", DAY, 4_000), row("tuzla", prevDay, 5_000)], both));
  assert.equal(mixed.day.state, "satis");
  assert.equal(mixed.day.revenue, 4_000);
  assert.equal(find(mixed, "dun").state, "veri-yok");
  // Dönem: hafta boyunca Tuzla kapalı, Marina'nın verisi yok → hafta "satış yok" değil
  const week = [0, 1, 2, 3, 4, 5].flatMap((i) => [row("tuzla", addDays(DAY, -i), 0), row("tuzla", addDays(DAY, -7 - i), 1_000)]);
  const w = kiyasSummary(input(week, both));
  assert.equal(find(w, "bu-hafta").state, "veri-yok");
  assert.equal(find(w, "bu-hafta").sides?.cur, "bilinmiyor");
  // Tek şubede aynı hafta satış yok
  assert.equal(find(kiyasSummary(input(week)), "bu-hafta").state, "satis-yok");
});

test("kart: satış yok olan taraf 0 ₺ yazılmaz, hangi günün satışsız olduğu doğru güne bağlı", async () => {
  // Önceki gün kapalı: satır o günündür, sağda "o gün satış yok"
  const a = kiyasSummary(input([row("tuzla", DAY, 10_000), row("tuzla", addDays(DAY, -7), 9_000)], { isClosed: (_, d) => d === addDays(DAY, -1) }));
  const ha = await render(a);
  assert.doesNotMatch(plain(ha), ZERO);
  assert.equal(li(ha, 0), "Önceki gün 20 Kasım Cuma o gün satış yok");
  // Gösterilen gün satışsız: sağda kıyaslanan günün cirosu, notta gösterilen günün tarihi
  const b = kiyasSummary(input([row("tuzla", DAY, 0), row("tuzla", addDays(DAY, -1), 7_000), row("tuzla", addDays(DAY, -7), 6_000)]));
  const hb = await render(b);
  assert.doesNotMatch(plain(hb), ZERO);
  assert.match(plain(hb), /Dün · 21 Kasım Cumartesi Satış yok/);
  assert.equal(li(hb, 0), "Önceki gün 20 Kasım Cuma 7.000 ₺ 21 Kasım'da satış yok");
  // Dönem satışsız: sağda "satış yok", altta kıyaslanan haftanın tutarı
  const week = [0, 1, 2, 3, 4, 5].flatMap((i) => [row("tuzla", addDays(DAY, -i), 0), row("tuzla", addDays(DAY, -7 - i), 1_000)]);
  const hw = await render(kiyasSummary(input(week)));
  assert.doesNotMatch(plain(hw), ZERO);
  assert.match(li(hw, 3), /^Bu hafta 16 Kasım – 21 Kasım satış yok Geçen hafta: 6\.000 ₺ \(9 Kasım – 14 Kasım\)/);
  // Tümü'nde veri yok günü: hangi şubenin verisi yok, hangisi satışsız
  const t = kiyasSummary(input([row("tuzla", DAY, 0), row("tuzla", addDays(DAY, -1), 5_000)], { branches: [TUZLA, MARINA] }));
  const ht = await render(t, ["Tuzla", "Marina"]);
  assert.match(plain(ht), /Veri yok Marina: gün sonu yok · Tuzla: satış yok/);
  assert.doesNotMatch(plain(ht), ZERO);
});

test("dönem satırı: tutar dönemin ciro toplamı; yüzde kıyaslananlarla, notlar doğru nedenle", async () => {
  // Bu hafta her gün 1.000; geçen hafta 800, salı (10 Kasım) eksik
  const rows = [0, 1, 2, 3, 4, 5].flatMap((i) => {
    const d = addDays(DAY, -i);
    return addDays(d, -7) === "2026-11-10" ? [row("tuzla", d, 1_000)] : [row("tuzla", d, 1_000), row("tuzla", addDays(d, -7), 800)];
  });
  const s = kiyasSummary(input(rows));
  const w = find(s, "bu-hafta");
  assert.equal(w.curAll?.revenue, 6_000);
  assert.equal(w.prevAll?.revenue, 4_000);
  assert.equal(w.cur?.revenue, 5_000);
  assert.equal(changeText(w.change!), "↑ +%25,0");
  const html = await render(s);
  assert.equal(
    li(html, 3),
    "Bu hafta 16 Kasım – 21 Kasım 6.000 ₺ ↑ +%25,0 Geçen hafta ile kıyasla artış %25,0 Geçen hafta: 4.000 ₺ (9 Kasım – 14 Kasım) Kıyaslanan (iki günü de bilinenler): 5.000 ₺ ↔ 4.000 ₺ · +1.000 ₺ Veri yok (geçen hafta 1 gün), kıyas dışı",
  );
  // Geçen hafta kapalıysa not "geçen hafta satış yok" der ("o gün" değil); tutar bu haftanın cirosu
  const closedPrev = [0, 1, 2, 3, 4, 5].flatMap((i) => [row("tuzla", addDays(DAY, -i), 1_000), row("tuzla", addDays(DAY, -7 - i), 0)]);
  const hc = await render(kiyasSummary(input(closedPrev)));
  assert.equal(li(hc, 3), "Bu hafta 16 Kasım – 21 Kasım 6.000 ₺ geçen hafta satış yok");
  // Gün satırında "o gün" satırın gününe bağlı (14 Kasım)
  assert.equal(li(hc, 1), "Geçen hafta aynı gün 14 Kasım Cumartesi o gün satış yok");
});

test("son 7 gün: 7 günün toplam cirosu, ₺ fark ve yüzde; açık gün ortalaması alt satırda", async () => {
  // Son 7 günün biri kapalı (Z 0): toplam 6.000; önceki 7 gün her gün 800 (5.600)
  const week = [0, 1, 2, 3, 4, 5, 6].flatMap((i) => [row("tuzla", addDays(DAY, -i), i === 3 ? 0 : 1_000), row("tuzla", addDays(DAY, -7 - i), 800)]);
  const s = kiyasSummary(input(week));
  const r = find(s, "son-7");
  assert.equal(r.label, "Son 7 gün");
  assert.equal(r.prevLabel, "Önceki 7 gün");
  assert.equal(r.curAll?.revenue, 6_000);
  assert.equal(r.prevAll?.revenue, 5_600);
  assert.equal(r.diff, 400);
  assert.equal(changeText(r.change!), "↑ +%7,1");
  // Açık gün başına: kapalı gün ortalamayı düşürmez
  assert.equal(r.curAll?.openDays, 6);
  assert.equal(r.curAll?.dailyAvg, 1_000);
  assert.equal(r.prevAll?.dailyAvg, 800);
  const html = await render(s);
  assert.equal(
    li(html, 5),
    "Son 7 gün 15 Kasım – 21 Kasım 6.000 ₺ ↑ +%7,1 Önceki 7 gün ile kıyasla artış %7,1 Önceki 7 gün: 5.600 ₺ (8 Kasım – 14 Kasım) · +400 ₺ Açık gün başına: günde 1.000 ₺ (6 gün) ↔ 800 ₺ (7 gün)",
  );
});

test("ay sonu: 31 Aralık'ın geçen ayda eşi yok; ay dönemi geçen ayın aynı gün sayısıyla, tutar ayın tamamı", async () => {
  const today = "2027-01-01";
  const rows = [row("tuzla", "2026-12-31", 2_000), row("tuzla", "2026-12-30", 1_000), row("tuzla", "2026-11-30", 1_000)];
  const s = kiyasSummary(input(rows, { today }));
  assert.equal(s.day.date, "2026-12-31");
  const ay = find(s, "gecen-ay");
  assert.equal(ay.state, "tarih-yok");
  assert.equal(ay.change, null);
  const buAy = find(s, "bu-ay");
  assert.equal(buAy.unpairedDays, 1);
  assert.equal(buAy.prevTo, "2026-11-30");
  // 30 Aralık ↔ 30 Kasım kıyaslanır, 31 Aralık eşsiz; satırın tutarı ayın bilinen cirosu (3.000)
  assert.equal(buAy.cur?.revenue, 1_000);
  assert.equal(buAy.curAll?.revenue, 3_000);
  assert.equal(buAy.change, 0);
  const html = await render(s);
  assert.match(li(html, 4), /^Aralık 1 Aralık – 31 Aralık 3\.000 ₺ → %0,0 Kasım ile kıyasla değişim yok Kasım: 1\.000 ₺ \(1 Kasım – 30 Kasım\) Kıyaslanan \(iki günü de bilinenler\): 1\.000 ₺ ↔ 1\.000 ₺ · ±0 ₺ Kasım'da olmayan 1 gün kıyas dışı/);
  // Mart 30 → Şubat'ta 30 yok (28 gün): ay döneminde 29 ve 30 Mart eşsiz
  const mart = kiyasSummary(input([row("tuzla", "2026-03-30", 1_000)], { today: "2026-03-31" }));
  assert.equal(find(mart, "gecen-ay").state, "tarih-yok");
  assert.equal(find(mart, "bu-ay").unpairedDays, 2);
});

test("etiketler gösterilen güne göre: pazartesi 'Geçen hafta', ayın 1'inde ayın adı", async () => {
  // Pazartesi 23 Kasım: gösterilen gün pazar 22 Kasım, haftası geçen hafta
  const mon = kiyasSummary(input([row("tuzla", "2026-11-22", 1_000), row("tuzla", "2026-11-15", 800)], { today: "2026-11-23" }));
  assert.equal(mon.day.date, "2026-11-22");
  assert.deepEqual([find(mon, "bu-hafta").label, find(mon, "bu-hafta").prevLabel], ["Geçen hafta", "Önceki hafta"]);
  assert.deepEqual([find(mon, "bu-ay").label, find(mon, "bu-ay").prevLabel], ["Bu ay", "Geçen ay"]);
  const hm = await render(mon);
  assert.match(li(hm, 3), /^Geçen hafta 16 Kasım – 22 Kasım 1\.000 ₺ ↑ \+%25,0 Önceki hafta ile kıyasla artış %25,0 Önceki hafta: 800 ₺/);
  // Salı 1 Aralık: gösterilen gün pazartesi 30 Kasım; hafta aynı ("Bu hafta"), ay Kasım ↔ Ekim
  const first = kiyasSummary(input([row("tuzla", "2026-11-30", 1_000), row("tuzla", "2026-10-30", 500)], { today: "2026-12-01" }));
  assert.equal(first.day.date, "2026-11-30");
  assert.equal(find(first, "bu-hafta").label, "Bu hafta");
  assert.deepEqual([find(first, "bu-ay").label, find(first, "bu-ay").prevLabel], ["Kasım", "Ekim"]);
  const hf = await render(first);
  assert.match(li(hf, 4), /^Kasım 1 Kasım – 30 Kasım 1\.000 ₺ ↑ \+%100,0 Ekim ile kıyasla artış %100,0 Ekim: 500 ₺ \(1 Ekim – 30 Ekim\)/);
  assert.match(li(hf, 4), /Veri yok \(Kasım'da 29 gün, Ekim'de 29 gün\), kıyas dışı/);
  // Ayın ortasında "Bu ay" ↔ "Geçen ay"
  assert.equal(find(kiyasSummary(input([row("tuzla", DAY, 1_000)])), "bu-ay").label, "Bu ay");
});

test("fiş: satış varken 0 fiş bilinmiyor sayılır; sayılar Türkçe biçimde", async () => {
  // Raporda 0 fiş: "Fiş 40 → 0" ve şişkin ortalama çıkmaz
  const s = kiyasSummary(input([row("tuzla", DAY, 10_000), row("tuzla", addDays(DAY, -1), 8_000)], { receipts: new Map([["tuzla|2026-11-21", 0], ["tuzla|2026-11-20", 40]]) }));
  assert.equal(s.day.receipts, null);
  assert.equal(s.day.avgReceipt, null);
  const dun = find(s, "dun");
  assert.equal(dun.cur?.receipts, null);
  assert.equal(dun.receiptsChange, null);
  assert.equal(dun.avgReceiptChange, null);
  const html = plain(await render(s));
  assert.doesNotMatch(html, /Fiş 40 → 0/);
  assert.match(html, /Fiş sayısı girilmedi/);
  // AsilPOS gün sonunda 0 fiş de bilinmiyor
  const l = kiyasSummary(input([row("marina", DAY, 4_000, { source: "asilpos", receipts: 0 })], { branches: [MARINA], switchDay: "2026-11-01" }));
  assert.equal(l.day.revenue, 4_000);
  assert.equal(l.day.receipts, null);
  // Binlik ayırıcı: 3.150 fiş, "Fiş 2.800 → 3.150"
  const big = kiyasSummary(input([row("tuzla", DAY, 315_000), row("tuzla", addDays(DAY, -1), 280_000)], { receipts: new Map([["tuzla|2026-11-21", 3_150], ["tuzla|2026-11-20", 2_800]]) }));
  const hb = await render(big);
  assert.match(plain(hb), /3\.150 fiş · ortalama 100 ₺/);
  assert.match(li(hb, 0), /Fiş 2\.800 → 3\.150 \(↑ \+%12,5\)/);
});

test("ekran okuyucu: hap '→' iken 'değişim yok'", async () => {
  // 10.000 ↔ 9.996: %0,04 artış, hap "→ %0,0"
  const html = plain(await render(kiyasSummary(input([row("tuzla", DAY, 10_000), row("tuzla", addDays(DAY, -1), 9_996)]))));
  assert.match(html, /→ %0,0 Önceki gün ile kıyasla değişim yok/);
  assert.doesNotMatch(html, /Önceki gün ile kıyasla artış/);
});

test("açılmamış şube 'veri yok' sayılmaz: kıyas dışı ve 'henüz açılmamıştı'", async () => {
  const MARINA_NEW = { ...MARINA, openedOn: "2026-11-18" };
  const rows = [row("tuzla", DAY, 6_000), row("marina", DAY, 4_000), row("tuzla", addDays(DAY, -1), 5_000), row("marina", addDays(DAY, -1), 3_000), row("tuzla", addDays(DAY, -7), 5_000)];
  const s = kiyasSummary(input(rows, { branches: [TUZLA, MARINA_NEW] }));
  const hafta = find(s, "gecen-hafta");
  // 14 Kasım'da Marina açılmamıştı: kıyas yalnız Tuzla'yla, Marina veri yok listesinde değil
  assert.equal(hafta.state, "ok");
  assert.deepEqual(hafta.excluded, []);
  assert.deepEqual(hafta.notOpen, [{ id: "marina", name: "Marina", days: 1 }]);
  assert.equal(hafta.cur?.revenue, 6_000);
  assert.equal(changeText(hafta.change!), "↑ +%20,0");
  const html = await render(s, ["Tuzla", "Marina"]);
  const line = li(html, 1);
  assert.match(line, /Marina 14 Kasım'da henüz açılmamıştı, kıyas dışı/);
  assert.doesNotMatch(line, /Marina: .*veri yok/);
  // Bu hafta: Marina'nın 16–17 Kasım'ı kıyasın konusu değil (açılmamıştı); 18–21'in eşi açılış öncesi (notOpen). 18–19
  // Kasım'ın gün sonu gerçekten yok: yalnız o iki gün veri yok
  const w = find(s, "bu-hafta");
  assert.deepEqual(w.notOpen, [{ id: "marina", name: "Marina", days: 4 }]);
  assert.deepEqual(w.excluded.find((e) => e.id === "marina"), { id: "marina", name: "Marina", days: 2, curDays: 2, prevDays: 0 });
  assert.match(li(html, 3), /Marina: veri yok \(bu hafta 2 gün\), kıyas dışı/);
  assert.match(li(html, 3), /Marina geçen hafta 4 gün henüz açılmamıştı, kıyas dışı/);
  // Tek şube: kıyaslanan gün açılıştan önceyse "o gün açılmamıştı" (veri yok değil)
  const one = kiyasSummary(input([row("tuzla", DAY, 6_000)], { branches: [{ ...TUZLA, openedOn: "2026-11-18" }] }));
  assert.equal(find(one, "gecen-hafta").state, "acilmamis");
  const ho = await render(one);
  assert.equal(li(ho, 1), "Geçen hafta aynı gün 14 Kasım Cumartesi o gün açılmamıştı");
});

test("Tümü: iki şubenin toplamı, açık gün bir kez; eksik şube kıyas dışı ve notta", async () => {
  const rows = [row("tuzla", DAY, 6_000), row("marina", DAY, 4_000), row("tuzla", addDays(DAY, -7), 5_000), row("marina", addDays(DAY, -7), 5_000), row("tuzla", addDays(DAY, -1), 3_000)];
  const s = kiyasSummary(input(rows, { branches: [TUZLA, MARINA] }));
  assert.equal(s.day.revenue, 10_000);
  const hafta = find(s, "gecen-hafta");
  assert.equal(hafta.prev?.revenue, 10_000);
  assert.equal(hafta.change, 0);
  // Önceki gün Marina'nın verisi yok: yalnız Tuzla kıyaslanır (6.000 ↔ 3.000), not Marina'yı ve günü söyler
  const dun = find(s, "dun");
  assert.equal(dun.cur?.revenue, 6_000);
  assert.equal(dun.prev?.revenue, 3_000);
  assert.equal(dun.curAll?.revenue, 10_000);
  assert.equal(changeText(dun.change!), "↑ +%100,0");
  assert.deepEqual(dun.excluded, [{ id: "marina", name: "Marina", days: 1, curDays: 0, prevDays: 1 }]);
  const html = await render(s, ["Tuzla", "Marina"]);
  assert.equal(
    li(html, 0),
    "Önceki gün 20 Kasım Cuma 3.000 ₺ ↑ +%100,0 Önceki gün ile kıyasla artış %100,0 Kıyaslanan (iki günü de bilinenler): 6.000 ₺ ↔ 3.000 ₺ · +3.000 ₺ Marina: 20 Kasım veri yok, kıyas dışı",
  );
  // Açık gün "Tümü"de günde bir kez: iki şube aynı gün satmışsa 1 açık gün
  const avg = find(s, "son-7");
  assert.equal(avg.cur?.openDays, 1);
  assert.equal(avg.cur?.dailyAvg, 10_000);
  // Gösterilen günde Marina eksikse toplama girmez, notta adı
  const eksik = kiyasSummary(input([row("tuzla", DAY, 6_000)], { branches: [TUZLA, MARINA] }));
  assert.equal(eksik.day.revenue, 6_000);
  assert.deepEqual(eksik.day.missing, [{ id: "marina", name: "Marina" }]);
  assert.match(plain(await render(eksik, ["Tuzla", "Marina"])), /Marina: gün sonu yok, toplama girmedi/);
});

test("Marina: geçiş günü tam 22 Kasım; öncesindeki AsilPOS gün sonu (deneme) sayılmaz, ayar boşken hiç sayılmaz", () => {
  const SWITCH = "2026-11-22";
  const today = "2026-11-23";
  const asilpos = [row("marina", "2026-11-22", 5_000, { source: "asilpos", receipts: 25 }), row("marina", "2026-11-21", 3_000, { source: "asilpos", receipts: 15 })];
  const modpos21 = row("marina", "2026-11-21", 2_800, { source: "modpos", receipts: 14 });
  const opts = { branches: [MARINA], today };
  // Geçiş günü 22 Kasım: 22 sayılır, 21'in AsilPOS'u deneme (yok sayılır); 21'in ModPOS föyü varsa o sayılır
  const s = kiyasSummary(input(asilpos, { ...opts, switchDay: SWITCH }));
  assert.equal(s.day.date, "2026-11-22");
  assert.equal(s.day.revenue, 5_000);
  assert.equal(s.day.receipts, 25);
  assert.equal(find(s, "dun").state, "veri-yok");
  const withModpos = kiyasSummary(input([...asilpos, modpos21], { ...opts, switchDay: SWITCH }));
  assert.equal(find(withModpos, "dun").prev?.revenue, 2_800);
  assert.equal(find(withModpos, "dun").prev?.receipts, 14);
  // Geçiş günü bir gün sonra (23 Kasım): 22'nin AsilPOS'u da deneme
  assert.equal(kiyasSummary(input(asilpos, { ...opts, switchDay: "2026-11-23" })).day.state, "veri-yok");
  // Ayar boş (null): AsilPOS günleri hiç sayılmaz, ModPOS föyü sayılır
  const none = kiyasSummary(input([...asilpos, modpos21], { ...opts, switchDay: null }));
  assert.equal(none.day.date, "2026-11-22");
  assert.equal(none.day.state, "veri-yok");
  assert.equal(find(none, "dun").state, "veri-yok");
  assert.equal(find(none, "bu-hafta").curAll?.revenue, 2_800);
  // Geçiş günü yalnız Marina'nın kasasının: Tuzla'nın satırı (kasa raporu) her gün sayılır
  const t = kiyasSummary(input([row("tuzla", DAY, 1_000), row("tuzla", addDays(DAY, -1), 1_000)], { switchDay: SWITCH }));
  assert.equal(find(t, "dun").state, "ok");
});

test("Tuzla'nın rakamı Genel bakış'ın günlük cirosuyla aynı (ödenmez kuralı dahil)", () => {
  // Z 10.000, ödenmez 500, ödemeler 9.500: ödenmez Z'nin içinde, ciro 9.500 (cash-revenue.ts)
  const rows = [row("tuzla", "2026-11-03", 10_000, { offRevenue: 500, payments: 9_500 }), row("tuzla", "2026-11-10", 7_250.4), row("tuzla", "2026-11-17", 8_000, { source: "modpos" }), row("tuzla", DAY, 9_999.99)];
  const daily = new Map(monthDays(rows, "2026-11").map((d) => [d.date, d.revenue]));
  const s = kiyasSummary(input(rows));
  assert.equal(s.day.revenue, daily.get(DAY));
  // Bu ay satırının tutarı ayın günlük cirolarının toplamı
  const sum = Math.round([...daily.values()].reduce((a, v) => a + v, 0) * 100) / 100;
  assert.equal(find(s, "bu-ay").curAll?.revenue, sum);
  const one = (date: string) => kiyasSummary(input(rows.filter((r) => r.date === date), { today: addDays(date, 1) })).day.revenue;
  for (const [date, revenue] of daily) assert.equal(one(date), revenue, date);
  assert.equal(one("2026-11-03"), 9_500);
});

test("kaynak: yükleyici yalnız yöneticide, seçili şubeyle, 05:00 iş günüyle; panelde Kıyas kartı yok (AsilPOS'ta)", () => {
  const root = join(import.meta.dirname, "..");
  const loader = readFileSync(join(root, "src/server/data/kiyas.ts"), "utf8");
  assert.match(loader, /await requireAdmin\(\)/);
  assert.match(loader, /currentBranchScope\(\)/);
  assert.match(loader, /tillRows\(db\)/);
  assert.match(loader, /const today = businessDate\(now\)/);
  // Bugün sayfasındaki Kıyas kartı sahibin isteğiyle kaldırıldı (kıyaslar AsilPOS patron panelinde, 22 Kas 2026)
  const bugun = readFileSync(join(root, "src/app/panel/bugun/page.tsx"), "utf8");
  assert.doesNotMatch(bugun, /loadKiyas\(/);
  const panel = readFileSync(join(root, "src/app/panel/page.tsx"), "utf8");
  assert.doesNotMatch(panel, /loadKiyas\(/);
});
