import { asc, desc } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { ALL_BRANCHES } from "@/lib/branches";
import { getCurrentUser } from "@/server/auth/dal";
import { withBranchScope } from "@/server/branch-scope";
import { loadCariExport } from "@/server/data/cari";
import { loadModel, resolveMonth } from "@/server/data/dataset";
import { loadTaxView } from "@/server/data/tax";
import { getDb, schema as s } from "@/server/db";

import { buildWorkbook } from "./workbook";

/**
 * Excel'e aktar: panelin bütün sayfaları tek .xlsx dosyasında (yalnızca yönetici).
 * ?ay=YYYY-MM seçili ayın sekmelerini (Özet, Sayım, Tutarlılık, Satış, Personel, Sabit Giderler) belirler;
 * verilmezse satış verisi olan son ay. Gelir-Gider o ayın yılının 12 ayını, Faturalar bütün faturaları içerir;
 * gri yedek sekmeleri (Satış / Gelir-Gider / Sayım Kayıtları, Ay Bilgileri, Alım Miktarları) bütün ayları taşır.
 * Vergi sekmesi Vergi sayfasının yılını yazar (tahmin; geliri mali belgeden gelmeyen çeyrek yazılmaz).
 * Sekme düzeni ve testleri: ./workbook.ts, tests/export-workbook.test.ts.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });

  // Dışa aktarım panelin yedeğidir: şube seçiciden bağımsız, bütün şubeler (docs/SUBE.md › Neyi süzer)
  return withBranchScope(ALL_BRANCHES, () => exportWorkbook(request));
}

async function exportWorkbook(request: NextRequest): Promise<Response> {
  try {
    const db = getDb();
    const [model, investments, findings, cari] = await Promise.all([
      loadModel(),
      db.select().from(s.investments).orderBy(asc(s.investments.id)),
      db.select().from(s.findings).orderBy(desc(s.findings.createdAt), desc(s.findings.id)),
      // Tedarikçilere elle girilen borç ve ödemeler ("Cari hareketleri" sekmesi; kayıt yokken sekme yok)
      loadCariExport(),
    ]);
    const month = resolveMonth(request.nextUrl.searchParams.get("ay") ?? undefined, model);
    // "Vergi" sekmesi (dalga 12, docs/VERGI.md): Vergi sayfasının varsayılan yılı (30 Nisan'a kadar geçen yıl), takvimi
    // nakit planıyla. Okunamazsa sekme yok, dosyanın geri kalanı iner
    const tax = await loadTaxView(model)
      .then((d) => ({ view: d.view, settings: d.inputs.settings }))
      .catch((e) => {
        console.error("[export] Vergi sekmesi hazırlanamadı", e);
        return null;
      });
    const wb = buildWorkbook(model, month, {
      investments,
      findings,
      // Faturanın kalan borcu faturanın kendisinden (Paraşüt'ün kalanı ve panelde sayılan ödemeler; openBalance)
      cari,
      tax,
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
