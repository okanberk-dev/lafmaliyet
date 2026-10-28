import type { SiteOrder } from "./schema";

/**
 * Bar ekranının ödeme takibi ve kaçan ping (saf, zod'suz: sunucu, ekran ve testler paylaşır; senkron planı P2,
 * docs/SITE-SIPARIS.md › Ödeme takibi).
 *
 * Kartlı siparişte site önce "ödeme bekleniyor" yazar ve ping atar, ödeme gelince bir ping daha. İkinci ping kaybolursa
 * (panel o an yayında, ağ, zaman aşımı) ödenmiş sipariş ekrana ancak ekranın kendi çekmesiyle gelir; sakin saatte bu
 * bir saat sürebilirdi. Site sipariş listesinin yanında ödeme bekleyen bar ekranı siparişlerinin **sayısını** verir
 * (`awaitingPayment`, laffogato #270; yalnız sayı, sipariş yok). Sayı sıfırdan büyükken panel en çok 30 dakika
 * "ödeme bekleniyor" der: ekran o süre yoğun sayılır ve siteyi üç dakikada bir sorar. Sürekli sorgu yok: takip yalnız
 * ödeme beklenirken ve sipariş başına en çok 30 dakika (sitenin kendi sınırı da 30 dakika: her sipariş son ödeme
 * sayfasından 30 dakika sonra sayıdan düşer).
 */

/** Ödeme takibinin süresi: başladığı ya da yeniden başladığı andan itibaren */
export const AWAITING_FOLLOW_MS = 30 * 60_000;

/** Ekran yoğunken (açık sipariş, son iki saatte ping ya da değişiklik) arka planda üç dakikada bir çeker */
export const BUSY_WINDOW_MS = 2 * 3_600_000;

/**
 * Bundan uzun aralıklı kontrol (sakin saatin saatlik kontrolü) pingle yapılan çekmeyi saymaz: araya giren başka bir
 * siparişin pingi saatlik kontrolü atlatıp kaçan ödemeyi bir saat daha geciktirmesin. Daha sık kontroller (açılış 1 dk,
 * yoğun 3 dk) pingin çekmesini sayar: o çekme listeyi zaten getirdi.
 */
export const QUIET_CHECK_MIN_MS = 10 * 60_000;

/** Son çekme hatalıysa ekranın isteği siteyi en çok bu sıklıkta yeniden dener (site geri gelince liste hemen gelsin) */
export const ERROR_RETRY_MS = 5_000;

/**
 * Kaçan ping: ödemeden bu kadar sonra hâlâ ping gelmemişse (sitenin pingi birkaç saniyede gelir; aynı anda gelen ekran
 * çekmesi kaçan sayılmasın).
 */
export const MISSED_PING_GRACE_MS = 60_000;

/** Ödeme bekleyen sayısının üst sınırı (bozuk yanıt ekranı bozmasın) */
export const AWAITING_MAX = 9_999;

export type OrdersTrigger = "ping" | "screen" | "manual";

export interface AwaitingState {
  /** Son başarılı çekmede sitenin ödeme bekleyen sayısı (alan yoksa 0) */
  awaitingPayment: number;
  /** Takibin başladığı ya da yeniden başladığı an (panelin saati); takip yoksa null */
  awaitingSince: string | null;
}

/** Sitenin `awaitingPayment`'ı: tam sayı ve sıfırdan büyükse kendisi (en çok AWAITING_MAX), değilse 0 (alan yok, bozuk) */
export function awaitingCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, AWAITING_MAX) : 0;
}

/**
 * Başarılı bir çekmeden sonra takibin durumu. Sayı 0: takip biter. Sayı sıfırdan büyükken takip (yeniden) başlar:
 * 0 → > 0 geçişinde, sayı artınca (yeni bir ödeme sayfası açıldı) ve sitenin her pinginde (yeniden açılan ödeme
 * sayfası ping atar ama sipariş zaten sayılıyorsa sayıyı artırmaz; sitenin docs/PANEL-ORDERS.md'si). Ekranın kendi
 * çekmesi süren takibi uzatmaz: takip sipariş başına en çok 30 dakika.
 */
export function nextAwaiting(prev: AwaitingState, count: number, trigger: OrdersTrigger, atIso: string): AwaitingState {
  if (count <= 0) return { awaitingPayment: 0, awaitingSince: null };
  const restart = !prev.awaitingSince || prev.awaitingPayment <= 0 || count > prev.awaitingPayment || trigger === "ping";
  return { awaitingPayment: count, awaitingSince: restart ? atIso : prev.awaitingSince };
}

/** Takibin bittiği an (başlangıç + 30 dk, ISO); takip yoksa null. Ekran bu ana kadar yoğun sayılır */
export function awaitingUntil(s: Partial<AwaitingState>): string | null {
  if (!s.awaitingPayment || s.awaitingPayment <= 0 || !s.awaitingSince) return null;
  const since = Date.parse(s.awaitingSince);
  return Number.isFinite(since) ? new Date(since + AWAITING_FOLLOW_MS).toISOString() : null;
}

const recent = (iso: string | null | undefined, nowMs: number) => Boolean(iso) && nowMs - Date.parse(iso!) < BUSY_WINDOW_MS;

/**
 * Bar ekranı yoğun mu (arka planda üç dakikada bir çeker; değilse saatte bir): ekranda açık sipariş var, son iki saatte
 * sitede sipariş hareketi oldu (ping ya da liste değişti) ya da ödeme bekleniyor (`awaitingUntil` geçmedi).
 */
export function boardBusy(
  o: { open: number; pingAt?: string | null; changeAt?: string | null; awaitingUntil?: string | null },
  nowMs: number,
): boolean {
  const awaiting = Boolean(o.awaitingUntil) && Date.parse(o.awaitingUntil!) > nowMs;
  return o.open > 0 || recent(o.pingAt, nowMs) || recent(o.changeAt, nowMs) || awaiting;
}

/**
 * Ekranın isteği siteyi sormalı mı ("son çekme bundan eskiyse sor"). Sakin saatin seyrek kontrolü (`maxAgeMs` ≥ 10 dk)
 * yalnız ekranın ve elle yapılan çekmeleri sayar (`lastCheckAt`); daha sık kontroller her çekmeyi (`lastPullAt`, ping
 * dahil). Son çekme hatalıysa beş saniyeden eski her istek, elle "Yenile" ise hemen yeniden dener.
 */
export function pullDue(
  state: { lastPullAt: string | null; lastCheckAt?: string | null; lastError: string | null },
  maxAgeMs: number,
  o: { manual?: boolean; nowMs: number },
): boolean {
  const ref = maxAgeMs >= QUIET_CHECK_MIN_MS ? (state.lastCheckAt ?? null) : state.lastPullAt;
  const last = ref ? Date.parse(ref) : NaN;
  const stale = state.lastError ? (o.manual ? 0 : Math.min(maxAgeMs, ERROR_RETRY_MS)) : maxAgeMs;
  return !(Number.isFinite(last) && o.nowMs - last < stale);
}

/**
 * Ping kaçtı mı: pingle olmayan bir çekme ilk kez gördüğü yeni bir sipariş getirdi, sipariş en az bir dakika önce
 * ödenmiş (sitenin saatiyle) ve ödemeden sonra siteden hiç ping gelmemiş. Ping gelip çekmesi düştüyse bu kaçan ping
 * değil, çekme hatasıdır (Ayarlar'da hata olarak görünür). Önceki liste eksikse (200'den çok açık sipariş) yeni görünen
 * sipariş listeye yeni girmiş olabilir: sayılmaz.
 */
export function missedPing(
  fresh: readonly Pick<SiteOrder, "paidAt">[],
  o: { trigger: OrdersTrigger; siteNow: string; lastPingAt: string | null; prevComplete: boolean },
): boolean {
  if (o.trigger === "ping" || !o.prevComplete || !fresh.length) return false;
  const now = Date.parse(o.siteNow);
  const ping = o.lastPingAt ? Date.parse(o.lastPingAt) : NaN;
  return fresh.some((order) => {
    const paid = Date.parse(order.paidAt);
    return Number.isFinite(paid) && now - paid >= MISSED_PING_GRACE_MS && !(ping >= paid);
  });
}
