import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { compareBranchesIn } from "@/lib/branch-view";
import { branchDaySummary, type BranchDaySource, type BranchDaySummary } from "@/lib/branch-day";
import { businessDate } from "@/lib/cash-report";
import { posZSchema } from "@/lib/asilpos/day";
import { foyZ } from "@/lib/modpos/z";
import { addDays } from "@/lib/reminders";
import { requireCan } from "@/server/auth/dal";
import { areaScope, branchWhere, staffBranchLock, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { modposFallbackSheets, modposTillRow } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";
import { earliestSwitchDay, isCountedPosDay } from "@/lib/pos/tills";
import { loadSwitchDays } from "@/server/pos/tills";

/**
 * Bugün › "Şubelerde gün" kartının verisi (src/lib/branch-day.ts, docs/BUGUN.md). Yönetici ve müdür: tutar, ödeme ve kasa
 * farkı taşır. Şubeleri yan yana alanının kipiyle (şube ayrımı parça 6): "Tümü"de ve "Yan yana" kipinde bütün açık
 * fiziksel şubeler, "Yalnız seçili şube" kipinde (yöneticinin varsayılanı) yalnız seçili şube; müdürde hep kendi şubesi.
 * Kayıtlar alanın kapsamıyla okunur. Okunan aralık: dün ve bugün ile bir hafta öncesi (8 gün).
 * AsilPOS gün sonu yalnız geçiş gününden itibaren sayılır (deneme günleri hiçbir hesaba girmez; tillRows ile aynı).
 * Kapanmış ModPOS föyü, ay rakamına yedek açıkken ve yalnız ModPOS günlerinde, üçüncü kaynaktır (tillRows ile aynı kural,
 * modposTillRow): Genel bakış'ın günlük grafiği o günü sayarken kartın çizgisi eksik göstermesin (denetim 13 Kasım HM-09).
 */
export async function loadBranchDay(now: Date = new Date()): Promise<BranchDaySummary | null> {
  await requireCan("rapor.sube");
  const db = getDb();
  const today = businessDate(now);
  const from = addDays(today, -8);
  // Şubeleri yan yana alanı: "Yan yana" kipinde "Tümü", "Yalnız seçili şube" kipinde seçim (müdürde hep kendi şubesi)
  // şube-ayrımı: alan.karsilastirma
  const [all, switchDays, lock, compareScope] = await Promise.all([listBranches(db), loadSwitchDays(db), staffBranchLock(), areaScope("karsilastirma")]);
  // Çok şube (R1): her kasanın günü kendi geçiş gününden itibaren; kasası ModPOS olan şubenin deneme günü ciro sayılmaz
  const switchDay = earliestSwitchDay(switchDays);
  // Müdür yalnız kendi şubesinin satırını görür (docs/ROLLER.md); kayıtlar aşağıda alanın kapsamıyla okunur, kart yalnız
  // bu şubelerin satırını kurar
  const branches = compareBranchesIn(
    all.filter((b) => b.active && b.kind === "fiziksel" && (lock === null || b.id === lock)),
    compareScope,
  );
  if (!branches.length) return null;

  const asilposFrom = switchDay === null || switchDay > today ? null : switchDay > from ? switchDay : from;
  const [reports, posDays, sheets] = await Promise.all([
    db
      .select({
        branchId: s.cashReports.branchId,
        date: s.cashReports.date,
        zTotal: s.cashReports.zTotal,
        offRevenue: s.cashReports.offRevenue,
        cash: s.cashReports.cash,
        card: s.cashReports.card,
        mealCard: s.cashReports.mealCard,
        online: s.cashReports.online,
        other: s.cashReports.other,
        receipts: s.cashReports.receipts,
        cashDiff: s.cashReports.cashDiff,
      })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, today), branchWhere(s.cashReports.branchId, compareScope))),
    asilposFrom === null
      ? Promise.resolve([])
      : db
          .select({ branchId: s.posDayReports.branchId, date: s.posDayReports.date, z: s.posDayReports.z })
          .from(s.posDayReports)
          .where(and(gte(s.posDayReports.date, asilposFrom), lte(s.posDayReports.date, today), branchWhere(s.posDayReports.branchId, compareScope)))
          .then((rows) => rows.filter((r) => isCountedPosDay(switchDays, r.branchId, r.date))),
    // Alanın kapsamındaki şubelerin föyleri; anahtar kapalıyken föy tablosu okunmaz
    withBranchScope(compareScope, () => modposFallbackSheets(db, from, today)),
  ]);

  const sources: BranchDaySource[] = [
    ...reports.map((r): BranchDaySource => ({ ...r, source: "rapor" })),
    ...posDays.flatMap((r): BranchDaySource[] => {
      const z = posZSchema.safeParse(r.z);
      if (!z.success) return [];
      const d = z.data;
      return [
        {
          branchId: r.branchId,
          date: r.date,
          source: "asilpos",
          zTotal: d.zTotal,
          offRevenue: d.offRevenue,
          cash: d.cash,
          card: d.card,
          mealCard: d.mealCard,
          online: d.online,
          other: d.other,
          receipts: d.receipts,
          cashDiff: d.cashDiff,
        },
      ];
    }),
    // Föyün sayılan günü (ay rakamıyla aynı kural); satışsız gün gün sonu sayılmaz. Föyün kasa farkı karta yazılmaz
    ...sheets.flatMap((sh): BranchDaySource[] => {
      const row = modposTillRow(sh);
      const z = row && row.zTotal > 0 ? foyZ(sh.foy) : null;
      if (!z) return [];
      return [
        {
          branchId: sh.branchId,
          date: sh.day,
          source: "modpos",
          zTotal: z.zTotal,
          offRevenue: z.offRevenue,
          cash: z.cash,
          card: z.card,
          mealCard: z.mealCard,
          online: z.online,
          other: z.other,
          receipts: z.receipts,
          cashDiff: null,
        },
      ];
    }),
  ];
  // Kartın şubeleri dışındaki kayıt hesaba hiç girmez (müdürde öteki şubeler)
  const shown = new Set(branches.map((b) => b.id));
  const summary = branchDaySummary(
    branches.map((b) => ({ id: b.id, name: b.name, openedOn: b.openedOn })),
    sources.filter((x) => shown.has(x.branchId)),
    today,
  );
  // Hiçbir şubenin gün sonu yoksa ve geçen hafta da veri yoksa kart çizilmez (kasa hiç kullanılmamış)
  if (!summary.rows.some((r) => r.revenue !== null || r.lastWeek !== null)) return null;
  return summary;
}
