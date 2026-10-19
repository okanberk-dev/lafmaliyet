"use server";

import { alerts } from "@/lib/calc/insights";
import { monthShort, tl } from "@/lib/format";
import { daysLeftLabel } from "@/lib/reminders";
import { getCurrentUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadUpcoming } from "@/server/notify/digest";

export interface PanelNotification {
  id: string;
  kind: "danger" | "warning" | "info";
  title: string;
  body: string;
  timeLabel: string;
  unread: boolean;
  href: string;
}

/**
 * Kenar çubuğundaki zil: önce zamanı gelen ödemeler (gecikmiş, bugün, yakında), sonra son satış ayının
 * uyarıları (Genel bakış'taki "Dikkat edilmesi gerekenler" ile aynı kaynak). Kabuk açılınca bir kez istenir;
 * personel için boş döner.
 */
export async function loadPanelNotifications(): Promise<PanelNotification[]> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return [];
  const [model, upcoming] = await Promise.all([loadModel(), loadUpcoming().catch(() => null)]);

  const payments: PanelNotification[] = (upcoming?.items ?? [])
    .filter((i) => i.status !== "later")
    .slice(0, 8)
    .map((i) => ({
      id: `odeme-${i.ref}-${i.dueDate}`,
      kind: i.status === "overdue" ? "danger" : i.status === "today" ? "warning" : "info",
      title: `${i.title}${i.amount !== null ? ` · ${tl(i.amount)}` : ""}`,
      body: i.status === "overdue" ? `Ödeme ${daysLeftLabel(i.daysLeft).toLocaleLowerCase("tr-TR")}.` : `Son ödeme: ${daysLeftLabel(i.daysLeft).toLocaleLowerCase("tr-TR")}.`,
      timeLabel: daysLeftLabel(i.daysLeft),
      unread: i.status !== "soon",
      href: "/panel/hatirlaticilar",
    }));

  const month = model.salesMonths[model.salesMonths.length - 1];
  const warnings: PanelNotification[] = month
    ? alerts(model, month).map((a, i) => ({
        id: `uyari-${i}`,
        kind: a.level,
        title: a.title,
        body: a.detail,
        timeLabel: monthShort(month),
        unread: a.level !== "info",
        href: a.href ?? "/panel",
      }))
    : [];
  return [...payments, ...warnings];
}
