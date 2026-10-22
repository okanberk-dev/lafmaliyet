import { connection, type NextRequest } from "next/server";

import { backupSummaryText, nextDataBytes } from "@/lib/backup/format";
import { contentDisposition } from "@/lib/documents";
import { logActivity } from "@/server/actions/log";
import { getCurrentUser } from "@/server/auth/dal";
import { appVersion, backupLines, backupStream, type BackupSummary } from "@/server/backup/core";
import { openBackupHandle, readLastBackup, saveLastBackup } from "@/server/backup/state";
import { getDb } from "@/server/db";

/**
 * Tam yedek (yalnız yönetici, docs/YEDEK.md): GET /api/yedek?t=<bağlantı>. Bağlantıyı Ayarlar › Yedek'te parola
 * onayından sonra prepareBackupDownload verir (iki dakika, yalnız o kişi). Dosya akarak üretilir: satırlar
 * veritabanından okunurken gzip'lenip gönderilir, bellekte bütün dosya tutulmaz. Son yedek kaydı (zil hatırlatması,
 * kart) ve işlem geçmişi satırı yalnız dosyanın tamamı gönderilince yazılır; yarıda kesilen indirme kayda geçmez.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  await connection();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const handle = openBackupHandle(request.nextUrl.searchParams.get("t") ?? "", user.id);
  if (!handle) return Response.json({ error: "İndirme bağlantısının süresi doldu. Ayarlar › Yedek'ten yeniden indirin." }, { status: 403 });

  const now = new Date();
  const lines = backupLines(getDb().$client, { documents: handle.documents, createdBy: user.name, app: appVersion(), now });
  // İlk satır (başlık) yanıttan önce: veritabanına ulaşılamıyorsa yarım dosya yerine anlaşılır bir hata
  let first: IteratorResult<string, BackupSummary>;
  try {
    first = await lines.next();
  } catch (e) {
    console.error("[yedek] başlatılamadı", e);
    return Response.json({ error: "Yedek hazırlanamadı; biraz sonra yeniden deneyin." }, { status: 500 });
  }

  let summary: BackupSummary | null = null;
  // İndirme iptal edilirse işlem kapanır, bağlantı havuza döner; iptal hata olarak yazılmaz (backupStream)
  const source = backupStream(lines, first, (s) => {
    summary = s;
  });

  let bytes = 0;
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    async flush() {
      if (!summary) return;
      const s: BackupSummary = summary;
      const tables = Object.keys(s.tables).length;
      try {
        // Verinin kendi payı belgeli indirmenin tahmininde kullanılır; belgeli dosyada ayrılamaz, öncekinden taşınır
        const prev = s.documents ? await readLastBackup() : null;
        const dataBytes = nextDataBytes(s.documents, bytes, prev);
        await saveLastBackup({ at: now.toISOString(), by: user.name, bytes, rows: s.rows, tables, documents: s.documents, docCount: s.docCount, dataBytes });
      } catch (e) {
        console.error("[yedek] son yedek kaydı yazılamadı", e);
      }
      await logActivity(user, "Yedek indirildi", backupSummaryText({ tables, rows: s.rows, bytes, documents: s.documents, docCount: s.docCount }));
    },
  });

  const body = source.pipeThrough(new TextEncoderStream()).pipeThrough(new CompressionStream("gzip")).pipeThrough(counted);
  return new Response(body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": contentDisposition("attachment", handle.fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
