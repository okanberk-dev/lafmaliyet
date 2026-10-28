import "server-only";

import { pastCountReminder, staffLateEditNotice, unpricedExtrasNotice } from "@/app/panel/sayim/logic";
import { businessDate } from "@/lib/cash-report";
import { shiftMonth } from "@/lib/calc/engine";
import { dateTR, num } from "@/lib/format";
import { posBell } from "@/lib/prices/pos";
import { soldOutBell, soldOutDigestLine } from "@/lib/site-menu/sold-out";
import { addDays, todayTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { LATE_WINDOW_DAYS, staffWasteResult, wasteDeletedNotice, wasteItemText } from "@/lib/waste-requests";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { soldOutFacts } from "@/server/data/menu-status";
import { staffPosSummary } from "@/server/data/pos-staff";
import { posPendingSummary } from "@/server/data/prices";
import { loadTillScope } from "@/server/data/till-scope";
import { loadStaffLateEdits, loadUnpricedExtras } from "@/server/data/count-alerts";
import { countProgress } from "@/server/data/count-progress";
import { deletedForOwner, myWasteRequests, pendingWasteSummary } from "@/server/data/waste-requests";
import type { DigestBox } from "@/server/notify/digest-template";

/*
 * Zilin operasyon satırları (src/server/actions/notifications.ts toplar; docs/BILDIRIMLER.md). Operasyon grubunun
 * modülü: kasada (ModPOS) değişecek fiyatlar ve sonra Tükendi ve zayi isteklerinin satırları (plan
 * docs/planlar/personel-yetki.md §2.1, §2.2, §2.8). İki rol dalında da çağrılır; personelin satırları yalnız personelin
 * yükleyicilerinden (tutar ve maliyet yok). Mal siparişi taslağının satırları (§2.4) 26 Eki 2026'da kaldırıldı.
 */

/**
 * Kasada (ModPOS) elle değiştirilecek fiyatlar (docs/FIYATLAR.md; posBell). Yönetici bütün ürünlerden, Fiyatlar ›
 * Kasaya işle'ye (Uyarılar); personel kendi sabit sütunlu özetinden (yalnız etkin ürünler), Kasadaki fiyatlar'a (Kasa).
 * Kimlik en yeni geri kalıştan: işaret zili yeniden okunmamış yapmaz, listeye yeni bir fiyat girmesi yapar. LafPOS
 * gününde (geçiş gününden itibaren) yalnız siteye bağlı olmayan ürünler ve yalnız yöneticide; siteye bağlınınkini LafPOS
 * siteden alır, öbürünü LafPOS'ta menüyü yöneten değiştirir (E-39).
 */
async function posNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  const scope = await loadTillScope(undefined, now);
  // LafPOS gününde personele fiyat görevi yok (LafPOS'ta ürün fiyatını kasiyer değiştiremez; posBell)
  if (user.role !== "admin" && scope.lafpos) return [];
  const summary = user.role === "admin" ? await posPendingSummary(scope) : await staffPosSummary(scope);
  const item = posBell(user.role, summary, now, scope.kasa);
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

/**
 * Sayımın yöneticiye uyarıları (yalnız yönetici, grup Uyarılar; denetim B02): bu ayın ve geçen ayın fiyatı girilmemiş
 * ek kalemleri (kapanış stoğuna 0 ₺ girer; fiyat girilince kalkar) ve personelin ay bittikten sonra geçen ayın sayımına
 * yaptığı kayıtlar (kimlik en son kayıttan). Ay kasanın iş gününden (05:00'te döner). Personelde hiç okunmaz.
 */
async function countAlertNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  if (user.role !== "admin") return [];
  const month = businessDate(now).slice(0, 7);
  const prev = shiftMonth(month, -1);
  const [extras, late] = await Promise.all([loadUnpricedExtras([month, prev]), loadStaffLateEdits(prev)]);
  const out: PanelNotification[] = [];
  const edit = staffLateEditNotice(prev, late);
  if (edit) {
    const day = todayTR(new Date(edit.lastAt));
    const today = todayTR(now);
    const timeLabel = day === today ? "Bugün" : day === addDays(today, -1) ? "Dün" : dateTR(day);
    out.push({ id: edit.id, kind: "info", title: edit.title, body: edit.body, href: edit.href, timeLabel, unread: true, group: "uyari" });
  }
  for (const u of extras) {
    const n = unpricedExtrasNotice(u);
    if (n) out.push({ ...n, kind: "warning", timeLabel: "", unread: true, group: "uyari" });
  }
  return out;
}

/** Zilin operasyon satırları, iki rolde (loadPanelNotifications iki dalda çağırır); bir kaynak düşerse ötekiler kalır */
export async function opsBell(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const [pos, waste, soldOut, count, countAlerts] = await Promise.all([
    posNotifications(user, now).catch(() => []),
    wasteRequestNotifications(user, now).catch(() => []),
    soldOutNotifications(user, now).catch(() => []),
    pastCountNotifications(user, now).catch(() => []),
    countAlertNotifications(user, now).catch(() => []),
  ]);
  return [...waste, ...soldOut, ...count, ...countAlerts, ...pos];
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
