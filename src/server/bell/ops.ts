import "server-only";

import { pastCountReminder, pastCountReminders, staffLateEditNotice, unpricedExtrasNotice } from "@/app/panel/sayim/logic";
import { logBellFailed, type BellFailed, type BellPart } from "@/lib/bell-failed";
import { featureInScope } from "@/lib/branch-features";
import { ALL_BRANCHES, BRANCH_PARAM, type BranchScope } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { shiftMonth } from "@/lib/calc/engine";
import { dateTR, num } from "@/lib/format";
import { staffKaraokeResult } from "@/lib/karaoke/timer-requests";
import { posBell } from "@/lib/prices/pos";
import { soldOutBell, soldOutDigestLine } from "@/lib/site-menu/sold-out";
import { addDays, todayTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { LATE_WINDOW_DAYS, staffWasteResult, wasteDeletedNotice, wasteItemText } from "@/lib/waste-requests";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { soldOutFacts } from "@/server/data/menu-status";
import { staffPosSummary } from "@/server/data/pos-staff";
import { posPendingSummary } from "@/server/data/prices";
import { loadTillScopes } from "@/server/data/till-scope";
import { loadStaffLateEdits, loadUnpricedExtras } from "@/server/data/count-alerts";
import { countProgress, countProgressByBranch } from "@/server/data/count-progress";
import { myKaraokeRequests, pendingKaraokeSummary } from "@/server/data/karaoke-requests";
import { deletedForOwner, myWasteRequests, pendingWasteSummary } from "@/server/data/waste-requests";
import type { DigestBox } from "@/server/notify/digest-template";

/*
 * Zilin operasyon satırları (src/server/actions/notifications.ts toplar; docs/BILDIRIMLER.md). Operasyon grubunun
 * modülü: kasada (ModPOS) değişecek fiyatlar ve sonra Tükendi, zayi ve karaoke sayacı silme isteklerinin satırları (plan
 * docs/planlar/personel-yetki.md §2.1, §2.2, §2.8; denetim E-15). İki rol dalında da çağrılır; personelin satırları yalnız personelin
 * yükleyicilerinden (tutar ve maliyet yok). Mal siparişi taslağının satırları (§2.4) 26 Eki 2026'da kaldırıldı.
 */

/**
 * Kasada (ModPOS) elle değiştirilecek fiyatlar (docs/FIYATLAR.md; posBell). Yönetici bütün ürünlerden, Fiyatlar ›
 * Kasaya işle'ye (Uyarılar); personel kendi sabit sütunlu özetinden (yalnız etkin ürünler), Kasadaki fiyatlar'a (Kasa).
 * Kimlik en yeni geri kalıştan: işaret zili yeniden okunmamış yapmaz, listeye yeni bir fiyat girmesi yapar. LafPOS
 * gününde (geçiş gününden itibaren) yalnız siteye bağlı olmayan ürünler ve yalnız yöneticide; siteye bağlınınkini LafPOS
 * siteden alır, öbürünü LafPOS'ta menüyü yöneten değiştirir (E-39). Kasa şube başınadır (şube kapsamı A3): seçimin her
 * kasası ayrı satır; "Tümü"de birden çok kasa açıkken başlık şubeyle başlar ("Marina: Kasada değişecek 2 fiyat"),
 * kimlik şubeyi taşır ve bağlantı o şubeyi seçer.
 */
async function posNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  const tills = await loadTillScopes(undefined, now);
  const out: PanelNotification[] = [];
  for (const scope of tills) {
    // LafPOS gününde personele fiyat görevi yok (LafPOS'ta ürün fiyatını kasiyer değiştiremez; posBell)
    if (user.role !== "admin" && scope.lafpos) continue;
    const summary = user.role === "admin" ? await posPendingSummary(scope) : await staffPosSummary(scope);
    const item = posBell(user.role, summary, now, scope.kasa);
    if (!item) continue;
    out.push(scope.name ? { ...item, id: `${item.id}-${scope.branchId}`, title: `${scope.name}: ${item.title}`, href: withBranchParam(item.href, scope.branchId) } : item);
  }
  return out;
}

/** Bağlantıya şube seçimi: seçici `?sube=`'yi çereze benimsetir (src/components/panel/branch-picker.tsx) */
function withBranchParam(href: string, branchId: string): string {
  const [path, hash] = href.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}${BRANCH_PARAM}=${encodeURIComponent(branchId)}${hash ? `#${hash}` : ""}`;
}

/**
 * Zayi istekleri (§2.8). Yönetici: bekleyen geç kayıt ve silme istekleri tek satır ("3 zayi / ikram isteği onay
 * bekliyor"; kimlik en yeni isteğin zil anından). Personel ("İsteklerim"): son 7 günde sonuçlanan kendi istekleri
 * ("Geç kayıt onaylandı: 2× Latte M (15 Eki)") ve başkasının isteğiyle silinen kendi kayıtları. Tutar yok.
 */
async function wasteRequestNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  if (user.role === "admin") {
    // Tek şube seçiliyken yalnız o şubenin istekleri (şube kapsamı C P1-1)
    const w = await pendingWasteSummary({ scope: await currentBranchScope() });
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
 * Karaoke sayacı silme istekleri (denetim E-15). Yönetici: bekleyenler tek satır ("1 karaoke sayacı silme isteği onay
 * bekliyor"; kimlik en yeni isteğin zil anından), ilk karta. Personel ("İsteklerim"): son 7 günde sonuçlanan kendi
 * istekleri ("Silme onaylandı: karaoke sayacı 24 Eki 21:00–23:00"), Karaoke ekranına. Ad, etiket ve tutar yok.
 */
async function karaokeRequestNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  if (user.role === "admin") {
    // Karaoke yalnız kendi şubesinde: başka şube seçiliyken ya da karaoke hiçbir şubede açık değilken satır yok (şube
    // kapsamı C P1-1, şube özelliği B6)
    if (!featureInScope("karaoke", await currentBranchScope(), await listBranches())) return [];
    const k = await pendingKaraokeSummary();
    if (!k.count) return [];
    return [
      {
        id: `karaoke-istek-${k.bumped?.getTime() ?? 0}`,
        kind: "warning",
        title: `${num(k.count)} karaoke sayacı silme isteği onay bekliyor`,
        body: "Açılışından 10 dakika sonra silinmesi istenen sayaçlar",
        timeLabel: k.oldestAt ? waitedText(k.oldestAt, now) : "",
        unread: true,
        href: k.firstId ? `/panel/onaylar#istek-${k.firstId}` : "/panel/onaylar",
        group: "onay",
      },
    ];
  }
  const today = todayTR(now);
  const when = (iso: string) => (todayTR(new Date(iso)) === today ? "Bugün" : dateTR(todayTR(new Date(iso))));
  return (await myKaraokeRequests(user.id, now))
    .filter((r) => r.when && (r.status === "approved" || r.status === "rejected" || r.status === "superseded" || r.status === "expired"))
    .slice(0, 5)
    .map((r) => {
      const t = staffKaraokeResult({ status: r.status as "approved" | "rejected" | "superseded" | "expired", when: r.when!, note: r.reviewNote });
      return {
        id: `istek-${r.id}-${r.status}`,
        kind: r.status === "approved" ? ("info" as const) : ("warning" as const),
        title: t.title,
        body: t.body,
        timeLabel: when(r.updatedAt),
        unread: true,
        href: "/panel/karaoke",
        group: "onay" as const,
      };
    });
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
 * 30 / 72". Kural sayim/logic.ts pastCountReminder (tamam = countStatus); sayım tamamlanınca satır kalkar. Tek şube
 * seçiliyken o şubenin sayımı (Stok sayımı ekranının şubesi); "Tümü"de açık her fiziksel şubenin ayrı satırı, sabah
 * e-postasıyla aynı (countProgressByBranch; birden çok şubede "Marina: …", adres o şubeyi seçer). Önceden "Tümü"de
 * yalnız Tuzla'ya bakılıyordu: Tuzla'nın tamam sayımı Marina'nın eksiğini susturuyordu (denetim 13 Kasım ST-04).
 */
async function pastCountNotifications(user: CurrentUser, now: Date): Promise<PanelNotification[]> {
  if (user.role !== "admin") return [];
  const day = businessDate(now);
  if (Number(day.slice(8, 10)) > 10) return [];
  const month = shiftMonth(day.slice(0, 7), -1);
  const rows =
    (await currentBranchScope()) === ALL_BRANCHES
      ? await countProgressByBranch(month).then((p) => pastCountReminders(day, p.counts, p.named))
      : [pastCountReminder(day, await countProgress(month))].filter((r) => r !== null);
  return rows.map((prev) => ({ ...prev, kind: "warning", timeLabel: "", unread: true, group: "uyari" }));
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

/**
 * Zilin operasyon satırları, iki rolde (loadPanelNotifications iki dalda çağırır); bir kaynak düşerse ötekiler kalır,
 * düşen kaynak `onFailed` ile bildirilir ve zilde "… yüklenemedi" satırı olur (src/lib/bell-failed.ts; bulgu 88)
 */
export async function opsBell(user: CurrentUser, onFailed: BellFailed = logBellFailed): Promise<PanelNotification[]> {
  const now = new Date();
  const safe = (part: BellPart, p: Promise<PanelNotification[]>) => p.catch((e: unknown) => (onFailed(part, e), [] as PanelNotification[]));
  const [pos, waste, karaoke, soldOut, count, countAlerts] = await Promise.all([
    safe("fiyat", posNotifications(user, now)),
    safe("zayi", wasteRequestNotifications(user, now)),
    safe("karaoke", karaokeRequestNotifications(user, now)),
    safe("tukendi", soldOutNotifications(user, now)),
    safe("sayim", pastCountNotifications(user, now)),
    safe("sayim", countAlertNotifications(user, now)),
  ]);
  return [...waste, ...karaoke, ...soldOut, ...count, ...countAlerts, ...pos];
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
 *
 * Sayım şube başınadır: her açık şubenin sayımına ayrı bakılır (countProgressByBranch), birden çok şube açıkken satır
 * şubenin adıyla ("Marina: Ekim 2026 sayımı yarım: 10 / 72"). Adres tek yarım şubede o şubenin sayımı (`&sube=`),
 * birden çoğunda ayın sayımı. Önceden e-postada şube seçimi olmadığı için yalnız Tuzla'nın sayımına bakılıyordu
 * (denetim 21 Kasım #16).
 */
export async function pastCountDigestLines(now: Date, scope: BranchScope = ALL_BRANCHES): Promise<{ lines: DigestBox["lines"]; href: string | null }> {
  const day = businessDate(now);
  if (Number(day.slice(8, 10)) > 10) return { lines: [], href: null };
  const month = shiftMonth(day.slice(0, 7), -1);
  const prev = await countProgressByBranch(month).catch(() => null);
  // Şubeye bağlı alıcının e-postası (şube kapsamı C P1-11): yalnız o şubenin sayımı (satır yine şubenin adıyla)
  const counts = prev ? pastCountReminders(day, scope === ALL_BRANCHES ? prev.counts : prev.counts.filter((c) => c.id === scope), prev.named) : [];
  if (!counts.length) return { lines: [], href: null };
  return {
    lines: counts.map((c) => ({ text: `${c.title}. ${c.body}`, tone: "warn" as const })),
    href: counts.length === 1 ? counts[0].href : `/panel/sayim?ay=${month}`,
  };
}
