import { connection } from "next/server";

import { handleAssistantGet, handleAssistantPost } from "@/server/ai/assistant/handler";
import { liveAssistantDeps } from "@/server/ai/assistant/service";

/**
 * Panel asistanı (docs/ASISTAN.md): yalnız yönetici. GET asistanın durumunu (açık mı, bugün kalan soru) verir; POST
 * soruyu alır ve yanıtı satır satır JSON olarak akıtır (src/lib/assistant/protocol.ts). Kurallar ve sıra
 * src/server/ai/assistant/handler.ts'te: aynı köken, oturum, rol, gövde şeması, günlük sınır, ai_calls kaydı.
 * Döngünün kesin süresi 50 sn, derin analizde 55 sn (src/server/ai/assistant/loop.ts ASSISTANT_TIMING, ASSISTANT_DEEP);
 * kayıt için pay kalır. Bu sayı düşürülürse ikisi de düşürülmeli.
 */
export const maxDuration = 60;

export async function GET() {
  await connection();
  return handleAssistantGet(liveAssistantDeps);
}

export async function POST(request: Request) {
  await connection();
  return handleAssistantPost(request, liveAssistantDeps);
}
