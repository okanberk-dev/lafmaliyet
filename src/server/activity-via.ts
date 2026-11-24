import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * İşlem geçmişinin "aracı" (docs/ASISTAN-ISLEMLER.md › İşlem geçmişi). Panel asistanının onay kartında Onayla'ya
 * basılınca asıl eylem `runViaAssistant` içinde çalışır; bu bağlam açıkken `activity_log`'a yazan her yer
 * (`logActivity`, karaoke sayacı, kapalı gün, kasa raporu) `via = 'asistan'` yazar. Eylemlerin imzası değişmez; kayıt
 * yine oturumdaki kişinin adına düşer, İşlem geçmişi "… (asistan aracılığıyla)" diye gösterir.
 */
export type ActivityVia = "asistan";

const viaStore = new AsyncLocalStorage<ActivityVia>();

/** `fn` içindeki bütün işlem geçmişi kayıtları "asistan aracılığıyla" yazılır */
export function runViaAssistant<T>(fn: () => Promise<T>): Promise<T> {
  return viaStore.run("asistan", fn);
}

/** Şu anki kaydın aracı (yoksa null: kişi ekrandan kendisi yaptı) */
export function currentVia(): ActivityVia | null {
  return viaStore.getStore() ?? null;
}
