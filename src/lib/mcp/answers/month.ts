/*
 * ay_ozeti: bir ayın cirosu, giderleri ve kârı Genel bakış ve Gelir-gider'deki hesapla (dashboard, pnlMonth); yıl
 * verilirse yılın ayları (yearTrend). Saf; tests/claude-araclar.test.ts. Rakamlar ekranlarla aynı yoldan gelir, burada
 * ikinci bir hesap yoktur: yalnız yuvarlanır ve hesap satırlarına yazılır.
 */

import { daysInMonth, uncountedCogsSummary, uncountedCogsText, yearMonths, type Model } from "../../calc/engine";
import { alerts, dashboard, missingRevenueText, yearTotals, yearTrend } from "../../calc/insights";
import { kasaMonthLine, missingSentence } from "../../cash-month";
import { monthKasa, periodKasa } from "../../asilpos/kasa";
import { cleanName, monthLabel, num, panelUrl, pct, pctNum, r2, r2n, tl } from "./common";

export interface MonthSummary {
  ay: string;
  ayAdi: string;
  durum: "suruyor" | "bitti" | "gelecek";
  acikGun: number | null;
  ayinGunSayisi: number;
  /**
   * Faturaya göre (Gelir-gider); ne POS cirosu ne online satış varsa null. POS cirosu girilmemişse (yalnız laffogato.net
   * online satışı) ciro, kâr ve marj null, giderler ve online satış durur: panel de o ayın kârını saymaz
   */
  gerceklesen: {
    ciroKdvDahil: number | null;
    ciroKdvHaric: number | null;
    onlineKdvHaric: number | null;
    toplamCiroKdvHaric: number | null;
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
    kar: number | null;
    karMarjiYuzde: number | null;
  } | null;
  /** Reçeteye göre (Genel bakış); satış listesi olmayan ayda null */
  teorik: {
    netSatis: number;
    /** laffogato.net online satışı (netSatis'in içinde, KDV hariç) ve brüt kârı; çekilmemiş ayda null */
    onlineNetSatis: number | null;
    onlineBrutKar: number | null;
    malzeme: number;
    komisyon: number;
    brutKar: number;
    indirim: number;
    sabitGider: number;
    netKar: number;
  } | null;
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
  // Ayın kasası (metinler; geçiş günü boşken ve öncesinde ModPOS, sonra AsilPOS; denetim E-39)
  const mk = monthKasa(month, st.asilposGecisGunu);
  const d = dashboard(model, month);
  const pm = model.pnlMonth(month);
  const info = d.info;
  const label = monthLabel(month);
  const dim = daysInMonth(month);
  const hesap: string[] = [];
  const kaynak: string[] = [];
  const uyarilar: string[] = [];

  // Panelin kuralı: POS cirosu girilmemiş ayın kârı sayılmaz (Genel bakış'ta hasRevenue; yıl toplamında yearTotals:
  // Gelir-gider kartları, Genel bakış ve yearSummary aynı). Yalnız laffogato.net online satışı olan ay (her ayın 1'i, kasa raporları gecikince) %100 marjlı ya da
  // faturalar gelince büyük zararda görünmesin: ciro ve kâr null, giderler ve online satış yerinde
  const hasPos = pm.revenue !== null;
  let gerceklesen: MonthSummary["gerceklesen"] = null;
  if (hasPos || pm.site) {
    const total = pm.revenueTotalNet ?? 0;
    gerceklesen = {
      ciroKdvDahil: r2n(pm.revenue),
      ciroKdvHaric: r2n(pm.revenueNet),
      onlineKdvHaric: r2n(pm.site?.total),
      toplamCiroKdvHaric: hasPos ? r2(total) : null,
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
      kar: hasPos ? r2(pm.profit) : null,
      karMarjiYuzde: hasPos && total ? pctNum(pm.profit / total) : null,
    };
    if (pm.revenue !== null) {
      const ciroNet = pm.revenueNet ?? 0;
      hesap.push(`Kâr = KDV hariç ciro − giderler = ${tl(total)} − ${tl(pm.expenses)} = ${tl(pm.profit)}`);
      const service = pm.serviceRevenue;
      // AsilPOS'un şubesinin ayında KDV gün gün (engine.ts posNet): AsilPOS günü kendi dökümüyle, öteki günler günün
      // oranıyla, ay günlerin toplamı; ay toplamının formülü o rakamı vermez (Marina Kasım: 30.576,15, ay toplamından ,14)
      const pos = model.posNet(month)?.byDay
        ? `${tl(pm.revenue)} gün gün (AsilPOS günü kendi KDV dökümüyle, öteki günler ÷ ${kdvText(st.kdv)}${service > 0 ? `, hizmet ÷ ${kdvText(st.kdvHizmet)}` : ""}; ay günlerin toplamı)`
        : service > 0
          ? `(${tl(pm.revenue)} − ${tl(service)} hizmet) ÷ ${kdvText(st.kdv)} + ${tl(service)} ÷ ${kdvText(st.kdvHizmet)}`
          : `${tl(pm.revenue)} ÷ ${kdvText(st.kdv)}`;
      hesap.push(`KDV hariç ciro = ${pos} = ${tl(ciroNet)} (${mk.long}${pm.site ? `; laffogato.net online ${tl(pm.site.total)} ayrıca eklendi, toplam ${tl(total)}` : "; online satış yok"})`);
    } else if (pm.site) {
      hesap.push(`laffogato.net online satışı ${tl(pm.site.total)} (KDV hariç); POS cirosu girilmediği için kâr hesaplanmadı`);
    }
    hesap.push(
      `Giderler = mal maliyeti ${tl(pm.cogs)} + personel ${tl(pm.sections.personel)} + faturalar ${tl(pm.sections.faturalar)} + kira ${tl(pm.sections.kira)} + genel ${tl(pm.sections.genel)} + komisyon ${tl(pm.sections.komisyon)}`,
    );
    hesap.push(`Mal maliyeti = açılış stoğu ${tl(pm.opening)} + alınan mal ${tl(pm.purchases)} − kapanış stoğu ${tl(pm.closing)}`);
    if (pm.prorationDays > 0 && pm.prorationDays < dim) {
      hesap.push(
        pm.prorationDays === pm.openDays
          ? `Sabit giderler açık güne göre: ${num(pm.openDays)} / ${num(dim)} gün`
          : `Sabit giderler ayın geçen gününe göre (açık gün kasa raporlarından): ${num(pm.prorationDays)} / ${num(dim)} gün`,
      );
    }
  } else if (pm.expenses > 0) {
    hesap.push(`Şimdiye kadarki giderler ${tl(pm.expenses)} (ciro girilince kâr hesaplanır)`);
  }
  if (!hasPos) uyarilar.push(`${label} için POS cirosu girilmedi (Satışlar'daki ay bilgisi ya da kasa raporu): faturaya göre kâr hesaplanmadı.`);

  const t = d.theoretical;
  const teorik = t
    ? {
        netSatis: r2(t.netSales),
        // laffogato.net online satışı (KDV hariç, reçeteye göre); çekilmemiş ayda null
        onlineNetSatis: t.online ? r2(t.online.revenue) : null,
        onlineBrutKar: t.online ? r2(t.online.grossProfit) : null,
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
      `Reçeteye göre net kâr = brüt kâr ${tl(t.grossProfit)} (net satış ${tl(t.netSales)}${
        t.online ? ` = ${mk.short} ${tl(t.posNetSales)} + laffogato.net online ${tl(t.online.revenue)}` : ""
      } − malzeme ${tl(t.material)} − komisyon ${tl(t.commission)}) − indirim ${tl(t.discountsNet)} − sabit gider ${tl(t.fixedTotal)} = ${tl(t.netProfit)}`,
    );
    if (t.listPeriod) {
      hesap.push(
        `Satış listesi ayın ${num(t.listPeriod.of)} gününün ${num(t.listPeriod.days)}'ini kapsıyor (${t.listPeriod.from} – ${t.listPeriod.through}): indirim o günlerin kasa raporlarından, sabit gider ve online satış o günlere düşen payla`,
      );
    }
  } else {
    uyarilar.push(`${label} için ürün satış listesi yok: reçeteye göre kâr hesaplanamadı.`);
  }

  const f = d.forecast;
  const tahmin = f ? { aySonuCiroKdvDahil: r2(f.projectedRevenue), aySonuKar: r2(f.projectedProfit), dayanakAy: f.refMonth } : null;
  if (f && info?.posRevenue) {
    hesap.push(
      `Ay sonu tahmini = ${tl(info.posRevenue)} ÷ ${num(f.daysElapsed)} gün × ${num(f.monthDays)} gün${f.closedDays ? ` (${num(f.dim)} günden ${num(f.closedDays)} kapalı işaretli gün düşüldü)` : ""} = ${tl(f.projectedRevenue)} ciro (KDV dahil)`,
    );
    hesap.push(
      `Ay sonu kârı ≈ ${tl(f.projectedRevenue)} × ${pct(d.grossRatio)} brüt kâr oranı${f.refMonth ? ` (${monthLabel(f.refMonth)})` : ""}${
        f.projectedOnline !== null ? ` + ${tl(f.projectedOnline)} laffogato.net online brüt kârı` : ""
      } − ${tl(d.fixedStandardTotal)} standart aylık sabit gider${d.breakEven.expensesTotal ? ` − ${tl(d.breakEven.expensesTotal)} her ay girilen harcamalar` : ""} = ${tl(f.projectedProfit)}`,
    );
  }
  if (d.breakEvenDaily !== null) {
    const be = d.breakEven;
    const parts = [`${tl(be.standard)} standart aylık sabit gider`];
    if (be.expensesTotal) parts.push(`+ ${tl(be.expensesTotal)} her ay girilen harcamalar`);
    if (be.onlineCover) parts.push(`− ${tl(be.onlineCover.grossProfit)} laffogato.net online brüt kârı (${monthLabel(be.onlineCover.month)})`);
    hesap.push(
      `Başabaş günlük ciro = ${parts.length > 1 ? `(${parts.join(" ")})` : parts[0]} ÷ ${pct(d.grossRatio)} brüt kâr oranı ÷ ayda ${num(st.acikGun)} açık gün = ${tl(d.breakEvenDaily)} (KDV dahil)`,
    );
  }

  // Kaynaklar: ay bilgisi elle mi kasa raporlarından mı (kasa grubu: Month.sources, Month.kasa.till)
  kaynak.push(kasaMonthLine(info) ?? "Ciro ve açık gün: Satışlar'a girilen ay bilgisi");
  if (info?.kasa?.till.missing.length || info?.kasa?.till.closed?.length) kaynak.push(missingSentence(info.kasa.till));
  kaynak.push("Giderler: faturalar (Paraşüt ve elle girilen), sabit giderler ve personel açık güne göre, aylık harcamalar (Gelir-gider)");
  kaynak.push(pm.site ? `laffogato.net online satışı ${monthLabel(month)} için çekildi` : "laffogato.net online satışı bu ay için yok");
  if (d.refMonth && d.refMonth !== month) kaynak.push(`Brüt kâr oranı ${monthLabel(d.refMonth)} satış listesinden`);

  if (!model.stockSheet(month).hasData && pm.revenue !== null) uyarilar.push(`${label} sayımı girilmedi: ${uncountedCogsText(pm.cogsMethod)}.`);
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
  // Yıl toplamı Gelir-gider kartlarıyla ve Genel bakış'la aynı kuraldan (yearTotals: bu aya kadar, cirosu girilmiş aylar)
  const yt = yearTotals(model, year);
  const toplam = { ciroKdvHaric: r2(yt.revenueNet), gider: r2(yt.expenses), kar: r2(yt.profit) };
  const months = yearMonths(year);
  const hesap = [
    `Her ayın kârı = KDV hariç ciro (${periodKasa(months, model.settings.asilposGecisGunu).both} + laffogato.net online) − giderler (Gelir-gider)`,
    active.length
      ? `Yıl toplamı cirosu girilmiş ${num(active.length)} ay: ${active.map((r) => monthLabel(r.month)).join(", ")} → ciro ${tl(toplam.ciroKdvHaric)} − gider ${tl(toplam.gider)} = ${tl(toplam.kar)}`
      : `${year} yılında cirosu girilmiş ay yok`,
  ];
  const missing = yt.missingRevenue.map(missingRevenueText);
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
      ...(missing.length ? [`Gideri olup cirosu girilmemiş aylar kâra girmedi: ${missing.join("; ")}`] : []),
      ...(yt.uncounted.length ? [`Ay sonu sayımı olmayan aylar: ${uncountedCogsSummary((m) => model.pnlMonth(m).cogsMethod, yt.uncounted)}`] : []),
    ],
    panelAdresi: panelUrl(ctx.base, `/panel/gelir-gider?yil=${year}`),
  };
}
