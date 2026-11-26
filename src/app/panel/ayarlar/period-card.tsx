import { LockKeyhole } from "lucide-react";

import { CardContent } from "@/components/ui/card";
import { businessDate } from "@/lib/cash-report";
import { checkDrift, closableMonths, closedMonths, heldSummary, monthTitle } from "@/lib/closed-period";
import { dateTimeTR, tl } from "@/lib/format";
import { loadClosedPeriods, loadHeldRecords, periodCheckOf } from "@/server/closed-period";
import { getDb } from "@/server/db";

import { ClosedPeriodPanel } from "./period-client";
import { SectionCard } from "./section-card";

/** Kapalı ayların ekranda sağlaması: son 12 kapanış (eskileri listede, sağlaması okunmaz) */
const CHECKED_MONTHS = 12;

/**
 * Ayarlar › Dönem kapanışı (docs/DONEM-KAPANISI.md): beyan edilmiş ayı kapatma, kapalı aylar (kim, ne zaman, kapanıştaki
 * sağlama ve bugün değiştiyse uyarı, yeniden aç) ve kapalı döneme düşen kayıtların kutusu (bu aya al / kapalı aya işle).
 */
export async function ClosedPeriodCard() {
  const db = getDb();
  const p = await loadClosedPeriods(db);
  const months = closedMonths(p);
  const [held, checks] = await Promise.all([
    loadHeldRecords(db, p),
    Promise.all(months.slice(0, CHECKED_MONTHS).map(async (m) => [m, await periodCheckOf(db, m, p)] as const)),
  ]);
  const now = new Map(checks);
  const heldText = heldSummary({ invoices: held.filter((h) => h.kind === "invoice").length, expenses: held.filter((h) => h.kind === "expense").length });
  const closed = months.map((m) => {
    const c = p.months[m];
    const today = now.get(m);
    return {
      month: m,
      title: monthTitle(m),
      at: dateTimeTR(c.at),
      by: c.by,
      check: today ? `${today.invoices} fatura · ${tl(today.invoiceTotal)} · ${today.expenses} harcama · ${tl(today.expenseTotal)}` : null,
      drift: today ? checkDrift(c.check, today) : null,
    };
  });
  const summary = heldText ? `${held.length} kayıt kararınızı bekliyor` : months.length ? `Kapalı: ${monthTitle(months[0])}${months.length > 1 ? ` ve öncesi (${months.length} ay)` : ""}` : "Kapalı ay yok";
  return (
    <SectionCard
      id="donem"
      icon={<LockKeyhole />}
      title="Dönem kapanışı"
      summary={summary}
      summaryTone={heldText || closed.some((c) => c.drift) ? "warn" : undefined}
      description="Muhasebeci beyan ettiği ayı kapatın: o aya sonradan gelen fatura ve harcama rakamları değiştirmez, burada kararınızı bekler. Kapalı ayın kayıtları düzeltilemez ve silinemez."
    >
      <CardContent>
        <ClosedPeriodPanel
          closed={closed}
          closable={closableMonths(businessDate(), p).map((m) => ({ month: m, title: monthTitle(m) }))}
          heldText={heldText}
          held={held.map((h) => ({ ...h, monthTitle: monthTitle(h.month), createdAt: dateTimeTR(h.createdAt) }))}
        />
      </CardContent>
    </SectionCard>
  );
}
