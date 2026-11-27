import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { activeFromRange } from "@/lib/calc/engine";
import { paidFixedRatesOf } from "@/lib/cash-plan";
import { schema as s, type DB } from "@/server/db";

/**
 * Ödemeler'in sabit gider verisi (denetim E-46, E-62): bütün sabit giderler, sürümleri ve her ay girilen harcama
 * kategorilerinin adları; "Sabit giderlerden ekle"
 * adayları bitiş ayına göre süzülür (saklı `active` sütunu bayatlayabilir: aylık girişe çevirme ya da ileri tarihli bitiş
 * ayı onu güncellemez). Bütün kalemler ve sürümler hatırlatıcı tutarının sabit giderle karşılaştırılmasına gider
 * (src/lib/cash-plan.ts fixedReminderDrifts). Stopajlı kalemin (saklı stopaj profili) `withholdingRate`'i bu yılın
 * kuralından: hatırlatıcının tutarı bankadan çıkan nettir (stopajı muhasebeci muhtasarla öder); yurt dışı hizmette KDV
 * oranı 0; kira kaleminde ev sahibi türü KDV'yi ve stopajı belirler (paidFixedRatesOf, nakit planıyla aynı kural). `scope`: "Sabit giderlerden ekle" adayları tek şube seçiliyken o şubenin ve işletme genelinin kalemleri
 * (şube kapsamı C P1-3; öbür şubenin kirası Marina'nın ödemelerine önerilmez); tutar karşılaştırması bütün kalemlerle.
 */
export async function loadFixedForReminders(db: DB, currentMonth: string, scope: BranchScope = ALL_BRANCHES) {
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
        officialAmount: s.fixedExpenses.officialAmount,
        officialBasis: s.fixedExpenses.officialBasis,
        landlordType: s.fixedExpenses.landlordType,
        startMonth: s.fixedExpenses.startMonth,
        endMonth: s.fixedExpenses.endMonth,
        branchId: s.fixedExpenses.branchId,
      })
      .from(s.fixedExpenses)
      .orderBy(asc(s.fixedExpenses.sortOrder), asc(s.fixedExpenses.id))
      .then((xs) => xs.map((x) => paidFixedRatesOf(x, Number(currentMonth.slice(0, 4))))),
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
    candidates: rows.filter((r) => activeFromRange(r.endMonth, currentMonth) && (scope === ALL_BRANCHES || r.branchId === null || r.branchId === scope)),
    versions,
    /** Her ay girilen harcama kategorileri: aylık girişe çevrilmiş gider "bitti" diye uyarılmaz (fixedReminderDrifts) */
    monthlyExpenseNames: monthly.map((c) => c.name),
  };
}
