"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { linkAccessInfo, type AccessInfo } from "@/app/panel/kullanicilar/access";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { accessMailHandle } from "@/server/auth/access-handle";
import { hashPassword, passwordProblem } from "@/server/auth/password";
import { requireAdmin, startSession } from "@/server/auth/dal";
import { appUrl, INVITE_PASSWORD_HASH, TOKEN_HOURS } from "@/server/auth/tokens";
import { expireUserTokens, issueUserToken } from "@/server/auth/user-tokens";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zText } from "./util";

const numKey = z.number().finite();
const settingsSchema = z.object({
  kdv: numKey.min(0).max(1),
  kdvHizmet: numKey.min(0).max(1),
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
  kdvHizmet: ["Hizmet satışı KDV", "pct"],
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
 * "%10" yerine "0,1" yazılınca oran binde bire düşer (Excel'deki % biçimli hücrede de 0,1 → %0,1). Satış ve hizmet
 * KDV'si, POS komisyonu ve hedef maliyet oranı için %0,5'in altı (0 hariç) gerçekçi değil: kayıt reddedilir.
 */
const PCT_SANITY = ["kdv", "kdvHizmet", "komisyon", "hedefMaliyet"] as const;

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
    .transform((v) => (v ? v : undefined)),
});

/**
 * Kullanıcıyı günceller (ya da parolayla ekler). Kendi hesabınızın parolası ve e-postası burada değişmez, Hesabım'da
 * mevcut parolayla değişir: Hesabım'daki parola onayı buradan atlanamasın. (Yönetici bütün kullanıcıları yönetir;
 * açık kalmış bir yönetici oturumu yeni bir yönetici açıp onunla her şeyi değiştirebilir.) Başkasına parola
 * verildiyse "Giriş bilgileri"nin e-posta düğmesi için mühürlü kopya döner (accessMailHandle).
 */
export async function saveUser(input: z.input<typeof userSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = userSchema.parse(input);
    if (data.password) {
      const problem = passwordProblem(data.password, data.email);
      if (problem) throw new UserError(problem);
    }
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
      if (data.id === me.id && (data.password || data.email !== before.email)) throw new UserError("Kendi parolanızı ve e-postanızı Hesabım'dan değiştirin");
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
      // Bekleyen davet / sıfırlama bağlantıları artık çalışmaz: parolayı yönetici belirlediyse, giriş e-postası
      // değiştiyse (bağlantı eski ya da yanlış yazılmış adrese gitmiş olabilir) ya da hesap pasif yapıldıysa (yeniden
      // aktif yapılınca eski bağlantı canlanmasın)
      if (data.password || before.email !== data.email || (before.active && !data.active)) await expireUserTokens(data.id);
      // Kendi adını buradan değiştiren yönetici bu cihazda oturumda kalır (ad oturum çerezinde de duruyor)
      if (after && after.id === me.id) await startSession(after);
      await logActivity(me, "Kullanıcı güncellendi", `${data.name} (${data.role === "admin" ? "yönetici" : "personel"})`);
      refresh();
      return { handle: data.password ? accessMailHandle(data.id, data.password) : null };
    }
    if (!data.password) throw new UserError("Yeni kullanıcı için parola belirleyin");
    const [u] = await db
      .insert(s.users)
      .values({ name: data.name, email: data.email, role: data.role, active: data.active, passwordHash: await hashPassword(data.password) })
      .returning({ id: s.users.id });
    await logActivity(me, "Kullanıcı eklendi", `${data.name} (${data.role === "admin" ? "yönetici" : "personel"})`);
    refresh();
    return { handle: accessMailHandle(u.id, data.password) };
  });
}

const createSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("password"),
    name: zText("Ad", 80),
    email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
    role: z.enum(["admin", "staff"]),
    active: z.boolean(),
    password: z.string().max(200, "Parola en fazla 200 karakter olabilir"),
  }),
  z.object({
    mode: z.literal("invite"),
    name: zText("Ad", 80),
    email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
    role: z.enum(["admin", "staff"]),
    active: z.literal(true, { message: "Davet edilen kullanıcı aktif olmalı" }),
  }),
]);

/**
 * Yeni kullanıcı: parolayı yönetici belirler ("password") ya da kişi tek kullanımlık davet bağlantısından kendisi
 * belirler ("invite", 72 saat; o zamana kadar parola alanında hiçbir parolayla eşleşmeyen işaret durur).
 * Dönen veri "Giriş bilgileri" penceresini doldurur; parola geri gönderilmez (pencere zaten biliyor).
 */
export async function createUser(input: z.input<typeof createSchema>) {
  return attempt(async (): Promise<AccessInfo> => {
    const me = await requireAdmin();
    const data = createSchema.parse(input);
    if (data.mode === "password") {
      const problem = passwordProblem(data.password, data.email);
      if (problem) throw new UserError(problem);
    }
    const db = getDb();
    const [{ dup }] = await db.select({ dup: count() }).from(s.users).where(eq(s.users.email, data.email));
    if (dup > 0) throw new UserError("Bu e-posta başka bir kullanıcıda kayıtlı");
    const passwordHash = data.mode === "password" ? await hashPassword(data.password) : INVITE_PASSWORD_HASH;
    const [u] = await db
      .insert(s.users)
      .values({ name: data.name, email: data.email, role: data.role, active: data.active, passwordHash })
      .returning({ id: s.users.id, name: s.users.name, email: s.users.email });
    await logActivity(
      me,
      data.mode === "invite" ? "Kullanıcı davet edildi" : "Kullanıcı eklendi",
      `${data.name} (${data.role === "admin" ? "yönetici" : "personel"})`,
    );
    refresh();
    if (data.mode === "password") return { kind: "password", userId: u.id, name: u.name, email: u.email, loginUrl: `${appUrl()}/giris`, handle: accessMailHandle(u.id, data.password) };
    const { raw, expiresAt } = await issueUserToken(u.id, "invite", TOKEN_HOURS.invite);
    return linkAccessInfo(appUrl(), u, "invite", raw, expiresAt);
  });
}

/**
 * Kullanıcıyı kalıcı olarak siler (yanlış e-postayla eklenen ya da daveti hiç kabul edilmeyen kişi için).
 * İşlem geçmişindeki satırları adıyla durur. Kendinizi ve son aktif yöneticiyi silemezsiniz.
 */
export async function deleteUser(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    if (userId === me.id) throw new UserError("Kendi hesabınızı silemezsiniz");
    const db = getDb();
    const [u] = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, active: s.users.active }).from(s.users).where(eq(s.users.id, userId)).limit(1);
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    if (u.role === "admin" && u.active) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(s.users)
        .where(and(eq(s.users.role, "admin"), eq(s.users.active, true), ne(s.users.id, userId)));
      if (n === 0) throw new UserError("En az bir aktif yönetici kalmalı");
    }
    await db.delete(s.users).where(eq(s.users.id, userId));
    await logActivity(me, "Kullanıcı silindi", `${u.name} (${u.email})`);
    refresh();
    return null;
  });
}

/**
 * Telefonunu kaybeden kullanıcının iki adımlı doğrulamasını kapatır (yeniden kendisi kurar); oturumları kapanır.
 * Kendi iki adımlınız Hesabım'da parolayla kapanır.
 */
export async function resetUserTwoFactor(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    if (userId === me.id) throw new UserError("Kendi iki adımlı doğrulamanızı Hesabım'dan (parolanızla) kapatın");
    const db = getDb();
    const [u] = await db
      .update(s.users)
      .set({ totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: null, sessionVersion: sql`${s.users.sessionVersion} + 1` })
      .where(eq(s.users.id, userId))
      .returning();
    if (!u) throw new UserError("Kullanıcı bulunamadı");
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
