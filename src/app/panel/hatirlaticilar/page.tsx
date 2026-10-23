import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { shiftMonth } from "@/lib/calc/engine";
import { liveRecentPaid } from "@/lib/recent-paid";
import { fixedReminderAt } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { loadRecentPaid } from "@/server/data/recent-paid";
import { getDb, schema as s } from "@/server/db";
import { loadUpcoming, recentNotifications } from "@/server/notify/digest";
import { DEFAULT_FROM, isEmailConfigured, resolveFrom } from "@/server/notify/resend";

import { RemindersClient } from "./reminders-client";

export const metadata: Metadata = { title: "Ödemeler & hatırlatıcılar" };

export default function RemindersPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Satış & gider" title="Ödemeler & hatırlatıcılar" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <RemindersContent />
    </Suspense>
  );
}

async function RemindersContent() {
  await requireAdmin();
  const db = getDb();
  const [{ today, settings, reminders, items, laterInvoices }, recipients, log, fixedRows, versions, unpaid, recentPaid] = await Promise.all([
    loadUpcoming(),
    db.select().from(s.notificationRecipients).orderBy(asc(s.notificationRecipients.createdAt)),
    recentNotifications(10),
    db
      .select({ id: s.fixedExpenses.id, name: s.fixedExpenses.name, amount: s.fixedExpenses.amount, period: s.fixedExpenses.period, section: s.fixedExpenses.section, vatRate: s.fixedExpenses.vatRate })
      .from(s.fixedExpenses)
      .where(eq(s.fixedExpenses.active, true))
      .orderBy(asc(s.fixedExpenses.sortOrder)),
    db
      .select({ fixedExpenseId: s.fixedExpenseVersions.fixedExpenseId, fromMonth: s.fixedExpenseVersions.fromMonth, period: s.fixedExpenseVersions.period, amount: s.fixedExpenseVersions.amount })
      .from(s.fixedExpenseVersions),
    // Kaynak etiketi için ("Paraşüt faturası"): yalnız ödenmemiş faturaların kimliği ve kaynağı
    db.select({ id: s.invoices.id, source: s.invoices.source }).from(s.invoices).where(eq(s.invoices.unpaid, true)),
    loadRecentPaid(),
  ]);
  // Son ödenenler: geri alınamayanlar (silinmiş ya da ödendikten sonra değişmiş hatırlatıcı, yeniden ödenmemiş fatura)
  // gösterilmez; kayıt durur, ertelemenin geri alınmasıyla yeniden geçerli olabilir
  const undoable = liveRecentPaid(recentPaid, reminders, unpaid.map((i) => i.id));
  // "Sabit giderlerden ekle"nin göstereceği tutar: varsayılan ilk ödeme ayında (gelecek ay) hatırlatıcıya yazılacak olan
  const firstMonth = shiftMonth(today.slice(0, 7), 1);
  const fixed = fixedRows.map((f) => {
    const at = fixedReminderAt(
      f,
      versions.filter((v) => v.fixedExpenseId === f.id),
      firstMonth,
    );
    return { id: f.id, name: f.name, amount: f.amount, period: f.period, section: f.section, reminderAmount: at.amount, vatRate: at.vatRate };
  });

  return (
    <RemindersClient
      today={today}
      items={items}
      laterInvoices={laterInvoices}
      reminders={reminders.map((r) => ({ ...r, lastDoneAt: r.lastDoneAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }))}
      recipients={recipients.map((r) => ({ id: r.id, email: r.email, name: r.name, active: r.active }))}
      log={log.map((l) => ({ id: l.id, key: l.key, subject: l.subject, recipients: l.recipients, ok: l.ok, error: l.error, sentAt: l.sentAt.toISOString() }))}
      fixedExpenses={fixed}
      invoiceSource={Object.fromEntries(unpaid.map((i) => [i.id, i.source]))}
      recentPaid={undoable}
      email={{
        configured: isEmailConfigured(),
        cron: Boolean(process.env.CRON_SECRET),
        from: resolveFrom(settings.from),
        defaultFrom: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
      }}
      settings={settings}
    />
  );
}
