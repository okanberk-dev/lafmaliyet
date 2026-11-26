import "server-only";

import { randomBytes } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { eq } from "drizzle-orm";

import {
  asAutoBackupState,
  AUTO_BACKUP_STATE_KEY,
  autoBackupDue,
  autoBackupName,
  autoBackupsToDelete,
  autoBackupStatus,
  isAutoBackupName,
  storedBackups,
  type AutoBackupResult,
  type AutoBackupState,
  type AutoBackupStatus,
  type StoredBackup,
} from "@/lib/backup/auto";
import { backupSummaryText } from "@/lib/backup/format";
import { logActivity } from "@/server/actions/log";
import { getDb, schema as s, type DB } from "@/server/db";
import { open, seal } from "@/server/secret-box";

import { appVersion, backupLines, type BackupSummary } from "./core";
import { backupStore, type BackupStore } from "./store";

/*
 * Otomatik haftalık yedek (docs/YEDEK.md › Otomatik haftalık yedek; kurallar src/lib/backup/auto.ts). Sabah işi her gün
 * runAutoBackup'ı çağırır: bu haftanın dosyası depoda yoksa tam yedek alınır (panelden indirilenle aynı biçim, aynı
 * yazılmayanlar; yüklenen fatura belgeleri hariç), özel depoya yazılır, en yeni 8 dosyanın dışındakiler silinir.
 * Hangi yedeklerin durduğunu depo söyler (liste), veritabanı değil: geri yüklemeden sonra da liste doğrudur.
 */

/** Otomatik yedeği alan (dosyanın başlığında ve işlem geçmişinde) */
const AUTO_BY = "Otomatik (sabah işi)";
/** Parolayla verilen indirme bağlantısının süresi */
const HANDLE_MS = 120_000;

export async function readAutoBackupState(db: DB = getDb()): Promise<AutoBackupState> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, AUTO_BACKUP_STATE_KEY)).limit(1);
  return asAutoBackupState(row?.value);
}

async function saveAutoBackupState(db: DB, v: AutoBackupState): Promise<void> {
  await db
    .insert(s.integrationState)
    .values({ key: AUTO_BACKUP_STATE_KEY, value: v })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: v, updatedAt: new Date() } });
}

/** Yedeği bellekte gzip'ler (belgesiz yedek ~1 MB); `deadlineAt` geçilirse yarıda bırakır (işlem kapanır, bağlantı döner) */
async function gzippedBackup(db: DB, now: Date, deadlineAt: number | undefined): Promise<{ bytes: Buffer; summary: BackupSummary }> {
  let summary: BackupSummary | null = null;
  async function* lines() {
    const it = backupLines(db.$client, { documents: false, createdBy: AUTO_BY, app: appVersion(), now });
    try {
      for (;;) {
        if (deadlineAt !== undefined && Date.now() > deadlineAt) throw new Error("süre yetmedi");
        const r = await it.next();
        if (r.done) {
          summary = r.value;
          return;
        }
        yield r.value;
      }
    } finally {
      await it.return(undefined as never).catch(() => {});
    }
  }
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  await pipeline(Readable.from(lines()), createGzip(), sink);
  if (!summary) throw new Error("yedek tamamlanmadı");
  return { bytes: Buffer.concat(chunks), summary };
}

/**
 * Bu haftanın yedeği yoksa alır. Hata fırlatmaz: sonuç sabah işinin adımı olur (src/lib/job-health.ts › backupStep),
 * hata durumu ayrıca durum kaydına yazılır (Ayarlar › Yedek'te görünür). `force`: hafta denetimi olmadan al (test).
 * Eski dosyaların silinmesi aksarsa yedek yine alınmış sayılır; fazlası bir sonraki hafta yeniden denenir.
 */
export async function runAutoBackup(now = new Date(), opts: { db?: DB; store?: BackupStore | null; deadlineAt?: number; force?: boolean } = {}): Promise<AutoBackupResult> {
  const store = opts.store === undefined ? backupStore() : opts.store;
  if (!store) return { status: "off" };
  const db = opts.db ?? getDb();
  let prev: AutoBackupState | null = null;
  try {
    const before = storedBackups(await store.list());
    if (!opts.force && !autoBackupDue(before, now)) return { status: "skip" };
    prev = await readAutoBackupState(db);
    const { bytes, summary } = await gzippedBackup(db, now, opts.deadlineAt);
    const name = autoBackupName(now, randomBytes(4).toString("hex"));
    await store.put(name, bytes);
    const tables = Object.keys(summary.tables).length;
    // Dosya depoda: durum yazılamasa da yedek alınmıştır (kart ve hafta denetimi depodaki listeye bakar)
    await saveAutoBackupState(db, { lastAttemptAt: now.toISOString(), lastError: null, lastOk: { at: now.toISOString(), name, bytes: bytes.byteLength, rows: summary.rows, tables } }).catch((e) =>
      console.error("[yedek] otomatik yedeğin durumu yazılamadı", e),
    );
    let deleted = 0;
    try {
      const extra = autoBackupsToDelete([...before, { name }]);
      await store.del(extra);
      deleted = extra.length;
    } catch (e) {
      console.error("[yedek] eski otomatik yedekler silinemedi", e);
    }
    await logActivity(null, "Otomatik yedek alındı", `${backupSummaryText({ tables, rows: summary.rows, bytes: bytes.byteLength, documents: false, docCount: 0 })}${deleted ? ` · ${deleted} eski yedek silindi` : ""}`);
    return { status: "ok", name, bytes: bytes.byteLength, rows: summary.rows, tables, deleted };
  } catch (e) {
    const error = (e as Error).message || "bilinmeyen hata";
    console.error("[yedek] otomatik yedek alınamadı", e);
    await saveAutoBackupState(db, { lastAttemptAt: now.toISOString(), lastError: error.slice(0, 300), lastOk: prev?.lastOk ?? (await readAutoBackupState(db).catch(() => null))?.lastOk ?? null }).catch(() => {});
    return { status: "error", error };
  }
}

export interface AutoBackupInfo {
  available: boolean;
  items: StoredBackup[];
  status: AutoBackupStatus;
}

/** Ayarlar › Yedek: depodaki otomatik yedekler (yeni önce) ve durum satırı */
export async function loadAutoBackupInfo(now = new Date()): Promise<AutoBackupInfo> {
  const store = backupStore();
  const [files, state] = await Promise.all([store ? store.list() : [], readAutoBackupState()]);
  const items = storedBackups(files);
  return { available: store !== null, items, status: autoBackupStatus({ available: store !== null, state, items, now }) };
}

/** Parola onayından sonra verilen, saklanan bir yedeğin indirme bağlantısı: kişi, dosya adı, süre (iki dakika) */
export function storedBackupHandle(userId: number, name: string): string {
  return seal(JSON.stringify({ u: userId, n: name, exp: Date.now() + HANDLE_MS }), "backup");
}

/** Mühürlü değerden dosya adı; kişi tutmuyorsa, süresi geçtiyse, ad bizim değilse ya da bozuksa null */
export function openStoredBackupHandle(handle: string, userId: number): string | null {
  const raw = handle ? open(handle, "backup") : null;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { u?: unknown; n?: unknown; exp?: unknown };
    if (v.u !== userId || typeof v.n !== "string" || !isAutoBackupName(v.n) || typeof v.exp !== "number" || v.exp < Date.now()) return null;
    return v.n;
  } catch {
    return null;
  }
}
