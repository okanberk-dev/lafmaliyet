"use client";

import { ChevronDown, Link2, ListOrdered } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Notice } from "@/components/ui/notice";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { num, tl2 } from "@/lib/format";
import { isLinkableCategory } from "@/lib/invoice-linking";
import { ingredientPriceOf, linesTotal, netUnitPrice, type InvoiceLinesResponse } from "@/lib/invoice-lines";
import { cn } from "@/lib/utils";

/** Uzun faturada (demirbaş, ambalaj siparişi) ilk bu kadar kalem; kalanı "Tümünü göster" ile */
const FIRST = 6;

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: InvoiceLinesResponse };

/**
 * Fatura penceresindeki "Kalemler": e-fatura belgesinden (ya da Paraşüt gider faturasından) okunan ürünler, miktar,
 * net birim fiyat, KDV; hammaddeye bağlı olanın bu faturadaki fiyatı. Bağlı olmayan ürün Paraşüt sayfasında
 * bağlanır (bir kez bağlamak yeter, sonraki faturalar kendiliğinden işlenir). Paraşüt'ün bekleyen listesi yalnız mal
 * ve "Diğer" faturalarının kalemlerini gösterir: öbür kategorilerde "Hammaddeye bağla" boş listeye götürürdü, çıkmaz.
 * `category` faturanın kayıtlı kategorisidir (liste de kayıtlı kategoriye göre süzülür; formda seçilen değil).
 */
export function InvoiceLines({ invoiceId, invoiceNet, category }: { invoiceId: number; invoiceNet: number; category: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/faturalar/${invoiceId}/kalemler`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as InvoiceLinesResponse & { error?: string };
        if (!r.ok) throw new Error(body.error ?? "Kalemler alınamadı");
        return body;
      })
      .then((data) => setState({ status: "ok", data }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: e.message });
      });
    return () => ctrl.abort();
  }, [invoiceId]);

  if (state.status === "ok" && !state.data.lines.length && !state.data.pending) return null;

  const lines = state.status === "ok" ? state.data.lines : [];
  const shown = open ? lines : lines.slice(0, FIRST);
  const sum = linesTotal(lines, invoiceNet);
  const linked = lines.filter((l) => l.ingredient).length;
  const linkable = isLinkableCategory(category);
  const separate = SEPARATE_CATEGORIES.includes(category);

  return (
    <section className="rounded-2xl bg-panel p-4 sm:col-span-2" aria-labelledby={`lines-${invoiceId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={`lines-${invoiceId}`} className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ListOrdered size={15} className="text-ink-mute" aria-hidden="true" /> Kalemler
          {lines.length ? <span className="font-normal text-ink-mute tabular">· {num(lines.length)}</span> : null}
        </h3>
        {state.status === "ok" && lines.length ? (
          <p className="text-xs text-ink-mute">
            {state.data.source === "ubl" ? "E-fatura belgesinden" : "Paraşüt gider faturasından"}
            {linked ? ` · ${num(linked)} hammaddeye bağlı` : ""}
          </p>
        ) : null}
      </div>
      {state.status === "ok" && lines.length && (separate || !linkable) ? (
        <p className="mt-1 text-xs text-pretty text-ink-mute">
          {separate
            ? `Kafe dışı fatura (${category}): kalemleri hammaddelerin alınan miktarına ve fiyatına girmez.`
            : "Bu kategorideki kalemler hammaddeye bağlama listesine girmez. Mal alışıysa kategoriyi değiştirip kaydedin."}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <p className="mt-2 animate-pulse text-xs text-ink-mute">Kalemler yükleniyor…</p>
      ) : state.status === "error" ? (
        <p className="mt-2 text-xs text-bad">{state.message}</p>
      ) : !lines.length ? (
        <p className="mt-2 text-xs text-pretty text-ink-mute">
          Kalemler sıradaki Paraşüt eşitlemesinde e-fatura belgesinden okunacak.{" "}
          <Link href="/panel/parasut" className="font-medium text-ink underline-offset-2 hover:underline">
            Şimdi okumak için Paraşüt sayfası →
          </Link>
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-ink/[0.06]">
            {shown.map((l) => {
              const price = ingredientPriceOf(l);
              const unitNet = netUnitPrice(l);
              return (
                <li key={l.id} className="py-2.5 first:pt-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words text-ink">{l.productName}</p>
                      <p className="mt-0.5 text-xs text-ink-mute">
                        <span className="tabular">
                          {num(l.quantity, 3)} {l.unit ?? "birim"} × {unitNet ? tl2(unitNet) : "bedava"}
                        </span>
                        {l.discount > 0.009 ? <span className="tabular"> · iskonto {tl2(l.discount)}</span> : null}
                        <span className="tabular"> · %{num(l.vatRate, 2)} KDV</span>
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-ink tabular">{tl2(l.netTotal)}</p>
                  </div>
                  {l.ingredient ? (
                    <p className="mt-1 text-xs text-ink-soft">
                      <Link2 size={12} className="mr-1 inline align-[-2px] text-good" aria-hidden="true" />
                      <Link href={`/panel/hammaddeler?ara=${encodeURIComponent(l.ingredient.name)}`} className="font-medium text-ink hover:underline pointer-coarse:py-3.5">
                        {l.ingredient.name}
                      </Link>
                      {price ? <span className="tabular text-ink-mute"> · bu faturada {tl2(price.value)}/{price.per}</span> : null}
                    </p>
                  ) : linkable ? (
                    <Link
                      href={`/panel/parasut?ara=${encodeURIComponent(l.productName)}&durum=bekleyen`}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-info hover:underline pointer-coarse:min-h-11"
                    >
                      <Link2 size={12} aria-hidden="true" /> Hammaddeye bağla
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {lines.length > FIRST ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-1 inline-flex min-h-8 cursor-pointer items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11"
              aria-expanded={open}
            >
              <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
              {open ? "Daha az göster" : `Tümünü göster (${num(lines.length)})`}
            </button>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-ink/[0.08] pt-2 text-sm">
            <span className="text-ink-mute">Kalemlerin toplamı (KDV hariç)</span>
            <span className="font-semibold text-ink tabular">{tl2(sum.total)}</span>
          </div>
          {!sum.matches ? (
            <Notice
              tone="warn"
              size="line"
              className="mt-1.5"
              title={`Faturanın KDV hariç tutarı ${tl2(invoiceNet)}; kalemler bunu tutmuyor. Kalem fiyatlarını belgeden kontrol edin.`}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
