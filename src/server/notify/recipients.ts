import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import { blockReasonOf, emailKey, splitByBlocked, type BlockReason, type DroppedRecipient, type RecipientList } from "@/lib/notify-recipients";
import { CASH_REPORT_GROUP } from "@/lib/branch-settings/groups";
import { PACKAGE_SETTINGS_KEY, parsePackageSettings } from "@/lib/muhasebe/paket-ayar";
import { resolveForTills } from "@/server/branch-settings";
import { getDb, schema as s, type DB } from "@/server/db";

/*
 * Bildirim alıcıları ve hesaplar (denetim E-52, E-53; kurallar src/lib/notify-recipients.ts): kasa raporu e-postası,
 * sabah e-postası, bekçi uyarısı, deneme e-postaları ve muhasebeci paketi gönderim anında buradan geçer. Sorgular
 * küçük: listedeki adreslerin hesapları (en çok birkaç satır).
 */

/** Okuma yapan her şey: veritabanı ya da açık bir işlem */
type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Listedeki adreslerden hesabı e-posta almayanlar (personel, müdür ya da pasif): emailKey → neden. Hesapsız adres yok */
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
 * Açık şubelerin kasa raporu alıcıları tek listede (şube başına ayar; "aynı" şubeler aynı listeyi verir, adres bir kez).
 * `all`: e-postası kapalı şubenin listesi de (açılınca giderdi); değilse yalnız e-postası açık şubelerinki
 */
async function cashRecipientLists(db: Reader, o: { all: boolean }): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of (await resolveForTills(CASH_REPORT_GROUP, db)).values()) {
    if (!o.all && !r.value.emailEnabled) continue;
    for (const e of r.value.recipients) {
      if (seen.has(emailKey(e))) continue;
      seen.add(emailKey(e));
      out.push(e);
    }
  }
  return out;
}

/**
 * Muhasebeci paketinin alıcıları (Ayarlar › Muhasebeci paketi; docs/MUHASEBE-PAKETI.md): "Ay kapanınca gönder" kapalı
 * olsa da ("Şimdi gönder" bu listeye gönderir). Ayar src/server/muhasebe/paket.ts'in yazdığı kayıt; burada hafif okunur
 * (paketin kendisi exceljs taşır, Hesabım ve zil onu yüklemesin)
 */
export async function packageRecipients(db: Reader = getDb()): Promise<string[]> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, PACKAGE_SETTINGS_KEY)).limit(1);
  return parsePackageSettings(row?.value).recipients;
}

/**
 * Adres hangi listelerde: herhangi bir şubenin kasa raporu alıcıları (e-posta kapalı olsa da: açılınca giderdi),
 * sabah e-postasının bildirim adresleri (duraklatılmış satır da: açılınca giderdi) ve muhasebeci paketinin alıcıları
 * (kendiliğinden gönderim kapalı olsa da). Büyük-küçük harf fark etmez.
 */
export async function listsWithEmail(email: string, db: Reader = getDb()): Promise<RecipientList[]> {
  const key = emailKey(email);
  const [cash, digest, pkg] = await Promise.all([
    cashRecipientLists(db, { all: true }),
    db
      .select({ id: s.notificationRecipients.id })
      .from(s.notificationRecipients)
      .where(eq(sql`lower(${s.notificationRecipients.email})`, key))
      .limit(1),
    packageRecipients(db),
  ]);
  const out: RecipientList[] = [];
  if (cash.some((e) => emailKey(e) === key)) out.push("cash");
  if (digest.length) out.push("digest");
  if (pkg.some((e) => emailKey(e) === key)) out.push("package");
  return out;
}

/**
 * Zil ve ayar ekranları: listelerde duran ama gönderimde düşen adresler. Kasa listesi açık şubelerin, yalnız e-postası
 * açık olanların (kapalıyken zaten gitmiyor), bildirim adresleri yalnız etkin olanlar (duraklatılan bilerek kapalı),
 * paketin alıcılarının hepsi ("Şimdi gönder" her zaman gönderir).
 */
export async function blockedRecipientsNow(db: Reader = getDb()): Promise<Record<RecipientList, DroppedRecipient[]>> {
  const [cashList, digest, pkg] = await Promise.all([cashRecipientLists(db, { all: false }), activeDigestEmails(db), packageRecipients(db)]);
  const blocked = await blockedAccounts(db, [...cashList, ...digest, ...pkg]);
  return { cash: splitByBlocked(cashList, blocked).dropped, digest: splitByBlocked(digest, blocked).dropped, package: splitByBlocked(pkg, blocked).dropped };
}
