import "server-only";

import { asc } from "drizzle-orm";

import { activeFromRange } from "@/lib/calc/engine";
import { schema as s, type DB } from "@/server/db";

/**
 * Ödemeler'in sabit gider verisi (denetim E-46, E-62): bütün sabit giderler ve sürümleri; "Sabit giderlerden ekle"
 * adayları bitiş ayına göre süzülür (saklı `active` sütunu bayatlayabilir: aylık girişe çevirme ya da ileri tarihli bitiş
 * ayı onu güncellemez). Bütün kalemler ve sürümler hatırlatıcı tutarının sabit giderle karşılaştırılmasına gider
 * (src/lib/cash-plan.ts fixedReminderDrifts).
 */
export async function loadFixedForReminders(db: DB, currentMonth: string) {
  const [rows, versions] = await Promise.all([
    db
      .select({
        id: s.fixedExpenses.id,
        name: s.fixedExpenses.name,
        amount: s.fixedExpenses.amount,
        period: s.fixedExpenses.period,
        section: s.fixedExpenses.section,
        vatRate: s.fixedExpenses.vatRate,
        startMonth: s.fixedExpenses.startMonth,
        endMonth: s.fixedExpenses.endMonth,
      })
      .from(s.fixedExpenses)
      .orderBy(asc(s.fixedExpenses.sortOrder), asc(s.fixedExpenses.id)),
    db
      .select({ fixedExpenseId: s.fixedExpenseVersions.fixedExpenseId, fromMonth: s.fixedExpenseVersions.fromMonth, period: s.fixedExpenseVersions.period, amount: s.fixedExpenseVersions.amount })
      .from(s.fixedExpenseVersions),
  ]);
  return {
    all: rows,
    /** "Sabit giderlerden ekle" adayları: bitmemiş (bitiş ayı yok ya da bu ay ve sonrası) kalemler, Giderler'deki kuralla */
    candidates: rows.filter((r) => activeFromRange(r.endMonth, currentMonth)),
    versions,
  };
}
