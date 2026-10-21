import { NextResponse, type NextRequest } from "next/server";

import { canOpen, homeFor } from "@/lib/roles";
import { COOKIE_BASE, LEGACY_COOKIES, readCookie, SESSION_COOKIE, verifySession } from "@/server/auth/session";

// İyimser kontrol: imzası geçerli oturum çerezi yoksa panel sayfalarına girilmez.
// Asıl yetki kontrolü her sayfada ve her sunucu eyleminde ayrıca yapılır (src/server/auth/dal.ts).
// Personelin girebildiği ekranlar src/lib/roles.ts'te (STAFF_PATHS).

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySession(readCookie(request.cookies, SESSION_COOKIE, LEGACY_COOKIES.session.name));

  if (pathname.startsWith("/giris")) {
    // Sunucu oturumu geçersiz buldu (parola değişti, hesap pasif, oturumlar kapatıldı): çerez silinir
    if (request.nextUrl.searchParams.get("oturum") === "bitti") {
      const res = NextResponse.next();
      // __Host- çerezi yalnız aynı özniteliklerle (Secure, Path=/) silinir
      res.cookies.set(SESSION_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
      if (LEGACY_COOKIES.session.name !== SESSION_COOKIE) res.cookies.set(LEGACY_COOKIES.session.name, "", { path: "/", maxAge: 0 });
      return res;
    }
    if (session) return NextResponse.redirect(new URL(homeFor(session.role), request.url));
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Giriş gerekli" }, { status: 401 });
    }
    const url = new URL("/giris", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (!canOpen(session.role, pathname)) {
    return NextResponse.redirect(new URL(homeFor(session.role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/:path*", "/giris", "/api/export/:path*"],
};
