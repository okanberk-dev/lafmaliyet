import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { shiftMonth } from "@/lib/calc/engine";
import { monthLabel } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { availableMonths, loadModel } from "@/server/data/dataset";

import { StockCountForm } from "./stock-form";

export const metadata: Metadata = { title: "Stok sayımı" };

export default function StockPage({ searchParams }: PageProps<"/panel/sayim">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Stok sayımı" excel="Sayım" />
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

  return (
    <>
      <PageHeader
        title="Stok sayımı"
        excel="Sayım"
        description={`${monthLabel(month)} ay sonu sayımı. Ayın son günü kapanıştan sonra sayın; miktarı sayım biriminde yazın (KG, LT, ADET, DİLİM). Yarım = 0,5.`}
        actions={<MonthPicker months={[...new Set([...availableMonths(model), month])].sort()} value={month} />}
      />
      <StockCountForm
        key={month}
        month={month}
        monthLabel={monthLabel(month)}
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
      />
    </>
  );
}
