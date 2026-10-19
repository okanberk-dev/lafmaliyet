"use server";

import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { hashPassword, verifyPassword } from "@/server/auth/password";
import { endSession, requireUser, startSession } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Parola gerekli"),
  next: z.string().optional(),
});

function safeNext(next: string | undefined, role: "admin" | "staff") {
  const fallback = role === "admin" ? "/panel" : "/panel/sayim";
  if (!next || !next.startsWith("/panel") || next.startsWith("//")) return fallback;
  return next;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email: String(formData.get("email") ?? "") };
  const { email, password, next } = parsed.data;
  const db = getDb();

  let [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);

  // İlk kurulum: hiç kullanıcı yoksa ortam değişkenindeki yönetici bilgileriyle hesap açılır
  if (!user) {
    const [{ n }] = await db.select({ n: count() }).from(s.users);
    const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (n === 0 && envEmail && process.env.ADMIN_PASSWORD && email === envEmail && password === process.env.ADMIN_PASSWORD) {
      [user] = await db
        .insert(s.users)
        .values({ email, name: process.env.ADMIN_NAME ?? "Yönetici", passwordHash: await hashPassword(password), role: "admin" })
        .returning();
    }
  }

  const ok = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!ok || !user) {
    // Kaba kuvvet denemelerini yavaşlat
    await new Promise((r) => setTimeout(r, 600));
    return { error: "E-posta ya da parola hatalı", email };
  }

  await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, user.id));
  await startSession(user);
  redirect(safeNext(next, user.role));
}

export async function logoutAction() {
  await endSession();
  redirect("/giris");
}

export type PasswordState = { error?: string; ok?: boolean };

export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const me = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const repeat = String(formData.get("repeat") ?? "");
  if (next.length < 8) return { error: "Yeni parola en az 8 karakter olmalı" };
  if (next !== repeat) return { error: "Yeni parolalar aynı değil" };
  const db = getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, me.id)).limit(1);
  if (!u || !(await verifyPassword(current, u.passwordHash))) return { error: "Mevcut parola hatalı" };
  await db.update(s.users).set({ passwordHash: await hashPassword(next) }).where(eq(s.users.id, me.id));
  await logActivity(me, "Parola değiştirildi", me.email);
  return { ok: true };
}
