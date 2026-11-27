import { ArrowLeft, HandCoins } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { MonthPicker, MonthPickerSkeleton } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { ALL_BRANCHES, tillBranches } from "@/lib/branches";
import { shiftMonth } from "@/lib/calc/engine";
import { businessDate } from "@/lib/cash-report";
import { money, monthLabel } from "@/lib/format";
import { dayMonthTR } from "@/lib/reminders";
import { HANDOVER_TEXT, ledgerByRecipient, ledgerTotal, type HandoverRow } from "@/lib/teslim";
import { requireCan } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { handoverFirstDate, handoverLedger } from "@/server/data/handover-ledger";

export const metadata: Metadata = { title: "Teslim defteri" };

const TITLE = "Teslim defteri";
const DESCRIPTION = "Kasadan teslim edilen nakit ve kimin aldığı: kasa raporunun sayımdan sonra teslimi ve gün içindeki teslim satırları (AsilPOS'tan gelenler dahil).";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Teslim defteri (/panel/kasa/teslim; Dalga 2, 25 Kasım 2026; docs/KASA-RAPORU.md › Teslim defteri), yalnız yönetici:
 * ayın teslimleri tarih, şube, tutar, alan ve kaydedenle. Şube panelin seçicisinden ("Tümü"de iki şube birlikte, şube
 * sütunuyla); ay ?ay= ile. Kaynaklar src/server/data/handover-ledger.ts, kurallar src/lib/teslim.ts
 */
export default function HandoverLedgerPage({ searchParams }: PageProps<"/panel/kasa/teslim">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader path="/panel/kasa/teslim" title={TITLE} description={DESCRIPTION} actions={<MonthPickerSkeleton />} />
          <PageSkeleton rows={5} />
        </>
      }
    >
      <HandoverLedgerContent searchParams={searchParams} />
    </Suspense>
  );
}

async function HandoverLedgerContent({ searchParams }: { searchParams: PageProps<"/panel/kasa/teslim">["searchParams"] }) {
  // Yönetici ve müdür (müdürde yalnız şubesinin teslimleri: okumalar şube kapsamıyla, kapsamı kilitli)
  await requireCan("isletme.yonet");
  const sp = await searchParams;
  const current = businessDate().slice(0, 7);
  const ay = pick(sp.ay);
  const month = ay && /^\d{4}-(0[1-9]|1[0-2])$/.test(ay) && ay <= current ? ay : current;
  const [rows, first, scope, branches] = await Promise.all([handoverLedger(month), handoverFirstDate(), currentBranchScope(), listBranches()]);
  const months: string[] = [];
  for (let m = first ? first.slice(0, 7) : current; m <= current && months.length < 60; m = shiftMonth(m, 1)) months.push(m);
  // "Tümü"de (ya da kasası birden çok şubenin satırı varken) şube sütunu; tek şube seçiliyken gereksiz
  const many = scope === ALL_BRANCHES && tillBranches(branches).length > 1;
  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  const scopeName = scope === ALL_BRANCHES ? null : nameOf(scope);
  const total = ledgerTotal(rows);
  const byRecipient = ledgerByRecipient(rows);
  return (
    <>
      <PageHeader
        path="/panel/kasa/teslim"
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker months={months} value={month} />
            <ButtonLink href="/panel/kasa" variant="ghost" size="sm">
              <ArrowLeft size={14} aria-hidden="true" /> Kasa raporu
            </ButtonLink>
          </div>
        }
      />
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader
            icon={<HandCoins />}
            title={`${monthLabel(month)}${scopeName ? ` · ${scopeName}` : many ? " · iki şube" : ""}`}
            description={rows.length ? `${rows.length} teslim · ${money(total)}` : "Bu ay teslim yok"}
          />
          {byRecipient.length ? (
            <ul className="flex flex-wrap gap-2 px-5 pb-5" aria-label="Alana göre">
              {byRecipient.map((r) => (
                <li key={r.to ?? ""}>
                  <Badge tone={r.to ? "gray" : "amber"}>
                    {r.to ?? HANDOVER_TEXT.noRecipient}: {money(r.amount)}
                    {r.count > 1 ? ` (${r.count})` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        {rows.length ? (
          <Card>
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <LedgerRow key={"report" in r.ref ? `r${r.ref.report}` : `o${r.ref.cashOut}`} row={r} branch={many ? nameOf(r.branchId) : null} />
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            icon={<HandCoins />}
            title="Bu ay teslim yok"
            description="Kasa raporunda sayımdan sonra teslim edilen ya da gün içinde Teslim · ödeme olarak çıkan nakit burada listelenir."
          />
        )}
      </div>
    </>
  );
}

/** Tek satır: telefonda iki satır (üstte gün, şube ve tutar; altta alan, kaydeden, tür) */
function LedgerRow({ row, branch }: { row: HandoverRow; branch: string | null }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
      <span className="min-w-0 font-medium text-ink">
        {dayMonthTR(row.date)}
        {branch ? <span className="font-normal text-ink-mute"> · {branch}</span> : null}
      </span>
      <span className="font-semibold text-ink tabular">{money(row.amount)}</span>
      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-mute">
        <span className={row.to ? "text-ink" : "text-warn"}>Kime: {row.to ?? "yazılmamış"}</span>
        <span>· Kaydeden: {row.by}</span>
        <Badge tone={row.asilpos ? "blue" : "gray"}>{row.asilpos ? "AsilPOS" : row.kind === "sayim" ? "Sayımdan sonra" : "Gün içinde"}</Badge>
      </span>
    </li>
  );
}
