import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";

import { StaffEditor } from "./staff-editor";

export const metadata: Metadata = { title: "Personel" };

export default function StaffPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Personel" excel="Personel" />
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
  return (
    <>
      <PageHeader
        title="Personel"
        excel="Personel"
        description="Net maaştan tahmini brüt maaş ve işveren maliyeti. SGK oranları tahminidir; muhasebecinizden bordroyu alıp toplam işveren maliyetini kontrol edin. Bu tutar Sabit Giderler ve Gelir-gider tablosuna otomatik gider."
      />
      <StaffEditor
        staff={model.ds.staff.map((x) => ({ id: x.id, name: x.name, netSalary: x.netSalary, extras: x.extras, active: x.active }))}
        rates={{ isciSgk: st.isciSgk, isciIssizlik: st.isciIssizlik, isverenSgk: st.isverenSgk, isverenIssizlik: st.isverenIssizlik }}
        settings={st}
      />
    </>
  );
}
