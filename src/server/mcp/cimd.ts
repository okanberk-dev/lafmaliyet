import "server-only";

import { CIMD_MAX_AGE_H, isAllowedCimdUrl, validateCimdDocument } from "@/lib/mcp/oauth";
import type { DB } from "@/server/db";

import { findClient, upsertCimdClient, type ClientRow } from "./store";

/** CIMD belgesi en çok bu kadar bayt */
const MAX_BYTES = 10 * 1024;

/**
 * Claude'un yayımlanmış kimlik belgesini (CIMD) okur. SSRF'e karşı: yalnız https://claude.ai|claude.com/oauth/…
 * (isAllowedCimdUrl), yönlendirme izlenmez, 5 sn, en çok 10 KB, yalnız JSON. Belge 24 saat önbellekte; okunamazsa
 * önbellekteki (eski de olsa) kullanılır, hiç yoksa istemci tanınmaz (null).
 */
export async function resolveCimdClient(db: DB, url: string, now: Date, opts: { loopback: boolean }): Promise<ClientRow | null> {
  if (!isAllowedCimdUrl(url)) return null;
  const cached = await findClient(db, url);
  if (cached?.kind === "cimd" && cached.fetchedAt && now.getTime() - cached.fetchedAt.getTime() < CIMD_MAX_AGE_H * 3_600_000) return cached;
  const doc = await fetchDocument(url);
  if (doc !== null) {
    const v = validateCimdDocument(url, doc, opts);
    if (v.ok) return upsertCimdClient(db, url, { name: v.name, redirectUris: v.redirectUris }, now);
    console.warn("[mcp] CIMD belgesi reddedildi:", url, v.reason);
    return null;
  }
  return cached?.kind === "cimd" ? cached : null;
}

async function fetchDocument(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.status !== 200 || !/json/i.test(res.headers.get("content-type") ?? "") || !res.body) {
      await res.body?.cancel().catch(() => {});
      console.warn("[mcp] CIMD belgesi okunamadı:", url, res.status);
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        console.warn("[mcp] CIMD belgesi çok büyük:", url);
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (e) {
    console.warn("[mcp] CIMD belgesi okunamadı:", url, (e as Error).message);
    return null;
  }
}
