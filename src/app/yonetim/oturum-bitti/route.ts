import { NextResponse, type NextRequest } from "next/server";

import { YONETIM_GIRIS } from "@/lib/yonetim-host";
import { COOKIE_BASE, sessionMark, YONETIM_COOKIE, YONETIM_PENDING_COOKIE } from "@/server/auth/session";

/*
 * Geçersiz konsol oturumunun çıkışı (src/server/auth/dal.ts › requireYonetim): sunucu konsol çerezini reddedince buraya
 * çerezin özetiyle (`?oturum=bitti&s=…`) gönderir. Çerez yalnız özet duran çerezinkiyle aynıysa silinir (panelin
 * /giris?oturum=bitti kuralı, src/proxy.ts): başka bir siteden gelen bağlantı ya da Geri düğmesi geçerli bir oturumu
 * silemez. Sonra konsolun girişine gidilir; giriş sayfası yalnız geçerli konsol oturumunu /yonetim'e gönderdiği için
 * döngü olmaz (ör. LADMIN_ANA_ADMIN değişti, hesap pasifleşti). Sayfa çerez yazamadığı için ayrı bir yol; iki adreste de
 * (konsol ve panel) aynı çalışır.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(YONETIM_COOKIE)?.value;
  const params = request.nextUrl.searchParams;
  const sil = params.get("oturum") === "bitti" && !!token && params.get("s") === (await sessionMark(token));
  const res = NextResponse.redirect(new URL(`${YONETIM_GIRIS}?oturum=bitti`, request.url));
  res.headers.set("Cache-Control", "no-store");
  if (sil) {
    // __Host- çerezi yalnız aynı özniteliklerle (Secure, Path=/) silinir
    res.cookies.set(YONETIM_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
    res.cookies.set(YONETIM_PENDING_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
  }
  return res;
}
