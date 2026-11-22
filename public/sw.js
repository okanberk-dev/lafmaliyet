/*
 * L'Affogato panelinin service worker'ı (kapsamı /panel/). Yalnız bildirim işi yapar: sayfa önbelleklemez, istekleri
 * yakalamaz (panel verisi her zaman sunucudan gelir).
 *
 * - push: şifreli gelen bildirimi (src/server/push/send.ts) gösterir ve açık panel sekmelerine haber verir (sekme
 *   canlı veriyi yeniler, gerekirse zil çalar; src/components/panel/live/alert-center.tsx). Panel sekmesi o an öndeyse
 *   sistem bildirimi yerine sekme kendisi gösterir. Sesi açık bir sekme kendisi (seçilen hoparlörden) çalacaksa sistem
 *   bildirimi sessizdir: işletim sisteminin bildirim sesi varsayılan çıkıştan, ör. müziğin çaldığı Bluetooth
 *   hoparlörden gelirdi. "Yalnız bu bilgisayar" açık cihazda (Tuzla Köyiçi) sistem bildirimi hep sessizdir.
 * - notificationclick: açık panel sekmesini öne getirir ve ilgili ekrana gider; yoksa yeni sekme açar.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let msg = { kind: "test", title: "L'Affogato", body: "Panelde yeni bir şey var.", url: "/panel", tag: "laf", requireInteraction: false, ring: false };
      try {
        if (event.data) msg = { ...msg, ...event.data.json() };
      } catch {
        // Okunamayan içerik: genel bildirim
      }
      const url = typeof msg.url === "string" && msg.url.startsWith("/panel") ? msg.url : "/panel";
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const panels = windows.filter((c) => new URL(c.url).pathname.startsWith("/panel"));
      const pageRings = await tellPanels(panels, { type: "laf:push", kind: msg.kind, title: msg.title, body: msg.body, url, ring: Boolean(msg.ring) });
      // "Yalnız bu bilgisayar" (Tuzla Köyiçi): sistemin bildirim sesi genel hoparlörden çalardı, hep sessiz
      const quiet = pageRings || (await quietDevice());
      // Panel sekmesi öndeyse ve görünüyorsa bildirimi sekme gösterir (zil + kart); değilse sistem bildirimi
      if (panels.some((c) => c.focused && c.visibilityState === "visible")) return;
      await self.registration.showNotification(String(msg.title).slice(0, 120), {
        body: String(msg.body).slice(0, 300),
        tag: String(msg.tag || "laf"),
        renotify: true,
        silent: quiet,
        requireInteraction: Boolean(msg.requireInteraction),
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        lang: "tr",
        data: { url },
      });
    })(),
  );
});

/**
 * Açık panel sekmelerine haber verir; sekmelerden biri sesi kendisi çalacağını söylerse (ses açık ve açılmış, bu
 * cihazda o uyarı açık) true. Yanıt gelmezse (sekme donmuş, eski sürüm) en çok 800 ms beklenir: bildirim sesli gider.
 */
function tellPanels(panels, message) {
  if (!panels.length) return Promise.resolve(false);
  return new Promise((resolve) => {
    let waiting = panels.length;
    const timer = setTimeout(() => resolve(false), 800);
    const answer = (rings) => {
      waiting -= 1;
      if (rings || waiting === 0) {
        clearTimeout(timer);
        resolve(Boolean(rings));
      }
    };
    for (const c of panels) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => answer(Boolean(e.data && (e.data.willRing || e.data.quiet)));
      try {
        c.postMessage(message, [channel.port2]);
      } catch {
        answer(false);
      }
    }
  });
}

/**
 * Bu cihazda "yalnız bu bilgisayar" açık mı: panel işareti Cache deposuna yazar (src/components/panel/live/
 * output-client.ts › syncQuietFlag); panel hiç açık değilken gelen bildirim de sessiz gelir.
 */
async function quietDevice() {
  try {
    const store = await caches.open("laf-ayar");
    return Boolean(await store.match("/panel/__sessiz-bildirim"));
  } catch {
    return false;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/panel";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const panel = windows.find((c) => new URL(c.url).pathname.startsWith("/panel"));
      if (panel) {
        await panel.focus();
        if (new URL(panel.url).pathname !== url && "navigate" in panel) await panel.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
