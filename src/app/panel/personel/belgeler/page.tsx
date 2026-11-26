import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { todayTR } from "@/lib/reminders";
import { staffLeft } from "@/lib/staff-docs";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";
import { listScopeStaff, listStaffDocs } from "@/server/staff-docs";
import { photoStorage } from "@/server/storage/photos";

import { DocsBoard, type DocsPerson } from "./docs-board";

export const metadata: Metadata = { title: "Personel belgeleri" };

const DESCRIPTION = "Hijyen eğitimi, sağlık raporu ve SGK belgeleri; bitişe 30 gün kala hatırlatılır.";
const MORE =
  "Her çalışanın belgesini türü, düzenlenme ve geçerlilik bitişiyle girin; PDF ya da fotoğrafını ekleyebilirsiniz (en çok 4 MB, yalnız yöneticiler açar). Bitişe 30 gün kala ve süresi dolunca zilde ve sabah e-postasında bir kez hatırlatılır. Yenisini eklediğiniz belge 'Yenilendi' olur, hatırlatılmaz. Ayrılan kişinin belgesi hatırlatılmaz.";

function Header() {
  return (
    <PageHeader
      path="/panel/personel/belgeler"
      title="Personel belgeleri"
      description={DESCRIPTION}
      more={MORE}
      tabs={<SectionTabs section="giderler" current="/panel/personel/belgeler" role="admin" />}
    />
  );
}

export default function StaffDocsPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={5} />
        </>
      }
    >
      <DocsContent />
    </Suspense>
  );
}

async function DocsContent() {
  await requireAdmin();
  const scope = await currentBranchScope();
  const db = getDb();
  const [people, docs, branches] = await Promise.all([listScopeStaff(db, scope), listStaffDocs(db, scope), listBranches()]);
  const today = todayTR();
  const physical = branches.filter((b) => b.active && b.kind === "fiziksel");
  const nameOf = new Map(branches.map((b) => [b.id, b.name]));
  const persons: DocsPerson[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    left: staffLeft(p.endMonth, today, p.active),
    branchName: physical.length > 1 ? (nameOf.get(p.branchId ?? DEFAULT_BRANCH_ID) ?? null) : null,
  }));
  return (
    <>
      <Header />
      <DocsBoard people={persons} docs={docs} today={today} storage={photoStorage().available} />
    </>
  );
}
