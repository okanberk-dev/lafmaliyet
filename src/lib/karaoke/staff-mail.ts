
import { holdsRoom } from "./overlap";
import { isBlock, trClock, type KaraokeSessionDTO } from "./session";

/**
 * Karaoke rezervasyonunun personel e-postaları: saf kurallar (sunucu ve testler paylaşır; tests/karaoke-hatirlatma.test.ts).
 * Operatör, 22 Kasım 2026: "çalışanlara da mail gitsin aynı gün 3 saat öncesinde ve aynı gün sabahı" ve "bizim
 * elemanlara para ödenmediği de göze çarpsın ki alsınlar, önden almaları gerektiğini de söyle".
 *
 * İki e-posta: rezervasyon günü **sabah** o günün rezervasyonlarının listesi (günde bir kez) ve her rezervasyondan **3
 * saat önce** o rezervasyonun kendisi. İkisinde de ödemesi alınmamış rezervasyon (elle eklenen ya da "kasada ödenecek")
 * en üstte, kırmızıyla durur: ücret misafir odaya girmeden, önden alınır. Tutar yazılmaz (personel tutar görmez; ücret
 * kasada). Konuda ve ön izlemede misafirin adı yok (kilit ekranı); ad yalnız gövdede. Kime gider: o gün vardiyada
 * olanlar (Vardiya planı), plan yoksa şubenin bütün personeli (src/server/karaoke/staff-mail.ts). Ayrıntı: docs/KARAOKE.md
 * › Personel e-postaları.
 */

/** "3 saat kala" e-postası başlangıçtan bu kadar önce gider */
export const STAFF_SOON_LEAD_MS = 3 * 3_600_000;
/** Başlangıca bundan az kaldıysa artık gönderilmez (oda başlamak üzere; bar zaten ekranda görür) */
export const STAFF_SOON_MIN_MS = 30 * 60_000;
/** Sabah e-postası bu saatten sonra (Türkiye, dakika) gider: sabah işi 08:00–09:00 arasında çalışır */
export const STAFF_MORNING_FROM_MIN = 8 * 60;
/**
 * Sabah e-postası bu saate kadar gider. Öğleden sonra eklenen ilk rezervasyon "sabah" listesi doğurmaz; onun 3 saat
 * kala e-postası gider
 */
export const STAFF_MORNING_UNTIL_MIN = 12 * 60;

export type StaffMailSession = Pick<
  KaraokeSessionDTO,
  "id" | "source" | "date" | "startsAt" | "endsAt" | "extraMinutes" | "endedAt" | "guests" | "customerName" | "note" | "status" | "paymentStatus" | "desk"
>;

/** Personelin beklediği rezervasyon: sitede geçerli (iptal, tutma, iade, bitmiş değil) ve kapatılan saat değil */
export function expectsGuests(s: StaffMailSession): boolean {
  return holdsRoom(s) && !isBlock(s);
}

/** Ödeme: sitede ödenmişse "paid"; değilse kasada, önden alınacak */
export type StaffPay = "paid" | "collect";
export function staffPay(s: Pick<StaffMailSession, "paymentStatus">): StaffPay {
  return s.paymentStatus === "paid" ? "paid" : "collect";
}

const minuteOfDay = (ms: number) => {
  const [h, m] = trClock(ms).time.split(":").map(Number);
  return h * 60 + m;
};

/** Sabah e-postasının penceresi açık mı (Türkiye saatiyle 08:00–12:00) */
export function staffMorningWindow(nowMs: number): boolean {
  const m = minuteOfDay(nowMs);
  return m >= STAFF_MORNING_FROM_MIN && m < STAFF_MORNING_UNTIL_MIN;
}

/** Sabah listesine girenler: bugünün (Türkiye) henüz başlamamış rezervasyonları, saat sırasıyla */
export function morningSessions<T extends StaffMailSession>(sessions: readonly T[], nowMs: number): T[] {
  const today = trClock(nowMs).date;
  return sessions
    .filter((s) => expectsGuests(s) && s.date === today && Date.parse(s.startsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id - b.id);
}

/** "3 saat kala" e-postası gidecekler: başlangıcına 3 saatten az, 30 dakikadan çok kalanlar */
export function soonSessions<T extends StaffMailSession>(sessions: readonly T[], nowMs: number): T[] {
  return sessions
    .filter((s) => {
      const left = Date.parse(s.startsAt) - nowMs;
      return expectsGuests(s) && left <= STAFF_SOON_LEAD_MS && left > STAFF_SOON_MIN_MS;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id - b.id);
}

/** Gönderimin tekillik anahtarları (notification_log): gün başına bir sabah listesi, rezervasyon ve saat başına bir "3 saat kala" */
export const staffMorningKey = (date: string) => `karaoke-personel-sabah:${date}`;
/** Saat değişirse anahtar da değişir: yeni saatin 3 saat öncesinde yeniden haber verilir */
export const staffSoonKey = (s: Pick<StaffMailSession, "id" | "startsAt">) => `karaoke-personel-3saat:${s.id}:${s.startsAt}`;

/**
 * Karaokenin kitlesi (e-posta ve bildirim; docs/KARAOKE.md): yönetici, şubesiz personel (bütün şubelerde çalışır) ve
 * karaoke odasının şubesinin personeli (şube özelliği, src/lib/branch-features.ts › karaokeBranchOf). Başka şubeye kilitli
 * personel karaoke haberini almaz: o şubede karaoke yok. Karaoke hiçbir şubede açık değilse (`branchId` null) kimse
 */
export function karaokeAudience<U extends { role: "admin" | "staff"; branchId: string | null }>(users: readonly U[], branchId: string | null): U[] {
  if (branchId === null) return [];
  return users.filter((u) => u.role === "admin" || u.branchId === null || u.branchId === branchId);
}

/**
 * Kime gider. O gün Vardiya planında çalışan olarak yazılmış, hesabı etkin kişiler varsa yalnız onlar (rolü ne olursa
 * olsun); plan boşsa ya da plandakilerin hesabı yoksa karaoke odasının şubesindeki bütün etkin personel (kitle
 * `karaokeAudience`'ın personeli; şubesi boş olan bütün şubelerde çalışır).
 */
export function staffMailRecipients<U extends { id: number; email: string; role: "admin" | "staff"; branchId: string | null }>(
  users: readonly U[],
  onShiftIds: readonly number[],
  branchId: string | null,
): U[] {
  const withMail = users.filter((u) => u.email.trim());
  const planned = withMail.filter((u) => onShiftIds.includes(u.id));
  if (planned.length) return planned;
  return karaokeAudience(withMail, branchId).filter((u) => u.role === "staff");
}
