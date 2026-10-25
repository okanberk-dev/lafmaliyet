import "server-only";

import { posBell } from "@/lib/prices/pos";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { staffPosSummary } from "@/server/data/pos-staff";
import { posPendingSummary } from "@/server/data/prices";
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

/** Zilin operasyon satırları, iki rolde (loadPanelNotifications iki dalda çağırır); bir kaynak düşerse ötekiler kalır */
export async function opsBell(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  return posNotifications(user, now).catch(() => []);
}

/**
 * Sabah e-postasının "Onay bekleyenler" kutusuna operasyonun bilgi satırları (src/server/notify/digest-extras.ts; ör.
 * personelin tükendi yaptığı ürünler, yalnız ad ve süre). Tutar yazılmaz. Satır yoksa boş.
 */
export async function opsDigestLines(now: Date): Promise<DigestBox["lines"]> {
  void now;
  return [];
}
