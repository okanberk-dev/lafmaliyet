import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { anaAdminEmail, isAnaAdmin } from "@/lib/asil-yonetici";
import { createBranch, sendBranchInstall } from "@/server/actions/branches";
import { requireAdmin } from "@/server/auth/dal";
import { loadKasaDurumlari } from "@/server/asilpos/kasa-durumu";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

import { SubeEkleme } from "./sube-ekleme-client";

export const metadata: Metadata = { title: "Şube ekleme" };

/**
 * Şube ekleme (Ayarlar › Şube ekleme; docs/SUBE.md › Şube ekleme, docs/ASILPOS.md › Şube kurulumu): yeni şube, şubelerin
 * kasa durumu ve "Bilgisayara kur". Yalnız asıl yönetici (docs/ROLLER.md › Asıl yönetici): menüde yalnız ona görünür,
 * başka yönetici adresle açarsa içerik yerine tek cümle görür; eylemler ayrıca requireAnaAdmin ister. Üst düzey adres:
 * /panel/subeler/[id] dinamik yoluyla çakışmasın
 */
export default function BranchSetupPage() {
  return (
    <>
      <PageHeader
        path="/panel/sube-ekleme"
        title="Şube ekleme"
        description="Yeni şube açın, şubelerin kasa durumunu görün, kasayı bilgisayara kurun."
        more="Şube açmak, kapatmak, silmek ve kasasını kurmak yalnız asıl yöneticinin işidir. Şubenin adı, POS oranı, özellikleri ve e-postası Şubeler'de her yöneticiyle düzenlenir. Bilgisayara kur, şubenin e-postasına 14 gün geçerli, tek kurulumluk bir bağlantı gönderir; kasa ilk açılışta şubeye kendiliğinden bağlanır."
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
  const durum = await loadKasaDurumlari(
    rows.filter((b) => b.kind === "fiziksel").map((b) => b.id),
    db,
  );
  return (
    <SubeEkleme
      rows={rows}
      emails={Object.fromEntries(emailRows.map((r) => [r.id, r.email]))}
      durum={durum}
      girisHesabi={anaAdminEmail()}
      createAction={createBranch}
      installAction={sendBranchInstall}
    />
  );
}
