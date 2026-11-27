import "server-only";

import { eq, inArray } from "drizzle-orm";

import { currentMonthTR } from "@/lib/calc/engine";
import { ASILPOS_VERSION } from "@/lib/asilpos/day";
import { classifyWorkedStaff, posStaffItems, staffIdOfRef, type PosStaffItem, type WorkedStaffAnswer } from "@/lib/asilpos/personel";
import { checkPosStaffRequest } from "@/lib/asilpos/personel-istek";
import { getDb, schema as s, type DB } from "@/server/db";

import { asilposBranchId } from "./branch";
import type { EndpointResult } from "./ingest";

/**
 * AsilPOS personel bağlantısının lafmaliyet tarafı (LM-4b; docs/ASILPOS.md › Personel bağlantısı). Kurallar saf dosyada
 * (src/lib/asilpos/personel.ts); burada yalnız okuma. Hiçbir şey yazılmaz.
 */

/**
 * Şubenin personel listesi (`GET /api/panel/pos/personel`): maaş satırlarının yalnız kimliği, adı, şubesi, aralığı ve
 * bağlantısı; bağlı giriş hesabının yalnız görünen adı. Hep şubenin kendi satırlarından (seçili şube okunmaz)
 */
export async function loadPosStaff(db: DB, sube: string, month: string): Promise<PosStaffItem[]> {
  const rows = await db
    .select({ id: s.staff.id, name: s.staff.name, branchId: s.staff.branchId, startMonth: s.staff.startMonth, endMonth: s.staff.endMonth, userId: s.staff.userId, personRef: s.staff.personRef })
    .from(s.staff)
    .where(eq(s.staff.branchId, sube));
  const ids = [...new Set(rows.flatMap((r) => (r.userId === null ? [] : [r.userId])))];
  const users = ids.length ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : [];
  return posStaffItems({ rows, accounts: new Map(users.map((u) => [u.id, u.name])), sube, month });
}

/**
 * İmza ve şube denetimi, sonra okuma: 200 `{ version: 1, now, sube, items: [{ ref, name, active, account }] }` (`now`
 * okumadan sonra; "bu ay" Türkiye saatine göre), 400 `{ error: "invalid", field: "sube" }`, 401, 409
 * `{ error: "wrong_branch", sube, expected }`, 503.
 */
export async function servePosStaff(
  input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date },
  load: (sube: string, month: string) => Promise<PosStaffItem[]> = (sube, month) => loadPosStaff(getDb(), sube, month),
): Promise<EndpointResult> {
  const now = input.now ?? new Date();
  // Beklenen şube kütükten (kasa kaynağı AsilPOS olan şube, yoksa Marina; önbellekli)
  const check = checkPosStaffRequest({ ...input, now: now.getTime(), expected: await asilposBranchId() });
  if (!check.ok) return { status: check.status, body: check.body };
  const items = await load(check.sube, currentMonthTR(now));
  return { status: 200, body: { version: ASILPOS_VERSION, now: (input.now ?? new Date()).toISOString(), sube: check.sube, items } };
}

/**
 * Gün sonu gövdesindeki kimliklerin sınıfı (200 yanıtının `staff`'ı; src/server/asilpos/status.ts handlePosDay): yalnız
 * kimliklerin satırları okunur (şube ve aralık)
 */
export async function workedStaffAnswer(db: DB, refs: readonly string[], date: string): Promise<WorkedStaffAnswer> {
  const ids = [...new Set(refs.flatMap((r) => staffIdOfRef(r) ?? []))];
  const rows = ids.length
    ? await db.select({ id: s.staff.id, branchId: s.staff.branchId, startMonth: s.staff.startMonth, endMonth: s.staff.endMonth }).from(s.staff).where(inArray(s.staff.id, ids))
    : [];
  return classifyWorkedStaff(refs, new Map(rows.map((r) => [r.id, r])), date, await asilposBranchId(db));
}
