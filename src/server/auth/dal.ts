import "server-only";

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { STAFF_HOME } from "@/lib/roles";
import { getDb, schema as s } from "@/server/db";

import {
  addDeviceUser,
  COOKIE_BASE,
  DEVICE_COOKIE,
  DEVICE_DAYS,
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
  role: "admin" | "staff";
}

/** Oturumdaki kullanıcıyı doğrular ve veritabanında hâlâ aktif mi diye bakar. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = readCookie(await cookies(), SESSION_COOKIE, LEGACY_COOKIES.session.name);
  const session = await verifySession(token);
  if (!session) return null;
  const [u] = await getDb()
    .select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, active: s.users.active, sessionVersion: s.users.sessionVersion })
    .from(s.users)
    .where(eq(s.users.id, Number(session.sub)))
    .limit(1);
  // Parola / iki adımlı doğrulama değiştiyse ya da yönetici oturumları kapattıysa eski çerez geçmez
  if (!u || !u.active || (session.sv ?? 1) !== u.sessionVersion) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

/**
 * Sayfa ve eylemlerde: giriş yapmamışsa giriş sayfasına yönlendirir. Çerez imzalı ama geçersizse (parola değişti,
 * hesap pasif) "oturum bitti" ile gider; proxy o zaman çerezi siler (yoksa /giris ↔ /panel arasında döngü olurdu).
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(readCookie(await cookies(), SESSION_COOKIE, LEGACY_COOKIES.session.name) ? "/giris?oturum=bitti" : "/giris");
  return user;
}

/** Yalnızca yönetici. Personel ise kendi sayfasına yönlendirilir. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect(STAFF_HOME);
  return user;
}

export async function startSession(user: { id: number; name: string; role: "admin" | "staff"; sessionVersion: number }) {
  const token = await signSession({ sub: String(user.id), name: user.name, role: user.role, sv: user.sessionVersion });
  const jar = await cookies();
  drop(jar, PENDING_COOKIE, LEGACY_COOKIES.pending);
  if (LEGACY_COOKIES.session.name !== SESSION_COOKIE) jar.set(LEGACY_COOKIES.session.name, "", { path: "/", maxAge: 0 });
  jar.set(SESSION_COOKIE, token, { ...COOKIE_BASE, sameSite: "lax", maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

export async function endSession() {
  const jar = await cookies();
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
