import { NextResponse, type NextRequest } from "next/server";

import { canOpen, homeFor } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/server/auth/session";

// İyimser kontrol: imzası geçerli oturum çerezi yoksa panel sayfalarına girilmez.
// Asıl yetki kontrolü her sayfada ve her sunucu eyleminde ayrıca yapılır (src/server/auth/dal.ts).
// Personelin girebildiği ekranlar src/lib/roles.ts'te (STAFF_PATHS).

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/giris")) {
    // Sunucu oturumu geçersiz buldu (parola değişti, hesap pasif, oturumlar kapatıldı): çerez silinir
    if (request.nextUrl.searchParams.get("oturum") === "bitti") {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
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
