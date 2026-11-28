import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { SubeEkleme } from "@/components/sube-ekleme/sube-ekleme-client";
import { isAnaAdmin } from "@/lib/asil-yonetici";
import { createBranch, releaseBranchTill, saveBranchStaff, sendBranchInstall } from "@/server/actions/branches";
import { requireAdmin } from "@/server/auth/dal";
import { subeEklemeVerisi } from "@/server/sube-ekleme";

export const metadata: Metadata = { title: "Şube ekleme" };

/**
 * Şube ekleme (Ayarlar › Şube ekleme; docs/SUBE.md › Şube ekleme, docs/ASILPOS.md › Şube kurulumu, › Kasa açılışı):
 * yeni şube (ilk personeliyle), şubelerin kasa durumu, "Bilgisayara kur", "İlk personeli ayarla" ve "Kasayı serbest
 * bırak". Yalnız asıl yönetici (docs/ROLLER.md › Asıl yönetici): menüde yalnız ona görünür, başka yönetici adresle açarsa
 * içerik yerine tek cümle görür; eylemler ayrıca requireAnaAdmin ister. Üst düzey adres: /panel/subeler/[id] dinamik
 * yoluyla çakışmasın
 */
export default function BranchSetupPage() {
  return (
    <>
      <PageHeader
        path="/panel/sube-ekleme"
        title="Şube ekleme"
        description="Yeni şube açın, şubelerin kasa durumunu görün, kasayı bilgisayara kurun ya da serbest bırakın."
        more="Şube açmak, kapatmak, silmek, kasasını kurmak ve serbest bırakmak, ilk personelini ayarlamak yalnız asıl yöneticinin işidir. Şubenin adı, POS oranı, özellikleri ve e-postası Şubeler'de her yöneticiyle düzenlenir. Bilgisayara kur, şubenin e-postasına 14 gün geçerli, tek kurulumluk bir bağlantı gönderir; kasa ilk açılışta şubeye kendiliğinden bağlanır. Kasası kurulu şube kasadan seçilemez: bilgisayar değişecekse önce burada kasayı serbest bırakın."
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <BranchSetupContent />
      </Suspense>
    </>
  );
}

async function BranchSetupContent() {
  const me = await requireAdmin();
  if (!isAnaAdmin(me)) {
    return <Notice tone="neutral" title="Şube ekleme ve kasa kurulumu yalnız asıl yöneticinin hesabında açılır." />;
  }
  const veri = await subeEklemeVerisi();
  return (
    <SubeEkleme
      {...veri}
      createAction={createBranch}
      installAction={sendBranchInstall}
      staffAction={saveBranchStaff}
      releaseAction={releaseBranchTill}
    />
  );
}
