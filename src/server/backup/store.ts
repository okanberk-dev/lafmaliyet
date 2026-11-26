/**
 * Otomatik yedeklerin deposu (docs/YEDEK.md › Otomatik haftalık yedek): canlıda özel Vercel Blob (fotoğraflarla aynı
 * depo, `yedek/haftalik/` klasörü), yerelde dosya sistemi (.data/backups), testte bellek. Fotoğraf sürücülerinden
 * (src/server/storage/drivers.ts) ayrı: burada dosyalar listelenir, anahtar biçimi başkadır. Blob adresi hiçbir yere
 * çıkmaz; dosya yalnız /api/yedek/kayitli'dan, parola onayından sonra verilir. "server-only" yok: testli
 * (tests/yedek-oto.test.ts).
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as blob from "@vercel/blob";

import { AUTO_BACKUP_PREFIX, isAutoBackupName } from "@/lib/backup/auto";

export interface BackupStore {
  name: "blob" | "fs" | "memory";
  put(name: string, bytes: Uint8Array): Promise<void>;
  /** Yoksa null */
  get(name: string): Promise<Uint8Array | null>;
  /** Klasördeki bütün dosyalar (yabancı adlar dahil; süzmek çağırana kalır) */
  list(): Promise<{ name: string; bytes: number }[]>;
  /** Olmayan ad hata değildir */
  del(names: string[]): Promise<void>;
}

/** @vercel/blob'un kullandığımız dört işlevi (testte sahtesi verilir; özel depo ayarlarını sabitler) */
export interface BackupBlobApi {
  put(pathname: string, body: Buffer, options: { access: "private"; contentType: string; addRandomSuffix: false; allowOverwrite: false; token?: string }): Promise<unknown>;
  get(pathname: string, options: { access: "private"; token?: string }): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  list(options: { prefix: string; limit: number; cursor?: string; token?: string }): Promise<{ blobs: { pathname: string; size: number }[]; cursor?: string; hasMore: boolean }>;
  del(pathnames: string[], options?: { token?: string }): Promise<void>;
}

function checked(name: string): string {
  if (!isAutoBackupName(name)) throw new Error(`Geçersiz yedek adı: ${name.slice(0, 80)}`);
  return name;
}

/** Özel Vercel Blob: okumak için anahtar gerekir, adresi tek başına işe yaramaz */
export function blobBackupStore(api: BackupBlobApi, token?: string): BackupStore {
  const auth = token ? { token } : {};
  return {
    name: "blob",
    async put(name, bytes) {
      await api.put(AUTO_BACKUP_PREFIX + checked(name), Buffer.from(bytes), { access: "private", contentType: "application/gzip", addRandomSuffix: false, allowOverwrite: false, ...auth });
    },
    async get(name) {
      const res = await api.get(AUTO_BACKUP_PREFIX + checked(name), { access: "private", ...auth });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return new Uint8Array(await new Response(res.stream).arrayBuffer());
    },
    async list() {
      const out: { name: string; bytes: number }[] = [];
      let cursor: string | undefined;
      // Klasörde en çok 8 dosya durur; yine de sayfalanır (en çok 5 sayfa: sonsuz döngü olmasın)
      for (let page = 0; page < 5; page++) {
        const res = await api.list({ prefix: AUTO_BACKUP_PREFIX, limit: 100, ...(cursor ? { cursor } : {}), ...auth });
        for (const b of res.blobs) if (b.pathname.startsWith(AUTO_BACKUP_PREFIX)) out.push({ name: b.pathname.slice(AUTO_BACKUP_PREFIX.length), bytes: b.size });
        if (!res.hasMore || !res.cursor) break;
        cursor = res.cursor;
      }
      return out;
    },
    async del(names) {
      if (names.length) await api.del(names.map((n) => AUTO_BACKUP_PREFIX + checked(n)), auth);
    },
  };
}

/** Yerel geliştirme: dosyalar `dir` altında (varsayılan .data/backups; .gitignore'da) */
export function fsBackupStore(dir: string): BackupStore {
  return {
    name: "fs",
    async put(name, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, checked(name)), bytes, { flag: "wx" });
    },
    async get(name) {
      try {
        return new Uint8Array(await readFile(join(dir, checked(name))));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async list() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
      return Promise.all(names.map(async (name) => ({ name, bytes: (await stat(join(dir, name))).size })));
    },
    async del(names) {
      for (const name of names) await rm(join(dir, checked(name)), { force: true });
    },
  };
}

/** Testler için bellek deposu */
export function memoryBackupStore(): BackupStore {
  const files = new Map<string, Uint8Array>();
  return {
    name: "memory",
    async put(name, bytes) {
      if (files.has(checked(name))) throw new Error("Ad zaten var");
      files.set(name, new Uint8Array(bytes));
    },
    async get(name) {
      return files.get(name) ?? null;
    },
    async list() {
      return [...files].map(([name, bytes]) => ({ name, bytes: bytes.byteLength }));
    },
    async del(names) {
      for (const n of names) files.delete(n);
    },
  };
}

let testStore: BackupStore | null | undefined;

/** Testler bellek deposu verir (undefined: ortamdan seçilir) */
export function __setBackupStoreForTests(s: BackupStore | null | undefined) {
  testStore = s;
}

/**
 * Depo ortamdan (fotoğraf deposuyla aynı kural, src/server/storage/photos.ts): BLOB_READ_WRITE_TOKEN → özel Blob;
 * yoksa Vercel'de BLOB_STORE_ID varsa yine Blob, o da yoksa depo yok (otomatik yedek kapalı); yerelde .data/backups
 * (`BACKUP_DIR` ile değişir).
 */
export function backupStore(): BackupStore | null {
  if (testStore !== undefined) return testStore;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return blobBackupStore(blob, token);
  if (process.env.VERCEL) return process.env.BLOB_STORE_ID?.trim() ? blobBackupStore(blob) : null;
  return fsBackupStore(process.env.BACKUP_DIR?.trim() || join(process.cwd(), ".data", "backups"));
}
