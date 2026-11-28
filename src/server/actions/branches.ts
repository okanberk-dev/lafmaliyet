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
import { anaAdminEmail } from "@/lib/asil-yonetici";
import { ESKI_KASA_KAYNAGI } from "@/lib/asilpos/eski-adlar";
import { ILK_PERSONEL_ROLLERI, ilkPersonelHatasi, rolEtiketi, type IlkPersonel, type IlkPersonelRolu } from "@/lib/asilpos/kasa-acilis";
import { YENI_KURULUM_ONEKI, yeniKurulumOnayi } from "@/lib/asilpos/kasa-durumu";
import { posOffConfirmText } from "@/lib/pos/tills";
import type { StepUpConfirm } from "@/lib/step-up";
import { getYonetimUser, requireAdmin, requireAnaAdmin, requireUser } from "@/server/auth/dal";
import { requireStepUp } from "@/server/auth/step-up";
import { INVITE_PASSWORD_HASH, TOKEN_HOURS } from "@/server/auth/tokens";
import { issueUserToken } from "@/server/auth/user-tokens";
import { mailReleased, releaseTill } from "@/server/asilpos/acilis";
import { saveIlkPersonel } from "@/server/asilpos/ilk-personel";
import { loadKasaDurumu, writeHazirlik } from "@/server/asilpos/kasa-durumu";
import { issueInstallCode, revokePendingInstalls, sendInstallMail } from "@/server/asilpos/kurulum";
import { staffBranchLock } from "@/server/branch-scope";
import { branchSettingsCloseError, putBranchSetting } from "@/server/branch-settings";
import { branchUsageCount, getBranch, listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { forgetPosBranches, asilposInUse } from "@/server/asilpos/branch";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zText } from "./util";

// Şube ve kanal yönetimi (ladmin › Şubeler; Yönetim konsolu › Şubeler ve kasalar; docs/SUBE.md). Yalnız yönetici;
// şubeyi açmak, kapatmak, silmek, kasa programını değiştirmek ve kasa kurmak yalnız asıl yöneticide ve yalnız Yönetim
// konsolunun oturumuyla (requireAnaAdmin; docs/ROLLER.md › Asıl yönetici, docs/planlar/yonetim-konsolu.md › K-C): asıl
// yönetici ladmin'den gelirse "Bu iş Yönetim konsolunda yapılır". Kimlik veriye yazılır: eklendikten sonra değişmez. Kurallar saf dosyada (src/lib/branches.ts) ve
// tests/subeler.test.ts onları doğrudan çalıştırır; buradaki eylemler yalnız yetki, doğrulama, yazma ve işlem geçmişi.
// "use server" dosyasındaki her dışa açık işlev bir uçtur.

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

/**
 * İlk personel (patron, müdür, barista: ad + PIN; docs/ASILPOS.md › Kasa açılışı › İlk personel). Kural saf dosyada
 * (ilkPersonelHatasi); PIN hiçbir hata metninde, işlem geçmişinde ya da yanıtta geçmez
 */
const personelInput = z
  .array(
    z.object({
      rol: z.enum(ILK_PERSONEL_ROLLERI.map((r) => r.rol) as [IlkPersonelRolu, ...IlkPersonelRolu[]], { message: "Rol tanınmadı" }),
      ad: z.string().max(200),
      pin: z.string().max(20),
    }),
  )
  .max(ILK_PERSONEL_ROLLERI.length)
  .transform((list) => list.map((p) => ({ rol: p.rol, ad: p.ad.trim(), pin: p.pin.trim() })));

/** İlk personeli denetler (boş liste: bölüm boş bırakıldı) */
function checkPersonel(list: IlkPersonel[]): IlkPersonel[] {
  if (!list.length) return list;
  const hata = ilkPersonelHatasi(list);
  if (hata) throw new UserError(hata);
  return list;
}

/** İşlem geçmişi satırı: yalnız roller ("Patron, Müdür, Barista"); ad ve PIN yazılmaz */
const rollerMetni = (list: readonly IlkPersonel[]) => list.map((p) => rolEtiketi(p.rol)).join(", ");

const createInput = z.object({
  id: z.string().trim(),
  name: zText("Şube adı", BRANCH_NAME_MAX),
  kind,
  posSource,
  openedOn,
  posRate,
  email: branchEmail,
  /** İsteğe bağlı ilk personel (yalnız fiziksel şube); boşsa kasa bugünkü gibi kendi PIN akışını kullanır */
  personel: personelInput.optional(),
});

/**
 * Yeni şube ya da kanal açar. Kimlik bir daha değişmez: kayıtlar ona bağlanır. Yalnız asıl yönetici (sahibin kararı,
 * 26 Kasım 2026). Fiziksel şubeye e-posta verilirse şube kurulumu da yapılır (docs/ASILPOS.md › Şube kurulumu): şubenin
 * panel hesabı açılır (personel, şubede kilitli, davetle), AsilPOS kurulum bağlantısı üretilir ve ikisi tek e-postayla
 * gider; e-posta gitmese de şube ve bağlantı kalır (Hesabım'da ve konsolun Şubeler ve kasalar sayfasında görünür)
 */
export async function createBranch(input: z.input<typeof createInput>) {
  return attempt(async () => {
    const me = await requireAnaAdmin("subeAcma");
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
    const personel = checkPersonel(d.personel ?? []);
    if (personel.length && d.kind !== "fiziksel") throw new UserError("İlk personel yalnız fiziksel şubede");
    // Adres reddedilirse şube kaydı da yazılmaz: denetim eklemeden önce
    if (d.email) await assertBranchEmailFree(db, d.email, d.id.trim());
    const sortOrder = Math.max(0, ...mevcut.map((b) => b.sortOrder)) + 1;
    const { posRate: oran, email, personel: _p, ...alanlar } = d;
    void _p;
    const id = d.id.trim();
    await db.insert(s.branches).values({ ...alanlar, id, email, sortOrder, ...(oran !== undefined ? { posRate: oran } : {}) });
    forgetPosBranches();
    await logActivity(me, "Şube eklendi", `${d.name} (${d.id})${email ? ` · ${email}` : ""}`);
    if (personel.length) {
      await saveIlkPersonel(db, id, personel, me.name);
      await logActivity(me, "İlk personel ayarlandı", `${d.name} · ${rollerMetni(personel)}`, { branchId: id });
    }
    const kurulum = email ? await onboard(me, { id, name: d.name.trim(), email }) : null;
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
 * Kurulumun sonucu ("Bilgisayara kur" penceresi): bağlantı ve son geçerliliği, şube, şubenin e-postası, kasada girişte
 * kullanılacak hesap (asıl yöneticinin e-postası), e-postanın gidip gitmediği ve şube hesabı açıldı mı
 */
export interface KurulumSonucu {
  link: string;
  /** Bağlantının son geçerliliği (ISO) */
  expiresAt: string;
  mailError: string | null;
  account: "acildi" | "vardi";
  branch: { id: string; name: string };
  /** Şubenin e-postası (bağlantının gittiği adres) */
  email: string;
  /** Kasada ladmin girişinde kullanılacak hesap: asıl yöneticinin e-postası */
  girisHesabi: string;
}

/**
 * Şube kurulumu: şubenin panel hesabı (yoksa açılır: personel, şubede kilitli, davetle), yeni AsilPOS kurulum bağlantısı
 * ve e-posta. Dönen bağlantı ekranda da gösterilir (e-posta gitmezse elle iletilir). Adres bir hesaptaysa o hesap yeniden
 * kullanılır; çağıran önce `assertBranchEmailFree`'den geçirir, yani bu hep şubesiz ya da bu şubedeki personel hesabıdır
 */
async function onboard(me: { id: number; name: string }, b: { id: string; name: string; email: string }): Promise<KurulumSonucu> {
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
  const code = await issueInstallCode(db, { branchId: b.id, email: b.email, by: me.id });
  // Şube kasa kurulumu için hazırlandı: kasa açılışında seçilebilir (kasa programı ModPOS kalsa da; çekim durmaz)
  await writeHazirlik(db, b.id, me.name);
  const mail = await sendInstallMail({ to: b.email, branchName: b.name, link: code.link, expiresAt: code.expiresAt, inviteRaw });
  return {
    link: code.link,
    expiresAt: code.expiresAt.toISOString(),
    mailError: mail.ok ? null : (mail.error ?? "gönderilemedi"),
    account: existing ? "vardi" : "acildi",
    branch: { id: b.id, name: b.name },
    email: b.email,
    girisHesabi: anaAdminEmail(),
  };
}

const installInput = z.object({
  id: z.string().trim().min(1),
  email: branchEmail,
  /** Şubede kurulu kasa varken onay (yeniKurulumOnayi; sunucu sorar, ekran onaylatıp yeniden gönderir) */
  confirmReplace: z.boolean().optional(),
});

/**
 * "Bilgisayara kur": var olan şubeye AsilPOS kurulum bağlantısı (yeni bağlantı eskisini iptal eder). E-posta verilirse
 * şubeye yazılır; verilmezse şubenin kayıtlı e-postası. Şubede kurulu bir kasa varsa (src/lib/asilpos/kasa-durumu.ts)
 * önce onay ister. Yalnız asıl yönetici
 */
export async function sendBranchInstall(input: z.input<typeof installInput>) {
  return attempt(async () => {
    const me = await requireAnaAdmin("kasaKurma");
    const d = installInput.parse(input);
    const db = getDb();
    const [b] = await db.select({ id: s.branches.id, name: s.branches.name, kind: s.branches.kind, active: s.branches.active, email: s.branches.email }).from(s.branches).where(eq(s.branches.id, d.id)).limit(1);
    if (!b) throw new UserError("Şube bulunamadı");
    if (b.kind !== "fiziksel" || !b.active) throw new UserError("AsilPOS kurulumu yalnız açık fiziksel şubede");
    const email = d.email ?? b.email;
    if (!email) throw new UserError("Şubenin e-postasını yazın");
    // Kurulu kasa varken yeni kurulum eskisinin yerine geçer: önce sorulur (bağlantı üretilmeden, adres yazılmadan)
    const onay = d.confirmReplace ? null : yeniKurulumOnayi(await loadKasaDurumu(b.id, db));
    if (onay) throw new UserError(`${YENI_KURULUM_ONEKI} ${onay}`);
    // Şubeye yazılmadan ve bağlantı üretilmeden önce (kayıtlı adres de: eskiden kabul edilmiş olabilir)
    await assertBranchEmailFree(db, email, b.id);
    if (email !== b.email) await db.update(s.branches).set({ email }).where(eq(s.branches.id, b.id));
    const kurulum = await onboard(me, { id: b.id, name: b.name, email });
    await logActivity(me, "AsilPOS kurulumu gönderildi", `${b.name} · ${email}${kurulum.mailError ? ` (e-posta gitmedi: ${kurulum.mailError})` : ""}`);
    refresh();
    return kurulum;
  });
}

const staffInput = z.object({ id: z.string().trim().min(1), personel: personelInput });

/**
 * "İlk personeli ayarla" (Yönetim konsolu › Şubeler ve kasalar › şube satırı): patron, müdür ve baristanın adı ve PIN'i, mühürlü saklanır ve kasa
 * bağlanınca kasanın açık anahtarıyla şifreli teslim edilir (docs/ASILPOS.md › Kasa açılışı › İlk personel). Eskisinin
 * yerine geçer; boş liste kaydı siler. Yalnız asıl yönetici. Yanıtta PIN yok
 */
export async function saveBranchStaff(input: z.input<typeof staffInput>) {
  return attempt(async () => {
    const me = await requireAnaAdmin("ilkPersonel");
    const d = staffInput.parse(input);
    const personel = checkPersonel(d.personel);
    const db = getDb();
    const [b] = await db.select({ id: s.branches.id, name: s.branches.name, kind: s.branches.kind, active: s.branches.active }).from(s.branches).where(eq(s.branches.id, d.id)).limit(1);
    if (!b) throw new UserError("Şube bulunamadı");
    if (b.kind !== "fiziksel" || !b.active) throw new UserError("İlk personel yalnız açık fiziksel şubede ayarlanır");
    await saveIlkPersonel(db, b.id, personel, me.name);
    await logActivity(me, personel.length ? "İlk personel ayarlandı" : "İlk personel silindi", personel.length ? `${b.name} · ${rollerMetni(personel)}` : b.name, { branchId: b.id });
    refresh();
    return { saved: personel.length > 0 };
  });
}

const releaseInput = z.object({
  id: z.string().trim().min(1),
  /** Onay: şubenin adı (büyük-küçük harf ve baştaki, sondaki boşluk fark etmez) */
  ad: z.string().max(200),
});

/**
 * "Kasayı serbest bırak" (Yönetim konsolu › Şubeler ve kasalar › şube satırı; docs/ASILPOS.md › Kasa açılışı): bilgisayar değişecekse şubenin
 * kasa bağını çözer. Şubenin kasa anahtarı yeniden üretilir (eski kasa ladmin bağlantısını kaybeder), bekleyen kurulum
 * bağlantıları iptal olur, kasa kaydı "boş" yazılır; yeni bilgisayar şubeyi kasa açılışında seçebilir. Yalnız asıl
 * yönetici, yalnız kasası kurulu şubede; şubenin adı yazılır ve parolayla onaylanır. İşlem geçmişi ve asıl yöneticiye
 * e-posta
 */
export async function releaseBranchTill(input: z.input<typeof releaseInput>, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = await requireAnaAdmin("kasaSerbest");
    const d = releaseInput.parse(input);
    const db = getDb();
    const [b] = await db.select({ id: s.branches.id, name: s.branches.name, kind: s.branches.kind }).from(s.branches).where(eq(s.branches.id, d.id)).limit(1);
    if (!b) throw new UserError("Şube bulunamadı");
    if (b.kind !== "fiziksel") throw new UserError("Kasa yalnız fiziksel şubede olur");
    if ((await loadKasaDurumu(b.id, db)).durum !== "kurulu") throw new UserError("Bu şubede kurulu kasa yok; serbest bırakılacak bir şey yok");
    if (d.ad.trim().toLocaleLowerCase("tr-TR") !== b.name.trim().toLocaleLowerCase("tr-TR")) throw new UserError("Onay için şubenin adını tam yazın");
    await requireStepUp(me, confirm, `Kasayı serbest bırak: ${b.name}`, "AsilPOS");
    const { iptal } = await releaseTill(db, { branchId: b.id, by: me.name });
    await logActivity(me, "Kasa serbest bırakıldı", `${b.name} · kasa anahtarı yenilendi${iptal ? ` · ${iptal} bekleyen kurulum bağlantısı iptal edildi` : ""}`, { branchId: b.id });
    await mailReleased(me.email, b.name, me.email);
    refresh();
    return { id: b.id };
  });
}

/**
 * Düzenleme: kimlikten başka her alan isteğe bağlı, verilmeyen alanın eskisi kalır (docs/planlar/yonetim-konsolu.md ›
 * Teknik çerçeve). ladmin'in penceresi açık / kapalı durumu, türü ve kasa programını hiç göndermez (salt okunur; K-C):
 * konsolda kapatılan şubeyi ladmin'deki ad düzenlemesi yeniden açmaz, kimse ad değiştirirken ret almaz. Konsol yalnız
 * kendi alanlarını gönderir (ad ve açılış günü gitmez)
 */
const updateInput = z.object({
  id: z.string().trim().min(1),
  name: zText("Şube adı", BRANCH_NAME_MAX).optional(),
  kind: kind.optional(),
  posSource: posSource.optional(),
  /** Açılış günü: verilmezse (undefined) eskisi kalır, null siler */
  openedOn: zDate.nullish(),
  active: z.boolean().optional(),
  posRate,
  /**
   * Şubenin e-postası (fiziksel şube; her yönetici). Verilmezse (undefined) eskisi kalır; boş metin siler. Hesap açmaz,
   * bağlantı göndermez: kurulum Yönetim konsolu › Şubeler ve kasalar › "Bilgisayara kur"da
   */
  email: branchEmail.optional(),
  /** Kasası AsilPOS olan şube ModPOS'a dönerken onay (posOffConfirmText) */
  confirmPosOff: z.boolean().optional(),
});

/**
 * Adı, türü, kasa kaynağını, açılış gününü, banka POS oranını, e-postasını ve açık / kapalı durumunu değiştirir (kimlik
 * değişmez). Verilmeyen alanın eskisi kalır. Açık / kapalı durumu ve kasa programı (tür değişikliği de kasa programını
 * değiştirir) yalnız asıl yöneticide ve yalnız konsol oturumuyla (requireAnaAdmin; konsol › Şube işlemleri bu eylemi
 * yalnız açık / kapalı, tür ve kasa programıyla çağırır); öteki alanlar (ad, açılış günü, POS oranı, e-posta) her
 * yöneticide, ladmin'in panel oturumuyla da konsol oturumuyla da. Kasa AsilPOS'tan ModPOS'a
 * dönerken şube AsilPOS'u kullanıyorsa (geçiş günü ya da kayıtlı gün) onay istenir; onaylanınca şubenin geçiş günü aynı
 * işlemde silinir (çok şube, 27 Kasım 2026). Şube kapatılınca bekleyen kurulum kodları aynı işlemde iptal olur (kasa kuramaz)
 */
export async function updateBranch(input: z.input<typeof updateInput>) {
  return attempt(async () => {
    // Konsolun oturumu (yalnız asıl yönetici; src/server/auth/dal.ts getYonetimUser) varsa o, yoksa panelin yönetici kapısı
    const me = (await getYonetimUser()) ?? (await requireAdmin());
    const d = updateInput.parse(input);
    const db = getDb();
    const hepsi = await listBranches(db);
    const mevcut = hepsi.find((b) => b.id === d.id);
    if (!mevcut) throw new UserError("Şube bulunamadı");
    // Verilmeyen alan eskisi kalır: ladmin'in ad düzenlemesi konsolda kapatılan şubeyi açmaz, kasa programını değiştirmez
    const yeni = {
      name: d.name ?? mevcut.name,
      kind: d.kind ?? mevcut.kind,
      posSource: d.posSource ?? mevcut.posSource,
      active: d.active ?? mevcut.active,
      openedOn: d.openedOn === undefined ? mevcut.openedOn : d.openedOn,
    };
    // Asıl yöneticinin işleri (docs/ROLLER.md › Asıl yönetici): değişmeyen alan sormaz, ad ya da oran değiştiren yönetici
    // geçer; değişen korunan alan yalnız konsol oturumuyla (asıl yönetici ladmin'den gelirse "Bu iş Yönetim konsolunda yapılır")
    if (mevcut.active !== yeni.active) await requireAnaAdmin("subeKapatma");
    if (mevcut.posSource !== yeni.posSource || mevcut.kind !== yeni.kind) await requireAnaAdmin("kasaProgrami");
    const emailChange = d.email !== undefined && yeni.kind === "fiziksel";
    const hata = branchChangeError(
      mevcut,
      { kind: yeni.kind, posSource: yeni.posSource, active: yeni.active },
      hepsi.filter((b) => b.id !== d.id),
    );
    if (hata) throw new UserError(hata);
    // AsilPOS'tan ModPOS'a dönüş: şube AsilPOS'u kullanıyorsa onay; onaylanınca geçiş günü silinir (günleri deneme olur)
    const posOff = mevcut.posSource === "asilpos" && yeni.posSource !== "asilpos" && (await asilposInUse(d.id, db));
    if (posOff && !d.confirmPosOff) throw new UserError(posOffConfirmText(mevcut.name));
    // Başka şube bu şubenin ayarını kullanıyorsa ("Marina ile aynı") kapatılmaz: bağ tek adımlı, bağlı şube değersiz kalırdı
    if (mevcut.active && !yeni.active) {
      const bagli = await branchSettingsCloseError(db, mevcut, BRANCH_SETTING_GROUPS);
      if (bagli) throw new UserError(bagli);
    }
    if (hepsi.some((b) => b.id !== d.id && b.name.localeCompare(yeni.name, "tr", { sensitivity: "base" }) === 0)) {
      throw new UserError("Bu adda bir şube zaten var");
    }
    // Şubenin e-postası şube hesabı olabilecek bir adres olmalı (yönetici, müdür ya da muhasebecinin değil)
    const [onceki] = emailChange ? await db.select({ email: s.branches.email }).from(s.branches).where(eq(s.branches.id, d.id)).limit(1) : [];
    const yeniEposta = emailChange && (onceki?.email ?? null) !== d.email ? d.email : undefined;
    if (yeniEposta) await assertBranchEmailFree(db, yeniEposta, d.id);
    // Kapatılan şubenin tek şubelik özelliği (karaoke) düşer: başka şubede açılabilsin, şube yeniden açılınca iki şubede
    // birden açık kalmasın (src/lib/branch-features.ts featureChangeError)
    const closing = mevcut.active && !yeni.active;
    const kept = closing ? BRANCH_FEATURES.filter((f) => f.single).reduce((acc, f) => withFeature(acc, f.id, false), branchFeatures(mevcut)) : null;
    const iptal = await db.transaction(async (tx) => {
      if (posOff) await putBranchSetting(tx, ASILPOS_GROUP, d.id, { switchDay: null }, me.name);
      await tx
      .update(s.branches)
      .set({
        name: yeni.name,
        kind: yeni.kind,
        posSource: yeni.posSource,
        openedOn: yeni.openedOn,
        active: yeni.active,
        ...(kept ? { features: kept } : {}),
        ...(d.posRate !== undefined ? { posRate: d.posRate } : {}),
        ...(yeniEposta !== undefined ? { email: yeniEposta } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.branches.id, d.id));
      // Kapanan şubenin bekleyen kurulum kodları iptal (kurulu kasanın anahtarı değişmez)
      return closing ? revokePendingInstalls(tx, d.id) : 0;
    });
    // Kasa kaynağı ya da durum değiştiyse AsilPOS kasaları değişmiş olabilir: bu sunucunun önbelleği hemen düşer
    forgetPosBranches();
    const degisen = [
      mevcut.name === yeni.name ? null : `ad: ${mevcut.name} → ${yeni.name}`,
      mevcut.kind === yeni.kind ? null : `tür: ${mevcut.kind} → ${yeni.kind}`,
      mevcut.posSource === yeni.posSource ? null : `kasa: ${mevcut.posSource} → ${yeni.posSource}`,
      d.posRate === undefined || mevcut.posRate === d.posRate ? null : `POS oranı: ${mevcut.posRate === undefined ? "?" : oranMetni(mevcut.posRate)} → ${oranMetni(d.posRate)}`,
      mevcut.active === yeni.active ? null : yeni.active ? "açıldı" : "kapatıldı",
      posOff ? "AsilPOS geçiş günü silindi" : null,
      yeniEposta === undefined ? null : yeniEposta ? `e-posta: ${yeniEposta}` : "e-posta silindi",
      iptal ? `${iptal} bekleyen kurulum bağlantısı iptal edildi` : null,
    ].filter(Boolean);
    await logActivity(me, "Şube güncellendi", [yeni.name, ...degisen].join(" · "));
    refresh();
    return { id: d.id };
  });
}

const deleteInput = z.object({ id: z.string().trim().min(1) });

/**
 * Hiç kaydı olmayan, sabit olmayan şubeyi siler (yanlış açılan kayıt için). Verisi olan şube yalnız kapatılır. Yalnız
 * asıl yönetici
 */
export async function deleteBranch(input: z.input<typeof deleteInput>) {
  return attempt(async () => {
    const me = await requireAnaAdmin("subeSilme");
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
