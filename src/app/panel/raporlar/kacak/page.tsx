import { PackageSearch, TrendingDown, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker, MonthPickerSkeleton } from "@/components/panel/month-picker";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton, Stat } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { accusativeTR, dateTR, locativeTR, monthLabel, num, pct, tl, tlUnit } from "@/lib/format";
import type { LeakLine, LeakReport } from "@/lib/kacak";
import { STOCK_ESTIMATE_OTHER_BRANCH, stockQty } from "@/lib/stock-estimate";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/dal";
import { monthParam } from "@/server/data/dataset";
import { loadLeakReport, type LeakData } from "@/server/data/kacak";

import { ReportHeader } from "../header";

export const metadata: Metadata = { title: "Kaçak raporu" };

const PATH = "/panel/raporlar/kacak";
const TITLE = "Kaçak raporu";
const DESCRIPTION = "Marina'nın ay sonu sayımıyla tahmini stok arasındaki fark, TL olarak.";
const MORE =
  "Tahmini stok (Stok sayımı › Tahmini stok'un hesabı): önceki ay sonu sayımı + Marina'ya gelen faturalı alış − AsilPOS satışının reçeteye göre tüketimi × (1 + genel fire) − girilen zayi ve ikram. Ayın sayımı bundan azsa fark kaçaktır (olağan firenin üstünde kayıp), fazlaysa çoğu kez Marina'ya işaretlenmemiş bir faturadır. TL, malzemenin ay sonu birim maliyetiyle (Stok sayımı'nın fiyatı, KDV hariç).";

export default function LeakPage({ searchParams }: PageProps<"/panel/raporlar/kacak">) {
  return (
    <Suspense
      fallback={
        <>
          <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={<MonthPickerSkeleton />} role="admin" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <LeakContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LeakContent({ searchParams }: { searchParams: PageProps<"/panel/raporlar/kacak">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const data = await loadLeakReport(monthParam(sp.ay));
  const picker = data.months.length ? <MonthPicker months={data.months} value={data.month} /> : null;
  const header = <ReportHeader path={PATH} title={TITLE} description={DESCRIPTION} more={MORE} actions={picker} role="admin" />;
  if (data.state !== "ok" || !data.report) {
    return (
      <>
        {header}
        <LeakEmpty data={data} />
      </>
    );
  }
  const r = data.report;
  return (
    <>
      {header}
      <p className="-mt-2 mb-4 text-xs text-pretty text-ink-mute" role="note">
        {data.branchName} · {monthLabel(r.month)} sonu sayımı ↔ ayın son günündeki tahmini stok. Genel fire tahminin içinde: kaçak, olağan firenin üstündeki kayıp.
      </p>
      <LeakWarnings report={r} month={r.month} />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat icon={<TrendingDown />} label="Kaçak (eksik çıkan)" value={tl(-r.leakTotal)} tone={r.leakTotal < 0 ? "bad" : "default"} sub={`${num(r.lines.filter((l) => (l.value ?? 0) < 0).length)} kalem`} />
        <Stat icon={<TrendingUp />} label="Fazla çıkan" value={tl(r.surplusTotal)} sub="Çoğu kez işaretlenmemiş fatura" />
        <Stat icon={<PackageSearch />} label="Net fark" value={tl(r.net)} tone={r.net < 0 ? "bad" : "default"} sub={`${num(r.lines.length)} kalem karşılaştırıldı`} />
      </div>
      {r.lines.length ? (
        <div className="space-y-6">
          <LeakTable title="En çok kaçan kalemler" description="Sayımı tahminden en çok TL eksik çıkanlar." lines={r.leaks} empty="Eksik çıkan kalem yok." />
          <LeakTable title="Fazla çıkanlar" description="Sayımı tahminden fazla: faturası Marina'ya işaretlenmemiş mal ya da Tuzla'dan getirilen." lines={r.surplus} empty="Fazla çıkan kalem yok." />
          <details className="rounded-3xl bg-panel">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-ink">Bütün kalemler ({num(r.lines.length)})</summary>
            <LeakRows lines={r.lines} />
          </details>
        </div>
      ) : (
        <EmptyState icon={<PackageSearch />} title="Karşılaştırılacak kalem yok" description="Bu ay sayılan malzemelerin tahmini yok (önceki sayım AsilPOS'tan önce ya da hiç sayılmamış)." />
      )}
    </>
  );
}

function LeakEmpty({ data }: { data: LeakData }) {
  // Marina dışında bir şube seçili (şube ayrımı): kaçak raporu tahmini stoğun şubesinin
  if (data.state === "baska-sube") {
    return (
      <EmptyState
        icon={<PackageSearch />}
        title={STOCK_ESTIMATE_OTHER_BRANCH}
        description={`${data.selectedName ?? "Bu şube"} seçili. Kaçak raporu tahmini stokla çıkar; tahmini stok yalnız ${data.branchName} (AsilPOS) için hesaplanır. Soldan ${accusativeTR(data.branchName)} ya da Tümü'nü seçin.`}
      />
    );
  }
  if (data.state === "asilpos-yok") {
    return (
      <EmptyState
        icon={<PackageSearch />}
        title="AsilPOS'a geçilmedi"
        description={`Satış gün gün AsilPOS'tan gelmeden (${data.branchName}) tahmini stok, dolayısıyla kaçak raporu yok.`}
      />
    );
  }
  if (data.state === "ay-bitmedi") {
    return (
      <EmptyState
        icon={<PackageSearch />}
        title={`${monthLabel(data.month)} bitmedi`}
        description="Kaçak, ay sonu sayımıyla çıkar: ay bitip sayım girilince bu ay seçilebilir."
        action={
          data.months.length ? (
            <ButtonLink href={`${PATH}?ay=${data.months[data.months.length - 1]}`} variant="secondary">
              {monthLabel(data.months[data.months.length - 1])}
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<PackageSearch />}
      title={`${locativeTR(data.branchName)} ${monthLabel(data.month)} sayımı yok`}
      description={
        data.asilposFrom
          ? `Kaçak, ayın sayımı tahminle karşılaştırılarak çıkar. Tahmin AsilPOS satışlarının sayıldığı ilk günden (${dateTR(data.asilposFrom)}) sonra başlayan dönemde var: ilk rapor, o günden sonraki ilk ay sonu sayımına dayanan ayın sayımıyla.`
          : "Kaçak, ayın sayımı tahminle karşılaştırılarak çıkar."
      }
      action={
        <ButtonLink href={`/panel/sayim?ay=${data.month}`} variant="secondary">
          Stok sayımı
        </ButtonLink>
      }
    />
  );
}

function LeakWarnings({ report: r, month }: { report: LeakReport; month: string }) {
  const notes: string[] = [];
  if (r.missingDays.length) {
    notes.push(
      `${num(r.missingDays.length)} gün AsilPOS gün sonu gelmedi (${r.missingDays.slice(0, 5).map(dateTR).join(", ")}${r.missingDays.length > 5 ? " …" : ""}): o günlerin satışı düşülmedi, kaçak olduğundan büyük görünür.`,
    );
  }
  if (r.skippedLines) {
    notes.push(`${num(r.skippedLines)} satış / zayi satırı ürüne bağlı değil ya da reçetesi boş (${r.skippedNames.join(", ")}): tüketimi düşülmedi, kaçak olduğundan büyük görünür.`);
  }
  if (r.unpriced.length) notes.push(`Fiyatı olmayan ${num(r.unpriced.length)} kalemin farkı TL'ye çevrilmedi: ${r.unpriced.slice(0, 5).join(", ")}${r.unpriced.length > 5 ? " …" : ""}.`);
  if (r.notCounted) notes.push(`Tahmini olan ${num(r.notCounted)} malzeme ${monthLabel(month)} sonunda sayılmadı: rapora girmedi.`);
  if (r.noEstimate) notes.push(`${num(r.noEstimate)} malzemenin tahmini yok (önceki sayımı yok ya da AsilPOS'tan önce): rapora girmedi.`);
  if (!notes.length) return null;
  const risky = r.missingDays.length > 0 || r.skippedLines > 0;
  return (
    <Notice
      tone={risky ? "warn" : "neutral"}
      size="sm"
      className="mb-4"
      title={risky ? "Kaçak olduğundan büyük görünebilir" : "Rapora girmeyenler"}
      action={risky ? <NoticeLink href="/panel/sayim/tahmini">Tahmini stok</NoticeLink> : undefined}
    >
      {notes.join(" ")}
    </Notice>
  );
}

function LeakTable({ title, description, lines, empty }: { title: string; description: string; lines: LeakLine[]; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {lines.length ? <LeakRows lines={lines} /> : <p className="px-5 pb-5 text-sm text-ink-mute">{empty}</p>}
    </Card>
  );
}

function LeakRows({ lines }: { lines: LeakLine[] }) {
  return (
    <TableWrap>
      <Table>
        <THead>
          <tr>
            <TH sticky>Kalem</TH>
            <TH numeric>Tahmini</TH>
            <TH numeric>Sayılan</TH>
            <TH numeric>Fark</TH>
            <TH numeric>Birim maliyet</TH>
            <TH numeric>TL</TH>
            <TH numeric>Tahmine oranı</TH>
          </tr>
        </THead>
        <tbody>
          {lines.map((l) => {
            const d = { unit: l.unit, factor: l.factor };
            return (
              <TR key={l.ingredientId}>
                <TD sticky className="whitespace-nowrap">
                  {l.name}
                  <span className="block text-xs text-ink-mute">
                    {monthLabel(l.countMonth)} sayımından · alış {stockQty(l.purchased, d)} · satış {stockQty(l.sold, d)} · zayi / ikram {stockQty(l.wasted, d)}
                  </span>
                </TD>
                <TD numeric>{stockQty(l.expected, d)}</TD>
                <TD numeric>{stockQty(l.actual, d)}</TD>
                <TD numeric className={cn(l.diff < 0 && "text-bad")}>
                  {l.diff > 0 ? "+" : ""}
                  {stockQty(l.diff, d)}
                </TD>
                <TD numeric className="text-ink-mute">
                  {l.unitCost === null ? "fiyat yok" : `${tlUnit(l.unitCost * l.factor)} / ${l.unit}`}
                </TD>
                <TD numeric className={cn("font-semibold", (l.value ?? 0) < 0 && "text-bad")}>
                  {l.value === null ? "—" : tl(l.value)}
                </TD>
                <TD numeric className="text-ink-mute">
                  {l.share === null ? "—" : pct(l.share, 0)}
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}
