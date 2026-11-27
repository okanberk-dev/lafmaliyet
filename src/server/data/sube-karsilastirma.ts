import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { ALL_BRANCHES, tillBranches } from "@/lib/branches";
import type { MonthField } from "@/lib/calc/types";
import { businessDate } from "@/lib/cash-report";
import { cellReader } from "@/lib/kiyas";
import { addDays, shiftMonth } from "@/lib/reminders";
import { branchCompare, cashDiffByMonth, EMPTY_FIGURES, monthDays, receiptFigures, type BranchMonthFigures, type ComparePeriod } from "@/lib/sube-karsilastirma";
import { requireAdmin } from "@/server/auth/dal";
import { withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { closedDaysBetween } from "@/server/closed-days";
import { tillRows } from "@/server/data/cash-reports";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";
import { loadSwitchDays } from "@/server/pos/tills";

export interface BranchCompareData {
  /** Seçilen aylar, eskiden yeniye */
  months: string[];
  /** Süren ay (iş günü, 05:00 kuralı): o ayın rakamları bugüne kadar */
  current: string;
  branches: { id: string; name: string; openedOn: string | null }[];
  periods: ComparePeriod[];
}

/**
 * Şube karşılaştırma (Raporlar; docs/RAPORLAR.md, hesap src/lib/sube-karsilastirma.ts). Yalnız yönetici. Soldaki seçiciden
 * bağımsız: her açık fiziksel şube kendi görünümüyle okunur (Gelir-gider'de o şube seçiliyken görünen rakamlar), kasa
 * satırları ve raporlar "Tümü"yle. Her rakam başka bir ekranınkidir:
 * - ciro, açık gün, mal maliyeti, personel, giderler, kâr: Gelir-gider'in ay hesabı (`pnlMonth`, şubenin görünümü);
 * - ödenmez ve indirim: ayın bilgisi (Gelir-gider / Satışlar; girilmemişse bilinmiyor);
 * - zayi ve ikramın malzeme maliyeti: Zayi & ikram'ın ay özeti (`wasteSummary`);
 * - kasa farkı: kasa raporlarının farkı (eksik eksi);
 * - fiş ve ortalama sepet: Kıyas'ın şube-gün hücresi (rapor > AsilPOS gün sonu > ModPOS föyü).
 * Seçilen son ay bu aydan sonraysa bu aya çekilir. Açık fiziksel şube yoksa null.
 */
export async function loadBranchCompare(lastMonth: string, span: number, now: Date = new Date()): Promise<BranchCompareData | null> {
  await requireAdmin();
  const db = getDb();
  const today = businessDate(now);
  const current = today.slice(0, 7);
  const last = lastMonth > current ? current : lastMonth;
  const months = Array.from({ length: span }, (_, i) => shiftMonth(last, i - span + 1));
  const from = `${months[0]}-01`;
  const to = months[months.length - 1] === current ? today : addDays(`${shiftMonth(last, 1)}-01`, -1);

  const all = await listBranches(db);
  const branches = tillBranches(all);
  if (!branches.length) return null;

  const [models, rows, switchDay, reports, closed] = await Promise.all([
    // Her şube kendi görünümüyle (soldaki seçimden bağımsız): Gelir-gider'de o şube seçiliyken görünen ay hesabı
    Promise.all(branches.map((b) => loadModel({ scope: b.id }))),
    // şube-ayrımı: karsilastirma.sayfa
    withBranchScope(ALL_BRANCHES, () => tillRows(db)),
    loadSwitchDays(db),
    db
      .select({ branchId: s.cashReports.branchId, date: s.cashReports.date, cashDiff: s.cashReports.cashDiff, receipts: s.cashReports.receipts })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to))),
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
  const diffs = cashDiffByMonth(reports);

  const input = branches.map((b, i) => {
    const model = models[i];
    const kiyasBranch = { id: b.id, name: b.name, openedOn: b.openedOn };
    const monthsOf: Record<string, BranchMonthFigures> = {};
    for (const m of months) {
      const c = model.pnlMonth(m);
      const info = c.info;
      // Ayın bilgisinde alan girilmemişse (kaynağı "none") bilinmiyor: 0 ₺ yazılmaz
      const known = (f: MonthField) => Boolean(info) && (info?.sources?.[f] ?? "manual") !== "none";
      const waste = model.wasteSummary(m);
      const diff = diffs.get(`${b.id}|${m}`);
      monthsOf[m] = {
        ...EMPTY_FIGURES,
        revenue: c.revenue,
        revenueNet: c.revenueTotalNet,
        openDays: info?.openDays ?? null,
        cogs: c.cogs,
        labor: c.sections.personel,
        expenses: c.expenses,
        profit: c.profit,
        offRevenue: known("offRevenue") ? (info?.offRevenue ?? null) : null,
        discounts: known("discounts") ? (info?.discounts ?? null) : null,
        zayiCost: waste.zayi.cost,
        ikramCost: waste.ikram.cost,
        cashDiff: diff ? diff.sum : null,
        cashDiffDays: diff?.days ?? 0,
        ...receiptFigures(monthDays(m, to).map((d) => read(kiyasBranch, d))),
      };
    }
    return { id: b.id, name: b.name, months: monthsOf };
  });

  return {
    months,
    current,
    branches: branches.map((b) => ({ id: b.id, name: b.name, openedOn: b.openedOn })),
    periods: branchCompare(input, months),
  };
}
