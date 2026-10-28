/**
 * Karaoke oturumunun saf hesapları (sunucu ve tarayıcı; tests/karaoke.test.ts): sitedeki rezervasyonun hangi olayı
 * doğurduğu (yeni, onay, iptal, saat değişti), oturumun evresi (başlamadı, sürüyor, süre doldu, bitti), uyarıların
 * zamanı ve ekran / bildirim metinleri. Zamanlar Türkiye saatiyle (UTC+3, yaz saati yok).
 */

export type KaraokeStatus = "requested" | "confirmed" | "cancelled";
export type PaymentStatus = "none" | "pending" | "paid" | "refunding" | "refunded" | "expired";
export type KaraokeEvent = "created" | "confirmed" | "cancelled" | "changed";

export const PAYMENT_STATUSES: PaymentStatus[] = ["none", "pending", "paid", "refunding", "refunded", "expired"];

/** Sitenin gönderdiği rezervasyon (laffogato.net GET /api/panel/karaoke; e-posta, telefon, soyad yok) */
export interface SiteReservation {
  id: string;
  date: string;
  startHour: number;
  hours: number;
  startsAt: string;
  endsAt: string;
  guests: number;
  status: KaraokeStatus;
  paymentStatus: PaymentStatus;
  firstName: string;
  note: string;
  totalMinor: number;
  channel: string;
  createdAt: string;
  updatedAt: string;
  /** İptal anı: site bugün göndermiyor; eklerse panel onu kullanır (docs/KARAOKE.md › Doluluk haritası) */
  cancelledAt?: string;
}

/** Panelin tuttuğu oturum (ekrana giden biçim); tutar yalnız yöneticiye gider */
export interface KaraokeSessionDTO {
  id: number;
  source: "site" | "panel";
  externalId: string | null;
  date: string;
  startsAt: string;
  endsAt: string;
  extraMinutes: number;
  endedAt: string | null;
  endedBy: string | null;
  guests: number | null;
  customerName: string | null;
  note: string | null;
  status: KaraokeStatus;
  paymentStatus: PaymentStatus;
  totalMinor: number | null;
  lastEvent: KaraokeEvent | null;
  lastEventAt: string | null;
  createdBy: string | null;
}

/** Ödemesi beklenen geçici tutma: saat ayrılmış ama rezervasyon henüz yok (ödenmezse kendiliğinden düşer) */
export const isHold = (r: { status: KaraokeStatus; paymentStatus: PaymentStatus }) => r.status === "requested" && r.paymentStatus === "pending";

/** Gerçek rezervasyon: iptal değil, ödemesi beklenen tutma değil */
export const isLive = (r: { status: KaraokeStatus; paymentStatus: PaymentStatus }) => r.status !== "cancelled" && !isHold(r);

/**
 * İptal edilmiş gerçek rezervasyon: iptal (ödeme sayfasında süresi dolan tutma değil) ya da iade. Doluluk haritasının
 * iptal sayısı ve eşitlemenin iptal anı aynı kurala bakar (docs/KARAOKE.md › Doluluk haritası)
 */
export const isCancelledBooking = (r: { status: KaraokeStatus; paymentStatus: PaymentStatus }) =>
  (r.status === "cancelled" && r.paymentStatus !== "expired") || r.paymentStatus === "refunded" || r.paymentStatus === "refunding";

/**
 * Sitedeki değişiklik personel için ne demek: yeni rezervasyon (ilk kez görülen ya da ödemesi tamamlanan tutma, yeniden
 * açılan iptal), onay (bekleyen talep onaylandı), iptal, saat değişikliği. Ödenmeden düşen tutma ve iade adımları
 * sessizdir (null).
 */
export function detectEvent(
  prev: { status: KaraokeStatus; paymentStatus: PaymentStatus; startsAt: number; endsAt: number } | null,
  next: Pick<SiteReservation, "status" | "paymentStatus" | "startsAt" | "endsAt">,
): KaraokeEvent | null {
  if (!prev) return isLive(next) ? "created" : null;
  if (!isLive(prev)) return isLive(next) ? "created" : null;
  if (!isLive(next)) return next.status === "cancelled" ? "cancelled" : null;
  if (prev.startsAt !== Date.parse(next.startsAt) || prev.endsAt !== Date.parse(next.endsAt)) return "changed";
  if (prev.status === "requested" && next.status === "confirmed") return "confirmed";
  return null;
}

const TR_OFFSET_MS = 3 * 3_600_000;
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Epoch ms → Türkiye saatiyle "YYYY-MM-DD" ve "HH:MM" */
export function trClock(ms: number): { date: string; time: string } {
  const iso = new Date(ms + TR_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

const dayShift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "Bugün", "Yarın", "Dün", "24 Eki Cuma" */
export function dayLabel(date: string, nowMs: number): string {
  const today = trClock(nowMs).date;
  if (date === today) return "Bugün";
  if (date === dayShift(today, 1)) return "Yarın";
  if (date === dayShift(today, -1)) return "Dün";
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
}

/** Göreli olmayan kısa gün: "24 Eki" (kalıcı metinlerde: istek başlığı, işlem geçmişi) */
export function dayShortTR(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "20:00–22:00" (bitiş uzatmayla) */
export function timeRange(startMs: number, endMs: number): string {
  return `${trClock(startMs).time}–${trClock(endMs).time}`;
}

export const sessionStart = (s: Pick<KaraokeSessionDTO, "startsAt">) => Date.parse(s.startsAt);
/** Uzatmalar dahil bitiş */
export const sessionEnd = (s: Pick<KaraokeSessionDTO, "endsAt" | "extraMinutes">) => Date.parse(s.endsAt) + s.extraMinutes * 60_000;

/** Bildirim ve zil metni: "Yeni karaoke rezervasyonu" · "Bugün 20:00–22:00 · 4 kişi · Ayşe" */
export function eventMessage(
  event: KaraokeEvent,
  r: { startsAt: number; endsAt: number; guests: number | null; name: string | null; status: KaraokeStatus; paymentStatus: PaymentStatus },
  nowMs: number,
): { title: string; body: string } {
  const title = {
    created: "Yeni karaoke rezervasyonu",
    confirmed: "Karaoke rezervasyonu onaylandı",
    cancelled: "Karaoke rezervasyonu iptal edildi",
    changed: "Karaoke rezervasyonunun saati değişti",
  }[event];
  const when = `${dayLabel(trClock(r.startsAt).date, nowMs)} ${timeRange(r.startsAt, r.endsAt)}`;
  const parts = [when, r.guests ? `${r.guests} kişi` : null, r.name || null, event === "created" && r.status === "requested" && r.paymentStatus === "none" ? "onay bekliyor" : null];
  return { title, body: parts.filter(Boolean).join(" · ") };
}

/**
 * Web Push metinleri: zil metninin aynısı, misafirin adı olmadan. Bildirim kilit ekranında ve bildirim merkezinde
 * görünür; ad yalnız açık panel ekranındaki zil satırında (alert-center.tsx) ve listede kalır (KVKK, senkron P0).
 * Üçten fazla olay tek özet bildirim olur.
 */
export function pushMessages(
  events: readonly { event: KaraokeEvent; r: Pick<SiteReservation, "startsAt" | "endsAt" | "guests" | "status" | "paymentStatus"> }[],
  nowMs: number,
): { title: string; body: string; event: KaraokeEvent }[] {
  const messages = events.map(({ event, r }) => ({
    event,
    ...eventMessage(event, { startsAt: Date.parse(r.startsAt), endsAt: Date.parse(r.endsAt), guests: r.guests, name: null, status: r.status, paymentStatus: r.paymentStatus }, nowMs),
  }));
  if (messages.length <= 3) return messages;
  return [{ title: `${messages.length} karaoke güncellemesi`, body: messages.slice(0, 2).map((m) => `${m.title}: ${m.body}`).join(" · "), event: "created" }];
}

// ---------------------------------------------------------------- Sayaç

export type Phase = "held" | "cancelled" | "upcoming" | "active" | "overtime" | "done";

/** Süresi dolup susturulmayan oturum en çok bu kadar "süre doldu" görünür (sonra bitti sayılır) */
const STALE_OVERTIME_MS = 6 * 3_600_000;

/** Sayaçta çalınacak oturum: onaylı ya da kasada ödenecek talep ya da panelden açılan; iptal ve ödenmemiş tutma değil */
export const isPlayable = (s: Pick<KaraokeSessionDTO, "status" | "paymentStatus" | "source">) =>
  s.source === "panel" || (s.status !== "cancelled" && !isHold(s) && s.paymentStatus !== "expired" && s.paymentStatus !== "refunded");

export function phase(s: KaraokeSessionDTO, nowMs: number): Phase {
  if (s.status === "cancelled" || s.paymentStatus === "refunded" || s.paymentStatus === "expired") return "cancelled";
  if (isHold(s)) return "held";
  if (s.endedAt) return "done";
  const start = sessionStart(s);
  const end = sessionEnd(s);
  if (nowMs < start) return "upcoming";
  if (nowMs < end) return "active";
  return nowMs - end > STALE_OVERTIME_MS ? "done" : "overtime";
}

export type AlarmKind = "start" | "warn" | "end";

export interface PlannedAlarm {
  /** Aynı uyarı iki kez çalmasın: oturum + tür + an */
  key: string;
  at: number;
  kind: AlarmKind;
  sessionId: number;
}

/**
 * Önümüzdeki uyarılar: başlangıç (kısa ses), bitime `warnMinutes` kala (iki kısa ses) ve bitiş (susturulana kadar
 * alarm). Bir dakikadan eski olanlar planlanmaz (sayfa geç açıldıysa geçmiş başlangıç çalmasın); süresi dolmuş ve
 * susturulmamış oturumun alarmı evresinden (overtime) çalar.
 */
export function alarmPlan(sessions: KaraokeSessionDTO[], nowMs: number, warnMinutes: number, horizonMs = 12 * 3_600_000): PlannedAlarm[] {
  const out: PlannedAlarm[] = [];
  for (const s of sessions) {
    if (!isPlayable(s) || s.endedAt) continue;
    const start = sessionStart(s);
    const end = sessionEnd(s);
    const add = (kind: AlarmKind, at: number) => {
      if (at >= nowMs - 60_000 && at <= nowMs + horizonMs) out.push({ key: `${s.id}:${kind}:${at}`, at, kind, sessionId: s.id });
    };
    add("start", start);
    if (warnMinutes > 0 && end - warnMinutes * 60_000 > start) add("warn", end - warnMinutes * 60_000);
    add("end", end);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Kalan süre: "1:05:12", "42:13", "0:09" */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** "1 saat 30 dk", "45 dk", "2 saat" */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return [h ? `${h} saat` : "", m ? `${m} dk` : ""].filter(Boolean).join(" ") || "0 dk";
}
