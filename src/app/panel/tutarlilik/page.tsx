import { desc } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, CircleAlert, ClipboardList, Info, Receipt, Scale, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import type { PastelTone } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, KeyValue, PageSkeleton, Stat } from "@/components/ui/misc";
import { alerts, consistency, type Alert } from "@/lib/calc/insights";
import { monthLabel, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { ConsistencyTable, CountUp, Findings, SeverityBar } from "./consistency-client";
import { severityOf } from "./severity";

export const metadata: Metadata = { title: "Tutarlılık kontrolü" };

const TITLE = "Tutarlılık kontrolü";
const EXCEL = "Tutarlılık Kontrolü";

export default function ConsistencyPage({ searchParams }: PageProps<"/panel/tutarlilik">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Stok" title={TITLE} excel={EXCEL} tabs={<SectionTabs section="stok" current="/panel/tutarlilik" />} />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <ConsistencyContent searchParams={searchParams} />
    </Suspense>
  );
}

/** Otomatik kontrol düzeyi → AkmanOS recent-activity kuyusu (0 yeşil · 1 turuncu · 2 mavi · 3 kırmızı) */
const ALERT_STYLE: Record<Alert["level"], { icon: typeof Info; tone: PastelTone; label: string; dot?: "danger" }> = {
  danger: { icon: CircleAlert, tone: 3, label: "Önemli", dot: "danger" },
  warning: { icon: AlertTriangle, tone: 1, label: "Uyarı" },
  info: { icon: Info, tone: 2, label: "Bilgi" },
};

async function ConsistencyContent({ searchParams }: { searchParams: PageProps<"/panel/tutarlilik">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const [model, findings] = await Promise.all([loadModel(), getDb().select().from(s.findings).orderBy(desc(s.findings.createdAt), desc(s.findings.id))]);
  const month = resolveMonth(sp.ay, model);
  const c = consistency(model, month);
  const autos = alerts(model, month);
  const st = model.settings;
  const ml = monthLabel(month);

  const salesRows: { label: string; value: string; note?: string; strong?: boolean }[] = [
    { label: "Ürün listesi toplamı (indirim öncesi)", value: tl(c.sales.listTotal), note: "Satışlar sayfasındaki POS ürünleri" },
    { label: "– Yönetici indirimleri", value: tl(-c.sales.discounts) },
    { label: "Hesaplanan ciro (liste − indirim)", value: tl(c.sales.computed), strong: true },
    { label: "POS ciro raporu", value: tl(c.sales.pos), note: "Satışlar > ay bilgileri" },
    { label: "Fark", value: c.sales.diff === null ? "–" : tl(c.sales.diff), strong: true },
    { label: "Ödenmez (sahip / personel tüketimi)", value: tl(c.sales.offRevenue), note: "Satış listesine dahil değil; ciroya girmez." },
    {
      label: "Ödenmezlerin tahmini malzeme maliyeti",
      value: tl(c.sales.offRevenueCost),
      note: "Tutar ÷ (1 + KDV) × ortalama maliyet oranı. Bu maliyet Panel'deki kâra dahil değildir.",
    },
  ];
  const salesDiffPct = num((Math.abs(c.sales.diff ?? 0) / (c.sales.pos || 1)) * 100, 1);
  const salesMessage = c.sales.ok
    ? `Tutarlı (fark %${salesDiffPct})`
    : c.sales.pos === null
      ? "POS ciro raporu girilmemiş"
      : "Kontrol edin: fark 1.000 ₺'den büyük";

  const ingredientOptions = model.ds.ingredients
    .filter((i) => i.active && i.priceSource === "manual")
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  const severities = c.rows.map((r) => severityOf({ usage: r.usage, purchased: r.purchased, ratio: r.ratio }));
  const bigCount = severities.filter((x) => x === "big").length;
  const diffCount = severities.filter((x) => x === "big" || x === "diff").length;
  const purchasedCount = c.rows.filter((r) => r.purchased !== null).length;

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title={TITLE}
        excel={EXCEL}
        description="POS satışları ↔ faturalar ↔ reçeteler: hangi malzeme reçeteden fazla alınıyor, hangi alım hiçbir reçetede yok, satışlar POS cirosuyla tutuyor mu?"
        actions={<MonthPicker months={availableMonths(model)} value={month} />}
        tabs={<SectionTabs section="stok" current="/panel/tutarlilik" />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<AlertTriangle />}
          label="Büyük fark"
          value={<CountUp value={bigCount} />}
          suffix={purchasedCount ? "malzeme" : undefined}
          tone={!purchasedCount ? "default" : bigCount ? "bad" : diffCount ? "warn" : "good"}
          info="Büyük fark: alınan miktar reçeteye göre kullanımın 1,5 katından fazla ya da ay içinde hiç kullanılmadığı hâlde alım var. Fark var: 1,15 katından fazla."
          sub={purchasedCount ? `${num(diffCount)} malzemede fark var · ${num(purchasedCount)} alım girildi` : "Bu ay alım girilmemiş"}
        >
          {purchasedCount ? <SeverityBar big={bigCount} diff={diffCount - bigCount} ok={purchasedCount - diffCount} /> : null}
        </Stat>
        <Stat
          icon={<Scale />}
          label="Fatura farkı"
          value={<CountUp value={c.totalDiff} kind="tl" />}
          info="Reçete ↔ fatura: (alınan − reçeteye göre kullanılan) × birim maliyet, tüm malzemelerin toplamı. Pozitif = reçeteye göre fazla alınan malın parası."
          sub="Alınan − reçeteye göre kullanılan"
        />
        <Stat
          icon={<ClipboardList />}
          label="Sayım sapması"
          value={c.hasStockComparison ? <CountUp value={c.totalVariance} kind="tl" /> : "–"}
          tone={c.hasStockComparison && c.totalVariance > 0 ? "bad" : "default"}
          info="Gerçek tüketim (geçen ay sayımı + alınan − bu ay sayımı) ile reçeteye göre kullanımın farkı × birim maliyet. Yalnızca iki ayı sayılan ve bu ayın alımı girilen malzemeler toplanır; alım girilmeyen 0 sayılmaz. Pozitif = fire, ikram, porsiyon kaçağı."
          sub={
            <>
              {c.hasStockComparison ? (
                "Gerçek tüketim − reçeteye göre"
              ) : c.hasCounts ? (
                "İki ayın sayımı var; alım miktarı gerekli"
              ) : (
                <Link href={`/panel/sayim?ay=${month}`} className="-my-3.5 inline-block py-3.5 font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
                  İki ayın sayımı gerekli
                </Link>
              )}
              {c.needsPurchaseCount ? (
                <Link
                  href={`/panel/tutarlilik?ay=${month}&eksik=1`}
                  className="-my-3 block py-3 font-medium text-warn underline underline-offset-2 hover:text-ink"
                >
                  {num(c.needsPurchaseCount)} malzemede alım girilmeli
                </Link>
              ) : null}
              {c.unreciped.count ? (
                <span className="block">
                  Reçetesiz tüketim: {num(c.unreciped.count)} malzeme · {tl(c.unreciped.amount)}
                </span>
              ) : null}
            </>
          }
        />
        <Stat
          icon={<Receipt />}
          label="Satış ↔ POS"
          value={!c.sales.hasLines ? "Rapor yok" : c.sales.ok ? "Tutarlı" : c.sales.pos === null ? "POS yok" : <CountUp value={c.sales.diff ?? 0} kind="tl" />}
          tone={!c.sales.hasLines ? "default" : c.sales.ok ? "good" : "warn"}
          sub={!c.sales.hasLines ? "Bu ay satış raporu yok" : c.sales.ok ? `Fark %${salesDiffPct}` : c.sales.pos === null ? "POS ciro raporu girilmemiş" : "Fark 1.000 ₺'den büyük"}
        />
      </div>

      <ConsistencyTable
        key={month}
        month={month}
        monthLabel={ml}
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
          stockDrop: r.stockDrop,
          stock: r.stock,
          inRecipe: r.inRecipe,
          note: r.note,
        }))}
        totalDiff={c.totalDiff}
        totalVariance={c.totalVariance}
        hasStock={c.hasCounts}
        hasComparison={c.hasStockComparison}
        ingredients={ingredientOptions}
        fire={st.fire}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Receipt />} title="Satış kaynakları tutuyor mu?" description={`${ml} · POS ürün listesi ile POS ciro raporu`} />
          <CardContent>
            {c.sales.hasLines ? (
              <>
                <Well className="divide-y divide-line py-1">
                  {salesRows.map((r) => (
                    <KeyValue
                      key={r.label}
                      strong={r.strong}
                      label={
                        <span>
                          {r.label}
                          {r.note ? <InfoTip text={r.note} className="ml-1.5" /> : null}
                        </span>
                      }
                      // Uzun etiketin yanında tutar "18.815 / ₺" diye ikiye bölünmesin
                      value={<span className="whitespace-nowrap">{r.value}</span>}
                    />
                  ))}
                </Well>
                <p
                  className={cn(
                    "mt-3 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-medium",
                    c.sales.ok ? "bg-good-soft text-good" : "bg-warn-soft text-warn",
                  )}
                >
                  {c.sales.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
                  {salesMessage}
                </p>
              </>
            ) : (
              <Well>
                <EmptyState
                  icon={<Receipt />}
                  title="Bu ay için satış raporu yok"
                  description="POS ürün listesi yüklenince ciro karşılaştırması burada çıkar."
                  action={
                    <ButtonLink href={`/panel/satislar?ay=${month}`} variant="secondary">
                      Satışlar sayfasından yükleyin
                    </ButtonLink>
                  }
                />
              </Well>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            icon={<ShieldCheck />}
            title="Otomatik kontroller"
            description="Sistem her sayfa açılışında veriyi tarar"
            meta={autos.length ? <span className="tabular">{num(autos.length)} uyarı</span> : undefined}
          />
          <CardContent>
            {autos.length ? (
              <ActivityList className="-mt-2">
                {autos.map((a, i) => {
                  const { icon: Icon, tone, label, dot } = ALERT_STYLE[a.level];
                  return (
                    <ActivityItem
                      key={i}
                      wrap
                      icon={<Icon />}
                      tone={tone}
                      dot={dot}
                      href={a.href}
                      aside={label}
                      title={a.title}
                      description={a.detail}
                    />
                  );
                })}
              </ActivityList>
            ) : (
              <p className="flex items-center gap-2 rounded-2xl bg-good-soft px-3.5 py-2.5 text-sm font-medium text-good">
                <CheckCircle2 size={16} className="shrink-0" /> Her şey yolunda görünüyor.
              </p>
            )}
          </CardContent>
        </Card>
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
