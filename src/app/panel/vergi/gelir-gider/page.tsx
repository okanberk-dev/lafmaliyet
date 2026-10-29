import { Calculator, FileSpreadsheet, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { HashScroll } from "@/components/panel/hash-scroll";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { money, monthLabel } from "@/lib/format";
import { monthName, quarterLabel } from "@/lib/tax/calendar";
import { filingFor, filingValue } from "@/lib/tax/corporate";
import { ADJUSTMENT_LABELS, adjustmentPeriodLabel } from "@/lib/tax/pnl";
import { PAYROLL_FULL_MONTH_NOTE } from "@/lib/tax/payroll";
import { requireAdmin } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadTaxView } from "@/server/data/tax";

import { AdjustmentButton } from "../adjustment-dialog";
import { filingKindData, invoiceChoices } from "../dialog-data";
import { FilingButton } from "../filing-dialog";
import { PeriodPicker } from "../period-picker";
import { type BannerData, NoteList, TaxBanner, VergiHeader } from "../ui";
import { BridgeCard } from "./bridge-card";
import { ClassifyList } from "./classify-list";
import { adjustmentChoices, adjustmentRows, classifyData } from "./data";
import { quarterGrid } from "./grid";
import { QuarterPhone } from "./quarter-phone";
import { QuarterTable } from "./quarter-table";

export const metadata: Metadata = { title: "Vergi kârı" };

const TITLE = "Vergi kârı";
const DESCRIPTION =
  "Seçilen çeyreğin ayları, çeyrek toplamı ve yılbaşından kümülatif: vergi esasında, KDV hariç, belgeye dayanan satırlar. Gelir mali belgeden (KDV beyannamesi, yazarkasa Z'si) gelir; girilmeyen ayda yönetim verisi kullanılır ve hesap taslaktır.";

export default function TaxPnlPage({ searchParams }: PageProps<"/panel/vergi/gelir-gider">) {
  return (
    <Suspense
      fallback={
        <>
          <VergiHeader current="/panel/vergi/gelir-gider" title={TITLE} description={DESCRIPTION} />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <TaxPnlContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Vergi, KDV, SGK › Vergi kârı (plan docs/planlar/vergi.md §4.2; eski adı "Vergiye göre"): çeyreğin tablosu, köprü, KDV beyannamesi satışları,
 * sınıflandırma listesi ve düzeltmeler. Nakit planını okumaz (K30): model ve vergi girdileri yeter.
 */
async function TaxPnlContent({ searchParams }: { searchParams: PageProps<"/panel/vergi/gelir-gider">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const rawYear = pick(sp.yil);
  const rawQuarter = pick(sp.ceyrek);
  const model = await loadModel();
  const { view, inputs } = await loadTaxView(model, {
    year: rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : rawQuarter && /^\d{4}-Q[1-4]$/.test(rawQuarter) ? Number(rawQuarter.slice(0, 4)) : null,
    quarter: rawQuarter ?? null,
    cashPlan: null,
  });
  const { settings } = inputs;
  const q = view.quarter;
  const banner: BannerData = {
    compiled: view.rulesInfo.compiled,
    stale: view.rulesInfo.stale,
    scope: { text: view.scope.text, hint: view.scope.hint },
    checks: { chip: view.checks.chip, allDone: view.checks.allDone },
  };
  const actions = (
    <>
      {view.yearOptions.length >= 2 ? (
        <PeriodPicker param="yil" label="Yıl" omit={["ceyrek"]} value={String(view.year)} options={view.yearOptions.map((y) => ({ value: String(y), label: String(y) }))} />
      ) : null}
      {q ? <PeriodPicker param="ceyrek" label="Çeyrek" value={q.key} options={q.options.map((k) => ({ value: k, label: quarterLabel(k) }))} /> : null}
    </>
  );

  if (!q) {
    return (
      <>
        <VergiHeader current="/panel/vergi/gelir-gider" title={TITLE} description={DESCRIPTION} actions={actions} />
        <TaxBanner data={banner} />
        <Card>
          <EmptyState icon={<Calculator />} title="Bu yıl hesap döneminde değil" description="Hesap dönemi başlangıcını Muhasebeci › Vergi ayarları'ndan değiştirebilirsiniz." />
        </Card>
      </>
    );
  }

  const grid = quarterGrid(q, view.months);
  const warnBad = q.warnings.filter((w) => /sayımı yok/.test(w));
  const warnInfo = q.warnings.filter((w) => w === (PAYROLL_FULL_MONTH_NOTE as string));
  const warnOther = q.warnings.filter((w) => !warnBad.includes(w) && !warnInfo.includes(w));
  const kdvMatrah = filingKindData("kdv_matrah", { today: view.today, settings, filings: inputs.filings, reminders: null });
  // Başlarken'in "Muhasebecinin rakamları" adımı geçici vergiyi de ister: çeyreğin penceresi burada da (§4.1-2)
  const gecici = filingKindData("gecici", { today: view.today, settings, filings: inputs.filings, reminders: null });
  const geciciFiling = filingFor(inputs.filings, "gecici", q.key);
  const choices = invoiceChoices(model.ds.invoices, inputs.assets, view.today);
  const classify = classifyData(view, { invoices: model.ds.invoices, settings, choices, today: view.today });
  const adjChoices = adjustmentChoices(view.today, settings, inputs.filings);
  const adjRows = adjustmentRows(inputs.adjustments, view.year);
  const rangeText = `${monthName(q.totals.months[0] ?? q.key)}–${monthName(q.totals.months.at(-1) ?? q.key)}`;

  return (
    <>
      <VergiHeader current="/panel/vergi/gelir-gider" title={TITLE} description={DESCRIPTION} actions={actions} />
      {/* ⌘K "Eksik belgeler" (#siniflandir) ve Özet'in bağlantıları içerik akınca iner */}
      <HashScroll key={`capa-${q.key}`} />
      <TaxBanner data={banner} />
      <div className="space-y-6">
        <Card>
          <CardHeader
            icon={<Calculator />}
            title={`${q.label} · ${q.totals.months.length > 1 ? rangeText : monthName(q.totals.months[0] ?? "")}`}
            description={q.totals.complete ? "Çeyrek bitti" : "Dönem sürüyor: bugüne kadarki veriyle (süren ay tamamlanmaz)"}
            actions={q.totals.state === "taslak" ? <Badge tone="amber">Taslak</Badge> : <Badge tone="green">Hazır</Badge>}
          />
          <div className="space-y-2 px-5 pb-4">
            {q.totals.state === "taslak" ? <p className="text-[13px] leading-5 text-ink-mute">Taslak: {q.totals.stateReasons.join(" · ")}.</p> : null}
            {gecici.options.some((o) => o.period === q.key) ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <FilingButton data={gecici} period={q.key} label={geciciFiling ? `${q.label} geçici vergi kaydını düzelt` : `${q.label} geçici vergi rakamını gir`} />
                {geciciFiling ? <span className="text-xs text-ink-mute">Muhasebeci: {money(geciciFiling.payable)}</span> : null}
              </div>
            ) : null}
            <NoteList notes={warnBad} tone="bad" />
            <NoteList notes={warnOther} tone="warn" />
            <NoteList notes={warnInfo} />
          </div>
          <QuarterTable grid={grid} />
          <QuarterPhone key={q.key} grid={grid} />
          <div className="h-5" />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <BridgeCard quarter={q} />
          <Card id="kdv-beyannamesi" className="scroll-mt-20">
            <CardHeader
              icon={<FileSpreadsheet />}
              title="KDV beyannamesi satışları"
              description="Muhasebecinizin aylık KDV beyannamesindeki satış matrahları (oran oran, KDV hariç). Girilen ayın geliri mali belgeden gelir; KDV ödemesi hesaplamaz."
            />
            <CardContent>
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {q.months.map((m) => {
                  const f = filingFor(inputs.filings, "kdv_matrah", m.month);
                  const total = f ? ["m1", "m10", "m20", "istisna"].reduce((a, k) => a + (filingValue(f, k) ?? 0), 0) : null;
                  const inOptions = kdvMatrah.options.some((o) => o.period === m.month);
                  return (
                    <li key={m.month} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm leading-5 font-medium text-ink">{monthLabel(m.month)}</p>
                        <p className="text-xs leading-4 text-ink-mute">
                          {f && total !== null ? `Girildi: ${money(total)}${filingValue(f, "kafeDisi") ? ` · kafe dışı ${money(filingValue(f, "kafeDisi")!)}` : ""}` : m.inProgress ? "Ay bitmedi" : "Girilmedi: gelir yönetim verisinden"}
                        </p>
                      </div>
                      {inOptions ? <FilingButton data={kdvMatrah} period={m.month} label={f ? "Düzelt" : "Beyanname matrahını gir"} /> : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>

        <ClassifyList data={classify} />

        <Card>
          <CardHeader
            icon={<SlidersHorizontal />}
            title="Düzeltmeler"
            description="Panelin görmediği gelir ve gider: şirketin kafe dışı işleri, faiz, belgeli ama panelde olmayan giderler, indirilemeyen giderler, indirimler (KDV hariç)."
            actions={<AdjustmentButton choices={adjChoices} />}
          />
          <CardContent>
            {adjRows.length ? (
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {adjRows.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm leading-5 break-words text-ink">{a.label}</p>
                      <p className="text-xs leading-4 break-words text-ink-mute">
                        {adjustmentPeriodLabel(a)} · {ADJUSTMENT_LABELS[a.kind]}
                        {a.note ? ` · ${a.note}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm text-ink tabular">{money(a.amount)}</span>
                      <AdjustmentButton choices={adjChoices} row={a} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-5 text-center text-sm text-ink-mute ring-1 ring-line">{view.year} için düzeltme yok.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
