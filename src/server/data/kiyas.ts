import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { ALL_BRANCHES } from "@/lib/branches";
import { asilposBranchOf } from "@/lib/asilpos/switch";
import type { TillRow } from "@/lib/cash-month";
import { businessDate } from "@/lib/cash-report";
import { kiyasSummary, type KiyasSummary } from "@/lib/kiyas";
import { addDays } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope, currentBranchWhere } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { closedDaysBetween } from "@/server/closed-days";
import { tillRows } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";
import { loadAsilposSwitchDay } from "@/server/asilpos/status";

/** Okunan geçmiş: geçen ayın 1'ine kadar yeter (en çok 62 gün); biraz pay */
const LOOKBACK_DAYS = 70;

/**
 * "Kıyas" kartının verisi (src/lib/kiyas.ts, docs/KIYAS.md). Yalnız yönetici (tutar taşır; personelin ciroyu gördüğü bir
 * ekran yok). Seçili şubeye uyar: tillRows seçili kapsamla okur, "Tümü"de etkin fiziksel şubelerin toplamı; online kanal
 * seçiliyken kasa satırı olmadığından kart çizilmez. `till` verilirse (Genel bakış zaten okudu) yeniden okunmaz.
 * Veri hiç yoksa null.
 */
export async function loadKiyas(till?: readonly TillRow[] | null, now: Date = new Date()): Promise<{ data: KiyasSummary; branchNames: string[] } | null> {
  await requireAdmin();
  const db = getDb();
  const today = businessDate(now);
  const from = addDays(today, -LOOKBACK_DAYS);
  const scope = await currentBranchScope();
  const all = await listBranches(db);
  const branches = all.filter((b) => b.active && b.kind === "fiziksel" && (scope === ALL_BRANCHES || b.id === scope));
  if (!branches.length) return null;

  const [rows, switchDay, reports, closed] = await Promise.all([
    till ? Promise.resolve(till) : tillRows(db),
    loadAsilposSwitchDay(db),
    db
      .select({ branchId: s.cashReports.branchId, date: s.cashReports.date, receipts: s.cashReports.receipts })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, today), await currentBranchWhere(s.cashReports.branchId))),
    Promise.all(branches.map(async (b) => [b.id, new Set(await closedDaysBetween(from, today, db, b.id))] as const)),
  ]);
  const recent = rows.filter((r) => r.date >= from && r.date <= today);
  if (!recent.length) return null;
  const closedBy = new Map(closed);
  const summary = kiyasSummary({
    rows: recent,
    branches: branches.map((b) => ({ id: b.id, name: b.name, openedOn: b.openedOn })),
    today,
    switchDay,
    asilposBranch: asilposBranchOf(all),
    receipts: new Map(reports.map((r) => [`${r.branchId}|${r.date}`, r.receipts])),
    isClosed: (branchId, date) => closedBy.get(branchId)?.has(date) ?? false,
  });
  // Hiçbir gün ve kıyas verisi yoksa kart çizilmez (kasa kullanılmamış)
  if (summary.day.state === "veri-yok" && [...summary.days, ...summary.periods].every((r) => r.state === "veri-yok" || r.state === "acilmamis" || r.state === "tarih-yok")) return null;
  return { data: summary, branchNames: branches.map((b) => b.name) };
}
