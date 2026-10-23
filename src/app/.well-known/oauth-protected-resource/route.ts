import { connection } from "next/server";

import { mcpEnabled, protectedResourceMetadata } from "@/lib/mcp/oauth";
import { mcpBase } from "@/server/mcp/base";
import { metadataJson, notFound, preflight } from "@/server/mcp/http";

/*
 * RFC 9728: Claude'un panele bağlanırken okuduğu korunan kaynak belgesi (kök yolda; yola göre olanı
 * ./api/mcp/route.ts). Herkese açık; önizlemede ve MCP_DISABLED=1'de 404 (docs/CLAUDE-BAGLANTISI.md).
 */

export async function GET(request: Request) {
  await connection();
  if (!mcpEnabled(process.env)) return notFound();
  return metadataJson(protectedResourceMetadata(mcpBase(request)));
}

export async function OPTIONS() {
  if (!mcpEnabled(process.env)) return notFound();
  return preflight();
}
