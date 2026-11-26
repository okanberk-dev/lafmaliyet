/**
 * "Fotoğraf çek"in yolu (belge türleri; docs/FOTOGRAF.md › Canlı vizör): kullanılabiliyorsa canlı vizör
 * (live-camera.tsx: getUserMedia, kenarlar canlı, otomatik çekim), değilse ya da açılamazsa telefonun kendi kamera
 * uygulaması (<input capture>). Vizör yalnız ilk kullanımda iner (dinamik içe aktarma).
 *
 * Canlı vizör ne zaman denenmez: tarayıcıda getUserMedia yok, sayfa güvenli değil (http), panelin Permissions-Policy'si
 * kamerayı kapatıyor, ekran dokunmatik değil (masaüstünde dosya seçimi kalır; `force` geçer) ya da kamera izni daha
 * önce reddedildi / kamera açılamadı (bu tarayıcıda hatırlanır; izin sonradan verilince `refreshLiveCamera` siler).
 */

import type { LiveCameraOptions } from "./live-camera";

const BLOCKED_KEY = "laf:canli-kamera:kapali";

function blocked(): boolean {
  try {
    return window.localStorage.getItem(BLOCKED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Kamera izni reddedildi ya da kamera açılamadı: bu tarayıcıda sonraki çekimler doğrudan telefonun kamerasıyla */
export function markLiveCameraBlocked() {
  try {
    window.localStorage.setItem(BLOCKED_KEY, "1");
  } catch {
    // gizli sekme: her seferinde denenir
  }
}

interface PolicyDocument {
  permissionsPolicy?: { allowsFeature(f: string): boolean };
  featurePolicy?: { allowsFeature(f: string): boolean };
}

/** Canlı vizör bu tarayıcıda denenebilir mi (eşzamanlı: dokunuşun içinde karar verilir) */
export function liveCameraUsable(opts: { force?: boolean } = {}): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return false;
  const policy = (document as unknown as PolicyDocument).permissionsPolicy ?? (document as unknown as PolicyDocument).featurePolicy;
  try {
    if (policy && !policy.allowsFeature("camera")) return false;
  } catch {
    // eski tarayıcı: denenir, olmazsa vizör eski yola döner
  }
  if (!opts.force && !window.matchMedia?.("(pointer: coarse)").matches) return false;
  return !blocked();
}

/** Kamera izni sonradan verildiyse (ya da artık sorulabiliyorsa) hatırlanan "kapalı" silinir; arka planda */
export function refreshLiveCamera() {
  if (typeof window === "undefined" || !blocked() || !navigator.permissions?.query) return;
  navigator.permissions
    .query({ name: "camera" as PermissionName })
    .then((s) => {
      if (s.state !== "denied") window.localStorage.removeItem(BLOCKED_KEY);
    })
    .catch(() => {
      // Firefox / eski Safari kamera iznini sorgulatmaz: hatırlanan kalır
    });
}

/**
 * Fotoğraf çeker: canlı vizörle (çekilen dosya döner) ya da `input`'u (capture'lı dosya alanı) tıklatarak (dosya
 * onun `change` olayıyla gelir, burada null). Vizör kapatıldıysa null. Dokunuşun içinde çağrılmalı: vizör açılamazsa
 * eski yol aynı dokunuşla açılır
 */
export async function shootPhoto(input: HTMLInputElement | null, opts: LiveCameraOptions & { force?: boolean } = {}): Promise<File | null> {
  if (!liveCameraUsable(opts)) {
    input?.click();
    return null;
  }
  let mod: typeof import("./live-camera");
  try {
    mod = await import("./live-camera");
  } catch {
    input?.click();
    return null;
  }
  const res = await mod.openLiveCamera(opts).result;
  if (res?.kind === "photo") return res.file;
  if (res?.kind === "fallback") {
    if (res.remember) markLiveCameraBlocked();
    input?.click();
  }
  return null;
}
