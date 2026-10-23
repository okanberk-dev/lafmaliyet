/**
 * laffogato.net'in pinginden sonra arka planda yapılan iş (karaoke, menü ve sipariş pingleri: src/app/api/{karaoke,
 * menu,orders}/ping). Uç imzayı doğrulayınca hemen 202 döner ve işi yanıttan sonra yapar; site 202'yi alınca pingi bir
 * daha göndermez, iş burada kaybolmamalı:
 *
 * - Önce pingin kaydı (son ping anı: ekranın "yoğun" sayılması, Ayarlar'daki "sitenin son pingi"). Yazılamasa da
 *   (uyuyan veritabanı bağlantısının ilk yazımı) çekme yapılır: kaydı olmayan çekme, kaybolan çekmeden iyidir.
 * - Sonra çekme. Hata dönerse (site 8 sn'de yanıt vermedi) ya da fırlatırsa (veritabanı bağlantısı koptu) kısa bir
 *   beklemeyle bir kez daha denenir. İkincisi de olmazsa günlüğe yazılır; ekranlar kendi yoklamasında yeniden sorar.
 *
 * Saf (bağımlılıklar verilir): tests/site-ping-isi.test.ts.
 */

/** İkinci denemeden önce beklenen süre: sitenin yazımı tamamlansın, kopan bağlantı yenilensin */
export const PING_RETRY_DELAY_MS = 4000;

export type PingPullResult = { status: string; error?: string };

export interface PingWorkDeps<R extends PingPullResult> {
  /** Pingin kaydı (son ping anı) */
  note: () => Promise<void>;
  /** Sitenin verisini çekip yazar */
  pull: () => Promise<R>;
  wait?: (ms: number) => Promise<void>;
  log?: Pick<Console, "warn" | "error">;
  retryDelayMs?: number;
}

/**
 * Pingin işini yapar; çekmenin son sonucunu (iki deneme de fırlattıysa null) döndürür. `label` günlükteki ön ek:
 * "[karaoke]", "[menu]", "[siparis]".
 */
export async function runPingWork<R extends PingPullResult>(label: string, deps: PingWorkDeps<R>): Promise<R | null> {
  const log = deps.log ?? console;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
    await deps.note();
  } catch (e) {
    log.warn(`${label} ping kaydı yazılamadı; çekme yine yapılıyor:`, e instanceof Error ? e.message : e);
  }
  let result: R | null = null;
  let thrown: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await wait(deps.retryDelayMs ?? PING_RETRY_DELAY_MS);
    try {
      result = await deps.pull();
      thrown = null;
      if (result.status !== "error") return result;
    } catch (e) {
      result = null;
      thrown = e;
    }
  }
  if (thrown) log.error(`${label} ping çekmesi iki kez düştü:`, thrown instanceof Error ? thrown.message : thrown);
  else log.warn(`${label} ping çekmesi:`, result?.error);
  return result;
}
