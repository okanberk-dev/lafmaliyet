import { asc, count } from "drizzle-orm";
import { Droplets, Package, TriangleAlert, Unlink } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AnchorNote } from "@/components/panel/anchor-note";
import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { latestSalesMonth } from "@/lib/calc/insights";
import { ingredientChanges } from "@/lib/calc/price-impact";
import { num, pct } from "@/lib/format";
import { readingFits, readingText } from "@/lib/invoice-reading";
import {
  conflictSuggestionText,
  evidenceSuggestionText,
  HOLDS_ANCHOR,
  holdImpact,
  holdSuggestion,
  livePct,
  ratioSuggestionText,
  sameProductHistory,
  type HoldSuggestion,
} from "@/lib/price-hold";
import { packEvidence } from "@/lib/product-match";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { priceWindowStart } from "@/server/data/price-alerts";
import { loadHoldLines, loadPriceHolds } from "@/server/data/price-holds";
import { getDb, schema as s } from "@/server/db";
import { holdReadingState, loadInvoiceReadings, readingKey } from "@/server/invoice-reading/read";

import { waterSource } from "../ayarlar/water-text";

import { activeUses, ingredientBreakdowns, waterBreakdown } from "./breakdowns";
import { sortCategories } from "./categories";
import { CountUp, IngredientsClient, NewIngredientButton, type IngredientRow } from "./ingredients-client";
import { ListAnchor } from "./list-anchor";
import { PriceHolds, type HoldView, type RecentHoldView } from "./price-holds";

export const metadata: Metadata = { title: "Hammaddeler" };

const DESCRIPTION = "Malzemelerin paket fiyatları (KDV hariç); değişince maliyetler güncellenir.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Faturalardan gelen paket fiyatları (KDV hariç, iskonto düşülmüş). Paket fiyatı değişince bütün ürün maliyetleri kendiliğinden güncellenir, fiyat geçmişi saklanır.";
// Onay bekleyen fiyatın faturasını okuma (belge indirmesi + Claude) bu sayfanın sunucu eylemiyle çalışır
export const maxDuration = 60;

export default function IngredientsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Hammaddeler" path="/panel/hammaddeler" description={DESCRIPTION} more={MORE} />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <IngredientsContent />
    </Suspense>
  );
}

async function IngredientsContent() {
  await requireAdmin();
  const db = getDb();
  const [model, history, links, holds, readState] = await Promise.all([
    loadModel(),
    db.select().from(s.ingredientPrices).orderBy(asc(s.ingredientPrices.changedAt), asc(s.ingredientPrices.id)),
    db.select({ id: s.parasutProductLinks.ingredientId, n: count() }).from(s.parasutProductLinks).groupBy(s.parasutProductLinks.ingredientId),
    loadPriceHolds(),
    holdReadingState(),
  ]);
  // Bekleyen önerilerin kalemleri (açıklama, aynı ürünün geçmişi) ve saklanan fatura okumaları
  const [holdLines, readings] = holds.pending.length
    ? await Promise.all([loadHoldLines([...new Set(holds.pending.map((h) => h.productKey))]), loadInvoiceReadings(holds.pending)])
    : [[], new Map()];
  const usageMonth = latestSalesMonth(model);
  const usage = usageMonth ? model.ingredientUsage(usageMonth) : new Map<number, number>();
  const histBy = new Map<number, IngredientRow["history"]>();
  for (const h of history) {
    const list = histBy.get(h.ingredientId) ?? [];
    list.push({ at: h.changedAt.toISOString(), price: h.packagePrice, size: h.packageSize, by: h.changedBy, note: h.note });
    histBy.set(h.ingredientId, list);
  }
  // Silmeyi engelleyen geçmiş: sayım, alım miktarı, Paraşüt eşleştirmesi, zayi / ikram (silinirse geçmiş ayların stok
  // değeri ve zayi maliyeti değişir)
  const tally = (ids: number[]) => {
    const m = new Map<number, number>();
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const countsBy = tally(model.ds.stockCounts.map((c) => c.ingredientId));
  const purchasesBy = tally(model.ds.purchaseQuantities.map((p) => p.ingredientId));
  const linksBy = new Map(links.map((l) => [l.id, l.n]));
  const wasteBy = tally((model.ds.wasteEntries ?? []).flatMap((w) => (w.ingredientId !== null ? [w.ingredientId] : [])));
  // Son 30 günün fiyat değişimleri (zam uyarısıyla aynı hesap: pencereden önceki son fiyata göre)
  const since = priceWindowStart();
  const recent = new Map(
    ingredientChanges(
      model.ds.ingredients,
      history.map((h) => ({ ...h, changedAt: h.changedAt.toISOString() })),
      since,
    ).map((c) => [c.ingredientId, { pct: c.pct, at: c.changedAt }]),
  );

  // Onay bekleyen fiyatlar: yüzde, öneri ve ürün maliyetleri şimdiki fiyata göre (arada elle değişmiş olabilir). Öneri
  // kanıttan: adındaki paket boyu, faturanın okunması, ancak aynı ürünün geçmişi varsa çarpan oranı (price-hold.ts)
  const holdViews: HoldView[] = holds.pending.map((h) => {
    const current = h.ingredient.packageSize > 0 ? h.ingredient.packagePrice / h.ingredient.packageSize : 0;
    const proposed = h.packagePrice / h.packageSize;
    const unit = h.ingredient.unit;
    const line = holdLines.find((l) => l.invoiceId === h.invoiceId && l.productKey === h.productKey);
    const evidence = packEvidence({ name: h.productName, description: line?.description ?? null, unit: h.unit, quantity: h.quantity }, unit);
    const stored = readings.get(readingKey(h.invoiceId, h.productKey)) ?? null;
    const running = stored?.busy ?? false;
    const reading = stored?.status === "ok" && stored.result && readingFits(stored.result, unit) ? stored.result : null;
    const suggestion = holdSuggestion({
      factor: h.factor,
      quantity: h.quantity,
      netTotal: h.netTotal,
      current,
      evidence,
      reading,
      history: sameProductHistory(holdLines, h, current),
    });
    const textCtx = { lineUnit: h.unit, unit, quantity: h.quantity, netTotal: h.netTotal, currentUnit: current };
    const readingLine = reading ? readingText(reading, textCtx) : null;
    const suggestionText = (x: HoldSuggestion) =>
      x.kind === "evidence"
        ? evidenceSuggestionText(x.evidence!, { lineUnit: h.unit, unit, unitPrice: x.unitPrice, currentUnit: current })
        : x.kind === "reading"
          ? readingLine!
          : x.kind === "conflict"
            ? conflictSuggestionText(x, { lineUnit: h.unit, unit, currentUnit: current })
            : ratioSuggestionText(x.hint!, { lineUnit: h.unit, unit, factor: x.factor, unitPrice: x.unitPrice, currentUnit: current });
    return {
      id: h.id,
      ingredientId: h.ingredientId,
      name: h.ingredient.name,
      unit: h.ingredient.unit,
      current,
      proposed,
      pct: livePct(proposed, current),
      repeats: h.repeats,
      supplier: h.supplier,
      date: h.invoiceDate,
      invoiceNo: h.invoiceNo,
      productKey: h.productKey,
      productName: h.productName,
      quantity: h.quantity,
      lineUnit: h.unit,
      factor: h.factor,
      last: h.lastUnitPrice !== null && h.lastDate && h.lastSupplier ? { unitPrice: h.lastUnitPrice, date: h.lastDate, supplier: h.lastSupplier } : null,
      impact: holdImpact(model, h.ingredientId, proposed),
      // Hammaddenin fiyatı yok: faturadan gelen ilk fiyat (çarpanı kesin değil; priceStep)
      first: !(current > 0),
      estimate: h.ingredient.isEstimate,
      suggestion: suggestion ? { kind: suggestion.kind, factor: suggestion.factor, text: suggestionText(suggestion) } : null,
      // Okuma öneri değilse bilgi satırı (aynı çarpanı doğruluyor ya da az emin); çelişkide okuma önerinin metninde
      reading: readingLine && suggestion?.kind !== "reading" && suggestion?.kind !== "conflict" ? { text: readingLine, low: reading!.confidence === "low" } : null,
      readError: stored?.status === "error" ? stored.error : null,
      // Kendiliğinden okuma: kanıtı ve okuması olmayan kartta bir kez; başka sekme okuyorsa bekler; okuma kapalıysa düğme yok
      // Günlük sınırın fotoğraf payına inildiyse kendiliğinden okuma yok, düğme kalır
      read: readState.state !== "on" ? null : running ? "running" : !stored && !evidence && readState.auto ? "auto" : "manual",
      hasReading: Boolean(stored && stored.status !== "running"),
    };
  });
  const recentHolds: RecentHoldView[] = holds.recent.map((h) => ({
    id: h.id,
    name: h.ingredient.name,
    unit: h.ingredient.unit,
    proposed: h.packagePrice / h.packageSize,
    status: h.status as RecentHoldView["status"],
    note: h.note,
    stoppedUpdates: h.stoppedUpdates,
    decidedByName: h.decidedByName,
    decidedAt: h.decidedAt ?? h.createdAt,
  }));
  const holdBy = new Map(holdViews.map((v) => [v.ingredientId, { pct: v.pct, proposed: v.proposed, supplier: v.supplier, date: v.date }]));

  const rows: IngredientRow[] = model.ds.ingredients.map((i) => ({
    ...i,
    unitCost: model.unitCost.get(i.id) ?? 0,
    // Pasif ürünler de listelenir (silme engeli), `active` ile ayrılır: "Reçetede yok" yalnız aktif ürünlere bakar
    usedIn: (model.usedIn.get(i.id) ?? []).map((pid) => {
      const p = model.productById.get(pid);
      return { id: pid, label: p ? `${p.name} · ${p.size}` : `#${pid}`, active: p?.active ?? false };
    }),
    monthUsage: usage.get(i.id) ?? 0,
    history: histBy.get(i.id) ?? [],
    deps: { counts: countsBy.get(i.id) ?? 0, purchases: purchasesBy.get(i.id) ?? 0, links: linksBy.get(i.id) ?? 0, waste: wasteBy.get(i.id) ?? 0 },
    recentChange: recent.get(i.id) ?? null,
    pendingHold: holdBy.get(i.id) ?? null,
  }));

  // Süzgeçler (?ara, ?durum, ?kategori, ?sirala) istemcide adresten okunur; ⌘K paleti ?ara=<ad> ile gönderir
  const active = rows.filter((r) => r.active);
  const categories = sortCategories(rows.map((r) => r.category));
  const estimates = active.filter((r) => r.isEstimate).length;
  const unused = active.filter((r) => !activeUses(r)).length;
  // Kartların dökümü (karta dokununca açılan pencere): yüklenen satırlardan ve modelin su hesabından
  const breakdown = ingredientBreakdowns(rows);
  // Litre satırları motorun su hesabıyla aynı kaynaktan: şube seçiliyken de işletme genelinin satışı (model.waterUsage)
  const waterUse = model.water.month ? model.waterUsage(model.water.month) : null;
  const waterDokum = waterBreakdown(model.water, rows, waterUse?.list ?? new Map<number, number>(), waterUse?.online);
  const categoryCount = new Set(active.map((r) => r.category)).size;
  const estimateShare = active.length ? pct(estimates / active.length, 0) : null;

  return (
    <>
      <PageHeader
        path="/panel/hammaddeler"
        title="Hammaddeler"
        description={DESCRIPTION}
        more={MORE}
        actions={<NewIngredientButton categories={categories} rows={rows} />}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title="Hammaddeler"
          description={`Aktif malzemeler, kategori kategori (${num(categoryCount)} kategori). Pasif malzemeler sayıya girmez, en altta ayrı. Kategoriye dokununca liste o kategoriye süzülür.`}
          groups={breakdown.all}
          total={active.length}
          unit="count"
          empty="Henüz aktif malzeme yok."
        >
          <Stat icon={<Package />} label="Hammadde" value={<CountUp value={active.length} />} sub={`${num(categoryCount)} kategori`} />
        </StatBreakdown>
        <StatBreakdown
          title="Tahmini değerler"
          description={`Faturada bulunamayan, varsayımla girilmiş paket fiyatları (aktif malzemeler, KDV hariç); altında neyin doğrulanacağı yazar.${
            estimateShare ? ` Rozetteki oran: ${num(estimates)} ÷ ${num(active.length)} aktif malzeme = ${estimateShare}.` : ""
          } Malzemeye dokununca listede açılır.`}
          groups={breakdown.estimates}
          total={estimates}
          unit="count"
          shares={false}
          empty="Tahmini değer yok; bütün fiyatlar faturadan."
        >
          <Stat
            icon={<TriangleAlert />}
            label="Tahmini değer"
            value={<CountUp value={estimates} />}
            tone={estimates ? "warn" : "good"}
            badge={
              estimateShare ? (
                <Badge tone={estimates ? "amber" : "green"} title="Aktif malzemeler içindeki payı">
                  {estimateShare}
                </Badge>
              ) : null
            }
            sub="Varsayımı doğrulanmalı (notuna bakın)"
          />
        </StatBreakdown>
        <StatBreakdown
          title="Hiçbir reçetede olmayanlar"
          description="Aktif olup hiçbir aktif ürünün reçetesinde geçmeyen malzemeler (paket fiyatı KDV hariç; yalnız pasif ürünlerin kullandıkları da burada). Maliyetleri satılan hiçbir ürüne yansımaz: kullanılıyorsa reçeteye ekleyin, kullanılmıyorsa pasife alın. Malzemeye dokununca listede açılır."
          groups={breakdown.unused}
          total={unused}
          unit="count"
          shares={false}
          empty="Bütün aktif malzemeler en az bir aktif ürünün reçetesinde."
        >
          <Stat icon={<Unlink />} label="Hiçbir reçetede yok" value={<CountUp value={unused} />} sub="Reçeteye eklenmesi gerekebilir" />
        </StatBreakdown>
        <StatBreakdown
          title="Su + buz birim maliyeti"
          description={waterDokum.description}
          groups={waterDokum.groups}
          order="given"
          shares={false}
          totalLabel={waterDokum.totalLabel}
          totalDisplay={waterDokum.totalDisplay}
          hideTotal={waterDokum.hideTotal}
        >
          <Stat
            icon={<Droplets />}
            label="Su + buz birim maliyeti"
            value={<CountUp value={model.water.perLiter} digits={4} suffix=" ₺" />}
            suffix="/L"
            tone={model.water.reason === "no-usage" ? "warn" : "default"}
            sub={<span title={waterSource(model.water)}>{waterSource(model.water, true)}</span>}
            infoTone={model.water.reason === "no-bill" ? "warn" : undefined}
            info={`${waterSource(model.water)}. Hesap: Gelir-gider tablosundaki SU GİDERİ ÷ reçetelere göre o ay harcanan su + buz (litre; satış listesi ve laffogato.net online siparişleri); ürün satış listesi olan en son ayın faturası kullanılır.`}
          />
        </StatBreakdown>
      </div>
      {/* Paraşüt faturasında %40'tan fazla farklı gelen fiyatlar (#fiyat-onayi); son 3 günde karar varsa da görünür. Yoksa
          çapalı bağlantı (Yardım, zil) kısa satıra iner (UI-08) */}
      {holdViews.length || recentHolds.length ? (
        <PriceHolds pending={holdViews} recent={recentHolds} />
      ) : (
        <AnchorNote id={HOLDS_ANCHOR} className="mb-6">
          Onay bekleyen fiyat şu an yok: Paraşüt faturasındaki fiyatı %40&apos;tan fazla farklı gelen hammadde olunca burada sorulur.
        </AnchorNote>
      )}
      {/* Dökümdeki bağlantıların çapası (#hammadde-listesi): süzülmüş listeye kayar */}
      <ListAnchor>
        <IngredientsClient rows={rows} categories={categories} />
      </ListAnchor>
    </>
  );
}
