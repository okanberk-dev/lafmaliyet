import "server-only";

import { createHash } from "node:crypto";

import { and, eq, like, lt, or } from "drizzle-orm";

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
 * Başlatma yalnız düğmeyle (aynı kökenden POST, /panel/parasut/baglan): adres çubuğundan ya da başka bir siteden
 * başlatılamaz. Bekleyen istek (state, PKCE doğrulayıcısı, hesap, başlatan yönetici) integration_state'te **state'in
 * özetiyle anılan** şifreli bir kayıtta durur, 10 dakika geçerlidir ve tek kullanımlıktır: dönüş yolu kaydı yalnız
 * kendi state'iyle bulur, bulduğu anda siler. Yanlış ya da uydurma bir state başkasının bekleyen isteğini harcayamaz;
 * aynı kod ikinci kez kullanılamaz. Hesap adreste taşınmaz: dönüşte belirteç kayıttaki hesaba, o hesabın ayarlarıyla
 * yazılır; istek başlatan yöneticinin oturumuna bağlıdır (başka bir oturum tamamlayamaz).
 *
 * Şube başına Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı): dönüş adresi (DevHub'daki kayıt) bütün
 * hesaplarda aynıdır. Hesap başına tek bekleyen istek: aynı hesap için yenisi öncekinin yerine geçer, öbür hesabın
 * süren bağlanmasına dokunulmaz.
 */

/** Bekleyen isteklerin öneki: `parasut.connect:<state'in özeti>` (yedeğe girmez: src/lib/backup/format.ts) */
const PENDING_PREFIX = "parasut.connect:";
/** Eski sürümün tek bekleyen isteği (hesapsız tek kayıt); okunmaz, temizlikte silinir */
const SINGLE_PENDING_KEY = "parasut.connect";
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
  /** Başlatan yöneticinin kimliği: dönüş aynı oturumdan gelmeli */
  userId?: number;
  /** Bağlanan hesap (sahibi şube) */
  account: string;
}

export class ParasutConnectError extends Error {}

type Exec = Pick<ReturnType<typeof getDb>, "delete" | "select" | "insert">;

/** Bekleyen isteğin anahtarı: state'in kendisi veritabanına yazılmaz, yalnız SHA-256 özeti */
const pendingKey = (state: string) => `${PENDING_PREFIX}${createHash("sha256").update(state).digest("hex").slice(0, 40)}`;

/** Mühürlü bekleyen isteği açar (bozuk, açılamayan ya da eksik alanlıysa null) */
function openPending(value: unknown): Pending | null {
  const sealed = (value as { sealed?: string } | undefined)?.sealed;
  const plain = sealed ? open(sealed, "parasut-connect") : null;
  if (!plain) return null;
  try {
    const p = JSON.parse(plain) as Pending;
    return p.state && p.verifier && p.redirectUri ? { ...p, account: p.account || DEFAULT_PARASUT_ACCOUNT } : null;
  } catch {
    return null;
  }
}

/** Bekleyen istekler (eski tek kayıt dahil) */
const pendingRows = (db: Pick<Exec, "select">) =>
  db
    .select()
    .from(s.integrationState)
    .where(or(eq(s.integrationState.key, SINGLE_PENDING_KEY), like(s.integrationState.key, `${PENDING_PREFIX}%`)));

/**
 * Dönüşte bekleyen isteği state'iyle alır ve siler (tek kullanımlık; okuma ve silme tek sorgu, aynı state ile ikinci
 * dönüş kaydı bulamaz). Süresi geçmişse null
 */
async function takePending(state: string): Promise<Pending | null> {
  const [row] = await getDb().delete(s.integrationState).where(eq(s.integrationState.key, pendingKey(state))).returning();
  const p = openPending(row?.value);
  return p && Date.now() - p.at <= PENDING_TTL_MS ? p : null;
}

/**
 * Yetkilendirmeyi başlatır: PKCE doğrulayıcısı ve state üretilir, hesapla ve başlatan yöneticiyle birlikte saklanır
 * ve Paraşüt'ün onay ekranının adresi döner. Çağıranın yönetici olduğunu, isteğin aynı kökenden geldiğini ve hesabın
 * geçerli olduğunu doğrulaması gerekir (baglan/route.ts). Aynı hesabın önceki bekleyen isteği ve süresi geçmiş
 * istekler silinir
 */
export async function startParasutConnect(account: string, by: string, userId?: number): Promise<string> {
  const cfg = await readParasutConfig(account);
  // Yanlış yazılmış adres değişkeniyle Paraşüt'e gidilmez (kayıtlı oturumla süren eşitleme bundan etkilenmez)
  assertOidcSettings(cfg);
  const { authorizeUrl } = await parasutEndpoints(cfg);
  const verifier = createVerifier();
  const state = createState();
  const pending: Pending = { state, verifier, redirectUri: cfg.redirectUri, at: Date.now(), by, userId, account };
  const value = { sealed: seal(JSON.stringify(pending), "parasut-connect") };
  await getDb().transaction(async (tx) => {
    await forgetParasutConnect(account, tx);
    // Dönüşü gelmemiş eski istekler (yönetici Paraşüt'te vazgeçti): kayıt birikmesin
    await tx.delete(s.integrationState).where(and(like(s.integrationState.key, `${PENDING_PREFIX}%`), lt(s.integrationState.updatedAt, new Date(Date.now() - PENDING_TTL_MS))));
    await tx.insert(s.integrationState).values({ key: pendingKey(state), value });
  });
  return authorizeRequestUrl({ authorizeUrl, clientId: cfg.clientId, redirectUri: cfg.redirectUri, scope: cfg.scope, state, challenge: challengeOf(verifier) });
}

/**
 * Dönüşteki yetki kodunu belirteçle değiştirir. Bekleyen istek yalnız dönen state'le bulunur; bulunamazsa, bayatsa
 * ya da başka bir yöneticinin oturumunda başlatıldıysa kod kullanılmaz. Belirteç isteğin başlatıldığı hesaba
 * (mühürlü bekleyen istekteki), o hesabın ayarlarıyla yazılır; hesap bu arada geçersizleştiyse (şube başka şubenin
 * hesabına bağlandı) `isAccount` reddeder. Başarılıysa bağlantıyı kuran yöneticinin adı ve hesap döner.
 */
export async function finishParasutConnect(
  input: { code: string | null; state: string | null },
  isAccount: (account: string) => Promise<boolean> = async () => true,
  session: { userId?: number } = {},
): Promise<{ by: string; account: string }> {
  if (!input.state) throw new ParasutConnectError("Bağlanma isteği doğrulanamadı (state yok). Yeniden deneyin.");
  const pending = await takePending(input.state);
  if (!pending) throw new ParasutConnectError("Bağlanma isteği bulunamadı ya da süresi doldu (10 dakika). Yeniden deneyin.");
  // Anahtar state'in özeti; mühürlü değer de aynı state'i taşımalı (kayıt başka anahtara taşınmışsa kabul edilmez)
  if (!sameToken(input.state, pending.state)) throw new ParasutConnectError("Bağlanma isteği doğrulanamadı (state eşleşmedi). Yeniden deneyin.");
  if (pending.userId !== undefined && pending.userId !== session.userId) {
    throw new ParasutConnectError("Bağlanma isteği başka bir oturumda başlatılmış. Paraşüt ekranından yeniden deneyin.");
  }
  if (!input.code) throw new ParasutConnectError("Paraşüt bir yetki kodu döndürmedi.");
  const account = pending.account;
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
 * Hesabın yarıda kalan bağlanma isteklerini siler (oturum sıfırlanırken, istemci ayarları değişince, yeni istek
 * başlarken). Başka bir hesabın bekleyen isteğine dokunulmaz (Marina'nın oturumunu sıfırlamak Tuzla'nın süren
 * bağlanmasını bozmasın); açılamayan istek ve eski sürümün tek kaydı da silinir (zaten kullanılamaz)
 */
export async function forgetParasutConnect(account: string, db: Pick<Exec, "delete" | "select"> = getDb()) {
  for (const row of await pendingRows(db)) {
    const p = row.key === SINGLE_PENDING_KEY ? null : openPending(row.value);
    if (p && p.account !== account) continue;
    await db.delete(s.integrationState).where(eq(s.integrationState.key, row.key));
  }
}
