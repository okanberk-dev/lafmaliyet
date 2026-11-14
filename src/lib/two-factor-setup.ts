/*
 * İki adımlı doğrulama kurulumunun sınırları (Hesabım › İki adımlı doğrulamayı aç; denetim YO-05). Kurulum parolayla
 * başlar, anahtar onaylanana kadar "bekleyen" biçimde saklanır: başlangıç anıyla birlikte, SETUP_MINUTES dakika geçerli.
 * Onay kodu her bekleyen anahtar için en çok SETUP_MAX kez denenir; sınıra ulaşan hata anahtarı siler, kurulum parolayla
 * yeniden başlar. Açık kalmış bir oturumla yarım bırakılmış kurulumun kodu denenerek iki adımlı açılamasın. Saf modül:
 * sunucu eylemi (src/server/actions/auth.ts) ve kurulum penceresi aynı metinleri kullanır.
 */

/** Bir bekleyen anahtarla en fazla bu kadar hatalı onay kodu */
export const SETUP_MAX = 5;
/** Yarım kalan kurulumun anahtarı bu süreden sonra onaylanamaz (QR'ı okutup kodu girmek için bol) */
export const SETUP_MINUTES = 15;

export const SETUP_EXPIRED = `Kurulumun süresi doldu (${SETUP_MINUTES} dakika). İki adımlı doğrulamayı yeniden açın.`;
export const SETUP_STOPPED = `Kod ${SETUP_MAX} kez tutmadı; güvenlik için kurulum durduruldu. İki adımlı doğrulamayı yeniden açın.`;

/** Bu hata kurulumu bitirdi: pencere kapanır, kurulum parolayla yeniden başlar */
export function isSetupEnded(message: string): boolean {
  return message === SETUP_EXPIRED || message === SETUP_STOPPED;
}

/** Bekleyen anahtarın şifrelenmeden önceki biçimi: "kurulum:<başlangıç ms>:<anahtar>" */
export function pendingSecret(secret: string, now = Date.now()): string {
  return `kurulum:${now}:${secret}`;
}

/**
 * Bekleyen anahtar süresi içindeyse anahtarın kendisi; süresi geçtiyse, biçim tutmuyorsa (bu sürümden önce başlamış
 * kurulum) ya da okunamıyorsa null.
 */
export function openPendingSecret(plain: string | null, now = Date.now()): string | null {
  const m = plain ? /^kurulum:(\d+):([A-Z2-7]+)$/.exec(plain) : null;
  if (!m) return null;
  const age = now - Number(m[1]);
  return age >= 0 && age < SETUP_MINUTES * 60_000 ? m[2] : null;
}
