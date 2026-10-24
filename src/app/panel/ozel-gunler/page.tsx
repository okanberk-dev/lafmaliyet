import { CalendarHeart } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Özel günler" };

/**
 * Personelin özel günleri (plan docs/planlar/personel-yetki.md §2.9; menüde Adım 0'dan beri): yaklaşan maç, AVM
 * etkinliği ve kampanya günleri. Ekranın kendisi kasa grubunun maddesiyle gelir; o zamana kadar yer tutucu. Yönetici
 * aynı listeyi Satış tahmini'nde düzenler.
 */
export default function StaffSpecialDaysPage() {
  return (
    <>
      <PageHeader eyebrow="Günlük" title="Özel günler" description="Maç, AVM etkinliği ve kampanya günleri: tahmin ve tatlı sayısı bunlara göre ayarlanır." />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <SpecialDaysContent />
      </Suspense>
    </>
  );
}

async function SpecialDaysContent() {
  const user = await requireUser();
  if (user.role === "admin") redirect("/panel/tahmin#ozel-gunler");
  return (
    <Card>
      <EmptyState icon={<CalendarHeart />} title="Yakında" description="Yaklaşan maç, AVM etkinliği ve kampanya günlerini buradan ekleyeceksiniz." />
    </Card>
  );
}
