import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { appUrl } from "@/server/auth/tokens";
import { getDb, schema as s } from "@/server/db";
import { open, seal } from "@/server/secret-box";

import { encryptPayload, generateVapidKeys, isPushEndpoint, publicKeyOf, vapidAuthorization, type VapidKeys } from "./webpush";

/** Bildirimin içeriği (şifreli gider; service worker /sw.js gösterir) */
export interface PushMessage {
  kind: "karaoke" | "orders" | "reminders" | "approvals" | "shifts" | "test";
  title: string;
  body: string;
  /** Bildirime dokununca açılan panel adresi */
  url: string;
  /** Aynı etiketli bildirim öncekinin yerine geçer */
  tag: string;
  /** Kullanıcı kapatana kadar ekranda kalsın (yeni rezervasyon) */
  requireInteraction?: boolean;
  /** Açık sekme için: zil sesi çalınsın mı */
  ring?: boolean;
}

const KEY = "webpush_vapid";

/**
 * VAPID anahtarları: ortamda VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY varsa onlar; yoksa ilk kullanımda üretilip
 * veritabanında (özel anahtar AUTH_SECRET ile şifreli) saklanır, kurulum gerekmez. Eşzamanlı ilk iki istek farklı
 * anahtar üretse de yalnız ilk yazılan kalır.
 */
export async function getVapidKeys(): Promise<VapidKeys> {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) {
    if (publicKeyOf(envPrivate) !== envPublic) throw new Error("VAPID_PUBLIC_KEY ile VAPID_PRIVATE_KEY birbirini tutmuyor");
    return { publicKey: envPublic, privateKey: envPrivate };
  }
  const db = getDb();
  const read = async () => {
    const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, KEY)).limit(1);
    const v = row?.value as { publicKey?: string; privateKey?: string } | undefined;
    const privateKey = v?.privateKey ? open(v.privateKey, "webpush") : null;
    return v?.publicKey && privateKey ? { publicKey: v.publicKey, privateKey } : row ? "unreadable" : null;
  };
  const found = await read();
  if (found && found !== "unreadable") return found;
  const fresh = generateVapidKeys();
  const value = { publicKey: fresh.publicKey, privateKey: seal(fresh.privateKey, "webpush"), createdAt: new Date().toISOString() };
  if (found === "unreadable") {
    // AUTH_SECRET değişmiş: eski anahtar açılamıyor. Yenisi yazılır; cihazlar açılışta yeni anahtarla yeniden abone olur.
    await db.update(s.integrationState).set({ value, updatedAt: new Date() }).where(eq(s.integrationState.key, KEY));
    return fresh;
  }
  await db.insert(s.integrationState).values({ key: KEY, value }).onConflictDoNothing();
  const stored = await read();
  if (!stored || stored === "unreadable") throw new Error("Bildirim anahtarı kaydedilemedi");
  return stored;
}

/** Tarayıcının abone olurken kullandığı genel anahtar (applicationServerKey) */
export async function vapidPublicKey(): Promise<string | null> {
  try {
    return (await getVapidKeys()).publicKey;
  } catch (e) {
    console.error("[push] anahtar", (e as Error).message);
    return null;
  }
}

export interface PushResult {
  sent: number;
  removed: number;
  failed: number;
}

/**
 * Aboneliklere bildirim gönderir: yalnız aktif kullanıcılar ve aboneliği alırken geçerli olan oturum sürümü hâlâ
 * geçerliyse (parola, rol ya da erişim değişince eski cihaza gitmez). `topic` aboneliğin tercihine bakar (karaoke /
 * sipariş / hatırlatıcı / onay; sipariş tercihi seçilmemişse personel cihazında açık, yöneticininkinde kapalı); "test"
 * herkese değil yalnız `userIds`'e gider. "approvals" (docs/ONAYLAR.md): yöneticiye personelin yeni açtığı istek
 * (src/server/staff-requests/push.ts); metinde tutar yok, etiket `istek-<id>`. "shifts" (docs/VARDIYA.md › Bildirimler):
 * kişiye özel, yalnız `userIds`'e (vardiyası değişen kişi, planı yazılmamış haftada yöneticiler); cihaz tercihi yok,
 * bildirim açık her cihazına gider. Süresi geçmiş abonelik (404/410) silinir; art arda 10 kez başarısız olan da. Hata
 * fırlatmaz, sonucu sayar.
 */
export async function sendPush(
  topic: "karaoke" | "orders" | "reminders" | "approvals" | "shifts" | "test",
  message: PushMessage,
  opts: { userIds?: number[]; ttl?: number; urgency?: "high" | "normal" } = {},
): Promise<PushResult> {
  const result: PushResult = { sent: 0, removed: 0, failed: 0 };
  if (opts.userIds && !opts.userIds.length) return result;
  // Vardiya bildirimi kişiye özeldir: alıcısız çağrı herkese gitmesin
  if (topic === "shifts" && !opts.userIds) return result;
  const db = getDb();
  const conditions = [eq(s.users.active, true), eq(s.users.sessionVersion, s.pushSubscriptions.sessionVersion)];
  if (topic === "karaoke") conditions.push(eq(s.pushSubscriptions.karaoke, true));
  if (topic === "orders") conditions.push(sql`coalesce(${s.pushSubscriptions.orders}, ${s.users.role} = 'staff')`);
  if (topic === "reminders") conditions.push(eq(s.pushSubscriptions.reminders, true));
  if (topic === "approvals") conditions.push(eq(s.pushSubscriptions.approvals, true));
  if (opts.userIds) conditions.push(inArray(s.pushSubscriptions.userId, opts.userIds));
  const subs = await db
    .select({ id: s.pushSubscriptions.id, endpoint: s.pushSubscriptions.endpoint, p256dh: s.pushSubscriptions.p256dh, auth: s.pushSubscriptions.auth })
    .from(s.pushSubscriptions)
    .innerJoin(s.users, eq(s.users.id, s.pushSubscriptions.userId))
    .where(and(...conditions));
  if (!subs.length) return result;
  let keys: VapidKeys;
  try {
    keys = await getVapidKeys();
  } catch (e) {
    console.error("[push] anahtar yok:", (e as Error).message);
    return { ...result, failed: subs.length };
  }
  const payload = JSON.stringify({ ...message, at: new Date().toISOString() });
  const subject = process.env.VAPID_SUBJECT?.trim() || appUrl();
  const one = async (sub: (typeof subs)[number]) => {
    if (!sub.p256dh || !sub.auth || !isPushEndpoint(sub.endpoint)) {
      await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.id, sub.id));
      result.removed++;
      return;
    }
    try {
      const body = encryptPayload({ p256dh: sub.p256dh, auth: sub.auth, payload });
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          Authorization: await vapidAuthorization({ endpoint: sub.endpoint, keys, subject }),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(opts.ttl ?? 12 * 3600),
          Urgency: opts.urgency ?? "high",
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (res.status === 404 || res.status === 410) {
        await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.id, sub.id));
        result.removed++;
      } else if (res.ok) {
        await db.update(s.pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0 }).where(eq(s.pushSubscriptions.id, sub.id));
        result.sent++;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      result.failed++;
      console.warn("[push] gönderilemedi:", new URL(sub.endpoint).hostname, (e as Error).message);
      const [row] = await db
        .update(s.pushSubscriptions)
        .set({ failures: sql`${s.pushSubscriptions.failures} + 1` })
        .where(eq(s.pushSubscriptions.id, sub.id))
        .returning({ failures: s.pushSubscriptions.failures });
      if (row && row.failures >= 10) {
        await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.id, sub.id));
        result.removed++;
      }
    }
  };
  // Aynı anda en çok 5 istek
  for (let i = 0; i < subs.length; i += 5) await Promise.all(subs.slice(i, i + 5).map(one));
  return result;
}
