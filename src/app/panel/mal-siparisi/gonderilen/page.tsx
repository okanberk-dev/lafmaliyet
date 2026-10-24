import { Send, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { requireAdmin } from "@/server/auth/dal";
import { loadOrderHistory, type HistoryFilter } from "@/server/data/reorder";

import { OrderCard } from "../order-card";

export const metadata: Metadata = { title: "Gönderilenler" };

const DESCRIPTION = "Panelden gönderilen mal siparişleri. Paraşüt faturası gelince kalem kalem karşılaştırılır; fark yoksa sipariş kendiliğinden kapanır.";

const FILTER_LABEL: Record<HistoryFilter, string> = { acik: "Açık", fark: "Fark var", kapanan: "Kapanan", tumu: "Tümü" };

/** Gönderilen mal siparişleri ve teslim kontrolü (docs/MAL-SIPARISI.md); yalnız yönetici */
export default function SentOrdersPage({ searchParams }: PageProps<"/panel/mal-siparisi/gonderilen">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Stok" title="Gönderilenler" description={DESCRIPTION} tabs={<SectionTabs section="malSiparisi" current="/panel/mal-siparisi/gonderilen" />} />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <SentOrdersContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function SentOrdersContent({ searchParams }: { searchParams: PageProps<"/panel/mal-siparisi/gonderilen">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = await loadOrderHistory({ durum: pick(sp.durum), tedarikci: pick(sp.tedarikci) });
  const href = (durum: HistoryFilter, tedarikci = view.supplier?.slug) => {
    const q = new URLSearchParams();
    if (durum !== "acik") q.set("durum", durum);
    if (tedarikci) q.set("tedarikci", tedarikci);
    const qs = q.toString();
    return `/panel/mal-siparisi/gonderilen${qs ? `?${qs}` : ""}`;
  };
  return (
    <>
      <PageHeader eyebrow="Stok" title="Gönderilenler" description={DESCRIPTION} tabs={<SectionTabs section="malSiparisi" current="/panel/mal-siparisi/gonderilen" />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedLinks
          label="Durum"
          value={view.filter}
          options={(["acik", "fark", "kapanan", "tumu"] as const).map((k) => ({
            value: k,
            label: FILTER_LABEL[k],
            href: href(k),
            count: k === "kapanan" || k === "tumu" ? undefined : view.counts[k],
          }))}
        />
        {view.supplier ? (
          <Link
            href={href(view.filter, undefined)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-ink ring-1 ring-line-strong ring-inset hover:bg-panel pointer-coarse:min-h-11"
            aria-label={`${view.supplier.name} süzgecini kaldır`}
          >
            {view.supplier.name} <X size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {view.orders.length ? (
        <div className="space-y-4">
          {view.orders.map((o) => (
            <OrderCard key={o.order.id} view={o} filterHref={!view.supplier && o.slug ? href(view.filter, o.slug) : undefined} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Send />}
            title={view.counts.tumu ? "Bu süzgeçte sipariş yok" : "Henüz gönderilen mal siparişi yok"}
            description={view.counts.tumu ? "Başka bir durum seçin." : "Mal siparişi ekranından WhatsApp ile gönderilen siparişler burada görünür; fatura gelince karşılaştırılır."}
          />
        </Card>
      )}
    </>
  );
}
