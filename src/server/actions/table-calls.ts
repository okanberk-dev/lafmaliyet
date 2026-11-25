"use server";

import { z } from "zod";

import { callAckDoneMessage, callAckFailureMessage, callGoneMessage, CALL_ACK_PATH, CALL_UNREADABLE_MESSAGE } from "@/lib/site-orders/calls";
import { buildCallAckBody, readCallAckAnswer } from "@/lib/site-orders/call-request";
import { SITE_ORDER_ID } from "@/lib/site-orders/schema";
import { requireUser } from "@/server/auth/dal";
import { assertStaffFeature } from "@/server/branch-features";
import { siteLinkSecret } from "@/server/site-link";
import { callSite, SiteRequestError } from "@/server/site-menu/sync";
import { readOrdersSnapshot, syncSiteOrders } from "@/server/site-orders/sync";

import { attempt, UserError } from "./util";

// Masa çağrısında "Gördüm" (docs/SITE-SIPARIS.md › Masa çağrıları): personel ve yönetici. Panel çağrıyı kendisi
// kapatmaz; sitenin imzalı ucuna gider (POST /api/panel/calls/ack, aşama ucuyla aynı imza), ardından son liste siteden
// yeniden çekilir: son listenin kopyasını yalnız çekme yazar, ekran yeni hâli canlı uçtan alır.
//
// KVKK: siteye yalnız çağrının kimliği ve panel kullanıcısının adı gider. Barın her dokunuşu panelin işlem geçmişini
// doldurmasın diye burada ayrıca yazılmaz (aşama düğmeleri gibi); kaydı sitenin tuttuğu `actor`.

const zAck = z.object({ id: z.string().regex(SITE_ORDER_ID, "Geçersiz çağrı") });

export interface CallAckResult {
  /** "Masa 4 · görüldü" */
  message: string;
  /** Liste yeniden çekilemediyse açıklama; yoksa null */
  note: string | null;
}

/** Son listeyi siteden yeniden çeker; başarısızsa false (sitedeki işlem yapılmıştır, bu onu bozmaz) */
async function resync(): Promise<boolean> {
  try {
    return (await syncSiteOrders("manual")).status !== "error";
  } catch (e) {
    console.error("[siparis] çağrıdan sonra çekme", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Tek dokunuş, onay sorulmaz. Aynı çağrıyı iki kez işaretlemek güvenli (site aynı yanıtı verir); çağrı sitede artık
 * yoksa (süresi doldu, başka cihaz gördü) "zaten kapanmış" denir ve ekran yenilenir.
 */
export async function ackTableCall(input: z.input<typeof zAck>) {
  return attempt<CallAckResult>(async () => {
    const me = await requireUser();
    // Şube özelliği (docs/SUBE.md › Şube özellikleri): garson çağır kapalı şubeye kilitli personel çağıramaz
    await assertStaffFeature(me, "garson");
    const data = zAck.parse(input);
    const secret = siteLinkSecret();
    // Kurulum ayrıntısı (anahtar adı, imza, sitenin sürümü) yalnız yöneticiye; personel sabit metni görür (E-64)
    if (!secret) throw new UserError(callAckFailureMessage({ kind: "off" }, me.role));
    // Masanın adı son listenin kopyasından (istemcinin gönderdiğine güvenilmez)
    const label = (await readOrdersSnapshot()).calls.find((c) => c.id === data.id)?.label ?? null;
    let res: Awaited<ReturnType<typeof callSite>>;
    try {
      res = await callSite(secret, CALL_ACK_PATH, { method: "POST", body: JSON.stringify(buildCallAckBody({ id: data.id, actor: me.name })) });
    } catch (e) {
      if (e instanceof SiteRequestError) throw new UserError(callAckFailureMessage(e.failure, me.role));
      throw e;
    }
    const answer = readCallAckAnswer(res, data.id);
    if (answer.kind === "failed") {
      const { failure } = answer;
      // Günlüğe yalnız kimlik ve sitenin hata kodu
      console.error("[siparis] çağrı", data.id, res.status, failure.kind === "http" ? (failure.error ?? "") : "");
      // Sitenin ucu JSON'lu 404 verdi ('not_found' dışında bir kodla; denetim SB-06): çağrı sitede yok, metin "ekran
      // yenilendi" der ve liste gerçekten yeniden çekilir (aşama düğmesi gibi)
      if (failure.kind === "http" && failure.status === 404 && failure.error) await resync();
      throw new UserError(callAckFailureMessage(failure, me.role));
    }
    const synced = await resync();
    const note = synced ? null : "Ekran sitenin bildirimiyle birazdan güncellenir.";
    if (answer.kind === "gone") return { message: callGoneMessage(label), note: note ?? "Ekran yenilendi." };
    // 2xx ama yanıt sözleşmedeki gibi değil: büyük olasılıkla görüldü, liste yeniden çekildi
    if (answer.kind === "unreadable") throw new UserError(CALL_UNREADABLE_MESSAGE);
    return { message: callAckDoneMessage(label), note };
  });
}
