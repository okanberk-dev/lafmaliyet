/**
 * Fotoğraf deposunun sürücüleri (veritabanı ve "server-only" yok; tests/foto-altyapi.test.ts sınar): canlıda özel
 * Vercel Blob, yerelde dosya sistemi (.data/photos), testte bellek. Hangisinin seçildiği src/server/storage/photos.ts'te.
 * Anahtarlar rastgele ve bir kez yazılır ("kasa-z/2026/10/<uuid>.jpg"); Blob adresi hiçbir yere çıkmaz, dosya yalnız
 * /api/foto/[id]'den verilir.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PhotoKind } from "@/lib/photo-rules";

export interface PhotoDriver {
  name: "blob" | "fs" | "memory";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Yoksa null */
  get(key: string): Promise<Uint8Array | null>;
  /** Olmayan anahtar hata değildir */
  del(keys: string[]): Promise<void>;
}

/** Depodaki yol: tür / yıl / ay / rastgele kimlik */
export function photoKey(kind: PhotoKind, now: Date, uuid: string, ext: "jpg" | "png" | "webp"): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${kind}/${y}/${m}/${uuid}.${ext}`;
}

/** Yalnız photoKey'in ürettiği biçim (dosya sisteminde ../ ile dışarı çıkılamaz) */
export const PHOTO_KEY_RE = /^[a-z-]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

type BlobGetResult = { statusCode: number; stream: ReadableStream<Uint8Array> | null } | null;

/** @vercel/blob'un kullandığımız üç işlevi (testte sahtesi verilir; özel depo ayarlarını sabitler) */
export interface BlobApi {
  put(
    pathname: string,
    body: Buffer,
    options: { access: "private"; contentType: string; addRandomSuffix: false; allowOverwrite: false; cacheControlMaxAge: number; token?: string },
  ): Promise<unknown>;
  get(pathname: string, options: { access: "private"; token?: string }): Promise<BlobGetResult>;
  del(pathnames: string[], options?: { token?: string }): Promise<void>;
}

/**
 * Özel Vercel Blob: okumak için anahtar gerekir, adresi tek başına işe yaramaz. Bir saatlik önbellek: silinen
 * fotoğraf en geç bir saatte önbellekten de düşer (içerik hiç değişmez: anahtarlar rastgele, üzerine yazılmaz).
 */
export function blobDriver(api: BlobApi, token?: string): PhotoDriver {
  const auth = token ? { token } : {};
  return {
    name: "blob",
    async put(key, bytes, contentType) {
      await api.put(key, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 3600, ...auth });
    },
    async get(key) {
      const res = await api.get(key, { access: "private", ...auth });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return new Uint8Array(await new Response(res.stream).arrayBuffer());
    },
    async del(keys) {
      if (keys.length) await api.del(keys, auth);
    },
  };
}

function safePath(dir: string, key: string): string {
  if (!PHOTO_KEY_RE.test(key)) throw new Error(`Geçersiz fotoğraf anahtarı: ${key.slice(0, 80)}`);
  return join(dir, key);
}

/** Yerel geliştirme: dosyalar `dir` altında (varsayılan .data/photos; .gitignore'da) */
export function fsDriver(dir: string): PhotoDriver {
  return {
    name: "fs",
    async put(key, bytes) {
      const path = safePath(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(safePath(dir, key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async del(keys) {
      for (const key of keys) await rm(safePath(dir, key), { force: true });
    },
  };
}

/** Testler için bellek deposu */
export function memoryDriver(): PhotoDriver & { keys(): string[] } {
  const files = new Map<string, Uint8Array>();
  return {
    name: "memory",
    async put(key, bytes) {
      if (files.has(key)) throw new Error("Anahtar zaten var");
      files.set(key, new Uint8Array(bytes));
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async del(keys) {
      for (const k of keys) files.delete(k);
    },
    keys: () => [...files.keys()],
  };
}
