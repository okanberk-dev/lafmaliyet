import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { MENU_CLASS_INFO, menuEngineering, scenarioBase } from "@/lib/calc/insights";
import { monthLabel } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel, resolveMonth } from "@/server/data/dataset";

import { MenuEngineering, ScenarioSimulator } from "./analysis-client";

export const metadata: Metadata = { title: "Analiz & senaryo" };

export default function AnalysisPage({ searchParams }: PageProps<"/panel/analiz">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Analiz & senaryo" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <AnalysisContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AnalysisContent({ searchParams }: { searchParams: PageProps<"/panel/analiz">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const model = await loadModel();
  const month = resolveMonth(sp.ay, model);
  const hasSales = model.monthSales(month).lines.length > 0;
  const me = menuEngineering(model, month);

  return (
    <>
      <PageHeader
        title="Analiz & senaryo"
        description="Excel'de olmayan iki araç: hangi ürünü öne çıkarmalı, hangisine zam yapmalı (menü mühendisliği) ve fiyat, maliyet ya da satış değişirse ay sonu ne olur (senaryo)."
        actions={<MonthPicker months={model.salesMonths} value={month} />}
      />
      {hasSales ? (
        <div className="space-y-6">
          <MenuEngineering
            monthLabel={monthLabel(month)}
            items={me.items.map((x) => ({
              id: x.p.product.id,
              name: x.p.product.name,
              size: x.p.product.size,
              categoryId: x.p.product.categoryId,
              category: x.p.category?.name ?? "",
              qty: x.qty,
              mix: x.mix,
              cm: x.cm,
              totalCm: x.totalCm,
              cls: x.cls,
              margin: x.p.margin,
              price: x.p.price,
              suggestedPrice: x.p.suggestedPrice,
            }))}
            popThreshold={me.popThreshold}
            avgCm={me.avgCm}
            classInfo={MENU_CLASS_INFO}
            categories={model.categories.map((c) => ({ id: c.id, name: c.name }))}
          />
          <ScenarioSimulator base={scenarioBase(model, month)} acikGun={model.settings.acikGun} monthLabel={monthLabel(month)} />
        </div>
      ) : (
        <EmptyState title="Bu ay için satış verisi yok" description="Analiz için Satışlar sayfasından ürün satış raporunu yükleyin ya da satış verisi olan bir ay seçin." />
      )}
    </>
  );
}
