import { jwtVerify, SignJWT, type JWTPayload } from "jose";

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
  role: "admin" | "staff";
  /** Kullanıcının oturum sürümü; veritabanındakiyle aynı değilse oturum geçersiz (eski oturumlarda yok = 1) */
  sv?: number;
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

export async function signSession(payload: { sub: string; name: string; role: "admin" | "staff"; sv: number }) {
  return new SignJWT({ name: payload.name, role: payload.role, sv: payload.sv, typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || (payload.role !== "admin" && payload.role !== "staff")) return null;
    if (payload.typ !== undefined && payload.typ !== "session") return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
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
export type DeviceToken = { did: string; users: DeviceUser[] };

/** Kullanıcıyı (güncel oturum sürümüyle) listenin başına alır (tekrar yok, en fazla DEVICE_MAX_USERS) */
export function addDeviceUser(users: readonly DeviceUser[], user: DeviceUser): DeviceUser[] {
  return [{ id: user.id, sv: user.sv }, ...users.filter((x) => x.id !== user.id)].slice(0, DEVICE_MAX_USERS);
}

/** Bu cihaz kişi için bilinen mi: kişi listede ve oturum sürümü değişmemiş */
export function isKnownDevice(device: DeviceToken | null, user: { id: number; sessionVersion: number }): boolean {
  return Boolean(device?.users.some((u) => u.id === user.id && u.sv === user.sessionVersion));
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
    // Eski biçim (`ids`, oturum sürümsüz) kişileri tanıtmaz: cihazın kimliği kalır, kişiler yeniden girince eklenir
    const raw = Array.isArray(payload.u) ? (payload.u as unknown[]) : [];
    const users = raw
      .filter((x): x is [number, number] => Array.isArray(x) && Number.isInteger(x[0]) && x[0] > 0 && Number.isInteger(x[1]) && x[1] > 0)
      .slice(0, DEVICE_MAX_USERS)
      .map(([id, sv]) => ({ id, sv }));
    return { did: payload.did, users };
  } catch {
    return null;
  }
}
