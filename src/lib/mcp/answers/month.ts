/*
 * ay_ozeti: bir ayın cirosu, giderleri ve kârı Genel bakış ve Gelir-gider'deki hesapla (dashboard, pnlMonth); yıl
 * verilirse yılın ayları (yearTrend). Saf; tests/claude-araclar.test.ts. Rakamlar ekranlarla aynı yoldan gelir, burada
 * ikinci bir hesap yoktur: yalnız yuvarlanır ve hesap satırlarına yazılır.
 */

import { daysInMonth, yearMonths, type Model } from "../../calc/engine";
import { alerts, dashboard, yearTrend } from "../../calc/insights";
import { kasaMonthLine, missingSentence } from "../../cash-month";
import { cleanName, monthLabel, num, panelUrl, pct, pctNum, r2, r2n, tl } from "./common";

export interface MonthSummary {
  ay: string;
  ayAdi: string;
  durum: "suruyor" | "bitti" | "gelecek";
  acikGun: number | null;
  ayinGunSayisi: number;
  /** Faturaya göre (Gelir-gider); ciro girilmemiş ayda null */
  gerceklesen: {
    ciroKdvDahil: number;
    ciroKdvHaric: number;
    onlineKdvHaric: number | null;
    toplamCiroKdvHaric: number;
    malMaliyeti: number;
    malAlimi: number;
    acilisStok: number;
    kapanisStok: number;
    personel: number;
    faturalar: number;
    kira: number;
    genel: number;
    komisyon: number;
    toplamGider: number;
    kar: number;
    karMarjiYuzde: number | null;
  } | null;
  /** Reçeteye göre (Genel bakış); satış listesi olmayan ayda null */
  teorik: { netSatis: number; malzeme: number; komisyon: number; brutKar: number; indirim: number; sabitGider: number; netKar: number } | null;
  /** Yalnız süren ay */
  tahmin: { aySonuCiroKdvDahil: number; aySonuKar: number; dayanakAy: string | null } | null;
  basaBas: { gunlukCiroKdvDahil: number | null; gunlukOrtalama: number | null; ilerlemeYuzde: number | null };
  enCokKazandiran: { ad: string; boy: string; adet: number; kar: number }[];
  uyarilar: string[];
  hesap: string[];
  kaynak: string[];
  veriOlanAylar: string[];
  panelAdresi: string;
  gelirGiderAdresi: string;
}

const STATE = { running: "suruyor", closed: "bitti", future: "gelecek" } as const;

/** Verisi olan aylar: ay bilgisi, satış listesi, fatura, sayım */
export function dataMonths(model: Model): string[] {
  const set = new Set<string>([...model.monthInfo.keys(), ...model.salesMonths]);
  for (const i of model.ds.invoices) set.add(i.date.slice(0, 7));
  for (const c of model.ds.stockCounts) set.add(c.month);
  return [...set].sort();
}

/** KDV böleni, iki ondalıkla ("1,10") */
const kdvText = (rate: number) => num(1 + rate, 2, 2);

export function monthSummary(model: Model, month: string, ctx: { base: string }): MonthSummary {
  const st = model.settings;
  const d = dashboard(model, month);
  const pm = model.pnlMonth(month);
  const info = d.info;
  const label = monthLabel(month);
  const dim = daysInMonth(month);
  const hesap: string[] = [];
  const kaynak: string[] = [];
  const uyarilar: string[] = [];

  let gerceklesen: MonthSummary["gerceklesen"] = null;
  if (pm.revenue !== null || pm.site) {
    const ciroNet = pm.revenueNet ?? 0;
    const total = pm.revenueTotalNet ?? 0;
    gerceklesen = {
      ciroKdvDahil: r2(pm.revenue ?? 0),
      ciroKdvHaric: r2(ciroNet),
      onlineKdvHaric: r2n(pm.site?.total),
      toplamCiroKdvHaric: r2(total),
      malMaliyeti: r2(pm.cogs),
      malAlimi: r2(pm.purchases),
      acilisStok: r2(pm.opening),
      kapanisStok: r2(pm.closing),
      personel: r2(pm.sections.personel),
      faturalar: r2(pm.sections.faturalar),
      kira: r2(pm.sections.kira),
      genel: r2(pm.sections.genel),
      komisyon: r2(pm.sections.komisyon),
      toplamGider: r2(pm.expenses),
      kar: r2(pm.profit),
      karMarjiYuzde: total ? pctNum(pm.profit / total) : null,
    };
    hesap.push(`Kâr = KDV hariç ciro − giderler = ${tl(total)} − ${tl(pm.expenses)} = ${tl(pm.profit)}`);
    if (pm.revenue !== null) {
      const service = pm.serviceRevenue;
      const pos =
        service > 0
          ? `(${tl(pm.revenue)} − ${tl(service)} hizmet) ÷ ${kdvText(st.kdv)} + ${tl(service)} ÷ ${kdvText(st.kdvHizmet)}`
          : `${tl(pm.revenue)} ÷ ${kdvText(st.kdv)}`;
      hesap.push(`KDV hariç ciro = ${pos} = ${tl(ciroNet)} (ModPOS${pm.site ? `; laffogato.net online ${tl(pm.site.total)} ayrıca eklendi, toplam ${tl(total)}` : "; online satış yok"})`);
    } else if (pm.site) {
      hesap.push(`KDV hariç ciro = laffogato.net online ${tl(pm.site.total)} (ModPOS cirosu girilmedi)`);
    }
    hesap.push(
      `Giderler = mal maliyeti ${tl(pm.cogs)} + personel ${tl(pm.sections.personel)} + faturalar ${tl(pm.sections.faturalar)} + kira ${tl(pm.sections.kira)} + genel ${tl(pm.sections.genel)} + komisyon ${tl(pm.sections.komisyon)}`,
    );
    hesap.push(`Mal maliyeti = açılış stoğu ${tl(pm.opening)} + alınan mal ${tl(pm.purchases)} − kapanış stoğu ${tl(pm.closing)}`);
    if (pm.openDays > 0 && pm.openDays < dim) hesap.push(`Sabit giderler açık güne göre: ${num(pm.openDays)} / ${num(dim)} gün`);
  } else {
    uyarilar.push(`${label} için ciro girilmedi (Satışlar'daki ay bilgisi ya da kasa raporu): faturaya göre kâr hesaplanmadı.`);
    if (pm.expenses > 0) hesap.push(`Şimdiye kadarki giderler ${tl(pm.expenses)} (ciro girilince kâr hesaplanır)`);
  }

  const t = d.theoretical;
  const teorik = t
    ? {
        netSatis: r2(t.netSales),
        malzeme: r2(t.material),
        komisyon: r2(t.commission),
        brutKar: r2(t.grossProfit),
        indirim: r2(t.discountsNet),
        sabitGider: r2(t.fixedTotal),
        netKar: r2(t.netProfit),
      }
    : null;
  if (t) {
    hesap.push(
      `Reçeteye göre net kâr = brüt kâr ${tl(t.grossProfit)} (net satış ${tl(t.netSales)} − malzeme ${tl(t.material)} − komisyon ${tl(t.commission)}) − indirim ${tl(t.discountsNet)} − sabit gider ${tl(t.fixedTotal)} = ${tl(t.netProfit)}`,
    );
  } else {
    uyarilar.push(`${label} için ürün satış listesi yok: reçeteye göre kâr hesaplanamadı.`);
  }

  const f = d.forecast;
  const tahmin = f ? { aySonuCiroKdvDahil: r2(f.projectedRevenue), aySonuKar: r2(f.projectedProfit), dayanakAy: f.refMonth } : null;
  if (f && info?.posRevenue) {
    hesap.push(`Ay sonu tahmini = ${tl(info.posRevenue)} ÷ ${num(f.daysElapsed)} gün × ${num(f.dim)} gün = ${tl(f.projectedRevenue)} ciro (KDV dahil)`);
    hesap.push(
      `Ay sonu kârı ≈ ${tl(f.projectedRevenue)} × ${pct(d.grossRatio)} brüt kâr oranı${f.refMonth ? ` (${monthLabel(f.refMonth)})` : ""} − ${tl(d.fixedStandardTotal)} standart aylık sabit gider = ${tl(f.projectedProfit)}`,
    );
  }
  if (d.breakEvenDaily !== null) {
    hesap.push(
      `Başabaş günlük ciro = ${tl(d.fixedStandardTotal)} standart aylık sabit gider ÷ ${pct(d.grossRatio)} brüt kâr oranı ÷ ayda ${num(st.acikGun)} açık gün = ${tl(d.breakEvenDaily)} (KDV dahil)`,
    );
  }

  // Kaynaklar: ay bilgisi elle mi kasa raporlarından mı (kasa grubu: Month.sources, Month.kasa.till)
  kaynak.push(kasaMonthLine(info) ?? "Ciro ve açık gün: Satışlar'a girilen ay bilgisi");
  if (info?.kasa?.till.missing.length) kaynak.push(missingSentence(info.kasa.till));
  kaynak.push("Giderler: faturalar (Paraşüt ve elle girilen), sabit giderler ve personel açık güne göre, aylık harcamalar (Gelir-gider)");
  kaynak.push(pm.site ? `laffogato.net online satışı ${monthLabel(month)} için çekildi` : "laffogato.net online satışı bu ay için yok");
  if (d.refMonth && d.refMonth !== month) kaynak.push(`Brüt kâr oranı ${monthLabel(d.refMonth)} satış listesinden`);

  if (!model.stockSheet(month).hasData && pm.revenue !== null) uyarilar.push(`${label} sayımı girilmedi: kapanış stoğu 0 sayıldı, alınan malın tamamı maliyet.`);
  for (const a of alerts(model, month).slice(0, 5)) uyarilar.push(cleanName(a.title, 120));

  return {
    ay: month,
    ayAdi: label,
    durum: STATE[d.monthState],
    acikGun: info?.openDays ?? null,
    ayinGunSayisi: dim,
    gerceklesen,
    teorik,
    tahmin,
    basaBas: { gunlukCiroKdvDahil: r2n(d.breakEvenDaily), gunlukOrtalama: r2n(d.dailyAvg), ilerlemeYuzde: pctNum(d.breakEvenProgress) },
    enCokKazandiran: d.topProducts.map((x) => ({ ad: cleanName(x.p.product.name), boy: x.p.product.size, adet: x.qty, kar: r2(x.profit) })),
    uyarilar,
    hesap,
    kaynak,
    veriOlanAylar: dataMonths(model),
    panelAdresi: panelUrl(ctx.base, `/panel?ay=${month}`),
    gelirGiderAdresi: panelUrl(ctx.base, `/panel/gelir-gider?yil=${month.slice(0, 4)}`),
  };
}

export interface YearSummary {
  yil: number;
  aylar: { ay: string; ayAdi: string; ciroKdvHaric: number; gider: number; kar: number | null; ciroGirildi: boolean }[];
  /** Yalnız cirosu girilmiş aylar (Gelir-gider'in yıl toplamı gibi) */
  toplam: { ciroKdvHaric: number; gider: number; kar: number };
  hesap: string[];
  kaynak: string[];
  panelAdresi: string;
}

export function yearSummary(model: Model, year: number, ctx: { base: string }): YearSummary {
  const rows = yearTrend(model, year);
  const active = rows.filter((r) => r.active);
  const sum = (k: "revenueNet" | "expenses" | "profit") => r2(active.reduce((a, r) => a + r[k], 0));
  const toplam = { ciroKdvHaric: sum("revenueNet"), gider: sum("expenses"), kar: sum("profit") };
  const months = yearMonths(year);
  const hesap = [
    `Her ayın kârı = KDV hariç ciro (ModPOS + laffogato.net online) − giderler (Gelir-gider)`,
    active.length
      ? `Yıl toplamı cirosu girilmiş ${num(active.length)} ay: ${active.map((r) => monthLabel(r.month)).join(", ")} → ciro ${tl(toplam.ciroKdvHaric)} − gider ${tl(toplam.gider)} = ${tl(toplam.kar)}`
      : `${year} yılında cirosu girilmiş ay yok`,
  ];
  const missing = rows.filter((r) => r.missingRevenue).map((r) => monthLabel(r.month));
  return {
    yil: year,
    aylar: rows.map((r, i) => ({
      ay: months[i],
      ayAdi: monthLabel(months[i]),
      ciroKdvHaric: r2(r.revenueNet),
      gider: r2(r.expenses),
      kar: r.active ? r2(r.profit) : null,
      ciroGirildi: r.active,
    })),
    toplam,
    hesap,
    kaynak: [
      "Gelir-gider tablosu: ciro Satışlar'daki ay bilgisinden ya da kasa raporlarından, giderler faturalardan ve sabit giderlerden",
      ...(missing.length ? [`Gideri olup cirosu girilmemiş aylar kâra girmedi: ${missing.join(", ")}`] : []),
    ],
    panelAdresi: panelUrl(ctx.base, `/panel/gelir-gider?yil=${year}`),
  };
}
