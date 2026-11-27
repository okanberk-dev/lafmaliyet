import { desc } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { branchPurchaseNote } from "@/app/panel/tutarlilik/branch-note";
import { modeOfScope } from "@/lib/branch-view";
import { ALL_BRANCHES, BRANCH_PARAM, branchScopeLabel, parseBranchScope, type BranchScope } from "@/lib/branches";
import { createModel } from "@/lib/calc/engine";
import { getCurrentUser } from "@/server/auth/dal";
import { areaScope, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadCariExport } from "@/server/data/cari";
import { loadModel, resolveMonth } from "@/server/data/dataset";
import { loadInvestments } from "@/server/data/investments";
import { loadBranchPurchases } from "@/server/data/purchase-lots";
import { loadBranchTaxView, loadTaxView } from "@/server/data/tax";
import { getDb, schema as s } from "@/server/db";

import { buildWorkbook, type ExportExtras } from "./workbook";

/**
 * Dışa aktar: panelin bütün sayfaları tek .xlsx çalışma kitabında (yalnızca yönetici).
 * ?ay=YYYY-MM seçili ayın sekmelerini (Özet, Sayım, Tutarlılık, Satış, Personel, Sabit Giderler) belirler;
 * verilmezse satış verisi olan son ay. Gelir-Gider o ayın yılının 12 ayını, Faturalar bütün faturaları içerir;
 * gri yedek sekmeleri (Satış / Gelir-Gider / Sayım Kayıtları, Ay Bilgileri, Alım Miktarları) bütün ayları taşır.
 * Vergi sekmesi Vergi sayfasının yılını yazar (tahmin; geliri mali belgeden gelmeyen çeyrek yazılmaz).
 * Sekme düzeni ve testleri: ./workbook.ts, tests/export-workbook.test.ts.
 *
 * Kapsam (docs/SUBE.md › Şube ayrımı › parça 6): `?sube=` verilirse (Genel bakış'ın ve Ayarlar'ın düğmesi şube seçiliyken
 * seçimi gönderir) satış, kasa, personel ve giderler o şubenin; öbür sekmeler kendi alanının kipiyle (kişinin Şube
 * görünümü): Tutarlılık (Tutarlılık alanı), Cari hareketleri (Tedarikçi bakiyeleri), Vergi'nin altındaki şubenin payı
 * (Vergi; beyan her kipte firmanın), stok değeri (veri kümesi), işletme geneli giderlerin tutarı (İşletme geneli
 * giderler). Bulgular ve Alım Miktarları firma geneli (şube sütunu yok). Verilmezse bütün şubeler. Dosyanın ilk sayfası
 * kapsamı yazar.
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
    // Alanların kapsamı (şube ayrımı parça 6): dosyanın kapsamı içinde kişinin Şube görünümüyle; "Tümü" dosyasında hepsi "Tümü"
    // şube-ayrımı: alan.tedarikciler
    const cariScope = await areaScope("tedarikciler");
    // şube-ayrımı: alan.tutarlilik
    const consistencyScope = await areaScope("tutarlilik");
    // şube-ayrımı: alan.vergi
    const taxScope = await areaScope("vergi");
    const [model, investments, findings, cari] = await Promise.all([
      loadModel(),
      // Yatırımlar dosyanın şubesinin ve işletme genelinin (şube ayrımı; toplam şubeninki, işletme geneli bilgi)
      loadInvestments(scope),
      // Bulgular firmanın (şube sütunu yok): her dosyada hepsi, şube dosyasında "Firma geneli" yazısıyla
      db.select().from(s.findings).orderBy(desc(s.findings.createdAt), desc(s.findings.id)),
      // Tedarikçilere elle girilen borç ve ödemeler ("Cari hareketleri" sekmesi; kayıt yokken sekme yok)
      loadCariExport(cariScope),
    ]);
    const month = resolveMonth(request.nextUrl.searchParams.get("ay") ?? undefined, model);
    // "Vergi" sekmesi (dalga 12, docs/VERGI.md): Vergi sayfasının varsayılan yılı (30 Nisan'a kadar geçen yıl), takvimi
    // nakit planıyla. Okunamazsa sekme yok, dosyanın geri kalanı iner. Beyan firmanın: şube dosyasında da bütün şubelerin
    // modeliyle (Vergi sayfası gibi)
    // şube-ayrımı: vergi.beyan
    const tax = await withBranchScope(ALL_BRANCHES, async () => loadTaxView(whole ? model : await loadModel({ scope: ALL_BRANCHES })))
      .then((d) => ({ view: d.view, settings: d.inputs.settings }))
      .catch((e) => {
        console.error("[export] Vergi sekmesi hazırlanamadı", e);
        return null;
      });
    // Vergi alanı "Yalnız şube" kipinde: beyanın altında şubenin payı (bilgi), Vergi sayfasının kartı gibi
    const taxShare = tax && taxScope !== ALL_BRANCHES ? await loadBranchTaxView(taxScope, { year: tax.view.year }) : null;
    // Tutarlılık sekmesi alanının kipiyle: firma kipinde bütün şubeler, şube kipinde şubenin satışı ve sayımı, alınan
    // yalnız şubeye seçilmiş faturalardan (Tutarlılık sayfası gibi)
    const consistency = whole ? undefined : await consistencyOf(consistencyScope, model, month, branches);
    // İşletme geneli giderler "Yalnız not" kipinde işletme geneli yatırım da dosyada yok (Sabit giderler sayfası gibi)
    const sharedHidden = Boolean(model.ds.sharedCostsHidden);
    const wb = buildWorkbook(model, month, {
      investments: sharedHidden ? investments.filter((i) => i.branchId !== null) : investments,
      findings,
      // Faturanın kalan borcu faturanın kendisinden (Paraşüt'ün kalanı ve panelde sayılan ödemeler; openBalance)
      cari,
      tax,
      taxShare,
      consistency,
      scope: {
        label: branchScopeLabel(scope, branches),
        branch: !whole,
        areas: { tutarlilik: modeOfScope(consistencyScope), tedarikciler: modeOfScope(cariScope), vergi: modeOfScope(taxScope), sharedHidden },
      },
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
    console.error("[export] Dışa aktarım dosyası hazırlanamadı", e);
    return new Response("Dışa aktarım dosyası (.xlsx) hazırlanamadı. Sayfayı yenileyip tekrar deneyin; sorun sürerse hata kaydına bakın.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

/**
 * Şube dosyasının Tutarlılık sekmesi (Tutarlılık alanı): firma kipinde bütün şubelerin modeli, şube kipinde şubenin
 * modeli ve şubeye seçilmiş faturaların alımı (okunamazsa şubenin modeli, notuyla)
 */
async function consistencyOf(read: BranchScope, model: Awaited<ReturnType<typeof loadModel>>, month: string, branches: Awaited<ReturnType<typeof listBranches>>): Promise<ExportExtras["consistency"]> {
  if (read === ALL_BRANCHES) return { model: await loadModel({ scope: read }), label: "Firma geneli", note: "Tutarlılık firma geneli: bütün şubelerin satışı, sayımı ve bütün faturaların alımı." };
  const name = branchScopeLabel(read, branches);
  const own = await loadBranchPurchases(read).catch(() => null);
  if (!own) return { model, label: name, note: "Şubeye seçilmiş faturaların alımı okunamadı; alınan firmanın alım miktarlarından." };
  return {
    model: createModel({ ...model.ds, purchaseQuantities: own.quantities, heldPurchases: own.held }),
    label: name,
    note: `Alınan yalnız ${name} şubesine seçilmiş faturalardan; ${branchPurchaseNote(own.outside[month] ?? { invoices: 0, manual: 0 })}`,
  };
}
