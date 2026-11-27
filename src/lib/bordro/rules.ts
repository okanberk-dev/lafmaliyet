/**
 * Bordronun ve stopajın yasal kuralları (eski Vergi bölümünün kural tablosundan kalan kısım; Vergi bölümü 27 Kasım
 * 2026'da kaldırıldı, vergiyi muhasebeci yürütüyor). Nakit planının maaş ve SGK satırı (src/lib/bordro/payroll.ts) ve
 * sabit giderin ödemeden kesilen stopajı (src/lib/bordro/stopaj.ts), Gelir-gider'in "Kira stopajı" maliyeti
 * (src/lib/calc/engine.ts rentWithholdingRate) bu değerleri kullanır. Değerler yıl anahtarlı, dayanaklı ve kaynaklı;
 * yıl dosyasında (rules-2026.ts). Yılın tablosu yoksa en son bilinen yılın değerleri kullanılır ("tahmini"), oran
 * uydurulmaz. Yalnız `overridable` kural (SGK işveren payı) saklı ayardan elle değişir. Saf modül; tests/bordro.test.ts.
 */

import { RULES_2026 } from "./rules-2026";

export type Confidence = "kesin" | "muhtemel" | "belirsiz";

/** Kaynak bağlantısı: kısa ad ("GİB · Gelir vergisi tarifesi 2026") ve https adresi; resmî olan önce */
export interface RuleSource {
  label: string;
  url: string;
}

export interface Rule<T = unknown> {
  /** "sgk.isverenOran": tablodaki yeri (PayrollYearRules'ta aynı yol) */
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
  /** Saklı ayardan elle değiştirilebilir (yalnız SGK işveren payı) */
  overridable?: boolean;
  /** Elle değerin üst sınırı (sgk.isverenOran: indirimsiz yasal oran) */
  overrideMax?: number;
  /** Elle değer uygulandıysa tablodaki değer (rulesFor doldurur) */
  override?: { table: T };
}

/** Gelir vergisi tarifesinin dilimi: `upTo`'ya kadar `rate`; son dilimde null (üstü) */
export interface Bracket {
  upTo: number | null;
  rate: number;
}

export interface PayrollYearRules {
  year: number;
  ucret: {
    asgariBrut: Rule<number>;
    tarife: Rule<readonly Bracket[]>;
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
}

/** Kural tablosunun derlendiği gün */
export const RULES_COMPILED_AT = "2026-10-24";

export const PAYROLL_RULES: Readonly<Record<number, PayrollYearRules>> = { 2026: RULES_2026 };
/** Tablosu olan en son yıl */
export const RULES_LATEST_YEAR = Math.max(...Object.keys(PAYROLL_RULES).map(Number));

/** Elle değer: saklanan kayıt (tax.settings › overrides) ya da testteki yalın değer */
export type RuleOverrideValue = number | { value: number };
export type RuleOverrides = Readonly<Record<string, RuleOverrideValue>>;

export interface RulesFor {
  rules: PayrollYearRules;
  /** İstenen yıl */
  year: number;
  /** Değerlerin alındığı yıl */
  fromYear: number;
  /** İstenen yılın tablosu yok: en son bilinen yılın değerleri */
  estimated: boolean;
}

/** Kuralı yolundan bulur ("sgk.isverenOran"); yoksa null */
export function findRule(rules: PayrollYearRules, key: string): Rule | null {
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

/** Elle değer geçerli mi: kural elle değiştirilebilir, sayı sonlu, ≥ 0 ve üst sınırın altında */
export function overrideAllowed(rule: Rule, value: unknown): boolean {
  if (!rule.overridable || typeof value !== "number" || typeof rule.value !== "number") return false;
  return Number.isFinite(value) && value >= 0 && (rule.overrideMax === undefined || value <= rule.overrideMax + 1e-9);
}

/**
 * Yılın kuralları, elle değerler uygulanmış. Tablo yoksa en son bilinen yıl (`estimated`); bilinen ilk yıldan önceki
 * yıl için ilk yıl. Elle değiştirilemeyen ya da geçersiz elle değer yok sayılır.
 */
export function rulesFor(year: number, overrides?: RuleOverrides): RulesFor {
  const years = Object.keys(PAYROLL_RULES)
    .map(Number)
    .sort((a, b) => a - b);
  const fromYear = PAYROLL_RULES[year] ? year : ([...years].reverse().find((y) => y <= year) ?? years[0]);
  const rules = structuredClone(PAYROLL_RULES[fromYear]) as PayrollYearRules;
  for (const [key, raw] of Object.entries(overrides ?? {})) {
    const rule = findRule(rules, key);
    const value = typeof raw === "object" && raw !== null ? raw.value : raw;
    if (!rule || !overrideAllowed(rule, value)) continue;
    rule.override = { table: rule.value };
    rule.value = value;
  }
  return { rules, year, fromYear, estimated: fromYear !== year };
}

/** Tablodaki bütün kurallar sırasıyla (testler) */
export function allRules(r: PayrollYearRules): Rule[] {
  const out: Rule[] = [];
  const walk = (x: unknown) => {
    if (isRule(x)) {
      out.push(x);
      return;
    }
    if (x === null || typeof x !== "object" || Array.isArray(x)) return;
    for (const v of Object.values(x)) walk(v);
  };
  for (const [k, v] of Object.entries(r)) if (k !== "year") walk(v);
  return out;
}

/** Kuruşa yuvarlama, yarım yukarı; kayan nokta 4.211,325'i 4.211,32'ye düşürmesin */
export function r2(x: number): number {
  const r = Math.round(x * 100 + 1e-6 * Math.sign(x)) / 100;
  return r === 0 ? 0 : r;
}
