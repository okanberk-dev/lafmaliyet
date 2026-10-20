/**
 * /davet parola kaydedilince e-postayı bu sekmede bırakır; giriş sayfası alanı hazır doldurup anahtarı siler.
 * 10 dakikadan eski kayıt kullanılmaz (aynı sekmede başka biri oturum açıksa giriş sayfası hiç açılmayabilir).
 */
export const LOGIN_EMAIL_KEY = "laf-login-email";
const MAX_AGE_MS = 10 * 60_000;

export function rememberLoginEmail(email: string) {
  try {
    sessionStorage.setItem(LOGIN_EMAIL_KEY, JSON.stringify({ email, at: Date.now() }));
  } catch {
    // gizli pencere: e-posta elle yazılır
  }
}

export function takeLoginEmail(): string | null {
  try {
    const raw = sessionStorage.getItem(LOGIN_EMAIL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(LOGIN_EMAIL_KEY);
    const v = JSON.parse(raw) as { email?: unknown; at?: unknown };
    return typeof v.email === "string" && typeof v.at === "number" && Date.now() - v.at < MAX_AGE_MS ? v.email : null;
  } catch {
    return null;
  }
}
