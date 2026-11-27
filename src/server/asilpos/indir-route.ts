import "server-only";

import { connection, type NextRequest } from "next/server";

import { fetchKurucu, KOD_RE, kurucuAdresleri, kurucuDosyaAdi, kurucuWithCode } from "@/lib/asilpos/kurulum";
import { appUrl } from "@/server/auth/tokens";
import { installForDownload } from "@/server/asilpos/kurulum";

const NO_STORE = { "Cache-Control": "no-store, private" };

function page(title: string, text: string, status: number) {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 16px;color:#1c1f24"><h1 style="font-size:22px">${title}</h1><p style="line-height:1.6">${text}</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}

/**
 * Şubeye özel AsilPOS kurucusu (docs/ASILPOS.md › Şube kurulumu): bağlantıdaki kod geçerliyse kanaldaki genel kurucu
 * (AsilPOS-Kur.cmd; kanal henüz yayımlamıyorsa eski adlısı) indirilir, içine panelin adresi ve kod yazılır, şubenin
 * adıyla iner. Kod bu adımda harcanmaz: kurulum yarıda kalırsa yeniden indirilebilir; kasa kurulup kodu verince bağlantı
 * kapanır. İki yol bunu dışa verir: /asilpos/indir/<kod> (yeni bağlantılar) ve gönderilmiş e-postalardaki eski yol
 * (ESKI_INDIR_YOLU)
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ kod: string }> }) {
  await connection();
  const kod = decodeURIComponent((await ctx.params).kod);
  if (!KOD_RE.test(kod)) return page("Bağlantı geçersiz", "Kurulum bağlantısı eksik ya da bozuk. E-postadaki bağlantıyı yeniden açın.", 404);
  const row = await installForDownload(kod);
  if (!row) return page("Bağlantı artık geçerli değil", "Bu kurulum bağlantısı kullanılmış, yenisiyle değiştirilmiş ya da süresi dolmuş. Panelde Hesabım sayfasındaki güncel bağlantıyı kullanın ya da yöneticiden yenisini isteyin.", 410);
  let cmd: string;
  try {
    cmd = kurucuWithCode(await fetchKurucu(kurucuAdresleri()), appUrl(), kod);
  } catch (e) {
    console.error("[asilpos kurulum] kurucu alınamadı", e);
    return page("Kurucu şu an alınamadı", "AsilPOS kurucusu indirilemedi. Birkaç dakika sonra bağlantıyı yeniden açın.", 503);
  }
  return new Response(cmd, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${kurucuDosyaAdi(row.branchId)}"`, ...NO_STORE },
  });
}
