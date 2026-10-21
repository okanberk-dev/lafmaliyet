import "server-only";

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { STAFF_HOME } from "@/lib/roles";
import { getDb, schema as s } from "@/server/db";

import {
  addDeviceUser,
  DEVICE_COOKIE,
  DEVICE_DAYS,
  PENDING_COOKIE,
  PENDING_MINUTES,
  SESSION_COOKIE,
  SESSION_DAYS,
  signDevice,
  signPending,
  signSession,
  verifyDevice,
  verifySession,
  type DeviceToken,
} from "./session";

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "staff";
}

/** Oturumdaki kullanıcıyı doğrular ve veritabanında hâlâ aktif mi diye bakar. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
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
  if (!user) redirect((await cookies()).has(SESSION_COOKIE) ? "/giris?oturum=bitti" : "/giris");
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
  jar.set(PENDING_COOKIE, "", { path: "/giris", maxAge: 0 });
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.set(PENDING_COOKIE, "", { path: "/giris", maxAge: 0 });
}

/** Parola doğru; iki adımlı doğrulama kodu istenecek */
export async function startPending(user: { id: number; sessionVersion: number }, next: string) {
  const token = await signPending({ sub: String(user.id), sv: user.sessionVersion, next });
  (await cookies()).set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/giris",
    maxAge: PENDING_MINUTES * 60,
  });
}

export async function clearPending() {
  (await cookies()).set(PENDING_COOKIE, "", { path: "/giris", maxAge: 0 });
}

/** Bu tarayıcının bilinen cihaz kaydı (imzalı çerez); yoksa ya da geçersizse null */
export async function readDevice(): Promise<DeviceToken | null> {
  return verifyDevice((await cookies()).get(DEVICE_COOKIE)?.value);
}

/** Başarılı girişten sonra bu tarayıcı o kullanıcı için bilinen cihaz olur; cihazın kimliğini döndürür */
export async function rememberDevice(userId: number): Promise<string> {
  const jar = await cookies();
  const prev = await verifyDevice(jar.get(DEVICE_COOKIE)?.value);
  const did = prev?.did ?? randomBytes(12).toString("base64url");
  jar.set(DEVICE_COOKIE, await signDevice({ did, ids: addDeviceUser(prev?.ids ?? [], userId) }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/giris",
    maxAge: DEVICE_DAYS * 24 * 60 * 60,
  });
  return did;
}
