import { connection } from "next/server";

import { mcpEnabled, protectedResourceMetadata } from "@/lib/mcp/oauth";
import { mcpBase } from "@/server/mcp/base";
import { metadataJson, notFound, preflight } from "@/server/mcp/http";

/*
 * RFC 9728, yola göre: /api/mcp'nin 401 yanıtındaki resource_metadata buraya gösterir. Kök yoldakiyle aynı belge.
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
