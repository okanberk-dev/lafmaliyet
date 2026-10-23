/**
 * Sabah işinin zaman bütçesi (Vercel Hobby'de işlev 60 sn'de kesilir; docs/planlar/CRITIQUE2.md R15). İş başlarken
 * `jobStart` alınır: sabah e-postasının gönderimi en geç jobStart + 48 sn'de, kuyruktaki adımlar (hatırlatıcı
 * bildirimi, eşitlemeler, fotoğraf temizliği…) en geç jobStart + 55 sn'de biter. "server-only" yok: testli.
 */

/** Sabah e-postasının gönderim sınırı (jobStart'tan sonra) */
export const JOB_SEND_DEADLINE_MS = 48_000;
/** Kuyruktaki adımların sınırı (jobStart'tan sonra) */
export const JOB_TAIL_DEADLINE_MS = 55_000;
/** Yeni bir kuyruk adımı en çok bu kadar sürer */
export const TAIL_STEP_MS = 8_000;

/**
 * `p` en çok `ms` bekler; süre dolarsa `onTimeout` döner (iş arka planda sürse de beklenmez). Zamanlayıcı her durumda
 * temizlenir: kısa iş, işlevi süre dolana kadar açık tutmaz.
 */
export function capped<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), Math.max(0, ms));
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Bir kuyruk adımının kendi sınırı: en çok TAIL_STEP_MS, kuyruğun sınırını aşmadan */
export function tailStepDeadline(jobStart: number, now = Date.now()): number {
  return Math.min(now + TAIL_STEP_MS, jobStart + JOB_TAIL_DEADLINE_MS);
}
