"use server";

import { alerts, latestSalesMonth } from "@/lib/calc/insights";
import { dateTR, monthShort, tl } from "@/lib/format";
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
  /** Zilde hangi başlığın altında durur */
  group?: "odeme" | "uyari";
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
      body: [`Son ödeme ${dateTR(i.dueDate)}`, i.detail].filter(Boolean).join(" · "),
      timeLabel: daysLeftLabel(i.daysLeft),
      unread: i.status !== "soon",
      href: "/panel/hatirlaticilar",
      group: "odeme" as const,
    }));

  const month = latestSalesMonth(model);
  const warnings: PanelNotification[] = month
    ? alerts(model, month).map((a) => ({
        // Kimlik metinden türer: aynı uyarı okundu kalır, sayısı değişen uyarı yeniden okunmamış olur
        id: `uyari-${month}-${a.title}`,
        kind: a.level,
        title: a.title,
        body: a.detail,
        timeLabel: monthShort(month),
        unread: a.level !== "info",
        href: a.href ?? "/panel",
        group: "uyari" as const,
      }))
    : [];
  return [...payments, ...warnings];
}
