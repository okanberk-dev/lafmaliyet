/**
 * Açık panel sekmesinin yedek kontrolü (/api/canli; src/components/panel/live/alert-center.tsx). Saf: tests/canli-yoklama.test.ts.
 *
 * Panelin veritabanı Neon'un ücretsiz planında: ayda 100 CU-saat, beş dakika boşta kalınca uyur, kota dolunca ay
 * sonuna kadar kapanır (panel, bar ekranı, sabah işleri ve sitenin pingleri birlikte durur). Her kontrol (değişiklik
 * yoksa 304 olsa da) veritabanını uyandırır; bu yüzden kontrol yalnız gerektiğinde:
 *
 * - Sekme arka plandaysa hiç (öne gelince hemen sorulur; bildirim izni olan cihaza yenilik zaten bildirimle gelir).
 *   Yalnız süresi dolan oturumun alarmı çalarken sorulur: başka cihazda susturulursa burada da sussun.
 * - Bildirim açıksa 30 dakikada bir (yeni rezervasyon ve sipariş bildirimle gelir; bu yalnız kaçan bildirim için).
 * - Bildirim kapalıyken dakikada bir; kimse ekranı kullanmıyorsa (son 10 dakikada dokunuş / tuş yok) ve bir saat
 *   içinde karaoke oturumu ya da saatli hatırlatıcı yoksa 10 dakikada bir. Bar ekranı ayrıca siparişler için kendisi
 *   sorar (orders-board.tsx; bildirim kapalıyken 20 sn).
 */
export const LIVE_POLL = {
  /** Alarm çalarken */
  ringingMs: 15_000,
  /** Bildirim açıkken */
  pushMs: 30 * 60_000,
  /** Bildirim kapalı, biri ekranı kullanıyor ya da yakında bir şey var */
  activeMs: 60_000,
  /** Bildirim kapalı, ekran boşta */
  idleMs: 10 * 60_000,
  /** Bu kadar süre dokunulmayan ekran boşta sayılır */
  idleAfterMs: 10 * 60_000,
  /** Bu kadar süre içinde başlayan / süren karaoke oturumu ya da saatli hatırlatıcı ekranı "yakında bir şey var" yapar */
  soonMs: 60 * 60_000,
  /** Zamanlayıcının bakma aralığı (istek değil: yalnız kontrolün vakti geldi mi) */
  tickMs: 5_000,
} as const;

export interface LivePollInput {
  /** Sekme önde (document.visibilityState === "visible") */
  visible: boolean;
  /** Süresi dolan oturumun alarmı çalıyor */
  ringing: boolean;
  /** Bu cihazda bildirim açık (izin verildi ve sunucunun anahtarı var) */
  pushOn: boolean;
  /** Son dokunuş / tuştan bu yana geçen süre (ms) */
  sinceActiveMs: number;
  /** Bir saat içinde başlayan ya da süren karaoke oturumu, ya da saati yaklaşan hatırlatıcı var */
  soon: boolean;
}

/** Yedek kontrolün aralığı (ms); null: bu durumda sorulmaz */
export function livePollMs(o: LivePollInput): number | null {
  if (o.ringing) return LIVE_POLL.ringingMs;
  if (!o.visible) return null;
  if (o.pushOn) return LIVE_POLL.pushMs;
  return o.soon || o.sinceActiveMs < LIVE_POLL.idleAfterMs ? LIVE_POLL.activeMs : LIVE_POLL.idleMs;
}

/** Kontrolün vakti geldi mi: son soruluşu (başarılı yanıt ya da gönderilen istek) aralığından eskiyse */
export function livePollDue(o: LivePollInput, lastAskedAt: number, nowMs: number): boolean {
  const ms = livePollMs(o);
  return ms !== null && nowMs - lastAskedAt >= ms;
}
