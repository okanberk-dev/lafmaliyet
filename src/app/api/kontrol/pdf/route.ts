import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { ALL_BRANCHES, BRANCH_PARAM, parseBranchScope } from "@/lib/branches";
import { buildMonthReport, monthPdfName } from "@/lib/checklist-month";
import { checklistDay } from "@/lib/checklists";
import { isMonthKey, monthLastDay } from "@/lib/closed-period";
import { closedDaysIn, closedRowApplies } from "@/lib/closed-days";
import { getCurrentUser } from "@/server/auth/dal";
import { currentBranchScope, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { renderChecklistMonthPdf } from "@/server/checklists/month-pdf";
import { loadChecklistHistory } from "@/server/data/checklists";
import { getDb, schema as s } from "@/server/db";

/**
 * Kontrol listelerinin aylık PDF'i (docs/KONTROL-LISTELERI.md › Aylık PDF): `?ay=YYYY-MM` (yoksa bu ay) ve `?sube=`
 * (yoksa panelde seçili şube; "hepsi" bütün şubeler). Yalnız yönetici. Ayın bugüne kadarki günleri, her gün o gün
 * beklenen listeler (o şubenin ve bütün şubelerin listeleri): madde madde yanıt, işaretleyen, saat, fotoğraf; eksik
 * günler. Dosya saklanmaz: her istekte kayıtlardan yeniden çizilir.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const now = new Date();
  const today = checklistDay(now);
  const raw = params.get("ay");
  const month = raw && isMonthKey(raw) && raw <= today.slice(0, 7) ? raw : today.slice(0, 7);
  const branches = await listBranches();
  const wanted = params.get(BRANCH_PARAM);
  const scope = wanted ? parseBranchScope(wanted, branches) : await currentBranchScope();
  const branchName = scope === ALL_BRANCHES ? "Bütün şubeler" : (branches.find((b) => b.id === scope)?.name ?? scope);
  const from = `${month}-01`;
  const last = monthLastDay(month);
  const to = last < today ? last : today;
  try {
    const [days, closedRows] = await Promise.all([
      withBranchScope(scope, () => loadChecklistHistory(from, to, "admin", now)),
      getDb()
        .select({ kind: s.specialDays.kind, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo, branchId: s.specialDays.branchId })
        .from(s.specialDays)
        .where(eq(s.specialDays.kind, "kapali")),
    ]);
    // Kapalı gün şubenin (docs/SUBE.md › Kapalı gün): bütün şubelerde yalnız işletme geneli kapalı günler
    const closedDays = closedDaysIn(
      closedRows.filter((r) => (scope === ALL_BRANCHES ? r.branchId == null : closedRowApplies(r, scope))),
      from,
      to,
    );
    const report = buildMonthReport({ month, branch: branchName, days, closedDays });
    const bytes = await renderChecklistMonthPdf(report, now);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${monthPdfName(month, scope === ALL_BRANCHES ? null : scope)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[kontrol] aylık PDF", e);
    return Response.json({ error: "PDF hazırlanamadı; biraz sonra yeniden deneyin" }, { status: 500 });
  }
}
