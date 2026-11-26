import { connection, type NextRequest } from "next/server";

import { parseAutoBackupName } from "@/lib/backup/auto";
import { sizeText } from "@/lib/backup/format";
import { contentDisposition } from "@/lib/documents";
import { logActivity } from "@/server/actions/log";
import { getCurrentUser } from "@/server/auth/dal";
import { openStoredBackupHandle } from "@/server/backup/auto";
import { backupStore } from "@/server/backup/store";

/**
 * Saklanan otomatik yedeğin indirilmesi (yalnız yönetici, docs/YEDEK.md › Otomatik haftalık yedek):
 * GET /api/yedek/kayitli?t=<bağlantı>. Bağlantıyı Ayarlar › Yedek'te parola onayından sonra
 * prepareStoredBackupDownload verir (iki dakika, yalnız o kişi; dosya adı bağlantının içinde mühürlü, istekten
 * okunmaz). Deponun adresi hiçbir yere çıkmaz: dosya buradan geçer. İndirme işlem geçmişine yazılır.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  await connection();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const name = openStoredBackupHandle(request.nextUrl.searchParams.get("t") ?? "", user.id);
  if (!name) return Response.json({ error: "İndirme bağlantısının süresi doldu. Ayarlar › Yedek'ten yeniden indirin." }, { status: 403 });
  const store = backupStore();
  let bytes: Uint8Array | null;
  try {
    bytes = store ? await store.get(name) : null;
  } catch (e) {
    console.error("[yedek] saklanan yedek okunamadı", e);
    return Response.json({ error: "Yedek depodan okunamadı; biraz sonra yeniden deneyin." }, { status: 500 });
  }
  if (!bytes) return Response.json({ error: "Yedek bulunamadı; saklama süresi dolmuş olabilir." }, { status: 404 });
  await logActivity(user, "Otomatik yedek indirildi", `${parseAutoBackupName(name)?.day ?? name} · ${sizeText(bytes.byteLength)}`);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition("attachment", name),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
