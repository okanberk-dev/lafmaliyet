"use client";

import { ChevronDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { IngredientChange, ProductImpact } from "@/lib/calc/price-impact";
import { basisText, type PriceLoss } from "@/lib/calc/price-loss";
import { dateTR, num, pct, tl, tl2 } from "@/lib/format";
import { monthLocativeTR } from "@/lib/reminders";
import { priceReminder } from "@/lib/prices/pos";
import { cn } from "@/lib/utils";
import { acknowledgePriceAlert, updateProductPrice } from "@/server/actions/products";

import { productHref } from "./logic";

/**
 * ackPrice: uyarı önerilen fiyat uygulanarak kapandıysa o fiyat (PriceAck.price; yükleyici verirse). monthly /
 * monthlyQty: zamların bu üründen ayda götürdüğü kâr ve ayda satılan adet (satış verisi yoksa null)
 */
export type ImpactRow = ProductImpact & { acknowledged: boolean; ackPrice?: number | null; monthly?: number | null; monthlyQty?: number | null };

/** Birim maliyet okunur birimle: ₺/gr → ₺/kg, ₺/ml → ₺/L */
function perUnit(v: number, unit: string): string {
  if (unit === "gr") return `${tl2(v * 1000)}/kg`;
  if (unit === "ml") return `${tl2(v * 1000)}/L`;
  return `${tl2(v)}/${unit}`;
}

const changeTitle = (c: IngredientChange) =>
  `${perUnit(c.before, c.unit)} → ${perUnit(c.after, c.unit)} · ${dateTR(c.changedAt.slice(0, 10))}${c.changedBy ? ` · ${c.changedBy}` : ""}${c.note ? ` (${c.note})` : ""}`;

/**
 * Ürünler sayfasındaki "Hammadde zamları": son 30 günde fiyatı değişen hammaddeler ve maliyeti artan ürünler.
 * Fiyatı önerilenin altında kalan ürüne tek dokunuşla önerilen fiyat yazılır ya da "böyle kalsın" denir (ikisi de
 * geri alınabilir). Genel bakıştaki, zildeki ve sabah e-postasındaki zam uyarısı buraya getirir (#zamlar).
 * `loss` varsa zamların ayda kaç lira kâr götürdüğü de yazılır (son satış ayıyla; price-loss.ts).
 */
export function PriceImpactPanel({
  changes,
  impacts,
  target,
  month,
  loss = null,
}: {
  changes: IngredientChange[];
  impacts: ImpactRow[];
  target: number;
  month: string;
  loss?: PriceLoss | null;
}) {
  const [pending, start] = useActionTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showRest, setShowRest] = useState(false);
  const ups = changes.filter((c) => c.pct > 0);
  const downs = changes.filter((c) => c.pct < 0);
  const basis = loss?.basis ?? null;
  // Fiyat önerisi bekleyenler en çok kâr götürenden başlar; eşitlikte (ve satış verisi yokken) yükleyicinin sırası
  const actionable = impacts
    .filter((i) => i.needsPrice && !i.acknowledged)
    .map((i, k) => ({ i, k }))
    .sort((a, b) => (b.i.monthly ?? 0) - (a.i.monthly ?? 0) || a.k - b.k)
    .map((x) => x.i);
  const rest = impacts.filter((i) => !(i.needsPrice && !i.acknowledged));
  const monthlyOf = new Map((loss?.ingredients ?? []).map((x) => [x.ingredientId, x.monthly]));
  const lossText = basis && loss && loss.totalLoss >= 1 ? `Ayda ≈ ${tl(loss.totalLoss)} kâr kaybı` : null;

  const setPrice = (i: ImpactRow) => {
    setBusyId(i.productId);
    start(async () => {
      // Zammın payı fiyattan hesaplanır: uygulanınca bu maliyette uyarı kapanır (yoksa öneri yeni fiyattan yeniden
      // artardı). Geri al eski fiyatı yazar; fiyat önerinin altına inince uyarı kendiliğinden geri gelir. Fiyat
      // geçmişinde iki dayanakta da "Zam önerisi"; Geri al elle
      const r = await updateProductPrice(i.productId, i.suggestedPrice, i.basis === "keep", "suggestion");
      setBusyId(null);
      if (!r.ok) return void toast.error(r.error);
      // Siteye bağlı üründe fiyat laffogato.net'te de değişti (fiyat listesinin tarihi sitede elle); kasada (ModPOS)
      // değişecek fiyat Fiyatlar › Kasaya işle listesinde
      const reminder = priceReminder(r.data);
      toast.success(`${i.name} ${i.size}: ${tl(i.price)} → ${tl(r.data.price)}`, {
        ...(reminder ? { description: reminder, duration: r.data.site ? 12_000 : 8_000 } : {}),
        action: {
          label: "Geri al",
          onClick: () =>
            void updateProductPrice(i.productId, i.price).then((u) => {
              if (!u.ok) toast.error(u.error);
            }),
        },
      });
    });
  };
  const keep = (i: ImpactRow, undo = false) => {
    setBusyId(i.productId);
    start(async () => {
      const r = await acknowledgePriceAlert(i.productId, undo);
      setBusyId(null);
      if (!r.ok) return void toast.error(r.error);
      if (undo) toast.success(`${i.name} ${i.size} yeniden uyarıda`);
      else toast.success(`${i.name} ${i.size} fiyatı ${tl(i.price)} kalıyor; maliyet daha da artarsa yeniden uyarılır`, { action: { label: "Geri al", onClick: () => void acknowledgePriceAlert(i.productId, true) } });
    });
  };

  return (
    <Card id="zamlar" className="mb-6 scroll-mt-24">
      <CardHeader
        icon={<TrendingUp />}
        title="Hammadde zamları · son 30 gün"
        description={`Fiyatı artan hammaddeler ve bu yüzden maliyeti artan ürünler. Maliyet oranı hedefin (%${num(target * 100)}) üstüne çıkan ürüne fiyat önerilir: zamdan önce hedefteyse hedefi tutturan fiyat, zaten hedefin üstündeyse (hazır alınan ürünler gibi) yalnız zammın payı. Fiyatı değiştirmek size kalmış.`}
        meta={
          <>
            {actionable.length ? (
              <span className="font-medium text-warn tabular">{num(actionable.length)} ürüne fiyat önerisi</span>
            ) : (
              <span className="tabular">{num(impacts.length)} ürün etkilendi</span>
            )}
            {lossText ? (
              <>
                <span className="text-ink-quiet">·</span>
                <span className="font-medium text-bad tabular">{lossText}</span>
              </>
            ) : null}
          </>
        }
      />
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <ul className="flex flex-wrap gap-1.5" aria-label="Fiyatı değişen hammaddeler">
            {[...ups, ...downs].map((c) => {
              const monthly = basis ? (monthlyOf.get(c.ingredientId) ?? 0) : 0;
              return (
                <li key={c.ingredientId}>
                  <Link
                    href={`/panel/hammaddeler?ara=${encodeURIComponent(c.name)}`}
                    title={changeTitle(c)}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-xs text-ink-soft ring-1 ring-line-strong hover:text-ink pointer-coarse:min-h-11"
                  >
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className={cn("font-semibold tabular", c.pct > 0 ? "text-bad" : "text-good")}>
                      {c.pct > 0 ? "+" : "−"}
                      {pct(Math.abs(c.pct), 0)}
                    </span>
                    {/* Ayda 1 ₺'nin altı (ya da satış verisi yok) yazılmaz; ucuzlayanınki kazançtır (yeşil) */}
                    {Math.abs(monthly) >= 1 ? <span className={cn("tabular", monthly > 0 ? "text-bad" : "text-good")}>· ayda {tl(Math.abs(monthly))}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-ink-mute">
            {basis ? (
              <>{basisText(basis)} Ürüne eşleşmeyen satışlar sayılmadı.</>
            ) : (
              <>
                Ayda kaç lira tuttuğunu görmek için Satışlar&apos;a ürün satış raporunu yükleyin.{" "}
                <Link href="/panel/satislar" className="font-medium text-ink underline-offset-2 hover:underline">
                  Satışlara git
                </Link>
              </>
            )}
          </p>
        </div>

        {actionable.length ? (
          <ul className="divide-y divide-ink/[0.06] rounded-2xl bg-surface px-3">
            {actionable.map((i) => (
              <ImpactItem
                key={i.productId}
                i={i}
                month={month}
                basisMonth={basis?.month ?? null}
                target={target}
                busy={pending && busyId === i.productId}
                disabled={pending}
                onPrice={() => setPrice(i)}
                onKeep={() => keep(i)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-good-soft px-4 py-3 text-sm text-good-ink">Etkilenen ürünlerin maliyet oranı hâlâ hedefte ya da fiyatları güncel.</p>
        )}

        {rest.length ? (
          <div>
            <button
              type="button"
              onClick={() => setShowRest((v) => !v)}
              aria-expanded={showRest}
              className="inline-flex min-h-8 cursor-pointer items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11"
            >
              <ChevronDown size={14} className={cn("transition-transform", showRest && "rotate-180")} aria-hidden="true" />
              {showRest ? "Gizle" : `Maliyeti artan ama hâlâ hedefte, fiyatı güncel ya da korunan ${num(rest.length)} ürün`}
            </button>
            {showRest ? (
              <ul className="mt-2 divide-y divide-ink/[0.06] rounded-2xl bg-surface px-3">
                {rest.map((i) => (
                  <ImpactItem
                    key={i.productId}
                    i={i}
                    month={month}
                    basisMonth={basis?.month ?? null}
                    target={target}
                    busy={pending && busyId === i.productId}
                    disabled={pending}
                    onReopen={i.acknowledged ? () => keep(i, true) : undefined}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ImpactItem({
  i,
  month,
  basisMonth,
  target,
  busy,
  disabled,
  onPrice,
  onKeep,
  onReopen,
}: {
  i: ImpactRow;
  month: string;
  /** Aylık kaybın satış ayı (satış verisi yoksa null: ek yazılmaz) */
  basisMonth: string | null;
  target: number;
  busy: boolean;
  disabled: boolean;
  onPrice?: () => void;
  onKeep?: () => void;
  onReopen?: () => void;
}) {
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Dokunmatikte 44px dokunma alanı: görünmez dikey dolgu, satırın yerleşimi değişmez */}
          <Link href={productHref(i.productId, month)} className="text-sm font-semibold break-words text-ink hover:underline pointer-coarse:-my-3 pointer-coarse:py-3">
            {i.name} · {i.size}
          </Link>
          {i.statusAfter !== i.statusBefore ? (
            <Badge tone={i.statusAfter === "Düşük kâr" ? "red" : "amber"} dot>
              {i.statusBefore} → {i.statusAfter}
            </Badge>
          ) : null}
          {i.acknowledged ? <Badge tone="gray">{i.ackPrice != null ? "önerilen fiyat uygulandı" : "fiyat korunuyor"}</Badge> : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-mute">
          <span className="tabular">
            Maliyet {tl2(i.costBefore)} → <span className="font-medium text-ink">{tl2(i.costAfter)}</span>
          </span>
          <span className="tabular">
            {" "}
            · maliyet oranı {pct(i.ratioBefore, 0)} → <span className={cn("font-medium", i.needsPrice ? "text-bad" : "text-ink")}>{pct(i.ratioAfter, 0)}</span>
          </span>
          <span className="tabular">
            {" "}
            · birim kâr {tl2(i.profitBefore)} → {tl2(i.profitAfter)}
          </span>
          {basisMonth && i.monthly != null && i.monthlyQty != null ? (
            i.monthlyQty > 0 ? (
              i.monthly >= 1 ? (
                <span className="tabular">
                  {" "}
                  ·{" "}
                  <span className="whitespace-nowrap">
                    <span className="font-medium text-bad">ayda ≈ {tl(i.monthly)} kayıp</span> ({num(i.monthlyQty)} adet)
                  </span>
                </span>
              ) : null
            ) : (
              <span> · {monthLocativeTR(basisMonth)} satılmadı</span>
            )
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-mute">
          {i.drivers
            .slice(0, 3)
            .map((d) => `${d.name} +${pct(d.pct, 0)}`)
            .join(", ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className="text-xs text-ink-mute tabular" title={i.needsPrice && i.basis === "keep" ? `Hedef %${num(target * 100)} için ${tl(i.targetPrice)} gerekir` : undefined}>
          Şimdi <span className="font-semibold text-ink">{tl(i.price)}</span>
          {i.needsPrice ? (
            <>
              {" "}
              · önerilen <span className="font-semibold text-ink">{tl(i.suggestedPrice)}</span>{" "}
              {i.basis === "keep" ? "(zammın payı)" : `(hedef %${num(target * 100)})`}
            </>
          ) : null}
        </span>
        {onPrice && i.needsPrice ? (
          <Button size="sm" disabled={disabled} onClick={onPrice}>
            {busy ? "Kaydediliyor…" : `Fiyatı ${tl(i.suggestedPrice)} yap`}
          </Button>
        ) : null}
        {onKeep ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onKeep}>
            Böyle kalsın
          </Button>
        ) : null}
        {onReopen ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onReopen}>
            Uyarıyı geri aç
          </Button>
        ) : null}
      </div>
    </li>
  );
}
