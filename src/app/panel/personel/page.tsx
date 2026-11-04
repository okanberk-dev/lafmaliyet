import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { staffDeleteBlockers } from "@/server/actions/costs";
import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { requireAdmin } from "@/server/auth/dal";
import { currentPhysicalBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadModel } from "@/server/data/dataset";

import { choiceMonths, closedDataMonths, staffDeleteBlocker } from "../giderler/history-text";
import { StaffEditor, type StaffBranches, type StaffRow } from "./staff-editor";

export const metadata: Metadata = { title: "Maaşlar" };

const DESCRIPTION = "Çalışanların net maaşı, brüt maaşı ve size maliyeti; SGK oranları en altta.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Net maaştan tahmini brüt maaş ve işveren maliyeti. Bu tutar Sabit giderler ve Gelir-gider tablosuna otomatik gider olarak geçer. SGK oranları tahminidir; muhasebecinizden bordroyu alıp toplam işveren maliyetini kontrol edin. Maaş değişince 'hangi aydan itibaren' sorulur: önceki aylar eski maaşla kalır.";

function Header() {
  return (
    <PageHeader
      path="/panel/personel"
      title="Maaşlar"
      description={DESCRIPTION}
      more={MORE}
      tabs={<SectionTabs section="giderler" current="/panel/personel" role="admin" />}
    />
  );
}

export default function StaffPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <PageSkeleton rows={5} />
        </>
      }
    >
      <StaffContent />
    </Suspense>
  );
}

async function StaffContent() {
  await requireAdmin();
  // Şube seçiliyken o şubenin personeli (docs/SUBE.md); yeni kişi seçili şubeye ("Tümü"de Tuzla) eklenir
  const [model, all, here] = await Promise.all([loadModel(), listBranches(), currentPhysicalBranch()]);
  const physical = all.filter((b) => b.active && b.kind === "fiziksel");
  const branches: StaffBranches = { options: physical.map((b) => ({ id: b.id, name: b.name })), fallback: here.id };
  const nameOf = new Map(all.map((b) => [b.id, b.name]));
  const st = model.settings;
  const cur = model.currentMonth;
  const closed = closedDataMonths(model.ds, cur);
  // Silinemeyecek kişiler ve nedeni sunucudaki kuraldan (saveStaff aynı kuralla reddeder); okunamazsa aynı kuralın istemci kopyası
  const blockersRes = await staffDeleteBlockers(model.staffList.map((x) => x.id));
  // Maaşlar bu aya (ayrılmışsa son ayına, başlamadıysa ilk ayına) göre; geçmiş ve silme izni ile
  const staff: StaffRow[] = model.staffList.map((x) => ({
    id: x.id,
    name: x.name,
    netSalary: x.netSalary,
    extras: x.extras,
    startMonth: x.startMonth ?? null,
    endMonth: x.endMonth ?? null,
    status: x.status,
    inRangeNow: x.inRangeNow,
    valueMonth: x.valueMonth,
    history: x.history,
    deleteBlocker: blockersRes.ok ? (blockersRes.data[x.id] ?? null) : staffDeleteBlocker(x, closed),
    branchId: x.branchId ?? DEFAULT_BRANCH_ID,
    branchName: physical.length > 1 ? (nameOf.get(x.branchId ?? DEFAULT_BRANCH_ID) ?? null) : null,
  }));
  return (
    <>
      <Header />
      <StaffEditor
        staff={staff}
        rates={{ isciSgk: st.isciSgk, isciIssizlik: st.isciIssizlik, isverenSgk: st.isverenSgk, isverenIssizlik: st.isverenIssizlik }}
        settings={st}
        currentMonth={cur}
        closed={closed}
        months={choiceMonths(cur, model.firstDataMonth)}
        branches={branches}
      />
    </>
  );
}
