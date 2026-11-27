import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { ALL_BRANCHES, tillBranches } from "@/lib/branches";
import { compareBranchesIn } from "@/lib/branch-view";
import { isPartTime, staffShiftRef } from "@/lib/calc/engine";
import { businessDate } from "@/lib/cash-report";
import {
  dailyRows,
  dayRange,
  laborDays,
  laborRow,
  missingWages,
  sumDays,
  weekStart,
  weeklyRows,
  withoutDayWages,
  type LaborBranchInput,
  type LaborDay,
  type LaborPerson,
  type LaborRow,
  type MissingWage,
} from "@/lib/iscilik";
import { cellReader } from "@/lib/kiyas";
import { addDays, shiftMonth } from "@/lib/reminders";
import { can } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { areaScope, branchWhere, staffBranchLock, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { closedDaysBetween } from "@/server/closed-days";
import { tillRows } from "@/server/data/cash-reports";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";
import { loadSwitchDays } from "@/server/pos/tills";

/** Gelir-gider'in ayı: personel (işveren maliyeti, part-time'ın Vardiya'daki günleriyle) ve ciro (KDV hariç) */
type WageMonth = { labor: number; revenue: number | null; ratio: number | null };

/** Ekrandaki satır: işçilik tutarı (₺) yalnız kişisel ücreti görende (yönetici); müdürde null, oran kalır */
export type LaborRowShown = Omit<LaborRow, "labor"> & { labor: number | null };

/** Bir şubenin (ya da Tümü'nün) raporu */
export interface LaborBranchReport {
  id: string;
  name: string;
  /**
   * Yönetici: Gelir-gider'in ayı, personel (işveren maliyeti) ve ciro (KDV hariç); cirosu girilmediyse null. Müdür: ayın
   * günlerinin satırı (bugüne kadar, aylık ücretlerle), tutarı null
   */
  month: { labor: number | null; revenue: number | null; ratio: number | null };
  /** Ayın günleri (yalnız seçilen ay, bugüne kadar; müdürde boş) ve haftaları (pazartesiden pazara, ayın dışına taşan günlerle) */
  days: LaborRowShown[];
  weeks: LaborRowShown[];
  /** Günlerin işçilik toplamı (seçilen ay); Gelir-gider'in personelinden 1 ₺'den çok ayrılıyorsa ekranda not. Müdürde null */
  daysLabor: number | null;
}

export interface LaborReport {
  month: string;
  /**
   * Kişisel ücretli görünüm (`maas` yeteneği, yönetici): işçilik tutarı, günlük görünüm, part-time'ın Vardiya'daki günü.
   * Değilse (müdür; docs/ROLLER.md) part-time'ın günlük ücreti sayılmaz (`withoutDayWages`), tutar yok, yalnız oran
   */
  wages: boolean;
  /** Süren ayda bugün (iş günü); geçmiş ayda ayın son günü */
  through: string;
  branches: LaborBranchReport[];
  /** Birden çok şubede: şubelerin toplamı */
  total: LaborBranchReport | null;
  missing: (MissingWage & { branch: string })[];
}

/**
 * İşçilik / ciro raporu (docs/RAPORLAR.md › İşçilik / ciro; hesap src/lib/iscilik.ts). Yönetici ve müdür; Şubeleri yan
 * yana alanının kipiyle (şube ayrımı parça 6: "Yan yana" kipinde ve "Tümü"de açık fiziksel şubeler, "Yalnız seçili şube"
 * kipinde seçili şube; müdürde hep kendi şubesi), her şube kendi görünümüyle (Gelir-gider'in şube hesabı: kişiler o şubenin, o ayın
 * maaşıyla; part-time'ın çalıştığı günler Vardiya'dan). Günün cirosu kasa satırından (Kıyas'ın hücresi). Açık şube yoksa
 * null. Müdürün raporu kişisel ücretsiz (`wages` false): Vardiya'ya bağlı hiçbir rakam yok, tutar yok, günlük satır yok.
 */
export async function loadLaborReport(month: string, now: Date = new Date()): Promise<LaborReport | null> {
  // Yönetici ve müdür; müdürde yalnız kendi şubesi (kilit oturumdan; withBranchScope("hepsi") da şubesine daralır)
  const me = await requireCan("rapor.sube");
  // Kişisel ücret (Maaşlar'ın yeteneği) yalnız yöneticide: müdürün rakamları part-time'ın günlük ücretini taşımaz
  // (docs/ROLLER.md › Kararlar; kendi yazdığı Vardiya hücresinin öncesi ve sonrası o kişinin ücretini verirdi)
  const wages = can(me.role, "maas");
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

  // Şubeleri yan yana alanı: "Yan yana" kipinde "Tümü", "Yalnız seçili şube" kipinde seçim (müdürde kilit de daraltır)
  // şube-ayrımı: alan.karsilastirma
  const compareScope = await areaScope("karsilastirma");
  const all = await listBranches(db);
  const branches = compareBranchesIn(tillBranches(all), compareScope).filter((b) => lock === null || b.id === lock);
  if (!branches.length) return null;
  const range = dayRange(from, to);
  const months = [...new Set(range.map((d) => d.slice(0, 7)))];

  const [models, rows, switchDay, reports, closed] = await Promise.all([
    Promise.all(branches.map((b) => loadModel({ scope: b.id }))),
    withBranchScope(compareScope, () => tillRows(db)),
    loadSwitchDays(db),
    db
      .select({ branchId: s.cashReports.branchId, date: s.cashReports.date, receipts: s.cashReports.receipts })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to), branchWhere(s.cashReports.branchId, compareScope))),
    Promise.all(branches.map(async (b) => [b.id, new Set(await closedDaysBetween(from, to, db, b.id))] as const)),
  ]);
  const closedBy = new Map(closed);
  const read = cellReader({
    rows: rows.filter((r) => r.date >= from && r.date <= to),
    branches: branches.map((b) => ({ id: b.id, name: b.name, openedOn: b.openedOn })),
    today,
    switchDays: switchDay,
    receipts: new Map(reports.map((r) => [`${r.branchId}|${r.date}`, r.receipts])),
    isClosed: (branchId, date) => closedBy.get(branchId)?.has(date) ?? false,
  });

  const missing: LaborReport["missing"] = [];
  /** Şubenin günleri; ayı yalnız yöneticide Gelir-gider'den (müdürde null: ayın günlerinden) */
  const perBranch: { b: (typeof branches)[number]; days: LaborDay[]; month: WageMonth | null }[] = [];
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
      const list = model.personnelFor(m).rows.map((r): LaborPerson => {
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
      people[m] = wages ? list : withoutDayWages(list);
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
    // Gelir-gider'in personeli part-time'ın Vardiya'daki günleriyle: yalnız yöneticide
    const c = wages ? model.pnlMonth(month) : null;
    const revenue = c ? c.revenueTotalNet : null;
    perBranch.push({
      b,
      days: laborDays(input, range),
      month: c ? { labor: c.sections.personel, revenue, ratio: revenue ? c.sections.personel / revenue : null } : null,
    });
  });

  const inMonth = (d: LaborDay) => d.date.startsWith(month) && d.date <= through;
  /** `m` Gelir-gider'in ayı; yalnız yöneticide var (null: müdürün kişisel ücretsiz raporu) */
  const report = (id: string, name: string, days: LaborDay[], m: WageMonth | null): LaborBranchReport => {
    const monthDays = days.filter(inMonth);
    if (!m) {
      // Müdür: ay da günlerinden (aylık ücretlerle); tutar yok (oran × ciro onu verir, ama rakam Vardiya'dan bağımsız), günlük satır yok
      const shown = (r: LaborRow): LaborRowShown => ({ ...r, labor: null });
      const whole = laborRow(month, monthDays);
      return { id, name, month: { labor: null, revenue: whole.revenue, ratio: whole.ratio }, days: [], weeks: weeklyRows(days).map(shown), daysLabor: null };
    }
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
    const own = perBranch.flatMap((x) => (x.month ? [x.month] : []));
    const labor = own.reduce((a, x) => a + x.labor, 0);
    // Bir şubenin cirosu girilmemişse toplamın cirosu da bilinmiyor (işçiliği sayılıp cirosu sayılmasaydı oran şişerdi)
    const revenue = own.every((x) => x.revenue !== null) ? own.reduce((a, x) => a + (x.revenue ?? 0), 0) : null;
    total = report(ALL_BRANCHES, "Şubelerin toplamı", sumDays(perBranch.map((x) => x.days)), wages ? { labor, revenue, ratio: revenue ? labor / revenue : null } : null);
  }
  return { month, wages, through, branches: out, total, missing };
}
