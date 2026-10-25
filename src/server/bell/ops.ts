import "server-only";

import { businessDate } from "@/lib/cash-report";
import { dateTR, num } from "@/lib/format";
import { posBell } from "@/lib/prices/pos";
import { addDays, todayTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { LATE_WINDOW_DAYS, staffWasteResult, wasteDeletedNotice, wasteItemText } from "@/lib/waste-requests";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { staffPosSummary } from "@/server/data/pos-staff";
import { posPendingSummary } from "@/server/data/prices";
import { deletedForOwner, myWasteRequests, pendingWasteSummary } from "@/server/data/waste-requests";
import type { DigestBox } from "@/server/notify/digest-template";

/*
 * Zilin operasyon satırları (src/server/actions/notifications.ts toplar; docs/BILDIRIMLER.md). Operasyon grubunun
 * modülü: kasada (ModPOS) değişecek fiyatlar ve sonra Tükendi, mal siparişi taslağı ve zayi isteklerinin satırları
 * (plan docs/planlar/personel-yetki.md §2.1, §2.2, §2.4, §2.8). İki rol dalında da çağrılır; personelin satırları
 * yalnız personelin yükleyicilerinden (tutar ve maliyet yok).
 */

/**
 * Kasada (ModPOS) elle değiştirilecek fiyatlar (docs/FIYATLAR.md; posBell). Yönetici bütün ürünlerden, Fiyatlar ›
 * Kasaya işle'ye (Uyarılar); personel kendi sabit sütunlu özetinden (yalnız etkin ürünler), Kasadaki fiyatlar'a (Kasa).
 * Kimlik en yeni geri kalıştan: işaret zili yeniden okunmamış yapmaz, listeye yeni bir fiyat girmesi yapar.
 */
async function posNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  const summary = user.role === "admin" ? await posPendingSummary() : await staffPosSummary();
  const item = posBell(user.role, summary, now);
  return item ? [item] : [];
}

/**
 * Zayi istekleri (§2.8). Yönetici: bekleyen geç kayıt ve silme istekleri tek satır ("3 zayi / ikram isteği onay
 * bekliyor"; kimlik en yeni isteğin zil anından). Personel ("İsteklerim"): son 7 günde sonuçlanan kendi istekleri
 * ("Geç kayıt onaylandı: 2× Latte M (15 Eki)") ve başkasının isteğiyle silinen kendi kayıtları. Tutar yok.
 */
async function wasteRequestNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  if (user.role === "admin") {
    const w = await pendingWasteSummary();
    if (!w.count) return [];
    return [
      {
        id: `zayi-istek-${w.bumped?.getTime() ?? 0}`,
        kind: "warning",
        title: `${num(w.count)} zayi / ikram isteği onay bekliyor`,
        body: "Geç kayıt ve silme istekleri",
        timeLabel: w.oldestAt ? waitedText(w.oldestAt, now) : "",
        unread: true,
        href: w.firstId ? `/panel/onaylar#istek-${w.firstId}` : "/panel/onaylar",
        group: "onay",
      },
    ];
  }
  const [mine, deleted] = await Promise.all([myWasteRequests(user.id, now), deletedForOwner(user.id, now)]);
  const today = todayTR(now);
  const oldest = addDays(businessDate(now), -LATE_WINDOW_DAYS);
  const when = (iso: string) => (todayTR(new Date(iso)) === today ? "Bugün" : dateTR(todayTR(new Date(iso))));
  const zayiHref = (day: string | null) => (day && day >= oldest ? `/panel/zayi?gun=${day}` : "/panel/zayi");
  const results: PanelNotification[] = mine
    .filter((r) => r.item && r.day && (r.status === "approved" || r.status === "rejected" || r.status === "superseded" || r.status === "expired"))
    .slice(0, 5)
    .map((r) => {
      const t = staffWasteResult({ kind: r.kind, status: r.status as "approved" | "rejected" | "superseded" | "expired", item: wasteItemText(r.item!), day: r.day!, note: r.reviewNote });
      return {
        id: `istek-${r.id}-${r.status}`,
        kind: r.status === "approved" ? ("info" as const) : ("warning" as const),
        title: t.title,
        body: t.body,
        timeLabel: when(r.updatedAt),
        unread: true,
        href: zayiHref(r.day),
        group: "onay" as const,
      };
    });
  const notices: PanelNotification[] = deleted.map((d) => ({
    id: `zayi-silindi-${d.id}`,
    kind: "info",
    title: wasteDeletedNotice({ item: wasteItemText(d.item), day: d.item.date, by: d.by }),
    body: d.item.reason ?? "Kayıt listeden çıktı",
    timeLabel: when(d.at),
    unread: true,
    href: zayiHref(d.item.date),
    group: "onay",
  }));
  return [...results, ...notices];
}

/** Zilin operasyon satırları, iki rolde (loadPanelNotifications iki dalda çağırır); bir kaynak düşerse ötekiler kalır */
export async function opsBell(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const [pos, waste] = await Promise.all([posNotifications(user, now).catch(() => []), wasteRequestNotifications(user, now).catch(() => [])]);
  return [...waste, ...pos];
}

/**
 * Sabah e-postasının "Onay bekleyenler" kutusuna operasyonun bilgi satırları (src/server/notify/digest-extras.ts; ör.
 * personelin tükendi yaptığı ürünler, yalnız ad ve süre). Tutar yazılmaz. Satır yoksa boş.
 */
export async function opsDigestLines(now: Date): Promise<DigestBox["lines"]> {
  void now;
  return [];
}
