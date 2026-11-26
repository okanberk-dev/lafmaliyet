import { connection, type NextRequest } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { logActivity } from "@/server/actions/log";
import { isParasutAccount, loadParasutAccounts } from "@/server/parasut/accounts";
import { finishParasutConnect } from "@/server/parasut/connect";

/*
 * Paraşüt'ün dönüş adresi (DevHub'a bu adres kaydedilir): yetki kodu burada refresh_token'a çevrilir ve şifreli
 * saklanır. Bekleyen istek yalnız dönen state'le bulunur ve bulunduğu anda silinir (tek kullanımlık); bulunamazsa,
 * istek bayatladıysa ya da başka bir yöneticinin oturumunda başlatıldıysa kod kullanılmaz. Belirteç bağlanmanın
 * başlatıldığı hesaba (mühürlü bekleyen istekteki şube) yazılır; o şube bu arada başka şubenin hesabına bağlandıysa
 * reddedilir. Başka hesabın firmasıyla aynı vergi numarası (ya da karşılaştırılamadı) çıkarsa belirteç yazılmaz, onay
 * bekler: Paraşüt ekranı "Aynı vergi numarası mı?" diye sorar (connect.ts). docs/PARASUT.md
 */

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

const back = (params: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: `/panel/parasut?${new URLSearchParams(params)}`, ...NO_STORE } });

export async function GET(request: NextRequest) {
  await connection();
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 302, headers: { Location: "/giris?next=%2Fpanel%2Fparasut", ...NO_STORE } });
  if (user.role !== "admin") return new Response(null, { status: 302, headers: { Location: "/", ...NO_STORE } });

  const params = request.nextUrl.searchParams;
  // Paraşüt onayı reddedildiğinde kod yerine hata döner (error=access_denied)
  const error = params.get("error");
  if (error) {
    const desc = params.get("error_description")?.slice(0, 300);
    return back({ baglanti: "hata", mesaj: desc || `Paraşüt bağlantıyı reddetti (${error.slice(0, 80)}).` });
  }
  try {
    // Hesap adresten değil, state'e bağlı tek kullanımlık bekleyen istekten; istek bu yöneticinin oturumunda başlamış olmalı
    const { account, question } = await finishParasutConnect({ code: params.get("code"), state: params.get("state") }, (a) => isParasutAccount(a), { userId: user.id });
    // Aynı vergi numarası (ya da karşılaştırılamadı): belirteç onay bekliyor, Paraşüt ekranı soruyu açar
    if (question) return back({ baglanti: "onay" });
    const accounts = await loadParasutAccounts();
    const label = accounts.length > 1 ? `${accounts.find((a) => a.id === account)?.name ?? account} hesabı · ` : "";
    await logActivity(user, "Paraşüt hesabı bağlandı", `${label}Authorization Code + PKCE ile yetkilendirildi`);
    return back({ baglanti: "tamam" });
  } catch (e) {
    return back({ baglanti: "hata", mesaj: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}
