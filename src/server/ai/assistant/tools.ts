import "server-only";

import { ToolInputError } from "@/lib/mcp/answers/common";
import { planOp } from "@/server/assistant-ops/plan";
import { currentBranchScope } from "@/server/branch-scope";
import { TOOLS, type ToolDef } from "@/server/mcp/tools";
import { unlinkedProducts } from "@/server/parasut/sync";

import { allAssistantTools } from "./tool-defs";

/*
 * Panel asistanının araçları gerçek okuyucularla (liste ve kurallar src/server/ai/assistant/tool-defs.ts ve
 * op-tools.ts'te). Buradaki her @/server içe aktarımı tests/panel-asistani.test.ts'teki izin listesinde: okuyan işlevler
 * ve işlem kartının planı (planOp: önizler, plan satırı yazar; hiçbir eylem çağırmaz). Plan uçta seçili şubeyle
 * (withBranchScope) çalışır.
 */
export const ASSISTANT_TOOLS = allAssistantTools(TOOLS as unknown as readonly ToolDef[], {
  unlinked: (limit) => unlinkedProducts(limit),
  plan: async (name, input, ctx) => {
    if (!ctx.user) throw new ToolInputError("Oturum bulunamadı.");
    return planOp(ctx.user, name, input, { scope: await currentBranchScope(), now: ctx.now });
  },
});
