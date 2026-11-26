import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { CASH_REPORT_GROUP, PARASUT_GROUP } from "@/lib/branch-settings/groups";
import { settingMode, settingModeText } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import { isAnaAdmin } from "@/lib/lafpos/kurulum";
import { createBranch, deleteBranch, sendBranchInstall, updateBranch } from "@/server/actions/branches";
import { requireAdmin } from "@/server/auth/dal";
import { listInstalls } from "@/server/lafpos/kurulum";
import { settingLinks } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

import { BranchesAdmin } from "./branches-admin";
import { LafposInstallCard } from "./lafpos-install";

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
  const me = await requireAdmin();
  const [rows, links, parasutLinks] = await Promise.all([listBranches(getDb()), settingLinks(CASH_REPORT_GROUP.id), settingLinks(PARASUT_GROUP.id)]);
  // Şube kurulumu (docs/LAFPOS.md › Şube kurulumu): şube eklemek ve kurulum bağlantısı göndermek yalnız ana yöneticide;
  // her fiziksel şubenin son bağlantısı ve e-postası satırda
  const canCreate = isAnaAdmin(me);
  const installs = canCreate
    ? Object.fromEntries(await Promise.all(rows.filter((b) => b.kind === "fiziksel").map(async (b) => [b.id, (await listInstalls(getDb(), b.id))[0] ?? null] as const)))
    : {};
  // Birden çok kasa açıkken her fiziksel şubenin satırında kasa raporu alıcılarının ve Paraşüt hesabının durumu
  // ("Tuzla ile aynı")
  const many = tillBranches(rows).length > 1;
  const settingsText = many ? Object.fromEntries(tillBranches(rows).map((b) => [b.id, settingModeText(settingMode(CASH_REPORT_GROUP, b.id, links), rows)])) : {};
  const parasutText = many ? Object.fromEntries(tillBranches(rows).map((b) => [b.id, settingModeText(settingMode(PARASUT_GROUP, b.id, parasutLinks), rows)])) : {};
  const emails = canCreate ? Object.fromEntries((await getDb().select({ id: s.branches.id, email: s.branches.email }).from(s.branches)).map((r) => [r.id, r.email])) : {};
  return (
    <div className="space-y-4">
      {canCreate ? <LafposInstallCard rows={rows} installs={installs} emails={emails} createAction={createBranch} installAction={sendBranchInstall} /> : null}
      <BranchesAdmin rows={rows} settingsText={settingsText} parasutText={parasutText} createAction={createBranch} updateAction={updateBranch} deleteAction={deleteBranch} canCreate={canCreate} installs={installs} installAction={sendBranchInstall} />
    </div>
  );
}
