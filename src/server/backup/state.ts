import "server-only";

import { eq, sql } from "drizzle-orm";

import type { LastBackup } from "@/lib/backup/format";
import { getDb, schema as s } from "@/server/db";
import { open, seal } from "@/server/secret-box";

/** Son yedeğin kaydı (integration_state); dosya tamamen gönderilince yazılır */
export const LAST_BACKUP_KEY = "backup.last";
/** Parolayla verilen indirme bağlantısının süresi */
const HANDLE_MS = 120_000;

/**
 * Parola onayından sonra verilen indirme bağlantısının mühürlü değeri: kişi, belgeler dahil mi, dosya adı, süre.
 * İndirme düz bir bağlantı (tarayıcı dosyayı kendisi kaydeder); parola rotaya gitmez, rota yalnız bunu açar.
 */
export function backupHandle(userId: number, documents: boolean, fileName: string): string {
  return seal(JSON.stringify({ u: userId, d: documents, f: fileName, exp: Date.now() + HANDLE_MS }), "backup");
}

/** Mühürlü değerden indirme bilgisi; kişi tutmuyorsa, süresi geçtiyse ya da bozuksa null */
export function openBackupHandle(handle: string, userId: number): { documents: boolean; fileName: string } | null {
  const raw = handle ? open(handle, "backup") : null;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { u?: unknown; d?: unknown; f?: unknown; exp?: unknown };
    if (v.u !== userId || typeof v.d !== "boolean" || typeof v.f !== "string" || typeof v.exp !== "number" || v.exp < Date.now()) return null;
    return { documents: v.d, fileName: v.f };
  } catch {
    return null;
  }
}

function asLastBackup(v: unknown): LastBackup | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== "string" || !Number.isFinite(Date.parse(o.at))) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { at: o.at, by: typeof o.by === "string" ? o.by : "", bytes: n(o.bytes), rows: n(o.rows), tables: n(o.tables), documents: o.documents === true, docCount: n(o.docCount) };
}

export async function readLastBackup(): Promise<LastBackup | null> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, LAST_BACKUP_KEY)).limit(1);
  return asLastBackup(row?.value);
}

export async function saveLastBackup(v: LastBackup): Promise<void> {
  await getDb()
    .insert(s.integrationState)
    .values({ key: LAST_BACKUP_KEY, value: v })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: v, updatedAt: new Date() } });
}

/** Panelden yüklenmiş fatura belgeleri: sayısı ve toplam boyutu (Paraşüt PDF'leri önbellek, yedeğe girmez) */
export async function uploadsTotal(): Promise<{ count: number; bytes: number }> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${s.invoiceDocuments.size}), 0)::bigint` })
    .from(s.invoiceDocuments)
    .where(eq(s.invoiceDocuments.source, "upload"));
  return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) };
}

/** Ayarlar › Yedek kartı: son yedek ve yüklenmiş belgeler */
export async function loadBackupInfo(): Promise<{ last: LastBackup | null; uploads: { count: number; bytes: number } }> {
  const [last, uploads] = await Promise.all([readLastBackup(), uploadsTotal()]);
  return { last, uploads };
}
