/**
 * Açık panel sekmesinin yedek kontrolü (/api/canli; src/components/panel/live/alert-center.tsx). Saf: tests/canli-yoklama.test.ts.
 *
 * Panelin veritabanı Neon'un ücretsiz planında: ayda 100 CU-saat, beş dakika boşta kalınca uyur, kota dolunca ay
 * sonuna kadar kapanır (panel, bar ekranı, sabah işleri ve sitenin pingleri birlikte durur). Her kontrol (değişiklik
 * yoksa 304 olsa da) veritabanını uyandırır; bu yüzden kontrol yalnız gerektiğinde:
 *
 * - Sekme arka plandaysa: yeniliği bildirimle alan ya da zil çalmayan cihazda hiç (öne gelince hemen sorulur). Bildirim
 *   gelmeyen ve zili açık cihazda (bar ekranı: ses açılmış, sipariş zili ya da karaoke alarmları açık; izin yok,
 *   abonelik kaydedilemedi ya da o konunun bildirimi kapalı) 10 dakikada bir: yeni sipariş ve rezervasyon en geç ~10
 *   dakikada çalar. Daha sık sorulsa veritabanı hiç uyumaz (günde 14 saat arka planda ayda ~105 CU-saat; 10 dakikada
 *   bir en çok ~52). Süresi dolan oturumun alarmı çalarken 15 saniyede bir.
 * - Son karaoke çekmesi başarısızsa (bar ekranında sarı satır) bildirim açık ya da ekran boşta olsa da dakikada bir:
 *   çekme düşünce yeni rezervasyonun bildirimi gitmez, site de ancak canlı uç sorulunca yeniden denenir (en çok iki
 *   dakikada bir, src/lib/karaoke/freshness.ts). Site geri gelince rezervasyon ve satırın kalkması birkaç dakikada.
 * - Bildirim açıksa (izin, kayıtlı abonelik ve zili açık konular; pushCovers) 30 dakikada bir (yeni rezervasyon ve
 *   sipariş bildirimle gelir; bu yalnız kaçan bildirim için).
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
  /** Sekme arka planda, yeniliği bildirimle almayan ve zili açık cihaz (bar ekranı): yeni sipariş / rezervasyon zili en çok bu kadar gecikir */
  hiddenMs: 10 * 60_000,
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
  /** Yenilik bu cihaza bildirimle gelir (pushCovers) */
  pushOn: boolean;
  /** Son dokunuş / tuştan bu yana geçen süre (ms) */
  sinceActiveMs: number;
  /** Bir saat içinde başlayan ya da süren karaoke oturumu, ya da saati yaklaşan hatırlatıcı var */
  soon: boolean;
  /** Son karaoke çekmesi başarısız (canlı yanıtta `karaoke.error`): bildirim gelmez, yeniden deneme bu soruyla olur */
  failing: boolean;
  /** Bu cihaz yeni sipariş / rezervasyonda zil çalar (listensForAlerts) */
  listening: boolean;
}

/** Yedek kontrolün aralığı (ms); null: bu durumda sorulmaz */
export function livePollMs(o: LivePollInput): number | null {
  if (o.ringing) return LIVE_POLL.ringingMs;
  // Arka planda yalnız bildirimin getirmediği yeniliği zil çalacak cihaz sorar (bar ekranı); sıklaşmaz
  if (!o.visible) return o.listening && !o.pushOn ? LIVE_POLL.hiddenMs : null;
  if (o.failing) return LIVE_POLL.activeMs;
  if (o.pushOn) return LIVE_POLL.pushMs;
  return o.soon || o.sinceActiveMs < LIVE_POLL.idleAfterMs ? LIVE_POLL.activeMs : LIVE_POLL.idleMs;
}

/**
 * Bu cihaz yeni sipariş / rezervasyonda zil çalar: ses açık, tarayıcı sesi açmış ve sipariş zili ya da karaoke alarmları
 * açık (personelde varsayılan açık, yöneticide kapalı). Sesi açılmamış (hiç dokunulmamış) sekme zaten çalamaz.
 */
export function listensForAlerts(p: { sound: boolean; orderAlerts: boolean; karaokeAlarms: boolean }, audioReady: boolean): boolean {
  return p.sound && audioReady && (p.orderAlerts || p.karaokeAlarms);
}

/** Kontrolün vakti geldi mi: son soruluşu (başarılı yanıt ya da gönderilen istek) aralığından eskiyse */
export function livePollDue(o: LivePollInput, lastAskedAt: number, nowMs: number): boolean {
  const ms = livePollMs(o);
  return ms !== null && nowMs - lastAskedAt >= ms;
}
