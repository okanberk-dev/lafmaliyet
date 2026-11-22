/**
 * Panelin görünümü: Sistem (işletim sisteminin tercihi) · Açık · Koyu (docs/KOYU-TEMA.md).
 *
 * Seçim bu tarayıcıda `localStorage`'da durur (hesaba bağlı değil); yoksa ya da okunamazsa "sistem". Koyu temada
 * `<html>`'e `dark` sınıfı ve `data-theme="dark"` konur; renkler globals.css'te `html.dark` altında. Sayfa ilk kez
 * boyanmadan önce `THEME_SCRIPT` (kök düzende `<head>` içinde satır içi betik) sınıfı koyar: beyaz parlama olmaz. Aynı
 * betik sistem tercihinin ve başka sekmedeki seçimin değişmesini de izler. QR menü (/menu) müşterinin ekranı: hep açık.
 */

export type ThemePref = "sistem" | "acik" | "koyu";

export const THEME_KEY = "ladmin-tema";

/** Tarayıcı çubuğunun rengi (meta theme-color): sayfa zeminiyle aynı */
export const THEME_COLOR = { light: "#ffffff", dark: "#050302" } as const;

export const THEME_OPTIONS: readonly { value: ThemePref; label: string }[] = [
  { value: "sistem", label: "Sistem" },
  { value: "acik", label: "Açık" },
  { value: "koyu", label: "Koyu" },
];

export function parseThemePref(v: unknown): ThemePref {
  return v === "acik" || v === "koyu" ? v : "sistem";
}

/** Tema uygulanmayan adresler: müşterinin açtığı QR menü */
export function themeExempt(pathname: string): boolean {
  return /^\/menu(\/|$)/.test(pathname);
}

/** Seçim ve sistem tercihinden koyu mu */
export function resolveDark(pref: ThemePref, systemDark: boolean, pathname: string): boolean {
  if (themeExempt(pathname)) return false;
  return pref === "koyu" || (pref === "sistem" && systemDark);
}

/**
 * İlk boyamadan önce çalışan betik. Kendi başına durur (içe aktarma yok, ES5): `__ladminTema()` sınıfı yeniden
 * hesaplar; seçici (ThemeChoice) kaydettikten sonra onu çağırır.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,K=${JSON.stringify(THEME_KEY)},q=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null;function p(){try{var v=window.localStorage.getItem(K);return v==="acik"||v==="koyu"?v:"sistem"}catch(e){return"sistem"}}function a(){var v=p(),on=!/^\\/menu(\\/|$)/.test(location.pathname)&&(v==="koyu"||(v==="sistem"&&!!q&&q.matches));d.classList.toggle("dark",on);if(on)d.setAttribute("data-theme","dark");else d.removeAttribute("data-theme");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",on?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)})}a();if(q){if(q.addEventListener)q.addEventListener("change",a);else if(q.addListener)q.addListener(a)}window.addEventListener("storage",function(e){if(e.key===K)a()});document.addEventListener("DOMContentLoaded",a);window.__ladminTema=a})()`;

/** Kayıtlı seçim (okunamazsa "sistem") */
export function readThemePref(): ThemePref {
  try {
    return parseThemePref(window.localStorage.getItem(THEME_KEY));
  } catch {
    return "sistem";
  }
}

/** Seçimi kaydeder ve hemen uygular; kaydedilemezse (gizli pencere, kapalı depolama) bu sayfada yine uygulanır */
export function saveThemePref(pref: ThemePref): void {
  try {
    if (pref === "sistem") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    // depolama kapalı: aşağıda yalnız bu sayfa için uygulanır
  }
  const boot = (window as unknown as { __ladminTema?: () => void }).__ladminTema;
  const stored = readThemePref();
  if (boot && stored === pref) {
    boot();
  } else {
    const dark = resolveDark(pref, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false, window.location.pathname);
    applyDark(dark);
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Seçim değişince (bu sekmede) yayılan olay: açık olan öteki seçiciler güncellensin */
export const THEME_EVENT = "ladmin-tema";

function applyDark(dark: boolean) {
  const d = document.documentElement;
  d.classList.toggle("dark", dark);
  if (dark) d.setAttribute("data-theme", "dark");
  else d.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
}
