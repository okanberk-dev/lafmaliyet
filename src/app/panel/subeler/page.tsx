import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { CASH_REPORT_GROUP, PARASUT_GROUP } from "@/lib/branch-settings/groups";
import { settingMode, settingModeText } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import { createBranch, deleteBranch, updateBranch } from "@/server/actions/branches";
import { requireAdmin } from "@/server/auth/dal";
import { settingLinks } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";

import { BranchesAdmin } from "./branches-admin";

export const metadata: Metadata = { title: "Şubeler" };

/**
 * Şubeler ve kanallar (docs/SUBE.md): fiziksel şubeler (Tuzla, Marina) ile laffogato.net'in online kanalı tek
 * listede. Yalnız yönetici. Menü, reçete ve hammadde ortaktır; burada yalnız şubenin kimliği, adı, kasa kaynağı
 * ve açık / kapalı durumu tutulur; şubeye göre değişen ayarlar her şubenin "Ayarlar"ında (/panel/subeler/[id]).
 */
export default function BranchesPage() {
  return (
    <>
      <PageHeader
        path="/panel/subeler"
        title="Şubeler"
        description="Fiziksel şubeler ve laffogato.net'in online kanalı. Ciro, kasa ve giderler bu listeye göre ayrılır."
        more="Menü, reçete, hammadde ve tedarikçiler bütün şubelerde ortaktır; şubeye göre değişen yalnız satış fiyatı ve Satışta / Tükendi durumudur. Bir şubenin kimliği eklendikten sonra değişmez: kayıtlar ona bağlanır. Tuzla ve laffogato.net silinemez, kapatılamaz."
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <BranchesContent />
      </Suspense>
    </>
  );
}

async function BranchesContent() {
  await requireAdmin();
  const [rows, links, parasutLinks] = await Promise.all([listBranches(getDb()), settingLinks(CASH_REPORT_GROUP.id), settingLinks(PARASUT_GROUP.id)]);
  // Birden çok kasa açıkken her fiziksel şubenin satırında kasa raporu alıcılarının ve Paraşüt hesabının durumu
  // ("Tuzla ile aynı")
  const many = tillBranches(rows).length > 1;
  const settingsText = many ? Object.fromEntries(tillBranches(rows).map((b) => [b.id, settingModeText(settingMode(CASH_REPORT_GROUP, b.id, links), rows)])) : {};
  const parasutText = many ? Object.fromEntries(tillBranches(rows).map((b) => [b.id, settingModeText(settingMode(PARASUT_GROUP, b.id, parasutLinks), rows)])) : {};
  return <BranchesAdmin rows={rows} settingsText={settingsText} parasutText={parasutText} createAction={createBranch} updateAction={updateBranch} deleteAction={deleteBranch} />;
}
