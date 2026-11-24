import "server-only";

import { assistantEnabled } from "@/lib/assistant/protocol";
import { todayTR } from "@/lib/reminders";
import { getCurrentUser } from "@/server/auth/dal";
import { branchScope, withBranchScope } from "@/server/branch-scope";
import { sameOrigin } from "@/server/same-origin";

import { assistantClient, assistantStatus, finishAssistantCall, startAssistantCall } from "../claude";
import type { AssistantDeps } from "./handler";
import { contextBlock } from "./prompt";
import { ASSISTANT_TOOLS } from "./tools";

/*
 * Panel asistanının gerçek bağımlılıkları (uç: src/app/api/asistan/route.ts; kurallar handler.ts'te). Araçlar
 * panelin seçili şubesiyle okur (Claude bağlantısında istek şube seçmez, "Tümü"dür; asistan yöneticinin ekranda
 * gördüğü şubeyi görür): kapsam istekte bir kez okunur, bütün araç turları withBranchScope içinde çalışır. Araçların
 * bağlantıları göreli (/panel/...) kurulur: asistan panelin içinde.
 */

export const liveAssistantDeps: AssistantDeps = {
  enabled: () => assistantEnabled(),
  sameOrigin,
  user: async () => {
    const u = await getCurrentUser();
    return u ? { id: u.id, role: u.role } : null;
  },
  status: (userId) => assistantStatus(userId),
  start: (userId) => startAssistantCall(userId),
  finish: (callId, outcome, ms) => finishAssistantCall(callId, outcome, ms),
  setup: async () => {
    const branch = await branchScope();
    const now = new Date();
    return {
      client: assistantClient(),
      tools: ASSISTANT_TOOLS,
      toolCtx: { base: "", now },
      context: contextBlock({ today: todayTR(now), branchLabel: branch.label }),
      scoped: (fn) => withBranchScope(branch.scope, fn),
    };
  },
};
