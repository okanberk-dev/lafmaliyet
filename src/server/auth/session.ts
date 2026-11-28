import { jwtVerify, SignJWT, type JWTPayload } from "jose";

import { ACILIS_AMACI, BELIRTEC_DAKIKA } from "@/lib/asilpos/kasa-acilis";
import type { Role } from "@/lib/constants";
import { isRole } from "@/lib/roles";

// Oturum: imzalı JWT, httpOnly çerezde. proxy.ts (Node runtime) ve sunucu kodu birlikte kullanır.

/** Üretimde çerezler yalnız HTTPS'te gider */
export const SECURE_COOKIES = process.env.NODE_ENV === "production";
/**
 * Üretimde "__Host-" öneki: tarayıcı bu adla yalnız Secure, Path=/ ve Domain'siz çereze izin verir. Kardeş alan adı
 * (laffogato.net, *.laffogato.net) panelin oturum, iki adım ve cihaz çerezlerini yerine koyamaz (ya da silemez).
 * Yerelde (http://localhost) önek yok.
 */
const PREFIX = SECURE_COOKIES ? "__Host-" : "";

export const SESSION_COOKIE = `${PREFIX}laf_session`;
export const SESSION_DAYS = 30;
/** Parola doğru, iki adımlı doğrulama kodu bekleniyor (10 dakika) */
export const PENDING_COOKIE = `${PREFIX}laf_2fa`;
export const PENDING_MINUTES = 10;

/** Öneksiz eski adlar ve yolları: bir sürüm boyunca okunur (oturumlar ve bilinen cihazlar düşmesin), yazılınca silinir */
export const LEGACY_COOKIES = { session: { name: "laf_session", path: "/" }, pending: { name: "laf_2fa", path: "/giris" }, device: { name: "laf_cihaz", path: "/giris" } } as const;

/** Bütün panel çerezlerinin ortak öznitelikleri (öneke uygun: Path=/, Domain yok) */
export const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIES, path: "/" } as const;

/** Çerezi okur; yeni adla yoksa eski (öneksiz) adla */
export function readCookie(jar: { get(name: string): { value: string } | undefined }, name: string, legacy: string): string | undefined {
  return jar.get(name)?.value ?? (legacy !== name ? jar.get(legacy)?.value : undefined);
}

export interface SessionPayload extends JWTPayload {
  sub: string;
  name: string;
  role: Role;
  /** Kullanıcının oturum sürümü; veritabanındakiyle aynı değilse oturum geçersiz (eski oturumlarda yok = 1) */
  sv?: number;
  /**
   * Oturumun rastgele kimliği: çıkışta bu kimlik kapatılır (revoked_sessions), çerezin kopyası da geçmez; kişinin
   * öteki cihazları etkilenmez. Bu sürümden önce açılan oturumlarda yok (kendi süreleriyle, en çok 30 günde düşerler)
   */
  jti?: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET tanımlı değil ya da 32 karakterden kısa");
    }
    return new TextEncoder().encode("gelistirme-icin-guvensiz-anahtar-degistirin-lutfen");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: { sub: string; name: string; role: Role; sv: number }) {
  return new SignJWT({ name: payload.name, role: payload.role, sv: payload.sv, typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    // Tanınmayan rol (eski ya da elle yazılmış çerez) oturum sayılmaz
    if (!payload.sub || !isRole(payload.role)) return null;
    if (payload.typ !== undefined && payload.typ !== "session") return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Oturum çerezinin kısa özeti (sha256'nın ilk 16 onaltılık hanesi). Sunucu oturumu geçersiz bulunca giriş sayfasına
 * bununla gönderir (`/giris?oturum=bitti&s=…`); proxy çerezi yalnız özet tutarsa, yani reddedilen çerezin ta kendisi
 * duruyorsa siler. Yeniden girişten sonra Geri düğmesi, önbellekteki eski yönlendirme ya da başka bir siteden gelen
 * `?oturum=bitti` bağlantısı yeni / geçerli oturumu silemez (denetim KA-02, YO-04). Özetten çerez çıkarılamaz.
 */
export async function sessionMark(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Geçersiz bulunan oturumun giriş sorgusu: "oturum bitti" ve çerezin özeti (proxy yalnız bu çerezi siler) */
export async function expiredLoginQuery(token: string): Promise<string> {
  return `oturum=bitti&s=${await sessionMark(token)}`;
}

/** Parolası doğrulanmış, kodu beklenen kullanıcı (oturum sayılmaz; yalnızca kod adımında okunur) */
export async function signPending(payload: { sub: string; sv: number; next: string }) {
  return new SignJWT({ sv: payload.sv, next: payload.next, typ: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MINUTES}m`)
    .sign(secretKey());
}

export async function verifyPending(token: string | undefined): Promise<{ sub: string; sv: number; next: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ !== "2fa" || !payload.sub || typeof payload.sv !== "number") return null;
    return { sub: payload.sub, sv: payload.sv, next: typeof payload.next === "string" ? payload.next : "" };
  } catch {
    return null;
  }
}

/*
 * Yönetim konsolunun oturumu (docs/planlar/yonetim-konsolu.md; src/lib/yonetim-host.ts): ayrı belirteç türü ve ayrı
 * çerez. Panel oturumu konsolu, konsol oturumu paneli açmaz: verifySession `typ: "yonetim"`i, verifyYonetim panelin
 * `typ: "session"`ini (ve türsüz eski oturumu) reddeder; iki adımlı bekleme belirteci de ayrı tür. Süre, sürüm (`sv`),
 * kimlik (`jti`, çıkışta revoked_sessions) ve çerez öznitelikleri panel oturumuyla aynı düzende. Çerez __Host- önekli
 * olduğu için yalnız kendi alan adına gider; panel adresinde açılan konsol çerezi de ayrıdır (adı farklı).
 */

/** Konsol oturumunun çerezi (panelinkinden ayrı ad) */
export const YONETIM_COOKIE = `${PREFIX}laf_yonetim`;
/** Konsolda parola doğru, iki adımlı kod bekleniyor (PENDING_MINUTES) */
export const YONETIM_PENDING_COOKIE = `${PREFIX}laf_yonetim_2fa`;
/** Belirteç türleri: panel oturumu ve panelin iki adım belirteciyle karışmaz */
export const YONETIM_TYP = "yonetim";
export const YONETIM_PENDING_TYP = "yonetim-2fa";

export async function signYonetim(payload: { sub: string; name: string; role: Role; sv: number }) {
  return new SignJWT({ name: payload.name, role: payload.role, sv: payload.sv, typ: YONETIM_TYP })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

/** Konsol belirteci: imza geçerli, tür tam "yonetim" (türsüz eski panel oturumu da geçmez), rol tanınır */
export async function verifyYonetim(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ !== YONETIM_TYP || !payload.sub || !isRole(payload.role)) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Konsolda parolası doğrulanmış, kodu beklenen kullanıcı (oturum sayılmaz; yalnız konsolun kod adımında okunur) */
export async function signYonetimPending(payload: { sub: string; sv: number }) {
  return new SignJWT({ sv: payload.sv, typ: YONETIM_PENDING_TYP })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MINUTES}m`)
    .sign(secretKey());
}

export async function verifyYonetimPending(token: string | undefined): Promise<{ sub: string; sv: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ !== YONETIM_PENDING_TYP || !payload.sub || typeof payload.sv !== "number") return null;
    return { sub: payload.sub, sv: payload.sv };
  } catch {
    return null;
  }
}

/**
 * Kasa açılışının belirteci (docs/ASILPOS.md › Kasa açılışı): asıl yönetici kasada ladmin girişini geçince verilir,
 * şubeye bağlama ucu ister. Oturum değildir, çerez olmaz (verifySession `typ` başka olduğu için kabul etmez); kişinin
 * oturum sürümünü ve kasanın kimliğini taşır, BELIRTEC_DAKIKA dakika geçerli. Parola değişir ya da oturumlar kapatılırsa
 * geçersiz olur (sürüm tutmaz). `now`: testler süresi geçmiş belirteç üretebilsin
 */
export async function signKasaAcilis(payload: { sub: string; sv: number; kasa: string }, now: Date = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sv: payload.sv, kasa: payload.kasa, typ: ACILIS_AMACI })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + BELIRTEC_DAKIKA * 60)
    .sign(secretKey());
}

export async function verifyKasaAcilis(token: string | undefined, now: Date = new Date()): Promise<{ sub: string; sv: number; kasa: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], currentDate: now });
    if (payload.typ !== ACILIS_AMACI || !payload.sub || typeof payload.sv !== "number" || typeof payload.kasa !== "string") return null;
    return { sub: payload.sub, sv: payload.sv, kasa: payload.kasa };
  } catch {
    return null;
  }
}

/**
 * Bilinen cihaz: bu tarayıcıdan başarıyla giriş yapmış kullanıcılar. Hesap kilidi bu cihazı dışarıda bırakmaz;
 * e-postayı bilen biri 5 yanlış parolayla sahibini panelden kapatamasın. Oturum değildir, çıkışta silinmez. `did`
 * cihazın kendi hata payının anahtarı (ortak tablette biri kişinin diğer cihazlarını kilitleyemesin). Her kişi oturum
 * sürümüyle (`sv`) birlikte saklanır: parola değişince ya da oturumlar kapatılınca o kişi için bu cihaz da bilinmez
 * olur (çalınmış bir cihaz çerezi sonsuza dek geçmesin); bir sonraki başarılı girişte yeniden bilinir.
 */
export const DEVICE_COOKIE = `${PREFIX}laf_cihaz`;
export const DEVICE_DAYS = 365;
/** Ortak tablet / kasa bilgisayarı: en son giren bu kadar kişi hatırlanır */
export const DEVICE_MAX_USERS = 10;

export type DeviceUser = { id: number; sv: number };
/** `legacyIds`: önceki biçimin (oturum sürümsüz) kişileri; yalnız LEGACY_DEVICE_UNTIL'e kadar tanınır */
export type DeviceToken = { did: string; users: DeviceUser[]; legacyIds?: number[] };

/**
 * Önceki biçimdeki cihaz çerezinin kişileri bu ana kadar tanınır: yayından sonra herkesin tarayıcısı bir anda
 * "bilinmeyen" olup hesap kilidine açık kalmasın. Oturumlar en çok 30 gün sürdüğü için o zamana kadar herkes en az bir
 * kez girer; giriş çerezi yeni biçimde (oturum sürümüyle) yazar.
 */
export const LEGACY_DEVICE_UNTIL = Date.parse("2026-11-25T00:00:00+03:00");

/** Kullanıcıyı (güncel oturum sürümüyle) listenin başına alır (tekrar yok, en fazla DEVICE_MAX_USERS) */
export function addDeviceUser(users: readonly DeviceUser[], user: DeviceUser): DeviceUser[] {
  return [{ id: user.id, sv: user.sv }, ...users.filter((x) => x.id !== user.id)].slice(0, DEVICE_MAX_USERS);
}

/** Bu cihaz kişi için bilinen mi: kişi listede ve oturum sürümü değişmemiş */
export function isKnownDevice(device: DeviceToken | null, user: { id: number; sessionVersion: number }, now = Date.now()): boolean {
  if (!device) return false;
  if (device.users.some((u) => u.id === user.id && u.sv === user.sessionVersion)) return true;
  return now < LEGACY_DEVICE_UNTIL && Boolean(device.legacyIds?.includes(user.id));
}

/**
 * Bu tarayıcıdan kişi daha önce giriş yaptı mı (oturum sürümü ne olursa olsun; eski biçimin kişileri de): yeni cihaz
 * uyarısı için (src/lib/admin-security.ts). Hesap kilidindeki "bilinen cihaz"dan geniş: parola değişince bu tarayıcı
 * kilit için bilinmez olur ama yeni cihaz sayılmaz (sahibi her parola değişikliğinden sonra uyarı almasın)
 */
export function deviceSeenBefore(device: DeviceToken | null, userId: number): boolean {
  if (!device) return false;
  return device.users.some((u) => u.id === userId) || Boolean(device.legacyIds?.includes(userId));
}

export async function signDevice(device: DeviceToken) {
  return new SignJWT({ did: device.did, u: device.users.map((x) => [x.id, x.sv]), typ: "device" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_DAYS}d`)
    .sign(secretKey());
}

export async function verifyDevice(token: string | undefined): Promise<DeviceToken | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ !== "device" || typeof payload.did !== "string" || !payload.did) return null;
    // Eski biçim (`ids`, oturum sürümsüz): kişiler yalnız geçiş süresince tanınır (LEGACY_DEVICE_UNTIL), cihazın
    // kimliği kalır; kişi yeniden girince yeni biçimde yazılır
    if (!Array.isArray(payload.u)) {
      const legacyIds = Array.isArray(payload.ids) ? payload.ids.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, DEVICE_MAX_USERS) : [];
      return { did: payload.did, users: [], legacyIds };
    }
    const users = (payload.u as unknown[])
      .filter((x): x is [number, number] => Array.isArray(x) && Number.isInteger(x[0]) && x[0] > 0 && Number.isInteger(x[1]) && x[1] > 0)
      .slice(0, DEVICE_MAX_USERS)
      .map(([id, sv]) => ({ id, sv }));
    return { did: payload.did, users };
  } catch {
    return null;
  }
}
