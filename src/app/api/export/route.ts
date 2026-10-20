import { asc, desc } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { buildWorkbook } from "./workbook";

/**
 * Excel'e aktar: panelin bütün sayfaları tek .xlsx dosyasında (yalnızca yönetici).
 * ?ay=YYYY-MM seçili ayın sekmelerini (Özet, Sayım, Tutarlılık, Satış, Personel, Sabit Giderler) belirler;
 * verilmezse satış verisi olan son ay. Gelir-Gider o ayın yılının 12 ayını, Faturalar bütün faturaları içerir;
 * gri yedek sekmeleri (Satış / Gelir-Gider / Sayım Kayıtları, Ay Bilgileri, Alım Miktarları) bütün ayları taşır.
 * Sekme düzeni ve testleri: ./workbook.ts, tests/export-workbook.test.ts.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });

  try {
    const db = getDb();
    const [model, investments, findings] = await Promise.all([
      loadModel(),
      db.select().from(s.investments).orderBy(asc(s.investments.id)),
      db.select().from(s.findings).orderBy(desc(s.findings.createdAt), desc(s.findings.id)),
    ]);
    const month = resolveMonth(request.nextUrl.searchParams.get("ay") ?? undefined, model);
    const wb = buildWorkbook(model, month, {
      investments,
      findings,
      // Kısmen ödenmiş Paraşüt faturasının kalan borcu (Invoice.outstanding)
      outstanding: new Map(model.ds.invoices.map((i) => [i.id, i.outstanding ?? null])),
    });
    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="laffogato-${month}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[export] Excel dosyası hazırlanamadı", e);
    return new Response("Excel dosyası hazırlanamadı. Sayfayı yenileyip tekrar deneyin; sorun sürerse hata kaydına bakın.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
