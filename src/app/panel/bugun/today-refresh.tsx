"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { liveNow } from "@/components/panel/live/store";

/** Sekme bundan uzun gizli kaldıysa görünür olunca ekran yenilenir */
const HIDDEN_STALE_MS = 60_000;
/** Başka ekrana gidilip geri dönülünce aynı çizim bundan eskiyse yenilenir (StrictMode'un çift kurulumu sayılmaz) */
const SHOWN_AGAIN_STALE_MS = 5_000;
/** Bağlantıyla dönülünce yeni çizim zaten gelir: bu kadar beklenir, gelmediyse (geri tuşu) ekran yenilenir */
const SHOWN_AGAIN_WAIT_MS = 1_500;

/**
 * Bugün ekranını saat sınırlarında kendiliğinden yeniler (`at`: sıradaki 00:00, 05:00, 20:00 ya da karaoke oturumunun
 * başlaması / bitmesi; bugun/logic.ts nextRefreshAt): gündüz "Akşam" diyen kasa satırı 20:00'de "Yapılacak" olur.
 * Sunucu saatine göre sayar (liveNow; cihazın saati yanlış olsa da). Sekme bir dakikadan uzun gizli kalıp görünür
 * olunca da yenilenir. Activity sayfayı gizleyince efekt temizlenir (gizli sayfada zamanlayıcı kalmaz), sayfa yeniden
 * görününce kurulur: geri tuşuyla dönülünce korunan eski çizim görünür, o zaman da yenilenir (Kasa'da gönderilen rapor,
 * Ödemeler'de ödenen kayıt Bugün'e yansısın). `renderedAt`: her yenilemede zamanlayıcı yeniden kurulsun (saat
 * sınırından hemen önce çizilen sayfa aynı `at`'i getirir).
 */
export function TodayRefresh({ at, renderedAt }: { at: number; renderedAt: string }) {
  const router = useRouter();
  // Bu çizimin ilk görüldüğü an (cihaz saatiyle; ref Activity'de korunur)
  const seen = useRef<{ renderedAt: string; since: number } | null>(null);
  useEffect(() => {
    const prev = seen.current;
    const shownAgain = prev?.renderedAt === renderedAt && Date.now() - prev.since > SHOWN_AGAIN_STALE_MS;
    if (prev?.renderedAt !== renderedAt) seen.current = { renderedAt, since: Date.now() };
    let hiddenSince: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const timers = [window.setTimeout(() => router.refresh(), Math.max(0, at - liveNow()) + 5_000)];
    if (shownAgain) timers.push(window.setTimeout(() => router.refresh(), SHOWN_AGAIN_WAIT_MS));
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince ??= Date.now();
        return;
      }
      const stale = hiddenSince !== null && Date.now() - hiddenSince > HIDDEN_STALE_MS;
      hiddenSince = null;
      if (stale) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      for (const t of timers) window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [at, renderedAt, router]);
  return null;
}
