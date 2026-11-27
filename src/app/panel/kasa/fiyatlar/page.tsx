import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { KasaText } from "@/components/panel/kasa-text";
import { PageHeader } from "@/components/panel/page-header";
import { PosChecklist } from "@/components/panel/pos-checklist";
import { PageSkeleton } from "@/components/ui/misc";
import { requireCan } from "@/server/auth/dal";
import { loadMyPosMarks, loadStaffPosList } from "@/server/data/pos-staff";
import { loadTillScopes } from "@/server/data/till-scope";

export const metadata: Metadata = { title: "Kasadaki fiyatlar" };

const TITLE = "Kasadaki fiyatlar";
const DESCRIPTION = "Bu fiyatlar panelde değişti, ModPOS'ta hâlâ eski. ModPOS'ta değiştirdikçe işaretleyin.";
/**
 * AsilPOS'a geçiş gününden itibaren (denetim E-39): siteye bağlı ürünün fiyatı AsilPOS'a siteden kendiliğinden gelir,
 * öbürünü AsilPOS'ta menüyü yöneten (patron, müdür) değiştirir; kasiyer değiştiremez, personele iş düşmez
 */
const DESCRIPTION_ASILPOS = "AsilPOS menüdeki fiyatları siteden kendisi alır; siteye bağlı olmayan ürünlerin fiyatını AsilPOS'ta yönetici değiştirir.";

/**
 * Personelin Kasadaki fiyatlar listesi (dalga 10 §2.2; docs/FIYATLAR.md): ModPOS'ta değişecek satış fiyatları, tek tek
 * işaretlenir (onaysız; her işaret kişinin adıyla kayıtlı, geri alınabilir). Okumalar personelin sabit sütunlu
 * yükleyicisinden (src/server/data/pos-staff.ts): kaynak, değiştiren kişi, not ve maliyet yok. Yönetici bu adresi açarsa
 * Ürünler › Fiyatlar › Kasaya işle'ye gider. AsilPOS'a geçiş gününden itibaren (src/lib/asilpos/kasa.ts tillScope) liste
 * yok: AsilPOS'ta ürün fiyatını yönetici değiştirir (Bugün ve zil de personele bu görevi vermez); son işaretleri yine
 * geri alınabilir.
 */
export default function StaffPosPage() {
  return (
    <>
      <PageHeader path="/panel/kasa/fiyatlar" role="staff" title={TITLE} description={<KasaText modpos={DESCRIPTION} asilpos={DESCRIPTION_ASILPOS} />} />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <StaffPosContent />
      </Suspense>
    </>
  );
}

async function StaffPosContent() {
  // Muhasebeci giremez (işaretleme yazar; proxy de döndürür)
  const me = await requireCan("kayit.yaz");
  if (me.role === "admin") redirect("/panel/urunler/fiyatlar?sekme=kasa");
  const now = new Date();
  // Kasa şube başınadır (şube kapsamı A3): seçili şubenin (kilitli personelde kendi şubesinin) kasası; "Tümü"de birden çok
  // kasa açıkken her kasa ayrı liste
  const tills = await loadTillScopes(undefined, now);
  const lists = await Promise.all(
    tills.map(async (scope) => {
      const [items, mine] = await Promise.all([scope.asilpos ? [] : loadStaffPosList(scope), loadMyPosMarks(me.id, now, scope.branchId)]);
      return { scope, items, mine };
    }),
  );
  return (
    <div className="space-y-4">
      {lists.map(({ scope, items, mine }) => (
        <PosChecklist key={scope.branchId} staff items={items} mine={mine} kasa={scope.kasa} branchId={scope.branchId} branchName={scope.name} />
      ))}
    </div>
  );
}
