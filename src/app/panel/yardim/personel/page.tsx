import { HelpCircle } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Yardım" };

/**
 * Personelin Yardım'ı (plan docs/planlar/personel-yetki.md §2.10; menüde ve profil menüsünde Adım 0'dan beri): yalnız
 * personelin ekranları, yönetici bölümleri hiç gönderilmez. İçerik operasyon grubunun son maddesiyle gelir; o zamana
 * kadar yer tutucu. İçerik bir Suspense çocuğunda, oturum okunduktan sonra çizilir.
 */
export default function StaffHelpPage() {
  return (
    <>
      <PageHeader eyebrow="Personel" title="Yardım" description="Ekranlarınızda ne yapılır, adım adım." />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <StaffHelpContent />
      </Suspense>
    </>
  );
}

async function StaffHelpContent() {
  await requireUser();
  return (
    <Card>
      <EmptyState icon={<HelpCircle />} title="Yakında" description="Bu sayfada kasa raporu, kontrol listeleri, zayi ve öteki ekranlarınızın anlatımı olacak." />
    </Card>
  );
}
