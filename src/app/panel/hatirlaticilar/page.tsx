import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { liveRecentPaid } from "@/lib/recent-paid";
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
  const [{ today, settings, reminders, items, laterInvoices }, recipients, log, fixed, unpaid, recentPaid] = await Promise.all([
    loadUpcoming(),
    db.select().from(s.notificationRecipients).orderBy(asc(s.notificationRecipients.createdAt)),
    recentNotifications(10),
    db
      .select({ id: s.fixedExpenses.id, name: s.fixedExpenses.name, amount: s.fixedExpenses.amount, period: s.fixedExpenses.period, section: s.fixedExpenses.section })
      .from(s.fixedExpenses)
      .where(eq(s.fixedExpenses.active, true))
      .orderBy(asc(s.fixedExpenses.sortOrder)),
    // Kaynak etiketi için ("Paraşüt faturası"): yalnız ödenmemiş faturaların kimliği ve kaynağı
    db.select({ id: s.invoices.id, source: s.invoices.source }).from(s.invoices).where(eq(s.invoices.unpaid, true)),
    loadRecentPaid(),
  ]);
  // Son ödenenler: geri alınamayanlar (silinmiş ya da ödendikten sonra değişmiş hatırlatıcı, yeniden ödenmemiş fatura)
  // gösterilmez; kayıt durur, ertelemenin geri alınmasıyla yeniden geçerli olabilir
  const undoable = liveRecentPaid(recentPaid, reminders, unpaid.map((i) => i.id));

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
