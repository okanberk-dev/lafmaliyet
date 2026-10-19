import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { shiftMonth } from "@/lib/calc/engine";
import { monthLabel, monthShort } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { availableMonths, loadModel } from "@/server/data/dataset";

import { StockCountForm } from "./stock-form";

export const metadata: Metadata = { title: "Stok sayımı" };

export default function StockPage({ searchParams }: PageProps<"/panel/sayim">) {
  return (
    <Suspense
      fallback={
        <>
          {/* Rol henüz bilinmediği için sekmeler yalnızca içerik yüklenince (yöneticiye) çizilir */}
          <PageHeader title="Stok sayımı" eyebrow="Stok" excel="Sayım" />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <StockContent searchParams={searchParams} />
    </Suspense>
  );
}

async function StockContent({ searchParams }: { searchParams: PageProps<"/panel/sayim">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const model = await loadModel();
  const ay = Array.isArray(sp.ay) ? sp.ay[0] : sp.ay;
  const knownMonths = [...model.monthInfo.keys()].sort();
  const month = ay && /^\d{4}-\d{2}$/.test(ay) ? ay : (knownMonths[knownMonths.length - 1] ?? new Date().toISOString().slice(0, 7));
  const sheet = model.stockSheet(month);
  const prev = model.stockSheet(shiftMonth(month, -1));
  const isAdmin = user.role === "admin";
  const prevQty = new Map(prev.groups.flatMap((g) => g.lines.filter((l) => l.qty !== null).map((l) => [l.ingredient.id, l.qty as number])));
  const ml = monthLabel(month);
  // Sayım düzeni: seçili ay dahil son 6 ayın hangilerinde sayım girilmiş
  const history = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => ({
    month: m,
    short: monthShort(m),
    label: monthLabel(m),
    counted: model.stockSheet(m).hasData,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Stok sayımı"
        excel="Sayım"
        description={`${ml} ay sonu sayımı: ayın son günü kapanıştan sonra sayın. Miktarı sayım biriminde yazın (KG, LT, ADET, DİLİM); yarım = 0,5.`}
        actions={<MonthPicker months={[...new Set([...availableMonths(model), month])].sort()} value={month} />}
        tabs={isAdmin ? <SectionTabs section="stok" current="/panel/sayim" /> : undefined}
      />
      <StockCountForm
        key={month}
        month={month}
        monthLabel={ml}
        isAdmin={isAdmin}
        groups={sheet.groups.map((g) => ({
          name: g.name,
          lines: g.lines.map((l) => ({
            id: l.ingredient.id,
            name: l.ingredient.name,
            packageDesc: l.ingredient.packageDesc,
            countUnit: l.ingredient.countUnit ?? "ADET",
            qty: l.qty,
            prevQty: prevQty.get(l.ingredient.id) ?? null,
            unitPrice: isAdmin ? l.unitPrice : 0,
            vatRate: isAdmin ? l.ingredient.vatRate : 0,
          })),
        }))}
        extras={isAdmin ? sheet.extras.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, unitPrice: e.unitPrice })) : []}
        hasPrev={prev.hasData}
        history={history}
        prevTotal={isAdmin && prev.hasData ? prev.total : null}
      />
    </>
  );
}
