"use client";

import { deletePushSubscription, savePushSubscription } from "@/server/actions/push";

/**
 * Tarayıcı tarafı bildirim aboneliği: service worker (/sw.js, kapsamı /panel/) kaydı, izin, abonelik ve sunucuya
 * kayıt. Bildirim içeriği şifreli gelir; sw.js gösterir ve açık sekmeye haber verir (alert-center.tsx).
 */

export type PushSupport = "unsupported" | "default" | "granted" | "denied";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission as PushSupport;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register("/sw.js", { scope: "/panel/" }).catch((e: unknown) => {
    console.warn("[bildirim] service worker kaydedilemedi", e);
    registration = null;
    return null;
  });
  return registration;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** "Chrome · Windows", "Safari · iPhone" */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Tarayıcı";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Bu cihazı bildirimlere abone eder (izin yoksa önce sorar; `ask` false ise sormaz, yalnız izin verilmişse yeniler).
 * Sunucunun anahtarı değiştiyse eski abonelik bırakılıp yenisi alınır. Sonuç: abonelik tercihleri ya da hata metni.
 */
export async function subscribeDevice(
  publicKey: string,
  ask: boolean,
): Promise<{ ok: true; karaoke: boolean; reminders: boolean; orders: boolean } | { ok: false; error: string }> {
  if (pushSupport() === "unsupported") return { ok: false, error: "Bu tarayıcı bildirim desteklemiyor" };
  let permission = Notification.permission;
  if (permission === "default" && ask) permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: permission === "denied" ? "Bildirim izni kapalı: tarayıcının site ayarlarından izin verin" : "Bildirim izni verilmedi" };
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, error: "Bildirim servisi başlatılamadı" };
  try {
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, publicKey)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, error: "Abonelik bilgisi eksik" };
    const res = await savePushSubscription({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, label: deviceLabel() });
    return res.ok ? { ok: true, ...res.data } : { ok: false, error: res.error };
  } catch {
    // Gizli pencere, tarayıcının push servisini engelleyen ağ ya da kesilen bağlantı: düğme takılı kalmasın
    return { ok: false, error: "Tarayıcının bildirim servisine ulaşılamadı (gizli pencere ya da ağ engeli olabilir); normal pencerede yeniden deneyin" };
  }
}

export async function currentEndpoint(): Promise<string | null> {
  const reg = await registerServiceWorker();
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

/** Bu cihazda bildirimleri kapatır (sunucudan siler, aboneliği bırakır) */
export async function unsubscribeDevice(): Promise<void> {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await deletePushSubscription(sub.endpoint).catch(() => null);
  await sub.unsubscribe().catch(() => false);
}

/** Çıkışta: bu cihaza başkasının bildirimi gelmesin (en çok 1,5 saniye beklenir) */
export async function forgetDeviceOnSignOut(): Promise<void> {
  if (pushSupport() === "unsupported") return;
  await Promise.race([unsubscribeDevice(), new Promise((r) => setTimeout(r, 1500))]);
}
