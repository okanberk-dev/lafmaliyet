"use server";

import type { OpOutcome } from "@/lib/assistant/ops";
import { requireUser } from "@/server/auth/dal";
import { cancelOp, confirmOp, readOp, undoOp } from "@/server/assistant-ops/confirm";

/*
 * Panel asistanının onay kartı düğmeleri (docs/ASISTAN-ISLEMLER.md). Yazım YALNIZ burada olur: kullanıcı karttaki
 * Onayla'ya basınca. Asistan kendi kartını onaylayamaz: bu bir Server Action'dır (Next'in köken denetimi), sohbet ucu
 * bunu çağırmaz. Oturum burada okunur; yönetici değilse hiçbir şey yapılmaz (kurallar confirm.ts'te). Asıl eylemler
 * kendi `requireAdmin`'lerini ve refresh()'lerini çalıştırır: ekran onaydan sonra yenilenir.
 */

/** Kartın Onayla'sı: planı tek kullanımlık tüketir, yeniden doğrular, asıl eylemi çağırır */
export async function confirmAssistantOp(opId: string): Promise<OpOutcome> {
  const me = await requireUser();
  return confirmOp({ id: me.id, name: me.name, role: me.role }, opId);
}

/** Kartın Vazgeç'i: bekleyen plan kapanır, hiçbir şey değişmez */
export async function cancelAssistantOp(opId: string): Promise<OpOutcome> {
  const me = await requireUser();
  return cancelOp({ id: me.id, name: me.name, role: me.role }, opId);
}

/** Kartın durumu (salt okur): sayfa işlem sürerken yenilendiyse kart sonucu buradan okur */
export async function readAssistantOp(opId: string): Promise<OpOutcome> {
  const me = await requireUser();
  return readOp({ id: me.id, name: me.name, role: me.role }, opId);
}

/** Sonuç kartının Geri al'ı (yalnız katalogda geri alması tanımlı işlemlerde, 1 saat) */
export async function undoAssistantOp(opId: string): Promise<OpOutcome> {
  const me = await requireUser();
  return undoOp({ id: me.id, name: me.name, role: me.role }, opId);
}
