import { jwtVerify, SignJWT, type JWTPayload } from "jose";

// Oturum: imzalı JWT, httpOnly çerezde. proxy.ts (Node runtime) ve sunucu kodu birlikte kullanır.

export const SESSION_COOKIE = "laf_session";
export const SESSION_DAYS = 30;

export interface SessionPayload extends JWTPayload {
  sub: string;
  name: string;
  role: "admin" | "staff";
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

export async function signSession(payload: { sub: string; name: string; role: "admin" | "staff" }) {
  return new SignJWT({ name: payload.name, role: payload.role })
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
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
