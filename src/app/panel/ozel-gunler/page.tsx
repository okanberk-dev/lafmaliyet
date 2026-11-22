import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { tillBranches } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { STAFF_SPECIAL_LIMITS } from "@/lib/closed-days";
import { addDays } from "@/lib/reminders";
import { deleteSpecialDay, saveSpecialDay } from "@/server/actions/special-days";
import { deleteStaffSpecialDay, saveStaffSpecialDay } from "@/server/actions/special-days-staff";
import { requireUser } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { ownClosedRequests } from "@/server/closed-days";
import { getDb } from "@/server/db";
import { loadSpecialDays, SPECIAL_MAX_AHEAD_DAYS, SPECIAL_PAST_DAYS } from "@/server/special-days";
import { staffSpecialList } from "@/server/staff-special";

import { SpecialDayProvider, SpecialDaysCard, type SpecialDayItem } from "./special-days";
import { StaffSpecialDays } from "./staff-special-days";

export const metadata: Metadata = { title: "Özel günler" };

/**
 * Özel günler (docs/OZEL-GUNLER.md): maç, AVM etkinliği, kampanya ve "kafe kapalı" günleri — takvim notudur,
 * hiçbir hesaba girmez. Satış tahmini 4 Kasım 2026'da kaldırılınca yöneticinin listesi de buraya taşındı
 * (eskiden Satış tahmini ekranındaydı).
 *
 * Yönetici bütün listeyi düzenler; personel yalnız kendi girdiklerini, onaysız ve sınırlı (dalga 10 §2.9).
 * Personele giden prop'lar sabittir (tutar ve gerçekleşen etki yok; kaynak testi).
 */
/**
 * Başlık rolü bilmek zorunda (bağlam satırı yöneticide "Kafe", personelde yok) ama rol çereze bakar: sayfanın
 * gövdesinde okunursa ön üretim düşer ("uncached or runtime data during prerendering"). Kasa'daki kurala uyulur:
 * rol okunana kadar en dar olan, yani personelin başlığı çizilir.
 */
function SpecialDaysHeader({ role }: { role: "admin" | "staff" }) {
  return (
    <PageHeader
      path="/panel/ozel-gunler"
      role={role}
      title="Özel günler"
      description={
        role === "admin"
          ? "Maç, AVM etkinliği, kampanya ve kafe kapalı günleri: takvim notu olarak işaretlenir."
          : "Maç, AVM etkinliği ve kampanya günlerini buradan bildirirsiniz."
      }
    />
  );
}

async function SpecialDaysHeaderWithRole() {
  const user = await requireUser();
  return <SpecialDaysHeader role={user.role === "admin" ? "admin" : "staff"} />;
}

async function SpecialDaysContent() {
  const user = await requireUser();
  return user.role === "admin" ? <AdminContent /> : <StaffContent />;
}

export default function SpecialDaysPage() {
  return (
    <>
      <Suspense fallback={<SpecialDaysHeader role="staff" />}>
        <SpecialDaysHeaderWithRole />
      </Suspense>
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <SpecialDaysContent />
      </Suspense>
    </>
  );
}

async function AdminContent() {
  const [rows, branches] = await Promise.all([loadSpecialDays(), listBranches()]);
  // Kapalı günün şubesi yalnız birden çok kasa açıkken seçilir ve listede yazılır (docs/SUBE.md › Kapalı gün)
  const tills = tillBranches(branches);
  const many = tills.length > 1;
  // Saat okumalardan sonra (Cache Components)
  const today = businessDate();
  const item = (d: (typeof rows)[number]): SpecialDayItem => ({
    id: d.id,
    dateFrom: d.dateFrom,
    dateTo: d.dateTo,
    kind: d.kind,
    title: d.title,
    effect: d.effect,
    note: d.note ?? null,
    addedBy: d.addedBy ?? null,
    branchId: d.kind === "kapali" ? (d.branchId ?? null) : null,
    branchName: d.kind === "kapali" && many ? (d.branchId ? (branches.find((b) => b.id === d.branchId)?.name ?? d.branchId) : "Bütün şubeler") : null,
  });
  const upcoming = rows.filter((d) => d.dateTo >= today).map(item);
  const past = rows.filter((d) => d.dateTo < today).map(item);
  return (
    <SpecialDayProvider
      today={today}
      minDate={addDays(today, -SPECIAL_PAST_DAYS)}
      maxDate={addDays(today, SPECIAL_MAX_AHEAD_DAYS)}
      saveAction={saveSpecialDay}
      deleteAction={deleteSpecialDay}
      branches={many ? tills.map((b) => ({ id: b.id, name: b.name })) : undefined}
    >
      <SpecialDaysCard upcoming={upcoming} past={past} />
    </SpecialDayProvider>
  );
}

async function StaffContent() {
  const user = await requireUser();
  const [rows, closed] = await Promise.all([staffSpecialList(getDb(), user), ownClosedRequests(user)]);
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
