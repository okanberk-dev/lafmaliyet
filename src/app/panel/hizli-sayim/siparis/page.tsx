import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";
import { loadDraftSheet } from "@/server/data/order-drafts";

import { DraftSheetClient } from "./draft-sheet";

export const metadata: Metadata = { title: "Sipariş taslağı" };

const DESCRIPTION = "Sayıma göre önerilen miktarlar. Gerekirse değiştirip onaya gönderin; yönetici onaylayınca WhatsApp'tan gönderirsiniz.";

/**
 * Personelin mal siparişi taslağı (docs/MAL-SIPARISI.md › Personelin sipariş taslağı; plan
 * docs/planlar/personel-yetki.md §2.4): hızlı sayımdan sonra tedarikçi tedarikçi fiyatsız taslak, onaya gönderme,
 * onaylananı WhatsApp'tan gönderme. Ekranda fiyat, tutar, hedef ve günlük kullanım yok. Yönetici doğrudan Mal
 * siparişi'nden gönderir; buraya gelirse oraya yönlenir.
 */
export default function DraftPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Stok" title="Sipariş taslağı" description={DESCRIPTION} />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <DraftContent />
    </Suspense>
  );
}

async function DraftContent() {
  const user = await requireUser();
  if (user.role === "admin") redirect("/panel/mal-siparisi");
  const sheet = await loadDraftSheet(user);
  return (
    <>
      <PageHeader eyebrow="Stok" title="Sipariş taslağı" description={DESCRIPTION} />
      <DraftSheetClient sheet={sheet} />
    </>
  );
}
