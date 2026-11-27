import { Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BranchViewChip } from "@/components/panel/branch-view-chip";
import { MonthPicker, MonthPickerSkeleton } from "@/components/panel/month-picker";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { ALL_BRANCHES } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { monthLabel, pct, tl } from "@/lib/format";
import { dayLabel, LABOR_METHOD, LABOR_METHOD_NO_WAGES, weekLabel } from "@/lib/iscilik";
import { shiftMonth } from "@/lib/reminders";
import { can } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { requireCan } from "@/server/auth/dal";
import { monthParam } from "@/server/data/dataset";
import { loadLaborReport, type LaborBranchReport, type LaborReport, type LaborRowShown } from "@/server/data/iscilik";

import { compareEmpty } from "../compare-empty";
import { ReportHeader } from "../header";

export const metadata: Metadata = { title: "İşçilik / ciro" };

const PATH = "/panel/raporlar/iscilik";
const TITLE = "İşçilik / ciro";
const DESCRIPTION = "Personel maliyetinin ciroya oranı: günlük, haftalık ve şube şube.";
const MORE =
  "Ayın satırı Gelir-gider'in personeli ve cirosudur (KDV hariç). Günlük ve haftalık satırlarda tam zamanlının aylık işveren maliyeti ayın günlerine eşit bölünür (kapalı günde de maaş işler), part-time'ın günlük ücreti Vardiya'da çalıştığı güne yazılır. Giderlerdeki maaş ödemeleri kullanılmaz: ödeme günü çalışılan gün değildir. Cirosu bilinmeyen gün (kasa raporu, AsilPOS gün sonu ya da föy yok) orana girmez, sıfır sayılmaz.";
// Kişisel ücreti görmeyen rol (müdür; docs/ROLLER.md): oran yalnız aylık ücretlerle, tutar ve günlük görünüm yok
const DESCRIPTION_NO_WAGES = "Personelin aylık ücretlerinin ciroya oranı: haftalık ve aylık.";
const MORE_NO_WAGES =
  "Tam zamanlının aylık işveren maliyeti ve part-time'ın aylık ek ödemesi ayın günlerine eşit bölünür (kapalı günde de maaş işler). Part-time'ın günlük ücreti kişisel ücrettir: Vardiya'daki günlerine yazılmaz, orana girmez; işçiliğin tutarı ve günlük görünüm yöneticinin. Cirosu bilinmeyen gün (kasa raporu, AsilPOS gün sonu ya da föy yok) orana girmez, sıfır sayılmaz.";

const PICKER_MONTHS = 24;

type View = "hafta" | "gun";

export default function LaborPage({ searchParams }: PageProps<"/panel/raporlar/iscilik">) {
  return (
    <Suspense
      fallback={
        <>
          {/* Rol henüz bilinmiyor: ekranı müdür de açar. İskelet müdürün başlığıdır (sekme yok, kişisel ücretsiz
              açıklama); yöneticinin sekmeleri ve açıklaması içerik gelince çizilir */}
          <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION_NO_WAGES} more={MORE_NO_WAGES} actions={<MonthPickerSkeleton />} role="manager" />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <LaborContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LaborContent({ searchParams }: { searchParams: PageProps<"/panel/raporlar/iscilik">["searchParams"] }) {
  // Yönetici ve müdür (docs/ROLLER.md): müdür yalnız kendi şubesini, haftalık ve aylık oranı görür. Kişisel ücret (maaş
  // yeteneği) yalnız yöneticinin: günlük görünüm (tek kişinin günü o kişinin ücreti), işçiliğin tutarı ve part-time'ın
  // Vardiya'daki günü (müdür kendi yazdığı hücrenin öncesini ve sonrasını karşılaştırırdı) müdüre gitmez
  const me = await requireCan("rapor.sube");
  const admin = can(me.role, "maas");
  const description = admin ? DESCRIPTION : DESCRIPTION_NO_WAGES;
  const more = admin ? MORE : MORE_NO_WAGES;
  const sp = await searchParams;
  const current = businessDate().slice(0, 7);
  const asked = monthParam(sp.ay);
  const month = asked && asked <= current ? asked : current;
  const view: View = admin && (Array.isArray(sp.gorunum) ? sp.gorunum[0] : sp.gorunum) === "gun" ? "gun" : "hafta";
  const data = await loadLaborReport(month);
  const months = Array.from({ length: PICKER_MONTHS }, (_, i) => shiftMonth(current, i - PICKER_MONTHS + 1));
  const actions = (
    <>
      {admin ? (
      <SegmentedLinks
        label="Görünüm"
        value={view}
        options={[
          { value: "hafta", label: "Haftalık", href: `${PATH}?ay=${month}` },
          { value: "gun", label: "Günlük", href: `${PATH}?ay=${month}&gorunum=gun` },
        ]}
      />
      ) : null}
      <MonthPicker months={months} value={month} />
    </>
  );
  if (!data) {
    return (
      <>
        <ReportHeader path={PATH} title={TITLE} description={description} more={more} actions={actions} role={me.role} />
        <BranchViewChip area="karsilastirma" className="mb-4" />
        <EmptyState icon={<Users />} {...(await compareEmpty())} />
      </>
    );
  }
  const list = data.total ? [...data.branches, data.total] : data.branches;
  return (
    <>
      <ReportHeader path={PATH} title={TITLE} description={description} more={more} actions={actions} role={me.role} />
      <p className="-mt-2 mb-4 text-xs text-pretty text-ink-mute" role="note">
        Yöntem: {data.wages ? LABOR_METHOD : LABOR_METHOD_NO_WAGES}
      </p>
      <BranchViewChip area="karsilastirma" className="mb-4" />
      {data.missing.length ? (
        <Notice
          tone="warn"
          size="sm"
          risk="para"
          className="mb-4"
          title={`${data.missing.length} kişinin ücreti hesaba girmedi`}
          action={admin ? <NoticeLink href="/panel/personel">Maaşlar</NoticeLink> : undefined}
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
        description={
          data.wages
            ? "Gelir-gider'in ayı: personel giderleri (işveren maliyeti) ÷ ciro (KDV hariç)."
            : "Ayın cirosu bilinen günleri: aylık ücretler ÷ ciro (KDV hariç); part-time'ın günlük ücreti sayılmaz."
        }
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH sticky>Şube</TH>
              <TH numeric>Ciro (KDV hariç)</TH>
              {data.wages ? <TH numeric>İşçilik</TH> : null}
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
                {b.month.labor === null ? null : <TD numeric>{tl(b.month.labor)}</TD>}
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

function rowNote(r: LaborRowShown): string | null {
  const parts: string[] = [];
  if (r.unknownDays) parts.push(r.from === r.to ? "veri yok" : `${r.unknownDays} gün veri yok`);
  if (r.closedDays) parts.push(r.from === r.to ? "satış yok" : `${r.closedDays} gün satış yok`);
  return parts.length ? parts.join(" · ") : null;
}

function BranchCard({ branch, view, data }: { branch: LaborBranchReport; view: View; data: LaborReport }) {
  const rows = view === "gun" ? branch.days : branch.weeks;
  const label = (r: LaborRowShown) => (view === "gun" ? dayLabel(r.from) : weekLabel(r.from, r.to));
  // Tutar yalnız yöneticide (müdürde ikisi de null: not yok)
  const gap =
    branch.daysLabor !== null && branch.month.labor !== null && Math.abs(branch.daysLabor - branch.month.labor) >= 1
      ? { days: branch.daysLabor, month: branch.month.labor }
      : null;
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
              {data.wages ? <TH numeric>İşçilik</TH> : null}
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
                  {r.labor === null ? null : <TD numeric>{tl(r.labor)}</TD>}
                  <TD numeric className="font-semibold">
                    {ratioText(r.ratio)}
                  </TD>
                  <TD className="text-xs whitespace-nowrap text-ink-mute">{note}</TD>
                </TR>
              );
            })}
          </tbody>
          {view === "gun" && rows.length && branch.daysLabor !== null ? (
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
          Ayın günlerinin işçiliği {tl(gap.days)}, Gelir-gider&apos;in personeli {tl(gap.month)}: Gelir-gider maaşı ayın kasa raporuyla kaplı
          (ya da elle yazılan açık) günüyle oranlar, bu tablo bugüne kadarki takvim günüyle.
        </p>
      ) : null}
    </Card>
  );
}
