import "server-only";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb, schema as s } from "@/server/db";

import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "./session";

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
    .select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, active: s.users.active })
    .from(s.users)
    .where(eq(s.users.id, Number(session.sub)))
    .limit(1);
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

/** Sayfa ve eylemlerde: giriş yapmamışsa giriş sayfasına yönlendirir. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/giris");
  return user;
}

/** Yalnızca yönetici. Personel ise kendi sayfasına yönlendirilir. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/panel/sayim");
  return user;
}

export async function startSession(user: { id: number; name: string; role: "admin" | "staff" }) {
  const token = await signSession({ sub: String(user.id), name: user.name, role: user.role });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
