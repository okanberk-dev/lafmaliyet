import { connection, type NextRequest } from "next/server";

import { DEFAULT_PARASUT_ACCOUNT } from "@/lib/parasut/accounts";
import { getCurrentUser } from "@/server/auth/dal";
import { isParasutAccount } from "@/server/parasut/accounts";
import { startParasutConnect } from "@/server/parasut/connect";
import { sameOrigin } from "@/server/same-origin";

/*
 * "Paraşüt hesabını bağla": yöneticiyi Paraşüt'ün (id.parasut.com) giriş ve onay ekranına gönderir. Yalnız Paraşüt
 * ekranındaki düğmeyle başlar: aynı kökenden POST (form). Adres çubuğundan, bir bağlantıdan ya da başka bir siteden
 * gelen istek bağlanmayı başlatmaz (GET yalnız ekrana döner; köken tutmayan POST 403). PKCE doğrulayıcısı, state, hesap
 * ve başlatan yönetici burada üretilip state'e bağlı tek kullanımlık kayıtta saklanır (connect.ts); dönüş
 * /panel/parasut/baglan/geri adresine olur ve hesabı yalnız o kayıttan alır. Formdaki `hesap` sunucuda doğrulanır
 * (açık şubelerin kullandığı hesaplardan biri); verilmezse varsayılan hesap. docs/PARASUT.md
 */

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** 303: form gönderiminin ardından tarayıcı hedefe GET ile gider */
const redirect = (to: string) => new Response(null, { status: 303, headers: { Location: to, ...NO_STORE } });

/** Hata metni panele taşınır (orada toast olarak gösterilir); uzunluk sınırlanır */
const back = (params: Record<string, string>) => redirect(`/panel/parasut?${new URLSearchParams(params)}`);

/** Eski bağlantı ya da adres çubuğu: hiçbir şey başlatmadan Paraşüt ekranına */
export async function GET() {
  return redirect("/panel/parasut");
}

export async function POST(request: NextRequest) {
  await connection();
  // Başka bir siteden (alt alan adları dahil) gönderilen form bağlanmayı başlatamaz
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403, headers: NO_STORE });
  const user = await getCurrentUser();
  // Yalnız yönetici; personel ya da oturumsuz istek panele/girişe döner (bu adreste bilgi verilmez)
  if (!user) return redirect("/giris?next=%2Fpanel%2Fparasut");
  if (user.role !== "admin") return redirect("/");
  let raw: FormDataEntryValue | null = null;
  try {
    raw = (await request.formData()).get("hesap");
  } catch {
    raw = null;
  }
  const account = (typeof raw === "string" && raw.trim()) || DEFAULT_PARASUT_ACCOUNT;
  try {
    if (!(await isParasutAccount(account))) return back({ baglanti: "hata", mesaj: "Paraşüt hesabı bulunamadı; sayfayı yenileyip yeniden deneyin." });
    return redirect(await startParasutConnect(account, user.name, user.id));
  } catch (e) {
    return back({ baglanti: "hata", mesaj: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}
