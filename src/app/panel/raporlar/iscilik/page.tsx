import { Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CompanyWideNotice } from "@/components/panel/company-wide-notice";
import { MonthPicker, MonthPickerSkeleton } from "@/components/panel/month-picker";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { ALL_BRANCHES } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { monthLabel, pct, tl } from "@/lib/format";
import { dayLabel, LABOR_METHOD, weekLabel, type LaborRow } from "@/lib/iscilik";
import { shiftMonth } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { monthParam } from "@/server/data/dataset";
import { loadLaborReport, type LaborBranchReport, type LaborReport } from "@/server/data/iscilik";

import { ReportHeader } from "../header";

export const metadata: Metadata = { title: "İşçilik / ciro" };

const PATH = "/panel/raporlar/iscilik";
const TITLE = "İşçilik / ciro";
const DESCRIPTION = "Personel maliyetinin ciroya oranı: günlük, haftalık ve şube şube.";
const MORE =
  "Ayın satırı Gelir-gider'in personeli ve cirosudur (KDV hariç). Günlük ve haftalık satırlarda tam zamanlının aylık işveren maliyeti ayın günlerine eşit bölünür (kapalı günde de maaş işler), part-time'ın günlük ücreti Vardiya'da çalıştığı güne yazılır. Giderlerdeki maaş ödemeleri kullanılmaz: ödeme günü çalışılan gün değildir. Cirosu bilinmeyen gün (kasa raporu, LafPOS gün sonu ya da föy yok) orana girmez, sıfır sayılmaz.";

const PICKER_MONTHS = 24;

type View = "hafta" | "gun";

export default function LaborPage({ searchParams }: PageProps<"/panel/raporlar/iscilik">) {
  return (
    <Suspense
      fallback={
        <>
          <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={<MonthPickerSkeleton />} />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <LaborContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LaborContent({ searchParams }: { searchParams: PageProps<"/panel/raporlar/iscilik">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const current = businessDate().slice(0, 7);
  const asked = monthParam(sp.ay);
  const month = asked && asked <= current ? asked : current;
  const view: View = (Array.isArray(sp.gorunum) ? sp.gorunum[0] : sp.gorunum) === "gun" ? "gun" : "hafta";
  const data = await loadLaborReport(month);
  const months = Array.from({ length: PICKER_MONTHS }, (_, i) => shiftMonth(current, i - PICKER_MONTHS + 1));
  const actions = (
    <>
      <SegmentedLinks
        label="Görünüm"
        value={view}
        options={[
          { value: "hafta", label: "Haftalık", href: `${PATH}?ay=${month}` },
          { value: "gun", label: "Günlük", href: `${PATH}?ay=${month}&gorunum=gun` },
        ]}
      />
      <MonthPicker months={months} value={month} />
    </>
  );
  if (!data) {
    return (
      <>
        <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={actions} />
        <EmptyState icon={<Users />} title="Açık şube yok" description="Ayarlar › Şubeler'de açık bir fiziksel şube olmalı." />
      </>
    );
  }
  const list = data.total ? [...data.branches, data.total] : data.branches;
  return (
    <>
      <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={actions} />
      <p className="-mt-2 mb-4 text-xs text-pretty text-ink-mute" role="note">
        Yöntem: {LABOR_METHOD}
      </p>
      <CompanyWideNotice screen="raporlar" className="mb-4" />
      {data.missing.length ? (
        <Notice
          tone="warn"
          size="sm"
          risk="para"
          className="mb-4"
          title={`${data.missing.length} kişinin ücreti hesaba girmedi`}
          action={<NoticeLink href="/panel/personel">Maaşlar</NoticeLink>}
        >
          {data.missing.map((m) => `${m.name} (${m.branch}): ${m.reason === "ucret-yok" ? "ücret yok" : "vardiya bağlantısı yok, çalıştığı gün bilinmiyor"}`).join(" · ")}. Uydurulmadı: işçilik
          olduğundan az görünür.
        </Notice>
      ) : null}
      <MonthSummary data={data} list={list} running={month === current} />
      <div className="mt-6 space-y-6">
        {list.map((b) => (
          <BranchCard key={b.id} branch={b} view={view} data={data} />
        ))}
      </div>
    </>
  );
}

const ratioText = (v: number | null) => (v === null ? "—" : pct(v));

function MonthSummary({ data, list, running }: { data: LaborReport; list: LaborBranchReport[]; running: boolean }) {
  return (
    <Card>
      <CardHeader
        icon={<Users />}
        title={`${monthLabel(data.month)}${running ? " (bugüne kadar)" : ""}`}
        description="Gelir-gider'in ayı: personel giderleri (işveren maliyeti) ÷ ciro (KDV hariç)."
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH sticky>Şube</TH>
              <TH numeric>Ciro (KDV hariç)</TH>
              <TH numeric>İşçilik</TH>
              <TH numeric>İşçilik / ciro</TH>
            </tr>
          </THead>
          <tbody>
            {list.map((b) => (
              <TR key={b.id}>
                <TD sticky className={cn(b.id === ALL_BRANCHES && "font-semibold")}>
                  {b.name}
                </TD>
                <TD numeric className={b.month.revenue === null ? "text-ink-mute" : undefined}>
                  {b.month.revenue === null ? "ciro yok" : tl(b.month.revenue)}
                </TD>
                <TD numeric>{tl(b.month.labor)}</TD>
                <TD numeric className="font-semibold">
                  {ratioText(b.month.ratio)}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function rowNote(r: LaborRow): string | null {
  const parts: string[] = [];
  if (r.unknownDays) parts.push(r.from === r.to ? "veri yok" : `${r.unknownDays} gün veri yok`);
  if (r.closedDays) parts.push(r.from === r.to ? "satış yok" : `${r.closedDays} gün satış yok`);
  return parts.length ? parts.join(" · ") : null;
}

function BranchCard({ branch, view, data }: { branch: LaborBranchReport; view: View; data: LaborReport }) {
  const rows = view === "gun" ? branch.days : branch.weeks;
  const label = (r: LaborRow) => (view === "gun" ? dayLabel(r.from) : weekLabel(r.from, r.to));
  const gap = Math.abs(branch.daysLabor - branch.month.labor) >= 1;
  return (
    <Card>
      <CardHeader
        title={branch.name}
        description={view === "gun" ? `${monthLabel(data.month)}, gün gün.` : "Pazartesiden pazara; ilk ve son hafta ayın dışına taşan günleriyle."}
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH sticky>{view === "gun" ? "Gün" : "Hafta"}</TH>
              <TH numeric>Ciro (KDV hariç)</TH>
              <TH numeric>İşçilik</TH>
              <TH numeric>İşçilik / ciro</TH>
              <TH>
                <span className="sr-only">Not</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => {
              const note = rowNote(r);
              return (
                <TR key={r.key}>
                  <TD sticky className="whitespace-nowrap">
                    {label(r)}
                  </TD>
                  <TD numeric className={r.revenue === null ? "text-ink-mute" : undefined}>
                    {r.revenue === null ? "veri yok" : tl(r.revenue)}
                  </TD>
                  <TD numeric>{tl(r.labor)}</TD>
                  <TD numeric className="font-semibold">
                    {ratioText(r.ratio)}
                  </TD>
                  <TD className="text-xs whitespace-nowrap text-ink-mute">{note}</TD>
                </TR>
              );
            })}
          </tbody>
          {view === "gun" && rows.length ? (
            <tfoot>
              <TFootRow>
                <TD sticky>Günlerin toplamı</TD>
                <TD numeric>{tl(rows.reduce((a, r) => a + (r.revenue ?? 0), 0))}</TD>
                <TD numeric>{tl(branch.daysLabor)}</TD>
                <TD />
                <TD />
              </TFootRow>
            </tfoot>
          ) : null}
        </Table>
      </TableWrap>
      {gap ? (
        <p className="px-5 pb-4 text-xs text-pretty text-ink-mute">
          Ayın günlerinin işçiliği {tl(branch.daysLabor)}, Gelir-gider&apos;in personeli {tl(branch.month.labor)}: Gelir-gider maaşı ayın kasa raporuyla kaplı
          (ya da elle yazılan açık) günüyle oranlar, bu tablo bugüne kadarki takvim günüyle.
        </p>
      ) : null}
    </Card>
  );
}
