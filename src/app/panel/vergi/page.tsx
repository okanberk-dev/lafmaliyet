import { CalendarClock, ClipboardList, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { HashScroll } from "@/components/panel/hash-scroll";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { taxPayrollFromModel } from "@/lib/tax/payroll";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadTaxView } from "@/server/data/tax";

import { filingKindData, payrollSheetMonths } from "./dialog-data";
import { PeriodPicker } from "./period-picker";
import { CALENDAR_RULES, GECICI_RULES, KV_RULES, ruleRefs } from "./refs";
import { GeciciCardView, GettingStartedCard, KvCardView } from "./tax-cards";
import { TaxCalendarCard } from "./tax-calendar";
import { type BannerData, DisclaimerBody, NoteList, OZET_DESCRIPTION, TaxBanner, VergiHeader } from "./ui";

export const metadata: Metadata = { title: "Vergi, KDV, SGK" };

export default function TaxPage({ searchParams }: PageProps<"/panel/vergi">) {
  return (
    <Suspense
      fallback={
        <>
          <VergiHeader current="/panel/vergi" title="Vergi, KDV, SGK" description={OZET_DESCRIPTION} />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <TaxContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Vergi › Özet (plan docs/planlar/vergi.md §4.1; docs/VERGI.md): üç rakam, Başlarken, önümüzdeki 100 günün vergi
 * takvimi, kafenin geçici vergi ve kurumlar vergisine katkısı. Yalnız yönetici; vergi girdileri, nakit planı ve
 * Ödemeler bir kez okunur (loadTaxView, K30).
 */
async function TaxContent({ searchParams }: { searchParams: PageProps<"/panel/vergi">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const rawYear = pick(sp.yil);
  const model = await loadModel();
  const { view, inputs, reminders } = await loadTaxView(model, { year: rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null });
  const { settings } = inputs;
  const year = view.year;
  const banner: BannerData = {
    compiled: view.rulesInfo.compiled,
    stale: view.rulesInfo.stale,
    scope: { text: view.scope.text, hint: view.scope.hint },
    checks: { chip: view.checks.chip, allDone: view.checks.allDone },
  };
  const yearPicker =
    view.yearOptions.length >= 2 ? (
      <PeriodPicker param="yil" label="Yıl" value={String(year)} options={view.yearOptions.map((y) => ({ value: String(y), label: String(y) }))} />
    ) : null;

  if (!view.hasData) {
    return (
      <>
        <VergiHeader current="/panel/vergi" title="Vergi, KDV, SGK" description={OZET_DESCRIPTION} actions={yearPicker} />
        <TaxBanner data={banner} />
        <Card className="items-start gap-4 p-5">
          <p className="text-sm text-ink-soft">Hesap için veri yok. Satışlar&apos;a ayın cirosunu, Faturalar&apos;a alışları girin.</p>
          <ButtonLink href="/panel/satislar" size="sm">
            Satışlara git
          </ButtonLink>
        </Card>
      </>
    );
  }

  const ctx = { today: view.today, settings, filings: inputs.filings, reminders, muhtasar: view.muhtasar };
  const filings = { mphb: filingKindData("mphb", ctx), gecici: filingKindData("gecici", ctx), kv: filingKindData("kv", ctx) };
  // Bordro dökümü: takvimdeki muhtasar aylarının bordrosu (geçen ve bu yıl)
  const ty = Number(view.today.slice(0, 4));
  const payroll = payrollSheetMonths([...taxPayrollFromModel(model, ty - 1, settings).values(), ...taxPayrollFromModel(model, ty, settings).values()]);
  const rules = Object.fromEntries(Object.entries(CALENDAR_RULES).map(([kind, keys]) => [kind, ruleRefs(keys, ty, settings.overrides)]));
  const s = view.stats;

  return (
    <>
      <VergiHeader current="/panel/vergi" title="Vergi, KDV, SGK" description={OZET_DESCRIPTION} actions={yearPicker} />
      {/* ⌘K "KDV", "SGK primi", "Maaş vergileri", "Kâr vergisi" (#kdv, #sgk, #muhtasar, #kar-vergisi) içerik akınca iner */}
      <HashScroll key={`capa-${year}`} />
      <TaxBanner data={banner} />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <Stat compact icon={<CalendarClock />} label={s.next.label} value={s.next.value} sub={s.next.sub} />
          <Stat compact icon={<Hourglass />} label={s.next30.label} value={s.next30.value} sub={s.next30.sub} />
          <a
            href="#baslarken"
            className="col-span-2 block rounded-2xl outline-none hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-ink/30 lg:col-span-1"
            aria-label={`${s.readiness.label} ${s.readiness.value}: Başlarken`}
          >
            <Stat compact icon={<ClipboardList />} label={s.readiness.label} value={s.readiness.value} sub="Başlarken adımları" className="h-full" />
          </a>
        </div>

        <GettingStartedCard data={view.gettingStarted} />

        {view.warnings.length ? (
          // K4 ve §3.3: muhasebecinin rakamı ile Ödemeler'deki tutar farklı; faturası iptal edilen varlık (çift sayım)
          <div role="note" aria-label="Vergi uyarıları" className="space-y-2.5 rounded-2xl bg-panel px-4 py-3">
            <NoteList notes={view.warnings} tone="warn" />
            {view.orphans.length ? (
              <ButtonLink href="/panel/vergi/demirbas" size="sm">
                Demirbaş&apos;ı aç
              </ButtonLink>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <TaxCalendarCard view={view} extras={{ rules, filings, payroll }} />
          </div>
          {/* ⌘K "Kâr vergisi (geçici, kurumlar)" buraya iner (docs/planlar/ux-sade.md §3.7) */}
          <div id="kar-vergisi" className="min-w-0 scroll-mt-20 space-y-6">
            {view.geciciCard ? <GeciciCardView card={view.geciciCard} filing={filings.gecici} rules={ruleRefs(GECICI_RULES, Number(view.geciciCard.key.slice(0, 4)), settings.overrides)} /> : null}
            <KvCardView card={view.kvCard} filing={filings.kv} rules={ruleRefs(KV_RULES, year, settings.overrides)} />
          </div>
        </div>
        <DisclaimerBody data={banner} />
      </div>
    </>
  );
}
