import "server-only";

import { headers } from "next/headers";

import { actionErrorEntry } from "@/lib/error-log";

import { reportError } from "./store";

/** Eylemin çağrıldığı sayfa: Referer (yalnız yolu kayda girer; src/lib/error-log.ts cleanPath) */
async function callerPage(): Promise<string | null> {
  try {
    return (await headers()).get("referer");
  } catch {
    return null;
  }
}

/**
 * `attempt()`'in yakaladığı beklenmeyen hata (kullanıcı "İşlem tamamlanamadı" gördü) hata kaydına (docs/HATA-KAYDI.md).
 * Beklenmez, fırlatmaz; eylemin yanıtı gecikmez.
 */
export function reportActionError(err: unknown): void {
  void reportError(async () => actionErrorEntry(err, await callerPage()));
}
