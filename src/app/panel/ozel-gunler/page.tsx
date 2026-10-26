import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { businessDate } from "@/lib/cash-report";
import { STAFF_SPECIAL_LIMITS } from "@/lib/closed-days";
import { addDays } from "@/lib/reminders";
import { deleteStaffSpecialDay, saveStaffSpecialDay } from "@/server/actions/special-days-staff";
import { requireUser } from "@/server/auth/dal";
import { ownClosedRequests } from "@/server/closed-days";
import { getDb } from "@/server/db";
import { staffSpecialList } from "@/server/forecast/staff-special";

import { StaffSpecialDays } from "./staff-special-days";

export const metadata: Metadata = { title: "Özel günler" };

/**
 * Personelin özel günleri (plan docs/planlar/personel-yetki.md §2.9; docs/SATIS-TAHMINI.md › Personelin özel günleri):
 * yaklaşan maç, AVM etkinliği, kampanya; onaysız, sınırlı. Yönetici aynı listeyi Satış tahmini'nde düzenler (buraya
 * gelirse oraya yönlenir). Sayfaya giden prop'lar sabittir (tahmin tutarı ve gerçekleşen etki yok; kaynak testi).
 */
export default function StaffSpecialDaysPage() {
  return (
    <>
      <PageHeader eyebrow="Kafe" title="Özel günler" description="Maç, AVM etkinliği ve kampanya günleri: tahmin ve tatlı sayısı bunlara göre ayarlanır." />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <SpecialDaysContent />
      </Suspense>
    </>
  );
}

async function SpecialDaysContent() {
  const user = await requireUser();
  if (user.role === "admin") redirect("/panel/tahmin#ozel-gunler");
  const [rows, closed] = await Promise.all([staffSpecialList(getDb(), user), ownClosedRequests(user)]);
  // Saat okumalardan sonra (Cache Components)
  const today = businessDate();
  return (
    <StaffSpecialDays
      rows={rows}
      closed={closed}
      today={today}
      minDate={addDays(today, 1)}
      maxDate={addDays(today, STAFF_SPECIAL_LIMITS.aheadDays)}
      saveAction={saveStaffSpecialDay}
      deleteAction={deleteStaffSpecialDay}
    />
  );
}
