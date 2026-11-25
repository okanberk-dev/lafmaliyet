import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { businessDate } from "@/lib/cash-report";
import { checklistBoundaries } from "@/lib/checklists";
import { longDateTR, todayTR } from "@/lib/reminders";
import { todayShiftText, VARDIYA_PATH } from "@/lib/vardiya";
import { requireUser } from "@/server/auth/dal";
import { loadBranchDay } from "@/server/data/branch-day";
import { loadStockAlert } from "@/server/data/stock-estimate";
import { loadToday } from "@/server/data/today";
import { safe } from "@/server/data/today-safe";
import { todayShifts } from "@/server/vardiya/store";

import { DashboardPayments } from "../dashboard-payments";
import { StockAlertCard } from "../stock-alert-card";
import { cafeLines, dayTasks, daySummary, eveningHours, nextRefreshAt, type CafeLine } from "./logic";
import { soldOutLine } from "./rows-ops";
import { TodayBranches } from "./today-branches";
import { TodayCafe } from "./today-cafe";
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
          <PageHeader path="/panel/bugun" role="staff" title="Bugün" description="Yükleniyor…" />
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
  // Şubelerin günü yalnız yöneticide (tutar, ödeme, kasa farkı); okunamazsa kart çizilmez, sayfa açılır
  // Kıyas (dün / geçen hafta / geçen ay) da yalnız yöneticide, seçili şubeyle
  // Kritik stok (Marina, tahmini; docs/STOK-TAHMINI.md): iki rolde, yalnız Marina ya da "Tümü" seçiliyken okunur
  // Bugünün vardiyası (docs/VARDIYA.md): iki rolde, seçili şubenin planı; plan yoksa ya da okunamazsa satır yok
  const [data, branchDay, stockAlert, shifts] = await Promise.all([
    loadToday(user),
    user.role === "admin" ? safe(loadBranchDay()) : Promise.resolve(null),
    safe(loadStockAlert()),
    safe(todayShifts()),
  ]);
  const now = data.facts.now;
  const tasks = dayTasks(data.facts);
  const summary = daySummary(tasks, data.reminders?.length ?? 0);
  // Tükenen ürünler sonda (satış tahmini 4 Kasım 2026'da kaldırıldı)
  const soldOut = soldOutLine(data.facts);
  const shiftText = todayShiftText(shifts ?? []);
  const shiftLine: CafeLine | null = shiftText ? { key: "vardiya", text: shiftText, tone: "info", href: VARDIYA_PATH } : null;
  const cafe = cafeLines(data.cafe, now.getTime(), [shiftLine, soldOut].filter((l): l is CafeLine => l !== null));
  const changeAt = data.cafe.karaoke?.changeAt;
  return (
    <>
      {/* Gece 05:00'e kadar iş günü dündür (kasa, kontrol listeleri, işler ona bakar): başlık da o günü söyler */}
      <PageHeader path="/panel/bugun" role={user.role} title="Bugün" description={`${dayTitle(now)} · ${summary.headline}`} />
      {/* Saat sınırları: karaoke oturumu ve kontrol listelerinin açılış / son saati (satır 08:00'de "Yapılacak" olsun) */}
      <TodayRefresh at={nextRefreshAt(now, [...(changeAt ? [changeAt] : []), ...checklistBoundaries(data.facts.checklists)], eveningHours(data.facts))} renderedAt={data.renderedAt} />
      {/* Geniş ekranda solda Yapılacaklar, sağda kartlar (Kasa sayfasının düzeni); telefonda tek sütun, bu sırayla.
          Yöneticide sağ sütunun başında şubelerin günü (Design Lab: şube günlük ciro özeti) */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <TodayTasks tasks={tasks} admin={user.role === "admin"} />
        <div className="min-w-0 space-y-4">
          {branchDay ? <TodayBranches data={branchDay} /> : null}
          {stockAlert ? <StockAlertCard data={stockAlert} /> : null}
          <TodayReminders items={data.reminders} renderedAt={data.renderedAt} />
          {data.payments ? <DashboardPayments items={data.payments} /> : null}
          {cafe.length ? <TodayCafe lines={cafe} barHref={data.cafe.karaokeHere ? "/panel/karaoke" : "/panel/siparisler"} /> : null}
        </div>
      </div>
    </>
  );
}
