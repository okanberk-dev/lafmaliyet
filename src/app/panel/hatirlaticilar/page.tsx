import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { requireAdmin } from "@/server/auth/dal";
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
          <PageSkeleton rows={8} />
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
  const [{ today, settings, reminders, items }, recipients, log, fixed] = await Promise.all([
    loadUpcoming(),
    db.select().from(s.notificationRecipients).orderBy(asc(s.notificationRecipients.createdAt)),
    recentNotifications(10),
    db
      .select({ id: s.fixedExpenses.id, name: s.fixedExpenses.name, amount: s.fixedExpenses.amount, period: s.fixedExpenses.period, section: s.fixedExpenses.section })
      .from(s.fixedExpenses)
      .where(eq(s.fixedExpenses.active, true))
      .orderBy(asc(s.fixedExpenses.sortOrder)),
  ]);

  return (
    <RemindersClient
      today={today}
      items={items}
      reminders={reminders.map((r) => ({ ...r, lastDoneAt: r.lastDoneAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }))}
      recipients={recipients.map((r) => ({ id: r.id, email: r.email, name: r.name, active: r.active }))}
      log={log.map((l) => ({ id: l.id, key: l.key, subject: l.subject, recipients: l.recipients, ok: l.ok, error: l.error, sentAt: l.sentAt.toISOString() }))}
      fixedExpenses={fixed}
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
