import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";

import { fixedMonthly, yearMonths } from "@/lib/calc/engine";
import { dashboard } from "@/lib/calc/insights";
import { FIXED_PERIODS, FIXED_SECTIONS, MONTH_NAMES } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import { getCurrentUser } from "@/server/auth/dal";
import { loadModel, resolveMonth } from "@/server/data/dataset";

const MONEY = '#,##0.00 "₺";[Red]-#,##0.00 "₺"';
const MONEY0 = '#,##0 "₺";[Red]-#,##0 "₺"';
const PCT = "0.0%";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF33211A" } };

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number; fmt?: string }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 28;
  return ws;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });

  const model = await loadModel();
  const month = resolveMonth(request.nextUrl.searchParams.get("ay") ?? undefined, model);
  const st = model.settings;
  const sold = model.soldByProduct(month);
  const wb = new ExcelJS.Workbook();
  wb.creator = "L'Affogato Panel";
  wb.created = new Date();

  // ---------------------------------------------------------------- Özet
  const d = dashboard(model, month);
  const ozet = sheet(wb, "Özet", [
    { header: "Gösterge", key: "k", width: 48 },
    { header: monthLabel(month), key: "v", width: 20 },
  ]);
  const t = d.theoretical;
  const rows: [string, number | null, string?][] = [
    ["Net satış (KDV hariç)", t?.netSales ?? null, MONEY0],
    ["İndirimler (KDV hariç)", t ? -t.discountsNet : null, MONEY0],
    ["Malzeme + ambalaj (reçeteye göre)", t ? -t.material : null, MONEY0],
    ["POS komisyonu", t ? -t.commission : null, MONEY0],
    ["Brüt kâr", t?.grossProfit ?? null, MONEY0],
    ...FIXED_SECTIONS.map((s) => [s.label, t ? -t.fixed[s.key] : null, MONEY0] as [string, number | null, string]),
    ["Net kâr / zarar (reçeteye göre)", t?.netProfit ?? null, MONEY0],
    ["Kâr / zarar (faturaya göre, gelir-gider)", d.actual.profit, MONEY0],
    ["Zarar etmemek için günlük ciro (KDV dahil)", d.breakEvenDaily, MONEY0],
    ["Günlük ortalama ciro (KDV dahil)", d.dailyAvg, MONEY0],
    ["Reçeteye göre maliyet oranı", d.recipeCostRatio, PCT],
    ["Faturaya göre maliyet oranı", d.invoiceCostRatio, PCT],
    ["Fiyatı gözden geçirilmesi gereken ürün (Düşük kâr)", d.lowProfitCount],
  ];
  for (const [k, v, fmt] of rows) {
    const r = ozet.addRow({ k, v });
    if (fmt) r.getCell("v").numFmt = fmt;
  }

  // ---------------------------------------------------------------- Ürün Kârlılık
  const uk = sheet(wb, "Ürün Kârlılık", [
    { header: "Kategori", key: "cat", width: 18 },
    { header: "Ürün", key: "name", width: 30 },
    { header: "Boy", key: "size", width: 7 },
    { header: "Satış fiyatı (KDV dahil)", key: "price", fmt: MONEY },
    { header: "Net satış (KDV hariç)", key: "net", fmt: MONEY },
    { header: "POS komisyonu", key: "kom", fmt: MONEY },
    { header: "Malzeme + ambalaj maliyeti", key: "cost", fmt: MONEY },
    { header: "Toplam maliyet", key: "total", fmt: MONEY },
    { header: "Birim kâr", key: "profit", fmt: MONEY },
    { header: "Kâr marjı %", key: "margin", fmt: PCT },
    { header: "Maliyet oranı %", key: "ratio", fmt: PCT },
    { header: "Önerilen fiyat (KDV dahil)", key: "sug", fmt: MONEY0 },
    { header: "Durum", key: "status", width: 12 },
    { header: `${monthLabel(month)} satış adedi`, key: "qty" },
    { header: `${monthLabel(month)} brüt kâr`, key: "mp", fmt: MONEY0 },
    { header: "Fire oranı", key: "fire", fmt: PCT },
  ]);
  for (const p of model.products) {
    const qty = sold.get(p.product.id) ?? 0;
    uk.addRow({
      cat: p.category?.name,
      name: p.product.name,
      size: p.product.size,
      price: p.price,
      net: p.net,
      kom: p.commission,
      cost: p.cost,
      total: p.totalCost,
      profit: p.unitProfit,
      margin: p.margin,
      ratio: p.costRatio,
      sug: p.suggestedPrice,
      status: p.status,
      qty,
      mp: p.unitProfit * qty,
      fire: p.fireRate,
    });
  }
  uk.autoFilter = { from: "A1", to: "P1" };

  // ---------------------------------------------------------------- Reçeteler
  const rc = sheet(wb, "Reçete Kartları", [
    { header: "Ürün", key: "p", width: 30 },
    { header: "Boy", key: "s", width: 7 },
    { header: "Malzeme", key: "i", width: 30 },
    { header: "Birim", key: "u", width: 8 },
    { header: "Miktar", key: "q" },
    { header: "Formül", key: "f", width: 18 },
    { header: "Birim maliyet (KDV hariç)", key: "uc", fmt: "#,##0.0000" },
    { header: "Toplam", key: "t", fmt: MONEY },
    { header: "KDV dahil toplam", key: "tv", fmt: MONEY },
  ]);
  for (const p of model.products) {
    for (const l of p.lines) {
      rc.addRow({ p: p.product.name, s: p.product.size, i: l.ingredient?.name, u: l.ingredient?.unit, q: l.qty, f: l.item.qtyExpr ?? "", uc: l.unitCost, t: l.total, tv: l.totalVatIncl });
    }
    const r = rc.addRow({ p: p.product.name, s: p.product.size, i: `ÜRÜN MALİYETİ (fire %${(p.fireRate * 100).toFixed(1)} dahil)`, t: p.cost });
    r.font = { bold: true };
  }

  // ---------------------------------------------------------------- Hammaddeler
  const hm = sheet(wb, "Hammaddeler", [
    { header: "Malzeme", key: "n", width: 30 },
    { header: "Kategori", key: "c", width: 14 },
    { header: "Tedarikçi", key: "s", width: 18 },
    { header: "Paket", key: "pd", width: 36 },
    { header: "Paket fiyatı (KDV hariç)", key: "pp", fmt: MONEY },
    { header: "Paket içeriği", key: "ps" },
    { header: "Birim", key: "u", width: 8 },
    { header: "Birim maliyet", key: "uc", fmt: "#,##0.0000" },
    { header: "Alış KDV", key: "v", fmt: "0%" },
    { header: "Tahmini", key: "e", width: 9 },
    { header: "Kaynak / not", key: "note", width: 60 },
  ]);
  for (const i of model.ds.ingredients) {
    hm.addRow({ n: i.name, c: i.category, s: i.supplier, pd: i.packageDesc, pp: i.packagePrice, ps: i.packageSize, u: i.unit, uc: model.unitCost.get(i.id), v: i.vatRate, e: i.isEstimate ? "Evet" : "", note: i.note });
  }

  // ---------------------------------------------------------------- Satış raporu
  const sales = model.monthSales(month);
  const sr = sheet(wb, `Satış ${monthLabel(month)}`, [
    { header: "POS ürün adı", key: "n", width: 34 },
    { header: "Adet", key: "q" },
    { header: "Ciro (KDV dahil)", key: "r", fmt: MONEY },
    { header: "Eşleşen ürün", key: "m", width: 30 },
    { header: "Birim maliyet", key: "uc", fmt: MONEY },
    { header: "Net ciro (KDV hariç)", key: "net", fmt: MONEY },
    { header: "Malzeme + ambalaj", key: "c", fmt: MONEY },
    { header: "POS komisyonu", key: "k", fmt: MONEY },
    { header: "Brüt kâr", key: "g", fmt: MONEY },
    { header: "Kâr marjı %", key: "mg", fmt: PCT },
  ]);
  for (const l of sales.lines) {
    sr.addRow({ n: l.line.posName, q: l.line.qty, r: l.line.revenue, m: l.line.isService ? "HİZMET" : l.product ? l.product.key : "", uc: l.unitCost, net: l.net, c: l.cost, k: l.commission, g: l.grossProfit, mg: l.margin });
  }
  const tot = sr.addRow({ n: "TOPLAM", q: sales.qty, r: sales.revenue, net: sales.net, c: sales.cost, k: sales.commission, g: sales.grossProfit, mg: sales.margin });
  tot.font = { bold: true };

  // ---------------------------------------------------------------- Faturalar
  const fa = sheet(wb, "Faturalar", [
    { header: "Tarih", key: "d", width: 12 },
    { header: "Tedarikçi", key: "s", width: 26 },
    { header: "Açıklama", key: "de", width: 22 },
    { header: "Fatura no", key: "no", width: 20 },
    { header: "Kategori", key: "c", width: 20 },
    { header: "Mal/hizmet tutarı", key: "a", fmt: MONEY },
    { header: "İskonto", key: "i", fmt: MONEY },
    { header: "Net (KDV hariç)", key: "n", fmt: MONEY },
    { header: "KDV", key: "v", fmt: MONEY },
    { header: "Ödenecek (KDV dahil)", key: "p", fmt: MONEY },
    { header: "Durum", key: "u", width: 11 },
  ]);
  for (const i of model.ds.invoices) {
    fa.addRow({ d: i.date, s: i.supplier, de: i.description, no: i.invoiceNo, c: i.category, a: i.amount, i: i.discount, n: i.amount - i.discount, v: i.payable - (i.amount - i.discount), p: i.payable, u: i.unpaid ? "Ödenmedi" : "Ödendi" });
  }
  fa.autoFilter = { from: "A1", to: "K1" };

  // ---------------------------------------------------------------- Gelir-gider
  const year = Number(month.slice(0, 4));
  const months = yearMonths(year);
  const calcs = months.map((m) => model.pnlMonth(m));
  const gg = sheet(wb, `Gelir-Gider ${year}`, [
    { header: `L'AFFOGATO ${year}`, key: "l", width: 46 },
    ...months.map((m, i) => ({ header: MONTH_NAMES[i].toLocaleUpperCase("tr-TR"), key: m, width: 13, fmt: MONEY0 })),
  ]);
  const gd = gg.addRow({ l: "AÇIK GÜN SAYISI", ...Object.fromEntries(months.map((m, i) => [m, calcs[i].info?.openDays ?? null])) });
  months.forEach((m) => (gd.getCell(m).numFmt = "0"));
  let lastSection = "";
  for (const def of model.pnlRowDefs(months)) {
    if (def.section !== lastSection) {
      lastSection = def.section;
      const h = gg.addRow({ l: def.section.toLocaleUpperCase("tr-TR") });
      h.font = { bold: true, color: { argb: "FF64412A" } };
    }
    const r = gg.addRow({ l: def.label, ...Object.fromEntries(months.map((m, i) => [m, model.pnlValue(calcs[i], def.key).value])) });
    if (def.strong) r.font = { bold: true };
    if (def.format === "percent") months.forEach((m) => (r.getCell(m).numFmt = PCT));
  }

  // ---------------------------------------------------------------- Sabit giderler & personel & ayarlar
  const sg = sheet(wb, "Sabit Giderler", [
    { header: "Gider kalemi", key: "n", width: 40 },
    { header: "Bölüm", key: "s", width: 22 },
    { header: "Tutar", key: "a", fmt: MONEY },
    { header: "Dönem", key: "p", width: 10 },
    { header: "Aylık karşılığı", key: "m", fmt: MONEY },
    { header: "Not", key: "note", width: 60 },
  ]);
  sg.addRow({ n: "Personel (maaş + SGK)", s: "Personel giderleri", m: model.personnel.total, note: "Personel sayfasından" });
  for (const f of model.activeFixed) {
    sg.addRow({ n: f.name, s: FIXED_SECTIONS.find((x) => x.key === f.section)?.label, a: f.amount, p: FIXED_PERIODS.find((x) => x.key === f.period)?.label, m: fixedMonthly(f, st), note: f.note });
  }
  const sgt = sg.addRow({ n: "TOPLAM", m: model.fixedStandardTotal });
  sgt.font = { bold: true };

  const pr = sheet(wb, "Personel", [
    { header: "Personel", key: "n", width: 20 },
    { header: "Net maaş", key: "net", fmt: MONEY0 },
    { header: "Tahmini brüt", key: "g", fmt: MONEY0 },
    { header: "İşçi kesintileri", key: "d", fmt: MONEY0 },
    { header: "İşveren SGK", key: "e", fmt: MONEY0 },
    { header: "İşveren işsizlik", key: "u", fmt: MONEY0 },
    { header: "Yemek / yol / prim", key: "x", fmt: MONEY0 },
    { header: "Toplam işveren maliyeti", key: "t", fmt: MONEY0 },
  ]);
  for (const r of model.personnel.rows) {
    pr.addRow({ n: r.staff.name, net: r.staff.netSalary, g: r.gross, d: r.deductions, e: r.employerSgk, u: r.employerUnemployment, x: r.staff.extras, t: r.total });
  }

  const ay = sheet(wb, "Ayarlar", [
    { header: "Ayar", key: "k", width: 40 },
    { header: "Değer", key: "v", width: 14 },
  ]);
  const settingRows: [string, number | string, string?][] = [
    ["Satış KDV oranı", st.kdv, PCT],
    ["Banka / POS komisyon oranı", st.komisyon, PCT],
    ["Kartlı satış oranı", st.kartOrani, PCT],
    ["Hedef maliyet oranı", st.hedefMaliyet, PCT],
    ["Fire / kayıp payı", st.fire, PCT],
    ["Fire ambalaja uygulanmaz", st.fireExcludesPackaging ? "Evet" : "Hayır"],
    ["Tek shot kahve (gr)", st.shotTek],
    ["Çift shot kahve (gr)", st.shotCift],
    ["1 pompa şurup (ml)", st.pompa],
    ["Filtre kahve tam pot (gr)", st.potGr],
    ["Tam pottan çıkan (ml)", st.potMl],
    ["1 top dondurma (ml)", st.dondurmaTop],
    ["Türk kahvesi 1 fincan (gr)", st.tkGr],
    ["Ayda açık gün", st.acikGun],
    ["Su + buz birim maliyeti (₺/L)", model.water.perLiter],
  ];
  for (const [k, v, fmt] of settingRows) {
    const r = ay.addRow({ k, v });
    if (fmt) r.getCell("v").numFmt = fmt;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="laffogato-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
