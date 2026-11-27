/**
 * Vergi eylemlerinin saf kuralları (plan docs/planlar/vergi.md §7.2, §4.5): muhasebeci kaydının dönemi ve alanları,
 * Ödemeler'deki karşılığı, düzeltmenin dönemi, varlığın maliyeti ve yöntemi, sınıflandırmanın bölüme uygunluğu, ayar
 * ve elle değerin sınırları. Sunucu eylemi (src/server/actions/tax.ts) bunlarla reddeder; pencere aynı metni gösterir.
 * Saf modül; tests/vergi-eylemler.test.ts.
 */

import { shiftMonth } from "../calc/engine";
import type { FixedSection } from "../calc/types";
import { SEPARATE_CATEGORIES } from "../constants";
import { dateTR, money, monthLabel, num, tl } from "../format";
import { numberAblative } from "../month-settings";
import { isCalendarDate, isMuhtasarReminder, isProvisionalTaxReminder, postponedFrom, type ReminderRow } from "../reminders";

import { directExpenseAllowed, QUARTER_DEPRECIATION_LABELS } from "./assets";
import { mphbPeriodOf, periodOf, quarterLabel, quarterOfDue, quarterOfMonth, quarterRange } from "./calendar";
import { FILING_KIND_LABELS, type TaxFilingKind } from "./corporate";
import { QUARTER_SPAN_KINDS, type AdjustmentKind } from "./pnl";
import { findRule, overrideAllowed, r2, rulesFor, RULES_LATEST_YEAR, type TaxDoc, taxDocAllowed, TAX_RULES, type Withholding } from "./rules";
import type { TaxSettings } from "./settings";
import { isKvReminder } from "./view";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const fold = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------------------------------------------------------------- Muhasebecinin rakamı (§4.5-a)

export const FILING_PERIOD_FORMAT: Record<TaxFilingKind, RegExp> = {
  gecici: /^\d{4}-Q[1-4]$/,
  kv: /^\d{4}$/,
  mphb: MONTH,
  kdv_matrah: MONTH,
};

/** Muhtasar ve KDV beyannamesi satışları: son 24 ay */
export const FILING_MONTHS_BACK = 24;

/** Kaydın dönemi ekranda: "2026/3", "2026", "Eylül 2026" */
export function filingPeriodLabel(kind: TaxFilingKind, period: string): string {
  if (kind === "gecici") return quarterLabel(period);
  if (kind === "kv") return period;
  return monthLabel(period);
}

/** "Geçici vergi 2026/3" */
export const filingTitle = (kind: TaxFilingKind, period: string) => `${FILING_KIND_LABELS[kind]} ${filingPeriodLabel(kind, period)}`;

/**
 * Dönem türe uygun mu: geçici vergi ve kurumlar vergisi hesap döneminin içinde ve başlamış, muhtasar ve KDV beyannamesi
 * satışları son 24 ay (bu ay dahil). Uygunsa null
 */
export function filingPeriodRefusal(kind: TaxFilingKind, period: string, settings: Pick<TaxSettings, "periodStart">, today: string): string | null {
  if (!FILING_PERIOD_FORMAT[kind].test(period)) return "Geçersiz dönem";
  switch (kind) {
    case "gecici": {
      const r = quarterRange(period, settings);
      if (!r) return "Dönem hesap döneminin içinde olmalı";
      return r.from > today ? "Bu dönem henüz başlamadı" : null;
    }
    case "kv": {
      const r = periodOf(Number(period), settings);
      if (!r) return "Dönem hesap döneminin içinde olmalı";
      return r.from > today ? "Bu dönem henüz başlamadı" : null;
    }
    case "mphb":
    case "kdv_matrah": {
      const cur = today.slice(0, 7);
      return period > cur || period < shiftMonth(cur, -FILING_MONTHS_BACK) ? `Dönem son ${FILING_MONTHS_BACK} aydan biri olmalı` : null;
    }
  }
}

/** Kaydın isteğe bağlı (ve KDV satışlarında zorunlu) alanları; `signed` eksi olabilir (zararda matrah) */
export const FILING_VALUE_FIELDS: Record<TaxFilingKind, readonly { key: string; label: string; required?: boolean; signed?: boolean }[]> = {
  gecici: [
    { key: "matrah", label: "Geçici vergi matrahı (zarar ve indirim düşülmüş; zararda eksi)", signed: true },
    { key: "hesaplanan", label: "Hesaplanan geçici vergi (kümülatif)" },
  ],
  kv: [
    { key: "matrah", label: "Kurum kazancı (zararda eksi)", signed: true },
    { key: "hesaplanan", label: "Hesaplanan kurumlar vergisi" },
    { key: "mahsup", label: "Mahsup edilen geçici vergi" },
    { key: "iade", label: "İade / mahsup alacağı" },
    { key: "devredenZarar", label: "Sonraki yıllara devreden zarar" },
  ],
  mphb: [
    { key: "ucretGv", label: "Ücret gelir vergisi" },
    { key: "ucretDv", label: "Ücret damga vergisi" },
    { key: "kiraStopaj", label: "Kira stopajı" },
    { key: "smStopaj", label: "Serbest meslek stopajı" },
    { key: "digerStopaj", label: "Diğer stopaj" },
  ],
  kdv_matrah: [
    { key: "m10", label: "%10 matrah", required: true },
    { key: "m20", label: "%20 matrah", required: true },
    { key: "m1", label: "%1 matrah" },
    { key: "istisna", label: "İstisna ve diğer" },
    { key: "kafeDisi", label: "Bunun kafe dışı kısmı (muhasebecinize sorun)" },
  ],
};

export const AMOUNT_REQUIRED = "Tutar girin (0 olabilir)";
export const AMOUNT_NEGATIVE = "Tutar eksi olamaz";

/**
 * Kaydın tutarları: ödenecek ve damga (KDV beyannamesi satışlarında 0; KDV ödemesi nakit planında) ve türün alanları.
 * Bilinmeyen alan atılır, boş alan yazılmaz. Hatalıysa ilk hatanın metni
 */
export function cleanFiling(
  kind: TaxFilingKind,
  input: { payable: number | null; stamp: number | null; values: Readonly<Record<string, number | null | undefined>> },
): { ok: true; payable: number; stamp: number; values: Record<string, number> } | { ok: false; error: string } {
  const values: Record<string, number> = {};
  for (const f of FILING_VALUE_FIELDS[kind]) {
    const v = input.values[f.key];
    if (v === null || v === undefined) {
      if (f.required) return { ok: false, error: `${f.label}: ${AMOUNT_REQUIRED}` };
      continue;
    }
    if (!Number.isFinite(v)) return { ok: false, error: `${f.label}: geçersiz sayı` };
    if (v < 0 && !f.signed) return { ok: false, error: `${f.label}: ${AMOUNT_NEGATIVE}` };
    values[f.key] = r2(v);
  }
  if (kind === "kdv_matrah") return { ok: true, payable: 0, stamp: 0, values };
  for (const [label, v] of [
    ["Ödenecek", input.payable],
    ["Damga vergisi", input.stamp],
  ] as const) {
    if (v === null || v === undefined) return { ok: false, error: `${label}: ${AMOUNT_REQUIRED}` };
    if (!Number.isFinite(v)) return { ok: false, error: `${label}: geçersiz sayı` };
    if (v < 0) return { ok: false, error: `${label}: ${AMOUNT_NEGATIVE}` };
  }
  return { ok: true, payable: r2(input.payable!), stamp: r2(input.stamp!), values };
}

/** Hatırlatıcının sıradaki gününün dönemi (ertelenmiş kopyada asıl günden) */
function reminderPeriod(kind: TaxFilingKind, r: Pick<ReminderRow, "dueDate" | "note" | "repeat">): string {
  const due = (r.repeat === "none" ? postponedFrom(r.note) : null) ?? r.dueDate;
  switch (kind) {
    case "gecici":
      return quarterOfDue(due);
    case "mphb":
      return mphbPeriodOf(due);
    case "kv":
      return String(Number(due.slice(0, 4)) - 1);
    case "kdv_matrah":
      return "";
  }
}

/**
 * Kaydın Ödemeler'deki karşılığı (§4.5-a, K4): sıradaki günü o döneme düşen etkin hatırlatıcılar. Geçici vergi
 * `isProvisionalTaxReminder`, muhtasar başlığında "muhtasar" geçen `isMuhtasarReminder` ("Kira stopajı" değil), kurumlar
 * vergisi `isKvReminder`; KDV beyannamesi satışlarının karşılığı yoktur (KDV ödemesi nakit planında). Tutar yalnız tek
 * karşılık varsa yazılır
 */
export function filingReminders<R extends ReminderRow>(reminders: readonly R[], kind: TaxFilingKind, period: string): R[] {
  if (kind === "kdv_matrah") return [];
  const match = (r: R) =>
    kind === "gecici" ? isProvisionalTaxReminder(r) : kind === "kv" ? isKvReminder(r) : isMuhtasarReminder(r) && /muhtasar/.test(fold(r.title));
  return reminders.filter((r) => r.active && match(r) && reminderPeriod(kind, r) === period);
}

/** Kayıttan sonra hatırlatıcının durumu */
export type FilingReminderResult = "yazildi" | "yok" | "birden_cok" | null;

/** Pencerenin bildirimi: "Muhasebecinin rakamı kaydedildi: Geçici vergi 2026/3 · Ödemeler'e de yazıldı" */
export function filingSavedText(kind: TaxFilingKind, period: string, reminder: FilingReminderResult): string {
  const tail =
    reminder === "yazildi"
      ? " · Ödemeler'e de yazıldı"
      : reminder === "birden_cok"
        ? " · Ödemeler'de birden çok karşılığı var; tutarı hatırlatıcıya elle yazın"
        : reminder === "yok"
          ? " · Ödemeler'de karşılığı yok"
          : "";
  return `Muhasebecinin rakamı kaydedildi: ${filingTitle(kind, period)}${tail}`;
}
export const FILING_REMOVED_TEXT = "Kaldırıldı; tahmin kullanılıyor";

/** Kaldırmadan sonra Ödemeler'deki karşılık: kaydın yazdığı tutar silindi ("silindi") ya da başka bir tutar kaldı ("kaldi") */
export type FilingRemovedReminder = "silindi" | "kaldi" | null;

/**
 * Kaldırılan kaydın Ödemeler'deki karşılığı (K4): tek karşılığın tutarı kaydın ödenecek + damgasına eşitse o tutar
 * kaydın kopyasıdır ("Ödemeler'deki hatırlatıcıya da yaz") ve kayıtla birlikte silinir; yoksa takvim 1 › 2 › 3
 * önceliğinde Ödemeler'deki tutarı kullanmaya devam ederdi, "tahmin kullanılıyor" yanlış olurdu. Başka bir tutar
 * yazılmışsa ona dokunulmaz
 */
export function filingRemovedReminder<R extends ReminderRow>(
  reminders: readonly R[],
  filing: { kind: TaxFilingKind; period: string; payable: number; stamp: number },
): { clear: R | null; result: FilingRemovedReminder } {
  const hits = filingReminders(reminders, filing.kind, filing.period).filter((r) => r.amount !== null);
  if (!hits.length) return { clear: null, result: null };
  const copy = Math.round((filing.payable + filing.stamp) * 100) / 100;
  if (hits.length === 1 && Math.abs((hits[0].amount ?? 0) - copy) < 0.005) return { clear: hits[0], result: "silindi" };
  return { clear: null, result: "kaldi" };
}

/**
 * "Muhasebecinin rakamı kaldırılsın mı?" penceresinin açıklaması (§4.5-a): Ödemeler'e ne olacağını filingRemovedReminder
 * ile aynı kuralla söyler. `removal` null: Ödemeler okunmadı (Vergi kârı), kural cümlesi yazılır
 */
export function filingRemoveConfirmText(title: string, removal: { result: FilingRemovedReminder; amount: number | null } | null, hasReminder = true): string {
  const head = `${title} için girilen rakam silinir`;
  if (!hasReminder) return `${head}; tahmin kullanılır.`;
  if (!removal) return `${head}; tahmin kullanılır. Ödemeler'deki hatırlatıcıda bu kaydın yazdığı tutar (ödenecek + damga) varsa o da silinir; başka bir tutar yazılıysa kalır.`;
  if (removal.result === "silindi")
    return `${head}; tahmin kullanılır. Ödemeler'deki tutar${removal.amount !== null ? ` (${money(removal.amount)})` : ""} bu kaydın yazdığı kopya; o da silinir.`;
  if (removal.result === "kaldi") return `${head}. Ödemeler'deki tutar${removal.amount !== null ? ` (${money(removal.amount)})` : "lar"} kalır; nakit planı ve takvim onu kullanır.`;
  return `${head}; tahmin kullanılır.`;
}

/** Kaldırmanın bildirimi: "Kaldırıldı; tahmin kullanılıyor · Ödemeler'deki tutar da silindi" */
export function filingRemovedText(reminder: FilingRemovedReminder): string {
  return reminder === "silindi" ? `${FILING_REMOVED_TEXT} · Ödemeler'deki tutar da silindi` : reminder === "kaldi" ? "Kaldırıldı; Ödemeler'deki tutar kullanılıyor" : FILING_REMOVED_TEXT;
}

/** İşlem geçmişi: "Geçici vergi 2026/3 · ödenecek 41.200 ₺ · Ödemeler'e de yazıldı" */
export function filingLogText(kind: TaxFilingKind, period: string, payable: number, reminder: FilingReminderResult): string {
  const tail = reminder === "yazildi" ? " · Ödemeler'e de yazıldı" : reminder === "birden_cok" ? " · Ödemeler'e yazılmadı (birden çok karşılık)" : "";
  return `${filingTitle(kind, period)}${kind === "kdv_matrah" ? "" : ` · ödenecek ${tl(payable, Number.isInteger(payable) ? 0 : 2)}`}${tail}`;
}

// ---------------------------------------------------------------- Düzeltme (§4.5-b)

/**
 * Düzeltmenin dönemi: ay hesap döneminin içinde ve bu ay ya da öncesi; çeyrek yalnız kafe dışı türlerde ve tutarı
 * çeyreğin son ayına yazılır. Uygunsa null
 */
export function adjustmentRefusal(a: { month: string; span: "ay" | "ceyrek"; kind: AdjustmentKind }, settings: Pick<TaxSettings, "periodStart">, today: string): string | null {
  if (!MONTH.test(a.month)) return "Geçersiz ay";
  if (a.span === "ceyrek") {
    if (!QUARTER_SPAN_KINDS.includes(a.kind)) return "Çeyrek yalnız kafe dışı gelir ve giderde seçilebilir";
    if (Number(a.month.slice(5, 7)) % 3 !== 0) return "Çeyreğin tutarı çeyreğin son ayına yazılır";
    if (!quarterRange(quarterOfMonth(a.month), settings)) return "Dönem hesap döneminin içinde olmalı";
  } else if (a.month < settings.periodStart.slice(0, 7)) return "Dönem hesap döneminin içinde olmalı";
  if (a.month > today.slice(0, 7)) return a.span === "ceyrek" ? "Çeyrek bitmeden girilemez" : "Gelecek ay için düzeltme girilemez";
  return null;
}

// ---------------------------------------------------------------- Varlık (§3.3, §4.5-c)

export const ASSET_COST_OVER = (max: number) => `Maliyet faturanın kalan tutarını aşıyor (en çok ${tl(max, 2)})`;
export const ASSET_LIFE_RANGE = "Ömür 1–50 yıl olmalı";
export const ASSET_DIRECT_LIMIT = "Doğrudan gider yalnız 12.000 ₺'ye kadar";

/**
 * Varlığın kuralları: ömür 1–50 tam yıl (boş olabilir), doğrudan gider yalnız VUK 313 sınırına kadar (edinilen yılın
 * kuralı), faturaya bağlıysa fatura kafe kategorisinde ve bağlı maliyetler faturanın netini aşmaz (`remaining`:
 * invoiceRemaining, bu varlık hariç). Uygunsa null
 */
export function assetRefusal(
  a: { acquiredOn: string; cost: number; method: "amortisman" | "dogrudan_gider"; lifeYears: number | null },
  invoice: { category: string; remaining: number } | null,
  today: string,
): string | null {
  if (!isCalendarDate(a.acquiredOn)) return "Geçersiz tarih";
  if (a.acquiredOn > today) return "Edinme günü bugünden sonra olamaz";
  if (!(a.cost > 0)) return "Maliyet sıfırdan büyük olmalı";
  if (a.method === "amortisman" && a.lifeYears !== null && (!Number.isInteger(a.lifeYears) || a.lifeYears < 1 || a.lifeYears > 50)) return ASSET_LIFE_RANGE;
  if (a.method === "dogrudan_gider" && !directExpenseAllowed(a.cost, rulesFor(Number(a.acquiredOn.slice(0, 4))).rules)) return ASSET_DIRECT_LIMIT;
  if (invoice) {
    if (SEPARATE_CATEGORIES.includes(invoice.category)) return "Kafe dışı fatura varlığa bağlanamaz";
    if (a.cost > invoice.remaining + 0.01) return ASSET_COST_OVER(Math.max(0, invoice.remaining));
  }
  return null;
}

// ---------------------------------------------------------------- Sınıflandırma (§4.2)

/**
 * Sabit giderin belgesi ve stopajı bölümüne uygun mu: `bordro` yalnız personelde, `yok` personelde değil; stopaj yalnız
 * kira ve genel bölümünde ya da personelde dışarıdan hizmette (`belgeli`); "KDV yok" yalnız şahsa kirada. Uygunsa null
 */
export function fixedClassificationRefusal(section: FixedSection, item: { doc: TaxDoc | null; withholding?: Withholding | null; vatToZero?: boolean }): string | null {
  if (item.doc && !taxDocAllowed(item.doc, section)) return item.doc === "bordro" ? "Bordro yalnız personel giderinde seçilebilir" : "Personel giderinde 'Belgesi yok' seçilemez";
  if (item.withholding) {
    const allowed = section === "kira" || section === "genel" || (section === "personel" && item.doc === "belgeli");
    if (!allowed) return "Stopaj yalnız kira, genel giderler ve dışarıdan hizmette seçilebilir";
  }
  if (item.vatToZero && item.withholding !== "kira") return "'KDV yok' yalnız şahsa işyeri kirasında seçilebilir";
  return null;
}

/** Aylık harcama kategorisinin belgesi: `bordro` yok; personel bölümünde `yok` yok */
export function categoryClassificationRefusal(section: FixedSection | "mal", doc: TaxDoc | null): string | null {
  if (!doc) return null;
  if (doc === "bordro") return "Bordro yalnız sabit personel giderinde seçilebilir";
  return taxDocAllowed(doc, section) ? null : "Personel giderinde 'Belgesi yok' seçilemez";
}

/** "Vergi: sınıflandırma · 5 kalem" (ad ve belge yazılmaz) */
export const classificationLogText = (n: number) => `${n} kalem`;

// ---------------------------------------------------------------- Ayarlar ve elle değer (§2.4, §4.4)

/** Takvimde var olan gün mü (ortak denetim: src/lib/reminders.ts) */
export { isCalendarDate };

/** Hesap döneminin başı: 2000-01-01 … bugün */
export function periodStartRefusal(day: string, today: string): string | null {
  if (!isCalendarDate(day)) return "Geçersiz tarih";
  if (day < "2000-01-01") return "Tarih 2000'den önce olamaz";
  return day > today ? "Hesap dönemi bugünden sonra başlayamaz" : null;
}

/** Elle değer saklanabilir mi (tahmini yılın kuralı da; rulesFor yalnız tahmini yılda uygular). Uygunsa null */
export function overrideRefusal(key: string, value: number | null): string | null {
  const rule = findRule(TAX_RULES[RULES_LATEST_YEAR], key);
  if (!rule || !rule.overridable) return "Bu kural elle değiştirilemez";
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) return "Değer sıfır ya da daha büyük olmalı";
  if (!overrideAllowed(rule, value, true)) return rule.overrideMax !== undefined ? `Değer en çok ${rule.overrideMax}` : "Geçersiz değer";
  return null;
}

/** İşlem geçmişi: "damga.gecici 791 → 820 (not)" */
export function overrideLogText(key: string, from: number, to: number | null, note: string): string {
  // Oranlar dört ondalıklı (0,1975), tutarlar kuruşlu
  const fmt = (v: number) => String(Math.round(v * 10_000) / 10_000).replace(".", ",");
  return `${key} ${fmt(from)} → ${to === null ? "tablodaki değer" : fmt(to)}${note ? ` (${note})` : ""}`;
}

/** Elle değerin tablodaki değeri (son bilinen yıl) */
export function ruleTableValue(key: string): number | null {
  const rule = findRule(TAX_RULES[RULES_LATEST_YEAR], key);
  return rule && typeof rule.value === "number" ? rule.value : null;
}

/**
 * Ayarlar'ın işveren SGK oranının üst sınırı (K19, `setEmployerSgkRate`): kural tablosunun indirimsiz yasal oranı
 * (`sgk.isverenOran.overrideMax`, 2026: %21,75); tablonun yılından türer
 */
export const EMPLOYER_SGK_MAX = TAX_RULES[RULES_LATEST_YEAR].sgk.isverenOran.overrideMax ?? 0.2175;
export const rateText = (v: number) => `%${(Math.round(v * 10000) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Gelir-gider'deki SGK oranı uyarısı (K19, §4.6) */
export interface EmployerRateNotice {
  text: string;
  /** Vergi ve nakit planının kullandığı oran (kural tablosu, elle değer uygulanmış) */
  target: number;
  /** Maaşlar'daki (Ayarlar) oran: uyarının başlığı iki oranı yan yana yazar */
  current: number;
  /** "Ayarlar'daki oranı %19,75 yap" düğmesi: yalnız Muhasebeciye sorulacaklar › SGK oranı işaretliyse (M2) */
  canApply: boolean;
}

/**
 * Ayarlar'daki işveren SGK oranı (Gelir-gider ve dışa aktarımın oranı, K17) vergi ve nakit planının oranından farklıysa
 * Gelir-gider'deki uyarı satırı; aynıysa null. Oran kendiliğinden değişmez (K19): sahip muhasebecisine sorup M2'yi
 * işaretleyince düğme çıkar, düğme yalnız `isverenSgk`'yi yazar (`setEmployerSgkRate`)
 */
export function employerRateNotice(settingsRate: number, tax: Pick<TaxSettings, "overrides" | "checks">, year: number): EmployerRateNotice | null {
  const { rules, fromYear, estimated } = rulesFor(year, tax.overrides);
  const rule = rules.sgk.isverenOran;
  const target = rule.value;
  if (!Number.isFinite(settingsRate) || Math.abs(settingsRate - target) < 1e-9) return null;
  const head = `Maaşlar'da işveren SGK ${rateText(settingsRate)}.`;
  // Tablosu olmayan yıl son bilinen yılın kurallarıyla (tahmini)
  const when = !estimated ? `${fromYear}'${yearLocative(fromYear)}` : `${fromYear} kurallarıyla`;
  const middle = rule.override
    ? `Vergi'de elle girilen oran ${rateText(target)} (Muhasebeci › SGK işveren payı).`
    : `${when} imalat dışı işyerinde 2 puan indirimle standart oran ${rateText(target)}; ek teşvikiniz varsa farklı olabilir.`;
  return {
    text: `${head} ${middle} Muhasebecinize sorun (Muhasebeciye sorulacaklar › SGK oranı); doğruysa Maaşlar › SGK oranları bölümünden değiştirin.`,
    target,
    current: settingsRate,
    canApply: Boolean(tax.checks.sgk_oran),
  };
}

/** Yılın bulunma hâli eki: 2026'da, 2027'de, 2030'da, 2025'te */
export function yearLocative(y: number): string {
  // Ayrılma ekinin ünlüsü ve sertliği aynı: "-dan" → "-da", "-ten" → "-te"
  return numberAblative(y).slice(0, -1);
}

/** Sahibe sorulan SGK sorusu (P5): seçeneklerin anlamı ve ayda ne kadar fark ettiği */
export interface EmployerSgkQuestion {
  current: number;
  target: number;
  title: string;
  /** Önce bugünkü oran (değişmez), sonra vergi kuralının oranı */
  options: { choice: "current" | "target"; rate: number; label: string; text: string }[];
  /** Bu ayın tam zamanlı brüt maaşlarıyla ayda fark: (hedef − bugünkü) × brüt */
  monthlyDiff: number;
  diffText: string;
}

/**
 * Maaşlar'daki işveren SGK oranı vergi kuralının oranından farklı ve sahip henüz cevap vermemişse (Muhasebeciye
 * sorulacaklar › SGK oranı işaretsiz) sorulacak soru; yoksa null. Oran kendiliğinden değişmez (K19): sahip muhasebecisine
 * sorar, cevabı bir düğmeyle verir (`answerEmployerSgk`). Oranlar ve puanlar kural tablosundan (yıldan) türer
 */
export function employerSgkQuestion(settingsRate: number, tax: Pick<TaxSettings, "overrides" | "checks">, year: number, monthlyGross: number): EmployerSgkQuestion | null {
  const notice = employerRateNotice(settingsRate, tax, year);
  if (!notice || notice.canApply) return null;
  const { rules, fromYear, estimated } = rulesFor(year, tax.overrides);
  const rule = rules.sgk.isverenOran;
  const full = rule.overrideMax ?? rule.value;
  const target = notice.target;
  const cur = rateText(settingsRate);
  const tgt = rateText(target);
  const excel = Math.abs(settingsRate - 0.1575) < 1e-9;
  const yearText = estimated ? `${fromYear} kurallarıyla (${year} tablosu henüz yok)` : `${fromYear}'${yearLocative(fromYear)}`;
  const currentText = excel
    ? `Excel'den gelen oran: %20,75 − 5 puan teşvik. Bu 5 puanlık indirim imalat dışı işyerinde Ocak 2025'e kadardı (Şubat 2025'ten %16,75, 2026'dan beri ${rateText(full)} − 2 puan). Muhasebeciniz başka bir teşvik (6111, 7103 …) uyguluyorsa doğru olabilir. Maaşlar ve Gelir-gider bugün bununla hesaplanıyor.`
    : `Maaşlar'daki bugünkü oran; Maaşlar ve Gelir-gider bununla hesaplanıyor. Muhasebeciniz bu oranı (bir teşvikle) uyguluyorsa doğru.`;
  const targetText = rule.override
    ? `Vergi'de elle girilen oran (Muhasebeci › SGK işveren payı); vergi ve nakit planı bunu kullanıyor. Seçtiğiniz aydan itibaren Maaşlar ve Gelir-gider de bununla hesaplanır, önceki aylar değişmez.`
    : `${yearText} yasal oran: ${rateText(full)} − imalat dışı işyerinde ${num(Math.round((full - target) * 10_000) / 100, 0, 2)} puan Hazine indirimi (primler süresinde ödenir, vadesi geçmiş borç yoksa). Vergi ve nakit planı bunu kullanıyor. Seçtiğiniz aydan itibaren Maaşlar ve Gelir-gider de bununla hesaplanır; önceki aylar değişmez.`;
  const monthlyDiff = Math.max(0, monthlyGross) * (target - settingsRate);
  const diffText =
    monthlyGross > 0
      ? `Fark: bu ayın brüt maaşlarıyla ayda ≈ ${money(Math.round(Math.abs(monthlyDiff)))} ${monthlyDiff >= 0 ? "daha fazla" : "daha az"} işveren maliyeti.`
      : "Bu ay tam zamanlı personel yok; fark personel girilince görünür.";
  return {
    current: settingsRate,
    target,
    title: `Muhasebecinize sorun: işveren SGK ${cur} mi, ${tgt} mi?`,
    options: [
      { choice: "current", rate: settingsRate, label: `${cur} kalsın`, text: currentText },
      { choice: "target", rate: target, label: `${tgt} olsun`, text: targetText },
    ],
    monthlyDiff,
    diffText,
  };
}

/** Ayarlar'ın işlem geçmişi: değişen alanlar ("hesap dönemi 25.06.2026", "muhtasar 3 aylık: açık" …) */
export function settingsChangeText(before: TaxSettings, after: TaxSettings): string[] {
  const out: string[] = [];
  const onOff = (v: boolean) => (v ? "açık" : "kapalı");
  if (before.periodStart !== after.periodStart) out.push(`hesap dönemi ${dateTR(after.periodStart)}`);
  if (before.firstActivity !== after.firstActivity)
    out.push(`kuruluş: ${after.firstActivity === "ilk" ? "ilk defa faaliyete başladı" : after.firstActivity === "devir" ? "birleşme, devir, bölünme ya da tür değişikliği" : "bilmiyorum"}`);
  if (before.quarterDepreciation !== after.quarterDepreciation) out.push(`amortisman: ${QUARTER_DEPRECIATION_LABELS[after.quarterDepreciation].toLocaleLowerCase("tr-TR")}`);
  if (before.muhtasarQuarterly !== after.muhtasarQuarterly) out.push(`muhtasar 3 aylık: ${onOff(after.muhtasarQuarterly)}`);
  if (before.minWageSupport !== after.minWageSupport) out.push(`asgari ücret desteği: ${onOff(after.minWageSupport)}`);
  if (before.includeSeparate !== after.includeSeparate) out.push(`kafe dışı faturalar: ${after.includeSeparate ? "hesaba katılıyor" : "katılmıyor"}`);
  const loss = (x: TaxSettings["carriedLoss"]) => (x ? `${x.amount}|${x.note}` : "");
  if (loss(before.carriedLoss) !== loss(after.carriedLoss)) out.push(after.carriedLoss ? `devreden zarar ${money(after.carriedLoss.amount)}` : "devreden zarar kaldırıldı");
  return out;
}
