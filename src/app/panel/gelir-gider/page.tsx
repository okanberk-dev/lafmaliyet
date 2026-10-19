import { Banknote, Percent, PiggyBank, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { yearMonths, type PnlRowDef } from "@/lib/calc/engine";
import { MONTH_NAMES } from "@/lib/constants";
import { pct, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { CountUp, PnlGrid, YearPicker, type GridSection, type StripMonth } from "./pnl-grid";

export const metadata: Metadata = { title: "Gelir-gider" };

const DESCRIPTION = "Aylık gelir-gider tablosu (KDV hariç). Mal alışları faturalardan, sabit giderler açık gün oranıyla otomatik gelir.";

const SECTION_LABELS: Record<string, string> = {
  mal: "Mal alışları",
  devir: "Devirler",
  personel: "Personel giderleri",
  faturalar: "Faturalar",
  kira: "Kira",
  genel: "İşletme genel giderleri",
  komisyon: "Komisyon giderleri",
  toplam: "Toplamlar",
  sonuc: "Maliyet",
  oran: "Oranlar",
};

const NO_TOTAL = new Set(["stock:opening", "stock:closing"]);

/** Excel'den gelen büyük harfli satır adlarını cümle düzenine çevirir; kısaltmalar büyük kalır */
const ACRONYMS = ["POS", "SGK", "KDV", "AVM"];
function sentenceCase(s: string): string {
  let out = s.toLocaleLowerCase("tr-TR");
  // Kısaltmalar önce: ad bir kısaltmayla başlasa da ("KDV …") doğru kalır
  for (const a of ACRONYMS) out = out.replace(new RegExp(`(^|[^\\p{L}])${a.toLocaleLowerCase("tr-TR")}(?![\\p{L}])`, "gu"), `$1${a}`);
  return out.charAt(0).toLocaleUpperCase("tr-TR") + out.slice(1);
}

const MAX_YEAR_TABS = 5;

export default function PnlPage({ searchParams }: PageProps<"/panel/gelir-gider">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Para" title="Gelir-gider" excel="Genel Maliyet" description={DESCRIPTION} />
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
  const years = [...new Set([...known.map((k) => Number(k.slice(0, 4))), year])].sort();

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

  // Satır adları: tedarikçi ve sabit gider adları girildiği gibi, diğerleri cümle düzeninde
  const fixedNames = new Map(model.ds.fixedExpenses.map((f) => [`fixed:${f.id}`, f.name]));
  const rowLabel = (def: PnlRowDef): string => {
    if (def.key.startsWith("purchase:")) return def.key.slice("purchase:".length);
    if (def.key.startsWith("commission:") && def.key !== "commission:pos") return `${def.key.slice("commission:".length)} komisyonu`;
    return fixedNames.get(def.key) ?? sentenceCase(def.label);
  };

  const sections: GridSection[] = [];
  for (const def of defs) {
    let sec = sections.find((x) => x.key === def.section);
    if (!sec) {
      sec = { key: def.section, label: SECTION_LABELS[def.section] ?? def.section, rows: [] };
      sections.push(sec);
    }
    sec.rows.push({
      def: { ...def, label: rowLabel(def) },
      cells: calcs.map((c) => model.pnlValue(c, def.key)),
      total: totalOf(def.key),
    });
  }

  const openDays = calcs.map((c) => c.info?.openDays ?? null);
  const activeMonths = months.filter((_, i) => calcs[i].revenue !== null || calcs[i].expenses !== 0 || openDays[i] !== null);
  const revenueNet = calcs.reduce((a, c) => a + (c.revenueNet ?? 0), 0);
  const expenses = calcs.reduce((a, c) => a + c.expenses, 0);
  const profit = revenueNet - expenses;

  // Yılın 12 ayı: kâr yeşil, zarar kırmızı, cirosu girilmemiş aktif ay sarı, boş ay gri; verisi olan son ay çerçeveli
  const latestMonth = activeMonths[activeMonths.length - 1];
  const strip: StripMonth[] = months.map((m, i) => {
    const c = calcs[i];
    const name = MONTH_NAMES[i];
    const short = name.slice(0, 3);
    const last = m === latestMonth ? " (son ay)" : "";
    if (!activeMonths.includes(m)) return { key: m, short, tone: "empty", label: `${name}: veri yok` };
    if (c.revenue === null) return { key: m, short, tone: "warn", label: `${name}${last}: ciro girilmedi · giderler ${tl(c.expenses)}` };
    return { key: m, short, tone: c.profit < 0 ? "bad" : "good", label: `${name}${last}: ${c.profit < 0 ? "zarar" : "kâr"} ${tl(c.profit)}` };
  });
  const cogsRatio = revenueNet ? calcs.reduce((a, c) => a + c.cogs, 0) / revenueNet : null;

  return (
    <>
      <PageHeader
        eyebrow="Para"
        title="Gelir-gider"
        excel="Genel Maliyet"
        description={DESCRIPTION}
        actions={
          // Tek yıl varsa seçim göstermeyiz (tek seçenekli sekme düğme gibi durur, bir şey yapmaz)
          years.length < 2 ? null : years.length <= MAX_YEAR_TABS ? (
            <SegmentedLinks
              label="Yıl"
              value={String(year)}
              options={years.map((y) => ({ value: String(y), label: String(y), href: `/panel/gelir-gider?yil=${y}` }))}
            />
          ) : (
            <YearPicker year={year} years={years} />
          )
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Banknote />} label={`${year} ciro (KDV hariç)`} value={<CountUp value={revenueNet} />} sub={`${activeMonths.length} aktif ay`} />
        <Stat
          icon={<Wallet />}
          label={`${year} giderler`}
          value={<CountUp value={expenses} />}
          sub={revenueNet ? `Cironun ${pct(expenses / revenueNet, 0)}` : null}
        />
        <Stat
          icon={<PiggyBank />}
          label={`${year} kâr / zarar`}
          value={<CountUp value={profit} />}
          tone={profit < 0 ? "bad" : "good"}
          sub={revenueNet ? `Kâr oranı ${pct(profit / revenueNet)}` : null}
        />
        <Stat
          icon={<Percent />}
          label="Mal maliyeti oranı"
          value={<CountUp value={cogsRatio} format="pct" />}
          sub="Stok sayımı girilirse devir düşülür"
          info="Ay içinde satılan mal maliyeti = önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)."
        />
      </div>
      {/* Yıl değişince tablo yeniden kurulur: "Aktif aylar / 12 ay" seçimi o yılın verisine göre baştan belirlenir */}
      <PnlGrid
        key={year}
        year={year}
        months={months}
        activeMonths={activeMonths}
        sections={sections}
        openDays={openDays}
        strip={strip}
        latestMonth={latestMonth}
      />
    </>
  );
}
