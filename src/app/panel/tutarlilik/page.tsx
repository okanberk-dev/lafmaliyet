import { desc } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, CircleAlert, ClipboardList, Globe, Info, Link2, Receipt, Scale, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MonthPicker, MonthPickerSkeleton } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import type { PastelTone } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, KeyValue, PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { alerts, consistency, listDaysText, type Alert } from "@/lib/calc/insights";
import { dateTimeTR, monthLabel, num, tl } from "@/lib/format";
import { HOLDS_HREF } from "@/lib/price-hold";
import { sizeLabel } from "@/lib/site-sales/calc";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { pendingWasteSummary } from "@/server/data/waste-requests";
import { availableMonths, loadModel, resolveMonth } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";

import { consistencyBreakdowns, hasNegative } from "./breakdowns";
import { ConsistencyTable, CountUp, Findings, SeverityBar } from "./consistency-client";
import { severityOf } from "./severity";

export const metadata: Metadata = { title: "Tutarlılık kontrolü" };

const TITLE = "Tutarlılık kontrolü";
const EXCEL = "Tutarlılık Kontrolü";
const DESCRIPTION =
  "POS satışları ↔ faturalar ↔ reçeteler: hangi malzeme reçeteden fazla alınıyor, hangi alım hiçbir reçetede yok, satışlar POS cirosuyla tutuyor mu?";

export default function ConsistencyPage({ searchParams }: PageProps<"/panel/tutarlilik">) {
  return (
    <Suspense
      fallback={
        <>
          {/* Yüklenen başlıkla aynı boy (açıklama, ay seçicinin yeri): Stok sekmeleri içerik gelince kaymaz */}
          <PageHeader
            eyebrow="Stok"
            title={TITLE}
            excel={EXCEL}
            description={DESCRIPTION}
            actions={<MonthPickerSkeleton />}
            tabs={<SectionTabs section="stok" current="/panel/tutarlilik" role="admin" />}
          />
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
  const [model, findings, linkedRows] = await Promise.all([
    loadModel(),
    getDb().select().from(s.findings).orderBy(desc(s.findings.createdAt), desc(s.findings.id)),
    // Paraşüt'teki bir ürüne bağlı hammaddeler: alımı faturadan gelir; bu ay faturası yoksa toplu "Alım yok (0)"
    getDb().selectDistinct({ id: s.parasutProductLinks.ingredientId }).from(s.parasutProductLinks),
  ]);
  const linked = new Set(linkedRows.map((r) => r.id));
  const month = resolveMonth(sp.ay, model);
  // Bu aya düşen, onay bekleyen geç zayi / ikram ve silme istekleri (dalga 10 §2.8): onaylanırsa tutarlılık değişir
  const waiting = await pendingWasteSummary({ month }).catch(() => null);
  const c = consistency(model, month);
  const autos = alerts(model, month);
  const st = model.settings;
  const ml = monthLabel(month);

  const listDays = c.sales.listPeriod ? listDaysText(c.sales.listPeriod) : null;
  const salesRows: { label: string; value: string; note?: string; strong?: boolean }[] = [
    { label: "Ürün listesi toplamı (indirim öncesi)", value: tl(c.sales.listTotal), note: "Satışlar sayfasındaki POS ürünleri" },
    // Süren ayda yapıştırılan liste kasa raporlarından kısaysa indirim ve POS cirosu listenin günlerinin
    {
      label: listDays ? `– Yönetici indirimleri (${listDays})` : "– Yönetici indirimleri",
      value: tl(-c.sales.discounts),
      note: listDays ? `${listDays} kasa raporları: satış listesi bu günleri kapsıyor` : undefined,
    },
    { label: "Hesaplanan ciro (liste − indirim)", value: tl(c.sales.computed), strong: true },
    {
      label: listDays ? `POS ciro raporu (${listDays})` : "POS ciro raporu",
      value: tl(c.sales.pos),
      note: listDays ? `${listDays} kasa raporlarının Z toplamı: satış listesi bu günleri kapsıyor` : "Satışlar > ay bilgileri",
    },
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

  const severities = c.rows.map((r) => severityOf({ usage: r.usage, purchased: r.purchased, ratio: r.ratio, held: r.held, rejected: r.rejected }));
  const bigCount = severities.filter((x) => x === "big").length;
  const diffCount = severities.filter((x) => x === "big" || x === "diff").length;
  const purchasedCount = c.rows.filter((r) => r.purchased !== null).length;
  // Kartlara dokununca açılan döküm: malzeme malzeme, kartın rakamını tutar (breakdowns.ts)
  const bd = consistencyBreakdowns(c, month);

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title={TITLE}
        excel={EXCEL}
        description={DESCRIPTION}
        actions={<MonthPicker months={availableMonths(model)} value={month} />}
        tabs={<SectionTabs section="stok" current="/panel/tutarlilik" role="admin" />}
      />

      {waiting?.count ? (
        <p className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Bu ay için onay bekleyen {num(waiting.count)} zayi / ikram isteği ·{" "}
          <Link href={`/panel/onaylar#istek-${waiting.firstId}`} className="font-medium underline underline-offset-2">
            Onaylar
          </Link>
        </p>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title={`${ml} büyük fark`}
          description="Alımı girilen malzemelerde alınan ÷ reçeteye göre kullanım. Büyük fark: 1,5 katından fazla ya da hiç kullanılmadığı hâlde alım var. Malzemeye dokununca tabloda açılır."
          groups={bd.severity}
          total={bigCount}
          totalLabel="Büyük fark"
          unit="count"
          order="given"
          shares={false}
          empty="Bu ay alım miktarı girilmemiş; karşılaştırılacak malzeme yok."
        >
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
        </StatBreakdown>
        <StatBreakdown
          title={`${ml} fatura farkı`}
          description="Alımı girilen malzemeler: (alınan − reçeteye göre kullanılan) × birim maliyet (KDV hariç). Artı = reçeteye göre fazla alınan malın parası, eksi = stoktan harcanan."
          groups={bd.diff}
          total={c.totalDiff}
          totalLabel="Fatura farkı"
          shares={!hasNegative(bd.diff)}
          empty="Bu ay alım miktarı girilmemiş."
        >
          <Stat
            icon={<Scale />}
            label="Fatura farkı"
            value={<CountUp value={c.totalDiff} kind="tl" />}
            info="Reçete ↔ fatura: (alınan − reçeteye göre kullanılan) × birim maliyet, tüm malzemelerin toplamı. Pozitif = reçeteye göre fazla alınan malın parası."
            sub="Alınan − reçeteye göre kullanılan"
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${ml} sayım sapması`}
          description="Gerçek tüketim (geçen ay sayımı + alınan − bu ay sayımı) − reçeteye göre kullanım, × birim maliyet (KDV hariç). Yalnızca iki ayı sayılan ve bu ayın alımı girilen malzemeler toplanır."
          groups={bd.variance}
          total={c.hasStockComparison ? c.totalVariance : 0}
          totalDisplay={c.hasStockComparison ? undefined : "–"}
          totalLabel="Sayım sapması"
          shares={!hasNegative(bd.variance)}
          empty="İki ayın sayımı yok: sapma için geçen ayın ve bu ayın sayımı gerekli."
        >
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
                {c.heldCount ? (
                  // Çarpanı onay bekleyen fatura alınana girmedi (stok partileriyle aynı); sapma onaydan sonra
                  <Link href={HOLDS_HREF} className="-my-3 block py-3 font-medium text-warn underline underline-offset-2 hover:text-ink">
                    {num(c.heldCount)} malzemede fiyat onayı bekliyor
                  </Link>
                ) : null}
                {c.rejectedCount ? (
                  // Fiyatı reddedilen fatura alınana girmedi; bekleyen öneri yok, ayın alımı tabloda elle yazılır
                  <Link href="#malzeme-tablosu" className="-my-3 block py-3 font-medium text-warn underline underline-offset-2 hover:text-ink">
                    {num(c.rejectedCount)} malzemede reddedilen fatura alınana girmedi: alımı yazın
                  </Link>
                ) : null}
                {c.unreciped.count ? (
                  <span className="block">
                    Reçetesiz tüketim: {num(c.unreciped.count)} malzeme · {tl(c.unreciped.amount)}
                  </span>
                ) : null}
                {c.waste.zayi.count + c.waste.ikram.count ? (
                  <Link href={`/panel/zayi?ay=${month}`} className="-my-3 block py-3 font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
                    {c.hasStockComparison
                      ? `Kayıtlı zayi + ikram ${tl(c.totalRecorded)} · açıklanamayan ${tl(c.totalUnexplained)}`
                      : `Kayıtlı zayi ${num(c.waste.zayi.count)}${c.waste.zayi.lafpos ? ` (${num(c.waste.zayi.lafpos)} LafPOS'tan)` : ""} · ikram ${num(c.waste.ikram.count)}${c.waste.ikram.lafpos ? ` (${num(c.waste.ikram.lafpos)} LafPOS'tan)` : ""}`}
                  </Link>
                ) : null}
              </>
            }
          />
        </StatBreakdown>
        <StatBreakdown
          title={`${ml} satış ↔ POS`}
          description={`Ürün listesi − yönetici indirimleri − POS ciro raporu (KDV dahil). Fark 1.000 ₺'den küçükse tutarlı sayılır${c.sales.ok ? `; bu ay fark %${salesDiffPct}` : ""}.`}
          groups={bd.sales}
          total={c.sales.diff ?? 0}
          totalDisplay={c.sales.diff === null ? "–" : undefined}
          totalLabel="Fark (hesaplanan − POS)"
          order="given"
          shares={false}
          empty="Bu ay satış raporu yok; POS ürün listesi yüklenince karşılaştırma çıkar."
        >
          <Stat
            icon={<Receipt />}
            label="Satış ↔ POS"
            value={!c.sales.hasLines ? "Rapor yok" : c.sales.ok ? "Tutarlı" : c.sales.pos === null ? "POS yok" : <CountUp value={c.sales.diff ?? 0} kind="tl" />}
            tone={!c.sales.hasLines ? "default" : c.sales.ok ? "good" : "warn"}
            sub={!c.sales.hasLines ? "Bu ay satış raporu yok" : c.sales.ok ? `Fark %${salesDiffPct}` : c.sales.pos === null ? "POS ciro raporu girilmemiş" : "Fark 1.000 ₺'den büyük"}
          />
        </StatBreakdown>
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
          onlineUsage: r.onlineUsage,
          purchased: r.purchased,
          held: r.held,
          rejected: r.rejected,
          linked: linked.has(r.ingredient.id),
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
          recorded: r.zayi + r.ikram,
          unexplainedAmount: r.unexplainedAmount,
        }))}
        totalDiff={c.totalDiff}
        totalVariance={c.totalVariance}
        hasStock={c.hasCounts}
        hasComparison={c.hasStockComparison}
        ingredients={ingredientOptions}
        fire={st.fire}
      />

      <OnlineSalesCard online={c.online} month={month} monthLabel={ml} configured={Boolean(siteLinkSecret())} />

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

/**
 * laffogato.net online kafe siparişlerinin tüketimi (docs/SITE-SATIS.md): ModPOS satışlarından ayrı bir kaynak. Satırlar
 * menü bağlantısıyla ürünlere eşlenir; eşlenen satırların malzemesi beklenen tüketime eklenir (tabloda "online"),
 * eşlenmeyenler listelenir: ürünü laffogato.net menüsündeki kalemine bağlayınca tüketime girer.
 */
function OnlineSalesCard({
  online,
  month,
  monthLabel: ml,
  configured,
}: {
  online: ReturnType<typeof consistency>["online"];
  month: string;
  monthLabel: string;
  configured: boolean;
}) {
  if (!online && !configured) return null;
  return (
    <Card className="mt-6">
      <CardHeader
        icon={<Globe />}
        title="Online kafe siparişleri (laffogato.net)"
        description={`${ml} · uygulama ve web siparişlerinin tüketimi; ModPOS satışlarından ayrı sayılır, tabloda "online" diye görünür`}
        actions={
          online?.unmapped.length ? (
            <ButtonLink href="/panel/urunler/site" variant="secondary" size="sm">
              <Link2 size={14} /> Ürünleri bağla
            </ButtonLink>
          ) : undefined
        }
      />
      <CardContent className="space-y-3 text-sm">
        {online ? (
          <>
            <p className="text-ink-soft">
              {num(online.orders)} sipariş · {num(online.mappedQty)} adet ürüne eşlendi
              {online.unmappedQty ? ` · ${num(online.unmappedQty)} adet eşlenmedi` : ""}
              <span className="text-ink-mute"> · çekildi {dateTimeTR(online.pulledAt)}{online.closed ? "" : " (ay sürüyor)"}</span>
            </p>
            {online.options.length ? (
              // Seçenekler (site gönderiyorsa): ürünü olan reçetesiyle beklenen tüketime girer, olmayan listelenir
              <p className="text-[13px] text-ink-soft">
                Seçenekler:{" "}
                {online.options.map((o, i) => (
                  <span key={o.kind}>
                    {i ? " · " : ""}
                    {num(o.qty)} {o.label.toLocaleLowerCase("tr-TR")}{" "}
                    {o.productName ? (
                      <span className="text-ink-mute">({o.productName} reçetesiyle)</span>
                    ) : (
                      <span className="text-warn">(panelde ürünü yok, tüketime girmedi)</span>
                    )}
                  </span>
                ))}
              </p>
            ) : null}
            {online.unmapped.length ? (
              <div className="rounded-2xl bg-warn-soft px-4 py-3 text-[13px] text-warn">
                <p className="font-medium">Panel ürününe bağlı olmayan satırlar: malzemesi tüketime girmedi</p>
                <ul className="mt-1.5 space-y-0.5">
                  {online.unmapped.map((l, i) => (
                    <li key={`${l.menuItemId}-${l.size}-${i}`}>
                      {l.qty}× {l.name}
                      {sizeLabel(l.size) ? ` ${sizeLabel(l.size)}` : ""}
                      <span className="opacity-75">{l.menuItemId ? ` (${l.menuItemId}, ${l.size === "L" ? "L yuvası" : "M yuvası"})` : " (sitede kalemsiz satır)"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : online.mapped.length ? (
              <p className="flex items-center gap-2 rounded-2xl bg-good-soft px-3.5 py-2.5 text-[13px] font-medium text-good">
                <CheckCircle2 size={16} className="shrink-0" /> Bütün online satırlar panel ürünlerine bağlı.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-ink-mute">
            Bu ayın online satışı henüz çekilmedi. Gelir-gider&apos;deki laffogato.net online satışları kartından{" "}
            <Link href={`/panel/gelir-gider?yil=${month.slice(0, 4)}`} className="font-medium text-ink underline underline-offset-2">
              siteden çekin
            </Link>
            ; her sabah bu ay kendiliğinden çekilir.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
