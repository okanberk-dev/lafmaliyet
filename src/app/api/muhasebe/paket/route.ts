import type { NextRequest } from "next/server";

import { businessDate } from "@/lib/cash-report";
import { isMonthKey, prevMonth } from "@/lib/closed-period";
import { getCurrentUser } from "@/server/auth/dal";
import { packageFile } from "@/server/muhasebe/paket";

/**
 * Muhasebeci paketi (docs/MUHASEBE-PAKETI.md): ayın faturaları, harcamaları, kasa raporları, yazarkasa Z KDV dökümü ve
 * sabit giderleri tek .xlsx'te, bütün şubeler. Yalnız yönetici. `?ay=YYYY-MM`; verilmezse geçen ay (iş gününe göre).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const raw = request.nextUrl.searchParams.get("ay");
  const month = raw && isMonthKey(raw) ? raw : prevMonth(businessDate().slice(0, 7));
  try {
    const file = await packageFile(month);
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
