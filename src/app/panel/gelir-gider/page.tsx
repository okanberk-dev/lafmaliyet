import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { yearMonths } from "@/lib/calc/engine";
import { pct, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { PnlGrid, YearPicker, type GridSection } from "./pnl-grid";

export const metadata: Metadata = { title: "Gelir-gider" };

const SECTION_LABELS: Record<string, string> = {
  mal: "MAL ALIŞLARI",
  devir: "DEVİRLER",
  personel: "PERSONEL GİDERLERİ",
  faturalar: "FATURALAR",
  kira: "KİRA",
  genel: "İŞLETME GENEL GİDERLERİ",
  komisyon: "KOMİSYON GİDERLERİ",
  toplam: "TOPLAMLAR",
  sonuc: "MALİYET",
  oran: "ORANLAR",
};

const NO_TOTAL = new Set(["stock:opening", "stock:closing"]);

export default function PnlPage({ searchParams }: PageProps<"/panel/gelir-gider">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Gelir-gider" excel="Genel Maliyet" />
          <PageSkeleton rows={14} />
        </>
      }
    >
      <PnlContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PnlContent({ searchParams }: { searchParams: PageProps<"/panel/gelir-gider">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const model = await loadModel();
  const known = [...model.monthInfo.keys(), ...model.ds.invoices.map((i) => i.date.slice(0, 7))].sort();
  const latestYear = known.length ? Number(known[known.length - 1].slice(0, 4)) : new Date().getFullYear();
  const yilParam = Array.isArray(sp.yil) ? sp.yil[0] : sp.yil;
  const year = yilParam && /^\d{4}$/.test(yilParam) ? Number(yilParam) : latestYear;
  const months = yearMonths(year);
  const calcs = months.map((m) => model.pnlMonth(m));
  const defs = model.pnlRowDefs(months);

  const totalOf = (key: string): number | null => {
    if (key.startsWith("ratio:")) {
      const rn = calcs.reduce((a, c) => a + (c.revenueNet ?? 0), 0);
      if (!rn) return null;
      const num = key === "ratio:expenses" ? totalOf("total:expenses") : key === "ratio:profit" ? totalOf("profit") : totalOf(`total:${key.slice(6)}`);
      return num === null ? null : num / rn;
    }
    if (NO_TOTAL.has(key)) return null;
    const vals = calcs.map((c) => model.pnlValue(c, key).value);
    if (vals.every((v) => v === null)) return null;
    return vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  };

  const sections: GridSection[] = [];
  for (const def of defs) {
    let sec = sections.find((x) => x.key === def.section);
    if (!sec) {
      sec = { key: def.section, label: SECTION_LABELS[def.section] ?? def.section, rows: [] };
      sections.push(sec);
    }
    sec.rows.push({
      def,
      cells: calcs.map((c) => model.pnlValue(c, def.key)),
      total: totalOf(def.key),
    });
  }

  const openDays = calcs.map((c) => c.info?.openDays ?? null);
  const activeMonths = months.filter((_, i) => calcs[i].revenue !== null || calcs[i].expenses !== 0 || openDays[i] !== null);
  const revenueNet = calcs.reduce((a, c) => a + (c.revenueNet ?? 0), 0);
  const expenses = calcs.reduce((a, c) => a + c.expenses, 0);
  const profit = revenueNet - expenses;

  return (
    <>
      <PageHeader
        title="Gelir-gider"
        excel="Genel Maliyet"
        description="Aylık gelir-gider tablosu (KDV hariç). Mal alışları faturalardan, sabit giderler açık gün oranıyla otomatik gelir. Mavi hücrelere tıklayıp değer girebilir ya da hesaplananı düzeltebilirsiniz."
        actions={<YearPicker year={year} years={[...new Set([...known.map((k) => Number(k.slice(0, 4))), year])].sort()} />}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${year} ciro (KDV hariç)`} value={tl(revenueNet)} sub={`${activeMonths.length} aktif ay`} />
        <Stat label={`${year} giderler`} value={tl(expenses)} sub={revenueNet ? `Cironun ${pct(expenses / revenueNet, 0)}` : null} />
        <Stat label={`${year} kâr / zarar`} value={tl(profit)} tone={profit < 0 ? "bad" : "good"} sub={revenueNet ? `Kâr oranı ${pct(profit / revenueNet)}` : null} />
        <Stat
          label="Mal maliyeti oranı"
          value={pct(revenueNet ? calcs.reduce((a, c) => a + c.cogs, 0) / revenueNet : null)}
          sub="Stok sayımı girilirse devir düşülür"
          info="Ay içinde satılan mal maliyeti = önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)."
        />
      </div>
      <PnlGrid months={months} activeMonths={activeMonths} sections={sections} openDays={openDays} />
    </>
  );
}
