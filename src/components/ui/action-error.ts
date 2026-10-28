"use client";

import { unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";

/**
 * Sunucu eylemi yanıt yerine hata atarsa (ağ kesildi, sunucuya ulaşılamadı ya da panel yeniden yayınlandı ve sayfa
 * eski): sayfa hata ekranına düşmez, formda yazılanlar yerinde kalır, bildirim çıkar. Eylemlerin kendi hataları
 * (attempt → { ok: false }) bundan geçmez; onlar zaten yanıt olarak gelir. Yönlendirme gibi Next'in kendi hataları
 * geri atılır. Kontrol listesi formu (src/app/panel/kontrol/[id]/run-form.tsx) aynı metinleri kullanır.
 */
export const OFFLINE_TEXT = "Kaydedilemedi: bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.";
export const STALE_TEXT = "Panel güncellendi; sayfayı yenileyip yeniden deneyin.";
const FAILED_TEXT = "İşlem tamamlanamadı; sayfayı yenileyip yeniden deneyin.";
/** Formun kendi satırında (kayıt değil: giriş, parola onayı) */
const UNREACHABLE_TEXT = "Bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.";

/** Tarayıcının ağ hatası (Chrome "Failed to fetch", Firefox "NetworkError…", Safari "Load failed") */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError && /fetch|network|load failed/i.test(e.message);
}

/**
 * Atılan eylem hatasının türü, bildirim çıkarmadan kendi yerinde gösterenler için (zil, okuma pencereleri): panel
 * güncellendi (sayfa yenilenmeli) ya da istek düştü (yeniden denenebilir). Next'in kendi hataları geri atılır.
 */
export function actionFailure(e: unknown): "stale" | "failed" {
  unstable_rethrow(e);
  return unstable_isUnrecognizedActionError(e) ? "stale" : "failed";
}

/**
 * Atılan eylem hatasının metni, bildirim yerine formun kendi hata satırında gösterenler için (parola penceresi, giriş
 * formları). Next'in kendi hataları (yönlendirme) geri atılır.
 */
export function actionErrorText(e: unknown): string {
  unstable_rethrow(e);
  if (unstable_isUnrecognizedActionError(e)) return STALE_TEXT;
  if (isNetworkError(e)) return UNREACHABLE_TEXT;
  console.error(e);
  return FAILED_TEXT;
}

/**
 * Eylemi geçişsiz çağıranlar için (düğmenin kendi `busy` durumu, pencere, iyimser satır): eylem atarsa (ağ kesildi,
 * panel güncellendi) bildirim çıkar ve `undefined` döner; çağıran düğmeyi bırakır, pencere ve yazılanlar yerinde kalır,
 * iyimser değişikliği geri alır. Eylemin kendi hatası (`{ ok: false }`) yanıt olarak gelir, bundan geçmez. Next'in
 * kendi hataları (yönlendirme) geri atılır.
 */
export async function tryAction<T>(fn: () => Promise<T>, id?: string | number): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toastUnreachable(e, id);
    return undefined;
  }
}

/**
 * useActionState'in eylemi atarsa (ağ kesildi, panel güncellendi) React hatayı en yakın hata sınırına atar ve sayfa
 * hata ekranına düşer. Bu sarmalayıcıyla form önceki durumunda kalır, hata formun kendi `error` satırında görünür
 * (yönlendirme gibi Next'in kendi hataları geri atılır). Bileşenin dışında, modül düzeyinde bir kez sarılır.
 */
export function catchingFormAction<S extends { error?: string }, P>(action: (state: S, payload: P) => Promise<S>): (state: S, payload: P) => Promise<S> {
  return async (state, payload) => {
    try {
      return await action(state, payload);
    } catch (e) {
      return { ...state, error: actionErrorText(e) };
    }
  };
}

/** Atılan eylem hatasının bildirimi; `id` verilirse art arda dokunuşlar üst üste yığılmaz */
export function toastUnreachable(e: unknown, id?: string | number): void {
  unstable_rethrow(e);
  if (unstable_isUnrecognizedActionError(e)) {
    toast.error(STALE_TEXT, { id, duration: 30_000, action: { label: "Yenile", onClick: () => window.location.reload() } });
  } else if (isNetworkError(e)) {
    toast.error(OFFLINE_TEXT, { id });
  } else {
    console.error(e);
    toast.error(FAILED_TEXT, { id });
  }
}

/**
 * useTransition gibi; geçişin içindeki eylem atarsa hata sayfayı düşürmez (toastUnreachable). Atılan noktadan sonraki
 * satırlar çalışmadığı için formu boşaltan kod da çalışmaz: yazılanlar ekranda kalır, yeniden denenir.
 */
export function useActionTransition(): [boolean, (fn: () => unknown) => void] {
  const [pending, start] = useTransition();
  const run = useCallback(
    (fn: () => unknown) =>
      start(async () => {
        try {
          await fn();
        } catch (e) {
          toastUnreachable(e);
        }
      }),
    [start],
  );
  return [pending, run];
}
