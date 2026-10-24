import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { businessDate } from "@/lib/cash-report";
import { checklistBoundaries } from "@/lib/checklists";
import { longDateTR, todayTR } from "@/lib/reminders";
import { requireUser } from "@/server/auth/dal";
import { loadToday } from "@/server/data/today";

import { DashboardPayments } from "../dashboard-payments";
import { cafeLines, dayTasks, daySummary, nextRefreshAt } from "./logic";
import { TodayCafe } from "./today-cafe";
import { TodayForecast } from "./today-forecast";
import { TodayRefresh } from "./today-refresh";
import { TodayReminders } from "./today-reminders";
import { TodayTasks } from "./today-tasks";

export const metadata: Metadata = { title: "Bugün" };

/**
 * Bugün: günün işleri ve durumu tek ekranda (docs/BUGUN.md). İki rol de açar; yöneticiye ait olgular personel için hiç
 * yüklenmez (src/server/data/today.ts). Yeni yazma eylemi yok: hatırlatıcıyı tamamlamak ve ödemeyi "Ödendi" yapmak var
 * olan eylemlerle. Personel girişte burada açılır (src/lib/roles.ts STAFF_HOME).
 */
export default function TodayPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Günlük" title="Bugün" description="Yükleniyor…" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <TodayContent />
    </Suspense>
  );
}

/** "23 Ekim Cuma"; gece yarısından 05:00'e kadar iş gününün adıyla: "23 Ekim Cuma gecesi" */
function dayTitle(now: Date): string {
  const day = businessDate(now);
  return day === todayTR(now) ? longDateTR(day) : `${longDateTR(day)} gecesi`;
}

async function TodayContent() {
  const user = await requireUser();
  const data = await loadToday(user);
  const now = data.facts.now;
  const tasks = dayTasks(data.facts);
  const summary = daySummary(tasks, data.reminders?.length ?? 0);
  // Personelde satış tahmininin yoğunluk ve tatlı satırları başta (yöneticinin kendi kartı var)
  const cafe = cafeLines(data.cafe, now.getTime(), data.forecast.staff);
  const changeAt = data.cafe.karaoke?.changeAt;
  return (
    <>
      {/* Gece 05:00'e kadar iş günü dündür (kasa, kontrol listeleri, işler ona bakar): başlık da o günü söyler */}
      <PageHeader eyebrow="Günlük" title="Bugün" description={`${dayTitle(now)} · ${summary.headline}`} />
      {/* Saat sınırları: karaoke oturumu ve kontrol listelerinin açılış / son saati (satır 08:00'de "Yapılacak" olsun) */}
      <TodayRefresh at={nextRefreshAt(now, [...(changeAt ? [changeAt] : []), ...checklistBoundaries(data.facts.checklists)])} renderedAt={data.renderedAt} />
      {/* Geniş ekranda solda Yapılacaklar, sağda kartlar (Kasa sayfasının düzeni); telefonda tek sütun, bu sırayla */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <TodayTasks tasks={tasks} admin={user.role === "admin"} />
        <div className="min-w-0 space-y-4">
          <TodayReminders items={data.reminders} renderedAt={data.renderedAt} />
          {data.payments ? <DashboardPayments items={data.payments} /> : null}
          {data.forecast.admin ? <TodayForecast data={data.forecast.admin} /> : null}
          {cafe.length ? <TodayCafe lines={cafe} /> : null}
        </div>
      </div>
    </>
  );
}
