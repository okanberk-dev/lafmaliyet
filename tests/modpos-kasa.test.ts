// Yöneticinin Kasa ekranındaki ModPOS kasa föyü (docs/MODPOS-API.md › Nerede görünür): gün görünümünün "ModPOS kasa
// föyü" kartı (rapor ↔ föy tablosu, farklı yazılanların uyarısı, ödemeler ve kırılım, giderler, cari tahsilatlar, ara
// kasalar, ModPOS'un uyarıları, önceki sürüm, föy yoksa ne zaman geleceği), günden güne listesinin "ModPOS'tan farklı"
// rozeti ve raporsuz günün cirosu. Kaynak bekçileri: föy yalnız yönetici dalında okunur, personelin dalı ve personele
// giden yollar (WhatsApp, extras) föyü bilmez, okuyucu sunucuya özeldir ve ModPOS'a istek göndermez. Saf yardımcılar
// kitapçığın örnek föyüyle (tests/fixtures/modpos/belge-ornegi.xml), kart da sunucuda çizilerek sınanır.
// Çalıştırma: npx tsx --test tests/modpos-kasa.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ModposDiffList } from "../src/app/panel/kasa/modpos-diffs";
import { ModposSheetCard } from "../src/app/panel/kasa/modpos-sheet";
import {
  modposAraKasaText,
  modposBreakdownText,
  modposCollectionLabel,
  modposComparable,
  modposDayView,
  modposExpenseLabel,
  modposFoysuzText,
  modposGapTitle,
  modposHeadline,
  modposMissingText,
  modposNoCountText,
  modposPaymentDetail,
  modposPaymentGap,
  modposPreviousLine,
  modposReportDiffs,
  modposSavedOf,
  modposServiceLine,
  modposStateText,
  modposTableRows,
  modposUnknownCodesText,
  modposWarningTexts,
  signedMoney,
  type ModposReportFields,
  type ModposSheetView,
} from "../src/lib/cash-modpos";
import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import { foyZ, sheetPrevious, type ModposZ } from "../src/lib/modpos/z";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const plain = (v: string) => v.replace(/ /g, " ");

/** Kitapçığın örnek föyü: 1 Kasım 2026, tek kasa, Z 0312, kapalı, sayım −20 ₺ */
function sample(): KasaFoyu {
  const p = parseKasaFoyu(read("tests/fixtures/modpos/belge-ornegi.xml"), "2026-11-01");
  if (!p.ok) throw new Error("örnek föy okunamadı");
  return p.foy;
}
const zOf = (foy: KasaFoyu): ModposZ => {
  const z = foyZ(foy);
  assert.ok(z, "föyün Z özeti var");
  return z;
};
/** Testin "şimdi"si: 3 Kasım 2026 10:00 (TR) */
const NOW = new Date("2026-11-03T10:00:00+03:00");
const sheetOf = (foy: KasaFoyu, o: Partial<ModposSheetView> = {}): ModposSheetView => ({
  state: "KAPALI",
  final: true,
  revision: 1,
  previous: null,
  fetchedAt: "2026-11-02T08:02:00+03:00",
  foy,
  ...o,
});
/** Föyle aynı yazılmış rapor (Z alanları ve kasa; kasa farkı da föyünkü: −20 ₺) */
const matching: ModposReportFields = {
  zNo: "0312",
  receipts: 214,
  zTotal: 28_450.5,
  cash: 8_210,
  card: 16_120.5,
  mealCard: 0,
  online: 0,
  other: 0,
  offRevenue: 145,
  openingCash: 500,
  cashIn: 0,
  cashOut: 870,
  countedCash: 7_820,
  handedOver: 0,
  bankPos: null,
};
const open = (foy: KasaFoyu): KasaFoyu => ({ ...foy, kasalar: foy.kasalar.map((k) => ({ ...k, durum: "ACIK" as const, kapanis: { zaman: null, nakit: null } })) });

// ---------------------------------------------------------------- Kaynak bekçileri

const PAGE = "src/app/panel/kasa/page.tsx";
/** Föyün yönetici okuyucuları ve kartı (sayfada yalnız yönetici dalında) */
const MODPOS_REFS = /loadKasaModpos|ModposSheetCard|modposDay|modposOf|NO_MODPOS|cash-modpos|modpos-day|modpos-sheet|modpos-diffs|@\/server\/modpos|@\/lib\/modpos/;

function pageParts() {
  const page = read(PAGE);
  const content = page.indexOf("async function CashContent(");
  const staff = page.indexOf("  if (!admin) {\n    return (");
  const staffEnd = page.indexOf("\n  }\n", staff);
  const adminStart = page.indexOf("  const ay = pick(sp.ay);");
  const late = page.indexOf("async function StaffLateDay(");
  const lateEnd = page.indexOf("\n}\n", late);
  assert.ok(content > 0 && staff > content && staffEnd > staff && adminStart > staffEnd && late > adminStart && lateEnd > late, "sayfanın dalları bulundu");
  return { page, shared: page.slice(content, staff), staff: page.slice(staff, staffEnd), admin: page.slice(adminStart, late), adminStart, late: page.slice(late, lateEnd) };
}

test("kasa sayfası: föy yalnız yönetici dalında okunur; ortak kısım, personel dalı ve geç rapor föyü bilmez", () => {
  const { page, shared, staff, admin, adminStart, late } = pageParts();
  assert.doesNotMatch(shared, MODPOS_REFS, "ortak kısım (personel de geçer)");
  assert.doesNotMatch(staff, MODPOS_REFS, "personel dalı");
  assert.doesNotMatch(late, MODPOS_REFS, "personelin geç raporu");
  // Okuyucular yalnız yönetici dalında ve hata sayfayı bozmaz
  const calls = [...page.matchAll(/loadKasaModpos(?:Days)?\(/g)];
  assert.equal(calls.length, 2);
  for (const c of calls) assert.ok(c.index > adminStart, "okuyucu yönetici dalında");
  assert.match(admin, /showForm \? loadKasaModpos\(date\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)/);
  assert.match(admin, /loadKasaModposDays\(`\$\{month\}-01`, monthEnd\)\.catch\(\(\) => \(\) => NO_MODPOS\)/);
  // Kart formun altında, site satırından önce; bir kez
  assert.match(admin, /\{form\}\s*\{modposDay\?\.modpos \? <ModposSheetCard [^\n]*\/> : null\}\s*\{siteRow\}/);
  assert.equal(page.match(/<ModposSheetCard\b/g)?.length, 1);
  // Günden güne: tarihe göre ayrı prop (extras WhatsApp'a ve personele de gider; föy oraya girmez)
  assert.equal(page.match(/modposDays=\{modposDays\}/g)?.length, 1);
  for (const m of page.matchAll(/extrasFrom\(([^)]*)\)/g)) assert.doesNotMatch(m[1], /modpos/i, "extrasFrom föyü taşımaz");
  assert.doesNotMatch(page, /cashReportExtras\(/);
});

test("okuyucu: sunucuya özel, yalnız saklanan föyü okur; ModPOS'a istek gönderen modüle bağlı değil", () => {
  const src = read("src/server/data/modpos-day.ts");
  assert.match(src, /^import "server-only";/);
  assert.doesNotMatch(src, /@\/server\/modpos\/(client|sync)|\bfetch\(/);
  // İstek modülünden yalnız anahtarın denetimi (saf; istek göndermez)
  assert.match(src, /import \{ modposKeyProblem \} from "@\/lib\/modpos\/request";/);
  assert.match(src, /import \{ loadModposSheet, loadModposSheets, type ModposSheet \} from "@\/server\/modpos\/store";/);
  // Kasa ekranının hiçbir dosyası çekme yoluna bağlı değil (sayfa açılışı hak harcamaz)
  for (const f of ["page.tsx", "modpos-sheet.tsx", "modpos-diffs.tsx", "cash-history.tsx"]) {
    assert.doesNotMatch(read(`src/app/panel/kasa/${f}`), /@\/server\/modpos\/(client|sync)|@\/server\/actions\/modpos/, f);
  }
});

test("personele giden kasa yolları föyü bilmez: form, döküm, geç rapor, WhatsApp ve e-posta ekleri", () => {
  for (const f of [
    "src/app/panel/kasa/cash-form.tsx",
    "src/app/panel/kasa/cash-summary.tsx",
    "src/app/panel/kasa/late-report.tsx",
    "src/app/panel/kasa/cash-photos.tsx",
    "src/app/panel/kasa/okc-card.tsx",
    "src/app/panel/kasa/cash-outs.tsx",
    "src/app/panel/kasa/cash-requests.tsx",
    "src/app/panel/kasa/cash-revisions.tsx",
    "src/server/data/cash-photos.ts",
    "src/lib/cash-report.ts",
    "src/server/actions/cash-report.ts",
  ]) {
    assert.doesNotMatch(read(f), /modpos-sheet|modpos-diffs|modpos-day|cash-modpos|@\/lib\/modpos\/|@\/server\/modpos\//, f);
  }
});

test("tarayıcıya giden yük: kart sunucu bileşeni, listeye yalnız tür ve metin yardımcısı (ayrıştırıcı gitmez)", () => {
  const card = read("src/app/panel/kasa/modpos-sheet.tsx");
  assert.doesNotMatch(card, /^["']use client["']/m);
  const history = read("src/app/panel/kasa/cash-history.tsx");
  assert.match(history, /^"use client";/);
  assert.match(history, /import type \{ ModposDayView \} from "@\/lib\/cash-modpos";/);
  assert.equal(history.match(/from "@\/lib\/cash-modpos"/g)?.length, 1);
  assert.doesNotMatch(history, /@\/lib\/modpos\/foy|@\/lib\/modpos\/z"/);
  const diffs = read("src/app/panel/kasa/modpos-diffs.tsx");
  assert.doesNotMatch(diffs, /^["']use client["']/m);
  assert.deepEqual(
    [...diffs.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ["@/components/ui/notice", "@/lib/modpos/compare"],
  );
  // Çekirdeğin karşılaştırması föyün ayrıştırıcısını içe aktarmaz (yalnız tür)
  assert.doesNotMatch(read("src/lib/modpos/compare.ts"), /^import \{[^}]*\} from "\.\/foy"/m);
});

// ---------------------------------------------------------------- Saf yardımcılar

test("karşılaştırma: aynı yazılan rapor farksız; farklı yazılan alan listede; rapor yoksa ya da gün açıkken boş", () => {
  const z = zOf(sample());
  assert.deepEqual(modposReportDiffs(matching, z), []);
  const saved = modposSavedOf(matching);
  assert.equal(saved.expectedCash, 7_840);
  assert.equal(saved.cashDiff, -20);
  const wrong = { ...matching, cash: 8_190, zNo: "312" };
  // Z no baştaki sıfırsız aynı sayılır; nakit 1 kuruştan büyük farkla farklı
  assert.deepEqual(
    modposReportDiffs(wrong, z).map((d) => d.field),
    ["cash"],
  );
  assert.deepEqual(modposDayView(wrong, z), { zTotal: 28_450.5, diffs: modposReportDiffs(wrong, z), open: false });
  assert.deepEqual(modposDayView(null, z).diffs, []);
  // Gün açıkken alınan föy: tutarlar o anki, uyarı yok; tabloda "farklı" bilgi olur
  const oz = zOf(open(sample()));
  assert.equal(modposComparable(oz), false);
  assert.deepEqual(modposReportDiffs(wrong, oz), []);
  assert.equal(modposDayView(wrong, oz).open, true);
  assert.ok(modposTableRows(wrong, z).some((r) => r.key === "cash" && r.tone === "diff"));
  assert.ok(!modposTableRows(wrong, oz).some((r) => r.tone === "diff"));
  assert.equal(modposTableRows(wrong, oz).find((r) => r.key === "cash")?.tone, "info");
  // Rapor yoksa yalnız föyün sütunu
  assert.ok(modposTableRows(null, z).every((r) => r.report === null && r.tone === "none"));
  // Bilgi satırları (gider ↔ gün içinde çıkan) uyarı değil
  const outs = modposTableRows({ ...matching, cashOut: 1_000, countedCash: 7_690 }, z);
  assert.equal(outs.find((r) => r.key === "cashOut")?.tone, "info");
  assert.equal(outs.find((r) => r.key === "cashDiff")?.tone, "same");
});

test("başlık satırı ve durum: Z no, kapalı / açık / kasa açılmamış, kesin ya da değil ve alındığı an", () => {
  const foy = sample();
  const z = zOf(foy);
  assert.equal(modposHeadline(sheetOf(foy), z, NOW), "Z 0312 · Kapalı · Kesin (alındı: dün 08:02)");
  assert.equal(modposHeadline(sheetOf(foy, { final: false, fetchedAt: "2026-11-03T08:05:00+03:00" }), z, NOW), "Z 0312 · Kapalı · Kesin değil (alındı: bugün 08:05)");
  assert.equal(modposStateText("KAPALI", { ...z, otomatikKapandi: true }), "Kapalı (06:00'da kendiliğinden)");
  assert.equal(modposStateText("ACIK", z), "Açık");
  assert.equal(modposStateText("BOS", null), "Kasa açılmamış");
  // Birden çok kasada Z no yok, kasa sayısı yazılır
  assert.equal(modposHeadline(sheetOf(foy), { ...z, zNo: null, kasaSayisi: 2 }, NOW), "2 kasa · Kapalı · Kesin (alındı: dün 08:02)");
  assert.equal(modposHeadline(sheetOf(foy, { state: "BOS" }), null, NOW), "Kasa açılmamış · Kesin (alındı: dün 08:02)");
  assert.match(modposMissingText("2026-11-03", "2026-11-03"), /^Bugünün föyü yarın sabah 08:00'de gelir/);
  assert.equal(modposMissingText("2026-11-01", "2026-11-03"), "Her sabah 08:00'de dünün föyü gelir (Ayarlar › ModPOS kasa föyü'nden de çekilebilir).");
});

test("ödemeler, giderler, cari tahsilat ve ara kasa satırları (kişisel ad yok)", () => {
  const k = sample().kasalar[0];
  const [nakit, kart, ikram] = k.odemeler;
  assert.equal(plain(modposPaymentDetail(nakit)), "defter 8.190 ₺");
  assert.deepEqual(modposPaymentGap(nakit), { text: "fark −20 ₺", off: true });
  assert.equal(plain(modposPaymentDetail(kart)), "cari tahsilat 1.500 ₺ · sistem 17.620,50 ₺ · defter 17.620,50 ₺");
  assert.equal(modposPaymentGap(kart)?.off, false);
  assert.equal(plain(modposBreakdownText(kart)!), "Garanti BBVA 9.800 ₺ · Akbank 6.320,50 ₺");
  assert.equal(modposPaymentDetail(ikram), "ciroya dahil değil · defter girilmedi");
  assert.equal(modposPaymentGap(ikram), null);
  assert.equal(modposBreakdownText(ikram), null);
  assert.equal(modposExpenseLabel(k.giderler.kalemler[0]), "Market · Temizlik malzemesi");
  assert.equal(modposExpenseLabel({ kategori: null, aciklama: null, tutar: 10 }), "Kategorisiz");
  assert.equal(modposCollectionLabel(k.cariTahsilatlar.kalemler[0]), "Kredi Kartı · 17:12");
  assert.equal(modposCollectionLabel({ tutar: 5, yontem: null, zaman: null }), "Yöntem yok");
  assert.equal(plain(modposAraKasaText(k.araKasalar[0])), "1. ara kasa · 15:00 · ciro 11.200 ₺ · nakit 3.400 ₺ · 88 adisyon · gider 320 ₺ · beklenen 3.580 ₺ · sayılan 3.580 ₺ · fark 0 ₺");
  assert.equal(signedMoney(120), "+120 ₺");
  assert.equal(signedMoney(-0.004), "0 ₺");
});

test("uyarılar ve notlar: ModPOS'un uyarısı Türkçesiyle, föy kendi içinde tutmuyorsa, föysüz satış, tanınmayan kod, sayım yok", () => {
  const foy = sample();
  const z = zOf(foy);
  // Bilinen kod belgenin Türkçesiyle (servisin "Kasa farkı var" mesajı değil), tutarıyla; bilinmeyen kodun servis mesajı
  assert.deepEqual(modposWarningTexts(foy).map(plain), ["Kasada fark var: −20 ₺"]);
  const extra = { ...foy, kasalar: [{ ...foy.kasalar[0], uyarilar: [...foy.kasalar[0].uyarilar, { kod: "YENI_KOD", mesaj: "Servisin yeni uyarısı", tutar: null }, { kod: "toString", mesaj: "Nesne anahtarı", tutar: null }] }] };
  assert.deepEqual(modposWarningTexts(extra).slice(1), ["Servisin yeni uyarısı", "Nesne anahtarı"]);
  // Örnek föyde ödemeler (8.210 + 16.120,50) ciroyu (28.450,50) tutmuyor
  assert.equal(plain(modposGapTitle(z)!), "ModPOS föyünde ödemeler cirodan 4.120 ₺ eksik");
  assert.equal(modposGapTitle({ ...z, paymentsGap: 0.004 }), null);
  assert.equal(plain(modposServiceLine(z)!), "Kişi sayısı 301 · bahşiş 120 ₺ · kartla cari tahsilat 1.500 ₺ (banka POS'unda var, Z'nin kartında yok)");
  assert.equal(plain(modposServiceLine({ ...z, covers: null, cardCollections: 0 })!), "Bahşiş 120 ₺");
  assert.equal(modposNoCountText(z), null);
  assert.equal(modposNoCountText({ ...z, noCount: "otomatik" }), "Sayım yok: gün 06:00'da kendiliğinden kapandı (ModPOS defterdeki nakdi yazar).");
  assert.equal(modposFoysuzText(z), null);
  assert.equal(plain(modposFoysuzText({ ...z, foysuzCiro: 350 })!), "Kasası açılmamış satış da var: ciro 350 ₺; yukarıdaki toplamlara girmez.");
  assert.equal(modposUnknownCodesText({ ...z, unknownCodes: ["KRIPTO"] }), "Tanınmayan ödeme kodu: KRIPTO; ciroya dahilse Diğer'e sayıldı.");
  // Föysüz gün (kasa açılmamış, satış var): tutarlar föysüz satıştan
  const foysuz = zOf({ ...foy, kasalar: [], foysuzGunler: [{ sube: "Kadıköy Şube", ciro: 900, adisyonSayisi: 6, odemeler: [{ yontem: "Nakit", kod: "NAKIT", tutar: 900 }] }] });
  assert.equal(foysuz.foysuz, true);
  assert.equal(modposFoysuzText(foysuz), "Kasa açılmadan satış yapılmış: tutarlar föysüz satıştan, açılış ve sayım yok.");
  assert.equal(modposServiceLine(foysuz), null);
});

test("önceki sürüm: toplam satış her zaman, öteki alanlar ve durum yalnız değiştiyse", () => {
  const foy = sample();
  const z = zOf(foy);
  assert.equal(modposPreviousLine(sheetOf(foy), z, NOW), null);
  const before = sheetPrevious(open(foy), { fetchedAt: "2026-11-01T23:10:00+03:00", generatedAt: null, revision: 1 });
  // Kapanıştan sonra nakit 8.000 → 8.210 düzeltildi (önceki sürüm açıkken alınmış)
  const prev = { ...before, state: "ACIK" as const, cash: 8_000, zTotal: 28_240.5, countedCash: null };
  assert.equal(
    plain(modposPreviousLine(sheetOf(foy, { revision: 2, previous: prev }), z, NOW)!),
    "Önceki sürüm (1 Kasım 23:10 alınan): toplam satış 28.240,50 ₺ → 28.450,50 ₺ · durum açık → kapalı · nakit 8.000 ₺ → 8.210 ₺ · sayılan nakit – → 7.820 ₺",
  );
  assert.equal(plain(modposPreviousLine(sheetOf(foy, { revision: 3, previous: { ...before, state: "KAPALI", countedCash: 7_820 } }), z, NOW)!), "Önceki sürüm (1 Kasım 23:10 alınan): toplam satış 28.450,50 ₺, değişmedi");
});

// ---------------------------------------------------------------- Kart (sunucuda çizilir)

const render = (props: Parameters<typeof ModposSheetCard>[0]) => plain(renderToStaticMarkup(createElement(ModposSheetCard, props)));

test("kart: föy yoksa ne zaman geleceği; varsa başlık, tablo, ödemeler, giderler, uyarılar; personel ve müşteri adı yok", () => {
  const none = render({ date: "2026-11-01", today: "2026-11-03", sheet: null, z: null, report: null, keySet: true, now: NOW });
  assert.match(none, /ModPOS föyü henüz alınmadı/);
  assert.match(none, /Her sabah 08:00&#x27;de dünün föyü gelir \(Ayarlar › ModPOS kasa föyü&#x27;nden de çekilebilir\)\./);
  // Anahtar kurulmamışken föysüz günde hiçbir şey ("her sabah gelir" doğru olmazdı); saklanan föy yine görünür
  assert.equal(render({ date: "2026-11-01", today: "2026-11-03", sheet: null, z: null, report: null, keySet: false, now: NOW }), "");
  assert.match(render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(sample()), z: zOf(sample()), report: null, keySet: false, now: NOW }), /ModPOS kasa föyü/);

  const foy = sample();
  const html = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(foy), z: zOf(foy), report: matching, keySet: true, now: NOW });
  for (const t of [
    "ModPOS kasa föyü",
    "Z 0312 · Kapalı · Kesin (alındı: dün 08:02)",
    "Raporla aynı",
    "Kasa raporu",
    "ModPOS föyü",
    "Toplam satış (ciro)",
    "28.450,50 ₺",
    "Garanti BBVA 9.800 ₺ · Akbank 6.320,50 ₺",
    "fark −20 ₺",
    "Giderler · 870 ₺",
    "Market · Temizlik malzemesi",
    "Cari tahsilatlar · 1.500 ₺",
    "Kredi Kartı · 17:12",
    "1. ara kasa · 15:00",
    "Fark notu: Bozuk para eksiği",
    "Kasada fark var: −20 ₺",
    "ModPOS föyünde ödemeler cirodan 4.120 ₺ eksik",
    "Kişi sayısı 301",
    "Gün no 312 · açılış 09:42, 500 ₺ · kapanış 00:58, 7.820 ₺ · kasa defteri girildi",
  ]) {
    assert.ok(html.includes(t), `kartta yok: ${t}`);
  }
  assert.doesNotMatch(html, /farklı yazılan/);
  // KVKK: föyde personel ve müşteri adı okunmaz, kartta da yok
  for (const name of ["Ayşe", "Mehmet", "Yıldız Lojistik"]) assert.ok(!html.includes(name), name);
  // Para uyarıları katlanmaz (risk="para")
  assert.match(html, /data-notice="warn" data-risk="para"/);
});

test("kart: farklı yazılan alan turuncu ve uyarıda; gün açıkken alınan föyde uyarı yok; rapor yoksa rozet", () => {
  const foy = sample();
  const wrong = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(foy), z: zOf(foy), report: { ...matching, cash: 8_190 }, keySet: true, now: NOW });
  assert.match(wrong, /ModPOS föyünden farklı yazılan 1 alan/);
  assert.ok(wrong.includes("Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)"));
  assert.match(wrong, /1 alan farklı/);
  assert.ok(wrong.includes("+20 ₺"), "fark föy − rapor");

  const of = open(foy);
  const live = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(of, { state: "ACIK", final: false }), z: zOf(of), report: { ...matching, cash: 8_190 }, keySet: true, now: NOW });
  assert.match(live, /Föy gün açıkken alındı/);
  assert.match(live, /Gün açıkken alındı/);
  assert.doesNotMatch(live, /farklı yazılan/);
  assert.match(live, /Kesin değil/);

  const noReport = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(foy), z: zOf(foy), report: null, keySet: true, now: NOW });
  assert.match(noReport, /Rapor yok/);

  // Satışsız, kasası açılmamış gün
  const empty: KasaFoyu = { ...foy, kasalar: [], foysuzGunler: [] };
  const bos = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(empty, { state: "BOS" }), z: foyZ(empty), report: null, keySet: true, now: NOW });
  assert.match(bos, /Bu gün ModPOS&#x27;ta kasa açılmamış, satış yok\./);
  assert.match(bos, /Kasa açılmamış · Kesin/);
});

test("günden güne ayrıntısı: farklı yazılanlar kutusu (boşsa hiçbir şey)", () => {
  assert.equal(renderToStaticMarkup(createElement(ModposDiffList, { diffs: [] })), "");
  assert.equal(renderToStaticMarkup(createElement(ModposDiffList, { diffs: undefined })), "");
  const z = zOf(sample());
  const html = plain(renderToStaticMarkup(createElement(ModposDiffList, { diffs: modposReportDiffs({ ...matching, zTotal: 28_000, countedCash: 7_800 }, z) })));
  assert.match(html, /ModPOS föyünden farklı yazılan 2 alan/);
  assert.ok(html.includes("Toplam satış 28.000 ₺ (ModPOS föyünde 28.450,50 ₺)"));
  assert.ok(html.includes("Sayılan nakit 7.800 ₺ (ModPOS föyünde 7.820 ₺)"));
});
