import "server-only";

import { assistantEnabled } from "@/lib/assistant/protocol";
import { screenBranch } from "@/lib/assistant/page-context";
import { businessDate } from "@/lib/cash-report";
import { todayTR } from "@/lib/reminders";
import { adminLevel } from "@/lib/roles";
import { getCurrentUser } from "@/server/auth/dal";
import { chatReceiptBlock } from "@/server/assistant-ops/receipt";
import { branchScope, withBranchScope } from "@/server/branch-scope";
import { sameOrigin } from "@/server/same-origin";

import { assistantClient, assistantStatus, finishAssistantCall, startAssistantCall } from "../claude";
import type { AssistantDeps } from "./handler";
import { contextBlock } from "./prompt";
import { ASSISTANT_TOOLS } from "./tools";

/*
 * Panel asistanının gerçek bağımlılıkları (uç: src/app/api/asistan/route.ts; kurallar handler.ts'te). Araçlar AÇIK
 * EKRANIN şubesiyle okur (Claude bağlantısında istek şube seçmez, "Tümü"dür; asistan yöneticinin ekranda gördüğü şubeyi
 * görür): tarayıcı soruyla birlikte ekranın çizildiği şubeyi gönderir (`page.branch`; panelin seçicisiyle aynı, kabuğun
 * çiziminden). Çerez sekmeler arasında ortaktır: başka sekmede seçici değişse de bu sekmenin ekranı neyse asistan onu
 * okur. Şube gelmezse, tanınmıyorsa ya da kapalıysa çerezdeki seçim. Kapsam istekte bir kez çözülür, bütün araç
 * turları ve işlem kartlarının planı withBranchScope içinde çalışır. "Bugün" iş günüdür (05:00'te döner; businessDate).
 * Araçların bağlantıları göreli (/panel/...) kurulur: asistan panelin içinde.
 */

export const liveAssistantDeps: AssistantDeps = {
  enabled: () => assistantEnabled(),
  sameOrigin,
  user: async () => {
    const u = await getCurrentUser();
    // Asistan yalnız yöneticinin (handler "admin" ister); öteki roller "staff" düzeyinde reddedilir
    return u ? { id: u.id, role: adminLevel(u.role) } : null;
  },
  status: (userId) => assistantStatus(userId),
  start: (userId, opts) => startAssistantCall(userId, undefined, undefined, opts),
  finish: (callId, outcome, ms) => finishAssistantCall(callId, outcome, ms),
  receipt: (userId, photoId) => chatReceiptBlock(userId, photoId),
  setup: async (page) => {
    const cookie = await branchScope();
    const shown = screenBranch(page?.branch, cookie.branches);
    const branch = shown !== null && shown !== cookie.scope ? await branchScope(shown) : cookie;
    const now = new Date();
    return {
      client: assistantClient(),
      tools: ASSISTANT_TOOLS,
      toolCtx: { base: "", now },
      context: contextBlock({ today: businessDate(now), calendarDay: todayTR(now), branchLabel: branch.label }),
      scoped: (fn) => withBranchScope(branch.scope, fn),
    };
  },
};
