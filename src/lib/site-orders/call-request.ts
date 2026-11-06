import { pushActor } from "@/lib/site-menu/push";

import type { StageFailure } from "./stage";

/**
 * Sitenin "Gördüm" ucuyla konuşma (saf; sunucu eylemi ve testler paylaşır): isteğin gövdesi ve yanıtın anlamı. Uç
 * `POST /api/panel/calls/ack` (calls.ts › CALL_ACK_PATH), imza aşama ucuyla aynı (`callSite`). Sözleşme sitenin
 * docs/PANEL-ORDERS.md'si; panel tarafı docs/SITE-SIPARIS.md.
 *
 * KVKK: gövde yalnız {"id","actor"}; `actor` panel kullanıcısının görünen adı (aşama ucundaki kural), müşterinin değil.
 */

/** Sitenin kabul ettiği en büyük gövde (bayt; aşama ucuyla aynı sınır) */
export const CALL_ACK_BODY_MAX_BYTES = 1024;

export interface CallAckBody {
  id: string;
  actor: string;
}

/**
 * Gövde, sözleşmedeki sırayla ve yalnız bu iki alanla (site bilinmeyen alanı reddeder; çağıran fazlasını verse de
 * gitmez). `actor`: boşluklar sadeleşir, en çok 80 karakter, boşsa "Panel".
 */
export function buildCallAckBody(input: { id: string; actor: string | null | undefined }): CallAckBody {
  return { id: input.id, actor: pushActor(input.actor) };
}

/** Sitenin yanıtı ne diyor */
export type CallAckAnswer =
  /** Çağrı görüldü (ilk kez ya da zaten görülmüştü: uç tekrarı aynı yanıtla karşılar) */
  | { kind: "acked" }
  /** 404 `not_found`: çağrı sitede artık yok (süresi doldu ya da kapandı); liste yeniden çekilir */
  | { kind: "gone" }
  /** Site 2xx verdi ama yanıt sözleşmedeki gibi değil: görülmüş olabilir, liste yeniden çekilmeli */
  | { kind: "unreadable" }
  | { kind: "failed"; failure: StageFailure };

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const shortText = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 40) : null);

/**
 * Sitenin yanıtı (`json`: gövde JSON değilse null). 2xx: `{ ok: true, call: { id, status: "acked" } }` ve kimlik
 * istenenle aynı olmalı. 404 `{ error: "not_found" }`: çağrı yok. Öteki her durum hatadır (`error` kısaltılarak taşınır;
 * uç yoksa Next'in 404 sayfası gelir, `error` boş).
 */
export function readCallAckAnswer(res: { status: number; json: unknown }, id: string): CallAckAnswer {
  const body = asObject(res.json);
  if (res.status >= 200 && res.status < 300) {
    const call = asObject(body?.call);
    return body?.ok === true && call?.id === id && call.status === "acked" ? { kind: "acked" } : { kind: "unreadable" };
  }
  if (res.status === 404 && body?.error === "not_found") return { kind: "gone" };
  return { kind: "failed", failure: { kind: "http", status: res.status, error: shortText(body?.error), field: shortText(body?.field) } };
}
