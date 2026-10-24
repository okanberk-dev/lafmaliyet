"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { WITHDRAW_LOG } from "@/lib/staff-requests";
import { requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { withdrawOwn } from "@/server/staff-requests/core";

import { logActivity } from "./log";
import { attempt } from "./util";

// Ortak onay kuyruğunun genel eylemi (docs/ONAYLAR.md). İstek açma ve karar eylemleri her alanın kendi dosyasında
// (kasa, zayi, mal siparişi); bu dosyada yalnız geri çekme. "use server" dosyasındaki her dışa açık işlev bir uçtur:
// yardımcı yok.

/**
 * Personel kendi bekleyen isteğini geri çeker (koşullu: yalnız bekleyen ve kendisinin; aynı anda verilen onayla yarışta
 * tek sonuç kalır). Tutulan fotoğraflar 7 gün sonra silinmek üzere bırakılır. Dönüşte istek yok.
 */
export async function withdrawStaffRequest(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const rid = z.number().int().positive().parse(id);
    const row = await withdrawOwn(getDb(), me, rid);
    await logActivity(me, WITHDRAW_LOG[row.kind], row.title);
    refresh();
    return null;
  });
}
