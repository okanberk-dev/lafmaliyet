import { asc, desc } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { ALL_BRANCHES, BRANCH_PARAM, branchScopeLabel, parseBranchScope, type BranchScope } from "@/lib/branches";
import { getCurrentUser } from "@/server/auth/dal";
import { withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
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
 *
 * Kapsam (docs/SUBE.md › Neyi süzer; şube kapsamı C P1-9): `?sube=` verilirse (Genel bakış'ın düğmesi ekranın seçimini
 * gönderir) satış, kasa, personel ve giderler o şubenin; firma geneli olanlar (Vergi, Cari hareketleri) yine "Tümü"yle.
 * Verilmezse (Ayarlar'daki tam yedek) seçiciden bağımsız, bütün şubeler. Dosyanın ilk sayfası kapsamı yazar.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });

  const raw = request.nextUrl.searchParams.get(BRANCH_PARAM);
  const scope = raw ? parseBranchScope(raw, await listBranches()) : ALL_BRANCHES;
  return withBranchScope(scope, () => exportWorkbook(request, scope));
}

async function exportWorkbook(request: NextRequest, scope: BranchScope): Promise<Response> {
  try {
    const db = getDb();
    const branches = await listBranches();
    const whole = scope === ALL_BRANCHES;
    const [model, investments, findings, cari] = await Promise.all([
      loadModel(),
      db.select().from(s.investments).orderBy(asc(s.investments.id)),
      db.select().from(s.findings).orderBy(desc(s.findings.createdAt), desc(s.findings.id)),
      // Tedarikçilere elle girilen borç ve ödemeler ("Cari hareketleri" sekmesi; kayıt yokken sekme yok). Firma geneli
      withBranchScope(ALL_BRANCHES, () => loadCariExport()),
    ]);
    const month = resolveMonth(request.nextUrl.searchParams.get("ay") ?? undefined, model);
    // "Vergi" sekmesi (dalga 12, docs/VERGI.md): Vergi sayfasının varsayılan yılı (30 Nisan'a kadar geçen yıl), takvimi
    // nakit planıyla. Okunamazsa sekme yok, dosyanın geri kalanı iner
    // Vergi firma geneli: şube dosyasında da bütün şubelerin modeliyle (Vergi sayfası gibi)
    const tax = await withBranchScope(ALL_BRANCHES, async () => loadTaxView(whole ? model : await loadModel({ scope: ALL_BRANCHES })))
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
      scope: { label: branchScopeLabel(scope, branches), branch: !whole },
      branchNames: new Map(branches.map((b) => [b.id, b.name])),
    });
    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="laffogato-${month}${whole ? "" : `-${scope}`}.xlsx"`,
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
