/**
 * Vergi ayarları (`integration_state` › `tax.settings`; plan docs/planlar/vergi.md §5): hesap dönemi, şirketin kuruluşu,
 * amortisman dağıtımı, muhtasar dönemi, asgari ücret desteği, kafe dışı faturalar, devreden zarar, Gelir-gider'in elle
 * satırlarının vergi belgesi, elle değerler ve muhasebeciye sorulanların işaretleri. Migration gerektirmez. Bozuk ya da
 * eksik alan varsayılana düşer, bilinmeyen anahtar ve geçersiz değer atılır. Saf modül.
 */

import { MANUAL_PNL_ROWS } from "../constants";

import { type AccountantCheckKey, isAccountantCheckKey } from "./checks";
import { findRule, overrideAllowed, RULES_LATEST_YEAR, type TaxDoc, TAX_DOCS, TAX_RULES, taxDocAllowed } from "./rules";

export const TAX_SETTINGS_KEY = "tax.settings";

/** Vergi levhasındaki işe başlama günü (K9; laffogato src/lib/legal/entity.ts startedAt) */
export const DEFAULT_PERIOD_START = "2026-06-25";

export interface TaxOverrideEntry {
  value: number | boolean;
  note: string;
  by: string;
  date: string;
}

export interface TaxCheckMark {
  by: string;
  date: string;
  note: string | null;
}

export interface TaxSettings {
  /** Hesap döneminin başı (YYYY-MM-DD): ilk dönem bu günden yıl sonuna (kıst) */
  periodStart: string;
  /** İlk defa faaliyete başladı / birleşme, devir, bölünme ya da tür değişikliği; null = sorulmadı (K10) */
  firstActivity: "ilk" | "devir" | null;
  /** Geçici vergide amortisman: kalan çeyreklere eşit ya da kümülatif ay ÷ 12 (K14) */
  quarterDepreciation: "kalan" | "ay12";
  /** Muhtasarın vergi kısmı üç ayda bir (K20) */
  muhtasarQuarterly: boolean;
  /** Asgari ücret desteği SGK'dan düşülsün (şartlı) */
  minWageSupport: boolean;
  /** Kafe dışı faturalar vergi hesabına katılsın (K3) */
  includeSeparate: boolean;
  /** Önceki yıllardan devreden zarar (elle; o yılın kurumlar vergisi kaydı varsa o) */
  carriedLoss: { amount: number; note: string; by: string; date: string } | null;
  /** Gelir-gider'in elle satırlarının vergi belgesi ("manual:su" …); POS komisyonu burada yok (K12a) */
  manualRows: Record<string, TaxDoc>;
  /** Elle değerler (K8): yalnız elle değiştirilebilen kurallar */
  overrides: Record<string, TaxOverrideEntry>;
  /** "Muhasebecimle konuştum" işaretleri */
  checks: Partial<Record<AccountantCheckKey, TaxCheckMark>>;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  periodStart: DEFAULT_PERIOD_START,
  firstActivity: null,
  quarterDepreciation: "kalan",
  muhtasarQuarterly: false,
  minWageSupport: false,
  includeSeparate: false,
  carriedLoss: null,
  manualRows: {},
  overrides: {},
  checks: {},
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/**
 * Elle değer saklanabilir mi: kural elle değiştirilebilir ve değer uygun. Damga tutarları yalnız tahmini yılda uygulanır
 * (rulesFor), saklanırken tahmini yıl gibi denetlenir
 */
function overrideKeyValid(key: string, value: unknown): boolean {
  const rule = findRule(TAX_RULES[RULES_LATEST_YEAR], key);
  return rule !== null && overrideAllowed(rule, value, true);
}

/** integration_state'ten okunan değer; bozuk alanlar varsayılana düşer */
export function parseTaxSettings(v: unknown): TaxSettings {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_TAX_SETTINGS;
  const periodStart = isDay(o.periodStart) && o.periodStart >= "2000-01-01" ? o.periodStart : d.periodStart;
  const firstActivity = o.firstActivity === "ilk" || o.firstActivity === "devir" ? o.firstActivity : null;
  const quarterDepreciation = o.quarterDepreciation === "ay12" ? "ay12" : "kalan";
  const bool = (x: unknown, fallback: boolean) => (typeof x === "boolean" ? x : fallback);

  let carriedLoss: TaxSettings["carriedLoss"] = null;
  if (isObj(o.carriedLoss) && typeof o.carriedLoss.amount === "number" && Number.isFinite(o.carriedLoss.amount) && o.carriedLoss.amount >= 0) {
    carriedLoss = { amount: o.carriedLoss.amount, note: str(o.carriedLoss.note), by: str(o.carriedLoss.by), date: str(o.carriedLoss.date) };
  }

  const manualRows: Record<string, TaxDoc> = {};
  if (isObj(o.manualRows)) {
    for (const [key, doc] of Object.entries(o.manualRows)) {
      const row = MANUAL_PNL_ROWS.find((r) => r.key === key);
      if (row && typeof doc === "string" && (TAX_DOCS as readonly string[]).includes(doc) && taxDocAllowed(doc as TaxDoc, row.section)) manualRows[key] = doc as TaxDoc;
    }
  }

  const overrides: Record<string, TaxOverrideEntry> = {};
  if (isObj(o.overrides)) {
    for (const [key, e] of Object.entries(o.overrides)) {
      if (!isObj(e) || !overrideKeyValid(key, e.value)) continue;
      overrides[key] = { value: e.value as number, note: str(e.note), by: str(e.by), date: str(e.date) };
    }
  }

  const checks: TaxSettings["checks"] = {};
  if (isObj(o.checks)) {
    for (const [key, e] of Object.entries(o.checks)) {
      if (!isAccountantCheckKey(key) || !isObj(e)) continue;
      checks[key] = { by: str(e.by), date: str(e.date), note: typeof e.note === "string" && e.note.trim() ? e.note : null };
    }
  }

  return {
    periodStart,
    firstActivity,
    quarterDepreciation,
    muhtasarQuarterly: bool(o.muhtasarQuarterly, d.muhtasarQuarterly),
    minWageSupport: bool(o.minWageSupport, d.minWageSupport),
    includeSeparate: bool(o.includeSeparate, d.includeSeparate),
    carriedLoss,
    manualRows,
    overrides,
    checks,
  };
}
