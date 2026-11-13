// Vergi bölümünün kural tablosu (plan docs/planlar/vergi.md §2, §11-A): bütünlük, bilinmeyen yıl, elle değerler,
// bayatlama, ayarların okunması, muhasebeciye sorulacaklar ve metinlerin sahibin dilinde olması.
// Çalıştırma: npx tsx --test tests/vergi-kurallar.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { MANUAL_PNL_ROWS } from "../src/lib/constants";
import { ACCOUNTANT_CHECKS, accountantChecksFor, checksChipText, checkStatus, isAccountantCheckKey } from "../src/lib/tax/checks";
import {
  allRules,
  estimateRound,
  findRule,
  formatEstimate,
  overrideText,
  r2,
  RULES_CHECK_NOTE,
  RULES_COMPILED_AT,
  RULES_VERIFIED_AT,
  rulesCompiledText,
  rulesFor,
  rulesStaleNotes,
  ruleValueText,
  TAX_DISCLAIMER,
  TAX_DISCLAIMER_SHORT,
  TAX_DOC_LABELS,
  TAX_DOC_PERSONEL_BELGELI,
  TAX_RULES,
  taxDocAllowed,
  taxDocOptions,
  WITHHOLDING_GROSS_HINT,
  WITHHOLDING_LABELS,
  withholdingGrossHint,
  withholdingKdv2,
  withholdingRate,
  VAT_TO_ZERO_LABEL,
} from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS, parseTaxSettings, type TaxSettings } from "../src/lib/tax/settings";

const R = rulesFor(2026).rules;
const NBSP = / /g;
const plain = (s: string) => s.replace(NBSP, " ");

// ---------------------------------------------------------------- 1. Tablonun bütünlüğü

test("A1: her kuralda başlık, dayanak, https kaynak (kısa adlı), güven ve başlangıç günü var; anahtar yoluyla aynı", () => {
  const rules = allRules(R);
  assert.ok(rules.length >= 30, `kural sayısı ${rules.length}`);
  const keys = new Set<string>();
  for (const r of rules) {
    assert.ok(r.title.trim().length > 3, r.key);
    assert.ok(r.basis.trim().length > 3, `${r.key} dayanak`);
    assert.ok(r.sources.length >= 1, `${r.key} kaynak`);
    for (const s of r.sources) {
      assert.match(s.url, /^https:\/\//, `${r.key} ${s.url}`);
      assert.ok(s.label.length >= 3 && s.label.length <= 60, `${r.key} kaynak adı kısa: ${s.label}`);
    }
    assert.ok(["kesin", "muhtemel", "belirsiz"].includes(r.confidence), r.key);
    assert.match(r.appliesFrom, /^\d{4}-\d{2}-\d{2}$/, r.key);
    assert.equal(findRule(R, r.key), r, `${r.key} tablodaki yoluyla bulunur`);
    assert.ok(!keys.has(r.key), `${r.key} tekrar`);
    keys.add(r.key);
    assert.ok(ruleValueText(r).length > 0, `${r.key} değer metni`);
  }
  for (const b of R.bilgi) {
    assert.ok(b.title && b.text && b.basis, b.key);
    assert.ok(b.sources.length >= 1, b.key);
    for (const s of b.sources) assert.match(s.url, /^https:\/\//, `${b.key} ${s.url}`);
    if (b.confirm) assert.ok(isAccountantCheckKey(b.confirm), `${b.key} → ${b.confirm}`);
  }
  assert.equal(RULES_COMPILED_AT, "2026-10-24");
  assert.equal(RULES_VERIFIED_AT, null);
  assert.ok(RULES_CHECK_NOTE.includes("resmî metinlerin kendisi henüz karşılaştırılmadı"));
});

test("A1: elle değiştirilebilen kurallar tam olarak §2.4'tekiler; onay maddeleri listede var", () => {
  const overridable = allRules(R)
    .filter((r) => r.overridable)
    .map((r) => r.key)
    .sort();
  assert.deepEqual(overridable, [
    "damga.beyanname.kdv",
    "damga.beyanname.kv",
    "damga.beyanname.mphb",
    "damga.beyanname.muhtasar",
    "damga.beyanname.yillikGv",
    "damga.gecici",
    "damga.mali.bilanco",
    "damga.mali.gelirTablosu",
    "sgk.isverenOran",
  ]);
  for (const r of allRules(R)) if (r.confirm) assert.ok(isAccountantCheckKey(r.confirm), `${r.key} → ${r.confirm}`);
  assert.equal(R.kv.asgariZararDusulur.overridable, undefined);
});

test("A2: 2026 değerleri ve türetilen kontroller (kural tablosu)", () => {
  assert.equal(R.kv.oran.value, 0.25);
  assert.equal(R.kv.asgariOran.value, 0.1);
  assert.equal(R.gecici.oran.value, 0.25);
  assert.equal(R.ucret.asgariBrut.value, 33030);
  assert.equal(R.sgk.pek.value.ust, 9 * R.sgk.pek.value.alt);
  assert.equal(R.sgk.pek.value.ust, 297270);
  assert.equal(r2(R.ucret.asgariBrut.value * R.ucret.damgaOrani.value), 250.7);
  assert.equal(R.sgk.isverenOran.value, 0.1975);
  // İşveren payı: yasal %21,75 − imalat dışı 2 puan Hazine indirimi; elle değerin üst sınırı indirimsiz oran
  assert.equal(R.sgk.isverenOran.overrideMax, 0.2175);
  assert.equal(Math.round((R.sgk.isverenOran.overrideMax! - 0.02) * 10_000) / 10_000, R.sgk.isverenOran.value);
  // Asgari net: 33.030 − %14 − %1
  assert.equal(r2(R.ucret.asgariBrut.value * (1 - R.sgk.isciOran.value - R.sgk.isciIssizlik.value)), 28075.5);
  assert.equal(r2(R.ucret.asgariIstisna.value.reduce((a, b) => a + b, 0)), 57881.23);
  assert.equal(r2(R.damga.beyanname.kv.value + R.damga.mali.bilanco.value + R.damga.mali.gelirTablosu.value), 2516.3);
  assert.equal(r2(R.damga.beyanname.kdv.value * 2 + R.damga.beyanname.mphb.value), 2521.7);
  assert.equal(R.vuk.dogrudanGider.value, 12000);
  assert.deepEqual(R.takvim.value, { kdv1: 28, kdv2: 25, mphb: 26, sgk: "son" });
  assert.deepEqual(R.enflasyon.value, [2025, 2026, 2027]);
  assert.equal(ruleValueText(R.kv.oran), "%25");
  assert.equal(plain(ruleValueText(R.damga.gecici)), "791,00 ₺");
  assert.equal(ruleValueText(R.ucret.damgaOrani), "binde 7,59");
  assert.equal(ruleValueText(R.sgk.isverenOran), "%19,75");
});

test("A2: stopaj ve sorumlu sıfatıyla KDV oranları profilden", () => {
  assert.equal(withholdingRate("kira", R), 0.2);
  assert.equal(withholdingRate("serbest_meslek", R), 0.2);
  assert.equal(withholdingRate("internet_reklam", R), 0.15);
  assert.equal(withholdingRate("internet_reklam_yurtdisi", R), 0.15);
  assert.equal(withholdingRate("yurt_disi_hizmet", R), 0);
  assert.equal(withholdingRate("yok", R), 0);
  assert.equal(withholdingRate(null, R), 0);
  assert.equal(withholdingKdv2("internet_reklam_yurtdisi", R), 0.2);
  assert.equal(withholdingKdv2("yurt_disi_hizmet", R), 0.2);
  assert.equal(withholdingKdv2("internet_reklam", R), 0);
  assert.equal(withholdingKdv2("kira", R), 0);
  // U5: tutar ipucu profilin oranıyla (şahsa internet reklamı %15 → ÷ 0,85); yurt dışı ve stopajsızda yok
  assert.equal(withholdingGrossHint("kira", R), WITHHOLDING_GROSS_HINT);
  assert.equal(withholdingGrossHint("serbest_meslek", R), WITHHOLDING_GROSS_HINT);
  assert.equal(withholdingGrossHint("internet_reklam", R), "Tutar brüt olmalı; elinize geçen tutarı yazdıysanız brüt = net ÷ 0,85.");
  for (const w of ["internet_reklam_yurtdisi", "yurt_disi_hizmet", "yok", null] as const) assert.equal(withholdingGrossHint(w, R), null, String(w));
});

// ---------------------------------------------------------------- 3. Bilinmeyen yıl

test("A3: 2027 tablosu yok → 2026 değerleri, tahmini", () => {
  const r = rulesFor(2027);
  assert.equal(r.estimated, true);
  assert.equal(r.fromYear, 2026);
  assert.equal(r.year, 2027);
  assert.deepEqual(allRules(r.rules).map((x) => [x.key, x.value]), allRules(R).map((x) => [x.key, x.value]));
  assert.equal(rulesFor(2026).estimated, false);
  assert.equal(rulesFor(2029).fromYear, 2026);
  // Tablo kopyalanır: elle değer başka çağrıya sızmaz
  rulesFor(2026, { "damga.gecici": 820 });
  assert.equal(TAX_RULES[2026].damga.gecici.value, 791);
});

// ---------------------------------------------------------------- 4. Elle değer

test("A4: elle değer yalnız elle değiştirilebilen kurala ve sınırları içinde uygulanır", () => {
  const g = rulesFor(2026, { "damga.gecici": 820 }).rules;
  assert.equal(g.damga.gecici.value, 820);
  assert.equal(g.damga.gecici.override?.table, 791);
  assert.equal(rulesFor(2026, { "sgk.isverenOran": 0.1475 }).rules.sgk.isverenOran.value, 0.1475);
  // Kesin bir kurala ya da kodda sabit olana elle değer yok sayılır
  assert.equal(rulesFor(2026, { "kv.oran": 0.2 }).rules.kv.oran.value, 0.25);
  assert.equal(rulesFor(2026, { "kv.asgariZararDusulur": true }).rules.kv.asgariZararDusulur.value, false);
  // Sınır: sgk.isverenOran ≤ 0,2175, sayı sonlu ve ≥ 0
  assert.equal(rulesFor(2026, { "sgk.isverenOran": 0.3 }).rules.sgk.isverenOran.value, 0.1975);
  assert.equal(rulesFor(2026, { "damga.gecici": -1 }).rules.damga.gecici.value, 791);
  assert.equal(rulesFor(2026, { "damga.gecici": Number.NaN }).rules.damga.gecici.value, 791);
  assert.equal(rulesFor(2026, { "yok.boyle": 1 }).rules.damga.gecici.value, 791);
  // Beyanname ve mali tablo damgası yalnız tahmini yılda elle değiştirilir
  assert.equal(rulesFor(2026, { "damga.beyanname.kv": 1700 }).rules.damga.beyanname.kv.value, 1605.8);
  assert.equal(rulesFor(2027, { "damga.beyanname.kv": 1700 }).rules.damga.beyanname.kv.value, 1700);
  assert.equal(rulesFor(2027, { "damga.mali.bilanco": 700 }).rules.damga.mali.bilanco.value, 700);
  // Saklanan biçim (not, kim, ne zaman) ve satırı
  const k = rulesFor(2026, { "damga.gecici": { value: 820, note: "muhasebeci 24.11.2026", by: "Ayşe", date: "2026-11-24" } }).rules.damga.gecici;
  assert.equal(plain(overrideText(k)!), "Elle: 820,00 ₺ (tablo: 791,00 ₺) · muhasebeci 24.11.2026 · Ayşe, 24.11.2026");
  assert.equal(overrideText(R.damga.gecici), null);
});

// ---------------------------------------------------------------- 5. Bayatlama

test("A5: tablo 90 günden eskiyse ve bakılan yılın tablosu yoksa bant uyarır", () => {
  // Planın tarihleri (2027-01-23 yok / 2027-01-24 var) Ekim'i 30 gün saymıştı: 24.10.2026'dan 90 gün sonrası
  // 22.01.2027'dir (Ekim 31 gün). Kural (§2.5, "90 günden eski") bu günle sınanır.
  assert.deepEqual(rulesStaleNotes("2027-01-22"), []);
  assert.deepEqual(rulesStaleNotes("2027-01-23"), ["Kural tablosu 90 günden eski; yeni tutarlar açıklanmış olabilir."]);
  assert.deepEqual(rulesStaleNotes("2026-10-28", [2026]), []);
  assert.deepEqual(rulesStaleNotes("2026-12-01", [2027]), ["2027 kuralları tabloda yok; 2026 değerleri kullanılıyor (tahmini)."]);
  assert.equal(rulesCompiledText(2026), "Kurallar 24.10.2026'da derlendi; resmî metinlerle henüz karşılaştırılmadı · Türkiye 2026");
});

// ---------------------------------------------------------------- 6. Metinler sahibin dilinde

const CODE_WORDS = [/\.tsx?\b/, /\bsrc\//, /\b[a-z]+[A-Z][A-Za-z]*\b/, /müşavir/i, /onayladı/i];

function ownerTexts(): [string, string][] {
  const out: [string, string][] = [];
  for (const c of ACCOUNTANT_CHECKS) out.push([`${c.key}.title`, c.title], [`${c.key}.assumed`, c.assumed], [`${c.key}.ask`, c.ask]);
  // Ayarlardan kurulan cümleler (VG-05): varsayılan ve dolu ayarlarla
  const filled = { ...DEFAULT_TAX_SETTINGS, firstActivity: "ilk" as const, minWageSupport: true, muhtasarQuarterly: true, includeSeparate: true, quarterDepreciation: "ay12" as const };
  for (const st of [DEFAULT_TAX_SETTINGS, filled])
    for (const c of accountantChecksFor({ settings: st, today: "2026-11-13", settingsEmployerRate: 0.1575 })) out.push([`${c.key}.assumed (ayar)`, c.assumed], [`${c.key}.ask (ayar)`, c.ask]);
  for (const [k, v] of Object.entries(TAX_DOC_LABELS)) out.push([`doc.${k}`, v]);
  for (const [k, v] of Object.entries(WITHHOLDING_LABELS)) out.push([`stopaj.${k}`, v]);
  out.push(["personelBelgeli", TAX_DOC_PERSONEL_BELGELI], ["disclaimer", TAX_DISCLAIMER], ["disclaimerShort", TAX_DISCLAIMER_SHORT]);
  out.push(["vatToZero", VAT_TO_ZERO_LABEL], ["grossHint", WITHHOLDING_GROSS_HINT], ["checkNote", RULES_CHECK_NOTE]);
  for (const r of allRules(R)) {
    out.push([`${r.key}.title`, r.title], [`${r.key}.basis`, r.basis], [`${r.key}.value`, ruleValueText(r)]);
    if (r.note) out.push([`${r.key}.note`, r.note]);
  }
  for (const b of R.bilgi) out.push([`${b.key}.title`, b.title], [`${b.key}.text`, b.text]);
  return out;
}

test("A6: ekranda görünen metinlerde kod adı, dosya adı, 'müşavir' ve 'onayladı' yok", () => {
  for (const [where, text] of ownerTexts()) {
    for (const re of CODE_WORDS) assert.ok(!re.test(text), `${where}: "${text}" ${re}`);
  }
});

test("A6: belge seçenekleri bölüme göre; personelde 'belgesi yok' yok, 'bordroda' var", () => {
  assert.deepEqual(
    taxDocOptions("personel").map((o) => o.label),
    ["Seçilmedi", "Bordroda (Maaşlar'a ekleyin)", "Paraşüt'te faturası var", "Dışarıdan hizmet: belgesi muhasebecide (fatura, SMM)"],
  );
  assert.deepEqual(
    taxDocOptions("kira").map((o) => o.label),
    [
      "Seçilmedi",
      "Paraşüt'te faturası var (burada sayılmaz)",
      "Belgesi muhasebecide (fiş, makbuz, serbest meslek makbuzu)",
      "Belgesi yok: muhasebecinize sorun (vergiden düşülmez)",
    ],
  );
  assert.equal(taxDocAllowed("yok", "personel"), false);
  assert.equal(taxDocAllowed("bordro", "personel"), true);
  assert.equal(taxDocAllowed("bordro", "genel"), false);
  assert.equal(taxDocAllowed("yok", "mal"), true);
});

test("K27: tahmin 1.000 ₺ ve üstünde 100 ₺'ye, altında 1 ₺'ye yuvarlanır", () => {
  assert.equal(estimateRound(68886.995), 68900);
  assert.equal(estimateRound(974.38), 974);
  assert.equal(estimateRound(999.6), 1000);
  assert.equal(estimateRound(1049.99), 1000);
  assert.equal(estimateRound(1050), 1100);
  assert.equal(estimateRound(-25956.18), -26000);
  assert.equal(estimateRound(0.4), 0);
  assert.equal(plain(formatEstimate(68886.995)), "≈ 68.900 ₺");
  assert.equal(plain(formatEstimate(974.38)), "≈ 974 ₺");
  assert.equal(r2(4211.325), 4211.33);
  assert.equal(r2(-0.004), 0);
});

// ---------------------------------------------------------------- Ayarlar ve işaretler

test("parseTaxSettings: bozuk ya da eksik alan varsayılana düşer, bilinmeyen anahtar atılır", () => {
  assert.deepEqual(parseTaxSettings(null), DEFAULT_TAX_SETTINGS);
  assert.deepEqual(parseTaxSettings("x"), DEFAULT_TAX_SETTINGS);
  assert.equal(DEFAULT_TAX_SETTINGS.periodStart, "2026-06-25");
  assert.equal(DEFAULT_TAX_SETTINGS.firstActivity, null);
  assert.equal(DEFAULT_TAX_SETTINGS.quarterDepreciation, "kalan");
  const s = parseTaxSettings({
    periodStart: "2026-13-40",
    firstActivity: "bilmiyorum",
    quarterDepreciation: "ay12",
    muhtasarQuarterly: "evet",
    minWageSupport: true,
    includeSeparate: true,
    carriedLoss: { amount: -5, note: "x" },
    manualRows: { "manual:su": "belgeli", "manual:diger_mal": "bordro", "manual:personel_extra": "bordro", "manual:yok": "belgeli", "manual:harici": "x" },
    overrides: {
      "damga.gecici": { value: 820, note: "not", by: "Ayşe", date: "2026-11-24" },
      "kv.oran": { value: 0.2, note: "x", by: "x", date: "2026-11-24" },
      "sgk.isverenOran": { value: 0.5, note: "x", by: "x", date: "2026-11-24" },
      "damga.beyanname.kv": { value: 1700, note: "2027", by: "x", date: "2026-12-30" },
    },
    checks: { sirket: { by: "Ayşe", date: "2026-10-24", note: "" }, yok: { by: "x", date: "x" } },
  });
  assert.equal(s.periodStart, "2026-06-25");
  assert.equal(s.firstActivity, null);
  assert.equal(s.quarterDepreciation, "ay12");
  assert.equal(s.muhtasarQuarterly, false);
  assert.equal(s.minWageSupport, true);
  assert.equal(s.includeSeparate, true);
  assert.equal(s.carriedLoss, null);
  // Elle satır yalnız Gelir-gider'deki anahtarlarla ve bölüme uygun belgeyle
  assert.deepEqual(s.manualRows, { "manual:su": "belgeli", "manual:personel_extra": "bordro" });
  assert.ok(Object.keys(s.manualRows).every((k) => MANUAL_PNL_ROWS.some((r) => r.key === k)));
  assert.deepEqual(Object.keys(s.overrides).sort(), ["damga.beyanname.kv", "damga.gecici"]);
  assert.deepEqual(s.checks, { sirket: { by: "Ayşe", date: "2026-10-24", note: null } });
  assert.equal(parseTaxSettings({ firstActivity: "ilk", periodStart: "2026-01-01" }).firstActivity, "ilk");
  assert.equal(parseTaxSettings({ periodStart: "2026-01-01" }).periodStart, "2026-01-01");
  assert.deepEqual(parseTaxSettings({ carriedLoss: { amount: 900000, note: "2025 KV", by: "Ayşe", date: "2027-04-20" } }).carriedLoss, {
    amount: 900000,
    note: "2025 KV",
    by: "Ayşe",
    date: "2027-04-20",
  });
});

test("Muhasebeciye sorulacaklar: 8 temel madde, çip ve sahibin işareti", () => {
  assert.equal(ACCOUNTANT_CHECKS.filter((c) => c.priority === "temel").length, 8);
  assert.deepEqual(
    ACCOUNTANT_CHECKS.filter((c) => c.priority === "temel").map((c) => c.code),
    ["M1", "M2", "M3", "M5", "M6", "M7", "M8", "M11"],
  );
  assert.equal(ACCOUNTANT_CHECKS.length, 18);
  assert.equal(new Set(ACCOUNTANT_CHECKS.map((c) => c.key)).size, 18);
  const none = checkStatus(DEFAULT_TAX_SETTINGS);
  assert.deepEqual(none, { p0Done: 0, p0Total: 8, done: 0, total: 18, allDone: false });
  assert.equal(checksChipText(none), "Muhasebeciye sorulacaklar: 0 / 8");
  const mark = { by: "Ayşe", date: "2026-10-24", note: null };
  const all = Object.fromEntries(ACCOUNTANT_CHECKS.filter((c) => c.priority === "temel").map((c) => [c.key, mark]));
  const done = checkStatus({ checks: all });
  assert.equal(done.allDone, true);
  assert.equal(checksChipText(done), "Muhasebecinizle gözden geçirildi (sahibin işareti)");
  assert.equal(checksChipText(checkStatus({ checks: { sirket: mark, muhtasar: mark } })), "Muhasebeciye sorulacaklar: 1 / 8");
});

// ---------------------------------------------------------------- Denetim 13 Kasım (P09)

test("VG-05: 'Panelin varsaydığı' şimdiki ayarlardan; verinin o günkü rakamı yazmaz", () => {
  const of = (st: Partial<TaxSettings>, employer?: number) => {
    const list = accountantChecksFor({ settings: { ...DEFAULT_TAX_SETTINGS, ...st }, today: "2026-11-13", settingsEmployerRate: employer });
    return (key: string) => list.find((c) => c.key === key)!;
  };
  const def = of({}, 0.1575);
  assert.equal(def("sirket").assumed, "Hesap döneminin başı 25.06.2026; şirketin ilk kez mi kurulduğu işaretlenmedi, bu yüzden asgari kurumlar vergisi muafiyeti uygulanmıyor.");
  assert.equal(def("sgk_oran").assumed, "Vergi ve nakit planı işveren SGK %19,75 + işsizlik %2 kullanıyor. Gelir-gider ise Ayarlar'daki oranı kullanıyor (%15,75).");
  assert.equal(def("muhtasar").assumed, "Muhtasarın vergi kısmı aylık.");
  assert.match(def("destek").assumed, /SGK'dan düşülmüyor\.$/);
  assert.match(def("kafe_disi").assumed, /hesaba katılmıyor\.$/);
  // Sahip ayarları değiştirdi: şirket ilk kez kuruldu, Ayarlar %19,75, muhtasar üç aylık, destek açık, kafe dışı faturalar dahil
  const set = of({ firstActivity: "ilk", muhtasarQuarterly: true, minWageSupport: true, includeSeparate: true, quarterDepreciation: "ay12" }, 0.1975);
  assert.equal(set("sirket").assumed, "Hesap döneminin başı 25.06.2026; şirket ilk kez kuruldu diye işaretli: asgari kurumlar vergisi 2026–2028 uygulanmıyor.");
  assert.equal(set("sgk_oran").assumed, "Vergi ve nakit planı işveren SGK %19,75 + işsizlik %2 kullanıyor. Ayarlar'daki oran da aynı.");
  assert.match(set("muhtasar").assumed, /üç ayda bir/);
  assert.match(set("destek").assumed, /SGK'dan düşülüyor; vergi kârındaki personel giderinden de\.$/);
  assert.match(set("kafe_disi").assumed, /hesaba katılıyor\.$/);
  assert.match(set("ortak").assumed, /Alp Koç faturaları şirketin gideri sayılıyor/);
  assert.match(set("demirbas").assumed, /amortisman: kümülatif ay ÷ 12\.$/);
  assert.match(of({ firstActivity: "devir" })("sirket").assumed, /muafiyeti yok\.$/);
  // Elle değer (işveren SGK %14,75) cümleye girer; Ayarlar okunmadıysa o cümle yok
  assert.equal(of({ overrides: { "sgk.isverenOran": { value: 0.1475, note: "teşvik", by: "x", date: "2026-11-01" } } })("sgk_oran").assumed, "Vergi ve nakit planı işveren SGK %14,75 + işsizlik %2 kullanıyor.");
  // Verinin rakamları (bordro, kira, demirbaş faturaları, geçici vergi tahmini, KDV devredeni) cümlelerde yok
  for (const key of ["bordro", "kira", "demirbas", "gecici_2026", "kdv", "yerel"]) {
    assert.doesNotMatch(def(key).assumed, /\d{2}\.\d{3}|30\.000|35\.314|948\.680|68\.900|121\.204|160\.000|30 Kasım/, key);
  }
});

test("VG-10: muhasebeciye sorulan iki soru tam ve anlaşılır", () => {
  const list = (st: Partial<TaxSettings> = {}) => accountantChecksFor({ settings: { ...DEFAULT_TAX_SETTINGS, ...st }, today: "2026-11-13" });
  const ask = (key: string, st: Partial<TaxSettings> = {}) => list(st).find((c) => c.key === key)!.ask;
  assert.match(ask("demirbas"), /ModPOS lisansı ve ışıklı tabela demirbaş mı\? 12\.000\s₺'ye kadar olanları doğrudan gider yazıyor musunuz\?$/);
  assert.equal(ask("asgari_zarar"), "Danıştay kararından sonra asgari kurumlar vergisinde geçmiş yıl zararını düşüyor musunuz? (Devreden zarar olan yılda etkisi var.)");
  assert.equal(ask("asgari_zarar", { firstActivity: "ilk" }), "Danıştay kararından sonra asgari kurumlar vergisinde geçmiş yıl zararını düşüyor musunuz? (2029'dan önce etkisi yok: 2026–2028 asgari vergi uygulanmıyor.)");
  // Hiçbir soru yarım bitmez: soru işareti, nokta ya da parantezle
  for (const c of [...ACCOUNTANT_CHECKS, ...list({ firstActivity: "ilk" })]) assert.match(c.ask, /[?.)]$/, c.key);
});
