import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker, MonthPickerSkeleton } from "@/components/panel/month-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { CHANNEL_NO_TILL, selectedChannel } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { dateTR, num, pct, tl } from "@/lib/format";
import { LOSS_METRIC_LABEL, MIN_DAYS, type LossMetric, type MetricCompare } from "@/lib/kayip-onleme";
import { shiftMonth } from "@/lib/reminders";
import { COMPARE_SPANS, spanParam } from "@/lib/sube-karsilastirma";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { monthParam } from "@/server/data/dataset";
import { loadLossSummary, type LossData } from "@/server/data/kayip-onleme";

import { ReportHeader } from "../header";

export const metadata: Metadata = { title: "Kayıp önleme" };

const PATH = "/panel/raporlar/kayip";
const TITLE = "Kayıp önleme";
const DESCRIPTION = "Kasa farkı, iptal, ikram ve indirimin kişiye göre sapması.";
const MORE =
  "Kasa farkı kasayı sayana göre (kasa raporunun Kasayı sayan'ı), kör sayımın sonradan değişmesi değiştirene göre, zayi ve ikram kaydı girene göre: bunlar doğrudan kişinindir. İptal, ikram ve indirimi kimin yaptığını AsilPOS göndermiyor; bunlar kişinin çalıştığı günlerin günlük ortalamasıyla, aynı şubede çalışmadığı günlerinki karşılaştırılarak gösterilir. Kişiye yazılmaz, tek başına kanıt değildir: aynı gün çalışanların hepsi aynı sapmayı alır.";

/** AsilPOS'tan gelmeyen alanlar (ekranda ve raporda açıkça) */
const NOT_FROM_ASILPOS = [
  "iptali yapan",
  "ikramı ve ödenmezi veren (ödenmezde yalnız kişinin türü gelir: personel, müşteri, patron)",
  "indirimi yapan",
  "AsilPOS'ta kasayı sayan (AsilPOS'un kendiliğinden yazdığı kasa raporlarında kişi yok; vardiya devri sayımlarında da)",
];

const PICKER_MONTHS = 24;
const METRICS: LossMetric[] = ["cashDiff", "iptal", "ikram", "discount"];

export default function LossPage({ searchParams }: PageProps<"/panel/raporlar/kayip">) {
  return (
    <Suspense
      fallback={
        <>
          <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={<MonthPickerSkeleton />} />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <LossContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LossContent({ searchParams }: { searchParams: PageProps<"/panel/raporlar/kayip">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const current = businessDate().slice(0, 7);
  const asked = monthParam(sp.ay);
  const last = asked && asked <= current ? asked : current;
  const span = spanParam(sp.sure);
  const data = await loadLossSummary(last, span);
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
  const header = <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={actions} />;
  if (!data) {
    // Online kanal seçiliyken kanalın kasası yok (şube ayrımı): rapor şubelerin
    const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
    const channel = selectedChannel(scope, branches);
    return (
      <>
        {header}
        {channel ? (
          <EmptyState icon={<ShieldAlert />} title={CHANNEL_NO_TILL} description="Kayıp önleme şubelerin kasa raporlarından ve AsilPOS'tan; soldan bir şube ya da Tümü'nü seçin." />
        ) : (
          <EmptyState icon={<ShieldAlert />} title="Açık şube yok" description="Ayarlar › Şubeler'de açık bir fiziksel şube olmalı." />
        )}
      </>
    );
  }
  const nameOf = (id: string) => data.branches.find((b) => b.id === id)?.name ?? id;
  return (
    <>
      {header}
      <p className="-mt-2 mb-4 text-xs text-pretty text-ink-mute" role="note">
        {dateTR(data.from)} – {dateTR(data.to)} · {data.branches.map((b) => b.name).join(", ")}
      </p>
      <Notice tone="neutral" size="sm" className="mb-6" title="AsilPOS'tan gelmeyenler: kişiye yazılamaz">
        AsilPOS şunları göndermiyor: {NOT_FROM_ASILPOS.join("; ")}. ModPOS (föy ve kasa raporu) iptal göndermez. Bu yüzden iptal, ikram ve indirim aşağıda kişinin
        çalıştığı günlerle karşılaştırılır; kasa farkı, kör sayımın değişmesi ve panelde girilen zayi / ikram doğrudan kişinindir.
      </Notice>
      <div className="space-y-6">
        <CashCard data={data} nameOf={nameOf} />
        {data.summary.recount.branches.length ? <RecountCard data={data} nameOf={nameOf} /> : null}
        <WasteCard data={data} nameOf={nameOf} />
        <DaysCard data={data} nameOf={nameOf} />
      </div>
    </>
  );
}

const signed = (v: number) => `${v > 0 ? "+" : ""}${tl(v)}`;

function CashCard({ data, nameOf }: { data: LossData; nameOf: (id: string) => string }) {
  const { rows, branches } = data.summary.cash;
  return (
    <Card>
      <CardHeader
        title="Kasa farkı · kasayı sayana göre"
        description={`Kasa raporunun "Kasayı sayan"ı (eski raporda gönderen). Sapma: kişinin ortalaması − aynı şubede başkalarının saydığı raporların ortalaması (en az ${MIN_DAYS} rapor).`}
      />
      {rows.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH sticky>Kişi</TH>
                <TH>Şube</TH>
                <TH numeric>Rapor</TH>
                <TH numeric>Toplam fark</TH>
                <TH numeric>Ortalama</TH>
                <TH numeric>Eksik gün</TH>
                <TH numeric>En büyük eksik</TH>
                <TH numeric>Sapma</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={`${r.branchId}|${r.person.key}`}>
                  <TD sticky className="whitespace-nowrap">
                    {r.person.name}
                    {r.flag ? (
                      <Badge tone="red" className="ml-2">
                        dikkat
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="text-ink-mute">{nameOf(r.branchId)}</TD>
                  <TD numeric>{num(r.reports)}</TD>
                  <TD numeric className={cn(r.total < 0 && "text-bad")}>
                    {signed(r.total)}
                  </TD>
                  <TD numeric>{signed(r.mean)}</TD>
                  <TD numeric>{num(r.shortDays)}</TD>
                  <TD numeric className={cn(r.worst < 0 && "text-bad")}>
                    {r.worst < 0 ? tl(r.worst) : "—"}
                  </TD>
                  <TD numeric className={cn("font-semibold", r.flag && "text-bad")}>
                    {r.deviation === null ? <span className="font-normal text-ink-mute">az rapor</span> : signed(r.deviation)}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <p className="px-5 pb-4 text-sm text-ink-mute">Bu dönemde kişisi belli kasa raporu yok.</p>
      )}
      {branches.some((b) => b.unknown) ? (
        <p className="px-5 pb-4 text-xs text-pretty text-ink-mute">
          {branches
            .filter((b) => b.unknown)
            .map((b) => `${nameOf(b.branchId)}: ${num(b.unknown)} rapor AsilPOS'tan kendiliğinden yazıldı, kasayı sayan bilinmiyor (toplam fark ${signed(b.unknownTotal)})`)
            .join(" · ")}
          . Bu raporlar aşağıda çalıştığı günlere göre bölümünde sayılır.
        </p>
      ) : null}
    </Card>
  );
}

function RecountCard({ data, nameOf }: { data: LossData; nameOf: (id: string) => string }) {
  const { rows, branches } = data.summary.recount;
  return (
    <Card>
      <CardHeader
        title="Kör sayım · sayımı sonradan değiştirene göre"
        description="Kör sayım açık şubede personel çekmecedeki nakdi önce sayıp kilitler, farkı sonra görür. Kilitten sonraki her değişiklik nedeniyle yazılır; kişi değişikliği yazandır. Değişiklik: yeni sayım − önceki (artı: sayılan arttı, eksik kapandı)."
      />
      {rows.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH sticky>Kişi</TH>
                <TH>Şube</TH>
                <TH numeric>Kör sayım</TH>
                <TH numeric>Değişiklik</TH>
                <TH numeric>Değiştirdiği gün</TH>
                <TH numeric>Toplam değişiklik</TH>
                <TH numeric>En büyük</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={`${r.branchId}|${r.person.key}`}>
                  <TD sticky className="whitespace-nowrap">
                    {r.person.name}
                  </TD>
                  <TD className="text-ink-mute">{nameOf(r.branchId)}</TD>
                  <TD numeric>{num(r.locks)}</TD>
                  <TD numeric className={cn(r.changes > 0 && "font-semibold")}>
                    {num(r.changes)}
                  </TD>
                  <TD numeric>{num(r.changeDays)}</TD>
                  <TD numeric>{r.changes ? signed(r.net) : "—"}</TD>
                  <TD numeric>{r.changes ? signed(r.largest) : "—"}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : null}
      <p className="px-5 pb-4 text-xs text-pretty text-ink-mute">
        {branches.map((b) => `${nameOf(b.branchId)}: kör sayımlı ${num(b.days)} gün, sayımı kilitten sonra değişen ${num(b.changedDays)}`).join(" · ")}. Nedenler
        günün kasa görünümünde.
      </p>
    </Card>
  );
}

function WasteCard({ data, nameOf }: { data: LossData; nameOf: (id: string) => string }) {
  const { rows, unknown } = data.summary.waste;
  return (
    <Card>
      <CardHeader
        title="Zayi & ikram · kaydı girene göre"
        description="Panelde girilen zayi ve ikram kayıtları, malzeme maliyetiyle (KDV hariç). Kaydı giren, ikramı yapan olmayabilir; AsilPOS'tan gelen satırlarda kişi yok."
      />
      {rows.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH sticky>Kişi</TH>
                <TH>Şube</TH>
                <TH numeric>Kayıt</TH>
                <TH numeric>Zayi</TH>
                <TH numeric>İkram</TH>
                <TH numeric>Şubedeki payı</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={`${r.branchId}|${r.person.key}`}>
                  <TD sticky className="whitespace-nowrap">
                    {r.person.name}
                  </TD>
                  <TD className="text-ink-mute">{nameOf(r.branchId)}</TD>
                  <TD numeric>{num(r.entries)}</TD>
                  <TD numeric>{tl(r.zayiCost)}</TD>
                  <TD numeric>{tl(r.ikramCost)}</TD>
                  <TD numeric>{r.share === null ? "—" : pct(r.share, 0)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <p className="px-5 pb-4 text-sm text-ink-mute">Bu dönemde panelde zayi ya da ikram kaydı yok.</p>
      )}
      {unknown.entries ? (
        <p className="px-5 pb-4 text-xs text-ink-mute">
          Kaydedeni bilinmeyen {num(unknown.entries)} kayıt ({tl(unknown.cost)}).
        </p>
      ) : null}
    </Card>
  );
}

function MetricCell({ m, metric, missing }: { m: MetricCompare; metric: LossMetric; missing: boolean }) {
  if (missing) return <span className="text-ink-mute">gelmiyor</span>;
  if (m.worked === null) return <span className="text-ink-mute">—</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <span>{metric === "cashDiff" ? signed(m.worked) : tl(m.worked)}</span>
      <span className={cn("text-xs", m.flag ? "font-semibold text-bad" : "text-ink-mute")}>
        {m.deviation === null ? "az gün" : `${m.flag ? "▲ " : ""}sapma ${signed(m.deviation)}`}
      </span>
    </span>
  );
}

function DaysCard({ data, nameOf }: { data: LossData; nameOf: (id: string) => string }) {
  const { rows, branches } = data.summary.days;
  const missingOf = new Map(branches.map((b) => [b.branchId, new Set(b.missingMetrics)]));
  return (
    <Card>
      <CardHeader
        title="Çalıştığı günlere göre · kişiye yazılmaz"
        description={`Kişinin çalıştığı günlerin günlük ortalaması ve aynı şubede çalışmadığı günlerinkinden sapması (iki tarafta da en az ${MIN_DAYS} gün). Çalışanlar AsilPOS'un gün sonundaki listesinden, yoksa Vardiya planından. ▲: sapma kötü yönde ve şubenin günden güne oynamasından büyük.`}
      />
      {rows.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH sticky>Kişi</TH>
                <TH>Şube</TH>
                <TH numeric>Gün</TH>
                {METRICS.map((m) => (
                  <TH key={m} numeric>
                    {LOSS_METRIC_LABEL[m]}
                  </TH>
                ))}
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={`${r.branchId}|${r.person.key}`}>
                  <TD sticky className="whitespace-nowrap">
                    {r.person.name}
                  </TD>
                  <TD className="text-ink-mute">{nameOf(r.branchId)}</TD>
                  <TD numeric>{num(r.workedDays)}</TD>
                  {METRICS.map((m) => (
                    <TD key={m} numeric>
                      <MetricCell m={r.metrics[m]} metric={m} missing={missingOf.get(r.branchId)?.has(m) ?? false} />
                    </TD>
                  ))}
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <p className="px-5 pb-4 text-sm text-ink-mute">Bu dönemde çalışanı bilinen gün yok: AsilPOS&apos;un personel bağlantısı ya da Vardiya planı gerekir.</p>
      )}
      <p className="px-5 pb-4 text-xs text-pretty text-ink-mute">
        {branches
          .map(
            (b) =>
              `${nameOf(b.branchId)}: çalışanı bilinen ${num(b.days)} gün (${num(b.asilposDays)} AsilPOS, ${num(b.vardiyaDays)} Vardiya), bilinmeyen ${num(b.unknownDays)}${
                b.missingMetrics.length ? `; ${b.missingMetrics.map((m) => LOSS_METRIC_LABEL[m].toLocaleLowerCase("tr-TR")).join(", ")} bu şubede gelmiyor` : ""
              }`,
          )
          .join(" · ")}
        .
      </p>
    </Card>
  );
}
