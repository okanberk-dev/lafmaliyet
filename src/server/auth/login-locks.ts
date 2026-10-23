// "server-only" yok: veritabanıyla gidip gelen test (tests/baglanti-db.test.ts) bu dosyayı doğrudan çalıştırır. Her
// işlev veritabanını parametre alır; giriş eylemleri (src/server/actions/auth.ts) getDb() ile çağırır. "use client"
// dosyası buraya uzanmaz.

import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

type Db = Pick<DB, "insert" | "update" | "select" | "delete">;

/**
 * Bilinen cihazın kendi hata payı: cihaz + kişi başına 10 hatada 15 dakika kilit. Hesap kilidi (5 hata) bilinen cihazı
 * dışarıda bırakmaz: e-postayı bilen biri 5 yanlış parolayla sahibini panelden kapatamasın. Önceden bu pay sunucusuz
 * örneğin belleğindeydi (her örnekte ayrı, soğuk başlangıçta sıfır, kilit yazılmazdı): ortak tablette biri sahibinin
 * parolasını kimse görmeden deneyebiliyordu. Artık veritabanında, kilit işlem geçmişine yazılır.
 */
export const DEVICE_MAX_FAILED = 10;
export const DEVICE_LOCK_MINUTES = 15;

/** Sayılan deneme: kilit sürüyorsa değerlendirilmez (`until`), değilse `locked` bu denemeyle başlayan kilidin bitişi */
export type Reservation = { ok: true; locked: Date | null } | { ok: false; until: Date };

const activeLock = (until: Date | null | undefined, now = Date.now()) => (until && until.getTime() > now ? until : null);

/**
 * Denemeyi doğrulamadan ÖNCE cihazın sayacından düşer ve kilidi aynı yazımda verir (hesap kilidinin kuralı: 10. deneme
 * sayacı sıfırlar ve kilidi başlatır, kendisi yine değerlendirilir). Kilit sürüyorsa satır değişmez; eşzamanlı istekler
 * satır kilidinde sıraya girer, kilidi gören geri çevrilir.
 */
export async function reserveDeviceAttempt(db: Db, userId: number, deviceId: string): Promise<Reservation> {
  const t = s.loginDeviceLocks;
  const next = sql`${t.failedLogins} + 1 >= ${sql.raw(String(DEVICE_MAX_FAILED))}`;
  const [row] = await db
    .insert(t)
    .values({ userId, deviceId, failedLogins: 1 })
    .onConflictDoUpdate({
      target: [t.userId, t.deviceId],
      set: {
        failedLogins: sql`CASE WHEN ${next} THEN 0 ELSE ${t.failedLogins} + 1 END`,
        lockedUntil: sql`CASE WHEN ${next} THEN now() + interval '${sql.raw(String(DEVICE_LOCK_MINUTES))} minutes' ELSE ${t.lockedUntil} END`,
        updatedAt: sql`now()`,
      },
      setWhere: or(isNull(t.lockedUntil), lte(t.lockedUntil, sql`now()`)),
    })
    .returning({ lockedUntil: t.lockedUntil });
  if (row) return { ok: true, locked: activeLock(row.lockedUntil) };
  const [cur] = await db
    .select({ lockedUntil: t.lockedUntil })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.deviceId, deviceId)))
    .limit(1);
  return { ok: false, until: activeLock(cur?.lockedUntil) ?? new Date(Date.now() + DEVICE_LOCK_MINUTES * 60_000) };
}

/**
 * reserveDeviceAttempt'in saydığı denemeyi geri verir (parola doğru, iki adımlı kod bekleniyor): sayaç bir azalır;
 * kilit bu denemeyle başladıysa (sayaç sıfır, kilit sürüyor) kalkar ve sayaç 9'da kalır.
 */
export async function refundDeviceAttempt(db: Db, userId: number, deviceId: string): Promise<void> {
  const t = s.loginDeviceLocks;
  const locked = sql`${t.failedLogins} = 0 AND ${t.lockedUntil} > now()`;
  await db
    .update(t)
    .set({
      failedLogins: sql`CASE WHEN ${t.failedLogins} > 0 THEN ${t.failedLogins} - 1 WHEN ${locked} THEN ${sql.raw(String(DEVICE_MAX_FAILED - 1))} ELSE 0 END`,
      lockedUntil: sql`CASE WHEN ${locked} THEN NULL ELSE ${t.lockedUntil} END`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(t.userId, userId), eq(t.deviceId, deviceId)));
}

/** Başarılı girişte cihazın sayacı ve kilidi kalkar */
export async function clearDeviceAttempts(db: Db, userId: number, deviceId: string): Promise<void> {
  await db.delete(s.loginDeviceLocks).where(and(eq(s.loginDeviceLocks.userId, userId), eq(s.loginDeviceLocks.deviceId, deviceId)));
}

/**
 * İki adımlı kodun zaman adımını tek yazımda tüketir: yalnız kayıtlı son adımdan büyükse yazılır. Aynı kod aynı anda
 * iki kez gönderilirse (biri omuz üstünden görüp yarıştırırsa) yalnız biri geçer; okuyup sonra yazınca ikisi de
 * geçiyordu. Yazıldıysa true.
 */
export async function consumeTotpStep(db: Db, userId: number, step: number): Promise<boolean> {
  const rows = await db
    .update(s.users)
    .set({ totpLastStep: step })
    .where(and(eq(s.users.id, userId), or(isNull(s.users.totpLastStep), lt(s.users.totpLastStep, step))))
    .returning({ id: s.users.id });
  return rows.length > 0;
}

/**
 * Kurtarma kodunu tek yazımda harcar: liste okunduğu hâliyle duruyorsa kalanlar yazılır (karşılaştır ve değiştir).
 * Aynı kod aynı anda iki kez kullanılamaz; arada liste değiştiyse (başka bir kod harcandı, kodlar yenilendi) false.
 */
export async function consumeRecoveryList(db: Db, userId: number, previous: readonly string[], remaining: readonly string[]): Promise<boolean> {
  const rows = await db
    .update(s.users)
    .set({ recoveryCodes: [...remaining] })
    .where(and(eq(s.users.id, userId), sql`${s.users.recoveryCodes} = ${JSON.stringify(previous)}::jsonb`))
    .returning({ id: s.users.id });
  return rows.length > 0;
}
