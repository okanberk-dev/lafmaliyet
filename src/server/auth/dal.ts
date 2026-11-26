import "server-only";

import { randomBytes } from "node:crypto";

import { eq, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { needsTwoFactorSetup, TWO_FACTOR_SETUP_PATH } from "@/lib/admin-security";
import type { Role } from "@/lib/constants";
import { BRANCH_ROLES, can, homeFor, type Capability } from "@/lib/roles";
import { getDb, schema as s } from "@/server/db";

import {
  addDeviceUser,
  COOKIE_BASE,
  DEVICE_COOKIE,
  DEVICE_DAYS,
  expiredLoginQuery,
  LEGACY_COOKIES,
  PENDING_COOKIE,
  PENDING_MINUTES,
  readCookie,
  SESSION_COOKIE,
  SESSION_DAYS,
  signDevice,
  signPending,
  signSession,
  verifyDevice,
  verifySession,
  type DeviceToken,
  type SessionPayload,
} from "./session";

type Jar = Awaited<ReturnType<typeof cookies>>;

/** Çerezi siler; eski (öneksiz) adı başkaysa onu da kendi yolunda */
function drop(jar: Jar, name: string, legacy: { name: string; path: string }) {
  jar.set(name, "", { ...COOKIE_BASE, maxAge: 0 });
  if (legacy.name !== name) jar.set(legacy.name, "", { path: legacy.path, maxAge: 0 });
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  /** Rol (src/lib/roles.ts): yetki her zaman buradan, `can(role, …)` ile sorulur */
  role: Role;
  /**
   * Personelin ve müdürün şubesi (doluysa panel bu şubede kilitli, src/server/branch-scope.ts); müdürde hep dolu ve
   * etkin (değilse oturum açılmaz), yöneticide ve muhasebecide hep boş
   */
  branchId?: string | null;
}

/** Oturumun kullanıcısı ve iki adımlıyı kurmadan panele giremeyen yönetici mi (src/lib/admin-security.ts) */
type SessionUser = CurrentUser & { needsTwoFactor: boolean; totpEnabled: boolean };

/** Oturumu doğrular ve kullanıcı veritabanında hâlâ aktif mi diye bakar (iki adımlı zorunluluğunu söyler, uygulamaz) */
async function readSessionUser(): Promise<SessionUser | null> {
  const token = readCookie(await cookies(), SESSION_COOKIE, LEGACY_COOKIES.session.name);
  const session = await verifySession(token);
  if (!session) return null;
  const jti = typeof session.jti === "string" ? session.jti : null;
  const [u] = await getDb()
    .select({
      id: s.users.id,
      name: s.users.name,
      email: s.users.email,
      role: s.users.role,
      branchId: s.users.branchId,
      active: s.users.active,
      sessionVersion: s.users.sessionVersion,
      totpEnabled: s.users.totpEnabled,
      revoked: s.revokedSessions.id,
      branchActive: s.branches.active,
    })
    .from(s.users)
    .leftJoin(s.revokedSessions, jti ? eq(s.revokedSessions.id, jti) : sql`false`)
    .leftJoin(s.branches, eq(s.branches.id, s.users.branchId))
    .where(eq(s.users.id, Number(session.sub)))
    .limit(1);
  // Parola / iki adımlı doğrulama değiştiyse ya da yönetici oturumları kapattıysa eski çerez geçmez; çıkış yapılmış
  // oturumun çerezi de (kopyası alınmış olsa bile) geçmez. Rol değişince oturum sürümü artar (settings.ts › saveUser)
  if (!u || !u.active || (session.sv ?? 1) !== u.sessionVersion || u.revoked) return null;
  if (managerWithoutBranch(u)) return null;
  const branchId = (BRANCH_ROLES as readonly string[]).includes(u.role) ? u.branchId : null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, branchId, needsTwoFactor: needsTwoFactorSetup(u), totpEnabled: u.totpEnabled };
}

/**
 * Müdür şubesine kilitli olmak ZORUNDA (docs/ROLLER.md): şubesi yoksa (veritabanı kısıtı bunu zaten engeller) ya da şubesi
 * pasife alındıysa oturumu yok sayılır. Personelde şube pasife alınınca kilit kalkar ("Tümü"); müdürde kalkarsa öteki
 * şubeleri görürdü, o yüzden kapalı. Giriş de aynı kuralla reddedilir (src/server/actions/auth.ts).
 */
export function managerWithoutBranch(u: { role: string; branchId: string | null; branchActive: boolean | null }): boolean {
  return u.role === "manager" && (!u.branchId || u.branchActive !== true);
}

const toCurrent = ({ id, name, email, role, branchId }: SessionUser): CurrentUser => ({ id, name, email, role, branchId });

/**
 * Oturumdaki kullanıcı. İki adımlıyı kurmamış yönetici (zorunluluk açıkken; docs/DEPLOY.md › 6a) burada oturumsuz
 * sayılır: veri uçları (canlı veri, dışa aktarma, fotoğraflar…) ona hiçbir şey vermez; sayfalar ve eylemler requireUser
 * ile kurulum ekranına gönderir.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const u = await readSessionUser();
  return u && !u.needsTwoFactor ? toCurrent(u) : null;
}

/**
 * Oturum geçerli ama kişi iki adımlıyı kurmadan panele giremeyen yönetici mi. getCurrentUser'ın null'unu kendisi
 * yönlendiren sayfa (Claude bağlantısının onay ekranı) bununla ayırır: bu kişi girişe "oturum bitti" diye gönderilmez
 * (proxy geçerli oturumunu silerdi), kurulum ekranına gider.
 */
export async function awaitingTwoFactorSetup(): Promise<boolean> {
  return (await readSessionUser())?.needsTwoFactor === true;
}

/** Oturum yoksa ya da geçersizse giriş sayfası (requireUser ve requireSignedIn ortak) */
async function toLogin(): Promise<never> {
  const token = readCookie(await cookies(), SESSION_COOKIE, LEGACY_COOKIES.session.name);
  redirect(token ? `/giris?${await expiredLoginQuery(token)}` : "/giris");
}

/**
 * Sayfa ve eylemlerde: giriş yapmamışsa giriş sayfasına yönlendirir. Çerez duruyor ama geçersizse (parola değişti,
 * hesap pasif, çıkış yapıldı) "oturum bitti" ve çerezin özetiyle gider; proxy o zaman yalnız bu çerezi siler (yoksa
 * /giris ↔ /panel arasında döngü olurdu; özetsiz `?oturum=bitti` geçerli oturumu silemez). İki adımlıyı kurmamış
 * yönetici (zorunluluk açıkken) panel yerine kurulum ekranına gider: kurmadan hiçbir ekranı ve eylemi kullanamaz.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await readSessionUser();
  if (!user) return toLogin();
  if (user.needsTwoFactor) redirect(TWO_FACTOR_SETUP_PATH);
  return toCurrent(user);
}

/**
 * Yalnız iki adımlı kurulum ekranı ve kurulum eylemleri (başlat, onayla, vazgeç): giriş yapmış herkes geçer, iki
 * adımlıyı henüz kurmamış yönetici de. Başka hiçbir yerde kullanılmaz (tests/yonetici-guvenlik.test.ts tutar).
 */
export async function requireSignedIn(): Promise<SessionUser> {
  const user = await readSessionUser();
  if (!user) return toLogin();
  return user;
}

/** Yalnızca yönetici. Başka rol kendi ana ekranına yönlendirilir (homeFor). */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect(homeFor(user.role));
  return user;
}

/**
 * Yalnız verilen roller (src/lib/roles.ts); başka rol kendi ana ekranına yönlendirilir. Yetenek tablosuyla anlatılabilen
 * her yerde requireCan tercih edilir.
 */
export async function requireRole(...roles: readonly Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/**
 * Yetenek kapısı (src/lib/roles.ts › CAPABILITIES): rol bu yeteneğe sahip değilse kendi ana ekranına yönlendirilir.
 * Her yazan sunucu eylemi en az `requireCan("kayit.yaz")` (ya da requireAdmin) ister: muhasebeci hiçbir kaydı
 * değiştiremez (tests/roller.test.ts eylemleri tarar).
 */
export async function requireCan(cap: Capability): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, cap)) redirect(homeFor(user.role));
  return user;
}

/**
 * Oturumu sunucuda kapatır: kimliği (jti) kapatılanlara yazılır, çerezin kopyası da artık geçmez. Satır çerezin süresi
 * dolunca gereksizleşir; süresi dolanlar burada silinir (tablo küçük kalır). Kimliksiz eski oturum kapatılamaz, kendi
 * süresiyle düşer.
 */
async function revokeSession(session: SessionPayload | null) {
  if (!session?.jti) return;
  const db = getDb();
  const expiresAt = new Date(session.exp ? session.exp * 1000 : Date.now() + SESSION_DAYS * 86_400_000);
  await db.delete(s.revokedSessions).where(lt(s.revokedSessions.expiresAt, new Date()));
  await db.insert(s.revokedSessions).values({ id: session.jti, userId: Number(session.sub), expiresAt }).onConflictDoNothing();
}

/**
 * Bu tarayıcıya yeni oturum. Tarayıcıda önceki bir oturum varsa (ad değişikliği, oturumların yenilenmesi, ortak
 * tablette sıradaki kişinin girişi) o oturum da kapatılır: yerine yenisi geldi, eski çerezin kopyası geçmesin.
 */
export async function startSession(user: { id: number; name: string; role: Role; sessionVersion: number }) {
  const token = await signSession({ sub: String(user.id), name: user.name, role: user.role, sv: user.sessionVersion });
  const jar = await cookies();
  await revokeSession(await verifySession(readCookie(jar, SESSION_COOKIE, LEGACY_COOKIES.session.name)));
  drop(jar, PENDING_COOKIE, LEGACY_COOKIES.pending);
  if (LEGACY_COOKIES.session.name !== SESSION_COOKIE) jar.set(LEGACY_COOKIES.session.name, "", { path: "/", maxAge: 0 });
  jar.set(SESSION_COOKIE, token, { ...COOKIE_BASE, sameSite: "lax", maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

/**
 * Çıkış: oturum sunucuda kapatılır (çerezin kopyası alınmışsa o da geçmez; denetim YO-02), sonra çerezler silinir.
 * Kişinin öteki cihazlarındaki oturumlar açık kalır (onlar için Hesabım › Diğer cihazlardaki oturumları kapat).
 */
export async function endSession() {
  const jar = await cookies();
  await revokeSession(await verifySession(readCookie(jar, SESSION_COOKIE, LEGACY_COOKIES.session.name)));
  drop(jar, SESSION_COOKIE, LEGACY_COOKIES.session);
  drop(jar, PENDING_COOKIE, LEGACY_COOKIES.pending);
}

/** Parola doğru; iki adımlı doğrulama kodu istenecek */
export async function startPending(user: { id: number; sessionVersion: number }, next: string) {
  const token = await signPending({ sub: String(user.id), sv: user.sessionVersion, next });
  const jar = await cookies();
  if (LEGACY_COOKIES.pending.name !== PENDING_COOKIE) jar.set(LEGACY_COOKIES.pending.name, "", { path: LEGACY_COOKIES.pending.path, maxAge: 0 });
  jar.set(PENDING_COOKIE, token, { ...COOKIE_BASE, sameSite: "strict", maxAge: PENDING_MINUTES * 60 });
}

export async function clearPending() {
  drop(await cookies(), PENDING_COOKIE, LEGACY_COOKIES.pending);
}

/** İki adım çerezi (parola doğru, kod bekleniyor); yoksa undefined */
export async function readPending(): Promise<string | undefined> {
  return readCookie(await cookies(), PENDING_COOKIE, LEGACY_COOKIES.pending.name);
}

/** Bu tarayıcının bilinen cihaz kaydı (imzalı çerez); yoksa ya da geçersizse null */
export async function readDevice(): Promise<DeviceToken | null> {
  return verifyDevice(readCookie(await cookies(), DEVICE_COOKIE, LEGACY_COOKIES.device.name));
}

/**
 * Başarılı girişten (ya da bu tarayıcıda oturum sürümü yenilenince) bu tarayıcı o kullanıcı için güncel oturum
 * sürümüyle bilinen cihaz olur; cihazın kimliğini döndürür
 */
export async function rememberDevice(user: { id: number; sessionVersion: number }): Promise<string> {
  const jar = await cookies();
  const prev = await verifyDevice(readCookie(jar, DEVICE_COOKIE, LEGACY_COOKIES.device.name));
  const did = prev?.did ?? randomBytes(12).toString("base64url");
  if (LEGACY_COOKIES.device.name !== DEVICE_COOKIE) jar.set(LEGACY_COOKIES.device.name, "", { path: LEGACY_COOKIES.device.path, maxAge: 0 });
  jar.set(DEVICE_COOKIE, await signDevice({ did, users: addDeviceUser(prev?.users ?? [], { id: user.id, sv: user.sessionVersion }) }), {
    ...COOKIE_BASE,
    sameSite: "strict",
    maxAge: DEVICE_DAYS * 24 * 60 * 60,
  });
  return did;
}
