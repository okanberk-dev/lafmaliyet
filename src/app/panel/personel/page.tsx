import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { InfoTip, PageSkeleton } from "@/components/ui/misc";
import { staffDeleteBlockers } from "@/server/actions/costs";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { choiceMonths, closedDataMonths, staffDeleteBlocker } from "../giderler/history-text";
import { StaffEditor, type StaffRow } from "./staff-editor";

export const metadata: Metadata = { title: "Personel" };

function Header({ description }: { description?: ReactNode }) {
  return (
    <PageHeader
      eyebrow="Alış & gider"
      title="Personel"
      excel="Personel"
      description={description}
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
  const model = await loadModel();
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
  }));
  return (
    <>
      <Header
        description={
          <>
            Net maaştan tahmini brüt maaş ve işveren maliyeti. Bu tutar Sabit giderler ve Gelir-gider tablosuna otomatik gider olarak geçer.{" "}
            <InfoTip text="SGK oranları tahminidir; muhasebecinizden bordroyu alıp toplam işveren maliyetini kontrol edin. Maaş değişince 'hangi aydan itibaren' sorulur: önceki aylar eski maaşla kalır." />
          </>
        }
      />
      <StaffEditor
        staff={staff}
        rates={{ isciSgk: st.isciSgk, isciIssizlik: st.isciIssizlik, isverenSgk: st.isverenSgk, isverenIssizlik: st.isverenIssizlik }}
        settings={st}
        currentMonth={cur}
        closed={closed}
        months={choiceMonths(cur, model.firstDataMonth)}
      />
    </>
  );
}
