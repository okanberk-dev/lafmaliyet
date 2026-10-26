import "server-only";

import { pastCountReminder } from "@/app/panel/sayim/logic";
import { businessDate } from "@/lib/cash-report";
import { shiftMonth } from "@/lib/calc/engine";
import { dateTR, num } from "@/lib/format";
import { posBell } from "@/lib/prices/pos";
import { isDraftExpired, undoneBellBody } from "@/lib/reorder/draft";
import { soldOutBell, soldOutDigestLine } from "@/lib/site-menu/sold-out";
import { addDays, todayTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { LATE_WINDOW_DAYS, staffWasteResult, wasteDeletedNotice, wasteItemText } from "@/lib/waste-requests";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { soldOutFacts } from "@/server/data/menu-status";
import { draftBellRows } from "@/server/data/order-drafts";
import { staffPosSummary } from "@/server/data/pos-staff";
import { posPendingSummary } from "@/server/data/prices";
import { countProgress } from "@/server/data/count-progress";
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

/**
 * Tükendi (§2.1; yalnız yönetici, grup Uyarılar): personelin bar ekranında kapattığı ve hâlâ satışta olmayan ürünler
 * ("Tükendi: Tiramisu, Cheesecake"; kim ve saat). Bir kayıt 24 saatten eskiyse ya da son bir saatte personel 3 ya da
 * daha çok ürün kapattıysa uyarı. Ürün satışa açılınca satır kalkar; push yok. Fiyat yok.
 */
async function soldOutNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  if (user.role !== "admin") return [];
  const facts = await soldOutFacts();
  const bell = soldOutBell(facts?.items ?? [], now);
  if (!bell) return [];
  return [{ ...bell, timeLabel: "", unread: true, group: "uyari" }];
}

/** "Kaldi · 5 kalem" → ["Kaldi", "5 kalem"] */
const splitTitle = (t: string): [string, string] => {
  const i = t.lastIndexOf(" · ");
  return i < 0 ? [t, ""] : [t.slice(0, i), t.slice(i + 3)];
};

/**
 * Mal siparişi taslakları (§2.4; grup Onaylar, push ayrı: src/server/order-drafts/notify.ts). Yönetici: bekleyen taslak
 * başına "Mal siparişi onay bekliyor: Kaldi" (en çok 5; kimlik zil anından, taslak güncellenince yeniden okunmamış) ve
 * son 24 saatte personelin geri aldığı gönderim. Personel ("İsteklerim"): kendi taslağının sonucu: onaylandı (gönderilene
 * kadar), reddedildi (7 gün). Tutar yok.
 */
async function draftNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  const today = todayTR(now);
  const when = (d: Date) => (todayTR(d) === today ? "Bugün" : dateTR(todayTR(d)));
  if (user.role === "admin") {
    const rows = await draftBellRows({ since: new Date(now.getTime() - 86_400_000) });
    const pending = rows
      .filter((r) => r.status === "pending" && !isDraftExpired(r, now))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 5)
      .map((r): PanelNotification => {
        const [supplier, count] = splitTitle(r.title);
        return {
          id: `taslak-${r.id}-${r.bumpedAt.getTime()}`,
          kind: "warning",
          title: `Mal siparişi onay bekliyor: ${supplier}`,
          body: `${count} · ${r.requestedByName} hazırladı`,
          timeLabel: waitedText(r.createdAt, now),
          unread: true,
          href: `/panel/onaylar#istek-${r.id}`,
          group: "onay",
        };
      });
    const undone = rows
      .filter((r) => r.status === "cancelled")
      .slice(0, 3)
      .map((r): PanelNotification => ({
        id: `taslak-geri-${r.id}`,
        kind: "info",
        title: `${splitTitle(r.title)[0]} siparişi geri alındı`,
        body: undoneBellBody(r),
        timeLabel: when(r.updatedAt),
        unread: true,
        href: "/panel/mal-siparisi/gonderilen?durum=kapanan",
        group: "onay",
      }));
    return [...pending, ...undone];
  }
  const rows = await draftBellRows({ userId: user.id, since: new Date(now.getTime() - 7 * 86_400_000) });
  return rows
    .filter((r) => (r.status === "approved" && !isDraftExpired(r, now)) || r.status === "rejected")
    .slice(0, 5)
    .map((r): PanelNotification => {
      const supplier = splitTitle(r.title)[0];
      const approved = r.status === "approved";
      return {
        id: `istek-${r.id}-${r.status}`,
        kind: approved ? "info" : "warning",
        title: approved ? `${supplier} siparişi onaylandı; WhatsApp'tan gönderin` : `${supplier} siparişi reddedildi`,
        body: approved ? `${r.reviewedByName ?? "Yönetici"} onayladı${r.reviewNote ? ` · Yönetici: ${r.reviewNote}` : ""}` : `Yönetici: ${r.reviewNote ?? "not yok"}`,
        timeLabel: when(r.updatedAt),
        unread: true,
        href: "/panel/hizli-sayim/siparis",
        group: "onay",
      };
    });
}

/**
 * Geçen ayın stok sayımı yarım ya da yok (yalnız yönetici, grup Uyarılar; ayın ilk 10 günü, gün 05:00'te döner): "Ekim 2026 sayımı yarım:
 * 30 / 72". Kural sayim/logic.ts pastCountReminder (tamam = countStatus); sayım tamamlanınca satır kalkar.
 */
async function pastCountNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  if (user.role !== "admin") return [];
  const day = businessDate(now);
  if (Number(day.slice(8, 10)) > 10) return [];
  const prev = pastCountReminder(day, await countProgress(shiftMonth(day.slice(0, 7), -1)));
  return prev ? [{ ...prev, kind: "warning", timeLabel: "", unread: true, group: "uyari" }] : [];
}

/** Zilin operasyon satırları, iki rolde (loadPanelNotifications iki dalda çağırır); bir kaynak düşerse ötekiler kalır */
export async function opsBell(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const [pos, waste, soldOut, drafts, count] = await Promise.all([
    posNotifications(user, now).catch(() => []),
    wasteRequestNotifications(user, now).catch(() => []),
    soldOutNotifications(user, now).catch(() => []),
    draftNotifications(user, now).catch(() => []),
    pastCountNotifications(user, now).catch(() => []),
  ]);
  return [...drafts, ...waste, ...soldOut, ...count, ...pos];
}

/**
 * Sabah e-postasının "Onay bekleyenler" kutusuna operasyonun bilgi satırları (src/server/notify/digest-extras.ts):
 * personelin tükendi yaptığı ürünler, yalnız ad, kişi ve süre ("Tiramisu (Selin, 2 gündür)"). Tutar yazılmaz. Satır
 * yoksa boş.
 */
export async function opsDigestLines(now: Date): Promise<DigestBox["lines"]> {
  const facts = await soldOutFacts().catch(() => null);
  const line = soldOutDigestLine(facts?.items ?? [], now);
  return line ? [{ text: line, tone: "warn" }] : [];
}

/**
 * Sabah e-postasının aynı kutusuna geçen ayın stok sayımı (ilk 10 gün, yarım ya da yok): zildeki satırla aynı metin
 * (pastCountReminder) ve o ayın sayımının adresi. Personelden gelmez; kutu yalnız bununla açılırsa başlığı "Stok
 * sayımı" olur (src/server/staff-requests/digest.ts). Tutar yok.
 */
export async function pastCountDigestLines(now: Date): Promise<{ lines: DigestBox["lines"]; href: string | null }> {
  const day = businessDate(now);
  if (Number(day.slice(8, 10)) > 10) return { lines: [], href: null };
  const prev = await countProgress(shiftMonth(day.slice(0, 7), -1)).catch(() => null);
  const count = prev ? pastCountReminder(day, prev) : null;
  return count ? { lines: [{ text: `${count.title}. ${count.body}`, tone: "warn" }], href: count.href } : { lines: [], href: null };
}
