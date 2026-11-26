"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { WITHDRAW_LOG } from "@/lib/staff-requests";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { withdrawRequestCore } from "@/server/karaoke/timer";

import { logActivity } from "./log";
import { attempt } from "./util";

// Ortak onay kuyruğunun genel eylemi (docs/ONAYLAR.md). İstek açma ve karar eylemleri her alanın kendi dosyasında
// (kasa, zayi, kapalı gün); bu dosyada yalnız geri çekme. "use server" dosyasındaki her dışa açık işlev bir uçtur:
// yardımcı yok.

/**
 * Personel kendi bekleyen isteğini geri çeker (koşullu: yalnız bekleyen ve kendisinin; aynı anda verilen onayla yarışta
 * tek sonuç kalır). Tutulan fotoğraflar 7 gün sonra silinmek üzere bırakılır. Karaoke sayacının silme isteğinde iz ve
 * karaoke sayacı geri çekmeyle aynı işlemde (bar ekranının satırı canlı uçtan iner); öteki türlerin izi sonra. Dönüşte
 * istek yok.
 */
export async function withdrawStaffRequest(id: number) {
  return attempt(async () => {
    const me = adminActor(await requireCan("kayit.yaz"));
    const rid = z.number().int().positive().parse(id);
    const { row, traced } = await withdrawRequestCore(getDb(), me, rid);
    if (!traced) await logActivity(me, WITHDRAW_LOG[row.kind], row.title);
    refresh();
    return null;
  });
}
