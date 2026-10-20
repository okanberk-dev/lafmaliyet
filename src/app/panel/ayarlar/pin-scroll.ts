/**
 * Ayarlar › #bölüm bağlantısıyla (yer imi, yenileme, yeni sekme, Yardım'dan bağlantı) gelince bölüm başlığını üst
 * çubuğun hemen altına getirir ve sayfa yüklenmesi bitene kadar orada tutar.
 *
 * Neden tek kaydırma yetmiyor: telefonda bölümler kapalı akordeon olarak gelir; tarayıcının kendi çapa kaydırması ve
 * ilk etkiler kısa (kapalı) sayfada çalışır, sayfa ancak bölüm açıldıktan sonra uzar (kaydırma alt sınırda
 * kırpılır). Yenilemede tarayıcı eski kaydırma konumunu da yükleme sonunda geri yükleyebilir. Bu yüzden açılış
 * işlendikten sonra kaydırılır; sayfa uzadıkça ya da konum başka bir şeyce değiştirildikçe yeniden hizalanır.
 * Kullanıcı kaydırır, dokunur ya da tuşa basarsa koruma hemen biter; yükleme bittikten 1 sn sonra (en geç 15 sn) da biter.
 */

/** Hedef kaydırma konumu: öğenin üstü kaydırma payı kadar aşağıda; sayfanın kaydırılabildiği aralıkta kırpılır */
export function pinTarget({ scrollY, top, margin, scrollHeight, viewport }: { scrollY: number; top: number; margin: number; scrollHeight: number; viewport: number }) {
  const max = Math.max(0, scrollHeight - viewport);
  return Math.min(max, Math.max(0, scrollY + top - margin));
}

/** Hedefe 2px'ten uzaksa düzeltilir (alt sınırda kırpılmış hedefte boşuna döngü olmasın) */
export const needsPin = (scrollY: number, target: number) => Math.abs(target - scrollY) > 2;

const USER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
const SETTLE_MS = 1000;
/** Yükleme olayı hiç gelmezse (arka plandaki sekme) en geç bu kadar sonra biter */
const MAX_MS = 15_000;

/** Öğeyi hizalar ve korumayı kurar; dönen işlev korumayı bitirir */
export function pinSection(el: HTMLElement): () => void {
  const fix = () => {
    // Next'in sakladığı gizli sayfa kopyasında (display: none) ölçü yok
    if (!el.isConnected || el.getClientRects().length === 0) return;
    const root = document.documentElement;
    const target = pinTarget({
      scrollY: window.scrollY,
      top: el.getBoundingClientRect().top,
      margin: parseFloat(getComputedStyle(el).scrollMarginTop) || 0,
      scrollHeight: root.scrollHeight,
      viewport: window.innerHeight,
    });
    if (needsPin(window.scrollY, target)) window.scrollTo({ top: target, behavior: "instant" });
  };

  let timer = 0;
  const cap = window.setTimeout(() => stop(), MAX_MS);
  const settle = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(stop, SETTLE_MS);
  };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fix);
  function stop() {
    window.clearTimeout(timer);
    window.clearTimeout(cap);
    resize?.disconnect();
    window.removeEventListener("scroll", fix);
    window.removeEventListener("load", settle);
    for (const t of USER_EVENTS) window.removeEventListener(t, stop, true);
  }

  fix();
  resize?.observe(document.body);
  window.addEventListener("scroll", fix, { passive: true });
  for (const t of USER_EVENTS) window.addEventListener(t, stop, { capture: true, passive: true });
  if (document.readyState === "complete") settle();
  else window.addEventListener("load", settle, { once: true });
  return stop;
}
