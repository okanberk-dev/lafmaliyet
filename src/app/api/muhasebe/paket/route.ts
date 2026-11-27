import type { NextRequest } from "next/server";

import { ALL_BRANCHES, BRANCH_PARAM, parseBranchScope } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { isMonthKey, prevMonth } from "@/lib/closed-period";
import { can } from "@/lib/roles";
import { getCurrentUser } from "@/server/auth/dal";
import { withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { packageFile } from "@/server/muhasebe/paket";

/**
 * Muhasebeci paketi (docs/MUHASEBE-PAKETI.md): ayın faturaları, harcamaları, kasa raporları, yazarkasa Z KDV dökümü ve
 * sabit giderleri tek .xlsx'te. Yönetici ve muhasebeci. `?ay=YYYY-MM`; verilmezse geçen ay (iş gününe göre). `?sube=`
 * verilirse (şube seçiliyken ekranın indirme bağlantısı) o şubenin paketi (şube ayrımı parça 6), verilmezse bütün şubeler.
 * Aylık e-posta hep bütün şubelerdir (src/server/muhasebe/paket.ts › sendAccountingPackage).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  // Yönetici ve muhasebeci (docs/ROLLER.md): paket salt okunur, muhasebecinin işi
  if (!user || !can(user.role, "muhasebe.oku")) return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const raw = request.nextUrl.searchParams.get("ay");
  const month = raw && isMonthKey(raw) ? raw : prevMonth(businessDate().slice(0, 7));
  const rawBranch = request.nextUrl.searchParams.get(BRANCH_PARAM);
  // Tanınmayan ya da pasif şube "Tümü"ne düşer (parseBranchScope); müdür bu uca giremez (muhasebe.oku)
  const scope = rawBranch ? parseBranchScope(rawBranch, await listBranches()) : ALL_BRANCHES;
  try {
    const file = await withBranchScope(scope, () => packageFile(month, new Date(), scope));
    return new Response(file.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[muhasebe] paket hazırlanamadı", e);
    return new Response("Muhasebe paketi (.xlsx) hazırlanamadı. Sayfayı yenileyip tekrar deneyin; sorun sürerse hata kaydına bakın.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
