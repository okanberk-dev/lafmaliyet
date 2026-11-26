import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { POS_DAY_MAX_BYTES } from "@/lib/lafpos/day";
import { getDb } from "@/server/db";
import { runLafposDayEnd, settlePavoWait } from "@/server/lafpos/gun-sonu";
import { lafposRequestSecret, lafposSecret } from "@/server/lafpos/ingest";
import { handlePosDay, noteUnverified } from "@/server/lafpos/status";

const NO_STORE = { "Cache-Control": "no-store" };

/** Yanıttan sonraki gün sonu otomasyonu (rapor ve e-posta; e-postanın 3 denemesi) bu sürede biter */
export const maxDuration = 60;

/**
 * LafPOS'un gün sonu (docs/LAFPOS.md): kafedeki kasa internetten erişilemediği için her iş gününü kapanışta (ve
 * düzeltmede yeniden) buraya iter; aynı gün aynı Z no ile öncekinin yerine geçer. İmza laffogato.net bağlantısınınki
 * gibi, anahtarı LAFPOS_SYNC_SECRET. Anahtar yoksa 503, gövde 256 KB'tan büyükse 413, imza tutmazsa 401 (ayrıntı
 * verilmez), gövde sözleşmeye uymazsa 400 `{ error: "invalid", field }`, o güne başka bir Z ile yazılmış özet varsa
 * 409 `{ error: "z_conflict", date, zNo }` (hiçbir şey yazılmaz), kasa başka şubeye ayarlıysa 409 `{ error:
 * "wrong_branch", sube, expected }`; yazılınca 200 `{ ok: true, date, lines, matched, unmatched, counted, switchDay }`
 * (`matched`: ürüne ya da hizmete bağlanan satır, `unmatched`: bağlanamayan POS adları, `counted`: gün LafPOS'a geçiş
 * gününden önce değil). Kabul edilen her gövde sürüm geçmişine yazılır (pos_day_revisions). Denetim ve yazım src/server/lafpos/ingest.ts'te;
 * sonuç Ayarlar'daki LafPOS kartı için durum satırına yazılır (src/server/lafpos/status.ts; anahtar yokken hiçbir şey).
 * Sayılan günde yanıttan sonra Kasa raporu ve gün sonu e-postası (src/server/lafpos/gun-sonu.ts).
 */
export async function POST(request: NextRequest) {
  // İşlevin süresi (maxDuration) isteğin başından sayılır: after()'ın son anı da buradan (Vercel 60. saniyede keser)
  const start = Date.now();
  await connection();
  // Ön süzgeç (önbellekli): anahtar yoksa gövde okunmaz
  if (!(await lafposSecret())) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > POS_DAY_MAX_BYTES) {
    await noteUnverified(getDb(), 413);
    return Response.json({ error: "too_large" }, { status: 413, headers: NO_STORE });
  }
  const body = await request.text();
  // İmza önbellekteki anahtarla tutarsa anahtar veritabanından yeniden okunur: döndürülen eski anahtar geçmez
  const secret = await lafposRequestSecret(request, body);
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  try {
    const r = await handlePosDay(getDb(), {
      secret,
      url: new URL(request.url),
      body,
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    // Sayılan LafPOS günü (geçiş gününden itibaren, LafPOS'un şubesi): Kasa raporu ve gün sonu e-postası yanıttan sonra
    // (docs/LAFPOS.md › Gün sonu otomasyonu). Kasa e-postayı beklemez; başarısızsa günlük iş yeniden dener
    if (r.status === 200 && r.body.counted === true && typeof r.body.date === "string") {
      // Tarih gövdeden gelir (biçimi denetlendi: YYYY-AA-GG); günlük satırlarına satır sonu taşıyamasın
      const date = r.body.date.replace(/[\r\n]/g, "");
      // Pavo'yu bekleyen gün (ilk gönderim, karşılaştırma birazdan gelecek) bu istekte biter: sonuç süre içinde gelmezse
      // e-posta Pavo'suz gider (settlePavoWait). Gece başka tetik yok; e-posta sabaha kalmaz
      after(async () => {
        const deadlineAt = start + 50_000;
        const x = await runLafposDayEnd(getDb(), date, new Date(), { deadlineAt });
        console.info("[lafpos] gün sonu otomasyonu", x);
        if (x.email !== "waiting") return;
        try {
          console.info("[lafpos] Pavo beklemesi", await settlePavoWait(getDb(), date, { deadlineAt }));
        } catch (e) {
          console.error("[lafpos] Pavo beklemesi bitirilemedi:", e);
        }
      });
    }
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[lafpos] gün sonu yazılamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
