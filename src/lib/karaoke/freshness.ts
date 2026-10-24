import { trClock } from "./session";

/**
 * Karaoke kopyasının tazeliği (saf; sunucu ve testler paylaşır: tests/karaoke-baglanti.test.ts). Site her rezervasyon
 * değişikliğinde ping atar, panel o an çeker. Ping kaybolursa (202'den sonra çekme iki kez düştü, site ulaşamadı) bar
 * ekranı rezervasyonu görmez, zil çalmaz, hızlı sayacın çakışma uyarısı eski kopyaya bakar. Bu yüzden:
 *
 * - Açık bir panel sekmesi canlı ucu (/api/canli) her sorduğunda, yanıttan sonra bu kurala bakılır ve gerekiyorsa site
 *   yeniden sorulur. Kimse bakmıyorsa (arka planda yalnız bildirim gelmeyen zil cihazı 10 dakikada bir sorar) ne
 *   panelin ne sitenin veritabanı uyanır (Neon'un ücretsiz kotası).
 * - Hızlı sayaç ve uzatma, sitedeki rezervasyonla çakışmayı sormadan önce kopya birkaç dakikadan eskiyse tazeler.
 */
export const CATCH_UP = {
  /** Ping yoksa da kopya bundan eskiyse yeniden çekilir (kaçan pingin en geç fark edilmesi) */
  staleMs: 30 * 60_000,
  /** Son çekme hata verdiyse bu sıklıkla yeniden denenir (site geri gelince liste bir iki dakikada düzelir) */
  errorRetryMs: 2 * 60_000,
  /** Bir ping son başarılı çekmeden yeniyse çekmesi kaybolmuştur; pingin kendi çekmesine bu kadar süre tanınır */
  pingGraceMs: 30_000,
  /** İki deneme arasında en az bu kadar (aynı anda soran sekmeler siteyi üst üste sormasın) */
  minGapMs: 20_000,
} as const;

export type CatchUpRules = { [K in keyof typeof CATCH_UP]: number };

export interface KaraokeSyncMarks {
  lastOkAt: string | null;
  lastTryAt: string | null;
  lastError: string | null;
  lastPingAt: string | null;
}

const at = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * Kopya şimdi siteden yeniden çekilmeli mi. Sıra: az önce denendiyse hayır; son deneme hatalıysa yalnız yeniden deneme
 * aralığı geçtiyse; hiç başarılı çekme yoksa evet; çekmesi kaybolan bir ping varsa evet; kopya eskidiyse evet.
 */
export function needsCatchUp(m: KaraokeSyncMarks, nowMs: number, rules: CatchUpRules = CATCH_UP): boolean {
  const ok = at(m.lastOkAt);
  const tried = at(m.lastTryAt);
  const ping = at(m.lastPingAt);
  if (Number.isFinite(tried) && nowMs - tried < rules.minGapMs) return false;
  if (m.lastError && Number.isFinite(tried) && nowMs - tried < rules.errorRetryMs) return false;
  if (!Number.isFinite(ok)) return true;
  if (Number.isFinite(ping) && ping > ok && nowMs - ping >= rules.pingGraceMs) return true;
  if (m.lastError) return true;
  return nowMs - ok >= rules.staleMs;
}

/**
 * Bar ekranının uyarı satırı (son çekme başarısız): "Son kontrol başarısız: Siteye ulaşılamadı (son başarılı kontrol
 * 14:05). Rezervasyonları sitenin panelinde de kontrol edin." Hata yoksa null.
 */
export function karaokeStaleLine(error: string | null | undefined, okAt: string | null | undefined, nowMs: number): string | null {
  if (!error) return null;
  const ok = okAt ? Date.parse(okAt) : NaN;
  let since = "";
  if (Number.isFinite(ok)) {
    const c = trClock(ok);
    since = ` (son başarılı kontrol ${c.date === trClock(nowMs).date ? c.time : `${c.date.slice(8, 10)}.${c.date.slice(5, 7)} ${c.time}`})`;
  }
  return `Son kontrol başarısız: ${error}${since}. Rezervasyonları sitenin panelinde de kontrol edin.`;
}
