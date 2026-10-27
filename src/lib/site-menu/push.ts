import { money, tl } from "@/lib/format";

import { SITE_ACTOR_MAX, SITE_MONEY_MAX_MINOR, type SiteMenuItem } from "./schema";
import { fromMinor, panelIsActive, slotField, slotPriceMinor, toMinor, type SiteMenuSlot, type Visibility } from "./slot";

/**
 * Panel → site yazımı (saf kısım). Bağlı bir ürünün fiyatı ya da menü durumu panelde değişince panel önce sitenin
 * yazma ucuna gider, site 2xx verince kendisi yazar; site ulaşılamazsa ya da reddederse değişiklik kaydedilmez
 * (iki yer hiçbir an ayrışmaz). Gövde: {"id","priceMinor"|"priceMinorL","isActive","actor","expect"?}; olmayan alana
 * dokunulmaz, site fazla alanı reddeder.
 *
 * `expect` (docs/planlar/senkron.md §3.1 › Çakışma, P1): yazılan her alanın sitede yazımdan önce taşıması beklenen
 * değeri, panelin site kopyasından. Site değeri tutmazsa yazmaz, 409 `stale` ve güncel kalemle döner: panel başkasının
 * sitede az önce yaptığı değişikliği ezmez. Yalnız site GET yanıtında `writes.expect` duyurduysa gönderilir (eski site
 * bilinmeyen alanı 400 ile reddederdi); site yine de 400 `field: "body"` (katı şemanın yolsuz hatası) ya da
 * `field: "expect"` derse bir kez `expect`'siz denenir.
 */

export interface SaleState extends Visibility {
  /** TL, KDV dahil */
  price: number;
}

/** Sitenin yazımdan önce taşıması beklenen değerler: yalnız gövdede yazılan alanlar */
export interface PushExpect {
  priceMinor?: number;
  priceMinorL?: number;
  isActive?: boolean;
}

export interface PushBody {
  id: string;
  priceMinor?: number;
  priceMinorL?: number;
  isActive?: boolean;
  actor: string;
  expect?: PushExpect;
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

/** Gövde, sözleşmedeki sırayla (id, fiyat, durum, actor, expect); boş `expect` gönderilmez */
export function buildPushBody(input: { id: string; slot: SiteMenuSlot; priceMinor?: number; isActive?: boolean; actor: string; expect?: PushExpect }): PushBody {
  const body: PushBody = { id: input.id } as PushBody;
  if (input.priceMinor !== undefined) body[slotField(input.slot)] = input.priceMinor;
  if (input.isActive !== undefined) body.isActive = input.isActive;
  body.actor = pushActor(input.actor);
  const expect: PushExpect = {};
  if (input.expect?.priceMinor !== undefined) expect.priceMinor = input.expect.priceMinor;
  if (input.expect?.priceMinorL !== undefined) expect.priceMinorL = input.expect.priceMinorL;
  if (input.expect?.isActive !== undefined) expect.isActive = input.expect.isActive;
  if (Object.keys(expect).length) body.expect = expect;
  return body;
}

/** Aynı gövde `expect`'siz (site alanı tanımadı: bir kez yeniden deneme) */
export function withoutExpect(body: PushBody): PushBody {
  const rest = { ...body };
  delete rest.expect;
  return rest;
}

export const BROKEN_LINK_ERROR =
  "Bu ürünün site bağlantısı kopuk: kalemin sitede L fiyatı yok. Önce bağlantıyı kaldır ya da ürünü kalemin M (tek) fiyatına bağla.";

/**
 * Değişikliğin siteye gidip gitmeyeceği ve gövdesi. `siteItem`: son çekmedeki kalem (ya da çağıranın az önce okuduğu
 * canlı kalem); L yuvası ve kalem tek boysa bağlantı kopuktur, fiyat ya da durum gönderilmez (gönderilseydi sitede L
 * boyu yeniden açılırdı). `expect`: site `writes.expect` duyurdu; yazılan alanların `siteItem`'daki değeri beklenen
 * değer olarak gönderilir (kalem kopyada yoksa `expect` yok).
 */
export function planPush(input: {
  link: { siteMenuId: string; slot: SiteMenuSlot } | null;
  before: SaleState;
  after: SaleState;
  actor: string;
  siteItem?: Pick<SiteMenuItem, "priceMinor" | "priceMinorL" | "isActive"> | null;
  expect?: boolean;
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
  const item = input.expect ? (input.siteItem ?? null) : null;
  const expected = item ? slotPriceMinor(item, link.slot) : null;
  return {
    kind: "push",
    body: buildPushBody({
      id: link.siteMenuId,
      slot: link.slot,
      priceMinor: priceChanged ? priceMinor : undefined,
      isActive: visibilityChanged ? panelIsActive(after) : undefined,
      actor: input.actor,
      expect: item
        ? {
            ...(priceChanged && expected !== null ? { [slotField(link.slot)]: expected } : {}),
            ...(visibilityChanged ? { isActive: item.isActive } : {}),
          }
        : undefined,
    }),
    price: priceChanged,
    visibility: visibilityChanged,
  };
}

/**
 * Yazımın neden olmadığı: ağ, zaman aşımı ya da sitenin HTTP yanıtı (400'de bozuk alan; `error` sitenin hata kodu:
 * 409'da `stale` / `single_size`, 404'te `not_found`; gövde JSON değilse null)
 */
export type PushFailure =
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "off" }
  | { kind: "http"; status: number; field?: string | null; error?: string | null };

const FIELD_LABEL: Record<string, string> = {
  priceMinor: "M fiyatı 0'dan büyük, kuruşu tam ve sitenin üst sınırının altında olmalı",
  priceMinorL: "L fiyatı kuruşu tam ve sitenin üst sınırının altında olmalı",
  isActive: "menü durumu",
  actor: "kullanıcı adı",
  id: "kalem kimliği",
  fields: "gönderilecek değişiklik yok",
  body: "istek gövdesi",
  expect: "beklenen değer",
};

export const SITE_UNREACHABLE = "Siteye ulaşılamadı";

/**
 * Yazım olmayınca kullanıcıya gösterilen metin. `consequence` panelde ne olmadığı: "fiyat değişmedi",
 * "değişiklikler kaydedilmedi". Kalem sitede yoksa (404 `not_found`) sözleşmedeki sabit metin; gövdesi JSON olmayan 404
 * uç yok demektir (site güncel değil). Zaman aşımında istek siteye varmış olabilir: site yazmış, yanıt yolda kalmış
 * olabilir (panel yanıttan sonra siteyi yeniden okur, src/server/site-menu/push.ts).
 */
export function pushFailureMessage(failure: PushFailure, consequence = "fiyat değişmedi"): string {
  if (failure.kind === "off") {
    return `Site bağlantısı kurulmamış (KARAOKE_SYNC_SECRET); siteye bağlı ürünün fiyatı ve menü durumu değiştirilemez, ${consequence}. Bağlantıyı kaldır ya da anahtarı ekle.`;
  }
  if (failure.kind === "network") return `${SITE_UNREACHABLE}; ${consequence}. Tekrar dene.`;
  if (failure.kind === "timeout") return `${SITE_UNREACHABLE}; değişiklik sitede yapılmış olabilir, panelde ${consequence}. Site menüsünde kontrol et; panel siteyi hemen yeniden okuyor.`;
  switch (failure.status) {
    case 404:
      if (failure.error === undefined || failure.error === "not_found") return "Bu ürünün bağlı olduğu kalem sitede yok; bağlantıyı kaldır ya da yeniden bağla.";
      return `Sitede panel menü ucu yok (laffogato.net güncel değil); ${consequence}.`;
    case 409:
      if (failure.error === "stale") return staleMessage(consequence, { reloaded: false, sitePrice: null });
      // Sitenin `single_size`'ı: kalem sitede tek boy (L fiyatı 0), L'ye bağlı ürün gönderdi. Panelin kopyası eskiyken
      // olur (planPush kopyada tek boyu görse göndermezdi); tekrar denemek işe yaramaz
      return `Bu ürünün site bağlantısı kopuk: kalemin sitede L fiyatı yok; ${consequence}. Bağlantıyı kaldır ya da ürünü kalemin M (tek) fiyatına bağla.`;
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

/** Hata sitenin 409 `stale`'i mi (pushSaleChange UserError'ın `cause`'una koyar): eylem sayfayı yeniler */
export function isStaleFailure(e: unknown): boolean {
  const c = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  return !!c && typeof c === "object" && (c as { status?: unknown }).status === 409 && (c as { error?: unknown }).error === "stale";
}

/**
 * Site 409 `stale` dedi: yazılan alan sitede panelin kopyasındakinden farklı (sahip sitede ya da başka bir yerde az önce
 * değiştirdi). Hiçbir şey yazılmadı. `reloaded`: panel sitenin güncel menüsünü hemen okudu (kart yenilenince güncel
 * değer görünür); değilse yanıttan sonra okuyor. `sitePrice`: fiyat yazılıyorsa sitenin yuvadaki şimdiki fiyatı (kuruş).
 */
export function staleMessage(consequence: string, opts: { reloaded: boolean; sitePrice: number | null }): string {
  const now = opts.sitePrice !== null && opts.sitePrice > 0 ? ` (sitede şimdi ${money(fromMinor(opts.sitePrice))})` : "";
  return `Bu ürün sitede bu arada değişti${now}; ${consequence}. ${
    opts.reloaded ? "Sitenin güncel değeri panele yüklendi: bakıp yeniden dene." : "Panel siteyi yeniden okuyor: birazdan bakıp yeniden dene."
  }`;
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
