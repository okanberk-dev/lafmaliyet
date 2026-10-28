/**
 * Ortak onay kuyruğunun saf kuralları (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §3). Personelin
 * yöneticinin onayına giden istekleri tek tabloda (staff_requests) bekler: türler, durumlar, etiketler, sınırlar,
 * karar reddi, zil kimliğinin yenilenmesi ve süre dolması burada; veritabanı tarafı src/server/staff-requests/core.ts.
 * Reçete önerileri kendi tablosunda (recipe_change_requests) kalır. Testler: tests/onay-kuyrugu.test.ts.
 */

import { businessDate, DAY_TURN_HOUR } from "./cash-report";
import { num } from "./format";
import { daysAgo } from "./prices/pos";

/** İstek türleri (şemadaki sırayla; tests/onay-kuyrugu.test.ts şemayla karşılaştırır) */
export const STAFF_REQUEST_KINDS = ["kasa-duzeltme", "kasa-silme", "kasa-gec", "kasa-cikan", "foto-kaldir", "kapali-gun", "zayi-gec", "zayi-sil", "mal-taslak", "karaoke-sil"] as const;
export type StaffRequestKind = (typeof STAFF_REQUEST_KINDS)[number];

/**
 * Kaldırılan türler: `mal-taslak` (mal siparişi taslağı; hızlı sayım ve mal siparişiyle 26 Eki 2026'da kaldırıldı).
 * Eski satırlar geçmiş için tabloda (ve tür şemanın enumunda) kalır; yeni istek açılmaz, kuyruklar (Onaylar, Bugün,
 * zil, sabah e-postası, Son kararlar) okumaz ve canlı kalanları sabah işi kapatır (expireStaffRequests).
 */
export const RETIRED_REQUEST_KINDS = ["mal-taslak"] as const satisfies readonly StaffRequestKind[];

/**
 * Durumlar: bekliyor, onaylandı, reddedildi, geri çekildi (personel), kapandı (başka bir yol aynı işi yaptı; ör. rapor
 * başka bir istekle düzeltildi), süresi doldu, tamamlandı ve geri alındı (kaldırılan mal siparişi taslağının eski
 * kayıtlarında: gönderildi, gönderim geri alındı) ve kaldırıldı (onaylı kapalı gün işareti kanıtla kalktı)
 */
export const STAFF_REQUEST_STATUSES = ["pending", "approved", "rejected", "withdrawn", "superseded", "expired", "done", "cancelled", "revoked"] as const;
export type StaffRequestStatus = (typeof STAFF_REQUEST_STATUSES)[number];

/** Yöneticinin kartlarındaki tür adı */
export const KIND_LABEL: Record<StaffRequestKind, string> = {
  "kasa-duzeltme": "Kasa düzeltmesi",
  "kasa-silme": "Kasa raporu silme",
  "kasa-gec": "Geç kasa raporu",
  "kasa-cikan": "Kasadan çıkan",
  "foto-kaldir": "Fotoğraf kaldırma",
  "kapali-gun": "Kapalı gün",
  "zayi-gec": "Geç zayi / ikram",
  "zayi-sil": "Zayi silme",
  "mal-taslak": "Mal siparişi taslağı",
  "karaoke-sil": "Karaoke sayacı silme",
};

/** Sayıyla birlikte yazılan küçük harfli ad: "2 kasa düzeltmesi", "1 geç zayi / ikram" (Bugün, sabah e-postası) */
export const KIND_COUNT_LABEL: Record<StaffRequestKind, string> = {
  "kasa-duzeltme": "kasa düzeltmesi",
  "kasa-silme": "kasa raporu silme isteği",
  "kasa-gec": "geç kasa raporu",
  "kasa-cikan": "kasadan çıkan isteği",
  "foto-kaldir": "fotoğraf kaldırma isteği",
  "kapali-gun": "kapalı gün bildirimi",
  "zayi-gec": "geç zayi / ikram",
  "zayi-sil": "zayi silme isteği",
  "mal-taslak": "mal siparişi taslağı",
  "karaoke-sil": "karaoke sayacı silme isteği",
};

/** İşlem geçmişinde geri çekmenin adı (genel geri çekme eylemi; withdrawStaffRequest) */
export const WITHDRAW_LOG: Record<StaffRequestKind, string> = {
  "kasa-duzeltme": "Kasa düzeltmesi geri çekildi",
  "kasa-silme": "Kasa raporunun silinmesi isteği geri çekildi",
  "kasa-gec": "Geç kasa raporu geri çekildi",
  "kasa-cikan": "Kasadan çıkan isteği geri çekildi",
  "foto-kaldir": "Fotoğraf kaldırma isteği geri çekildi",
  "kapali-gun": "Kapalı gün bildirimi geri çekildi",
  "zayi-gec": "Geç zayi / ikram isteği geri çekildi",
  "zayi-sil": "Zayi silme isteği geri çekildi",
  "mal-taslak": "Mal siparişi taslağı geri çekildi",
  "karaoke-sil": "Karaoke sayacının silinmesi isteği geri çekildi",
};

export const STATUS_LABEL: Record<StaffRequestStatus, string> = {
  pending: "Onay bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
  superseded: "Kapandı",
  expired: "Süresi doldu",
  done: "Tamamlandı",
  cancelled: "Geri alındı",
  revoked: "Kaldırıldı",
};

/**
 * Personel Yardım'ının "Yöneticinin onayına gidenler" satırları: her tür bir cümle, ayrıca reçete değişikliği ve yeni
 * ürün önerisi (kendi tablolarında). Yardım bu listeden kurulur; yeni bir tür eklenince buraya da yazılır (test tutar).
 */
export const STAFF_APPROVAL_KINDS: readonly { kind: StaffRequestKind | "recete" | "yeni-urun"; text: string }[] = [
  { kind: "kasa-duzeltme", text: "Kasa raporunu ertesi gün ya da kilitlendikten sonra düzeltmek" },
  { kind: "kasa-silme", text: "Kasa raporunu sildirmek" },
  { kind: "kasa-gec", text: "Unutulan eski günün kasa raporu (14 gün)" },
  { kind: "kasa-cikan", text: "Kapanmış güne kasadan çıkan" },
  { kind: "foto-kaldir", text: "Yanlış Z / POS fotoğrafını kaldırtmak" },
  { kind: "kapali-gun", text: "Dün kafe kapalıydı" },
  { kind: "zayi-gec", text: "Geç zayi / ikram (14 gün)" },
  { kind: "zayi-sil", text: "Başkasının zayi kaydını sildirmek" },
  { kind: "karaoke-sil", text: "Açılışından 10 dakika sonra karaoke sayacını sildirmek" },
  { kind: "recete", text: "Reçete değişikliği" },
  { kind: "yeni-urun", text: "Yeni ürün önerisi" },
];

/** Açık istek sınırının grubu: kasa istekleri birlikte sayılır; geç kasa raporu, zayi ve karaoke ayrı (mal: kaldırılan tür) */
export type RequestGroup = "kasa" | "kasa-gec" | "zayi" | "mal" | "karaoke";
export const KIND_GROUP: Record<StaffRequestKind, RequestGroup> = {
  "kasa-duzeltme": "kasa",
  "kasa-silme": "kasa",
  "kasa-gec": "kasa-gec",
  "kasa-cikan": "kasa",
  "foto-kaldir": "kasa",
  "kapali-gun": "kasa",
  "zayi-gec": "zayi",
  "zayi-sil": "zayi",
  "mal-taslak": "mal",
  "karaoke-sil": "karaoke",
};

/**
 * Sınırlar: kişi başına tür grubu başına açık (bekleyen) istek; kişi başına iş günü başına oluşturma; kişi başına konu
 * başına iş günü başına oluşturma (geri çekilen ve reddedilen dahil); zil kimliğinin en sık yenilenmesi
 */
export const LIMITS = {
  open: { kasa: 10, "kasa-gec": 5, zayi: 20, mal: 10, karaoke: 5 } satisfies Record<RequestGroup, number>,
  perDay: 30,
  perSubjectDay: 3,
  bumpMs: 10 * 60_000,
} as const;

/** Çekirdeğin ve eylemlerin ortak metinleri */
export const REQUEST_TEXT = {
  decided: "Bu istek zaten karara bağlanmış; sayfayı yenileyin",
  changed: "İstek siz bakarken değişti; yeniden bakın",
  self: "Kendi isteğinizi onaylayamazsınız",
  expired: "Süresi doldu",
  notFound: "İstek bulunamadı; sayfayı yenileyin",
  notPending: "İstek bulunamadı ya da artık beklemede değil",
  adminDirect: "Yönetici doğrudan yapar; istek gerekmez",
  adminOnly: "Yalnız yönetici karar verir",
  held: "Bu fotoğraf onay bekleyen bir istekte",
  keyTaken: "Bu istek başka bir hesaptan gönderilmiş; sayfayı yenileyin",
  /** Aynı istemci anahtarıyla yeniden gönderilen istek artık beklemede değil (karara bağlandı, geri çekildi, kapandı) */
  keyClosed: "Bu istek zaten karara bağlandı ya da kapandı; sayfayı yenileyin",
} as const;

/**
 * Yönetici bu isteği şimdi karara bağlayabilir mi (null: evet). Sıra: karara bağlanmış, kendi isteği, süresi dolmuş,
 * sürümü ekranda görülenden farklı. İsteyen hesabı silinmişse (requestedBy boş) kimse "kendisi" değildir.
 */
export function reviewRefusal(
  row: { status: StaffRequestStatus; version: number; requestedBy: number | null; expiresAt: Date | null },
  me: { id: number },
  seenVersion: number,
  now: Date,
): string | null {
  if (row.status !== "pending") return REQUEST_TEXT.decided;
  if (row.requestedBy !== null && row.requestedBy === me.id) return REQUEST_TEXT.self;
  if (isExpired(row, now)) return REQUEST_TEXT.expired;
  if (row.version !== seenVersion) return REQUEST_TEXT.changed;
  return null;
}

/** Zil kimliği (bumped_at): istek güncellenince en çok `LIMITS.bumpMs`'de bir yenilenir; yeniden okunmamış olur */
export function nextBump(prev: Date, now: Date): Date {
  return now.getTime() - prev.getTime() >= LIMITS.bumpMs ? now : prev;
}

/** Süresi doldu mu (süresi olmayan dolmaz; tam süre anında dolar) */
export function isExpired(row: { expiresAt: Date | null }, now: Date): boolean {
  return row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
}

/** İş gününün başı (05:00, Türkiye): oluşturma sınırları iş gününe göre sayılır */
export function requestDayStart(now: Date): Date {
  return new Date(`${businessDate(now)}T${String(DAY_TURN_HOUR).padStart(2, "0")}:00:00+03:00`);
}

/**
 * Yeni istek açılabilir mi (null: evet). `open`: kişinin aynı gruptaki bekleyen istekleri; `today`: iş gününde açtığı
 * istekler; `subjectToday`: iş gününde aynı konuda açtığı istekler (geri çekilen ve reddedilen dahil)
 */
export function limitRefusal(kind: StaffRequestKind, c: { open: number; today: number; subjectToday: number }): string | null {
  const open = LIMITS.open[KIND_GROUP[kind]];
  if (c.open >= open) return `Onay bekleyen ${num(open)} isteğiniz var; yöneticinin karar vermesini bekleyin ya da birini geri çekin`;
  if (c.today >= LIMITS.perDay) return `Bugün en çok ${num(LIMITS.perDay)} istek açılabilir; yarın yeniden deneyin`;
  if (c.subjectToday >= LIMITS.perSubjectDay) return `Bu konuda bugün en çok ${num(LIMITS.perSubjectDay)} istek açılabilir; yöneticiye yazın`;
  return null;
}

/** "1 kasa düzeltmesi · 3 geç zayi / ikram · 1 zayi silme isteği" (türlerin sırasıyla; sıfırlar ve kaldırılan türler yazılmaz) */
export function requestCountsText(counts: readonly { kind: StaffRequestKind; count: number }[]): string {
  const retired: readonly StaffRequestKind[] = RETIRED_REQUEST_KINDS;
  return STAFF_REQUEST_KINDS.flatMap((k) => {
    if (retired.includes(k)) return [];
    const n = counts.filter((c) => c.kind === k).reduce((a, c) => a + c.count, 0);
    return n > 0 ? [`${num(n)} ${KIND_COUNT_LABEL[k]}`] : [];
  }).join(" · ");
}

/** Ne zamandan beri bekliyor: "bugünden beri", "dünden beri", "3 gündür" (Türkiye günüyle) */
export function waitedText(at: Date, now: Date): string {
  const d = daysAgo(at, now);
  return d === 0 ? "bugünden beri" : d === 1 ? "dünden beri" : `${num(d)} gündür`;
}

/** Sabah e-postasında en çok bu kadar istek satırı (kalanı sayıyla) */
const DIGEST_ROWS = 8;

/**
 * Sabah e-postasının "Onay bekleyenler" kutusunun satırları: başta "N istek onay bekliyor" ve en eskisinin beklediği,
 * ardından istek başına başlık ve isteyenin adı (başlık tutarsız; ad dışında kişisel veri yok). Liste eskiden yeniye.
 */
export function approvalsDigestLines(rows: readonly { title: string; requestedByName: string; createdAt: Date }[], now: Date): { strong?: string; text: string; tone?: "bad" | "warn" | "muted" }[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const oldest = waitedText(sorted[0].createdAt, now);
  const head = { strong: `${num(rows.length)} istek onay bekliyor`, text: `En eskisi ${oldest} bekliyor.` };
  const shown = sorted.slice(0, DIGEST_ROWS).map((r) => ({ text: `${r.title} (${r.requestedByName})` }));
  const more = sorted.length - shown.length;
  return [head, ...shown, ...(more > 0 ? [{ text: `ve ${num(more)} istek daha`, tone: "muted" as const }] : [])];
}
