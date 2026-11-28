import "server-only";

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { formatExpiry } from "@/app/panel/kullanicilar/access";
import { needsTwoFactorSetup } from "@/lib/admin-security";
import { isAnaAdmin } from "@/lib/asil-yonetici";
import { ASILPOS_GROUP } from "@/lib/branch-settings/groups";
import { baglandiMail, serbestMail } from "@/lib/asilpos/kasa-acilis-mail";
import {
  acilisSubesi,
  acilistaListelenir,
  buKasaMi,
  hazirDegilMesaji,
  IKI_ADIM_GEREKLI,
  IKI_ADIM_KURULMALI,
  kasaBilgisi,
  OTURUM_DOLDU,
  YALNIZ_ASIL_ACAR,
  zatenKuruluMesaji,
  type AcilisSubesi,
  type KasaBilgisi,
} from "@/lib/asilpos/kasa-acilis";
import { kurulumBaglantilari } from "@/lib/asilpos/kurulum";
import { BRANCH_ID_PATTERN } from "@/lib/branches";
import { logActivity } from "@/server/actions/log";
import { charge, ghostAttempt, lockedMessage, logLock, loginIp, padTo, refund, secondFactorOk, slow, TOO_MANY, WRONG } from "@/server/auth/giris-korumalari";
import { verifyPassword } from "@/server/auth/password";
import { signKasaAcilis, verifyKasaAcilis } from "@/server/auth/session";
import { appUrl } from "@/server/auth/tokens";
import { wrongLoginCodeMessage } from "@/server/auth/totp";
import { putBranchSetting } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { ensurePosKey, forgetPosKeys } from "@/server/asilpos/branch";
import { loadKasaDurumlari, loadKasaDurumu, readHazirlik, readKasaKayitlari, readKasaKaydi, writeKasaKaydi } from "@/server/asilpos/kasa-durumu";
import { revokePendingInstalls } from "@/server/asilpos/kurulum";
import { ilkPersonelTeslim, personelForKasa, type KasaPersoneli } from "@/server/asilpos/ilk-personel";

/*
 * Kasa açılışı (docs/ASILPOS.md › Kasa açılışı; tasarım docs/planlar/kasa-acilis-ve-asil-yonetici.md › P-B2). Üç uç:
 * - giriş: asıl yöneticinin ladmin e-postası ve parolası (hesapta iki adımlı açıksa kod). Panelin giriş korumaları AYNEN
 *   (src/server/auth/giris-korumalari.ts; aynı sayaçlar). Çerez yok, oturum açılmaz: yanıt 15 dakikalık imzalı belirteç
 *   ve kasada seçilebilecek şubeler.
 * - bağla: belirteç ve kullanıcı yeniden doğrulanır; boş şubeye bağlanır (yanıt kurulum kodunun yanıtıyla aynı biçimde).
 *   Kasası kurulu şubede her zaman 409 `zaten_kurulu`: bu uç hiçbir koşulda başka kasanın anahtarını vermez, anahtar
 *   döndürmez ("devral" yok). Aynı kasa (kayıtlı kimlik ya da şubenin anahtarıyla imza) yineleyebilir.
 * - teslim: kasa ilk personeli aldığını şube anahtarıyla imzalı onaylar; mühürlü PIN'ler silinir.
 * Parola, PIN, belirteç ve anahtar hiçbir kayda, günlüğe ya da işlem geçmişine yazılmaz. Var olan uçlara (kurulum kodu,
 * /api/panel/pos/*, /api/pos/gun) ve anahtar çözümüne (resolvePosCaller, readKeys, ensurePosKey) dokunulmaz.
 */

export interface Yanit {
  status: number;
  body: Record<string, unknown>;
}

/** İstek gövdelerinin en büyüğü (giriş ve bağla) */
export const ACILIS_MAX_BYTES = 4096;

const hata = (status: number, error: string, mesaj: string, extra: Record<string, unknown> = {}): Yanit => ({ status, body: { ok: false, error, mesaj, ...extra } });
const GECERSIZ = (mesaj = "İstek anlaşılmadı") => hata(400, "gecersiz", mesaj);
const EPOSTA_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

type UserRow = typeof s.users.$inferSelect;

/**
 * Kasada seçilebilecek şubeler: açık, fiziksel ve (hazırlanmış ya da kasa programı AsilPOS). Kurulu ve bu kasa değilse
 * seçilemez. Sıra Şubeler'deki sıra
 */
export async function acilisSubeleri(db: DB, kasa: Pick<KasaBilgisi, "kimlik">, imzaSubesi: string | null, now: Date = new Date()): Promise<AcilisSubesi[]> {
  const rows = (await listBranches(db)).filter((b) => b.active && b.kind === "fiziksel");
  const hazir = await readHazirlik(
    rows.map((b) => b.id),
    db,
  );
  const listed = rows.filter((b) => acilistaListelenir(b, hazir.has(b.id)));
  const ids = listed.map((b) => b.id);
  const [durum, kayit] = await Promise.all([loadKasaDurumlari(ids, db, now), readKasaKayitlari(ids, db)]);
  return listed.map((b) => acilisSubesi(b, durum[b.id] ?? { durum: "yok" }, buKasaMi({ kayit: kayit.get(b.id) ?? null, kimlik: kasa.kimlik, imzaSubesi, subeId: b.id })));
}

/**
 * POST /api/asilpos/acilis/giris. Gövde `{eposta, parola, kod?, kasa:{kimlik, surum?, acikAnahtar?}}`. `ip`: istemcinin
 * IP'si (IP sınırı); `imzaSubesi`: istek bir şubenin kasa anahtarıyla da imzalıysa o şube (resolvePosCaller), yoksa null
 */
export async function acilisGiris(input: { body: unknown; ip: string; imzaSubesi: string | null; now?: Date }, db: DB = getDb()): Promise<Yanit> {
  const started = Date.now();
  const now = input.now ?? new Date();
  const fail = async (r: Yanit): Promise<Yanit> => {
    await padTo(started);
    return r;
  };
  const b = obj(input.body);
  const eposta = typeof b?.eposta === "string" ? b.eposta.trim().toLowerCase() : "";
  const parola = typeof b?.parola === "string" ? b.parola : "";
  const kod = typeof b?.kod === "string" ? b.kod.trim().slice(0, 64) : "";
  const kasa = kasaBilgisi(b?.kasa);
  if (!EPOSTA_RE.test(eposta) || eposta.length > 200) return GECERSIZ("Geçerli bir e-posta girin");
  if (!parola || parola.length > 200) return GECERSIZ("Parola gerekli");
  if (!kasa) return GECERSIZ("Kasanın kimliği eksik ya da bozuk");

  const [user] = await db.select().from(s.users).where(eq(s.users.email, eposta)).limit(1);
  // Her deneme IP'nin payından düşer (panelin girişiyle aynı sayaç); doğru parola geri verir
  if (!loginIp.hit(input.ip)) return fail(hata(429, "cok_deneme", TOO_MANY));
  // Kayıtsız ya da pasif: parola yine bir özetle denenir, kilit bellekte (kayıtlı hesapla aynı kural ve süre)
  if (!user || !user.active) {
    const g = await ghostAttempt(eposta, parola);
    if (g.undoIp) loginIp.undo(input.ip);
    return fail(g.error === WRONG ? hata(401, "hatali", WRONG) : hata(429, "kilitli", g.error));
  }
  // Bilinen cihaz yok (çerez yok): hesabın kilidi (5 hatada 15 dakika)
  const r = await charge(user.id, null);
  if (!r.ok) {
    loginIp.undo(input.ip);
    return fail(hata(429, "kilitli", lockedMessage(r.until)));
  }
  if (!(await verifyPassword(parola, user.passwordHash))) {
    if (r.locked) await logLock(user, "kasa açılışının parolası", null);
    return fail(r.locked ? hata(429, "kilitli", lockedMessage(r.locked)) : hata(401, "hatali", WRONG));
  }
  loginIp.undo(input.ip);

  // Parola doğru: yalnız asıl yönetici geçer (sayılan deneme geri verilir)
  if (!isAnaAdmin(user)) {
    await refund(user.id, null);
    await logActivity(user, "Kasa açılışı reddedildi", `${user.email}: asıl yönetici değil`, { branchId: null });
    return fail(hata(403, "asil_yonetici_degil", YALNIZ_ASIL_ACAR));
  }
  if (user.totpEnabled && user.totpSecret) {
    // Parola doğru, kod bekleniyor: deneme geri verilir, kod kendi denemesini aynı paydan sayar (panelin kod adımı gibi)
    await refund(user.id, null);
    if (!kod) return { status: 200, body: { ok: false, ikiAdim: true, error: "iki_adim", mesaj: IKI_ADIM_GEREKLI } };
    const r2 = await charge(user.id, null);
    if (!r2.ok) return fail(hata(429, "kilitli", lockedMessage(r2.until), { ikiAdim: true }));
    if (!(await secondFactorOk(user, kod, "kasa açılışı"))) {
      if (r2.locked) await logLock(user, "kasa açılışının iki adımlı kodu", null);
      await slow();
      return r2.locked ? hata(429, "kilitli", lockedMessage(r2.locked), { ikiAdim: true }) : hata(401, "kod_hatali", wrongLoginCodeMessage(kod, false), { ikiAdim: true });
    }
  } else if (needsTwoFactorSetup(user)) {
    await refund(user.id, null);
    return fail(hata(403, "iki_adim_kurulmali", IKI_ADIM_KURULMALI));
  }

  // Başarılı giriş: sayaç sıfırlanır (panelin girişi gibi); oturum açılmaz, son giriş zamanı değişmez
  await db.update(s.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, user.id));
  const belirtec = await signKasaAcilis({ sub: String(user.id), sv: user.sessionVersion, kasa: kasa.kimlik }, now);
  const subeler = await acilisSubeleri(db, kasa, input.imzaSubesi, now);
  await logActivity(user, "Kasa açılışı için giriş", `${user.email} · kasa ${kasa.kimlik}${kasa.surum ? ` · sürüm ${kasa.surum}` : ""}`, { branchId: null });
  return { status: 200, body: { ok: true, kisi: { ad: user.name }, belirtec, subeler } };
}

/** Belirtecin kişisi: etkin, hâlâ asıl yönetici, oturum sürümü aynı ve aynı kasa; değilse ret yanıtı */
async function belirtecKisisi(db: DB, belirtec: unknown, kasa: KasaBilgisi, now: Date): Promise<{ user: UserRow } | { yanit: Yanit }> {
  const t = typeof belirtec === "string" && belirtec.length <= 2000 ? await verifyKasaAcilis(belirtec, now) : null;
  const id = t ? Number(t.sub) : NaN;
  if (!t || !Number.isSafeInteger(id) || t.kasa !== kasa.kimlik) return { yanit: hata(401, "oturum_doldu", OTURUM_DOLDU) };
  const [user] = await db.select().from(s.users).where(eq(s.users.id, id)).limit(1);
  if (!user || !user.active || user.sessionVersion !== t.sv) return { yanit: hata(401, "oturum_doldu", OTURUM_DOLDU) };
  if (!isAnaAdmin(user)) return { yanit: hata(403, "asil_yonetici_degil", YALNIZ_ASIL_ACAR) };
  return { user };
}

/** Asıl yöneticiye e-posta; e-posta kurulu değilse ya da gönderilemezse sessiz geçer (işlemi bozmaz) */
async function mailAsil(to: string, m: { subject: string; html: string; text: string }): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const notify = await loadNotifySettings();
    const res = await sendEmail({ from: resolveFrom(notify.from), to: [to], subject: m.subject, html: m.html, text: m.text });
    if (!res.ok) console.error("[asilpos] kasa açılışı e-postası gitmedi:", res.error);
  } catch (e) {
    console.error("[asilpos] kasa açılışı e-postası gitmedi:", e);
  }
}

/**
 * POST /api/asilpos/acilis/bagla. Gövde `{belirtec, sube, kasa:{kimlik, surum?, acikAnahtar?}}` (`devral` gelse de yok
 * sayılır). 200 yanıtı kurulum kodunun yanıtıyla aynı biçimde: `{ok:true, sube:{id,ad}, baglanti:{…}}`, kasa açık
 * anahtar gönderdiyse ve ilk personel ayarlıysa ek alan `personel`
 */
export async function acilisBagla(input: { body: unknown; imzaSubesi: string | null; now?: Date }, db: DB = getDb()): Promise<Yanit> {
  const now = input.now ?? new Date();
  const b = obj(input.body);
  const kasa = kasaBilgisi(b?.kasa);
  const subeId = typeof b?.sube === "string" ? b.sube.trim() : "";
  if (!kasa) return GECERSIZ("Kasanın kimliği eksik ya da bozuk");
  if (!BRANCH_ID_PATTERN.test(subeId)) return GECERSIZ("Şube anlaşılmadı");
  const who = await belirtecKisisi(db, b?.belirtec, kasa, now);
  if ("yanit" in who) return who.yanit;
  const { user } = who;

  const [branch] = await db.select({ id: s.branches.id, name: s.branches.name, kind: s.branches.kind, active: s.branches.active, posSource: s.branches.posSource }).from(s.branches).where(eq(s.branches.id, subeId)).limit(1);
  if (!branch) return hata(404, "sube_yok", "Şube bulunamadı");
  if (!branch.active) return hata(409, "sube_kapali", `${branch.name} şubesi kapalı; kasa bağlanamaz`);
  if (branch.kind !== "fiziksel") return hata(409, "sube_fiziksel_degil", `${branch.name} fiziksel bir şube değil; kasası olmaz`);
  const hazir = (await readHazirlik([branch.id], db)).has(branch.id);
  if (!acilistaListelenir(branch, hazir)) {
    return hata(409, "sube_hazir_degil", hazirDegilMesaji(branch.name));
  }
  const kayit = await readKasaKaydi(branch.id, db);
  const durum = await loadKasaDurumu(branch.id, db, now);
  const buKasa = buKasaMi({ kayit, kimlik: kasa.kimlik, imzaSubesi: input.imzaSubesi, subeId: branch.id });
  // Kurulu şube kasadan alınamaz: anahtar dönmez, verilmez (bilgisayar değişikliği yalnız asıl yöneticinin "Kasayı serbest bırak"ıyla)
  if (durum.durum === "kurulu" && !buKasa) {
    return hata(409, "zaten_kurulu", zatenKuruluMesaji(branch.name), { sube: { id: branch.id, ad: branch.name }, kasa: { sonGun: durum.sonGun } });
  }
  const yeni = !(kayit?.durum === "kurulu" && kayit.kimlik === kasa.kimlik);
  const at = now.toISOString();
  // Anahtar işlemin içinden (grubun kilidinin altında okunan ya da üretilen; kurulum koduyla aynı yol): şubenin anahtarı
  // varsa aynen verilir, yoksa burada üretilir
  const { key, created } = await db.transaction(async (tx) => {
    const k = await ensurePosKey(tx, branch.id, "kasa açılışı");
    await writeKasaKaydi(tx, branch.id, { durum: "kurulu", kimlik: kasa.kimlik, surum: kasa.surum, at: yeni ? at : kayit!.at || at, by: user.name, yol: "acilis" });
    return k;
  });
  if (created) forgetPosKeys();
  const personel: KasaPersoneli | null = await personelForKasa(db, branch.id, kasa.acikAnahtar, now);
  if (yeni) {
    await logActivity(user, "Kasa şubeye bağlandı", `${branch.name} · kasa ${kasa.kimlik}${kasa.surum ? ` · sürüm ${kasa.surum}` : ""}`, { branchId: branch.id });
    await mailAsil(user.email, baglandiMail({ sube: branch.name, kim: user.email, zaman: formatExpiry(at), kasa: kasa.kimlik }));
  }
  const baglanti = kurulumBaglantilari({ panelUrl: appUrl(), syncSecret: key });
  return { status: 200, body: { ok: true, sube: { id: branch.id, ad: branch.name }, baglanti, ...(personel ? { personel } : {}) } };
}

/**
 * POST /api/asilpos/acilis/teslim (şube anahtarıyla imzalı; şube imzadan): kasa ilk personeli aldı. Mühürlü PIN'ler
 * silinir, "teslim edildi" izi kalır. Yinelenebilir: döner `{ok:true, silindi}`
 */
export async function acilisTeslim(subeId: string, db: DB = getDb(), now: Date = new Date()): Promise<Yanit> {
  const silindi = await ilkPersonelTeslim(db, subeId, now);
  if (silindi) await logActivity(null, "İlk personel kasaya teslim edildi", subeId, { branchId: subeId });
  return { status: 200, body: { ok: true, silindi } };
}

/**
 * "Kasayı serbest bırak" (Yönetim konsolu › Şubeler ve kasalar ve ladmin › Şube ekleme; asıl yönetici, eylem
 * src/server/actions/branches.ts): şubenin kasa anahtarı yeniden üretilir (eski kasa panelle bağlantısını kaybeder:
 * imzası 401), bekleyen kurulum kodları iptal olur, kasa kaydı "boş" yazılır. Tek işlemde. Anahtar ortam değişkenindeyse (eski tek kasalı kurulum, Marina) yeni anahtar
 * panelde saklanır ve ortamdakinin önüne geçer. Döner: iptal edilen kod sayısı
 */
export async function releaseTill(db: DB, o: { branchId: string; by: string }, now: Date = new Date()): Promise<{ iptal: number }> {
  const iptal = await db.transaction(async (tx) => {
    await putBranchSetting(tx, ASILPOS_GROUP, o.branchId, { secret: randomBytes(32).toString("base64url") }, o.by);
    const n = await revokePendingInstalls(tx, o.branchId, now);
    await writeKasaKaydi(tx, o.branchId, { durum: "bos", kimlik: null, surum: null, at: now.toISOString(), by: o.by, yol: "serbest" });
    return n;
  });
  forgetPosKeys();
  return { iptal };
}

/** Serbest bırakmanın e-postası (asıl yöneticiye) */
export async function mailReleased(to: string, sube: string, kim: string, now: Date = new Date()): Promise<void> {
  await mailAsil(to, serbestMail({ sube, kim, zaman: formatExpiry(now.toISOString()) }));
}
