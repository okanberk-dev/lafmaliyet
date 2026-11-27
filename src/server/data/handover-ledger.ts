import "server-only";

import { and, eq, gt, gte, isNotNull, lte } from "drizzle-orm";

import { isAsilposCashOutBy } from "@/lib/asilpos/cash-moves";
import { sortLedger, type HandoverRow } from "@/lib/teslim";
import { currentBranchWhere } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";

/**
 * Teslim defterinin satırları (docs/KASA-RAPORU.md › Teslim defteri; kurallar src/lib/teslim.ts): ayın kasa raporlarının
 * "Sayımdan sonra teslim"i (Kime'siyle) ve Kasadan çıkanlar'ın "Teslim · ödeme" satırları (Marina'nın AsilPOS'tan gelen
 * teslimleri dahil; Kime'si AsilPOS'un alıcısı). Şube seçiciye göre ("Tümü"de bütün şubeler). Yalnız yönetici ekranı okur
 */
export async function handoverLedger(month: string): Promise<HandoverRow[]> {
  const from = `${month}-01`;
  const to = `${month}-31`;
  const db = getDb();
  const [reports, outs] = await Promise.all([
    db
      .select({
        id: s.cashReports.id,
        date: s.cashReports.date,
        branchId: s.cashReports.branchId,
        amount: s.cashReports.handedOver,
        to: s.cashReports.handedTo,
        by: s.cashReports.submittedByName,
      })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to), gt(s.cashReports.handedOver, 0), await currentBranchWhere(s.cashReports.branchId))),
    db
      .select({
        id: s.cashOuts.id,
        date: s.cashOuts.date,
        branchId: s.cashOuts.branchId,
        amount: s.cashOuts.amount,
        to: s.cashOuts.store,
        by: s.cashOuts.createdByName,
        asilposId: s.cashOuts.asilposId,
      })
      .from(s.cashOuts)
      .where(and(gte(s.cashOuts.date, from), lte(s.cashOuts.date, to), eq(s.cashOuts.kind, "teslim"), await currentBranchWhere(s.cashOuts.branchId))),
  ]);
  const clean = (v: string | null) => v?.replace(/\s+/g, " ").trim() || null;
  return sortLedger([
    ...reports.map((r): HandoverRow => ({ date: r.date, branchId: r.branchId, amount: r.amount, to: clean(r.to), by: r.by, kind: "sayim", asilpos: false, ref: { report: r.id } })),
    ...outs.map(
      (o): HandoverRow => ({
        date: o.date,
        branchId: o.branchId,
        amount: o.amount,
        to: clean(o.to),
        by: o.by,
        kind: "gun-ici",
        asilpos: o.asilposId !== null && isAsilposCashOutBy(o.by),
        ref: { cashOut: o.id },
      }),
    ),
  ]);
}

/**
 * Defterin ay seçicisi: teslimi olan ilk aydan bu aya (en eski kasa raporu ya da kasadan çıkan teslim). Seçili şubenin
 * (şube ayrımı, 27 Kasım 2026; defterin satırları gibi): önceden ay seçici Tuzla'nın ilk teslim ayından başlıyordu,
 * Marina seçiliyken boş aylar listeleniyordu
 */
export async function handoverFirstDate(): Promise<string | null> {
  const db = getDb();
  const [[r], [o]] = await Promise.all([
    db
      .select({ date: s.cashReports.date })
      .from(s.cashReports)
      .where(and(gt(s.cashReports.handedOver, 0), await currentBranchWhere(s.cashReports.branchId)))
      .orderBy(s.cashReports.date)
      .limit(1),
    db
      .select({ date: s.cashOuts.date })
      .from(s.cashOuts)
      .where(and(eq(s.cashOuts.kind, "teslim"), isNotNull(s.cashOuts.date), await currentBranchWhere(s.cashOuts.branchId)))
      .orderBy(s.cashOuts.date)
      .limit(1),
  ]);
  const days = [r?.date, o?.date].filter((d): d is string => Boolean(d)).sort();
  return days[0] ?? null;
}
