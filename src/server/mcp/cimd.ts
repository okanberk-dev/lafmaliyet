import "server-only";

import { CIMD_FETCH_INIT, readCimdResponse, resolveCimd, type CimdRead } from "@/lib/mcp/oauth";
import type { DB } from "@/server/db";

import { findClient, upsertCimdClient, type ClientRow } from "./store";

/**
 * Claude'un yayımlanmış kimlik belgesini (CIMD) okur. SSRF'e karşı: yalnız https://claude.ai|claude.com/oauth/…
 * (isAllowedCimdUrl), yönlendirme izlenmez, 5 sn, en çok 10 KB, yalnız JSON. Belge 24 saat önbellekte; okunamazsa
 * önbellekteki (eski de olsa) kullanılır, hiç yoksa istemci tanınmaz (null). Karar ve okuma kuralları saf
 * (resolveCimd, readCimdResponse; tests/claude-baglanti.test.ts); burada yalnız ağ ve veritabanı.
 */
export function resolveCimdClient(db: DB, url: string, now: Date, opts: { loopback: boolean }): Promise<ClientRow | null> {
  return resolveCimd(url, now, opts, {
    cached: async () => {
      const row = await findClient(db, url);
      return row?.kind === "cimd" ? row : null;
    },
    fetchDocument: () => fetchDocument(url),
    save: (v) => upsertCimdClient(db, url, v, now),
    warn: (message) => console.warn(`[mcp] ${message}:`, url),
  });
}

async function fetchDocument(url: string): Promise<CimdRead> {
  try {
    return await readCimdResponse(await fetch(url, { ...CIMD_FETCH_INIT, signal: AbortSignal.timeout(5000) }));
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
