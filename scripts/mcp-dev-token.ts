// Yerel deneme için Claude bağlantısı anahtarı (docs/CLAUDE-BAGLANTISI.md › Geliştirici denemesi): verilen yöneticiye
// gerçek akıştan (otomatik kayıt, yetki kodu, PKCE, kodun anahtara çevrilmesi) geçen bir bağlantı açar ve yalnız
// 1 saatlik erişim anahtarını yazar (curl ya da MCP Inspector'a verilir). Bağlantı Hesabım › Bağlı uygulamalar'da
// "Yerel program (localhost)" olarak görünür, oradan kaldırılır. Yalnız yerel veritabanında ve geliştirmede çalışır.
//
// Kullanım:
//   npx tsx scripts/mcp-dev-token.ts admin@laffogato.net                        -> http://localhost:3000/api/mcp için
//   npx tsx scripts/mcp-dev-token.ts admin@laffogato.net http://localhost:3111  -> başka portta çalışan sunucu için

import { randomBytes } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

import { canonicalResource, MCP_SCOPE, OFFLINE_SCOPE } from "../src/lib/mcp/oauth";
import { createDb } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { exchangeCode, issueCode, registerDcrClient } from "../src/server/mcp/store";
import { pkceS256 } from "../src/server/mcp/tokens";

const USAGE = "Kullanım: npx tsx scripts/mcp-dev-token.ts <yönetici e-postası> [panelin adresi, ör. http://localhost:3000]";
const REDIRECT = "http://127.0.0.1/callback";

/** Yalnız yerel: canlının ya da Neon'un veritabanında anahtar açılmasın */
export function devTokenRefusal(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "production") return "NODE_ENV=production: bu betik yalnız geliştirmede çalışır";
  const url = env.DATABASE_URL;
  if (!url) return "DATABASE_URL tanımlı değil";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "DATABASE_URL okunamadı";
  }
  return host === "localhost" || host === "127.0.0.1" ? null : `Yalnız yerel veritabanında çalışır (DATABASE_URL sunucusu: ${host})`;
}

export async function mintDevToken(email: string, base: string, url: string, now = new Date()): Promise<string> {
  const resource = canonicalResource(`${base.replace(/\/+$/, "")}/api/mcp`);
  if (!resource) throw new Error(`Panelin adresi okunamadı: ${base}`);
  const db = createDb(url, 1);
  try {
    const [user] = await db
      .select({ id: s.users.id, role: s.users.role, active: s.users.active, sessionVersion: s.users.sessionVersion })
      .from(s.users)
      .where(eq(s.users.email, email.trim().toLowerCase()))
      .limit(1);
    if (!user || !user.active || user.role !== "admin") throw new Error(`${email}: etkin bir yönetici değil`);
    const client = await registerDcrClient(db, { name: "Geliştirici betiği", redirectUris: [REDIRECT] });
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode(
      db,
      {
        userId: user.id,
        clientDbId: client.id,
        redirectUri: REDIRECT,
        codeChallenge: pkceS256(verifier),
        scope: `${MCP_SCOPE} ${OFFLINE_SCOPE}`,
        resource,
        sessionVersion: user.sessionVersion,
      },
      now,
    );
    const r = await exchangeCode(db, { code: code.raw, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource }, now);
    if (!r.ok) throw new Error(`Anahtar alınamadı: ${r.description}`);
    return r.body.access_token;
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("mcp-dev-token.ts")) {
  loadEnvConfig(process.cwd());
  const [email, base = "http://localhost:3000"] = process.argv.slice(2);
  const refusal = email ? devTokenRefusal(process.env) : USAGE;
  if (refusal) {
    console.error(`✗ ${refusal}`);
    process.exit(1);
  }
  mintDevToken(email, base, process.env.DATABASE_URL!)
    .then((token) => console.log(token))
    .catch((e) => {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    });
}
