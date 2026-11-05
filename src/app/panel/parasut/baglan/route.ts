import { connection } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { startParasutConnect } from "@/server/parasut/connect";

/*
 * "Paraşüt hesabını bağla": yöneticiyi Paraşüt'ün (id.parasut.com) giriş ve onay ekranına gönderir. PKCE
 * doğrulayıcısı ve state burada üretilip saklanır; dönüş /panel/parasut/baglan/geri adresine olur.
 * docs/PARASUT.md
 */

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, ...NO_STORE } });

/** Hata metni panele taşınır (orada toast olarak gösterilir); uzunluk sınırlanır */
const back = (params: Record<string, string>) => redirect(`/panel/parasut?${new URLSearchParams(params)}`);

export async function GET() {
  await connection();
  const user = await getCurrentUser();
  // Yalnız yönetici; personel ya da oturumsuz istek panele/girişe döner (bu adreste bilgi verilmez)
  if (!user) return redirect("/giris?next=%2Fpanel%2Fparasut");
  if (user.role !== "admin") return redirect("/");
  try {
    return redirect(await startParasutConnect(user.name));
  } catch (e) {
    return back({ baglanti: "hata", mesaj: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}
