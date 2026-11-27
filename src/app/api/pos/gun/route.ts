import { after, connection, type NextRequest } from "next/server";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/karaoke/signature";
import { POS_DAY_MAX_BYTES } from "@/lib/asilpos/day";
import { getDb } from "@/server/db";
import { runAsilposDayEnd, settlePavoWait } from "@/server/asilpos/gun-sonu";
import { posKeysConfigured, posRequestCaller } from "@/server/asilpos/ingest";
import { handlePosDay, noteUnverified } from "@/server/asilpos/status";

const NO_STORE = { "Cache-Control": "no-store" };

/** Yanıttan sonraki gün sonu otomasyonu (rapor ve e-posta; e-postanın 3 denemesi) bu sürede biter */
export const maxDuration = 60;

/**
 * AsilPOS'un gün sonu (docs/ASILPOS.md): kafedeki kasa internetten erişilemediği için her iş gününü kapanışta (ve
 * düzeltmede yeniden) buraya iter; aynı gün aynı Z no ile öncekinin yerine geçer. İmza laffogato.net bağlantısınınki
 * gibi, anahtarı kasanın şubesinin anahtarı (çok şube: her kasanın kendi anahtarı, şube anahtardan bulunur; eski tek kasalı
 * kurulumda ASILPOS_SYNC_SECRET). Hiçbir kasanın anahtarı yoksa 503, gövde 256 KB'tan büyükse 413, imza tutmazsa 401 (ayrıntı
 * verilmez), gövde sözleşmeye uymazsa 400 `{ error: "invalid", field }`, o güne başka bir Z ile yazılmış özet varsa
 * 409 `{ error: "z_conflict", date, zNo }` (hiçbir şey yazılmaz), kasa başka şubeye ayarlıysa 409 `{ error:
 * "wrong_branch", sube, expected }`; yazılınca 200 `{ ok: true, date, lines, matched, unmatched, counted, switchDay }`
 * (`matched`: ürüne ya da hizmete bağlanan satır, `unmatched`: bağlanamayan POS adları, `counted`: gün AsilPOS'a geçiş
 * gününden önce değil). Kabul edilen her gövde sürüm geçmişine yazılır (pos_day_revisions). Denetim ve yazım src/server/asilpos/ingest.ts'te;
 * sonuç Ayarlar'daki AsilPOS kartı için durum satırına yazılır (src/server/asilpos/status.ts; anahtar yokken hiçbir şey).
 * Sayılan günde yanıttan sonra Kasa raporu ve gün sonu e-postası (src/server/asilpos/gun-sonu.ts).
 */
export async function POST(request: NextRequest) {
  // İşlevin süresi (maxDuration) isteğin başından sayılır: after()'ın son anı da buradan (Vercel 60. saniyede keser)
  const start = Date.now();
  await connection();
  // Ön süzgeç (önbellekli): hiçbir kasanın anahtarı yoksa gövde okunmaz
  if (!(await posKeysConfigured())) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > POS_DAY_MAX_BYTES) {
    await noteUnverified(getDb(), 413);
    return Response.json({ error: "too_large" }, { status: 413, headers: NO_STORE });
  }
  const body = await request.text();
  // Kasanın şubesi anahtardan (çok şube): imza hangi şubenin anahtarıyla tutuyorsa gün o şubenin. İmza önbellekteki
  // anahtarla tutarsa anahtarlar veritabanından yeniden okunur: döndürülen eski anahtar geçmez
  const caller = await posRequestCaller(request, body);
  if (!caller.secret) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  const branchId = caller.branchId;
  try {
    const r = await handlePosDay(getDb(), {
      ...caller,
      url: new URL(request.url),
      body,
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
    });
    // Sayılan AsilPOS günü (geçiş gününden itibaren, AsilPOS'un şubesi): Kasa raporu ve gün sonu e-postası yanıttan sonra
    // (docs/ASILPOS.md › Gün sonu otomasyonu). Kasa e-postayı beklemez; başarısızsa günlük iş yeniden dener
    if (r.status === 200 && r.body.counted === true && typeof r.body.date === "string" && branchId !== null) {
      // Tarih gövdeden gelir (biçimi denetlendi: YYYY-AA-GG); günlük satırlarına satır sonu taşıyamasın
      const date = r.body.date.replace(/[\r\n]/g, "");
      // Pavo'yu bekleyen gün (ilk gönderim, karşılaştırma birazdan gelecek) bu istekte biter: sonuç süre içinde gelmezse
      // e-posta Pavo'suz gider (settlePavoWait). Gece başka tetik yok; e-posta sabaha kalmaz
      after(async () => {
        const deadlineAt = start + 50_000;
        const x = await runAsilposDayEnd(getDb(), date, branchId, new Date(), { deadlineAt });
        console.info("[asilpos] gün sonu otomasyonu", x);
        if (x.email !== "waiting") return;
        try {
          console.info("[asilpos] Pavo beklemesi", await settlePavoWait(getDb(), date, branchId, { deadlineAt }));
        } catch (e) {
          console.error("[asilpos] Pavo beklemesi bitirilemedi:", e);
        }
      });
    }
    return Response.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    console.error("[asilpos] gün sonu yazılamadı:", e);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
