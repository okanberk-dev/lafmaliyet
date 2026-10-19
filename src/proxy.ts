import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySession } from "@/server/auth/session";

// İyimser kontrol: imzası geçerli oturum çerezi yoksa panel sayfalarına girilmez.
// Asıl yetki kontrolü her sayfada ve her sunucu eyleminde ayrıca yapılır (src/server/auth/dal.ts).

const STAFF_ALLOWED = ["/panel/sayim", "/panel/receteler", "/panel/hesap"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/giris")) {
    if (session) return NextResponse.redirect(new URL(session.role === "admin" ? "/panel" : "/panel/sayim", request.url));
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

  if (session.role === "staff" && pathname.startsWith("/panel") && !STAFF_ALLOWED.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/panel/sayim", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/:path*", "/giris", "/api/export/:path*"],
};
