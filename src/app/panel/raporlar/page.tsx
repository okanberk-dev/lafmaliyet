import { Store } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker, MonthPickerSkeleton } from "@/components/panel/month-picker";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, InfoTip, PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { businessDate } from "@/lib/cash-report";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { shiftMonth } from "@/lib/reminders";
import { COMPARE_SPANS, spanParam, type CompareFormat, type ComparePeriod } from "@/lib/sube-karsilastirma";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { monthParam } from "@/server/data/dataset";
import { loadBranchCompare, type BranchCompareData } from "@/server/data/sube-karsilastirma";

import { ReportHeader } from "./header";

export const metadata: Metadata = { title: "Şube karşılaştırma" };

const PATH = "/panel/raporlar";
const TITLE = "Şube karşılaştırma";
const DESCRIPTION = "Şubeler ay ay yan yana: ciro, kasa farkı, ikram, zayi, işçilik, gider ve kâr.";
const MORE =
  "Her rakam başka bir ekranın rakamıdır: ciro, açık gün, mal maliyeti, personel, giderler ve kâr Gelir-gider'de o şube seçiliyken görünenler; ödenmez ve indirim ayın bilgisinden; zayi ve ikramın malzeme maliyeti Zayi & ikram'ın ay özetinden; kasa farkı kasa raporlarından; fiş sayısı ve ortalama sepet Kıyas'ın kuralıyla. Soldaki şube seçiminden bağımsızdır. İşletme geneli giderler (şubesi seçilmemiş) hiçbir şubeye bölünmez; işletmenin toplamı Gelir-gider'de Tümü seçiliyken.";

/** Ay seçicide gösterilen aylar: bu aydan geriye iki yıl */
const PICKER_MONTHS = 24;

export default function BranchComparePage({ searchParams }: PageProps<"/panel/raporlar">) {
  return (
    <Suspense
      fallback={
        <>
          <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={<MonthPickerSkeleton />} />
          <PageSkeleton rows={14} />
        </>
      }
    >
      <BranchCompareContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BranchCompareContent({ searchParams }: { searchParams: PageProps<"/panel/raporlar">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const current = businessDate().slice(0, 7);
  const asked = monthParam(sp.ay);
  const last = asked && asked <= current ? asked : current;
  const span = spanParam(sp.sure);
  const data = await loadBranchCompare(last, span);
  const months = Array.from({ length: PICKER_MONTHS }, (_, i) => shiftMonth(current, i - PICKER_MONTHS + 1));
  const actions = (
    <>
      <SegmentedLinks
        label="Dönem"
        value={String(span)}
        options={COMPARE_SPANS.map((n) => ({ value: String(n), label: n === 1 ? "1 ay" : `${n} ay`, href: `${PATH}?ay=${last}&sure=${n}` }))}
      />
      <MonthPicker months={months} value={last} />
    </>
  );
  if (!data) {
    return (
      <>
        <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={actions} />
        <EmptyState icon={<Store />} title="Açık şube yok" description="Ayarlar › Şubeler'de açık bir fiziksel şube olmalı." />
      </>
    );
  }
  return (
    <>
      <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={actions} />
      {data.branches.length < 2 ? (
        <Notice tone="neutral" size="sm" className="mb-4" title="Tek şube açık">
          Karşılaştırma birden çok şube açıkken anlamlıdır; tek şubenin ayları yine aşağıda.
        </Notice>
      ) : null}
      {data.months.includes(data.current) ? (
        <p className="-mt-2 mb-4 text-xs text-pretty text-ink-mute" role="note">
          {monthLabel(data.current)} sürüyor: rakamları bugüne kadar (giderler ve personel ayın geçen günleriyle, Gelir-gider gibi).
        </p>
      ) : null}
      <div className="space-y-6">
        {data.periods.map((p) => (
          <PeriodCard key={p.key} period={p} data={data} />
        ))}
      </div>
      <p className="mt-4 text-xs text-pretty text-ink-mute">
        <span className="font-semibold text-good" aria-hidden>
          ●
        </span>{" "}
        Satırda en iyi şube (ciroda ve kârda en yüksek, giderde ve oranda en düşük, kasa farkında sıfıra en yakın). — bilinmiyor: veri girilmemiş, sıfır
        sayılmaz.
      </p>
    </>
  );
}

function periodTitle(p: ComparePeriod, data: BranchCompareData): string {
  if (p.key !== "toplam") return `${monthLabel(p.key)}${p.key === data.current ? " (bugüne kadar)" : ""}`;
  return `${monthLabel(data.months[0])} – ${monthLabel(data.months[data.months.length - 1])} toplamı`;
}

function fmt(v: number | null, f: CompareFormat): string {
  if (v === null) return "—";
  return f === "tl" ? tl(v) : f === "pct" ? pct(v) : num(v);
}

function PeriodCard({ period, data }: { period: ComparePeriod; data: BranchCompareData }) {
  const total = period.key === "toplam";
  return (
    <Card>
      <CardHeader
        icon={<Store />}
        title={periodTitle(period, data)}
        description={total ? `${data.months.length} ayın toplamı; oranlar toplamların oranı (ayların ortalaması değil).` : undefined}
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH sticky>
                <span className="sr-only">Satır</span>
              </TH>
              {data.branches.map((b) => (
                <TH key={b.id} numeric>
                  {b.name}
                </TH>
              ))}
            </tr>
          </THead>
          <tbody>
            {period.rows.map((r) => {
              const strong = r.def.key === "kar" || r.def.key === "ciro";
              return (
                <TR key={r.def.key}>
                  <TD sticky className={cn("whitespace-nowrap", strong && "font-semibold")}>
                    {r.def.label} <InfoTip text={r.def.hint} />
                  </TD>
                  {r.cells.map((c, i) => (
                    <TD
                      key={data.branches[i].id}
                      numeric
                      className={cn(strong && "font-semibold", c.value === null && "text-ink-mute", (r.def.key === "kar" || r.def.key === "kasa-farki") && c.value !== null && c.value < 0 && "text-bad")}
                      title={c.value === null ? "Bilinmiyor: veri girilmemiş" : undefined}
                    >
                      {c.best ? (
                        <span className="mr-1 text-good" aria-label="en iyi">
                          ●
                        </span>
                      ) : null}
                      {fmt(c.value, r.def.format)}
                    </TD>
                  ))}
                </TR>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}
