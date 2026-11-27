import { NextResponse, type NextRequest } from "next/server";

import { canOpen, homeFor, REMOVED_PARAM, retiredRedirect } from "@/lib/roles";
import { COOKIE_BASE, LEGACY_COOKIES, readCookie, SESSION_COOKIE, sessionMark, verifySession } from "@/server/auth/session";

// İyimser kontrol: imzası geçerli oturum çerezi yoksa panel sayfalarına girilmez.
// Asıl yetki kontrolü her sayfada ve her sunucu eyleminde ayrıca yapılır (src/server/auth/dal.ts).
// Personelin girebildiği ekranlar src/lib/roles.ts'te (STAFF_PATHS).

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Kaldırılan ekranların eski adresleri (Hızlı sayım, Mal siparişi → Stok sayımı; Vergi → Genel bakış, notuyla): 404
  // yerine yaşayan ekrana, eski sorgusuz (oturum yoksa oradan girişe)
  const retired = retiredRedirect(pathname);
  if (retired) return NextResponse.redirect(new URL(retired, request.url));
  const token = readCookie(request.cookies, SESSION_COOKIE, LEGACY_COOKIES.session.name);
  const session = await verifySession(token);

  if (pathname.startsWith("/giris")) {
    // Sunucu oturumu geçersiz buldu (parola değişti, hesap pasif, oturumlar kapatıldı, çıkış yapıldı): çerez yalnız
    // adresteki özet (s) duran çerezinkiyle aynıysa silinir (src/server/auth/session.ts › sessionMark). Yeniden girişten
    // sonra Geri düğmesi ya da önbellekteki eski yönlendirme yeni oturumu, başka bir siteden gelen bağlantı geçerli
    // oturumu silemez; o zaman düz /giris gibi ana sayfaya gidilir (denetim KA-02, YO-04). RSC isteğini ayırmaya gerek
    // yok (Next onu proxy'ye zaten göstermez): özet tutuyorsa silinen, sunucunun reddettiği çerezin ta kendisi.
    const params = request.nextUrl.searchParams;
    if (params.get("oturum") === "bitti" && token && params.get("s") === (await sessionMark(token))) {
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
    const home = new URL(homeFor(session.role), request.url);
    // Kaldırılan ekranın notu (?kaldirildi=vergi) rolün ana ekranına taşınır: muhasebeci Genel bakış'ı açamaz, not
    // Muhasebe'de çıkar
    const removed = request.nextUrl.searchParams.get(REMOVED_PARAM);
    if (removed) home.searchParams.set(REMOVED_PARAM, removed);
    return NextResponse.redirect(home);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/:path*", "/giris", "/api/export/:path*"],
};
