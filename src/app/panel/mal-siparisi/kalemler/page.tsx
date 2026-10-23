import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { requireAdmin } from "@/server/auth/dal";
import { loadReorderItemsView } from "@/server/data/reorder";

import { ReorderItemsClient } from "../reorder-items";

export const metadata: Metadata = { title: "Sipariş kalemleri" };

const DESCRIPTION = "Hızlı sayımda sayılan ve sipariş önerilen kalemler, hedef stokları ve tedarikçileri.";

/** Mal siparişinin kalemleri ve ayarları (docs/MAL-SIPARISI.md); yalnız yönetici */
export default function ReorderItemsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Stok" title="Sipariş kalemleri" description={DESCRIPTION} tabs={<SectionTabs section="malSiparisi" current="/panel/mal-siparisi/kalemler" />} />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <ReorderItemsContent />
    </Suspense>
  );
}

async function ReorderItemsContent() {
  await requireAdmin();
  const view = await loadReorderItemsView();
  return (
    <>
      <PageHeader eyebrow="Stok" title="Sipariş kalemleri" description={DESCRIPTION} tabs={<SectionTabs section="malSiparisi" current="/panel/mal-siparisi/kalemler" />} />
      <ReorderItemsClient view={view} />
    </>
  );
}
