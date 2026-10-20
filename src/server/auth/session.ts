import { jwtVerify, SignJWT, type JWTPayload } from "jose";

// Oturum: imzalı JWT, httpOnly çerezde. proxy.ts (Node runtime) ve sunucu kodu birlikte kullanır.

export const SESSION_COOKIE = "laf_session";
export const SESSION_DAYS = 30;
/** Parola doğru, iki adımlı doğrulama kodu bekleniyor (10 dakika) */
export const PENDING_COOKIE = "laf_2fa";
export const PENDING_MINUTES = 10;

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
 * e-postayı bilen biri 5 yanlış parolayla sahibini panelden kapatamasın. Oturum değildir, yalnızca /giris'e gider ve
 * çıkışta silinmez. `did` cihazın kendi hata payının anahtarı (ortak tablette biri kişinin diğer cihazlarını kilitleyemesin).
 */
export const DEVICE_COOKIE = "laf_cihaz";
export const DEVICE_DAYS = 365;
/** Ortak tablet / kasa bilgisayarı: en son giren bu kadar kişi hatırlanır */
export const DEVICE_MAX_USERS = 10;

export type DeviceToken = { did: string; ids: number[] };

/** Kullanıcıyı listenin başına alır (tekrar yok, en fazla DEVICE_MAX_USERS) */
export function addDeviceUser(ids: readonly number[], id: number): number[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, DEVICE_MAX_USERS);
}

export async function signDevice(device: DeviceToken) {
  return new SignJWT({ did: device.did, ids: device.ids, typ: "device" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_DAYS}d`)
    .sign(secretKey());
}

export async function verifyDevice(token: string | undefined): Promise<DeviceToken | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.typ !== "device" || typeof payload.did !== "string" || !payload.did || !Array.isArray(payload.ids)) return null;
    const ids = payload.ids.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, DEVICE_MAX_USERS);
    return { did: payload.did, ids };
  } catch {
    return null;
  }
}
