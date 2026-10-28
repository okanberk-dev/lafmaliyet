import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { KasaText } from "@/components/panel/kasa-text";
import { PageHeader } from "@/components/panel/page-header";
import { PosChecklist } from "@/components/panel/pos-checklist";
import { PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";
import { loadMyPosMarks, loadStaffPosList } from "@/server/data/pos-staff";
import { loadTillScope } from "@/server/data/till-scope";

export const metadata: Metadata = { title: "Kasadaki fiyatlar" };

const TITLE = "Kasadaki fiyatlar";
const DESCRIPTION = "Bu fiyatlar panelde değişti, ModPOS'ta hâlâ eski. ModPOS'ta değiştirdikçe işaretleyin.";
/**
 * LafPOS'a geçiş gününden itibaren (denetim E-39): siteye bağlı ürünün fiyatı LafPOS'a siteden kendiliğinden gelir,
 * öbürünü LafPOS'ta menüyü yöneten (patron, müdür) değiştirir; kasiyer değiştiremez, personele iş düşmez
 */
const DESCRIPTION_LAFPOS = "LafPOS menüdeki fiyatları siteden kendisi alır; siteye bağlı olmayan ürünlerin fiyatını LafPOS'ta yönetici değiştirir.";

/**
 * Personelin Kasadaki fiyatlar listesi (dalga 10 §2.2; docs/FIYATLAR.md): ModPOS'ta değişecek satış fiyatları, tek tek
 * işaretlenir (onaysız; her işaret kişinin adıyla kayıtlı, geri alınabilir). Okumalar personelin sabit sütunlu
 * yükleyicisinden (src/server/data/pos-staff.ts): kaynak, değiştiren kişi, not ve maliyet yok. Yönetici bu adresi açarsa
 * Ürünler › Fiyatlar › Kasaya işle'ye gider. LafPOS'a geçiş gününden itibaren (src/lib/lafpos/kasa.ts tillScope) liste
 * yok: LafPOS'ta ürün fiyatını yönetici değiştirir (Bugün ve zil de personele bu görevi vermez); son işaretleri yine
 * geri alınabilir.
 */
export default function StaffPosPage() {
  return (
    <>
      <PageHeader eyebrow="Günlük" title={TITLE} description={<KasaText modpos={DESCRIPTION} lafpos={DESCRIPTION_LAFPOS} />} />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <StaffPosContent />
      </Suspense>
    </>
  );
}

async function StaffPosContent() {
  const me = await requireUser();
  if (me.role === "admin") redirect("/panel/urunler/fiyatlar?sekme=kasa");
  const now = new Date();
  const scope = await loadTillScope(undefined, now);
  const [items, mine] = await Promise.all([scope.lafpos ? [] : loadStaffPosList(scope), loadMyPosMarks(me.id, now)]);
  return <PosChecklist staff items={items} mine={mine} kasa={scope.kasa} />;
}
