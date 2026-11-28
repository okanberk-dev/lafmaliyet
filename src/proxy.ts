import { NextResponse, type NextRequest } from "next/server";

import { canOpen, homeFor, REMOVED_PARAM, retiredRedirect } from "@/lib/roles";
import { isYonetimHost, konsolYolu, YANLIS_ADRES } from "@/lib/yonetim-host";
import { COOKIE_BASE, LEGACY_COOKIES, readCookie, SESSION_COOKIE, sessionMark, verifySession } from "@/server/auth/session";

// İyimser kontrol: imzası geçerli oturum çerezi yoksa panel sayfalarına girilmez.
// Asıl yetki kontrolü her sayfada ve her sunucu eyleminde ayrıca yapılır (src/server/auth/dal.ts).
// Personelin girebildiği ekranlar src/lib/roles.ts'te (STAFF_PATHS).

export async function proxy(request: NextRequest) {
  // Yönetim konsolunun adresi (yalnız aşağıdaki, alan adına bağlı eşleşmelerle gelir): yalnız izin listesi açılır
  if (isYonetimHost(request.headers.get("host"))) return konsol(request);
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

/**
 * Konsol adresinde (src/lib/yonetim-host.ts › konsolYolu): izin listesi geçer (sayfalar kendi oturumunu ister,
 * requireYonetim), kök, panel ve giriş konsolun karşılığına gider (geçici yönlendirme), API 404 ve `yanlis_adres`
 * (kasa yanlış adrese ayarlanırsa anlaşılır hata), gerisi 404. Panelin oturumuna burada hiç bakılmaz
 */
function konsol(request: NextRequest) {
  const karar = konsolYolu(request.nextUrl.pathname);
  if (karar.tur === "gec") return NextResponse.next();
  if (karar.tur === "yonlendir") return NextResponse.redirect(new URL(karar.hedef, request.url));
  if (karar.tur === "yanlis-adres") return NextResponse.json(YANLIS_ADRES, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse("Bulunamadı", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/*
 * İlk üç girdi panelin bugünkü kapsamı: değişmez (kasanın ve zamanlanmış işlerin uçları proxy'ye girmez). Sonraki
 * girdiler yalnız konsolun alan adında eşleşir (`has: host`; adlar src/lib/yonetim-host.ts › YONETIM_HOSTLARI, eşleştirici
 * sabit olmak zorunda, ortam okuyamaz): orada derlenmiş dosyalar dışında her yol. tests/yonetim-host.test.ts iki adresi
 * Next'in kendi eşleştiricisiyle dener.
 */
export const config = {
  matcher: [
    "/panel/:path*",
    "/giris",
    "/api/export/:path*",
    { source: "/((?!_next/static|_next/image).*)", has: [{ type: "host", value: "yonetim\\.laffogato\\.net" }] },
    { source: "/((?!_next/static|_next/image).*)", has: [{ type: "host", value: "yonetim\\.localhost" }] },
  ],
};
