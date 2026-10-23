import "server-only";

import { dateTimeTR, dateTR } from "@/lib/format";
import { callSummary, connectionLabel, whenLabel, type CallView, type ConnectionView } from "@/lib/mcp/oauth";
import { todayTR } from "@/lib/reminders";
import { appUrl } from "@/server/auth/tokens";
import { getDb } from "@/server/db";

import { listConnections, recentCalls } from "./store";

const flat = (s: string) => s.replace(/\u00a0/g, " ");

/**
 * Yöneticinin bağlantıları ve son soruları (Hesabım › Bağlı uygulamalar; yalnız yönetici için çağrılır). İstemciye
 * istemci kimliği ya da anahtar gitmez; tarihler İstanbul saatiyle metin olarak hazırlanır.
 */
export async function loadMyConnections(userId: number): Promise<{ rows: ConnectionView[]; calls: CallView[]; mcpUrl: string }> {
  const db = getDb();
  const now = new Date();
  const [rows, calls] = await Promise.all([listConnections(db, userId, now), recentCalls(db, userId, 20)]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      label: connectionLabel(r, r.host),
      host: r.host,
      connected: flat(dateTimeTR(r.createdAt)),
      lastUsed: r.lastUsedAt ? flat(dateTimeTR(r.lastUsedAt)) : null,
      expires: dateTR(todayTR(r.expiresAt)),
    })),
    calls: calls.map((c) => ({ when: whenLabel(c.at, now), summary: callSummary(c.tool, c.args), ok: c.ok })),
    mcpUrl: `${appUrl()}/api/mcp`,
  };
}
