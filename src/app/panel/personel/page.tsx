import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { InfoTip, PageSkeleton } from "@/components/ui/misc";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { StaffEditor } from "./staff-editor";

export const metadata: Metadata = { title: "Personel" };

function Header({ description }: { description?: ReactNode }) {
  return (
    <PageHeader
      eyebrow="Para"
      title="Personel"
      excel="Personel"
      description={description}
      tabs={<SectionTabs section="giderler" current="/panel/personel" />}
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
  const staff = model.ds.staff.map((x) => ({ id: x.id, name: x.name, netSalary: x.netSalary, extras: x.extras, active: x.active }));
  return (
    <>
      <Header
        description={
          <>
            Net maaştan tahmini brüt maaş ve işveren maliyeti. Bu tutar Sabit giderler ve Gelir-gider tablosuna otomatik gider olarak geçer.{" "}
            <InfoTip text="SGK oranları tahminidir; muhasebecinizden bordroyu alıp toplam işveren maliyetini kontrol edin." />
          </>
        }
      />
      <StaffEditor
        staff={staff}
        rates={{ isciSgk: st.isciSgk, isciIssizlik: st.isciIssizlik, isverenSgk: st.isverenSgk, isverenIssizlik: st.isverenIssizlik }}
        settings={st}
      />
    </>
  );
}
