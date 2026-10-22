import { pushActor } from "@/lib/site-menu/push";

import { parseSiteOrder, type OrderStage, type SiteOrder } from "./schema";
import type { StageAction, StageFailure } from "./stage";

/**
 * Sitenin aşama ucuyla konuşma (saf; sunucu eylemi ve testler paylaşır): isteğin gövdesi ve yanıtın anlamı. Kurallar
 * ve metinler `stage.ts`'te. Sözleşme sitenin docs/PANEL-ORDERS.md'si; panel tarafı docs/SITE-SIPARIS.md.
 *
 * KVKK: gövde yalnız {"id","action","from","actor"}; müşteriye ya da satırlara dair hiçbir şey gitmez. `actor` panel
 * kullanıcısının görünen adıdır (sitenin olay kaydında `panel:<ad>`), müşterinin değil.
 */

/** Sitenin kabul ettiği en büyük gövde (bayt) */
export const STAGE_BODY_MAX_BYTES = 1024;

export interface StageBody {
  id: string;
  action: StageAction;
  from: OrderStage;
  actor: string;
}

/**
 * Gövde, sözleşmedeki sırayla ve yalnız bu dört alanla (site bilinmeyen alanı reddeder; çağıran fazlasını verse de
 * gitmez). `actor`: boşluklar sadeleşir, en çok 80 karakter, boşsa "Panel" (menü yazımıyla aynı kural).
 */
export function buildStageBody(input: { id: string; action: StageAction; from: OrderStage; actor: string | null | undefined }): StageBody {
  return { id: input.id, action: input.action, from: input.from, actor: pushActor(input.actor) };
}

/** Sitenin yanıtı ne diyor */
export type StageAnswer =
  /** Sipariş ilerledi; `order` yeni hâli, null: bar ekranından çıktı (masaya / kuryeye gitti, teslim edildi) */
  | { kind: "moved"; order: SiteOrder | null }
  /** Sipariş arada değişmiş ya da işlem şimdiki aşamasından yapılamıyor; `now`: şimdiki aşaması, "gone": ekrandan çıkmış, null: okunamadı */
  | { kind: "stale"; now: OrderStage | "gone" | null }
  /** Site 2xx verdi ama yanıt sözleşmedeki gibi değil: ilerlemiş olabilir, liste yeniden çekilmeli */
  | { kind: "unreadable" }
  | { kind: "failed"; failure: StageFailure };

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const shortText = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 40) : null);

/**
 * Sitenin yanıtı (`json`: gövde JSON değilse null). 2xx: `{ order }` (null = ekrandan çıktı); sipariş okuma ucunun
 * listesindeki biçimde doğrulanır ve kimliği istenenle aynı olmalı. 409: `{ error: "stale", order }`. Öteki her durum
 * hatadır (`error` ve `field` kısaltılarak taşınır).
 */
export function readStageAnswer(res: { status: number; json: unknown }, id: string): StageAnswer {
  const body = asObject(res.json);
  if (res.status >= 200 && res.status < 300) {
    if (!body || !("order" in body)) return { kind: "unreadable" };
    if (body.order === null) return { kind: "moved", order: null };
    const order = parseSiteOrder(body.order);
    return order && order.id === id ? { kind: "moved", order } : { kind: "unreadable" };
  }
  if (res.status === 409) {
    if (!body || !("order" in body)) return { kind: "stale", now: null };
    if (body.order === null) return { kind: "stale", now: "gone" };
    const order = parseSiteOrder(body.order);
    return { kind: "stale", now: order && order.id === id ? order.stage : null };
  }
  return { kind: "failed", failure: { kind: "http", status: res.status, error: shortText(body?.error), field: shortText(body?.field) } };
}
