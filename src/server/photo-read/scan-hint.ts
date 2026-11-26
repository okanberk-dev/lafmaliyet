import "server-only";

import { and, count, eq, gte } from "drizzle-orm";

import { sniffMime } from "@/lib/documents";
import { normalizeHint, SCAN_HINT_SYSTEM, ScanHintRaw, scanHintTask, type ScanHint } from "@/lib/photo-read/scan-hint";
import { imageSize, UPLOADS_PER_HOUR } from "@/lib/photo-rules";
import { HINT_IMAGE, HINT_MAX_BYTES } from "@/lib/photo-scan";
import { extractImage, loadAiSettings } from "@/server/ai/claude";
import type { AiClient, AiTimeouts } from "@/server/ai/run";
import { getDb, schema as s } from "@/server/db";

/*
 * Belge taramada yapay zekânın köşe ipucu (POST /api/foto/kenar): telefondaki kod kâğıdın kenarından emin değilken ve
 * okuma açıkken sorulur. Ucuz model (Ayarlar › Fotoğraftan okuma › photoModels.cheap; varsayılan Claude Haiku 5.5),
 * efor "low", en çok 1024 px JPEG (~1.000 girdi tokenı, kısa yanıt). Kapılar okumayla aynı (anahtar, Ayarlar anahtarı),
 * günlük sınır ayrı (SCAN_HINT_DAILY_CAP; "tarama" okuma sınırına sayılmaz); kişi başına saatte en çok 30. Görüntü
 * saklanmaz; ai_calls'a maliyet satırı ve doğrulanmış ipucu düşer. Hiçbir hata ekrana çıkmaz: tarama kodun sonucuyla
 * sürer (docs/FOTOGRAF.md › Belge tarama).
 */

/** Kısa yanıt: tek deneme 15 sn, hızlı dönen hata bir kez yeniden denenir; en çok 20 sn (yol 30 sn'de kesilir) */
export const SCAN_HINT_TIMEOUTS: AiTimeouts = { timeout: 15_000, maxRetries: 1, totalMs: 20_000 };
/** Yanıt yalnız üç alan; düşünme payıyla */
const SCAN_HINT_MAX_TOKENS = 2000;

export type ScanHintOutcome = { ok: true; hint: ScanHint } | { ok: false; status: number; error: string };

/** Gönderilen kopya: JPEG, en uzun kenarı ~1024 px'i aşmayan (yuvarlama payıyla), en çok 600 KB */
export function hintImageProblem(bytes: Uint8Array): string | null {
  if (!bytes.length || bytes.length > HINT_MAX_BYTES) return "Görüntü çok büyük.";
  if (sniffMime(bytes) !== "image/jpeg") return "Yalnız JPEG.";
  const size = imageSize(bytes);
  if (!size || Math.max(size.width, size.height) > HINT_IMAGE.maxEdge + 8 || Math.min(size.width, size.height) < 16) return "Görüntünün ölçüsü uygun değil.";
  return null;
}

/** Kişinin son bir saatteki köşe soruları */
async function recentHints(userId: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(s.aiCalls)
    .where(and(eq(s.aiCalls.feature, "tarama"), eq(s.aiCalls.userId, userId), gte(s.aiCalls.at, new Date(Date.now() - 3600_000))));
  return row?.n ?? 0;
}

/** Köşe ipucu; `client` yalnız testte (sahte istemci) */
export async function scanHintFor(input: { bytes: Uint8Array; userId: number; client?: AiClient }): Promise<ScanHintOutcome> {
  const problem = hintImageProblem(input.bytes);
  if (problem) return { ok: false, status: 400, error: problem };
  if ((await recentHints(input.userId)) >= UPLOADS_PER_HOUR) return { ok: false, status: 429, error: "Kısa sürede çok soruldu." };
  const size = imageSize(input.bytes)!;
  const settings = await loadAiSettings();
  const res = await extractImage({
    feature: "tarama",
    userId: input.userId,
    photoId: null,
    system: SCAN_HINT_SYSTEM,
    task: scanHintTask(size.width, size.height),
    schema: ScanHintRaw,
    image: { bytes: input.bytes, mediaType: "image/jpeg" },
    model: settings.photoModels.cheap,
    effort: "low",
    maxTokens: SCAN_HINT_MAX_TOKENS,
    timeouts: SCAN_HINT_TIMEOUTS,
    client: input.client,
  });
  if (!res.ok) return { ok: false, status: res.code === "cap" || res.code === "off" || res.code === "nokey" ? 503 : 502, error: res.code };
  return { ok: true, hint: normalizeHint(res.data, size) };
}
