import "server-only";

/**
 * Bugün'ün yükleyicileri için: bir kaynak düşerse sayfa yine açılır, ilgili satır "okunamadı" der ya da hiç çıkmaz,
 * hata sunucu günlüğüne yazılır. Her yükleyici bundan geçer (src/server/data/today.ts ve operasyonun
 * src/server/data/today-ops.ts'i).
 */
export function safe<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    console.error("[bugun]", e);
    return null;
  });
}
