/**
 * Vergi bölümünün kural tablosu (docs/VERGI.md; plan docs/planlar/vergi.md §2): oranlar, eşikler, maktu tutarlar ve
 * günler yıl anahtarlı, dayanaklı, kaynaklı ve güven dereceli. Değerler yıl dosyasındadır (rules-2026.ts); yıl yoksa en
 * son bilinen yıl "tahmini" kullanılır, oran uydurulmaz (K7). Yalnız `overridable` kurallar ekrandan elle değiştirilir
 * (K8). Saf modül; tests/vergi-kurallar.test.ts.
 *
 * Aynı dosyada bölümün ortak sözlüğü: vergi belgesi (`TaxDoc`) ve stopaj profili (`Withholding`) seçenekleri, üst
 * bandın metni ve tahminin yazılışı (K27).
 */

import type { FixedSection } from "../calc/types";
import { tl } from "../format";
import { daysBetween } from "../reminders";

import type { AccountantCheckKey } from "./checks";
import { RULES_2026 } from "./rules-2026";

export type Confidence = "kesin" | "muhtemel" | "belirsiz";

export const CONFIDENCE_LABELS: Record<Confidence, string> = { kesin: "Kesin", muhtemel: "Muhtemel", belirsiz: "Belirsiz" };

/** Kaynak bağlantısı: kısa ad ("GİB · Gelir vergisi tarifesi 2026") ve https adresi; resmî olan önce */
export interface RuleSource {
  label: string;
  url: string;
}

/** Sayısal değerin ekrandaki birimi: oran (%25), binde (binde 7,59), tutar (791,00 ₺); karmaşık değerler `text` ile */
export type RuleUnit = "oran" | "binde" | "tl" | "metin";

export interface Rule<T = unknown> {
  /** "kv.oran": tablodaki yeri (TaxYearRules'ta aynı yol) */
  key: string;
  title: string;
  value: T;
  /** Kanun maddesi, tebliğ, karar */
  basis: string;
  sources: readonly RuleSource[];
  confidence: Confidence;
  /** YYYY-MM-DD */
  appliesFrom: string;
  note?: string;
  /** Ekrandan elle değiştirilebilir (K8, §2.4) */
  overridable?: boolean;
  /** Elle değerin üst sınırı (sgk.isverenOran: indirimsiz yasal oran) */
  overrideMax?: number;
  /** "Muhasebeci onayı gerekir": Muhasebeciye sorulacaklar'daki madde */
  confirm?: AccountantCheckKey;
  /** Ekranda "sabit tutar" rozeti (beyanname damgaları) */
  fixedAmount?: boolean;
  unit?: RuleUnit;
  /** Karmaşık değerin ekrandaki yazılışı (tarife, takvim) */
  text?: string;
  /** Elle değer uygulandıysa: tablodaki değer ve kaydın künyesi (rulesFor doldurur) */
  override?: { table: T; note: string | null; by: string | null; date: string | null };
}

/** Gelir vergisi tarifesinin dilimi: `upTo`'ya kadar `rate`; son dilimde null (üstü) */
export interface Bracket {
  upTo: number | null;
  rate: number;
}

/** "Bu kafede hesaplanmayanlar" listesinin satırı (§2.3) */
export interface InfoRule {
  key: string;
  title: string;
  status: "uygulanmaz" | "sorulacak" | "bilgi";
  text: string;
  basis: string;
  sources: readonly RuleSource[];
  confidence: Confidence;
  /** Güvenin açıklaması: "kural kesin; şirketin durumu bilinmiyor" */
  confidenceNote?: string;
  confirm?: AccountantCheckKey;
}

export const INFO_STATUS_LABELS: Record<InfoRule["status"], string> = { uygulanmaz: "Uygulanmaz", sorulacak: "Muhasebecinize sorun", bilgi: "Bilgi" };

export interface TaxYearRules {
  year: number;
  kv: {
    oran: Rule<number>;
    asgariOran: Rule<number>;
    /** Asgari kurumlar vergisinden muaf hesap dönemi sayısı (başlanan dahil) */
    asgariMuafDonem: Rule<number>;
    /** Geçmiş yıl zararı asgari matrahtan düşülür mü: kodda sabit (elle değiştirilmez) */
    asgariZararDusulur: Rule<boolean>;
    /** Devreden zararın düşülebildiği yıl sayısı */
    devredenZarar: Rule<number>;
    beyan: Rule<string>;
  };
  gecici: {
    oran: Rule<number>;
    /** Dönem sonunu izleyen ikinci ayın günü */
    gun: Rule<number>;
    mahsup: Rule<string>;
  };
  ucret: {
    asgariBrut: Rule<number>;
    tarife: Rule<readonly Bracket[]>;
    tarifeDiger: Rule<readonly Bracket[]>;
    damgaOrani: Rule<number>;
    /** Asgari ücret gelir vergisi istisnası, ay ay (Ocak … Aralık): türetilir, payroll.ts minWageExemption ile aynı */
    asgariIstisna: Rule<readonly number[]>;
  };
  sgk: {
    pek: Rule<{ alt: number; ust: number }>;
    isciOran: Rule<number>;
    isciIssizlik: Rule<number>;
    isverenOran: Rule<number>;
    isverenIssizlik: Rule<number>;
    /** Asgari ücret desteği, kişi başına günlük */
    asgariUcretDestegi: Rule<number>;
  };
  stopaj: { kira: Rule<number>; serbestMeslek: Rule<number>; internetReklam: Rule<number> };
  kdv: { sorumluYurtDisi: Rule<number> };
  damga: {
    beyanname: { kv: Rule<number>; kdv: Rule<number>; muhtasar: Rule<number>; mphb: Rule<number>; yillikGv: Rule<number> };
    gecici: Rule<number>;
    mali: { bilanco: Rule<number>; gelirTablosu: Rule<number> };
  };
  vuk: { dogrudanGider: Rule<number> };
  /** Beyanname ve ödeme günleri (izleyen ayın günü; SGK ayın son günü) */
  takvim: Rule<{ kdv1: number; kdv2: number; mphb: number; sgk: "son" }>;
  /** Enflasyon düzeltmesi yapılmayan yıllar */
  enflasyon: Rule<readonly number[]>;
  bilgi: readonly InfoRule[];
}

/** Kural tablosunun derlendiği gün (K6) */
export const RULES_COMPILED_AT = "2026-10-24";
/** Resmî metinlerle karşılaştırıldığı gün; karşılaştırılınca doldurulur (§14 sonu) */
export const RULES_VERIFIED_AT: string | null = null;
export const RULES_CHECK_NOTE =
  "Değerler resmî kaynakların ve vergi bültenlerinin özetlerinden derlendi; resmî metinlerin kendisi henüz karşılaştırılmadı.";
/** Bu kadar günden eski tablo için bantta uyarı (§2.5) */
export const RULES_STALE_DAYS = 90;

export const TAX_RULES: Readonly<Record<number, TaxYearRules>> = { 2026: RULES_2026 };
/** Tablosu olan en son yıl */
export const RULES_LATEST_YEAR = Math.max(...Object.keys(TAX_RULES).map(Number));

/** Elle değer: saklanan kayıt (tax.settings › overrides) ya da testteki yalın değer */
export type TaxOverrideValue = number | boolean | { value: number | boolean; note?: string | null; by?: string | null; date?: string | null };
export type TaxOverrides = Readonly<Record<string, TaxOverrideValue>>;

export interface RulesFor {
  rules: TaxYearRules;
  /** İstenen yıl */
  year: number;
  /** Değerlerin alındığı yıl */
  fromYear: number;
  /** İstenen yılın tablosu yok: en son bilinen yılın değerleri ("tahmini (2026 kuralları)") */
  estimated: boolean;
}

/** Yalnız tahmini yılda elle değiştirilebilen kurallar (§2.4): bilinen yılın maktu tutarı resmîdir */
const ESTIMATED_ONLY = /^damga\.(beyanname|mali)\./;

/** Kuralı yolundan bulur ("damga.beyanname.kv"); yoksa null */
export function findRule(rules: TaxYearRules, key: string): Rule | null {
  let cur: unknown = rules;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return isRule(cur) ? cur : null;
}

function isRule(x: unknown): x is Rule {
  return x !== null && typeof x === "object" && !Array.isArray(x) && "key" in x && "value" in x && "sources" in x;
}

/** Elle değer geçerli mi: kural elle değiştirilebilir, yılı uygun, sayı sonlu, ≥ 0 ve üst sınırın altında */
export function overrideAllowed(rule: Rule, value: unknown, estimated: boolean): boolean {
  if (!rule.overridable || (ESTIMATED_ONLY.test(rule.key) && !estimated)) return false;
  if (typeof value !== "number" || typeof rule.value !== "number") return false;
  return Number.isFinite(value) && value >= 0 && (rule.overrideMax === undefined || value <= rule.overrideMax + 1e-9);
}

/**
 * Yılın kuralları, elle değerler uygulanmış. Tablo yoksa en son bilinen yıl (`estimated`); bilinen ilk yıldan önceki
 * yıl için ilk yıl. Elle değiştirilemeyen ya da geçersiz elle değer yok sayılır.
 */
export function rulesFor(year: number, overrides?: TaxOverrides): RulesFor {
  const years = Object.keys(TAX_RULES)
    .map(Number)
    .sort((a, b) => a - b);
  const fromYear = TAX_RULES[year] ? year : ([...years].reverse().find((y) => y <= year) ?? years[0]);
  const estimated = fromYear !== year;
  const rules = structuredClone(TAX_RULES[fromYear]) as TaxYearRules;
  for (const [key, raw] of Object.entries(overrides ?? {})) {
    const rule = findRule(rules, key);
    const entry = typeof raw === "object" && raw !== null ? raw : { value: raw };
    if (!rule || !overrideAllowed(rule, entry.value, estimated)) continue;
    rule.override = { table: rule.value, note: entry.note ?? null, by: entry.by ?? null, date: entry.date ?? null };
    rule.value = entry.value;
  }
  return { rules, year, fromYear, estimated };
}

/** Tablodaki bütün kurallar sırasıyla (ekran, Excel ve testler); `bilgi` listesi hariç */
export function allRules(r: TaxYearRules): Rule[] {
  const out: Rule[] = [];
  const walk = (x: unknown) => {
    if (isRule(x)) {
      out.push(x);
      return;
    }
    if (x === null || typeof x !== "object" || Array.isArray(x)) return;
    for (const v of Object.values(x)) walk(v);
  };
  for (const [k, v] of Object.entries(r)) if (k !== "year" && k !== "bilgi") walk(v);
  return out;
}

/** Kural tablosunun grupları ve ekrandaki başlıkları (Kurallar › Kural tablosu) */
export const RULE_GROUPS: { key: Exclude<keyof TaxYearRules, "year" | "bilgi">; title: string }[] = [
  { key: "kv", title: "Kurumlar vergisi" },
  { key: "gecici", title: "Geçici vergi" },
  { key: "ucret", title: "Ücretin gelir ve damga vergisi" },
  { key: "sgk", title: "SGK" },
  { key: "stopaj", title: "Stopaj" },
  { key: "kdv", title: "KDV (sorumlu sıfatıyla)" },
  { key: "damga", title: "Damga vergisi" },
  { key: "vuk", title: "Demirbaş" },
  { key: "takvim", title: "Vergi takvimi" },
  { key: "enflasyon", title: "Enflasyon düzeltmesi" },
];

const pctText = (x: number) => `%${(Math.round(x * 10_000) / 100).toLocaleString("tr-TR")}`;

/** Kuralın değeri ekrandaki gibi: "%25", "binde 7,59", "791,00 ₺"; karmaşık değer kendi metniyle */
export function ruleValueText(rule: Rule): string {
  if (rule.text && !rule.override) return rule.text;
  const v = rule.value;
  if (typeof v === "number") {
    if (rule.unit === "oran") return pctText(v);
    if (rule.unit === "binde") return `binde ${(Math.round(v * 100_000) / 100).toLocaleString("tr-TR")}`;
    if (rule.unit === "tl") return tl(v, 2);
    return v.toLocaleString("tr-TR");
  }
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (typeof v === "string") return v;
  return rule.text ?? "";
}

/** Elle değerin satırı (K8): "Elle: 820,00 ₺ (tablo: 791,00 ₺) · not · kim, ne zaman"; elle değer yoksa null */
export function overrideText(rule: Rule): string | null {
  if (!rule.override) return null;
  const table = ruleValueText({ ...rule, value: rule.override.table, override: undefined, text: undefined });
  const who = [rule.override.by, rule.override.date ? rule.override.date.split("-").reverse().join(".") : null].filter(Boolean).join(", ");
  return [`Elle: ${ruleValueText({ ...rule, text: undefined })} (tablo: ${table})`, rule.override.note, who].filter(Boolean).join(" · ");
}

/**
 * Üst banda eklenen bayatlama cümleleri (§2.5): tablo 90 günden eskiyse ve bakılan yılın tablosu yoksa. Tarih
 * kendiliğinden ilerlemez; yeni yıl yeni dosyayla gelir.
 */
export function rulesStaleNotes(today: string, years: readonly number[] = []): string[] {
  const notes: string[] = [];
  if (daysBetween(RULES_COMPILED_AT, today) > RULES_STALE_DAYS) notes.push("Kural tablosu 90 günden eski; yeni tutarlar açıklanmış olabilir.");
  for (const y of [...new Set(years)].sort((a, b) => a - b)) {
    const r = rulesFor(y);
    if (r.estimated) notes.push(`${y} kuralları tabloda yok; ${r.fromYear} değerleri kullanılıyor (tahmini).`);
  }
  return notes;
}

/** Bandın ikinci satırı: "Kurallar 24.10.2026'da derlendi; resmî metinlerle henüz karşılaştırılmadı · Türkiye 2026" */
export function rulesCompiledText(fromYear: number): string {
  const d = (x: string) => x.split("-").reverse().join(".");
  const checked = RULES_VERIFIED_AT ? `resmî metinlerle karşılaştırıldı: ${d(RULES_VERIFIED_AT)}` : "resmî metinlerle henüz karşılaştırılmadı";
  return `Kurallar ${d(RULES_COMPILED_AT)}'da derlendi; ${checked} · Türkiye ${fromYear}`;
}

// ---------------------------------------------------------------- Vergi belgesi ve stopaj (K12, K20)

/** Fatura dışı giderin vergi belgesi: Paraşüt'te faturası var, belgesi muhasebecide, belgesi yok, bordroda */
export type TaxDoc = "fatura" | "belgeli" | "yok" | "bordro";
export const TAX_DOCS: readonly TaxDoc[] = ["fatura", "belgeli", "yok", "bordro"];

export const TAX_DOC_LABELS: Record<TaxDoc, string> = {
  fatura: "Paraşüt'te faturası var (burada sayılmaz)",
  belgeli: "Belgesi muhasebecide (fiş, makbuz, serbest meslek makbuzu)",
  yok: "Belgesi yok: muhasebecinize sorun (vergiden düşülmez)",
  bordro: "Bordroda (Personel'e ekleyin)",
};
/** Personel bölümündeki `belgeli`: dışarıdan alınan hizmet (muhasebeci, temizlik firması) */
export const TAX_DOC_PERSONEL_BELGELI = "Dışarıdan hizmet: belgesi muhasebecide (fatura, SMM)";
export const TAX_DOC_NONE = "Seçilmedi";
/** "Part-time" adlı personel kaleminin altındaki not */
export const PART_TIME_NOTE = "Bordroya ekleyin; kısmi süreli SGK gün sayısıyla bildirilir.";

/** Bölümün seçenekleri sırasıyla (§4.2): personelde `yok` yok, `bordro` var; ötekilerde tersi */
export function taxDocOptions(section: FixedSection | "mal"): { value: TaxDoc | null; label: string }[] {
  if (section === "personel")
    return [
      { value: null, label: TAX_DOC_NONE },
      { value: "bordro", label: TAX_DOC_LABELS.bordro },
      { value: "fatura", label: "Paraşüt'te faturası var" },
      { value: "belgeli", label: TAX_DOC_PERSONEL_BELGELI },
    ];
  return [
    { value: null, label: TAX_DOC_NONE },
    { value: "fatura", label: TAX_DOC_LABELS.fatura },
    { value: "belgeli", label: TAX_DOC_LABELS.belgeli },
    { value: "yok", label: TAX_DOC_LABELS.yok },
  ];
}

/** Belge bölüme uygun mu: `bordro` yalnız personelde, `yok` personelde değil */
export function taxDocAllowed(doc: TaxDoc, section: FixedSection | "mal"): boolean {
  return section === "personel" ? doc !== "yok" : doc !== "bordro";
}

/** Sabit giderin stopaj profili (K20): ödenen tutar brüt kabul edilir */
export type Withholding = "yok" | "kira" | "serbest_meslek" | "internet_reklam" | "internet_reklam_yurtdisi" | "yurt_disi_hizmet";
export const WITHHOLDINGS: readonly Withholding[] = ["yok", "kira", "serbest_meslek", "internet_reklam", "internet_reklam_yurtdisi", "yurt_disi_hizmet"];

export const WITHHOLDING_LABELS: Record<Withholding, string> = {
  yok: "Stopaj yok (Türkiye'deki bir şirkete)",
  kira: "Şahsa işyeri kirası (%20)",
  serbest_meslek: "Serbest meslek makbuzu (%20)",
  internet_reklam: "İnternet reklamı: şahsa (%15)",
  internet_reklam_yurtdisi: "İnternet reklamı: doğrudan yurt dışına (%15 + KDV-2 %20)",
  yurt_disi_hizmet: "Yurt dışı hizmet (KDV-2 %20)",
};
/** "Şahsa işyeri kirası" seçilince faturadaki KDV'nin kaldırılması (§4.2) */
export const VAT_TO_ZERO_LABEL = "Faturadaki KDV'yi 'KDV yok' yap (şahıs kirasında KDV olmaz)";
/** Tutar ipucu (§3.5) */
export const WITHHOLDING_GROSS_HINT = "Tutar brüt olmalı; elinize geçen tutarı yazdıysanız brüt = net ÷ 0,80.";

/** Profilin gelir vergisi stopajı oranı (muhtasarda) */
export function withholdingRate(w: Withholding | null | undefined, rules: TaxYearRules): number {
  switch (w) {
    case "kira":
      return rules.stopaj.kira.value;
    case "serbest_meslek":
      return rules.stopaj.serbestMeslek.value;
    case "internet_reklam":
    case "internet_reklam_yurtdisi":
      return rules.stopaj.internetReklam.value;
    default:
      return 0;
  }
}

/** Profilin sorumlu sıfatıyla KDV'si (2 No.lu beyanname) oranı */
export function withholdingKdv2(w: Withholding | null | undefined, rules: TaxYearRules): number {
  return w === "internet_reklam_yurtdisi" || w === "yurt_disi_hizmet" ? rules.kdv.sorumluYurtDisi.value : 0;
}

// ---------------------------------------------------------------- Metinler ve yuvarlama

/** Üst bant (K27, §4.0) */
export const TAX_DISCLAIMER =
  "Bu sayfadaki rakamlar tahmindir, beyanname değildir. Kesin tutar muhasebecinizin beyannamesinde ve tahakkuk fişindedir; girdiğinizde tahminin yerine geçer.";
export const TAX_DISCLAIMER_SHORT = "Tahmin, beyanname değil";

/** Kuruşa yuvarlama, yarım yukarı; kayan nokta 4.211,325'i 4.211,32'ye düşürmesin (§3.4) */
export function r2(x: number): number {
  const r = Math.round(x * 100 + 1e-6 * Math.sign(x)) / 100;
  return r === 0 ? 0 : r;
}

/** Tahminin başlıktaki yuvarlaması (K27): 1.000 ₺ ve üstü en yakın 100 ₺'ye, altı 1 ₺'ye */
export function estimateRound(x: number): number {
  const r = Math.abs(x) >= 1000 ? Math.sign(x) * Math.floor(Math.abs(x) / 100 + 0.5) * 100 : Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
  return r === 0 ? 0 : r;
}

/** "≈ 68.900 ₺" (K27) */
export function formatEstimate(x: number): string {
  return `≈ ${tl(estimateRound(x))}`;
}
