"use server";

import { z } from "zod";

import { SITE_ORDER_ID } from "@/lib/site-orders/schema";
import { canAdvance, STAGE_PATH, staleMessage, stageDoneMessage, stageFailureMessage, UNREADABLE_MESSAGE } from "@/lib/site-orders/stage";
import { buildStageBody, readStageAnswer } from "@/lib/site-orders/stage-request";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { assertStaffFeature } from "@/server/branch-features";
import { siteLinkSecret } from "@/server/site-link";
import { callSite, SiteRequestError } from "@/server/site-menu/sync";
import { readOrdersSnapshot, syncSiteOrders } from "@/server/site-orders/sync";

import { attempt, UserError } from "./util";

// Bar ekranından sipariş aşaması (docs/SITE-SIPARIS.md): personel ve yönetici. Panel siparişi kendisi değiştirmez;
// sitenin imzalı aşama ucuna gider (POST /api/panel/orders/stage), ödeme, stok, sadakat, e-posta ve bildirim sitede
// kalır. Site kabul edince (ya da sipariş arada değiştiyse) son liste siteden yeniden çekilir: son listenin kopyasını
// yalnız çekme yazar, ekran yeni hâli canlı uçtan alır.
//
// KVKK: siteye yalnız kimlik, işlem, panelin gördüğü aşama ve panel kullanıcısının adı gider; müşterinin adı ve
// satırlar ne günlüğe ne işlem geçmişine yazılır. Kaydı sitenin olay kaydı tutar (`panel:<ad>`); barın her dokunuşu
// panelin işlem geçmişini doldurmasın diye burada ayrıca yazılmaz (karaoke "Bitir" gibi).

const zStage = z
  .object({
    id: z.string().regex(SITE_ORDER_ID, "Geçersiz sipariş"),
    action: z.enum(["preparing", "ready", "delivered"], { message: "Geçersiz işlem" }),
    /** Panelin son gördüğü aşama: arada değiştiyse site 409 verir */
    from: z.enum(["new", "preparing", "ready"], { message: "Geçersiz aşama" }),
  })
  .refine((d) => canAdvance(d.action, d.from), { message: "Bu işlem siparişin aşamasından yapılamaz; ekranı yenileyin" });

export interface StageResult {
  /** "#10234 hazır" */
  message: string;
  /** Liste yeniden çekilemediyse açıklama (ekran sitenin bildirimiyle birazdan güncellenir); yoksa null */
  note: string | null;
}

/** Son listeyi siteden yeniden çeker; başarısızsa false (sitedeki işlem yapılmıştır, bu onu bozmaz) */
async function resync(): Promise<boolean> {
  try {
    return (await syncSiteOrders("manual")).status !== "error";
  } catch (e) {
    console.error("[siparis] aşamadan sonra çekme", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Tek dokunuş: "Hazırlanıyor", hazır (gel-al "Hazır", masa "Masaya götürüldü", kurye "Kuryeye verildi") ya da "Teslim
 * edildi". Onay sorulmaz; `from` sayesinde aynı dokunuş iki kez uygulanmaz (site 409 verir, ekran yenilenir).
 */
export async function advanceSiteOrder(input: z.input<typeof zStage>) {
  return attempt<StageResult>(async () => {
    const me = adminActor(await requireCan("kayit.yaz"));
    // Şube özelliği (docs/SUBE.md › Şube özellikleri): uygulama siparişi kapalı şubeye kilitli personel çağıramaz
    await assertStaffFeature(me, "siparis");
    const data = zStage.parse(input);
    const secret = siteLinkSecret();
    // Kurulum ayrıntısı (anahtar adı, imza, sitenin sürümü) yalnız yöneticiye; personel sabit metni görür (E-64)
    if (!secret) throw new UserError(stageFailureMessage({ kind: "off" }, me.role));
    // Numara ve teslim biçimi son listenin kopyasından (istemcinin gönderdiğine güvenilmez)
    const known = (await readOrdersSnapshot()).orders.find((o) => o.id === data.id) ?? null;
    if (known && !canAdvance(data.action, data.from, known.fulfillment)) {
      throw new UserError("Teslim edildi yalnız gel-al siparişinde işaretlenir; ekranı yenileyin");
    }
    let res: Awaited<ReturnType<typeof callSite>>;
    try {
      res = await callSite(secret, STAGE_PATH, { method: "POST", body: JSON.stringify(buildStageBody({ ...data, actor: me.name })) });
    } catch (e) {
      if (e instanceof SiteRequestError) throw new UserError(stageFailureMessage(e.failure, me.role));
      throw e;
    }
    const answer = readStageAnswer(res, data.id);
    if (answer.kind === "failed") {
      const { failure } = answer;
      // Günlüğe yalnız kimlik, işlem ve sitenin hata kodu
      console.error("[siparis] aşama", data.id, data.action, res.status, failure.kind === "http" ? (failure.error ?? "") : "");
      // Sipariş sitede artık bar ekranında değil: ekrandan da kalksın
      if (failure.kind === "http" && failure.status === 404 && failure.error) await resync();
      throw new UserError(stageFailureMessage(failure, me.role));
    }
    const synced = await resync();
    if (answer.kind === "stale") throw new UserError(staleMessage(answer.now));
    if (answer.kind === "unreadable") throw new UserError(UNREADABLE_MESSAGE);
    return {
      message: stageDoneMessage(known?.orderNo ?? answer.order?.orderNo, data.action, known?.fulfillment ?? answer.order?.fulfillment),
      note: synced ? null : "Ekran sitenin bildirimiyle birazdan güncellenir.",
    };
  });
}
