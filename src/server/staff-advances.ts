import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { advanceProblem, advanceTotals, deleteProblem, type AdvanceKind, type AdvanceRow } from "@/lib/staff-advances";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";
import { UserError } from "@/server/user-error";

/*
 * Personel avansları (docs/PERSONEL-BELGE.md › Avans): hareketler staff_advances'ta, kurallar src/lib/staff-advances.ts'te.
 * Yazım kişinin satırı kilitlenerek yapılır (SELECT … FOR UPDATE): aynı anda iki kesinti kalan avansı aşamaz. Avans gider
 * değildir; hiçbir maliyet hesabına girmez. Çekirdekler veritabanını dışarıdan alır (tests/personel-belge-db.test.ts).
 */

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface AdvanceListRow extends AdvanceRow {
  staffName: string;
  branchId: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Kapsamdaki kişilerin hareketleri (eskiden yeniye) */
export async function listAdvances(db: DB, scope: BranchScope = ALL_BRANCHES): Promise<AdvanceListRow[]> {
  const rows = await db
    .select({
      id: s.staffAdvances.id,
      staffId: s.staffAdvances.staffId,
      staffName: s.staff.name,
      branchId: s.staff.branchId,
      date: s.staffAdvances.date,
      kind: s.staffAdvances.kind,
      amount: s.staffAdvances.amount,
      note: s.staffAdvances.note,
      createdByName: s.staffAdvances.createdByName,
      createdAt: s.staffAdvances.createdAt,
    })
    .from(s.staffAdvances)
    .innerJoin(s.staff, eq(s.staff.id, s.staffAdvances.staffId))
    .where(scope === ALL_BRANCHES ? undefined : eq(s.staff.branchId, scope))
    .orderBy(asc(s.staffAdvances.date), asc(s.staffAdvances.id));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Kişinin satırını kilitler (yoksa UserError) ve hareketlerini okur */
async function lockedRows(tx: Tx, staffId: number): Promise<{ name: string; rows: AdvanceRow[] }> {
  const [person] = await tx.select({ id: s.staff.id, name: s.staff.name }).from(s.staff).where(eq(s.staff.id, staffId)).for("update").limit(1);
  if (!person) throw new UserError("Kişi bulunamadı; sayfayı yenileyin.");
  const rows = await tx
    .select({ id: s.staffAdvances.id, staffId: s.staffAdvances.staffId, date: s.staffAdvances.date, kind: s.staffAdvances.kind, amount: s.staffAdvances.amount, note: s.staffAdvances.note })
    .from(s.staffAdvances)
    .where(eq(s.staffAdvances.staffId, staffId));
  return { name: person.name, rows };
}

export interface NewAdvance {
  staffId: number;
  kind: AdvanceKind;
  amount: number;
  date: string;
  note?: string | null;
}

/** Hareket ekler (avans ya da maaştan kesinti); kesinti kalan avansı aşamaz, ileri tarih olmaz. Kalan bakiye döner */
export async function addAdvance(db: DB, me: { id: number; name: string }, input: NewAdvance, today: string): Promise<{ id: number; staffName: string; balance: number }> {
  const amount = Math.round(input.amount * 100) / 100;
  return db.transaction(async (tx) => {
    const { name, rows } = await lockedRows(tx, input.staffId);
    const problem = advanceProblem({ kind: input.kind, amount, date: input.date }, { balance: advanceTotals(rows).balance, today });
    if (problem) throw new UserError(problem);
    const note = input.note ? input.note.replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
    const [row] = await tx
      .insert(s.staffAdvances)
      .values({ staffId: input.staffId, kind: input.kind, amount, date: input.date, note, createdBy: me.id, createdByName: me.name })
      .returning({ id: s.staffAdvances.id });
    const balance = advanceTotals([...rows, { kind: input.kind, amount }]).balance;
    return { id: row.id, staffName: name, balance };
  });
}

/** Hareketi siler: kesintisi yazılmış avans silinmez (bakiye eksiye düşerdi). Silinenin bilgisi döner */
export async function deleteAdvance(db: DB, id: number): Promise<{ staffName: string; kind: AdvanceKind; amount: number; date: string }> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ staffId: s.staffAdvances.staffId }).from(s.staffAdvances).where(eq(s.staffAdvances.id, id)).limit(1);
    if (!target) throw new UserError("Hareket bulunamadı; silinmiş olabilir.");
    const { name, rows } = await lockedRows(tx, target.staffId);
    const problem = deleteProblem(rows, id);
    if (problem) throw new UserError(problem);
    const [gone] = await tx
      .delete(s.staffAdvances)
      .where(eq(s.staffAdvances.id, id))
      .returning({ kind: s.staffAdvances.kind, amount: s.staffAdvances.amount, date: s.staffAdvances.date });
    if (!gone) throw new UserError("Hareket bulunamadı; silinmiş olabilir.");
    return { staffName: name, ...gone };
  });
}

/** Avans hareketi olan kişiler (kişi silinemez: hareketleriyle birlikte giderdi); kimlik → hareket sayısı */
export async function advanceCounts(tx: Tx | DB, staffIds: number[]): Promise<Map<number, number>> {
  if (!staffIds.length) return new Map();
  const rows = await tx
    .select({ staffId: s.staffAdvances.staffId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(s.staffAdvances)
    .where(and(inArray(s.staffAdvances.staffId, staffIds)))
    .groupBy(s.staffAdvances.staffId);
  return new Map(rows.map((r) => [r.staffId, r.n]));
}
