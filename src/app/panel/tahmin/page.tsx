import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { qualityBanner, qualityTitle } from "@/lib/forecast/text";
import { addDays } from "@/lib/reminders";
import { deleteSpecialDay, saveSpecialDay } from "@/server/actions/forecast";
import { requireAdmin } from "@/server/auth/dal";
import { loadForecastPage, SPECIAL_MAX_AHEAD_DAYS, SPECIAL_PAST_DAYS, specialList } from "@/server/forecast/load";

import { ForecastAccuracy } from "./forecast-accuracy";
import { ForecastActions } from "./forecast-actions";
import { ForecastCalendar } from "./forecast-calendar";
import { ForecastDays } from "./forecast-days";
import { ForecastDesserts } from "./forecast-desserts";
import { ForecastSettingsCard } from "./forecast-settings";
import { SpecialDayProvider, SpecialDaysCard } from "./special-days";

export const metadata: Metadata = { title: "Satış tahmini" };

const DESCRIPTION =
  "Önümüzdeki 7 günde beklenen satış (Z toplamı), kaç kişinin çalışması ve kaç tatlı hazırlanması gerektiği. Kasa raporları, takvim (bayram, resmî tatil, Ramazan, okul tatili), hava durumu ve girdiğiniz özel günlerden hesaplanır.";

function Header({ description = DESCRIPTION, actions }: { description?: string; actions?: ReactNode }) {
  return <PageHeader path="/panel/tahmin" title="Satış tahmini" description={description} actions={actions} />;
}

/** Kafe › Satış tahmini (docs/SATIS-TAHMINI.md); yalnız yönetici, proxy personeli buraya sokmaz */
export default function ForecastPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header description="Yükleniyor…" />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <ForecastContent />
    </Suspense>
  );
}

async function ForecastContent() {
  await requireAdmin();
  const data = await loadForecastPage();
  const f = data.forecast;
  const banner = qualityBanner(f);
  const bannerTitle = qualityTitle(f);
  const { upcoming, past } = specialList(data);
  const specialCard = <SpecialDaysCard upcoming={upcoming} past={past} />;
  const settingsCard = <ForecastSettingsCard settings={data.settings} categories={data.categories} />;
  return (
    <SpecialDayProvider
      today={data.today}
      minDate={addDays(data.today, -SPECIAL_PAST_DAYS)}
      maxDate={addDays(data.today, SPECIAL_MAX_AHEAD_DAYS)}
      saveAction={saveSpecialDay}
      deleteAction={deleteSpecialDay}
    >
      <Header actions={<ForecastActions />} />
      {banner ? (
        // Kısa sonuç başlıkta, uzun açıklama Ayrıntı'da (docs/planlar/ux-sade.md U9)
        <Notice tone="neutral" live="polite" className="mb-4" title={bannerTitle ?? banner}>
          {bannerTitle ? banner : null}
        </Notice>
      ) : null}
      {f.quality === "yok" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
          <Card>
            <EmptyState
              icon={<CalendarClock />}
              title="Tahmin için veri yok"
              description="Kasa raporu girildikçe ya da Satışlar'da bir ayın cirosu ve açık gün sayısı yazılınca önümüzdeki 7 günün tahmini burada görünür."
              action={
                <ButtonLink href="/panel/kasa" variant="secondary">
                  Kasa raporu
                </ButtonLink>
              }
            />
          </Card>
          <div className="min-w-0 space-y-4">
            {specialCard}
            {settingsCard}
          </div>
        </div>
      ) : (
        // Geniş ekranda solda günler ve tatlı, sağda tutturma, özel günler, takvim ve ayarlar; telefonda bu sırayla tek sütun
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
          <div className="min-w-0 space-y-4">
            <ForecastDays data={data} />
            <ForecastDesserts data={data} />
          </div>
          <div className="min-w-0 space-y-4">
            <ForecastAccuracy acc={data.accuracy} />
            {specialCard}
            <ForecastCalendar data={data} />
            {settingsCard}
          </div>
        </div>
      )}
    </SpecialDayProvider>
  );
}
