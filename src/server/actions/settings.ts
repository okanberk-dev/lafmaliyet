"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { DEFAULT_SETTINGS } from "@/lib/constants";
import { hashPassword } from "@/server/auth/password";
import { requireAdmin, startSession } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zText } from "./util";

const numKey = z.number().finite();
const settingsSchema = z.object({
  kdv: numKey.min(0).max(1),
  komisyon: numKey.min(0).max(1),
  kartOrani: numKey.min(0).max(1),
  hedefMaliyet: numKey.gt(0, "Hedef maliyet oranı 0'dan büyük olmalı").max(1),
  fire: numKey.min(0).max(1),
  shotTek: numKey.min(0),
  shotCift: numKey.min(0),
  pompa: numKey.min(0),
  potGr: numKey.min(0),
  potMl: numKey.gt(0, "Pottan çıkan miktar 0'dan büyük olmalı"),
  dondurmaTop: numKey.min(0),
  tkGr: numKey.min(0),
  acikGun: numKey.int().min(1).max(31),
  fireExcludesPackaging: z.boolean(),
  suBirimLTOverride: numKey.min(0).nullable(),
  publicMenu: z.boolean(),
});

/** İşlem geçmişinde okunur ad ve biçim ("Satış KDV: %10 → %20", "Su + buz ₺/L: otomatik → 0,05") */
const SETTING_LOG: Record<string, [label: string, kind: "pct" | "num" | "bool" | "water"]> = {
  kdv: ["Satış KDV", "pct"],
  komisyon: ["POS komisyonu", "pct"],
  kartOrani: ["Kartlı satış oranı", "pct"],
  hedefMaliyet: ["Hedef maliyet oranı", "pct"],
  fire: ["Fire payı", "pct"],
  shotTek: ["Tek shot (gr)", "num"],
  shotCift: ["Çift shot (gr)", "num"],
  pompa: ["Pompa (ml)", "num"],
  potGr: ["Filtre kahve pot (gr)", "num"],
  potMl: ["Pottan çıkan (ml)", "num"],
  dondurmaTop: ["Dondurma topu (ml)", "num"],
  tkGr: ["Türk kahvesi (gr)", "num"],
  acikGun: ["Açık gün", "num"],
  fireExcludesPackaging: ["Fire ambalaja uygulanmasın", "bool"],
  suBirimLTOverride: ["Su + buz ₺/L", "water"],
  publicMenu: ["QR menü yayında", "bool"],
};

function logValue(key: string, value: unknown) {
  const kind = SETTING_LOG[key]?.[1] ?? "num";
  const n = (v: number, digits = 2) => v.toLocaleString("tr-TR", { maximumFractionDigits: digits });
  if (value === null || value === undefined) return "otomatik";
  if (typeof value === "boolean") return value ? "evet" : "hayır";
  if (typeof value !== "number") return String(value);
  return kind === "pct" ? `%${n(value * 100, 4)}` : n(value, kind === "water" ? 4 : 2);
}

/** Aynı değer yeniden gönderilince kayıt ve işlem geçmişi satırı oluşmaz */
function sameValue(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-12;
  return (a ?? null) === (b ?? null);
}

/**
 * "%10" yerine "0,1" yazılınca oran binde bire düşer (Excel'deki % biçimli hücrede de 0,1 → %0,1). Satış KDV'si,
 * POS komisyonu ve hedef maliyet oranı için %0,5'in altı (0 hariç) gerçekçi değil: kayıt reddedilir.
 */
const PCT_SANITY = ["kdv", "komisyon", "hedefMaliyet"] as const;

/**
 * Yalnızca gönderilen ve kayıtlı değerden farklı ayarları yazar; işlem geçmişine "Etiket: eski → yeni" olarak
 * düşer. Dönüşteki `changes` aynı metinlerdir (istemci bildirimde gösterir).
 */
export async function saveSettings(input: Partial<z.input<typeof settingsSchema>>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = settingsSchema.partial().parse(input);
    for (const key of PCT_SANITY) {
      const v = data[key];
      if (v !== undefined && v > 0 && v < 0.005) {
        throw new UserError(`${SETTING_LOG[key][0]} ${logValue(key, v)} olamaz; yüzde olarak yazın (ör. %10 için 10)`);
      }
    }
    const db = getDb();
    const changes = await db.transaction(async (tx) => {
      const rows = await tx.select().from(s.settings);
      const prev: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const r of rows) if (r.key in DEFAULT_SETTINGS) prev[r.key] = r.value;
      const out: string[] = [];
      for (const [key, value] of Object.entries(data)) {
        if (!(key in DEFAULT_SETTINGS) || value === undefined || sameValue(prev[key], value)) continue;
        if (value === null) await tx.delete(s.settings).where(eq(s.settings.key, key));
        else await tx.insert(s.settings).values({ key, value }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
        out.push(`${SETTING_LOG[key]?.[0] ?? key}: ${logValue(key, prev[key])} → ${logValue(key, value)}`);
      }
      return out;
    });
    if (changes.length) {
      await logActivity(me, "Ayarlar", changes.join(", "));
      refresh();
    }
    return { changes };
  });
}

// ---------------------------------------------------------------- Kullanıcılar

const userSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: zText("Ad", 80),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  role: z.enum(["admin", "staff"]),
  active: z.boolean(),
  password: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v.length >= 8, "Parola en az 8 karakter olmalı"),
});

export async function saveUser(input: z.input<typeof userSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = userSchema.parse(input);
    const db = getDb();
    const [{ dup }] = await db
      .select({ dup: count() })
      .from(s.users)
      .where(data.id ? and(eq(s.users.email, data.email), ne(s.users.id, data.id)) : eq(s.users.email, data.email));
    if (dup > 0) throw new UserError("Bu e-posta başka bir kullanıcıda kayıtlı");
    if (data.id) {
      if (data.id === me.id && (data.role !== "admin" || !data.active)) throw new UserError("Kendi yönetici yetkinizi kaldıramazsınız");
      if (data.role !== "admin" || !data.active) {
        const [{ n }] = await db
          .select({ n: count() })
          .from(s.users)
          .where(and(eq(s.users.role, "admin"), eq(s.users.active, true), ne(s.users.id, data.id)));
        if (n === 0) throw new UserError("En az bir aktif yönetici kalmalı");
      }
      const [before] = await db.select().from(s.users).where(eq(s.users.id, data.id)).limit(1);
      if (!before) throw new UserError("Kullanıcı bulunamadı");
      // Parola, rol ya da erişim değişince o kullanıcının açık oturumları kapanır
      const revoke = Boolean(data.password) || before.role !== data.role || before.active !== data.active;
      const [after] = await db
        .update(s.users)
        .set({
          name: data.name,
          email: data.email,
          role: data.role,
          active: data.active,
          ...(data.password ? { passwordHash: await hashPassword(data.password), failedLogins: 0, lockedUntil: null } : {}),
          ...(revoke ? { sessionVersion: sql`${s.users.sessionVersion} + 1` } : {}),
        })
        .where(eq(s.users.id, data.id))
        .returning();
      // Kendi parolasını buradan değiştiren yönetici bu cihazda oturumda kalır
      if (after && after.id === me.id) await startSession(after);
    } else {
      if (!data.password) throw new UserError("Yeni kullanıcı için parola belirleyin");
      await db.insert(s.users).values({ name: data.name, email: data.email, role: data.role, active: data.active, passwordHash: await hashPassword(data.password) });
    }
    await logActivity(me, data.id ? "Kullanıcı güncellendi" : "Kullanıcı eklendi", `${data.name} (${data.role === "admin" ? "yönetici" : "personel"})`);
    refresh();
    return null;
  });
}

/** Telefonunu kaybeden kullanıcının iki adımlı doğrulamasını kapatır (yeniden kendisi kurar); oturumları kapanır */
export async function resetUserTwoFactor(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    const db = getDb();
    const [u] = await db
      .update(s.users)
      .set({ totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: null, sessionVersion: sql`${s.users.sessionVersion} + 1` })
      .where(eq(s.users.id, userId))
      .returning();
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    if (u.id === me.id) await startSession(u);
    await logActivity(me, "İki adımlı doğrulama sıfırlandı", u.email);
    refresh();
    return null;
  });
}

/** Hatalı denemeler yüzünden kilitlenen hesabı açar */
export async function unlockUser(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    const [u] = await getDb().update(s.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, userId)).returning({ email: s.users.email });
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    await logActivity(me, "Hesap kilidi açıldı", u.email);
    refresh();
    return null;
  });
}

/** Kullanıcının bütün cihazlardaki oturumlarını kapatır */
export async function signOutUserEverywhere(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    if (userId === me.id) throw new UserError("Kendi oturumlarınız için Hesabım'daki parola değişikliğini kullanın");
    const [u] = await getDb()
      .update(s.users)
      .set({ sessionVersion: sql`${s.users.sessionVersion} + 1` })
      .where(eq(s.users.id, userId))
      .returning({ email: s.users.email });
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    await logActivity(me, "Oturumlar kapatıldı", u.email);
    refresh();
    return null;
  });
}
