import { tl } from "@/lib/format";

import { SITE_ACTOR_MAX, SITE_MONEY_MAX_MINOR, type SiteMenuItem } from "./schema";
import { panelIsActive, slotField, toMinor, type SiteMenuSlot, type Visibility } from "./slot";

/**
 * Panel → site yazımı (saf kısım). Bağlı bir ürünün fiyatı ya da menü durumu panelde değişince panel önce sitenin
 * yazma ucuna gider, site 2xx verince kendisi yazar; site ulaşılamazsa ya da reddederse değişiklik kaydedilmez
 * (iki yer hiçbir an ayrışmaz). Gövde: {"id","priceMinor"|"priceMinorL","isActive","actor"}; olmayan alana
 * dokunulmaz, site fazla alanı reddeder.
 */

export interface SaleState extends Visibility {
  /** TL, KDV dahil */
  price: number;
}

export interface PushBody {
  id: string;
  priceMinor?: number;
  priceMinorL?: number;
  isActive?: boolean;
  actor: string;
}

export type PushPlan =
  /** Sitedeki değerler değişmiyor (ya da ürün bağlı değil): panel her zamanki gibi yazar */
  | { kind: "none" }
  | { kind: "push"; body: PushBody; price: boolean; visibility: boolean }
  /** Gönderilmeden reddedildi (kural ya da kopuk bağlantı); hiçbir şey yazılmaz */
  | { kind: "refuse"; error: string };

/** Sitenin olay kaydındaki ad ("Panel · Selin"): kullanıcının görünen adı, en çok 80 karakter */
export function pushActor(name: string | null | undefined): string {
  const v = (name ?? "").replace(/\s+/g, " ").trim().slice(0, SITE_ACTOR_MAX).trim();
  return v || "Panel";
}

/** Gövde, sözleşmedeki sırayla (id, fiyat, durum, actor) */
export function buildPushBody(input: { id: string; slot: SiteMenuSlot; priceMinor?: number; isActive?: boolean; actor: string }): PushBody {
  const body: PushBody = { id: input.id } as PushBody;
  if (input.priceMinor !== undefined) body[slotField(input.slot)] = input.priceMinor;
  if (input.isActive !== undefined) body.isActive = input.isActive;
  body.actor = pushActor(input.actor);
  return body;
}

export const BROKEN_LINK_ERROR =
  "Bu ürünün site bağlantısı kopuk: kalemin sitede L fiyatı yok. Önce bağlantıyı kaldır ya da ürünü kalemin M (tek) fiyatına bağla.";

/**
 * Değişikliğin siteye gidip gitmeyeceği ve gövdesi. `siteItem`: son çekmedeki kalem (varsa); L yuvası ve kalem tek
 * boysa bağlantı kopuktur, fiyat ya da durum gönderilmez (gönderilseydi sitede L boyu yeniden açılırdı).
 */
export function planPush(input: {
  link: { siteMenuId: string; slot: SiteMenuSlot } | null;
  before: SaleState;
  after: SaleState;
  actor: string;
  siteItem?: Pick<SiteMenuItem, "priceMinorL"> | null;
}): PushPlan {
  const { link, before, after } = input;
  if (!link) return { kind: "none" };
  const priceMinor = toMinor(after.price);
  const priceChanged = priceMinor !== toMinor(before.price);
  const visibilityChanged = panelIsActive(before) !== panelIsActive(after);
  if (!priceChanged && !visibilityChanged) return { kind: "none" };
  if (link.slot === "L" && input.siteItem && !(input.siteItem.priceMinorL > 0)) return { kind: "refuse", error: BROKEN_LINK_ERROR };
  if (priceChanged) {
    if (priceMinor < 1) {
      return {
        kind: "refuse",
        error:
          link.slot === "M"
            ? "Siteye bağlı ürünün fiyatı 0 olamaz (sitede 0 ₺ bedava demek). Fiyatı gir ya da önce bağlantıyı kaldır."
            : "Siteye bağlı ürünün fiyatı 0 olamaz (sitede L fiyatı 0 kalemi tek boy yapar; bunu sitede yap).",
      };
    }
    if (priceMinor > SITE_MONEY_MAX_MINOR) return { kind: "refuse", error: `Fiyat sitenin üst sınırını (${tl(SITE_MONEY_MAX_MINOR / 100)}) aşıyor` };
  }
  return {
    kind: "push",
    body: buildPushBody({
      id: link.siteMenuId,
      slot: link.slot,
      priceMinor: priceChanged ? priceMinor : undefined,
      isActive: visibilityChanged ? panelIsActive(after) : undefined,
      actor: input.actor,
    }),
    price: priceChanged,
    visibility: visibilityChanged,
  };
}

/** Yazımın neden olmadığı: ağ, zaman aşımı ya da sitenin HTTP yanıtı (400'de bozuk alan) */
export type PushFailure = { kind: "network" } | { kind: "timeout" } | { kind: "off" } | { kind: "http"; status: number; field?: string | null };

const FIELD_LABEL: Record<string, string> = {
  priceMinor: "M fiyatı 0'dan büyük, kuruşu tam ve sitenin üst sınırının altında olmalı",
  priceMinorL: "L fiyatı kuruşu tam ve sitenin üst sınırının altında olmalı",
  isActive: "menü durumu",
  actor: "kullanıcı adı",
  id: "kalem kimliği",
  fields: "gönderilecek değişiklik yok",
  body: "istek gövdesi",
};

export const SITE_UNREACHABLE = "Siteye ulaşılamadı";

/**
 * Yazım olmayınca kullanıcıya gösterilen metin. `consequence` panelde ne olmadığı: "fiyat değişmedi",
 * "değişiklikler kaydedilmedi". Kalem sitede yoksa (404) sözleşmedeki sabit metin.
 */
export function pushFailureMessage(failure: PushFailure, consequence = "fiyat değişmedi"): string {
  if (failure.kind === "off") {
    return `Site bağlantısı kurulmamış (KARAOKE_SYNC_SECRET); siteye bağlı ürünün fiyatı ve menü durumu değiştirilemez, ${consequence}. Bağlantıyı kaldır ya da anahtarı ekle.`;
  }
  if (failure.kind === "network" || failure.kind === "timeout") return `${SITE_UNREACHABLE}; ${consequence}. Tekrar dene.`;
  switch (failure.status) {
    case 404:
      return "Bu ürünün bağlı olduğu kalem sitede yok; bağlantıyı kaldır ya da yeniden bağla.";
    case 400:
      return `Site değeri kabul etmedi (${FIELD_LABEL[failure.field ?? ""] ?? failure.field ?? "geçersiz alan"}); ${consequence}.`;
    case 401:
      return `Site isteği reddetti (imza: iki projedeki KARAOKE_SYNC_SECRET aynı mı, sunucu saatleri doğru mu?); ${consequence}.`;
    case 413:
      return `Site isteği çok büyük buldu; ${consequence}.`;
    case 503:
      return `Sitede bağlantı kapalı ya da veritabanı okunamadı; ${consequence}. Tekrar dene.`;
    default:
      return `${SITE_UNREACHABLE} (HTTP ${failure.status}); ${consequence}. Tekrar dene.`;
  }
}

/** Sitenin okuma ucundan gelen hata (çekme) */
export function pullFailureMessage(failure: PushFailure): string {
  if (failure.kind === "off") return "Site bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)";
  if (failure.kind === "timeout") return "Site 8 saniyede yanıt vermedi";
  if (failure.kind === "network") return SITE_UNREACHABLE;
  if (failure.status === 401) return "Site isteği reddetti (imza): iki projedeki KARAOKE_SYNC_SECRET aynı mı, sunucu saatleri doğru mu?";
  if (failure.status === 503) return "Sitede KARAOKE_SYNC_SECRET tanımlı değil ya da sitenin veritabanı okunamadı";
  if (failure.status === 404) return "Sitede panel menü ucu yok (laffogato.net güncel değil)";
  return `Site yanıt vermedi (HTTP ${failure.status})`;
}

/** Fiyat siteye yazılınca kullanıcıya hatırlatılan iki elle iş */
export const PRICE_PUSH_REMINDER =
  "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma; kasadaki (ModPOS) fiyat Fiyatlar › Kasaya işle listesinde.";
