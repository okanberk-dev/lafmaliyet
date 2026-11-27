"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { linkAccessInfo, type AccessInfo } from "@/app/panel/kullanicilar/access";
import { DEFAULT_SETTINGS, FIFO_OFF, ROLES, settingsFromRows, type Role } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import { blockReasonOf, oldAddressNotice, userListNotice } from "@/lib/notify-recipients";
import { BRANCH_REQUIRED_ROLES, BRANCH_ROLES } from "@/lib/roles";
import { linkedDeleteText } from "@/lib/staff-link";
import { needsStepUp, stepUpWhat, type StepUpCase, type StepUpConfirm } from "@/lib/step-up";
import { accessMailHandle } from "@/server/auth/access-handle";
import { hashPassword, passwordProblem } from "@/server/auth/password";
import { requireAdmin, startSession } from "@/server/auth/dal";
import { requireStepUp } from "@/server/auth/step-up";
import { appUrl, INVITE_PASSWORD_HASH, TOKEN_HOURS } from "@/server/auth/tokens";
import { expireUserTokens, issueUserToken } from "@/server/auth/user-tokens";
import { listBranches } from "@/server/branches";
import { lockStaffLinks, staffLinkedTo } from "@/server/data/staff-links";
import { getDb, schema as s } from "@/server/db";
import { listsWithEmail } from "@/server/notify/recipients";

import { logActivity } from "./log";
import { attempt, UserError, zText } from "./util";

const numKey = z.number().finite();

/**
 * Kaydedilen hesap e-posta almıyorsa (personel, müdür ya da pasif) ve adresi kasa raporu alıcılarında, sabah
 * e-postasının bildirim adreslerinde ya da muhasebeci paketinin alıcılarındaysa yöneticiye uyarı (E-53): gönderim o
 * adresi zaten düşürür, liste temizlensin diye söylenir.
 * Dışa açılmaz ("use server" dosyasının her dışa verdiği bir uçtur).
 */
async function listNotice(user: { name: string; email: string; role: Role; active: boolean }): Promise<string | null> {
  const reason = blockReasonOf(user);
  if (!reason) return null;
  const lists = await listsWithEmail(user.email);
  return lists.length ? userListNotice(user, reason, lists) : null;
}

/**
 * E-posta almayan hesabın eski adresi bir listede kaldı ve artık hiçbir hesaba ait değil (E-53): giriş e-postası
 * değişti (hesap önce ya da sonra personel / müdür / pasif) ya da hesap silindi. Gönderim o adresi hesabı olmayan adres
 * (muhasebeci gibi) sayar, kasa ve sabah e-postası ve muhasebeci paketi ona gider; yönetici istemiyorsa listeden
 * kaldırsın diye söylenir.
 * Dışa açılmaz.
 */
async function oldAddressListNotice(user: { name: string; email: string }, blocked: boolean, why: "rename" | "delete"): Promise<string | null> {
  if (!blocked) return null;
  const lists = await listsWithEmail(user.email);
  return lists.length ? oldAddressNotice(user, lists, why) : null;
}
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
  pompaPure: numKey.min(0),
  potGr: numKey.min(0),
  potMl: numKey.gt(0, "Pottan çıkan miktar 0'dan büyük olmalı"),
  dondurmaTop: numKey.min(0),
  tkGr: numKey.min(0),
  // acikGun (ayda açık gün) şube başına: Şube ayarları › Çalışma takvimi (saveBranchCalendar); eski sekme gönderirse yok sayılır
  // Personel yemek kartı (Faz 5): günlük tutar ve ayda gün
  mealCardDaily: numKey.min(0).max(100_000),
  mealCardDays: numKey.int().min(1).max(31),
  // Sayım gruplarının olağan alış KDV'si (yeni malzemenin önerisi, listede olmayan kalemler; constants.ts groupVatRate)
  alisKdvAmbalaj: numKey.min(0).max(1),
  alisKdvGida: numKey.min(0).max(1),
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
  pompa: ["Şurup pompası (ml)", "num"],
  pompaPure: ["Püre pompası (ml)", "num"],
  potGr: ["Filtre kahve pot (gr)", "num"],
  potMl: ["Pottan çıkan (ml)", "num"],
  dondurmaTop: ["Dondurma topu (ml)", "num"],
  tkGr: ["Türk kahvesi (gr)", "num"],
  mealCardDaily: ["Yemek kartı günlük (₺)", "num"],
  mealCardDays: ["Yemek kartı ayda gün", "num"],
  alisKdvAmbalaj: ["Ambalajın alış KDV'si", "pct"],
  alisKdvGida: ["Gıdanın alış KDV'si", "pct"],
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
 * "%10" yerine "0,1" yazılınca oran binde bire düşer (yüzde alanına 0,1 yazmak %0,1 demektir). Satış ve hizmet
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

// ---------------------------------------------------------------- Stok değerleme

const fifoStartSchema = z.union([z.literal(null), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Geçerli bir ay seçin")]);
const fifoText = (v: string | null) => (v ? `FIFO, başlangıç ${monthLabel(v)}` : "ay sonu fiyatı (FIFO kapalı)");

/**
 * Stok değerleme başlangıcı (FIFO): bu aydan itibaren ay sonu stoğu faturaların sırasıyla değerlenir; null = eski
 * yöntem. Kapalı da kaydedilir ("kapali"): satır silinirse varsayılan ay geri gelirdi. Kapanmış ayların stok değerini ve
 * kârını değiştirir; işlem geçmişine eski → yeni düşer. docs/STOK-DEGERLEME.md
 */
export async function saveStockValuationStart(input: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const start = fifoStartSchema.parse(input);
    const db = getDb();
    const change = await db.transaction(async (tx) => {
      const prev = settingsFromRows(await tx.select().from(s.settings)).stokFifoBaslangic;
      if (prev === start) return null;
      const value = start ?? FIFO_OFF;
      await tx.insert(s.settings).values({ key: "stokFifoBaslangic", value }).onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
      return `Stok değerleme: ${fifoText(prev)} → ${fifoText(start)}`;
    });
    if (change) {
      await logActivity(me, "Ayarlar", change);
      refresh();
    }
    return { change };
  });
}

// ---------------------------------------------------------------- Kullanıcılar

/** Personelin şubesi: "" / null bütün şubeler; verilmezse (Aktif anahtarı) değişmez */
const zUserBranch = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null));

/**
 * Personelin ve müdürün şubesi kütükte etkin bir fiziksel şube mi (düzenlemede kişinin şimdiki şubesi pasif olsa da
 * kalabilir). Yönetici ve muhasebeci şubeye bağlanmaz: bütün şubeleri görür, seçiciyle süzer. Müdürde şube ZORUNLU
 * (docs/ROLLER.md; veritabanı kısıtı users_manager_branch_ck). Şubenin adı işlem geçmişi için döner.
 */
async function userBranch(role: Role, branchId: string | null | undefined, keep?: string | null): Promise<{ id: string | null; name: string | null } | undefined> {
  if (!(BRANCH_ROLES as readonly Role[]).includes(role)) return { id: null, name: null };
  const required = (BRANCH_REQUIRED_ROLES as readonly Role[]).includes(role);
  if (branchId === undefined) {
    if (required && !keep) throw new UserError(MANAGER_BRANCH_REQUIRED);
    return undefined;
  }
  if (!branchId) {
    if (required) throw new UserError(MANAGER_BRANCH_REQUIRED);
    return { id: null, name: null };
  }
  const b = (await listBranches()).find((x) => x.id === branchId && x.kind === "fiziksel" && (x.active || x.id === keep));
  if (!b) throw new UserError("Şube bulunamadı ya da pasif (sayfayı yenileyin)");
  return { id: b.id, name: b.name };
}

/** Rol seçimi (src/lib/constants.ts › ROLES) */
const zRole = z.enum(["admin", "manager", "staff", "accountant"]);

/** İşlem geçmişinde rolün adı: "müdür", "muhasebeci" */
const roleWord = (role: Role) => ROLES[role].toLocaleLowerCase("tr-TR");

/** Müdürün şubesi seçilmeden kayıt */
const MANAGER_BRANCH_REQUIRED = "Müdürün şubesini seçin: müdür yalnız kendi şubesini yönetir";

const userSchema = z.object({
  id: z.number().int().positive(),
  name: zText("Ad", 80),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  role: zRole,
  active: z.boolean(),
  branchId: zUserBranch,
  password: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Düzenleme penceresi açılırken kişinin hâli: veritabanındakiyle tutmazsa kayıt reddedilir (YO-01) */
  seen: z.object({ name: z.string(), email: z.string(), role: zRole, active: z.boolean(), branchId: z.string().nullable() }),
});

/** Pencere açıkken başka sekmede ya da başka bir yöneticinin yaptığı değişiklik eski formla geri yazılmasın */
const STALE_USER = "Bu kullanıcı bu arada değişti; liste yenilendi, pencereyi kapatıp yeniden açın";

/**
 * Kullanıcıyı günceller (eklemek createUser'da). Kendi hesabınızın parolası ve e-postası burada değişmez, Hesabım'da
 * mevcut parolayla değişir: Hesabım'daki parola onayı buradan atlanamasın. Yönetici yapmak, yöneticilikten almak ya da
 * bir yöneticinin erişimini, e-postasını, parolasını değiştirmek işlemi yapanın kendi parolasını ister (needsStepUp;
 * önceki hâl veritabanından okunur): açık kalmış bir yönetici oturumu yönetici hesaplarını ele geçiremesin. Ad
 * değişikliği ve personel işleri sormaz. Başkasına parola verildiyse "Giriş bilgileri"nin e-posta düğmesi için mühürlü
 * kopya döner (accessMailHandle). Pencerenin açıldığı andaki ad, e-posta, rol, erişim ve şube (`seen`) veritabanındakiyle
 * tutmazsa yazılmaz: eski form bu arada yapılan değişikliği sessizce geri almasın (YO-01). Listedeki anahtar
 * setUserActive'i kullanır.
 */
export async function saveUser(input: z.input<typeof userSchema>, confirm?: StepUpConfirm) {
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
      .where(and(eq(s.users.email, data.email), ne(s.users.id, data.id)));
    if (dup > 0) throw new UserError("Bu e-posta başka bir kullanıcıda kayıtlı");
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
    const { seen } = data;
    if (
      before.name !== seen.name ||
      before.email !== seen.email ||
      before.role !== seen.role ||
      before.active !== seen.active ||
      (before.branchId ?? null) !== seen.branchId
    ) {
      refresh();
      throw new UserError(STALE_USER);
    }
    if (data.id === me.id && (data.password || data.email !== before.email)) throw new UserError("Kendi parolanızı ve e-postanızı Hesabım'dan değiştirin");
    const branch = await userBranch(data.role, data.branchId, before.branchId);
    // Bütün denetimlerden sonra, ilk yazımdan önce: başarısız olacak işlem için parola sorulmaz
    const change: StepUpCase = { kind: "save", before, after: { role: data.role, active: data.active, email: data.email, password: Boolean(data.password) } };
    if (needsStepUp(change)) await requireStepUp(me, confirm, `${stepUpWhat(change)}: ${before.email}`);
    // Parola, rol ya da erişim değişince o kullanıcının açık oturumları kapanır
    const revoke = Boolean(data.password) || before.role !== data.role || before.active !== data.active;
    const [after] = await db
      .update(s.users)
      .set({
        name: data.name,
        email: data.email,
        role: data.role,
        active: data.active,
        ...(branch ? { branchId: branch.id } : {}),
        ...(data.password ? { passwordHash: await hashPassword(data.password), failedLogins: 0, lockedUntil: null } : {}),
        ...(revoke ? { sessionVersion: sql`${s.users.sessionVersion} + 1` } : {}),
      })
      .where(eq(s.users.id, data.id))
      .returning();
    // Bekleyen davet / sıfırlama bağlantıları artık çalışmaz: parolayı yönetici belirlediyse, giriş e-postası
    // değiştiyse (bağlantı eski ya da yanlış yazılmış adrese gitmiş olabilir) ya da hesap pasif yapıldıysa (yeniden
    // aktif yapılınca eski bağlantı canlanmasın)
    if (data.password || before.email !== data.email || (before.active && !data.active)) await expireUserTokens(data.id);
    // Personelken (parola sorulmadan) oluşturulan bağlantı yönetici girişine dönüşmesin: yöneticiye yeni bağlantı
    // createAccessLink'te parolayla oluşturulur
    if (before.role !== "admin" && data.role === "admin") await expireUserTokens(data.id);
    // Kendi adını buradan değiştiren yönetici bu cihazda oturumda kalır (ad oturum çerezinde de duruyor)
    if (after && after.id === me.id) await startSession(after);
    const branchChanged = branch && branch.id !== (before.branchId ?? null);
    await logActivity(
      me,
      "Kullanıcı güncellendi",
      `${data.name} (${roleWord(data.role)})${branchChanged && (BRANCH_ROLES as readonly Role[]).includes(data.role) ? ` · şube ${branch.name ?? "bütün şubeler"}` : ""}`,
    );
    refresh();
    // Yeni adres listede (hesap e-posta almıyorsa) ve eski adres listede kaldıysa (artık hiçbir hesabın değil): ikisi de
    const renamed = before.email !== data.email ? await oldAddressListNotice({ name: data.name, email: before.email }, Boolean(blockReasonOf(before) || blockReasonOf(data)), "rename") : null;
    const notice = [await listNotice(data), renamed].filter(Boolean).join(" ") || null;
    return { handle: data.password ? accessMailHandle(data.id, data.password) : null, notice };
  });
}

/**
 * Listedeki aktif / pasif anahtarı: yalnız erişim değişir; ad, e-posta ve rol veritabanında olduğu gibi kalır. Önceden
 * anahtar saveUser'a satırın sayfa açıldığı andaki ad, e-posta ve rolünü gönderiyordu: liste açıkken başka sekmede
 * yapılan değişiklik sessizce geri yazılıyor, bu arada yönetici yapılan kişi personele düşüyordu (denetim YO-01).
 * Parola kuralı veritabanındaki role bakar: kişi bu arada yönetici yapıldıysa parola sorulur. İstenen hâl zaten
 * yazılmışsa (başka sekmede) hiçbir şey değişmez, liste yenilenir.
 */
export async function setUserActive(id: number, active: boolean, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    const next = z.boolean().parse(active);
    if (userId === me.id) throw new UserError("Kendi hesabınızı pasif yapamazsınız");
    const db = getDb();
    const [before] = await db.select().from(s.users).where(eq(s.users.id, userId)).limit(1);
    if (!before) throw new UserError("Kullanıcı bulunamadı");
    if (before.active === next) {
      refresh();
      return { notice: null };
    }
    if (!next && before.role === "admin") {
      const [{ n }] = await db
        .select({ n: count() })
        .from(s.users)
        .where(and(eq(s.users.role, "admin"), eq(s.users.active, true), ne(s.users.id, userId)));
      if (n === 0) throw new UserError("En az bir aktif yönetici kalmalı");
    }
    const change: StepUpCase = { kind: "save", before, after: { role: before.role, active: next, email: before.email, password: false } };
    if (needsStepUp(change)) await requireStepUp(me, confirm, `${stepUpWhat(change)}: ${before.email}`);
    // Erişim değişince açık oturumlar kapanır; okunan hâl bu arada değiştiyse (aynı anda iki sekme) yazılmaz
    const [after] = await db
      .update(s.users)
      .set({ active: next, sessionVersion: sql`${s.users.sessionVersion} + 1` })
      .where(and(eq(s.users.id, userId), eq(s.users.active, before.active)))
      .returning();
    refresh();
    if (!after) return { notice: null };
    // Pasif yapılınca bekleyen davet / sıfırlama bağlantısı iptal (yeniden aktif yapılınca eski bağlantı canlanmasın)
    if (!next) await expireUserTokens(userId);
    await logActivity(me, next ? "Kullanıcı yeniden aktif yapıldı" : "Kullanıcı pasif yapıldı", `${after.name} (${roleWord(after.role)})`);
    return { notice: await listNotice(after) };
  });
}

const createSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("password"),
    name: zText("Ad", 80),
    email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
    role: zRole,
    active: z.boolean(),
    branchId: zUserBranch,
    password: z.string().max(200, "Parola en fazla 200 karakter olabilir"),
  }),
  z.object({
    mode: z.literal("invite"),
    name: zText("Ad", 80),
    email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
    role: zRole,
    active: z.literal(true, { message: "Davet edilen kullanıcı aktif olmalı" }),
    branchId: zUserBranch,
  }),
]);

/**
 * Yeni kullanıcı: parolayı yönetici belirler ("password") ya da kişi tek kullanımlık davet bağlantısından kendisi
 * belirler ("invite", 72 saat; o zamana kadar parola alanında hiçbir parolayla eşleşmeyen işaret durur).
 * Dönen veri "Giriş bilgileri" penceresini doldurur; parola geri gönderilmez (pencere zaten biliyor). Yönetici
 * eklemek (aktif ya da pasif, parolalı ya da davetli) işlemi yapanın kendi parolasını ister.
 */
export async function createUser(input: z.input<typeof createSchema>, confirm?: StepUpConfirm) {
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
    const branch = await userBranch(data.role, data.branchId ?? null);
    const change: StepUpCase = { kind: "create", role: data.role };
    if (needsStepUp(change)) await requireStepUp(me, confirm, `${stepUpWhat(change)}: ${data.email}`);
    const passwordHash = data.mode === "password" ? await hashPassword(data.password) : INVITE_PASSWORD_HASH;
    const [u] = await db
      .insert(s.users)
      .values({ name: data.name, email: data.email, role: data.role, active: data.active, branchId: branch?.id ?? null, passwordHash })
      .returning({ id: s.users.id, name: s.users.name, email: s.users.email });
    await logActivity(
      me,
      data.mode === "invite" ? "Kullanıcı davet edildi" : "Kullanıcı eklendi",
      `${data.name} (${roleWord(data.role)})${branch?.name ? ` · ${branch.name}` : ""}`,
    );
    refresh();
    const notice = (await listNotice(data)) ?? undefined;
    if (data.mode === "password") return { kind: "password", userId: u.id, name: u.name, email: u.email, loginUrl: `${appUrl()}/giris`, handle: accessMailHandle(u.id, data.password), notice };
    const { raw, expiresAt } = await issueUserToken(u.id, "invite", TOKEN_HOURS.invite);
    return { ...linkAccessInfo(appUrl(), u, "invite", raw, expiresAt), notice };
  });
}

/**
 * Kullanıcıyı kalıcı olarak siler (yanlış e-postayla eklenen ya da daveti hiç kabul edilmeyen kişi için).
 * İşlem geçmişindeki satırları adıyla durur. Kendinizi ve son aktif yöneticiyi silemezsiniz. Yönetici silmek (davetli
 * ve pasif de) işlemi yapanın kendi parolasını ister. Maaşlar'da bir satıra bağlı hesap (biten satır da) silinmez, pasif
 * yapılır (denetim bulgusu 47: bağlantı boşalınca part-time'ın geçmiş ücreti 0'a düşerdi); denetim ve silme maaş satırı
 * bağlantılarının kilidi altında, tek işlemde.
 */
export async function deleteUser(id: number, confirm?: StepUpConfirm) {
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
    // Parola sorulmadan önce (yönetici hesabında); kesin denetim aşağıda kilit altında
    const linked = await staffLinkedTo(db, userId);
    if (linked.length) throw new UserError(linkedDeleteText(linked));
    const change: StepUpCase = { kind: "delete", targetRole: u.role };
    if (needsStepUp(change)) await requireStepUp(me, confirm, `${stepUpWhat(change)}: ${u.email}`);
    await db.transaction(async (tx) => {
      // Bağlanmakta olan hesap da görülür: saveStaff aynı kilidi tutar (lockStaffLinks)
      await lockStaffLinks(tx);
      const now = await staffLinkedTo(tx, userId);
      if (now.length) throw new UserError(linkedDeleteText(now));
      await tx.delete(s.users).where(eq(s.users.id, userId));
    });
    await logActivity(me, "Kullanıcı silindi", `${u.name} (${u.email})`);
    refresh();
    // Personel ya da pasif hesabın adresi listede kaldıysa artık hesabı yok: e-posta ona gider, yönetici uyarılır
    return { notice: await oldAddressListNotice(u, Boolean(blockReasonOf(u)), "delete") };
  });
}

/**
 * Telefonunu kaybeden kullanıcının iki adımlı doğrulamasını kapatır (yeniden kendisi kurar); oturumları kapanır.
 * Kendi iki adımlınız Hesabım'da parolayla kapanır. Yöneticininkini sıfırlamak işlemi yapanın kendi parolasını ister:
 * sıfırlama bağlantısından sonra yönetici hesabını koruyan iki adımlı doğrulamadır.
 */
export async function resetUserTwoFactor(id: number, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    if (userId === me.id) throw new UserError("Kendi iki adımlı doğrulamanızı Hesabım'dan (parolanızla) kapatın");
    const db = getDb();
    const [target] = await db.select({ email: s.users.email, role: s.users.role }).from(s.users).where(eq(s.users.id, userId)).limit(1);
    if (!target) throw new UserError("Kullanıcı bulunamadı");
    const change: StepUpCase = { kind: "2fa", targetRole: target.role };
    if (needsStepUp(change)) await requireStepUp(me, confirm, `${stepUpWhat(change)}: ${target.email}`);
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

/**
 * Hatalı denemeler yüzünden kilitlenen hesabı açar: hesabın kilidi ve bilinen cihazların kendi kilitleri (sayaçlarıyla
 * birlikte; src/server/auth/login-locks.ts). Kişi kendi tarayıcısında 10 kez yanlış parola girince kilit yalnız
 * cihazın satırına yazılır; önceden yönetici bunu ne görebiliyor ne açabiliyordu (denetim YO-03).
 */
export async function unlockUser(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const userId = z.number().int().positive().parse(id);
    const db = getDb();
    const [u] = await db.update(s.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, userId)).returning({ email: s.users.email });
    if (!u) throw new UserError("Kullanıcı bulunamadı");
    await db.delete(s.loginDeviceLocks).where(eq(s.loginDeviceLocks.userId, userId));
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
