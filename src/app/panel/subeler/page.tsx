import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { CASH_REPORT_GROUP, PARASUT_GROUP } from "@/lib/branch-settings/groups";
import { settingMode, settingModeText } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import { isAnaAdmin } from "@/lib/asil-yonetici";
import { deleteBranch, updateBranch } from "@/server/actions/branches";
import { requireAdmin } from "@/server/auth/dal";
import { settingLinks } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

import { BranchesAdmin } from "./branches-admin";

export const metadata: Metadata = { title: "Şubeler" };

/**
 * Şubeler ve kanallar (docs/SUBE.md): fiziksel şubeler (Tuzla, Marina) ile laffogato.net'in online kanalı tek
 * listede. Yalnız yönetici. Menü, reçete ve hammadde ortaktır; burada yalnız şubenin kimliği, adı, kasa kaynağı,
 * e-postası ve açık / kapalı durumu tutulur; şubeye göre değişen ayarlar her şubenin "Ayarlar"ında (/panel/subeler/[id]).
 * Şube açmak ve kasa kurmak Şube ekleme sayfasında (/panel/sube-ekleme); kapatmak, silmek ve kasa programını değiştirmek
 * burada, ama yalnız asıl yöneticide (docs/ROLLER.md › Asıl yönetici)
 */
export default function BranchesPage() {
  return (
    <>
      <PageHeader
        path="/panel/subeler"
        title="Şubeler"
        description="Fiziksel şubeler ve laffogato.net'in online kanalı. Ciro, kasa ve giderler bu listeye göre ayrılır."
        more="Menü, reçete, hammadde ve tedarikçiler bütün şubelerde ortaktır; şubeye göre değişen yalnız satış fiyatı ve Satışta / Tükendi durumudur. Bir şubenin kimliği eklendikten sonra değişmez: kayıtlar ona bağlanır. Tuzla ve laffogato.net silinemez, kapatılamaz. Şube açmak, kapatmak, silmek, kasa programını değiştirmek ve kasa kurmak yalnız asıl yöneticinin işidir."
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <BranchesContent />
      </Suspense>
    </>
  );
}

async function BranchesContent() {
  const me = await requireAdmin();
  const db = getDb();
  const [rows, links, parasutLinks, emailRows] = await Promise.all([
    listBranches(db),
    settingLinks(CASH_REPORT_GROUP.id),
    settingLinks(PARASUT_GROUP.id),
    db.select({ id: s.branches.id, email: s.branches.email }).from(s.branches),
  ]);
  // Birden çok kasa açıkken her fiziksel şubenin satırında kasa raporu alıcılarının ve Paraşüt hesabının durumu
  // ("Tuzla ile aynı")
  const many = tillBranches(rows).length > 1;
  const settingsText = many ? Object.fromEntries(tillBranches(rows).map((b) => [b.id, settingModeText(settingMode(CASH_REPORT_GROUP, b.id, links), rows)])) : {};
  const parasutText = many ? Object.fromEntries(tillBranches(rows).map((b) => [b.id, settingModeText(settingMode(PARASUT_GROUP, b.id, parasutLinks), rows)])) : {};
  return (
    <BranchesAdmin
      rows={rows}
      settingsText={settingsText}
      parasutText={parasutText}
      emails={Object.fromEntries(emailRows.map((r) => [r.id, r.email]))}
      updateAction={updateBranch}
      deleteAction={deleteBranch}
      // Asıl yönetici (sunucuda; eylemler aynı denetimi kullanır): kapatma, silme, kasa programı ve Şube ekleme bağlantısı
      anaAdmin={isAnaAdmin(me)}
    />
  );
}
