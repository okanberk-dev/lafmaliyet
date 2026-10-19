import { useEffect } from "react";

/**
 * Sunucu eyleminden sonra sayfanın başa sıçramasını önler.
 *
 * Süzgeçler adrese `history.replaceState` ile yazılır (sunucuya gitmeden). Next yönlendiricisi son sunucu
 * çiziminin arama metnini hatırlar; eylemden sonraki yenilemede adres farklı olduğu için sayfayı yeni sayılır ve
 * başa kaydırır (ör. 40. satırı eşleştirince liste başa kaçar). Eylemden hemen önce `keepScroll()` çağrılır;
 * sayfanın istemci bileşeni `useSettleScroll(sunucudanGelenProp)` ile yenilemenin işlendiğini bildirir.
 *
 * - Ön plandaki sekmede kaydırma olayı sıçramayı boyamadan önce geri alır.
 * - Yenileme işlenince (Next'in kaydırmasından sonra çalışan etki) son bir denetim yapılır ve koruma biter.
 * - Kullanıcı kaydırır, dokunur ya da tuşa basarsa koruma hemen biter; içerik kısalınca (satır silindi)
 *   tarayıcının kendi kırpması sıçrama sayılmaz.
 *
 * Süzgeç yazan her sayfada bu koruma ayrıca kendiliğinden kurulur (aşağıda `markUrlWritten`): sayfaların her
 * eylemden önce `keepScroll()` çağırması gerekmez.
 */
let current: { y: number; path: string; stop: () => void } | null = null;

const USER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** Koruma kurulduğu sayfada kaldıysa konumu geri verir; eylemden sonra başka sayfaya geçildiyse dokunmaz */
function restore(guard: { y: number; path: string; stop: () => void }) {
  if (window.location.pathname !== guard.path) {
    guard.stop();
    return;
  }
  const target = Math.min(guard.y, document.documentElement.scrollHeight - window.innerHeight);
  if (window.scrollY < target - 40) window.scrollTo({ top: target, behavior: "instant" });
}

export function keepScroll(maxMs = 15_000) {
  if (typeof window === "undefined") return;
  current?.stop();
  const y = window.scrollY;
  const path = window.location.pathname;
  const onScroll = () => restore(guard);
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener("scroll", onScroll);
    for (const t of USER_EVENTS) window.removeEventListener(t, stop, true);
    if (current?.stop === stop) current = null;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  for (const t of USER_EVENTS) window.addEventListener(t, stop, { capture: true, passive: true });
  const timer = setTimeout(stop, maxMs);
  const guard = { y, path, stop };
  current = guard;
}

/** Sunucudan yeni veri geldiğinde (eylem sonrası yenileme işlendi) son kez denetler ve korumayı bitirir */
export function useSettleScroll(serverValue: unknown) {
  useEffect(() => {
    const guard = current;
    if (!guard) return;
    restore(guard);
    guard.stop();
  }, [serverValue]);
}

/** Korumayı hemen bitirir: eylemden sonra sayfa bilerek başka bir satıra kaydıracaksa (ör. yeni satırı göster) */
export function releaseScroll() {
  current?.stop();
}

/*
 * Otomatik koruma. filters.tsx süzgeci adrese yazınca `markUrlWritten()` çağırır; o sayfada Next'in gönderdiği her
 * sunucu eylemi isteğinde (POST + `next-action` başlığı) keepScroll kurulur ve yanıt bütünüyle gelip işlendikten
 * kısa süre sonra biter. Next eylem isteğini global fetch ile yapar; bu değişirse yalnızca koruma devre dışı kalır.
 */
let touchedPath: string | null = null;
let installed = false;

/** Adrese istemcide süzgeç yazıldı: yönlendiricinin bu sayfa için bildiği arama metni artık eski */
export function markUrlWritten() {
  if (typeof window === "undefined") return;
  touchedPath = window.location.pathname;
  if (installed) return;
  installed = true;
  const original = window.fetch;
  window.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const pending = original.call(window, input, init);
    if (touchedPath !== window.location.pathname || !isServerAction(init)) return pending;
    keepScroll();
    const armed = current;
    // Yenilenen sayfa aynı yanıtın içinde akar: gövde bitince React'in işlemesine kısa bir süre tanınır
    const settle = () => {
      setTimeout(() => {
        if (!armed || current !== armed) return;
        // Kaydırma olayı gelmediyse (arka plandaki sekme) son bir denetim
        restore(armed);
        armed.stop();
      }, 800);
    };
    pending.then((res) => {
      try {
        res.clone().arrayBuffer().then(settle, settle);
      } catch {
        settle();
      }
    }, settle);
    return pending;
  };
}

function isServerAction(init?: RequestInit) {
  if (!init?.headers || init.method?.toUpperCase() !== "POST") return false;
  try {
    return new Headers(init.headers).has("next-action");
  } catch {
    return false;
  }
}
