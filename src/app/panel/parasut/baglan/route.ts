import { connection, type NextRequest } from "next/server";

import { DEFAULT_PARASUT_ACCOUNT } from "@/lib/parasut/accounts";
import { getCurrentUser } from "@/server/auth/dal";
import { isParasutAccount } from "@/server/parasut/accounts";
import { startParasutConnect } from "@/server/parasut/connect";

/*
 * "Paraşüt hesabını bağla": yöneticiyi Paraşüt'ün (id.parasut.com) giriş ve onay ekranına gönderir. PKCE
 * doğrulayıcısı ve state burada üretilip saklanır; dönüş /panel/parasut/baglan/geri adresine olur.
 * `?hesap=`: bağlanacak Paraşüt hesabı (şube başına hesap; sahibi şubenin kimliği). Bekleyen istekle mühürlü saklanır,
 * dönüşte belirteç o hesaba yazılır. Verilmezse varsayılan hesap. docs/PARASUT.md
 */

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, ...NO_STORE } });

/** Hata metni panele taşınır (orada toast olarak gösterilir); uzunluk sınırlanır */
const back = (params: Record<string, string>) => redirect(`/panel/parasut?${new URLSearchParams(params)}`);

export async function GET(request: NextRequest) {
  await connection();
  const user = await getCurrentUser();
  // Yalnız yönetici; personel ya da oturumsuz istek panele/girişe döner (bu adreste bilgi verilmez)
  if (!user) return redirect("/giris?next=%2Fpanel%2Fparasut");
  if (user.role !== "admin") return redirect("/");
  const account = request.nextUrl.searchParams.get("hesap") || DEFAULT_PARASUT_ACCOUNT;
  try {
    if (!(await isParasutAccount(account))) return back({ baglanti: "hata", mesaj: "Paraşüt hesabı bulunamadı; sayfayı yenileyip yeniden deneyin." });
    return redirect(await startParasutConnect(account, user.name));
  } catch (e) {
    return back({ baglanti: "hata", mesaj: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}
