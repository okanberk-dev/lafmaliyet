/**
 * Bordronun saklı ayarları: eski Vergi bölümünün ayar kaydından (`integration_state` › `tax.settings`) yalnız bordronun
 * okuduğu üç alan. Vergi bölümü 27 Kasım 2026'da kaldırıldı; kayıt silinmedi ve ekranı yok: değerler son girildiği gibi
 * okunur (yazan yok). Kayıt yoksa ya da alan bozuksa varsayılan. Saf modül; tests/bordro.test.ts.
 *
 * - `periodStart`: hesap döneminin başı (işe başlama günü); bordro bu aydan önce hesaplanmaz.
 * - `minWageSupport`: asgari ücret desteği SGK'dan düşülsün (şartlı).
 * - `overrides`: kural tablosunun elle değerleri; yalnız elle değiştirilebilen bordro kuralı (SGK işveren payı) okunur.
 */

import { findRule, overrideAllowed, PAYROLL_RULES, RULES_LATEST_YEAR } from "./rules";

/** Saklı kaydın anahtarı (eski Vergi ayarları; adı değişmedi, kayıt yerinde) */
export const PAYROLL_SETTINGS_KEY = "tax.settings";

/** Vergi levhasındaki işe başlama günü (laffogato src/lib/legal/entity.ts startedAt) */
export const DEFAULT_PERIOD_START = "2026-06-25";

export interface PayrollSettings {
  /** Hesap döneminin başı (YYYY-MM-DD) */
  periodStart: string;
  /** Asgari ücret desteği SGK'dan düşülsün (şartlı) */
  minWageSupport: boolean;
  /** Elle değerler: yalnız elle değiştirilebilen bordro kuralları ("sgk.isverenOran") */
  overrides: Record<string, { value: number }>;
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = { periodStart: DEFAULT_PERIOD_START, minWageSupport: false, overrides: {} };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** integration_state'ten okunan değer; bozuk alanlar varsayılana düşer, bordroya ait olmayan alanlar atılır */
export function parsePayrollSettings(v: unknown): PayrollSettings {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_PAYROLL_SETTINGS;
  const overrides: PayrollSettings["overrides"] = {};
  if (isObj(o.overrides)) {
    for (const [key, e] of Object.entries(o.overrides)) {
      if (!isObj(e)) continue;
      const rule = findRule(PAYROLL_RULES[RULES_LATEST_YEAR], key);
      if (rule && overrideAllowed(rule, e.value)) overrides[key] = { value: e.value as number };
    }
  }
  return {
    periodStart: isDay(o.periodStart) && o.periodStart >= "2000-01-01" ? o.periodStart : d.periodStart,
    minWageSupport: typeof o.minWageSupport === "boolean" ? o.minWageSupport : d.minWageSupport,
    overrides,
  };
}
