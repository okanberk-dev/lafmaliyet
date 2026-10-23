import { connection } from "next/server";

import { authServerMetadata, mcpEnabled } from "@/lib/mcp/oauth";
import { mcpBase } from "@/server/mcp/base";
import { metadataJson, notFound, preflight } from "@/server/mcp/http";

/*
 * RFC 8414: panelin yetkilendirme sunucusu belgesi. CIMD ve "none" birlikte olduğu için Claude yayımlanmış kimliğini
 * kullanır, olmazsa kendini kaydeder (DCR). Herkese açık; önizlemede ve MCP_DISABLED=1'de 404.
 */

export async function GET(request: Request) {
  await connection();
  if (!mcpEnabled(process.env)) return notFound();
  return metadataJson(authServerMetadata(mcpBase(request)));
}

export async function OPTIONS() {
  if (!mcpEnabled(process.env)) return notFound();
  return preflight();
}
