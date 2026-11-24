import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";
import { open, seal } from "@/server/secret-box";

import { postParasutToken, saveParasutToken } from "./client";
import { assertOidcSettings, readParasutConfig, type ParasutConfig } from "./config";
import { authorizeRequestUrl, challengeOf, createState, createVerifier, sameToken } from "@/lib/parasut/oidc";

import { parasutEndpoints } from "./oidc";

/**
 * Paraşüt hesabını bağlama (OAuth 2.0 Authorization Code + PKCE, id.parasut.com).
 *
 * Sunucu-sunucu bir panel olduğumuz için yetkilendirme **bir kez** tarayıcıdan yapılır: yönetici "Paraşüt hesabını
 * bağla"ya basar, Paraşüt'ün giriş ve onay ekranından geçer, dönen yetki kodu burada refresh_token'a çevrilir.
 * Panel kullanıcının Paraşüt parolasını hiçbir zaman görmez. refresh_token 30 gün geçerlidir ve her sabahki
 * eşitlemede yenilenir (client.ts).
 *
 * Bekleyen istek (state + code_verifier) integration_state'te şifreli durur ve 10 dakika geçerlidir; tek seferliktir
 * (dönüşte silinir), böylece aynı kod ikinci kez kullanılamaz.
 */

const PENDING_KEY = "parasut.connect";
const PENDING_TTL_MS = 10 * 60 * 1000;

interface Pending {
  state: string;
  verifier: string;
  /** İstek başlatılırken kullanılan dönüş adresi: kod değişiminde birebir aynısı gönderilmeli */
  redirectUri: string;
  /** epoch ms */
  at: number;
  /** Bağlantıyı başlatan yönetici (işlem geçmişi için) */
  by: string;
}

export class ParasutConnectError extends Error {}

async function writePending(pending: Pending) {
  const value = { sealed: seal(JSON.stringify(pending), "parasut-connect") };
  await getDb()
    .insert(s.integrationState)
    .values({ key: PENDING_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

async function takePending(): Promise<Pending | null> {
  // Tek seferlik: okunduğu anda silinir (aynı state ile ikinci bir dönüş kabul edilmez)
  const [row] = await getDb().delete(s.integrationState).where(eq(s.integrationState.key, PENDING_KEY)).returning();
  const sealed = (row?.value as { sealed?: string } | undefined)?.sealed;
  const plain = sealed ? open(sealed, "parasut-connect") : null;
  if (!plain) return null;
  try {
    const p = JSON.parse(plain) as Pending;
    if (!p.state || !p.verifier || !p.redirectUri || Date.now() - p.at > PENDING_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Yetkilendirmeyi başlatır: PKCE doğrulayıcısı ve state üretilir, saklanır ve Paraşüt'ün onay ekranının adresi
 * döner. Çağıranın yönetici olduğunu doğrulaması gerekir.
 */
export async function startParasutConnect(by: string): Promise<string> {
  const cfg = await readParasutConfig();
  // Yanlış yazılmış adres değişkeniyle Paraşüt'e gidilmez (kayıtlı oturumla süren eşitleme bundan etkilenmez)
  assertOidcSettings(cfg);
  const { authorizeUrl } = await parasutEndpoints(cfg);
  const verifier = createVerifier();
  const state = createState();
  await writePending({ state, verifier, redirectUri: cfg.redirectUri, at: Date.now(), by });
  return authorizeRequestUrl({ authorizeUrl, clientId: cfg.clientId, redirectUri: cfg.redirectUri, scope: cfg.scope, state, challenge: challengeOf(verifier) });
}

/**
 * Dönüşteki yetki kodunu belirteçle değiştirir. state eşleşmezse ya da istek bayatladıysa kod kullanılmaz.
 * Başarılıysa refresh_token şifreli olarak saklanır ve bağlantıyı kuran yöneticinin adı döner.
 */
export async function finishParasutConnect(input: { code: string | null; state: string | null }): Promise<{ by: string }> {
  const cfg: ParasutConfig = await readParasutConfig();
  const pending = await takePending();
  if (!pending) throw new ParasutConnectError("Bağlanma isteği bulunamadı ya da süresi doldu (10 dakika). Yeniden deneyin.");
  if (!input.state || !sameToken(input.state, pending.state)) throw new ParasutConnectError("Bağlanma isteği doğrulanamadı (state eşleşmedi). Yeniden deneyin.");
  if (!input.code) throw new ParasutConnectError("Paraşüt bir yetki kodu döndürmedi.");
  const token = await postParasutToken(cfg, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  if (!token.refresh_token) {
    throw new ParasutConnectError(
      "Paraşüt bir refresh_token vermedi; panel her sabah kendiliğinden eşitleyemez. DevHub'daki istemcinin çevrimdışı erişime (offline) izin verdiğini doğrulayın.",
    );
  }
  await saveParasutToken(cfg, token);
  return { by: pending.by };
}

/** Yarıda kalan bir bağlanma isteğini siler (oturum sıfırlanırken, istemci ayarları değişince) */
export async function forgetParasutConnect(db: Pick<ReturnType<typeof getDb>, "delete"> = getDb()) {
  await db.delete(s.integrationState).where(eq(s.integrationState.key, PENDING_KEY));
}
