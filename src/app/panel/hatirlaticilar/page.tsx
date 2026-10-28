import { asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { currentMonthTR, shiftMonth } from "@/lib/calc/engine";
import { fixedReminderDrifts, reminderDriftText } from "@/lib/cash-plan";
import { emailKey } from "@/lib/notify-recipients";
import { liveRecentPaid } from "@/lib/recent-paid";
import { fixedReminderAt } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { loadFixedForReminders } from "@/server/data/fixed-reminders";
import { loadRecentPaid } from "@/server/data/recent-paid";
import { getDb, schema as s } from "@/server/db";
import { loadUpcoming, recentNotifications } from "@/server/notify/digest";
import { blockedAccounts } from "@/server/notify/recipients";
import { DEFAULT_FROM, isEmailConfigured, resolveFrom } from "@/server/notify/resend";
import { loadWeeklyPanel } from "@/server/weekly/send";

import { RemindersClient } from "./reminders-client";

export const metadata: Metadata = { title: "Ödemeler & hatırlatıcılar" };
// Haftalık özet önizlemesi ve örnek gönderimi (en çok ~16 sn): bu sayfanın sunucu eylemleri sayfanın süresini kullanır
export const maxDuration = 30;

export default function RemindersPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Finans" title="Ödemeler & hatırlatıcılar" />
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
  const now = new Date();
  const [{ today, settings, reminders, items, laterInvoices, covered }, recipients, log, fixedData, unpaid, recentPaid, weekly] = await Promise.all([
    loadUpcoming(),
    db.select().from(s.notificationRecipients).orderBy(asc(s.notificationRecipients.createdAt)),
    recentNotifications(10),
    // Bitiş ayına göre (saklı `active` bayatlayabilir; E-62): biten kalem "Sabit giderlerden ekle"de önerilmez
    loadFixedForReminders(db, currentMonthTR(now)),
    // Kaynak etiketi için ("Paraşüt faturası"): yalnız ödenmemiş faturaların kimliği ve kaynağı
    db.select({ id: s.invoices.id, source: s.invoices.source }).from(s.invoices).where(eq(s.invoices.unpaid, true)),
    loadRecentPaid(),
    // Haftalık özetin satırı; okunamazsa satır gösterilmez, sayfa açılır
    loadWeeklyPanel(now).catch((e) => {
      console.error("[haftalik] Ödemeler satırı", e);
      return null;
    }),
  ]);
  // Son ödenenler: geri alınamayanlar (silinmiş ya da ödendikten sonra değişmiş hatırlatıcı, yeniden ödenmemiş fatura,
  // silinmiş ya da düzenlenmiş cari ödeme) gösterilmez; kayıt durur, ertelemenin geri alınmasıyla yeniden geçerli olabilir
  const paymentIds = recentPaid.filter((e) => e.kind === "cari").map((e) => e.id);
  const payments = paymentIds.length
    ? await db.select({ id: s.supplierEntries.id, updatedAt: s.supplierEntries.updatedAt }).from(s.supplierEntries).where(inArray(s.supplierEntries.id, paymentIds))
    : [];
  // Personel ya da pasif hesabın adresi (E-53): listede durur ama e-posta almaz; satırında söylenir
  const blocked = await blockedAccounts(db, recipients.map((r) => r.email));
  const undoable = liveRecentPaid(
    recentPaid,
    reminders,
    unpaid.map((i) => i.id),
    new Map(payments.map((p) => [p.id, p.updatedAt.toISOString()])),
  );
  // "Sabit giderlerden ekle": kalem, sürümleri ve gelecek ayın (varsayılan ilk ödeme) dönemi; sayfa seçilen günün
  // ayındaki tutarı fixedReminderAt ile kendisi hesaplar (eylemin yazacağıyla aynı)
  const firstMonth = shiftMonth(today.slice(0, 7), 1);
  const versions = fixedData.versions;
  const fixed = fixedData.candidates.map((f) => {
    const own = versions.filter((v) => v.fixedExpenseId === f.id).map((v) => ({ fromMonth: v.fromMonth, period: v.period, amount: v.amount }));
    return { id: f.id, name: f.name, amount: f.amount, basePeriod: f.period, period: fixedReminderAt(f, own, firstMonth).period, section: f.section, vatRate: f.vatRate, versions: own, endMonth: f.endMonth };
  });

  return (
    <RemindersClient
      today={today}
      items={items}
      laterInvoices={laterInvoices}
      covered={covered}
      reminders={reminders.map((r) => ({ ...r, lastDoneAt: r.lastDoneAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }))}
      recipients={recipients.map((r) => ({ id: r.id, email: r.email, name: r.name, active: r.active, blocked: blocked.get(emailKey(r.email)) ?? null }))}
      log={log.map((l) => ({ id: l.id, key: l.key, subject: l.subject, recipients: l.recipients, ok: l.ok, error: l.error, sentAt: l.sentAt.toISOString() }))}
      fixedExpenses={fixed}
      // Sabit gidere bağlı tutarlı hatırlatıcının tutarı Giderler'deki sürümden farklı (E-46): nakit planı eski tutarı öderdi
      drifts={fixedReminderDrifts(reminders, fixedData.all, versions, today, undefined, fixedData.monthlyExpenseNames).map((d) => ({ ...d, text: reminderDriftText(d) }))}
      invoiceSource={Object.fromEntries(unpaid.map((i) => [i.id, i.source]))}
      recentPaid={undoable.map(({ conversion, ...e }) => (conversion ? { ...e, converted: true } : e))}
      email={{
        configured: isEmailConfigured(),
        cron: Boolean(process.env.CRON_SECRET),
        from: resolveFrom(settings.from),
        defaultFrom: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
      }}
      settings={settings}
      weekly={weekly}
    />
  );
}
