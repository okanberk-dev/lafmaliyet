"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { sendPush } from "@/server/push/send";
import { isPushEndpoint } from "@/server/push/webpush";

import { attempt, UserError } from "./util";

// Bu cihazın bildirim aboneliği. Abonelik tarayıcı profiline bağlıdır: aynı tarayıcıda başka biri giriş yaparsa
// abonelik ona geçer; çıkışta silinir. Oturum sürümüyle saklanır (src/server/push/send.ts).

const zKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_-]+=*$/, "Geçersiz anahtar");

const subscriptionSchema = z.object({
  endpoint: z.string().trim().max(1024).refine(isPushEndpoint, "Bu tarayıcının bildirim servisi tanınmadı"),
  keys: z.object({ p256dh: zKey, auth: zKey }),
  label: z.string().trim().max(80).nullish(),
});

/** Abonelik kaydı (açılışta da çağrılır: aynı adres güncellenir, kişi ve oturum sürümü tazelenir) */
export async function savePushSubscription(input: z.input<typeof subscriptionSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = subscriptionSchema.parse(input);
    const db = getDb();
    const [u] = await db.select({ sessionVersion: s.users.sessionVersion }).from(s.users).where(eq(s.users.id, me.id)).limit(1);
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    const values = {
      userId: me.id,
      endpoint: data.endpoint,
      p256dh: data.keys.p256dh.replace(/=+$/, ""),
      auth: data.keys.auth.replace(/=+$/, ""),
      label: data.label || null,
      sessionVersion: u.sessionVersion,
      failures: 0,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(s.pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: s.pushSubscriptions.endpoint, set: values })
      .returning({ karaoke: s.pushSubscriptions.karaoke, reminders: s.pushSubscriptions.reminders, orders: s.pushSubscriptions.orders, approvals: s.pushSubscriptions.approvals });
    // Sipariş bildirimi seçilmemişse role göre: barın personel cihazında açık, yöneticininkinde kapalı
    return { karaoke: row.karaoke, reminders: row.reminders, orders: row.orders ?? me.role === "staff", approvals: row.approvals };
  });
}

/** Bu cihazda bildirimleri kapatır ya da çıkışta aboneliği siler */
export async function deletePushSubscription(endpoint: string) {
  return attempt(async () => {
    const me = await requireUser();
    const e = z.string().max(1024).parse(endpoint);
    await getDb()
      .delete(s.pushSubscriptions)
      .where(and(eq(s.pushSubscriptions.endpoint, e), eq(s.pushSubscriptions.userId, me.id)));
    return null;
  });
}

/** Bu cihazda hangi bildirimler gelsin (sipariş ya da onay verilmezse dokunulmaz) */
export async function setPushTopics(endpoint: string, topics: { karaoke: boolean; reminders: boolean; orders?: boolean; approvals?: boolean }) {
  return attempt(async () => {
    const me = await requireUser();
    const e = z.string().max(1024).parse(endpoint);
    const t = z.object({ karaoke: z.boolean(), reminders: z.boolean(), orders: z.boolean().optional(), approvals: z.boolean().optional() }).parse(topics);
    const [row] = await getDb()
      .update(s.pushSubscriptions)
      .set({ ...t, updatedAt: new Date() })
      .where(and(eq(s.pushSubscriptions.endpoint, e), eq(s.pushSubscriptions.userId, me.id)))
      .returning({ id: s.pushSubscriptions.id });
    if (!row) throw new UserError("Bu cihaz bildirimlere kayıtlı değil; önce bildirimleri açın");
    return null;
  });
}

/** Kişinin kendi cihazlarına deneme bildirimi */
export async function sendTestPush() {
  return attempt(async () => {
    const me = await requireUser();
    const r = await sendPush(
      "test",
      { kind: "test", title: "Deneme bildirimi", body: "Bildirimler bu cihazda çalışıyor.", url: "/panel/karaoke", tag: "laf-test", ring: true },
      { userIds: [me.id], ttl: 300 },
    );
    if (!r.sent) throw new UserError(r.failed ? "Bildirim gönderilemedi; birazdan yeniden deneyin" : "Kayıtlı cihaz yok; önce bu cihazda bildirimleri açın");
    return r;
  });
}
