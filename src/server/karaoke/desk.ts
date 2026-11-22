import "server-only";

import { deskCancelBody, deskCreateBody, deskFetchFailure, deskReply, type DeskData, type DeskOp, type DeskReply } from "@/lib/karaoke/desk";
import { fetchFailure } from "@/lib/karaoke/sync-text";
import { signedSiteFetch, siteLinkSecret, siteUrl } from "@/server/site-link";

import { syncKaraoke, type SyncResult } from "./sync";

/**
 * Elle karaoke rezervasyonu ve saati kapatma, sitenin tarafı (kurallar ve metinler src/lib/karaoke/desk.ts; docs/KARAOKE.md
 * › Elle rezervasyon ve saati kapatma). Panel satırı kendisi yazmaz: laffogato.net'in imzalı `POST /api/panel/karaoke`
 * ucuna gönderir (GET'le aynı imza, gövdenin tam metni üzerinden), site saatleri takvimine yazar ve sitede, uygulamada ve
 * kasada hemen dolu gösterir. Başarıdan sonra karaoke eşitlemesi hemen koşar: satır panelin kopyasına girer, karaoke
 * sürümü (canlı ucun ETag'i) artar, öteki cihazlar bir sonraki kontrolde ya da bildirimle görür (site de ayrıca ping
 * atar; iki eşitleme aynı kilitle sırayla yazar).
 *
 * Telefon ve e-posta yalnız sitenin gövdesindedir: panel onları saklamaz, günlüğe yazmaz (istek gövdesi hiçbir yerde
 * yazılmaz; hata günlüğüne yalnız durum kodu düşer).
 */

export type DeskOutcome =
  | { status: "off" }
  | { status: "done"; reply: Extract<DeskReply, { ok: true }>; sync: SyncResult }
  | { status: "refused"; reply: Extract<DeskReply, { ok: false }>; sync: SyncResult | null };

/** Sitenin gövdesi (JSON değilse null: ucu olmayan eski site HTML 404 döner) */
async function bodyOf(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Siteye gönderir ve yanıtı eşler; yazımdan sonra (ya da yazılıp yazılmadığı bilinmiyorsa) kopyayı eşitler */
async function send(op: DeskOp, body: string): Promise<DeskOutcome> {
  const secret = siteLinkSecret();
  if (!secret) return { status: "off" };
  const url = new URL("/api/panel/karaoke", siteUrl());
  let reply: DeskReply;
  try {
    const res = await signedSiteFetch(secret, url, { method: "POST", body });
    reply = deskReply(op, res.status, await bodyOf(res));
    if (!reply.ok) console.warn(`[karaoke] elle ${op === "create" ? "ekleme" : "kaldırma"}: site ${res.status} ${reply.code}`);
  } catch (e) {
    reply = deskFetchFailure(fetchFailure(e).kind, op);
  }
  // Yazıldıysa ya da yazılmış olabilirse (zaman aşımı) ya da satır sitede zaten kaldırılmışsa kopya hemen tazelenir
  const resync = reply.ok || (!reply.ok && (reply.uncertain || reply.code === "already_cancelled" || reply.code === "not_found"));
  let sync: SyncResult | null = null;
  if (resync) {
    try {
      sync = await syncKaraoke("manual");
    } catch (e) {
      console.error("[karaoke] elle işlemden sonra eşitleme", e instanceof Error ? e.message : e);
      sync = { status: "error", error: "Eşitleme yapılamadı" };
    }
  }
  if (reply.ok) return { status: "done", reply, sync: sync ?? { status: "fresh" } };
  return { status: "refused", reply, sync };
}

/** Telefonla / kasada gelen rezervasyon ya da kapatılan saatler: sitenin takvimine yazılır */
export function createDeskBooking(data: DeskData, actor: string): Promise<DeskOutcome> {
  return send("create", deskCreateBody(data, actor));
}

/** Elle satırı kaldırır (saatler sitede yeniden açılır); yalnız köşkte alınan satır (site öteki satırı 409 `not_desk` ile reddeder) */
export function cancelDeskBooking(externalId: string, actor: string): Promise<DeskOutcome> {
  return send("cancel", deskCancelBody(externalId, actor));
}
