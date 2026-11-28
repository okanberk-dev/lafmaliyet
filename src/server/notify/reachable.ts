import "server-only";

import { and, eq, sql, type SQL } from "drizzle-orm";

import type { Role } from "@/lib/constants";
import { getDb, schema as s, type DB } from "@/server/db";

/*
 * Bildirim alabilen hesap: TEK kural (docs/ROLLER.md › Müdür, docs/BILDIRIMLER.md › Alıcılar ve hesaplar). Etkin hesap ve
 * şubesi kapalı müdür DEĞİL. Müdür şubesine kilitlidir: şubesi pasife alınınca (ya da şubesi yoksa) oturumu yok sayılır,
 * girişi reddedilir (src/lib/roles.ts › managerWithoutBranch); hesabı ise "etkin" kalır. Alıcı sorguları yalnız
 * `users.active`'e bakarken panele giremeyen müdürün telefonuna ve e-postasına bildirim gitmeye devam ediyordu; kitle
 * kuralları da (featureAudience, countPushReaches) şubesi kapalı hesabı "şubesiz" saydığı için öbür şubelerinkiler de.
 * Personelde kural değişmez: şubesi kapanınca kilidi kalkar, hesabı kullanılır, bildirim alır.
 *
 * Web Push'un tek kapısı (src/server/push/send.ts › sendPush) ve kişiye e-posta gönderen işler (vardiya değişikliği,
 * kontrol listesi hatırlatması, karaoke) buradan okur. Şube yeniden açılınca müdür kendiliğinden yeniden alıcı olur.
 */

/** Okuma yapan her şey: veritabanı ya da açık bir işlem */
type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Sorgu koşulu (`s.users` sorgudaysa): hesap etkin ve şubesi kapalı (ya da şubesiz) müdür değil. `managerWithoutBranch`
 * ile aynı kural, SQL'de: müdürün şubesi kütükte ve açık olmalı
 */
export function reachableUser(): SQL {
  return and(
    eq(s.users.active, true),
    sql`not (${s.users.role} = 'manager' and not exists (select 1 from ${s.branches} where ${s.branches.id} = ${s.users.branchId} and ${s.branches.active} = true))`,
  )!;
}

export interface ReachableUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
}

/** Bildirim alabilen bütün hesaplar (kitle kuralları bu listeden seçer) */
export async function reachableUsers(db: Reader = getDb()): Promise<ReachableUser[]> {
  return db.select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, branchId: s.users.branchId }).from(s.users).where(reachableUser());
}
