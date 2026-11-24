import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import { blockReasonOf, emailKey, splitByBlocked, type BlockReason, type DroppedRecipient, type RecipientList } from "@/lib/notify-recipients";
import { loadCashSettings } from "@/server/data/cash-reports";
import { getDb, schema as s, type DB } from "@/server/db";

/*
 * Bildirim alıcıları ve hesaplar (denetim E-52, E-53; kurallar src/lib/notify-recipients.ts): kasa raporu e-postası,
 * sabah e-postası, bekçi uyarısı ve deneme e-postaları gönderim anında buradan geçer. Sorgular küçük: listedeki
 * adreslerin hesapları (en çok birkaç satır).
 */

/** Okuma yapan her şey: veritabanı ya da açık bir işlem */
type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Listedeki adreslerden hesabı e-posta almayanlar (personel ya da pasif): emailKey → neden. Hesabı olmayan adres yok */
export async function blockedAccounts(db: Reader, emails: readonly string[]): Promise<Map<string, BlockReason>> {
  const keys = [...new Set(emails.map(emailKey))];
  const out = new Map<string, BlockReason>();
  if (!keys.length) return out;
  const rows = await db
    .select({ email: s.users.email, role: s.users.role, active: s.users.active })
    .from(s.users)
    .where(inArray(sql`lower(${s.users.email})`, keys));
  for (const r of rows) {
    const reason = blockReasonOf(r);
    if (reason) out.set(emailKey(r.email), reason);
  }
  return out;
}

/** blockedAccounts'un adresleri (küçük harfle) */
export async function blockedAccountEmails(db: Reader, emails: readonly string[]): Promise<string[]> {
  return [...(await blockedAccounts(db, emails)).keys()];
}

/** Gönderim anı: listeyi gidecek ve düşen adreslere ayırır (sıra korunur) */
export async function sendableRecipients(db: Reader, emails: readonly string[]): Promise<{ to: string[]; dropped: DroppedRecipient[] }> {
  return splitByBlocked(emails, await blockedAccounts(db, emails));
}

/** Etkin bildirim adresleri (sabah e-postası, bekçi uyarısı, deneme): eklenme sırasıyla */
export async function activeDigestEmails(db: Reader = getDb()): Promise<string[]> {
  return (await activeDigestRecipients(db)).map((r) => r.email);
}

/** Etkin bildirim adresleri ve şubeleri (boş = bütün şubeler; sabah e-postası şubeye bağlı adrese ayrı gider) */
export async function activeDigestRecipients(db: Reader = getDb()): Promise<{ email: string; branchIds: string[] }[]> {
  return db
    .select({ email: s.notificationRecipients.email, branchIds: s.notificationRecipients.branchIds })
    .from(s.notificationRecipients)
    .where(eq(s.notificationRecipients.active, true))
    .orderBy(s.notificationRecipients.createdAt);
}

/**
 * Adres hangi listelerde: kasa raporu alıcıları (e-posta kapalı olsa da: açılınca giderdi) ve sabah e-postasının
 * bildirim adresleri (duraklatılmış satır da: açılınca giderdi). Büyük-küçük harf fark etmez.
 */
export async function listsWithEmail(email: string, db: Reader = getDb()): Promise<RecipientList[]> {
  const key = emailKey(email);
  const [cash, digest] = await Promise.all([
    loadCashSettings(),
    db
      .select({ id: s.notificationRecipients.id })
      .from(s.notificationRecipients)
      .where(eq(sql`lower(${s.notificationRecipients.email})`, key))
      .limit(1),
  ]);
  const out: RecipientList[] = [];
  if (cash.recipients.some((e) => emailKey(e) === key)) out.push("cash");
  if (digest.length) out.push("digest");
  return out;
}

/**
 * Zil ve ayar ekranları: listelerde duran ama gönderimde düşen adresler. Kasa listesi yalnız e-posta açıkken (kapalıyken
 * zaten gitmiyor), bildirim adresleri yalnız etkin olanlar (duraklatılan bilerek kapalı).
 */
export async function blockedRecipientsNow(db: Reader = getDb()): Promise<Record<RecipientList, DroppedRecipient[]>> {
  const [cash, digest] = await Promise.all([loadCashSettings(), activeDigestEmails(db)]);
  const cashList = cash.emailEnabled ? cash.recipients : [];
  const blocked = await blockedAccounts(db, [...cashList, ...digest]);
  return { cash: splitByBlocked(cashList, blocked).dropped, digest: splitByBlocked(digest, blocked).dropped };
}
