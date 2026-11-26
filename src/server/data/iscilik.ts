import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { ALL_BRANCHES, tillBranches } from "@/lib/branches";
import { isPartTime, staffShiftRef } from "@/lib/calc/engine";
import { businessDate } from "@/lib/cash-report";
import {
  dailyRows,
  dayRange,
  laborDays,
  missingWages,
  sumDays,
  weekStart,
  weeklyRows,
  type LaborBranchInput,
  type LaborDay,
  type LaborPerson,
  type LaborRow,
  type MissingWage,
} from "@/lib/iscilik";
import { cellReader } from "@/lib/kiyas";
import { lafposBranchOf } from "@/lib/lafpos/switch";
import { addDays, shiftMonth } from "@/lib/reminders";
import { requireCan } from "@/server/auth/dal";
import { staffBranchLock, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { closedDaysBetween } from "@/server/closed-days";
import { tillRows } from "@/server/data/cash-reports";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

/** Bir şubenin (ya da Tümü'nün) raporu */
export interface LaborBranchReport {
  id: string;
  name: string;
  /** Gelir-gider'in ayı: personel (işveren maliyeti) ve ciro (KDV hariç); cirosu girilmediyse null */
  month: { labor: number; revenue: number | null; ratio: number | null };
  /** Ayın günleri (yalnız seçilen ay, bugüne kadar) ve haftaları (pazartesiden pazara, ayın dışına taşan günlerle) */
  days: LaborRow[];
  weeks: LaborRow[];
  /** Günlerin işçilik toplamı (seçilen ay); Gelir-gider'in personelinden 1 ₺'den çok ayrılıyorsa ekranda not */
  daysLabor: number;
}

export interface LaborReport {
  month: string;
  /** Süren ayda bugün (iş günü); geçmiş ayda ayın son günü */
  through: string;
  branches: LaborBranchReport[];
  /** Birden çok şubede: şubelerin toplamı */
  total: LaborBranchReport | null;
  missing: (MissingWage & { branch: string })[];
}

/**
 * İşçilik / ciro raporu (docs/RAPORLAR.md › İşçilik / ciro; hesap src/lib/iscilik.ts). Yalnız yönetici; soldaki seçiciden
 * bağımsız, açık fiziksel şubeler kendi görünümüyle (Gelir-gider'in şube hesabı: kişiler o şubenin, o ayın maaşıyla;
 * part-time'ın çalıştığı günler Vardiya'dan). Günün cirosu kasa satırından (Kıyas'ın hücresi). Açık şube yoksa null.
 */
export async function loadLaborReport(month: string, now: Date = new Date()): Promise<LaborReport | null> {
  // Yönetici ve müdür; müdürde yalnız kendi şubesi (kilit oturumdan; withBranchScope("hepsi") da şubesine daralır)
  await requireCan("rapor.sube");
  const lock = await staffBranchLock();
  const db = getDb();
  const today = businessDate(now);
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const through = monthEnd < today ? monthEnd : today;
  // Haftalar tam: ayın ilk gününün pazartesisinden son haftanın pazarına (bugünü geçmeden)
  const from = weekStart(`${month}-01`);
  const lastSunday = addDays(weekStart(monthEnd), 6);
  const to = lastSunday < today ? lastSunday : today;
  if (`${month}-01` > today) return null;

  const all = await listBranches(db);
  const branches = tillBranches(all).filter((b) => lock === null || b.id === lock);
  if (!branches.length) return null;
  const range = dayRange(from, to);
  const months = [...new Set(range.map((d) => d.slice(0, 7)))];

  const [models, rows, switchDay, reports, closed] = await Promise.all([
    Promise.all(branches.map((b) => loadModel({ scope: b.id }))),
    withBranchScope(ALL_BRANCHES, () => tillRows(db)),
    loadLafposSwitchDay(db),
    db
      .select({ branchId: s.cashReports.branchId, date: s.cashReports.date, receipts: s.cashReports.receipts })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to))),
    Promise.all(branches.map(async (b) => [b.id, new Set(await closedDaysBetween(from, to, db, b.id))] as const)),
  ]);
  const closedBy = new Map(closed);
  const read = cellReader({
    rows: rows.filter((r) => r.date >= from && r.date <= to),
    branches: branches.map((b) => ({ id: b.id, name: b.name, openedOn: b.openedOn })),
    today,
    switchDay,
    lafposBranch: lafposBranchOf(all),
    receipts: new Map(reports.map((r) => [`${r.branchId}|${r.date}`, r.receipts])),
    isClosed: (branchId, date) => closedBy.get(branchId)?.has(date) ?? false,
  });

  const missing: LaborReport["missing"] = [];
  const perBranch: { b: (typeof branches)[number]; days: LaborDay[]; month: LaborBranchReport["month"] }[] = [];
  branches.forEach((b, i) => {
    const model = models[i];
    const st = model.settings;
    const shiftDays = new Map<string, string[]>();
    for (const d of model.ds.shifts ?? []) {
      if (d.branchId !== b.id) continue;
      const list = shiftDays.get(d.personRef) ?? [];
      list.push(d.date);
      shiftDays.set(d.personRef, list);
    }
    const people: Record<string, LaborPerson[]> = {};
    const netFactor: Record<string, number> = {};
    for (const m of months) {
      people[m] = model.personnelFor(m).rows.map((r): LaborPerson => {
        if (!isPartTime(r.staff)) return { name: r.staff.name, kind: "full_time", monthly: r.total, perDay: 0, workDays: null };
        const ref = staffShiftRef(r.staff);
        return {
          name: r.staff.name,
          kind: "part_time",
          monthly: r.staff.extras,
          perDay: (r.staff.dailyWage ?? 0) + (r.staff.mealCard ? st.mealCardDaily : 0),
          workDays: ref ? (shiftDays.get(ref) ?? []).filter((d) => d.startsWith(m)) : null,
        };
      });
      if (m === month) for (const x of missingWages(m, people[m])) missing.push({ ...x, branch: b.name });
      const c = model.pnlMonth(m);
      if (c.revenue && c.revenueNet !== null && c.revenue > 0) netFactor[m] = c.revenueNet / c.revenue;
    }
    const kiyasBranch = { id: b.id, name: b.name, openedOn: b.openedOn };
    const input: LaborBranchInput = {
      id: b.id,
      name: b.name,
      people,
      netFactor,
      kdv: st.kdv,
      sales: (date) => {
        const c = read(kiyasBranch, date);
        return c.kind === "satis" ? { kind: "satis", gross: c.revenue } : c;
      },
    };
    const c = model.pnlMonth(month);
    const revenue = c.revenueTotalNet;
    perBranch.push({
      b,
      days: laborDays(input, range),
      month: { labor: c.sections.personel, revenue, ratio: revenue ? c.sections.personel / revenue : null },
    });
  });

  const inMonth = (d: LaborDay) => d.date.startsWith(month) && d.date <= through;
  const report = (id: string, name: string, days: LaborDay[], m: LaborBranchReport["month"]): LaborBranchReport => {
    const monthDays = days.filter(inMonth);
    return {
      id,
      name,
      month: m,
      days: dailyRows(monthDays),
      weeks: weeklyRows(days),
      daysLabor: Math.round(monthDays.reduce((a, d) => a + d.labor, 0) * 100) / 100,
    };
  };
  const out = perBranch.map((x) => report(x.b.id, x.b.name, x.days, x.month));
  let total: LaborBranchReport | null = null;
  if (perBranch.length > 1) {
    const labor = perBranch.reduce((a, x) => a + x.month.labor, 0);
    // Bir şubenin cirosu girilmemişse toplamın cirosu da bilinmiyor (işçiliği sayılıp cirosu sayılmasaydı oran şişerdi)
    const revenue = perBranch.every((x) => x.month.revenue !== null) ? perBranch.reduce((a, x) => a + (x.month.revenue ?? 0), 0) : null;
    total = report(ALL_BRANCHES, "Şubelerin toplamı", sumDays(perBranch.map((x) => x.days)), { labor, revenue, ratio: revenue ? labor / revenue : null });
  }
  return { month, through, branches: out, total, missing };
}
