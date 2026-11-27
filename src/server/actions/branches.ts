"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { BRANCH_FEATURES, branchFeatures, withFeature } from "@/lib/branch-features";
import { ASILPOS_GROUP, BRANCH_SETTING_GROUPS } from "@/lib/branch-settings/groups";
import {
  BRANCH_EMAIL_TAKEN,
  BRANCH_KINDS,
  BRANCH_NAME_MAX,
  BRANCH_POS_SOURCES,
  branchChangeError,
  branchDeleteError,
  branchEmailTaken,
  branchIdError,
  branchSourceError,
  BRANCH_COOKIE,
  parseBranchScope,
  posRateError,
  type BranchKind,
  type BranchPosSource,
} from "@/lib/branches";
import { ESKI_KASA_KAYNAGI } from "@/lib/asilpos/eski-adlar";
import { posOffConfirmText } from "@/lib/pos/tills";
import { requireAdmin, requireAnaAdmin, requireUser } from "@/server/auth/dal";
import { INVITE_PASSWORD_HASH, TOKEN_HOURS } from "@/server/auth/tokens";
import { issueUserToken } from "@/server/auth/user-tokens";
import { issueInstallCode, sendInstallMail } from "@/server/asilpos/kurulum";
import { staffBranchLock } from "@/server/branch-scope";
import { branchSettingsCloseError, putBranchSetting } from "@/server/branch-settings";
import { branchUsageCount, getBranch, listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { forgetPosBranches, asilposInUse } from "@/server/asilpos/branch";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zText } from "./util";

// Şube ve kanal yönetimi (/panel/subeler; docs/SUBE.md). Yalnız yönetici. Kimlik veriye yazılır: eklendikten sonra
// değişmez. Kurallar saf dosyada (src/lib/branches.ts) ve tests/subeler.test.ts onları doğrudan çalıştırır; buradaki
// eylemler yalnız yetki, doğrulama, yazma ve işlem geçmişi. "use server" dosyasındaki her dışa açık işlev bir uçtur.

const kind = z.enum(BRANCH_KINDS as unknown as [BranchKind, ...BranchKind[]], { message: "Tür seçin" });
const posSource = z.preprocess(
  // Eski sekmenin formu eski değeri gönderebilir (ad değişikliği; ESKI_KASA_KAYNAGI): yenisine çevrilir
  (v) => (v === ESKI_KASA_KAYNAGI ? "asilpos" : v),
  z.enum(BRANCH_POS_SOURCES as unknown as [BranchPosSource, ...BranchPosSource[]], {
    message: "Kasa kaynağı seçin",
  }),
);
const openedOn = zDate.nullish().transform((v) => v ?? null);
/**
 * Banka POS komisyon oranı (0,02 = %2; branches.pos_rate). İsteğe bağlı: verilmezse eklemede veritabanının varsayılanı
 * (%2), düzenlemede eski değer kalır. Yalnız yönetici (eylemler requireAdmin); banka POS komisyonu şube şube bu oranla
 */
const posRate = z
  .number({ message: "POS oranını yüzde olarak yazın (ör. 2)" })
  .optional()
  .superRefine((v, ctx) => {
    const hata = v === undefined ? null : posRateError(v);
    if (hata) ctx.addIssue({ code: "custom", message: hata });
  });
/** "%2", "%1,5" (işlem geçmişi) */
const oranMetni = (v: number) => `%${(Math.round(v * 10_000) / 100).toLocaleString("tr-TR")}`;
const scopeInput = z.object({ scope: z.string().trim().max(24) });

/** Şubenin e-postası (isteğe bağlı): verilirse şube hesabı açılır ve AsilPOS kurulum bağlantısı gider */
const branchEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || z.email().safeParse(v).success, { message: "E-posta adresi geçersiz" });

const createInput = z.object({
  id: z.string().trim(),
  name: zText("Şube adı", BRANCH_NAME_MAX),
  kind,
  posSource,
  openedOn,
  posRate,
  email: branchEmail,
});

/**
 * Yeni şube ya da kanal açar. Kimlik bir daha değişmez: kayıtlar ona bağlanır. Yalnız ana yönetici (sahibin kararı,
 * 26 Kasım 2026). Fiziksel şubeye e-posta verilirse şube kurulumu da yapılır (docs/ASILPOS.md › Şube kurulumu): şubenin
 * panel hesabı açılır (personel, şubede kilitli, davetle), AsilPOS kurulum bağlantısı üretilir ve ikisi tek e-postayla
 * gider; e-posta gitmese de şube ve bağlantı kalır (Hesabım'da ve Şubeler'de görünür)
 */
export async function createBranch(input: z.input<typeof createInput>) {
  return attempt(async () => {
    const me = await requireAnaAdmin();
    const d = createInput.parse(input);
    const idHata = branchIdError(d.id);
    if (idHata) throw new UserError(idHata);
    const uyumsuz = branchSourceError(d.kind, d.posSource);
    if (uyumsuz) throw new UserError(uyumsuz);
    const db = getDb();
    const mevcut = await listBranches(db);
    if (mevcut.some((b) => b.id === d.id)) throw new UserError("Bu kimlikte bir şube zaten var");
    // Çok şube (27 Kasım 2026): her fiziksel şubenin kendi AsilPOS kasası olabilir; kasanın anahtarı kurulum kodunda üretilir
    if (mevcut.some((b) => b.name.localeCompare(d.name, "tr", { sensitivity: "base" }) === 0)) {
      throw new UserError("Bu adda bir şube zaten var");
    }
    if (d.email && d.kind !== "fiziksel") throw new UserError("E-posta ve AsilPOS kurulumu yalnız fiziksel şubede");
    // Adres reddedilirse şube kaydı da yazılmaz: denetim eklemeden önce
    if (d.email) await assertBranchEmailFree(db, d.email, d.id.trim());
    const sortOrder = Math.max(0, ...mevcut.map((b) => b.sortOrder)) + 1;
    const { posRate: oran, email, ...alanlar } = d;
    const id = d.id.trim();
    await db.insert(s.branches).values({ ...alanlar, id, email, sortOrder, ...(oran !== undefined ? { posRate: oran } : {}) });
    forgetPosBranches();
    await logActivity(me, "Şube eklendi", `${d.name} (${d.id})${email ? ` · ${email}` : ""}`);
    const kurulum = email ? await onboard(me.id, { id, name: d.name, email }) : null;
    if (kurulum) await logActivity(me, "AsilPOS kurulumu gönderildi", `${d.name} · ${email}${kurulum.mailError ? ` (e-posta gitmedi: ${kurulum.mailError})` : ""}`);
    refresh();
    return { id, kurulum };
  });
}

/**
 * Şubenin e-postası şubenin panel hesabı olabilir mi (src/lib/branches.ts › branchEmailTaken): adres bir hesaptaysa o
 * hesap yalnız şubesiz ya da bu şubedeki personel olabilir. Yönetici, müdür ya da muhasebecinin adresi reddedilir: kurulum
 * bağlantısı oraya giderdi ve bağlantı kasanın eşitleme anahtarını verir. Dışa açık değil ("use server": dışa açık işlev uçtur)
 */
async function assertBranchEmailFree(db: ReturnType<typeof getDb>, email: string, branchId: string): Promise<void> {
  const [dup] = await db.select({ branchId: s.users.branchId, role: s.users.role }).from(s.users).where(eq(s.users.email, email)).limit(1);
  if (branchEmailTaken(dup, branchId)) throw new UserError(BRANCH_EMAIL_TAKEN);
}

/**
 * Şube kurulumu: şubenin panel hesabı (yoksa açılır: personel, şubede kilitli, davetle), yeni AsilPOS kurulum bağlantısı
 * ve e-posta. Dönen bağlantı ekranda da gösterilir (e-posta gitmezse elle iletilir). Adres bir hesaptaysa o hesap yeniden
 * kullanılır; çağıran önce `assertBranchEmailFree`'den geçirir, yani bu hep şubesiz ya da bu şubedeki personel hesabıdır
 */
async function onboard(by: number, b: { id: string; name: string; email: string }): Promise<{ link: string; mailError: string | null; account: "acildi" | "vardi" }> {
  const db = getDb();
  const [existing] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, b.email)).limit(1);
  let inviteRaw: string | null = null;
  if (!existing) {
    const [u] = await db
      .insert(s.users)
      .values({ name: `${b.name} şubesi`, email: b.email, role: "staff", active: true, branchId: b.id, passwordHash: INVITE_PASSWORD_HASH })
      .returning({ id: s.users.id });
    inviteRaw = (await issueUserToken(u.id, "invite", TOKEN_HOURS.invite)).raw;
  }
  const code = await issueInstallCode(db, { branchId: b.id, email: b.email, by });
  const mail = await sendInstallMail({ to: b.email, branchName: b.name, link: code.link, expiresAt: code.expiresAt, inviteRaw });
  return { link: code.link, mailError: mail.ok ? null : (mail.error ?? "gönderilemedi"), account: existing ? "vardi" : "acildi" };
}

const installInput = z.object({ id: z.string().trim().min(1), email: branchEmail });

/**
 * Var olan şubeye AsilPOS kurulum bağlantısı (yeni bağlantı eskisini iptal eder). E-posta verilirse şubeye yazılır;
 * verilmezse şubenin kayıtlı e-postası. Yalnız ana yönetici
 */
export async function sendBranchInstall(input: z.input<typeof installInput>) {
  return attempt(async () => {
    const me = await requireAnaAdmin();
    const d = installInput.parse(input);
    const db = getDb();
    const [b] = await db.select({ id: s.branches.id, name: s.branches.name, kind: s.branches.kind, active: s.branches.active, email: s.branches.email }).from(s.branches).where(eq(s.branches.id, d.id)).limit(1);
    if (!b) throw new UserError("Şube bulunamadı");
    if (b.kind !== "fiziksel" || !b.active) throw new UserError("AsilPOS kurulumu yalnız açık fiziksel şubede");
    const email = d.email ?? b.email;
    if (!email) throw new UserError("Şubenin e-postasını yazın");
    // Şubeye yazılmadan ve bağlantı üretilmeden önce (kayıtlı adres de: eskiden kabul edilmiş olabilir)
    await assertBranchEmailFree(db, email, b.id);
    if (email !== b.email) await db.update(s.branches).set({ email }).where(eq(s.branches.id, b.id));
    const kurulum = await onboard(me.id, { id: b.id, name: b.name, email });
    await logActivity(me, "AsilPOS kurulumu gönderildi", `${b.name} · ${email}${kurulum.mailError ? ` (e-posta gitmedi: ${kurulum.mailError})` : ""}`);
    refresh();
    return kurulum;
  });
}

const updateInput = z.object({
  id: z.string().trim().min(1),
  name: zText("Şube adı", BRANCH_NAME_MAX),
  kind,
  posSource,
  openedOn,
  active: z.boolean(),
  posRate,
  /** Kasası AsilPOS olan şube ModPOS'a dönerken onay (posOffConfirmText) */
  confirmPosOff: z.boolean().optional(),
});

/**
 * Adı, türü, kasa kaynağını, açılış gününü, banka POS oranını ve açık / kapalı durumunu değiştirir (kimlik değişmez).
 * POS oranı verilmezse eskisi kalır. Kasa AsilPOS'tan ModPOS'a dönerken şube AsilPOS'u kullanıyorsa (geçiş günü ya da
 * kayıtlı gün) onay istenir; onaylanınca şubenin geçiş günü aynı işlemde silinir (çok şube, 27 Kasım 2026)
 */
export async function updateBranch(input: z.input<typeof updateInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = updateInput.parse(input);
    const db = getDb();
    const hepsi = await listBranches(db);
    const mevcut = hepsi.find((b) => b.id === d.id);
    if (!mevcut) throw new UserError("Şube bulunamadı");
    const hata = branchChangeError(
      mevcut,
      { kind: d.kind, posSource: d.posSource, active: d.active },
      hepsi.filter((b) => b.id !== d.id),
    );
    if (hata) throw new UserError(hata);
    // AsilPOS'tan ModPOS'a dönüş: şube AsilPOS'u kullanıyorsa onay; onaylanınca geçiş günü silinir (günleri deneme olur)
    const posOff = mevcut.posSource === "asilpos" && d.posSource !== "asilpos" && (await asilposInUse(d.id, db));
    if (posOff && !d.confirmPosOff) throw new UserError(posOffConfirmText(mevcut.name));
    // Başka şube bu şubenin ayarını kullanıyorsa ("Marina ile aynı") kapatılmaz: bağ tek adımlı, bağlı şube değersiz kalırdı
    if (mevcut.active && !d.active) {
      const bagli = await branchSettingsCloseError(db, mevcut, BRANCH_SETTING_GROUPS);
      if (bagli) throw new UserError(bagli);
    }
    if (hepsi.some((b) => b.id !== d.id && b.name.localeCompare(d.name, "tr", { sensitivity: "base" }) === 0)) {
      throw new UserError("Bu adda bir şube zaten var");
    }
    // Kapatılan şubenin tek şubelik özelliği (karaoke) düşer: başka şubede açılabilsin, şube yeniden açılınca iki şubede
    // birden açık kalmasın (src/lib/branch-features.ts featureChangeError)
    const closing = mevcut.active && !d.active;
    const kept = closing ? BRANCH_FEATURES.filter((f) => f.single).reduce((acc, f) => withFeature(acc, f.id, false), branchFeatures(mevcut)) : null;
    await db.transaction(async (tx) => {
      if (posOff) await putBranchSetting(tx, ASILPOS_GROUP, d.id, { switchDay: null }, me.name);
      await tx
      .update(s.branches)
      .set({
        name: d.name,
        kind: d.kind,
        posSource: d.posSource,
        openedOn: d.openedOn,
        active: d.active,
        ...(kept ? { features: kept } : {}),
        ...(d.posRate !== undefined ? { posRate: d.posRate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.branches.id, d.id));
    });
    // Kasa kaynağı ya da durum değiştiyse AsilPOS kasaları değişmiş olabilir: bu sunucunun önbelleği hemen düşer
    forgetPosBranches();
    const degisen = [
      mevcut.name === d.name ? null : `ad: ${mevcut.name} → ${d.name}`,
      mevcut.posSource === d.posSource ? null : `kasa: ${mevcut.posSource} → ${d.posSource}`,
      d.posRate === undefined || mevcut.posRate === d.posRate ? null : `POS oranı: ${mevcut.posRate === undefined ? "?" : oranMetni(mevcut.posRate)} → ${oranMetni(d.posRate)}`,
      mevcut.active === d.active ? null : d.active ? "açıldı" : "kapatıldı",
      posOff ? "AsilPOS geçiş günü silindi" : null,
    ].filter(Boolean);
    await logActivity(me, "Şube güncellendi", [d.name, ...degisen].join(" · "));
    refresh();
    return { id: d.id };
  });
}

const deleteInput = z.object({ id: z.string().trim().min(1) });

/** Hiç kaydı olmayan, sabit olmayan şubeyi siler (yanlış açılan kayıt için). Verisi olan şube yalnız kapatılır. */
export async function deleteBranch(input: z.input<typeof deleteInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id } = deleteInput.parse(input);
    const db = getDb();
    const mevcut = await getBranch(db, id);
    if (!mevcut) throw new UserError("Şube bulunamadı");
    // Şube sütunu taşıyan her tabloda bağlı kayıt aranır (src/server/branches.ts): bir kuruş bile yazılmışsa
    // şube silinmez, pasife alınır — yoksa ciro kütükten düşer
    const hata = branchDeleteError(mevcut, await branchUsageCount(db, id)) ?? (await branchSettingsCloseError(db, mevcut, BRANCH_SETTING_GROUPS));
    if (hata) throw new UserError(hata);
    await db.delete(s.branches).where(eq(s.branches.id, id));
    forgetPosBranches();
    await logActivity(me, "Şube silindi", `${mevcut.name} (${id})`);
    refresh();
    return { id };
  });
}

/**
 * Panelin şube seçimini çereze yazar (docs/SUBE.md › Seçici). Yalnız görünümü süzer, YETKİ VERMEZ: her uç ayrıca
 * `requireAdmin`/`requireUser` ile korunur, bu yüzden personel de kendi ekranlarında şube değiştirebilir.
 * Tanınmayan ya da pasif kimlik "hepsi"ye düşer (`parseBranchScope`), yani çerezde hiçbir zaman çöp durmaz.
 */
export async function chooseBranchScope(input: unknown) {
  return attempt(async () => {
    await requireUser();
    const { scope } = scopeInput.parse(input);
    const secim = parseBranchScope(scope, await listBranches());
    // Şubesi seçilmiş personel başka şubeye geçemez (seçim zaten kişinin şubesinde kilitli, src/server/branch-scope.ts)
    const kilit = await staffBranchLock();
    if (kilit && secim !== kilit) throw new UserError("Şubeniz yönetici tarafından belirlendi; başka şubeye geçemezsiniz");
    (await cookies()).set(BRANCH_COOKIE, secim, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    refresh();
    return { scope: secim };
  });
}
