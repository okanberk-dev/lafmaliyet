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
import { loadModel } from "@/server/data/dataset";
import { getDb } from "@/server/db";
import { listAdvances } from "@/server/staff-advances";

import { AdvanceBoard, type AdvancePerson } from "./advance-board";

export const metadata: Metadata = { title: "Personel avansları" };

const DESCRIPTION = "Verilen avanslar, maaştan düşülenler ve kişi başı kalan.";
const MORE =
  "Avans verdiğinizde 'Avans ver', maaş ödediğiniz ay düştüğünüz tutarı 'Maaştan düş' ile yazın; kalan kişi başına görünür. Avans gider değildir: maaş Giderler & maaşlar'da işveren maliyetiyle zaten kâr-zarara girer, avans o maaşın erken ödenen parçasıdır, ayrıca gider yazılmaz. 'Bu ay ele geçecek' = bu ayın net maaşı + ek ödeme − bu ay maaştan düşülen. Avansı kasadan verdiyseniz kasa sayımı için Kasa raporu'na 'Teslim' olarak da girin.";

function Header() {
  return (
    <PageHeader
      path="/panel/personel/avans"
      title="Personel avansları"
      description={DESCRIPTION}
      more={MORE}
      tabs={<SectionTabs section="giderler" current="/panel/personel/avans" role="admin" />}
    />
  );
}

export default function StaffAdvancePage() {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={5} />
        </>
      }
    >
      <AdvanceContent />
    </Suspense>
  );
}

async function AdvanceContent() {
  await requireAdmin();
  const scope = await currentBranchScope();
  // Maaşlar'la aynı model: kişiler seçili şubenin, net maaş bu ayın (maaş değişikliği aydan itibaren)
  const [model, rows, branches] = await Promise.all([loadModel(), listAdvances(getDb(), scope), listBranches()]);
  const today = todayTR();
  const physical = branches.filter((b) => b.active && b.kind === "fiziksel");
  const nameOf = new Map(branches.map((b) => [b.id, b.name]));
  const people: AdvancePerson[] = model.staffList.map((x) => ({
    id: x.id,
    name: x.name,
    // Part-time'ın aylık net maaşı yok (günlük ücret × çağrıldığı gün): ele geçecek hesaplanmaz
    net: (x.kind ?? "full_time") === "part_time" ? null : x.netSalary,
    extras: (x.kind ?? "full_time") === "part_time" ? 0 : x.extras,
    left: staffLeft(x.endMonth ?? null, today, true),
    branchName: physical.length > 1 ? (nameOf.get(x.branchId ?? DEFAULT_BRANCH_ID) ?? null) : null,
  }));
  return (
    <>
      <Header />
      <AdvanceBoard people={people} rows={rows} today={today} />
    </>
  );
}
