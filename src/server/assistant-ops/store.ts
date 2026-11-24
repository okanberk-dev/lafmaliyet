import "server-only";

import { and, eq, gt, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { OP_UNDO_MS, type OpStatus } from "@/lib/assistant/ops";
import { getDb, schema as s } from "@/server/db";

/*
 * Onay kartlarının planları (assistant_ops; docs/ASISTAN-ISLEMLER.md › Tek kullanımlık onay). Her geçiş tek koşullu
 * UPDATE'tir: sahibi, durumu ve süresi aynı sorguda denetlenir. Satır dönmezse hiçbir şey yapılmaz; çift dokunuş ve
 * yeniden gönderilen istek ikinci kayıt açamaz.
 */

export type OpRow = typeof s.assistantOps.$inferSelect;

/** Kimlik uuid değilse sorgu hiç gitmez (Postgres'in tür hatası yerine "bulunamadı") */
export const parseOpId = (raw: unknown): string | null => {
  const r = z.uuid().safeParse(raw);
  return r.success ? r.data : null;
};

export async function createPlan(p: { userId: number; tool: string; input: unknown; preview: unknown; branch: string | null; expiresAt: Date }): Promise<{ id: string }> {
  const [row] = await getDb()
    .insert(s.assistantOps)
    .values({ userId: p.userId, tool: p.tool, input: p.input, preview: p.preview, branch: p.branch, expiresAt: p.expiresAt })
    .returning({ id: s.assistantOps.id });
  return row;
}

/** Onay: bekleyen, süresi geçmemiş ve bu kullanıcının planı "running" olur ve döner; yoksa null (hiçbir şey yapılmaz) */
export async function consumePlan(id: string, userId: number, now: Date = new Date()): Promise<OpRow | null> {
  const [row] = await getDb()
    .update(s.assistantOps)
    .set({ status: "running" })
    .where(and(eq(s.assistantOps.id, id), eq(s.assistantOps.userId, userId), eq(s.assistantOps.status, "pending"), gt(s.assistantOps.expiresAt, now)))
    .returning();
  return row ?? null;
}

/** Bu kullanıcının planı (başkasınınki yokmuş gibi) */
export async function getPlan(id: string, userId: number): Promise<OpRow | null> {
  const [row] = await getDb()
    .select()
    .from(s.assistantOps)
    .where(and(eq(s.assistantOps.id, id), eq(s.assistantOps.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Çalışan planı kapatır (yalnız "running" iken) */
export async function finishPlan(id: string, status: Extract<OpStatus, "done" | "failed" | "unknown">, result: { message: string }, undo: unknown = null): Promise<void> {
  await getDb()
    .update(s.assistantOps)
    .set({ status, result, undo: undo ?? null, doneAt: new Date() })
    .where(and(eq(s.assistantOps.id, id), eq(s.assistantOps.status, "running")));
}

/** Süresi geçen bekleyen planı "expired" yapar */
export async function expirePlan(id: string, now: Date = new Date()): Promise<void> {
  await getDb()
    .update(s.assistantOps)
    .set({ status: "expired" })
    .where(and(eq(s.assistantOps.id, id), eq(s.assistantOps.status, "pending"), lte(s.assistantOps.expiresAt, now)));
}

/** Vazgeç: yalnız bekleyen ve bu kullanıcının planı */
export async function cancelPlan(id: string, userId: number): Promise<boolean> {
  const rows = await getDb()
    .update(s.assistantOps)
    .set({ status: "cancelled", doneAt: new Date() })
    .where(and(eq(s.assistantOps.id, id), eq(s.assistantOps.userId, userId), eq(s.assistantOps.status, "pending")))
    .returning({ id: s.assistantOps.id });
  return rows.length > 0;
}

/** Geri al: yapılmış, geri alma görüntüsü olan, süresi geçmemiş planı "undoing" yapar (tek kullanımlık) */
export async function claimUndo(id: string, userId: number, since: Date): Promise<OpRow | null> {
  const [row] = await getDb()
    .update(s.assistantOps)
    .set({ status: "undoing" })
    .where(
      and(
        eq(s.assistantOps.id, id),
        eq(s.assistantOps.userId, userId),
        eq(s.assistantOps.status, "done"),
        isNotNull(s.assistantOps.undo),
        sql`${s.assistantOps.undo} <> 'null'::jsonb`,
        gt(s.assistantOps.doneAt, since),
      ),
    )
    .returning();
  return row ?? null;
}

/** Bir eylemin en uzun süresinden epey fazla: bundan eski "running" / "undoing" satırı yarıda kalmıştır */
export const STUCK_AFTER_MS = 15 * 60_000;

/**
 * Yarıda kalan planlar (sunucu eylemi kesildi, süreç yeniden başladı): süresi (onay) ya da geri al penceresi bittikten
 * STUCK_AFTER_MS sonra hâlâ "running" / "undoing" olan plan "unknown" olur (yazım olmuş olabilir). Yalnız bu
 * kullanıcının bu planı; kartın durumu okunurken çağrılır.
 */
export async function settleStuck(id: string, userId: number, now: Date = new Date()): Promise<void> {
  const runningSince = new Date(now.getTime() - STUCK_AFTER_MS);
  const undoingSince = new Date(now.getTime() - OP_UNDO_MS - STUCK_AFTER_MS);
  await getDb()
    .update(s.assistantOps)
    .set({ status: "unknown" })
    .where(
      and(
        eq(s.assistantOps.id, id),
        eq(s.assistantOps.userId, userId),
        or(
          and(eq(s.assistantOps.status, "running"), lt(s.assistantOps.expiresAt, runningSince)),
          and(eq(s.assistantOps.status, "undoing"), lt(s.assistantOps.doneAt, undoingSince)),
        ),
      ),
    );
}

/** Geri almanın sonucu: başardıysa "undone", olmadıysa yeniden "done" (kart yapılmış kalır), beklenmeyende "unknown" */
export async function finishUndo(id: string, status: "undone" | "done" | "unknown", message: string): Promise<void> {
  await getDb()
    .update(s.assistantOps)
    .set({
      status,
      ...(status === "undone" ? { undoneAt: new Date() } : {}),
      result: sql`coalesce(${s.assistantOps.result}, '{}'::jsonb) || ${JSON.stringify({ undoMessage: message })}::jsonb`,
    })
    .where(and(eq(s.assistantOps.id, id), eq(s.assistantOps.status, "undoing")));
}
