import "server-only";

import { TOOLS, type ToolDef } from "@/server/mcp/tools";
import { unlinkedProducts } from "@/server/parasut/sync";

import { assistantTools } from "./tool-defs";

/*
 * Panel asistanının araçları gerçek okuyucularla (liste ve kurallar src/server/ai/assistant/tool-defs.ts'te). Buradaki
 * her @/server içe aktarımı tests/panel-asistani.test.ts'teki izin listesinde: yalnız okuyan işlevler.
 */
export const ASSISTANT_TOOLS = assistantTools(TOOLS as unknown as readonly ToolDef[], { unlinked: (limit) => unlinkedProducts(limit) });
