import { CalendarClock, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { HashScroll } from "@/components/panel/hash-scroll";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { type NoticeItem, NoticeLink } from "@/components/ui/notice";
import { overdueTaxNotice } from "@/lib/tax/overdue";
import { taxPayrollFromModel } from "@/lib/tax/payroll";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadTaxView } from "@/server/data/tax";

import { filingKindData, payrollSheetMonths } from "./dialog-data";
import { PeriodPicker } from "./period-picker";
import { CALENDAR_RULES, GECICI_RULES, KV_RULES, ruleRefs } from "./refs";
import { GettingStartedCard, ProfitTaxCard } from "./tax-cards";
import { TaxCalendarCard } from "./tax-calendar";
import { type BannerData, NoteNotice, OZET_DESCRIPTION, TaxBanner, VergiHeader } from "./ui";

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
 * Vergi, KDV, SGK › Özet (plan docs/planlar/vergi.md §4.1; docs/planlar/ux-sade.md §7.1; docs/VERGI.md): ilk ekranda
 * iki rakam (sıradaki ödeme, önümüzdeki 30 gün) ve takvim; bandın altında Ödemeler'de günü geçmiş vergi ödemesi,
 * Başlarken tek satır, şirketin kâr vergisi tek kart. Yalnız yönetici; vergi girdileri, nakit planı ve Ödemeler bir
 * kez okunur (loadTaxView, K30).
 */
async function TaxContent({ searchParams }: { searchParams: PageProps<"/panel/vergi">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const rawYear = pick(sp.yil);
  const model = await loadModel();
  const { view, inputs, reminders } = await loadTaxView(model, { year: rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null });
  const { settings } = inputs;
  const year = view.year;
  // Ödemeler'de günü geçmiş vergi / SGK hatırlatıcısı (K12, §7.2): kırmızı ve "Ödedim" Ödemeler'de kalır
  const overdue = view.hasData ? overdueTaxNotice(reminders, view.today, view.calendar) : null;
  const notices: NoticeItem[] = overdue
    ? [
        {
          key: "gecikmis-vergi",
          tone: "warn",
          size: "sm",
          risk: "para",
          title: overdue.title,
          text: overdue.text,
          action: <NoticeLink href="/panel/hatirlaticilar">Ödemeler&apos;de aç</NoticeLink>,
          children: overdue.details.length
            ? overdue.details.map((d) => (
                <p key={d} className="break-words">
                  {d}
                </p>
              ))
            : undefined,
        },
      ]
    : [];
  const banner: BannerData = {
    compiled: view.rulesInfo.compiled,
    stale: view.rulesInfo.stale,
    scope: { text: view.scope.text, hint: view.scope.hint },
    checks: { chip: view.checks.chip, allDone: view.checks.allDone },
    notices,
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
        {/* İki rakam her genişlikte yan yana; Başlarken'in ilerlemesi kendi satırında (§7.1, §9 #1) */}
        <div className="grid grid-cols-2 gap-2">
          <Stat compact icon={<CalendarClock />} label={s.next.label} value={s.next.value} sub={s.next.sub} />
          <Stat compact icon={<Hourglass />} label={s.next30.label} value={s.next30.value} sub={s.next30.sub} />
        </div>

        <GettingStartedCard data={view.gettingStarted} />

        {/* K4 ve §3.3: muhasebecinin rakamı ile Ödemeler'deki tutar farklı; faturası iptal edilen varlık (çift sayım).
            Tutarı bozar: hiç katlanmaz; ilk uyarı başlık, kalanı Ayrıntı */}
        <NoteNotice notes={view.warnings} action={view.orphans.length ? <NoticeLink href="/panel/vergi/demirbas">Demirbaş&apos;ı aç</NoticeLink> : undefined} />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <TaxCalendarCard view={view} extras={{ rules, filings, payroll }} />
          </div>
          {/* ⌘K "Kâr vergisi (geçici, kurumlar)" kartın kendisine iner (#kar-vergisi, docs/planlar/ux-sade.md §3.7) */}
          <div className="min-w-0">
            <ProfitTaxCard
              gecici={view.geciciCard}
              kv={view.kvCard}
              scope={view.scope.key}
              filings={{ gecici: filings.gecici, kv: filings.kv }}
              rules={{
                gecici: view.geciciCard ? ruleRefs(GECICI_RULES, Number(view.geciciCard.key.slice(0, 4)), settings.overrides) : [],
                kv: ruleRefs(KV_RULES, year, settings.overrides),
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
