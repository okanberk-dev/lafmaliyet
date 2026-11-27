"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Well } from "@/components/ui/card";
import { dateTR, num, pct } from "@/lib/format";
import { bulkPrice, bulkUnit, type SupplierPriceRow, type SupplierPricesResponse } from "@/lib/supplier-prices";
import { cn } from "@/lib/utils";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: SupplierPricesResponse };

/** Okunur birimde sayı (₺ başlıkta): 1 ₺'nin altındaki adet fiyatı kuruşun altına iner */
const amount = (v: number) => (Math.abs(v) >= 1 ? num(v, 2, 2) : num(v, 4, 2));

/** "2 bedava kalem, 1 iade sayılmadı" */
function skippedText(free: number, returns: number): string | null {
  const parts = [free ? `${num(free)} bedava kalem` : null, returns ? `${num(returns)} iade` : null].filter(Boolean);
  return parts.length ? `${parts.join(", ")} sayılmadı` : null;
}

/**
 * Hammadde penceresindeki "Tedarikçilere göre fiyat": kim bu hammaddeyi ne zaman hangi birim fiyata sattı (bağlı Paraşüt
 * ürünlerinin faturalarından; ₺/kg, ₺/L, ₺/adet; KDV hariç, iskonto düşülmüş). Tedarikçiler, Tedarikçiler ekranındaki
 * gibi gruplanır. Pencere açılınca istenir (GET /api/hammaddeler/{id}/fiyatlar). Penceredeki bağlantılar önce pencereyi
 * kapatır (`onNavigate`): açık kalan pencere yeni sayfanın üstünde dururdu.
 */
export function SupplierPrices({ ingredientId, onNavigate }: { ingredientId: number; onNavigate: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const titleId = useId();

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/hammaddeler/${ingredientId}/fiyatlar`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as SupplierPricesResponse & { error?: string };
        if (!r.ok) throw new Error(body.error ?? "Tedarikçi fiyatları alınamadı");
        return body;
      })
      .then((data) => setState({ status: "ok", data }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: e.message });
      });
    return () => ctrl.abort();
  }, [ingredientId]);

  const data = state.status === "ok" ? state.data : null;
  const per = data?.ingredient.per;
  const skipped = data ? skippedText(data.freeLines, data.returnLines) : null;

  return (
    <Well className="bg-panel" aria-labelledby={titleId} role="region">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-semibold text-ink">
            Tedarikçilere göre fiyat
          </h3>
          {per ? <p className="text-xs text-ink-mute">₺ / {per} · KDV hariç, iskonto düşülmüş</p> : null}
        </div>
        {data?.rows.length ? (
          <p className="text-xs text-ink-mute tabular">
            {num(data.rows.length)} tedarikçi · {num(data.invoiceCount)} fatura
          </p>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p className="animate-pulse text-xs text-ink-mute">Tedarikçi fiyatları yükleniyor…</p>
      ) : state.status === "error" ? (
        <p className="text-xs text-bad">{state.message}</p>
      ) : !state.data.links ? (
        <p className="text-xs text-pretty text-ink-mute">
          Bu hammadde henüz bir Paraşüt ürününe bağlı değil. Faturadaki ürünü bağlayınca tedarikçilerin fiyatları burada karşılaştırılır.{" "}
          <Link href="/panel/parasut?durum=bekleyen#urun-baglantilari" onClick={onNavigate} className="font-medium text-ink underline-offset-2 hover:underline">
            Bağlanmayı bekleyenler →
          </Link>
        </p>
      ) : !state.data.rows.length ? (
        <p className="text-xs text-pretty text-ink-mute">Bağlı ürünlerin faturası henüz gelmedi ya da kalemleri okunmadı.</p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-xl bg-surface px-3">
            {state.data.rows.map((r) => (
              <SupplierBlock key={r.key} r={r} unit={state.data.ingredient.unit} onNavigate={onNavigate} />
            ))}
          </ul>
          {state.data.rows.length === 1 ? (
            <p className="mt-2 text-xs text-pretty text-ink-mute">
              Tek tedarikçi. Başka bir tedarikçinin aynı ürününü de bu hammaddeye bağlarsanız fiyatlar yan yana görünür.
            </p>
          ) : null}
        </>
      )}

      {data?.elsewhere ? (
        <p className="mt-2 text-xs text-ink-mute">{num(data.elsewhere)} fatura öbür şubelerde ya da şubesi seçilmemiş: Tümü&apos;de görünür.</p>
      ) : null}
      {data && (data.ingredient.current !== null || skipped) && (data.rows.length || skipped) ? (
        <p className="mt-2 text-xs text-ink-mute">
          {data.ingredient.current !== null ? (
            <>
              Reçetedeki fiyat: <span className="tabular">{bulkPrice(data.ingredient.current, data.ingredient.unit)}</span>
            </>
          ) : null}
          {data.ingredient.current !== null && skipped ? " · " : null}
          {skipped}
        </p>
      ) : null}
    </Well>
  );
}

function SupplierBlock({ r, unit, onNavigate }: { r: SupplierPriceRow; unit: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { scale } = bulkUnit(unit);
  return (
    <li className="py-2.5 text-xs text-ink-mute">
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <Link
            href={`/panel/tedarikciler/${r.slug}`}
            onClick={onNavigate}
            className="text-sm font-medium break-words text-ink hover:underline pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            {r.name}
          </Link>
          {r.cheapest ? <Badge tone="green">En ucuz</Badge> : null}
          {!r.fresh ? (
            <Badge tone="gray" title="Son alım 90 günden eski">
              Eski fiyat
            </Badge>
          ) : null}
        </p>
        <p className="shrink-0 text-sm font-semibold whitespace-nowrap text-ink tabular">{bulkPrice(r.last.unitPrice, unit)}</p>
      </div>
      <p className="mt-0.5 tabular">
        Son {dateTR(r.last.date)}
        {/* Yüzde tam sayıya yuvarlanır: %1'den küçük fark (çoğu kuruş yuvarlaması) "+%0" diye görünmesin */}
        {r.change !== null && Math.round(Math.abs(r.change) * 100) >= 1 ? (
          <>
            {" "}
            · öncekine göre{" "}
            <span className={cn("font-medium", r.change > 0 ? "text-bad" : "text-good-ink")}>
              {r.change > 0 ? "+" : "−"}
              {pct(Math.abs(r.change), 0)}
            </span>
          </>
        ) : null}
        {r.vsCheapest !== null && r.vsCheapest > 0.005 ? ` · en ucuzdan ${pct(r.vsCheapest, 0)} pahalı` : null}
      </p>
      <p className="mt-0.5 tabular">
        {r.windowCount > 1 && r.min !== null && r.max !== null && r.avg !== null
          ? `12 ayda ${amount(r.min * scale)}–${amount(r.max * scale)} · ort. ${amount(r.avg * scale)} · ${num(r.windowCount)} fatura`
          : r.windowCount === 1
            ? "1 fatura"
            : "Son 12 ayda faturası yok"}
      </p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className="mt-1 inline-flex min-h-8 cursor-pointer items-center gap-1 font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11"
      >
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
        Faturalar ({num(r.points.length)})
      </button>
      {open ? (
        <ul id={listId} className="mt-1 max-h-56 divide-y divide-line overflow-y-auto rounded-lg bg-panel px-2.5 scroll-thin">
          {r.points.map((p) => (
            <li key={p.invoiceId} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5 tabular">
              <span>
                {dateTR(p.date)} · {p.qtyText} · <span className="font-medium text-ink">{bulkPrice(p.unitPrice, unit)}</span>
              </span>
              <Link
                href={`/panel/faturalar?ara=${encodeURIComponent(p.invoiceNo ?? r.name)}#fatura-listesi`}
                onClick={onNavigate}
                className="font-medium text-info hover:underline pointer-coarse:-my-2 pointer-coarse:py-2"
              >
                {p.invoiceNo ?? "Faturayı aç"}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
