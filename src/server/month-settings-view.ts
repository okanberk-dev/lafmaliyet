import "server-only";

import type { EffectiveMonths } from "@/app/panel/ayarlar/effective-picker";
import { currentMonthTR } from "@/lib/calc/engine";
import { changeMonthOptions } from "@/lib/month-settings";
import { loadClosedPeriods } from "@/server/closed-period";

/**
 * Ay bazlı ayar seçicisinin ayları (docs/AYARLAR.md): verinin ilk ayından bu aydan 12 ay sonrasına, kapalı aylarla
 * (Ayarlar, Maaşlar, Şubeler, Gelir-gider). `firstDataMonth`: modelin ilk ayı (yoksa bu ay)
 */
export async function loadEffectiveMonths(firstDataMonth: string | null): Promise<EffectiveMonths> {
  const current = currentMonthTR();
  const closed = Object.keys((await loadClosedPeriods()).months).sort();
  const first = [firstDataMonth, closed[0]].filter((m): m is string => Boolean(m)).sort()[0] ?? null;
  return { months: changeMonthOptions(first, current), current, closed };
}

/** Modelin ilk ayı: ay bilgisi ya da satış listesi olan en eski ay */
export function firstModelMonth(model: { monthInfo: ReadonlyMap<string, unknown>; salesMonths: readonly string[] }): string | null {
  return [...model.monthInfo.keys(), ...model.salesMonths].sort()[0] ?? null;
}
