import { desc } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { alerts, consistency } from "@/lib/calc/insights";
import { monthLabel, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { ConsistencyTable, Findings } from "./consistency-client";

export const metadata: Metadata = { title: "Tutarlılık kontrolü" };

export default function ConsistencyPage({ searchParams }: PageProps<"/panel/tutarlilik">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Tutarlılık kontrolü" excel="Tutarlılık Kontrolü" />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <ConsistencyContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ConsistencyContent({ searchParams }: { searchParams: PageProps<"/panel/tutarlilik">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const [model, findings] = await Promise.all([loadModel(), getDb().select().from(s.findings).orderBy(desc(s.findings.createdAt), desc(s.findings.id))]);
  const month = resolveMonth(sp.ay, model);
  const c = consistency(model, month);
  const autos = alerts(model, month);
  const st = model.settings;

  const salesRows: { label: string; value: string; note?: string; strong?: boolean }[] = [
    { label: "Ürün listesi toplamı (indirim öncesi)", value: tl(c.sales.listTotal), note: "Satışlar sayfasındaki POS ürünleri" },
    { label: "– Yönetici indirimleri", value: tl(-c.sales.discounts) },
    { label: "Hesaplanan ciro (liste − indirim)", value: tl(c.sales.computed), strong: true },
    { label: "POS ciro raporu", value: tl(c.sales.pos), note: "Satışlar > ay bilgileri" },
    { label: "Fark", value: c.sales.diff === null ? "–" : tl(c.sales.diff), strong: true },
    { label: "Ödenmez (sahip / personel tüketimi) – satış listesine dahil değil", value: tl(c.sales.offRevenue) },
    {
      label: "Ödenmezlerin tahmini malzeme maliyeti",
      value: tl(c.sales.offRevenueCost),
      note: "Tutar ÷ (1 + KDV) × ortalama maliyet oranı. Bu maliyet Panel'deki kâra dahil değildir.",
    },
  ];

  const ingredientOptions = model.ds.ingredients
    .filter((i) => i.active && i.priceSource === "manual")
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  return (
    <>
      <PageHeader
        title="Tutarlılık kontrolü"
        excel="Tutarlılık Kontrolü"
        description="POS satışları ↔ faturalar ↔ reçeteler karşılaştırması: hangi malzeme reçeteden fazla alınıyor, hangi alım hiçbir reçetede yok, satışlar POS cirosuyla tutuyor mu?"
        actions={<MonthPicker months={availableMonths(model)} value={month} />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="1) Satış kaynakları tutuyor mu?" description={`${monthLabel(month)} · POS ürün listesi ile POS ciro raporu`} />
          <CardContent className="space-y-2 text-sm">
            {c.sales.hasLines ? (
              <>
                {salesRows.map((r) => (
                  <div key={r.label} className={cn("flex items-baseline justify-between gap-4", r.strong && "font-semibold")}>
                    <span className="text-coffee-800">
                      {r.label}
                      {r.note ? <span className="block text-xs font-normal text-coffee-500">{r.note}</span> : null}
                    </span>
                    <span className="shrink-0 tabular">{r.value}</span>
                  </div>
                ))}
                <div className={cn("mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", c.sales.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
                  {c.sales.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  {c.sales.ok
                    ? `Tutarlı (fark %${((Math.abs(c.sales.diff ?? 0) / (c.sales.pos || 1)) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })})`
                    : c.sales.pos === null
                      ? "POS ciro raporu girilmemiş"
                      : "Kontrol edin: fark 1.000 ₺'den büyük"}
                </div>
              </>
            ) : (
              <p className="text-coffee-600">
                Bu ay için satış raporu yok.{" "}
                <Link href={`/panel/satislar?ay=${month}`} className="font-medium underline">
                  Satışlar sayfasından yükleyin
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Otomatik kontroller" description="Sistem her sayfa açılışında veriyi tarar" />
          <CardContent className="space-y-2">
            {autos.length ? (
              autos.map((a, i) => {
                const Icon = a.level === "danger" ? CircleAlert : a.level === "warning" ? AlertTriangle : Info;
                return (
                  <Link key={i} href={a.href ?? "#"} className="flex gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-coffee-50">
                    <Icon size={16} className={cn("mt-0.5 shrink-0", a.level === "danger" ? "text-rose-600" : a.level === "warning" ? "text-amber-600" : "text-sky-600")} />
                    <span>
                      <span className="font-medium">{a.title}</span>
                      <span className="block text-xs text-coffee-600">{a.detail}</span>
                    </span>
                  </Link>
                );
              })
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Her şey yolunda görünüyor.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <ConsistencyTable
          month={month}
          monthLabel={monthLabel(month)}
          rows={c.rows.map((r) => ({
            ingredientId: r.ingredient.id,
            name: r.ingredient.name,
            unit: r.ingredient.unit,
            unitCost: r.unitCost,
            usage: r.usage,
            purchased: r.purchased,
            ratio: r.ratio,
            diffAmount: r.diffAmount,
            opening: r.opening,
            closing: r.closing,
            actualUsage: r.actualUsage,
            variance: r.variance,
            varianceAmount: r.varianceAmount,
            note: r.note,
          }))}
          totalDiff={c.totalDiff}
          totalVariance={c.totalVariance}
          hasStock={c.hasStockComparison}
          ingredients={ingredientOptions}
          fire={st.fire}
        />
      </div>

      <div className="mt-6">
        <Findings
          items={findings.map((f) => ({
            id: f.id,
            section: f.section,
            title: f.title,
            detail: f.detail,
            resolved: f.resolved,
            createdAt: f.createdAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
