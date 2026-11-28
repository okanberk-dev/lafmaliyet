import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { anaAdminEmail, isAnaAdmin } from "@/lib/asil-yonetici";
import { createBranch, releaseBranchTill, saveBranchStaff, sendBranchInstall } from "@/server/actions/branches";
import { requireAdmin } from "@/server/auth/dal";
import { ilkPersonelDurumlari } from "@/server/asilpos/ilk-personel";
import { loadKasaDurumlari, loadSerbestBilgileri } from "@/server/asilpos/kasa-durumu";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

import { SubeEkleme } from "./sube-ekleme-client";

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
  const db = getDb();
  const [rows, emailRows] = await Promise.all([listBranches(db), db.select({ id: s.branches.id, email: s.branches.email }).from(s.branches)]);
  const fiziksel = rows.filter((b) => b.kind === "fiziksel").map((b) => b.id);
  const durum = await loadKasaDurumlari(fiziksel, db);
  // İlk personelin durumu (PIN'siz) ve kurulu kasaların serbest bırakma bilgisi (canlı şube, ortamdaki anahtar)
  const [personel, serbest] = await Promise.all([
    ilkPersonelDurumlari(fiziksel, db),
    loadSerbestBilgileri(
      fiziksel.filter((id) => durum[id]?.durum === "kurulu"),
      db,
    ),
  ]);
  return (
    <SubeEkleme
      rows={rows}
      emails={Object.fromEntries(emailRows.map((r) => [r.id, r.email]))}
      durum={durum}
      personel={personel}
      serbest={serbest}
      girisHesabi={anaAdminEmail()}
      createAction={createBranch}
      installAction={sendBranchInstall}
      staffAction={saveBranchStaff}
      releaseAction={releaseBranchTill}
    />
  );
}
