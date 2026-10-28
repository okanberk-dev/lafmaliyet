import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { activeFromRange } from "@/lib/calc/engine";
import { paidWithholdingRate } from "@/lib/tax/rules";
import { schema as s, type DB } from "@/server/db";

/**
 * Ödemeler'in sabit gider verisi (denetim E-46, E-62): bütün sabit giderler, sürümleri ve her ay girilen harcama
 * kategorilerinin adları; "Sabit giderlerden ekle"
 * adayları bitiş ayına göre süzülür (saklı `active` sütunu bayatlayabilir: aylık girişe çevirme ya da ileri tarihli bitiş
 * ayı onu güncellemez). Bütün kalemler ve sürümler hatırlatıcı tutarının sabit giderle karşılaştırılmasına gider
 * (src/lib/cash-plan.ts fixedReminderDrifts). Stopajlı kalemin (Vergi › sınıflandırma) `withholdingRate`'i bu yılın
 * kuralından: hatırlatıcının tutarı bankadan çıkan nettir, stopaj muhtasarda (docs/VERGI.md).
 */
export async function loadFixedForReminders(db: DB, currentMonth: string) {
  const [rows, versions, monthly] = await Promise.all([
    db
      .select({
        id: s.fixedExpenses.id,
        name: s.fixedExpenses.name,
        amount: s.fixedExpenses.amount,
        period: s.fixedExpenses.period,
        section: s.fixedExpenses.section,
        vatRate: s.fixedExpenses.vatRate,
        taxWithholding: s.fixedExpenses.taxWithholding,
        startMonth: s.fixedExpenses.startMonth,
        endMonth: s.fixedExpenses.endMonth,
      })
      .from(s.fixedExpenses)
      .orderBy(asc(s.fixedExpenses.sortOrder), asc(s.fixedExpenses.id))
      .then((xs) => xs.map((x) => ({ ...x, withholdingRate: paidWithholdingRate(x.taxWithholding, Number(currentMonth.slice(0, 4))) }))),
    db
      .select({ fixedExpenseId: s.fixedExpenseVersions.fixedExpenseId, fromMonth: s.fixedExpenseVersions.fromMonth, period: s.fixedExpenseVersions.period, amount: s.fixedExpenseVersions.amount })
      .from(s.fixedExpenseVersions),
    db
      .select({ name: s.expenseCategories.name })
      .from(s.expenseCategories)
      .where(and(eq(s.expenseCategories.monthly, true), eq(s.expenseCategories.active, true))),
  ]);
  return {
    all: rows,
    /** "Sabit giderlerden ekle" adayları: bitmemiş (bitiş ayı yok ya da bu ay ve sonrası) kalemler, Giderler'deki kuralla */
    candidates: rows.filter((r) => activeFromRange(r.endMonth, currentMonth)),
    versions,
    /** Her ay girilen harcama kategorileri: aylık girişe çevrilmiş gider "bitti" diye uyarılmaz (fixedReminderDrifts) */
    monthlyExpenseNames: monthly.map((c) => c.name),
  };
}
