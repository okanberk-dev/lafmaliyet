/**
 * Karaoke oturumunun saf hesapları (sunucu ve tarayıcı; tests/karaoke.test.ts): sitedeki rezervasyonun hangi olayı
 * doğurduğu (yeni, onay, iptal, saat değişti), oturumun evresi (başlamadı, sürüyor, süre doldu, bitti), uyarıların
 * zamanı ve ekran / bildirim metinleri. Zamanlar Türkiye saatiyle (UTC+3, yaz saati yok).
 */

export type KaraokeStatus = "requested" | "confirmed" | "cancelled";
export type PaymentStatus = "none" | "pending" | "paid" | "refunding" | "refunded" | "expired";
export type KaraokeEvent = "created" | "confirmed" | "cancelled" | "changed";

export const PAYMENT_STATUSES: PaymentStatus[] = ["none", "pending", "paid", "refunding", "refunded", "expired"];

/**
 * Köşkte alınan satır (laffogato.net'in elle rezervasyonu, 22 Kasım 2026; docs/KARAOKE.md › Elle rezervasyon ve saati
 * kapatma): telefonla ya da kasada alınan rezervasyon (`booking`: onaylı, ödemesi köşkte) ya da köşkün kapattığı saatler
 * (`block`). Kapatılan saat rezervasyon değildir: sayılmaz, ciroya ve doluluğa girmez, zil çalmaz, sayaç başlamaz; ama
 * oda o saatlerde doludur (hızlı sayaç ve uzatma sorar). Panelde `karaoke_sessions.channel` "desk" / "desk-block".
 */
export type DeskKind = "booking" | "block";

/** Kapatılan saatler (rezervasyon değil) */
export const isBlock = (s: { desk?: DeskKind | null }) => s.desk === "block";

/** Panelin `karaoke_sessions.channel` sütunundaki elle satır değerleri (migration yok; eşitleme yazar: site.ts) */
export const DESK_CHANNEL = "desk";
export const DESK_BLOCK_CHANNEL = "desk-block";

/** Sütundan elle satırın türü: "desk" rezervasyon, "desk-block" kapatılan saat; başka her kanal null */
export function deskKindOfChannel(channel: string | null | undefined): DeskKind | null {
  return channel === DESK_BLOCK_CHANNEL ? "block" : channel === DESK_CHANNEL ? "booking" : null;
}

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
  /**
   * İptal edilmiş rezervasyonun iadesi (kuruş; site 29 Ekim 2026'dan beri gönderir): 0 = hiçbir şey geri gitmedi (%0
   * kuralında misafirin geç isteğiyle saat satışa açıldı; ödeme durumu yine de `refunded`), ödenenden küçük = geç iptal
   * payı ya da yeniden satılan saatin payı, null = kısmi tutar yok (bir şey geri gidiyorsa tamamı). Alanı göndermeyen
   * eski site: undefined
   */
  refundMinor?: number | null;
  /**
   * Köşkte alınan satır (site 22 Kasım 2026'dan beri gönderir; ekleme): sitenin panelinden ya da bu panelin "Elle
   * ekle"siyle yazılan rezervasyon ya da kapatılan saat. Eski site göndermez: false
   */
  desk?: boolean;
  /**
   * Köşkte alınan satırlardan kapatılan saatler (ekleme). Göndermeyen site için yanıtın okunuşunda türetilir: ücretsiz ve
   * notu "Kapalı" ile başlayan elle satır (src/lib/karaoke/site.ts)
   */
  block?: boolean;
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
  /** İptalin iadesi, personelin de görebileceği biçimde (tutarsız): bkz. `refundKindOf` */
  refund: RefundKind | null;
  /** İptalin iade tutarı (kuruş); tutar gibi yalnız yöneticiye */
  refundMinor: number | null;
  lastEvent: KaraokeEvent | null;
  lastEventAt: string | null;
  createdBy: string | null;
  /** Köşkte alınan satır: elle rezervasyon (`booking`, köşkte ödenir) ya da kapatılan saatler (`block`); değilse null */
  desk: DeskKind | null;
  /** Sitede satırın yazıldığı an (rezervasyonun yapıldığı an; sayaçta boş): personelin elle satırı kaldırma süresi */
  bookedAt: string | null;
  /**
   * Misafire gidecek ya da gitmiş "bir gün kaldı" hatırlatma e-postası (elle eklenirken e-posta yazıldıysa; yalnız
   * liste okumalarında dolu: board.ts › loadSessions). Adres hiçbir zaman ekrana gelmez
   */
  reminder?: { state: "pending" | "sent"; at: string } | null;
}

/** İptal edilmiş rezervasyonda ne geri gitti ya da gidiyor: hiçbir şey, bir kısmı, tamamı */
export type RefundKind = "none" | "partial" | "full";

/**
 * İptal edilmiş ve iadesi yapılmış ya da süren rezervasyonun iade türü; başka her satırda null. `refundMinor` 0 ise
 * hiçbir şey geri gitmedi (sitenin %0 kuralında geç istekle saat satışa açıldı, 29 Ekim 2026); toplamdan küçükse bir
 * kısmı (geç iptal payı ya da yeniden satılan saatin payı); yoksa ya da toplama eşit ya da büyükse tamamı. Tutar bu
 * türe çevrilir ki personel ekranı tutarı görmeden doğru yazsın.
 */
export function refundKindOf(r: {
  status: KaraokeStatus;
  paymentStatus: PaymentStatus;
  refundMinor: number | null | undefined;
  totalMinor: number | null | undefined;
}): RefundKind | null {
  if (r.status !== "cancelled") return null;
  if (r.paymentStatus !== "refunded" && r.paymentStatus !== "refunding") return null;
  const refund = r.refundMinor;
  if (typeof refund !== "number" || !Number.isFinite(refund)) return "full";
  if (refund <= 0) return "none";
  return typeof r.totalMinor === "number" && refund < r.totalMinor ? "partial" : "full";
}

/** İptal edilmiş rezervasyonun rozet metni: iade sürüyor mu, yapıldı mı, hiç yapılmadı mı */
export function cancelledBadgeText(paymentStatus: PaymentStatus, refund: RefundKind | null): string {
  if (paymentStatus === "refunding") return refund === "partial" ? "İptal · kısmi iade sürüyor" : "İptal · iade sürüyor";
  if (paymentStatus === "refunded") {
    if (refund === "none") return "İptal · iade yok";
    return refund === "partial" ? "İptal · kısmi iade edildi" : "İptal · iade edildi";
  }
  return "İptal";
}

/** Ödemesi beklenen geçici tutma: saat ayrılmış ama rezervasyon henüz yok (ödenmezse kendiliğinden düşer) */
export const isHold = (r: { status: KaraokeStatus; paymentStatus: PaymentStatus }) => r.status === "requested" && r.paymentStatus === "pending";

/** Gerçek rezervasyon: iptal değil, ödemesi beklenen tutma değil, kapatılan saat değil */
export const isLive = (r: { status: KaraokeStatus; paymentStatus: PaymentStatus; desk?: DeskKind | null }) => r.status !== "cancelled" && !isHold(r) && !isBlock(r);

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

export type Phase = "held" | "cancelled" | "closed" | "upcoming" | "active" | "overtime" | "done";

/** Süresi dolup susturulmayan oturum en çok bu kadar "süre doldu" görünür (sonra bitti sayılır) */
const STALE_OVERTIME_MS = 6 * 3_600_000;

/**
 * Sayaçta çalınacak oturum: onaylı ya da kasada ödenecek talep (köşkte alınan elle rezervasyon dahil) ya da panelden
 * açılan; iptal, ödenmemiş tutma ve kapatılan saat değil (kapatılan saatte sayaç başlamaz, alarm çalmaz)
 */
export const isPlayable = (s: Pick<KaraokeSessionDTO, "status" | "paymentStatus" | "source"> & { desk?: DeskKind | null }) =>
  s.source === "panel" || (s.status !== "cancelled" && !isHold(s) && !isBlock(s) && s.paymentStatus !== "expired" && s.paymentStatus !== "refunded");

/**
 * Oturumun evresi. Kapatılan saat (köşkün elle kapattığı) hep "closed": hiçbir zaman sürmez, süresi dolmaz, bitmez
 * (sayaç ve alarm yok; ekranda "Kapalı").
 */
export function phase(s: KaraokeSessionDTO, nowMs: number): Phase {
  if (s.status === "cancelled" || s.paymentStatus === "refunded" || s.paymentStatus === "expired") return "cancelled";
  if (isBlock(s)) return "closed";
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
  /** Başlangıç bu cihaza geç ulaştı (zamanında kurulamadı): hemen, bir kez duyurulur */
  late?: boolean;
}

/**
 * Geç öğrenilen başlangıç bu kadar süre içinde duyurulur: rezervasyon cihaza saatinden sonra ulaştı (geç eşitleme, arka
 * plandaki sekme, uykudan uyanan cihaz, o saate elle eklenen rezervasyon). Oturum sürüyorsa bir kez "Karaoke başladı".
 * Süre başlangıçtan, rezervasyon saatinden sonra yazıldıysa yazıldığı andan sayılır (16:40'ta 16:00'ya elle eklenen
 * rezervasyon da duyurulur).
 */
export const LATE_START_MS = 15 * 60_000;

/**
 * Önümüzdeki uyarılar: başlangıç (kısa ses), bitime `warnMinutes` kala (iki kısa ses) ve bitiş (susturulana kadar
 * alarm). Bir dakikadan eski uyarı zamanında çalmış sayılır; yalnız başlangıç geç öğrenildiyse son 15 dakikada başlamış
 * (ya da saatinden sonra son 15 dakikada yazılmış) ve hâlâ süren oturumda hemen bir kez duyurulur (`late`, anahtar
 * zamanındakiyle aynı: iki kez çalmaz). Bitmiş, süresi dolmuş (alarmı evresinden, overtime) ve 15 dakikadan eski
 * başlangıç duyurulmaz. Kapatılan saat hiç planlanmaz (isPlayable).
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
    // Başlangıcın cihaza en erken ulaşabildiği an: saatinden sonra yazılan rezervasyonda yazıldığı an (sitenin createdAt'i)
    const known = Math.max(start, Date.parse(s.bookedAt ?? "") || start);
    if (start < nowMs - 60_000 && nowMs - known <= LATE_START_MS && nowMs < end) out.push({ key: `${s.id}:start:${start}`, at: nowMs, kind: "start", sessionId: s.id, late: true });
    else add("start", start);
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
