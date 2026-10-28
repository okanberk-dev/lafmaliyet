import type { Role } from "@/lib/constants";
import { staffSiteText } from "@/lib/staff-errors";

import { STAGE_LABEL } from "./feed";
import type { OrderFulfillment, OrderStage, SiteOrder } from "./schema";

/**
 * Bar ekranından tek dokunuşla sipariş aşaması: kurallar ve metinler (saf; sunucu eylemi, ekran ve testler paylaşır).
 * Panel siparişi kendisi değiştirmez: sitenin imzalı aşama ucuna (`POST /api/panel/orders/stage`) gider; ödeme, stok,
 * sadakat, e-posta ve bildirim sitenin kendi durum makinesinde kalır. Sözleşme sitenin docs/PANEL-ORDERS.md'si, panel
 * tarafı docs/SITE-SIPARIS.md. İsteğin gövdesi ve sitenin yanıtı `stage-request.ts`'te (zod'a dayanır; bu dosya
 * ekranın paketine girdiği için ondan bağımsız kalır).
 *
 * `from` panelin son gördüğü aşamadır (iyimser eşzamanlılık): sipariş arada ilerlediyse site 409 verir ve aynı
 * dokunuş iki kez uygulanmaz; bu yüzden ağ hatasından sonra yeniden denemek güvenlidir.
 */

/** Sitenin aşama ucu */
export const STAGE_PATH = "/api/panel/orders/stage";

export type StageAction = "preparing" | "ready" | "delivered";
export const STAGE_ACTIONS: readonly StageAction[] = ["preparing", "ready", "delivered"];

/**
 * Her işlemin izin verilen başlangıç aşamaları (sitenin kuralıyla aynı): "Hazırlanıyor" yalnız yeniden; hazır (gel-al
 * "Hazır", masa "Masaya götürüldü", kurye "Kuryeye verildi") yeniden de tek dokunuşla; "Teslim edildi" yalnız tezgâhta
 * bekleyen gel-al'da.
 */
export const STAGE_FROM: Record<StageAction, readonly OrderStage[]> = {
  preparing: ["new"],
  ready: ["new", "preparing"],
  delivered: ["ready"],
};

/** İşlem bu aşamadan (ve biliniyorsa bu teslim biçiminde) yapılabilir mi */
export function canAdvance(action: StageAction, from: OrderStage, fulfillment?: OrderFulfillment | null): boolean {
  if (!STAGE_FROM[action]?.includes(from)) return false;
  return action !== "delivered" || !fulfillment || fulfillment === "pickup";
}

/** Hazır düğmesinin adı teslim biçimine göre: gel-al tezgâhta hazır, masa siparişi masaya, kurye siparişi kuryeye */
export const READY_LABEL: Record<OrderFulfillment, string> = { pickup: "Hazır", table: "Masaya götürüldü", delivery: "Kuryeye verildi" };

export interface StageButton {
  action: StageAction;
  label: string;
  /** Kartın birincil (siyah) düğmesi; değilse ikincil (beyaz) */
  primary: boolean;
}

/**
 * Kartın düğmeleri: yeni siparişte "Hazırlanıyor" (ikincil) ve hazır düğmesi (birincil); hazırlanırken yalnız hazır;
 * tezgâhta bekleyen gel-al'da "Teslim edildi". Masa ve kurye siparişi hazır olunca ekrandan kalkar, düğmesi yoktur.
 */
export function stageButtons(order: Pick<SiteOrder, "stage" | "fulfillment">): StageButton[] {
  const ready: StageButton = { action: "ready", label: READY_LABEL[order.fulfillment], primary: true };
  switch (order.stage) {
    case "new":
      return [{ action: "preparing", label: "Hazırlanıyor", primary: false }, ready];
    case "preparing":
      return [ready];
    case "ready":
      return order.fulfillment === "pickup" ? [{ action: "delivered", label: "Teslim edildi", primary: true }] : [];
    default:
      return [];
  }
}

/** "#10234"; numara bilinmiyorsa "Sipariş" */
export function orderRef(orderNo: number | null | undefined): string {
  return orderNo ? `#${orderNo}` : "Sipariş";
}

/** Başarı bildirimi: "#10234 hazırlanıyor", "#10234 hazır", "#10234 masaya götürüldü", "#10234 kuryeye verildi", "#10234 teslim edildi" */
export function stageDoneMessage(orderNo: number | null | undefined, action: StageAction, fulfillment?: OrderFulfillment | null): string {
  const ref = orderRef(orderNo);
  if (action === "preparing") return `${ref} hazırlanıyor`;
  if (action === "delivered") return `${ref} teslim edildi`;
  return `${ref} ${READY_LABEL[fulfillment ?? "pickup"].toLocaleLowerCase("tr-TR")}`;
}

/** İşlemin neden olmadığı: bağlantı kapalı, ağ, zaman aşımı ya da sitenin HTTP yanıtı (`error`, 400'de `field`) */
export type StageFailure =
  | { kind: "off" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "http"; status: number; error?: string | null; field?: string | null };

export const STAGE_OFF_ERROR = "laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)";

/** 409: sipariş arada değişti (`now`: şimdiki aşaması, "gone": ekrandan çıkmış, null: bilinmiyor); liste yeniden çekildikten sonra */
export function staleMessage(now: OrderStage | "gone" | null): string {
  if (now === "gone") return "Sipariş bu arada değişti (artık bar ekranında değil); ekran yenilendi.";
  if (now) return `Sipariş bu arada değişti (şimdi: ${STAGE_LABEL[now]}); ekran yenilendi.`;
  return "Sipariş bu arada değişti; ekran yenilendi.";
}

/** 2xx ama yanıt okunamadı: işlem büyük olasılıkla yapıldı, liste yeniden çekildi */
export const UNREADABLE_MESSAGE = "Sitenin yanıtı okunamadı; ekran yenilendi, kartın aşamasını kontrol edin.";

const FIELD_LABEL: Record<string, string> = {
  id: "sipariş kimliği",
  action: "işlem",
  from: "aşama",
  actor: "kullanıcı adı",
  body: "istek gövdesi",
};

/** Ağ hatasından sonra yeniden denemek güvenli: `from` aynı dokunuşun iki kez uygulanmasını önler */
const RETRY = "tekrar deneyin (sipariş iki kez ilerlemez)";

/** Personelin sipariş aşamasında gördüğü kurulum hatası: anahtar adı, imza ve sitenin sürümü yalnız yöneticiye (E-64) */
export const STAGE_STAFF_ERROR = staffSiteText("sipariş ilerletilmedi");

/**
 * Hata bağlantının kurulumundan mı (anahtar yok ya da tutmuyor, site güncel değil, panel ile site uyumsuz): personel
 * bunu düzeltemez, yöneticiye haber verir. Ağ, zaman aşımı, "sipariş bu arada değişti" (409), "sipariş artık ekranda
 * değil" (JSON'lu 404) ve sitenin veritabanının kısa kesintisi (503 `unavailable`) değil: onlar yeniden denenir.
 */
export function isStageSetupFailure(failure: StageFailure): boolean {
  if (failure.kind === "off") return true;
  if (failure.kind !== "http") return false;
  if (failure.status === 409) return false;
  if (failure.status === 404) return !failure.error;
  if (failure.status === 503) return failure.error !== "unavailable";
  return true;
}

/**
 * İşlem olmayınca bar ekranında gösterilen metin. Personel (`role` "staff") kurulum hatasında sabit metni görür
 * (STAGE_STAFF_ERROR); yönetici ayrıntıyı.
 */
export function stageFailureMessage(failure: StageFailure, role: Role = "admin"): string {
  if (role !== "admin" && isStageSetupFailure(failure)) return STAGE_STAFF_ERROR;
  if (failure.kind === "off") return STAGE_OFF_ERROR;
  if (failure.kind === "timeout") return `Site 8 saniyede yanıt vermedi; ${RETRY}.`;
  if (failure.kind === "network") return `Siteye ulaşılamadı; ${RETRY}.`;
  switch (failure.status) {
    case 400:
      return `Site isteği kabul etmedi (${FIELD_LABEL[failure.field ?? ""] ?? failure.field ?? "geçersiz alan"}); panel güncel olmayabilir.`;
    case 401:
      return "İmza reddedildi: iki projedeki KARAOKE_SYNC_SECRET aynı mı, sunucu saatleri doğru mu?";
    case 404:
      // Uç varsa site JSON ve `error` döner; yoksa (site güncel değil) Next'in 404 sayfası gelir
      return failure.error ? "Sipariş sitede bulunamadı ya da artık bar ekranında değil" : "Sitede sipariş ilerletme ucu yok (laffogato.net güncel değil)";
    case 409:
      return staleMessage(null);
    case 413:
      return "Site isteği çok büyük buldu; sipariş ilerletilmedi.";
    case 503:
      return failure.error === "not_configured"
        ? "Sitede KARAOKE_SYNC_SECRET tanımlı değil; sipariş ilerletilmedi."
        : `Sitenin veritabanı şu an okunamıyor; ${RETRY}.`;
    default:
      return `Site yanıt vermedi (HTTP ${failure.status}); ${RETRY}.`;
  }
}
