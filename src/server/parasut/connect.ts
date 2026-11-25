import "server-only";

import { eq } from "drizzle-orm";

import { DEFAULT_PARASUT_ACCOUNT } from "@/lib/parasut/accounts";
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
 *
 * Şube başına Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı): bekleyen istek bağlantının hangi hesap
 * (şube) için başlatıldığını da mühürlü taşır. Dönüşte belirteç o hesaba, o hesabın ayarlarıyla yazılır; dönüş adresi
 * (DevHub'daki kayıt) bütün hesaplarda aynıdır. Aynı anda tek bağlanma isteği: yenisi öncekinin yerine geçer.
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
  /** Bağlanan hesap (sahibi şube); eski kayıtta yok: varsayılan hesap */
  account?: string;
}

export class ParasutConnectError extends Error {}

async function writePending(pending: Pending) {
  const value = { sealed: seal(JSON.stringify(pending), "parasut-connect") };
  await getDb()
    .insert(s.integrationState)
    .values({ key: PENDING_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/** Mühürlü bekleyen isteği açar (bozuk, açılamayan ya da eksik alanlıysa null) */
function openPending(value: unknown): Pending | null {
  const sealed = (value as { sealed?: string } | undefined)?.sealed;
  const plain = sealed ? open(sealed, "parasut-connect") : null;
  if (!plain) return null;
  try {
    const p = JSON.parse(plain) as Pending;
    return p.state && p.verifier && p.redirectUri ? p : null;
  } catch {
    return null;
  }
}

async function takePending(): Promise<Pending | null> {
  // Tek seferlik: okunduğu anda silinir (aynı state ile ikinci bir dönüş kabul edilmez)
  const [row] = await getDb().delete(s.integrationState).where(eq(s.integrationState.key, PENDING_KEY)).returning();
  const p = openPending(row?.value);
  return p && Date.now() - p.at <= PENDING_TTL_MS ? p : null;
}

/**
 * Yetkilendirmeyi başlatır: PKCE doğrulayıcısı ve state üretilir, hesapla birlikte saklanır ve Paraşüt'ün onay
 * ekranının adresi döner. Çağıranın yönetici olduğunu ve hesabın geçerli olduğunu doğrulaması gerekir.
 */
export async function startParasutConnect(account: string, by: string): Promise<string> {
  const cfg = await readParasutConfig(account);
  // Yanlış yazılmış adres değişkeniyle Paraşüt'e gidilmez (kayıtlı oturumla süren eşitleme bundan etkilenmez)
  assertOidcSettings(cfg);
  const { authorizeUrl } = await parasutEndpoints(cfg);
  const verifier = createVerifier();
  const state = createState();
  await writePending({ state, verifier, redirectUri: cfg.redirectUri, at: Date.now(), by, account });
  return authorizeRequestUrl({ authorizeUrl, clientId: cfg.clientId, redirectUri: cfg.redirectUri, scope: cfg.scope, state, challenge: challengeOf(verifier) });
}

/**
 * Dönüşteki yetki kodunu belirteçle değiştirir. state eşleşmezse ya da istek bayatladıysa kod kullanılmaz.
 * Belirteç isteğin başlatıldığı hesaba (mühürlü bekleyen istekteki), o hesabın ayarlarıyla yazılır; hesap bu arada
 * geçersizleştiyse (şube başka şubenin hesabına bağlandı) `isAccount` reddeder. Başarılıysa bağlantıyı kuran
 * yöneticinin adı ve hesap döner.
 */
export async function finishParasutConnect(
  input: { code: string | null; state: string | null },
  isAccount: (account: string) => Promise<boolean> = async () => true,
): Promise<{ by: string; account: string }> {
  const pending = await takePending();
  if (!pending) throw new ParasutConnectError("Bağlanma isteği bulunamadı ya da süresi doldu (10 dakika). Yeniden deneyin.");
  if (!input.state || !sameToken(input.state, pending.state)) throw new ParasutConnectError("Bağlanma isteği doğrulanamadı (state eşleşmedi). Yeniden deneyin.");
  if (!input.code) throw new ParasutConnectError("Paraşüt bir yetki kodu döndürmedi.");
  const account = pending.account ?? DEFAULT_PARASUT_ACCOUNT;
  if (!(await isAccount(account))) throw new ParasutConnectError("Bağlantının başlatıldığı şubenin artık kendi Paraşüt hesabı yok (başka şubeyle aynı seçildi). Yeniden deneyin.");
  const cfg: ParasutConfig = await readParasutConfig(account);
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
  return { by: pending.by, account };
}

/**
 * Hesabın yarıda kalan bağlanma isteğini siler (oturum sıfırlanırken, istemci ayarları değişince). Bekleyen istek
 * başka bir hesabınsa dokunulmaz (Marina'nın oturumunu sıfırlamak Tuzla'nın süren bağlanmasını bozmasın); açılamayan
 * istek de silinir (zaten kullanılamaz)
 */
export async function forgetParasutConnect(account: string, db: Pick<ReturnType<typeof getDb>, "delete" | "select"> = getDb()) {
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, PENDING_KEY)).limit(1);
  if (!row) return;
  const p = openPending(row.value);
  if (p && (p.account ?? DEFAULT_PARASUT_ACCOUNT) !== account) return;
  await db.delete(s.integrationState).where(eq(s.integrationState.key, PENDING_KEY));
}
