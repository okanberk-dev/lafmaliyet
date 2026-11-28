import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";

import { SubeEklemeIcerik } from "./icerik";

export const metadata: Metadata = { title: "Şube ekleme" };

/**
 * Eski adres (Ayarlar › Şube ekleme; 28 Kasım 2026'ya dek): şube ekleme ve kasa kurulumu artık yalnız Yönetim
 * konsolunda (docs/planlar/yonetim-konsolu.md › K-C). Eski bağlantılar ve yer imleri kırılmasın: asıl yönetici konsolun
 * Şubeler ve kasalar sayfasına yönlenir, öteki yönetici tek cümle görür (icerik.tsx). Menüde ve komut paletinde yok.
 * Üst düzey adres: /panel/subeler/[id] dinamik yoluyla çakışmasın
 */
export default function BranchSetupPage() {
  return (
    <>
      <PageHeader path="/panel/sube-ekleme" title="Şube ekleme" description="Şube ekleme ve kasa kurulumu Yönetim konsoluna taşındı." />
      <Suspense fallback={<PageSkeleton rows={1} />}>
        <SubeEklemeIcerik />
      </Suspense>
    </>
  );
}
