import type { NextRequest } from "next/server";

import { todayTR } from "@/lib/reminders";
import { pdfFileName, weekParam } from "@/lib/vardiya";
import { getCurrentUser } from "@/server/auth/dal";
import { currentPhysicalBranch, staffBranchLock } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";
import { renderShiftPdf } from "@/server/vardiya/pdf";
import { loadShiftPresets } from "@/server/vardiya/presets";
import { loadShiftWeek, shiftBranches } from "@/server/vardiya/store";

/**
 * Vardiya planının PDF'i (docs/VARDIYA.md › PDF): `?hafta=YYYY-AA-GG` (haftanın herhangi bir günü; yoksa bu hafta) ve
 * `?sube=` (yoksa panelde seçili şube; "Tümü"de Tuzla). Giriş yapmış herkes alır: yönetici ve şubesiz personel her
 * şubenin, şubesine kilitli personel yalnız kendi şubesinin planını. Dosya saklanmaz: her istekte kaydedilen plandan
 * yeniden çizilir, plan değişince PDF de değişir. Tutar ya da maliyet taşımaz.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Giriş gerekli" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const [branches, lock] = await Promise.all([listBranches(), staffBranchLock()]);
  const wanted = params.get("sube");
  if (lock && wanted && wanted !== lock) return Response.json({ error: "Bu şubenin vardiya planını göremezsiniz" }, { status: 403 });
  const id = lock ?? wanted ?? (await currentPhysicalBranch()).id;
  const branch = shiftBranches(branches).find((b) => b.id === id);
  if (!branch) return Response.json({ error: "Şube bulunamadı" }, { status: 404 });
  const monday = weekParam(params.get("hafta"), todayTR());
  try {
    const db = getDb();
    const [week, presets] = await Promise.all([loadShiftWeek(db, branch, monday, { roster: false }), loadShiftPresets(branch.id, db)]);
    const bytes = await renderShiftPdf({ presets, branchName: branch.name, monday, rows: week.rows, updated: week.updated, generatedAt: new Date() });
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfFileName(branch.id, monday)}"`,
        // Kişiye özel ve her istekte güncel: ara bellek tutmaz
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[vardiya] PDF", e);
    return Response.json({ error: "PDF hazırlanamadı; biraz sonra yeniden deneyin" }, { status: 500 });
  }
}
