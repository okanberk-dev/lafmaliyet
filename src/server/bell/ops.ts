import "server-only";

import { agoLabel } from "@/lib/prices/pos";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { posPendingSummary } from "@/server/data/prices";
import type { DigestBox } from "@/server/notify/digest-template";

/*
 * Zilin operasyon satırları (src/server/actions/notifications.ts toplar; docs/BILDIRIMLER.md). Operasyon grubunun
 * modülü: kasada (ModPOS) değişecek fiyatlar ve sonra Tükendi, mal siparişi taslağı ve zayi isteklerinin satırları
 * (plan docs/planlar/personel-yetki.md §2.1, §2.2, §2.4, §2.8). İki rol dalında da çağrılır; bugün personele bir şey
 * döndürmez (personelin satırları maddeleriyle gelir).
 */

/**
 * Yönetici: kasada (ModPOS) elle değiştirilecek fiyatlar (Ürünler › Fiyatlar › Kasaya işle; docs/FIYATLAR.md). Kimlik
 * sayıdan ve en yeni değişiklikten: yeni bir fiyat listeye girince yeniden okunmamış olur. Zaman en eskisinden.
 */
async function posNotifications(): Promise<PanelNotification[]> {
  const p = await posPendingSummary();
  if (!p.count) return [];
  return [
    {
      id: `kasa-fiyat-${p.count}-${p.newest?.getTime() ?? 0}`,
      kind: "info",
      title: `Kasada değişecek ${p.count} fiyat`,
      body: "ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin",
      timeLabel: p.oldest ? agoLabel(p.oldest) : "",
      unread: true,
      href: "/panel/urunler/fiyatlar?sekme=kasa",
      group: "uyari",
    },
  ];
}

/** Zilin operasyon satırları, iki rolde (loadPanelNotifications iki dalda çağırır); bir kaynak düşerse ötekiler kalır */
export async function opsBell(user: CurrentUser): Promise<PanelNotification[]> {
  if (user.role !== "admin") return [];
  return posNotifications().catch(() => []);
}

/**
 * Sabah e-postasının "Onay bekleyenler" kutusuna operasyonun bilgi satırları (src/server/notify/digest-extras.ts; ör.
 * personelin tükendi yaptığı ürünler, yalnız ad ve süre). Tutar yazılmaz. Satır yoksa boş.
 */
export async function opsDigestLines(now: Date): Promise<DigestBox["lines"]> {
  void now;
  return [];
}
