// Yöneticinin Kasa ekranındaki ModPOS kasa föyü (docs/MODPOS-API.md › Nerede görünür): gün görünümünün üç bölümü
// (ModPOS: föyün ayrıntısı; ladmin: panelde yazılan raporun ayrıntısı; Karşılaştırma: alan alan tablo, farklı
// yazılanların uyarısı), föy yoksa ne zaman geleceği, günden güne listesinin "ModPOS'tan farklı" rozeti ve raporsuz
// günün cirosu. Kaynak bekçileri: föy yalnız yönetici dalında okunur, personelin dalı ve personele giden yollar
// (WhatsApp, extras) föyü bilmez, ladmin bölümü föyü bilmez, okuyucu sunucuya özeldir ve ModPOS'a istek göndermez. Saf
// yardımcılar kitapçığın örnek föyüyle (tests/fixtures/modpos/belge-ornegi.xml), bölümler de sunucuda çizilerek sınanır.
// Çalıştırma: npx tsx --test tests/modpos-kasa.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ModposDiffList } from "../src/app/panel/kasa/modpos-diffs";
import { ModposSections } from "../src/app/panel/kasa/modpos-sheet";
import { ladminCard, ladminCash, ladminFacts, ladminHeadline, ladminMeta, ladminOkc, ladminOuts, ladminPayments, type LadminReport } from "../src/lib/cash-ladmin";
import { computeCash } from "../src/lib/cash-report";
import {
  modposAraKasaText,
  modposBreakdownText,
  modposCash,
  modposCollectionLabel,
  modposComparable,
  modposCompareRows,
  modposCompareSummary,
  modposDayView,
  modposExpenseLabel,
  modposFacts,
  modposFoysuzText,
  modposGapTitle,
  modposHeadline,
  modposMissingText,
  modposNoCountText,
  modposOpenFor,
  modposPaymentDetail,
  modposPaymentGap,
  modposPayments,
  modposPreviousLine,
  modposReportDiffs,
  modposSavedOf,
  modposServiceLine,
  modposSheetMeta,
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
/** Kayıtlı raporun yöneticideki hâli (ladmin bölümü): `matching`'in alanları, künye ve kasa farkı formun hesabından */
const saved = (r: ModposReportFields = matching, o: Partial<LadminReport> = {}): ModposReportFields & LadminReport => ({
  ...r,
  date: "2026-11-01",
  cashOutNote: null,
  note: null,
  discounts: null,
  revision: 1,
  cashDiff: computeCash(r).cashDiff,
  submittedByName: "Ece Panel",
  countedByName: null,
  createdAt: "2026-11-01T21:58:00.000Z",
  updatedAt: "2026-11-01T21:58:00.000Z",
  emailStatus: "sent",
  emailedAt: "2026-11-01T21:58:30.000Z",
  ...o,
});
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
  // Üç bölüm (ModPOS, ladmin, Karşılaştırma) kasa raporu formunun altında, site satırından önce; bir kez
  assert.match(admin, /\{form\}\s*\{modposDay\?\.modpos \? <ModposSections [^\n]*\/> : null\}\s*\{siteRow\}/);
  assert.equal(page.match(/<ModposSections\b/g)?.length, 1);
  assert.doesNotMatch(page, /<ModposSheetCard\b|<LadminReportCard\b|<ModposCompareCard\b/, "bölümler yalnız ModposSections'tan");
  // ladmin bölümünün girdileri yönetici dalında kurulur
  assert.match(admin, /const ladmin = \{ outs: dayOuts, photos: photoInfo\?\.photos\.length \?\? 0, revisions, prev: carry, next \};/);
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
  for (const f of ["page.tsx", "modpos-sheet.tsx", "modpos-diffs.tsx", "cash-history.tsx", "ladmin-report.tsx", "day-parts.tsx"]) {
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

test("ladmin bölümü föyü bilmez: yalnız panelin raporu (kart, satır parçaları ve yardımcıları); hepsi sunucu bileşeni", () => {
  for (const f of ["src/app/panel/kasa/ladmin-report.tsx", "src/app/panel/kasa/day-parts.tsx", "src/lib/cash-ladmin.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /from "[^"]*modpos[^"]*"/i, f);
    assert.doesNotMatch(src, /^["']use client["']/m, f);
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

// ---------------------------------------------------------------- Bölümlerin yardımcıları (ModPOS · ladmin · Karşılaştırma)

test("ModPOS bölümü: karolar (ortalama adisyon, kişi başı, kasa farkı), ödeme dağılımı, nakit kasa, açık kalma, künye", () => {
  const foy = sample();
  const z = zOf(foy);
  const facts = modposFacts(z).map((f) => plain(`${f.label}: ${f.value}${f.sub ? ` (${f.sub})` : ""}`));
  assert.deepEqual(facts, [
    "Toplam satış (ciro): 28.450,50 ₺ (Z no 0312)",
    "Adisyon sayısı: 214 (ortalama adisyon 132,95 ₺)",
    "Kişi sayısı: 301 (kişi başı 94,52 ₺)",
    "Ciro dışı (ödenmez / ikram): 145 ₺ (ciroya girmez)",
    "Bahşiş: 120 ₺",
    "Kasa farkı: 20 ₺ eksik (sayılan − beklenen)",
  ]);
  assert.equal(modposFacts(z).at(-1)?.tone, "warn");
  // Sayım yoksa nedeni; kişi sayısı yoksa kişi başı da yok
  const live = modposFacts({ ...z, cashDiff: null, countedCash: null, noCount: "acik", covers: null });
  assert.deepEqual([live[2].value, live[2].sub, live[5].value, live[5].sub, live[5].tone], ["–", null, "Sayım yok", "gün açıktı", null]);
  // Ödeme dağılımı: boş kanal yazılmaz, payı ciroya göre; föy kendi içinde tutmuyorsa toplam turuncu
  assert.deepEqual(
    modposPayments(z).map((l) => plain(`${l.label} ${l.value} ${l.sub ?? ""}`.trim())),
    ["Nakit 8.210 ₺ %29", "Kredi / banka kartı 16.120,50 ₺ %57", "Ödemelerin toplamı 24.330,50 ₺ cirodan 4.120 ₺ eksik"],
  );
  assert.equal(modposPayments({ ...z, zTotal: 24_330.5 }).at(-1)?.sub, "ciroyla aynı");
  // Nakit kasa: açılış + nakit satış + nakit cari tahsilat − gider = beklenen; sayılan (dayanak), fark, kartla tahsilat
  assert.deepEqual(
    modposCash(z, foy).map((l) => plain(`${l.label} ${l.value}`)),
    ["Açılış 500 ₺", "+ Nakit satış 8.210 ₺", "+ Nakit cari tahsilat 0 ₺", "− Gider 870 ₺", "= Beklenen 7.840 ₺", "Sayılan 7.820 ₺", "Fark 20 ₺ eksik", "Kartla cari tahsilat 1.500 ₺"],
  );
  assert.equal(modposCash(z, foy)[5].sub, "dayanak: Z raporu");
  assert.deepEqual(modposCash({ ...z, foysuz: true }, foy), [], "föysüz günde kasa yok");
  // Açık kalma süresi
  assert.equal(modposOpenFor(foy.kasalar[0]), "15 sa 16 dk");
  assert.equal(modposOpenFor({ acilis: { zaman: "2026-11-01T09:00:00+03:00", nakit: null }, kapanis: { zaman: "2026-11-01T09:40:00+03:00", nakit: null } }), "40 dk");
  assert.equal(modposOpenFor({ acilis: { zaman: "2026-11-01T09:00:00+03:00", nakit: null }, kapanis: { zaman: null, nakit: null } }), null);
  // Künye
  assert.deepEqual(modposSheetMeta(sheetOf(foy), NOW).map(plain), ["ModPOS'ta hazırlandı: dün 11:15", "Panele alındı: dün 08:02", "Kesin: kasalar kapalı, ertesi sabah 07:00'den sonra alındı"]);
  assert.deepEqual(modposSheetMeta(sheetOf({ ...foy, olusturulma: null }, { final: false, revision: 3 }), NOW).map(plain), [
    "Panele alındı: dün 08:02",
    "Kesin değil: ertesi sabah kesin föy yeniden çekilir",
    "3. sürüm (ModPOS'ta sonradan değişti)",
  ]);
});

test("ladmin bölümü: karolar, ödemeler, nakit kasa (devir zinciriyle), kart, yazarkasa, kasadan çıkanlar, künye", () => {
  const r = saved();
  assert.deepEqual(
    ladminFacts(r).map((f) => plain(`${f.label}: ${f.value}${f.sub ? ` (${f.sub})` : ""}`)),
    [
      "Toplam satış (Z): 28.450,50 ₺ (Z no 0312)",
      "Fiş sayısı: 214 (ortalama fiş 132,95 ₺)",
      "Ödenmez / ikram: 145 ₺ (ciroya girmez)",
      "İndirim: – (girilmedi)",
      "Kasa farkı: 20 ₺ eksik (sayılan − olması gereken)",
      "Ertesi güne devreden: 7.820 ₺",
    ],
  );
  assert.equal(plain(ladminFacts(saved({ ...matching, countedCash: 7_840, handedOver: 7_000 }, { discounts: 250 })).map((f) => `${f.value} ${f.sub ?? ""}`).join(" | ")), "28.450,50 ₺ Z no 0312 | 214 ortalama fiş 132,95 ₺ | 145 ₺ ciroya girmez | 250 ₺  | Kasa tutuyor sayılan − olması gereken | 840 ₺ sayımdan sonra 7.000 ₺ teslim");
  assert.equal(plain(ladminPayments(r).at(-1)!.sub!), "Z toplamından 4.120 ₺ eksik");
  assert.equal(ladminPayments(saved({ ...matching, zTotal: 24_330.5 })).at(-1)?.sub, "Z toplamıyla aynı");
  // Nakit kasa: açılış önceki raporun devriyle, devreden ertesi raporun açılışıyla denetlenir
  const cash = ladminCash(r, { date: "2026-10-31", amount: 450 }, { date: "2026-11-02", openingCash: 7_820 });
  assert.deepEqual(
    cash.map((l) => plain(`${l.label} ${l.value}`)),
    ["Açılış (devir) 500 ₺", "+ Nakit satış 8.210 ₺", "+ Gün içinde giren 0 ₺", "− Kasadan çıkan 870 ₺", "= Olması gereken 7.840 ₺", "Sayılan 7.820 ₺", "Fark 20 ₺ eksik", "Ertesi güne devreden 7.820 ₺"],
  );
  assert.deepEqual([plain(cash[0].sub!), cash[0].tone, cash[5].sub, cash[7].sub], ["önceki raporun devri 450 ₺: açılış 50 ₺ fazla", "warn", "sayan Ece Panel", "ertesi raporun açılışıyla aynı"]);
  const next = ladminCash(saved(matching, { countedByName: "Deniz Sayar" }), { date: "2026-10-31", amount: 500 }, { date: "2026-11-02", openingCash: 7_700 });
  assert.deepEqual([next[0].sub, next[0].tone, next[5].sub, plain(next.at(-1)!.sub!), next.at(-1)!.tone], ["önceki raporun devriyle aynı", null, "sayan Deniz Sayar", "ertesi raporun açılışı 7.700 ₺: 120 ₺ az", "warn"]);
  assert.equal(ladminCash(r, null, null)[0].sub, null, "önceki rapor yok");
  // Kart: Z kartı, banka POS, kart farkı (banka POS − Z kartı); yazarkasa kartı varsa o
  assert.deepEqual(ladminCard(r).map((l) => plain(`${l.label} ${l.value}`)), ["Kart (Z raporu) 16.120,50 ₺", "Banka POS gün sonu –"]);
  assert.deepEqual(ladminCard(saved({ ...matching, bankPos: 16_100 })).map((l) => plain(`${l.label} ${l.value} ${l.sub ?? ""}`.trim())), [
    "Kart (Z raporu) 16.120,50 ₺",
    "Banka POS gün sonu 16.100 ₺",
    "Kart farkı 20,50 ₺ eksik banka POS − Z kartı",
  ]);
  assert.equal(ladminCard(saved({ ...matching, bankPos: 16_120.5 })).at(-1)?.value, "Tutuyor");
  // Yazarkasa Z: bölüm girilmediyse boş
  assert.deepEqual(ladminOkc(r), []);
  assert.deepEqual(
    ladminOkc(saved({ ...matching, okcZNo: "1044", okcReceipts: 61, okcTotal: 28_450.5, okcVatTotal: 2_586.41, okcCard: 16_120.5 } as ModposReportFields)).map((l) => plain(`${l.label} ${l.value}`)),
    ["Yazarkasa Z no 1044", "Toplam 28.450,50 ₺", "KDV 2.586,41 ₺", "Kart 16.120,50 ₺"],
  );
  // Kasadan çıkanlar: açıklama, yoksa yer, kategori; teslim ayrı; toplam
  assert.deepEqual(ladminOuts([]), []);
  assert.deepEqual(
    ladminOuts([
      { kind: "harcama", amount: 320, store: "Migros", description: "Süt", categoryName: "Market", createdByName: "Ece Panel" },
      { kind: "harcama", amount: 120, store: "Bim", description: null, categoryName: null, createdByName: null },
      { kind: "teslim", amount: 550, store: null, description: null, categoryName: null, createdByName: null },
    ]).map((l) => plain(`${l.label} ${l.value} ${l.sub ?? ""}`.trim())),
    ["Süt 320 ₺ Market · Migros · Ece Panel", "Bim 120 ₺ kategorisiz", "Teslim 550 ₺ teslim", "Toplam (3 satır) 990 ₺"],
  );
  // Künye: sayan (gönderenden farklıysa), sürüm, fotoğraf ve e-posta (gönderen ve anı başlıkta)
  assert.deepEqual(ladminMeta(r, { photos: 0, revisions: [] }).map(plain), ["Fotoğraf yok · E-posta gönderildi (2 Kasım 00:58)"]);
  assert.deepEqual(ladminMeta(saved(matching, { revision: 2, countedByName: "Deniz Sayar", updatedAt: "2026-11-02T06:10:00.000Z", emailStatus: "failed" }), { photos: 2, revisions: [] }).map(plain), [
    "Kasayı sayan Deniz Sayar",
    "2. sürüm · son değişiklik 2 Kasım 09:10",
    "2 fotoğraf · E-posta gönderilemedi",
  ]);
  assert.equal(plain(ladminHeadline(r)), "Z 0312 · Gönderen Ece Panel · 2 Kasım 00:58");
  assert.equal(plain(ladminHeadline({ ...r, zNo: null, revision: 3 })), "Gönderen Ece Panel · 2 Kasım 00:58 · 3. sürüm");
});

test("karşılaştırma bölümü: çekirdeğin satırları, ödemelerin toplamı ve banka POS ↔ ModPOS kartı; özet satırı", () => {
  const z = zOf(sample());
  const rows = modposCompareRows(saved({ ...matching, bankPos: 17_620.5 }), z);
  assert.deepEqual(
    rows.slice(-2).map((r) => [r.key, r.report, r.modpos, r.tone]),
    [
      ["payments", 24_330.5, 24_330.5, "same"],
      ["bankPos", 17_620.5, 17_620.5, "same"],
    ],
  );
  // Banka POS yoksa satırı yok; farklıysa bilgi (uyarı değil)
  assert.ok(!modposCompareRows(saved(), z).some((r) => r.key === "bankPos"));
  assert.equal(modposCompareRows(saved({ ...matching, bankPos: 16_000 }), z).find((r) => r.key === "bankPos")?.tone, "info");
  assert.deepEqual(modposCompareRows(null, z).find((r) => r.key === "payments")?.tone, "none");
  assert.equal(modposCompareSummary(rows, z, true), "17 satır aynı · farklı yazılan alan yok");
  const wrong = modposCompareRows(saved({ ...matching, cash: 8_190, bankPos: 16_000 }), z);
  // Nakit yanlış: nakit farklı; olması gereken, kasa farkı, ödemelerin toplamı ve banka POS bilgi farkı
  assert.equal(modposCompareSummary(wrong, z, true), "12 satır aynı · 1 alan farklı yazılmış · 4 satırda bilgi farkı");
  assert.equal(modposCompareSummary(rows, z, false), "Bu gün için kasa raporu girilmedi: rapor girilince alan alan karşılaştırılır.");
  assert.match(modposCompareSummary(rows, zOf(open(sample())), true), /^Föy gün açıkken alındı/);
});

// ---------------------------------------------------------------- Bölümler (sunucuda çizilir)

const NO_LADMIN = { outs: [], photos: 0, revisions: [], prev: null, next: null };
type SectionProps = Parameters<typeof ModposSections>[0];
const render = (props: Omit<SectionProps, "ladmin"> & { ladmin?: SectionProps["ladmin"] }) => plain(renderToStaticMarkup(createElement(ModposSections, { ladmin: NO_LADMIN, ...props })));

test("bölümler: föy yoksa ne zaman geleceği; varsa sırayla ModPOS, ladmin, Karşılaştırma; personel ve müşteri adı yok", () => {
  const none = render({ date: "2026-11-01", today: "2026-11-03", sheet: null, z: null, report: null, keySet: true, now: NOW });
  assert.match(none, /ModPOS föyü henüz alınmadı/);
  assert.match(none, /Her sabah 08:00&#x27;de dünün föyü gelir \(Ayarlar › ModPOS kasa föyü&#x27;nden de çekilebilir\)\./);
  assert.match(none, /Bu gün için ladmin&#x27;de kasa raporu girilmedi\./);
  assert.match(none, /ModPOS föyü gelince ladmin&#x27;deki raporla alan alan karşılaştırılır\./);
  // Anahtar kurulmamışken föysüz günde hiçbir şey ("her sabah gelir" doğru olmazdı); saklanan föy yine görünür
  assert.equal(render({ date: "2026-11-01", today: "2026-11-03", sheet: null, z: null, report: null, keySet: false, now: NOW }), "");
  assert.match(render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(sample()), z: zOf(sample()), report: null, keySet: false, now: NOW }), /ModPOS kasa föyü/);

  const foy = sample();
  const outs = [{ kind: "harcama" as const, amount: 870, store: "Migros", description: "Temizlik malzemesi", categoryName: "Market", createdByName: "Ece Panel" }];
  const html = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(foy), z: zOf(foy), report: saved(), ladmin: { ...NO_LADMIN, outs, photos: 2 }, keySet: true, now: NOW });
  // Sıra: ModPOS, ladmin, Karşılaştırma
  const at = ["aria-label=\"ModPOS kasa föyü\"", "aria-label=\"ladmin kasa raporu\"", "aria-label=\"ModPOS ve ladmin karşılaştırması\""].map((t) => html.indexOf(t));
  assert.ok(at[0] >= 0 && at[0] < at[1] && at[1] < at[2], JSON.stringify(at));
  const [modpos, ladmin, compare] = [html.slice(at[0], at[1]), html.slice(at[1], at[2]), html.slice(at[2])];
  for (const t of [
    "Kasa föyü · Z 0312 · Kapalı · Kesin (alındı: dün 08:02)",
    "Toplam satış (ciro)",
    "28.450,50 ₺",
    "ortalama adisyon 132,95 ₺",
    "kişi başı 94,52 ₺",
    "Ödeme dağılımı",
    "= Beklenen",
    "dayanak: Z raporu",
    "Ödeme yöntemleri (ModPOS&#x27;taki adıyla)",
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
    "Kişi sayısı",
    "Kartla cari tahsilat",
    "Gün no 312 · açılış 09:42, 500 ₺ · kapanış 00:58, 7.820 ₺ · açık kaldı 15 sa 16 dk · kasa defteri girildi",
    "Panele alındı: dün 08:02",
    "Kesin",
  ]) {
    assert.ok(modpos.includes(t), `ModPOS bölümünde yok: ${t}`);
  }
  for (const t of [
    "Panelde yazılan kasa raporu · Z 0312 · Gönderen Ece Panel · 2 Kasım 00:58",
    "Toplam satış (Z)",
    "ortalama fiş 132,95 ₺",
    "20 ₺ eksik",
    "Ödemeler (Z raporu)",
    "Z toplamından 4.120 ₺ eksik",
    "= Olması gereken",
    "sayan Ece Panel",
    "Ertesi güne devreden",
    "Banka POS gün sonu",
    "Kasadan çıkanlar",
    "Temizlik malzemesi",
    "2 fotoğraf · E-posta gönderildi (2 Kasım 00:58)",
  ]) {
    assert.ok(ladmin.includes(t), `ladmin bölümünde yok: ${t}`);
  }
  for (const t of ["Karşılaştırma", "ModPOS föyü ↔ ladmin kasa raporu", "Raporla aynı", "16 satır aynı · farklı yazılan alan yok", ">ladmin<", ">ModPOS<", "Ödemelerin toplamı", "ModPOS föyünde ödemeler cirodan 4.120 ₺ eksik: ödeme satırları bu yüzden farklı görünebilir."]) {
    assert.ok(compare.includes(t), `Karşılaştırmada yok: ${t}`);
  }
  assert.doesNotMatch(html, /farklı yazılan \d/);
  // KVKK: föyde personel ve müşteri adı okunmaz, bölümlerde de yok
  for (const name of ["Ayşe", "Mehmet", "Yıldız Lojistik"]) assert.ok(!html.includes(name), name);
  // Para uyarıları katlanmaz (risk="para")
  assert.match(modpos, /data-notice="warn" data-risk="para"/);
});

test("bölümler: farklı yazılan alan karşılaştırmada turuncu ve uyarıda; gün açıkken uyarı yok; rapor yoksa rozet; kasa açılmamış gün", () => {
  const foy = sample();
  const wrong = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(foy), z: zOf(foy), report: saved({ ...matching, cash: 8_190 }), keySet: true, now: NOW });
  const compare = wrong.slice(wrong.indexOf("aria-label=\"ModPOS ve ladmin karşılaştırması\""));
  assert.match(compare, /ModPOS föyünden farklı yazılan 1 alan/);
  assert.ok(compare.includes("Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)"));
  assert.match(compare, /1 alan farklı/);
  assert.match(compare, /1 alan farklı yazılmış/);
  assert.ok(compare.includes("+20 ₺"), "fark föy − rapor");

  const of = open(foy);
  const live = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(of, { state: "ACIK", final: false }), z: zOf(of), report: saved({ ...matching, cash: 8_190 }), keySet: true, now: NOW });
  assert.match(live, /Föy gün açıkken alındı/);
  assert.match(live, /Gün açıkken alındı/);
  assert.match(live, /farklar bilgi olarak görünür/);
  assert.doesNotMatch(live, /farklı yazılan 1/);
  assert.match(live, /Kesin değil/);

  const noReport = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(foy), z: zOf(foy), report: null, keySet: true, now: NOW });
  assert.equal(noReport.match(/Rapor yok/g)?.length, 2, "ladmin ve karşılaştırmanın rozeti");
  assert.match(noReport, /Bu gün için kasa raporu girilmedi: rapor girilince alan alan karşılaştırılır\./);

  // Satışsız, kasası açılmamış gün; ladmin'de satış yazılıysa uyarı
  const empty: KasaFoyu = { ...foy, kasalar: [], foysuzGunler: [] };
  const bos = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(empty, { state: "BOS" }), z: foyZ(empty), report: null, keySet: true, now: NOW });
  assert.match(bos, /Bu gün ModPOS&#x27;ta kasa açılmamış, satış yok\./);
  assert.match(bos, /Kasa föyü · Kasa açılmamış · Kesin/);
  assert.match(bos, /İkisinde de satış yok\./);
  const bosReport = render({ date: "2026-11-01", today: "2026-11-03", sheet: sheetOf(empty, { state: "BOS" }), z: foyZ(empty), report: saved(), keySet: true, now: NOW });
  assert.ok(bosReport.includes("ModPOS&#x27;ta bu gün kasa açılmamış, ladmin&#x27;de 28.450,50 ₺ satış yazılı"));
  assert.match(bosReport, /data-notice="warn" data-risk="para"/);
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
