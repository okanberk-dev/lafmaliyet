import "server-only";

import { and, eq, ne, notInArray } from "drizzle-orm";
import { after } from "next/server";

import { RETIRED_REQUEST_KINDS, requestPushText, type StaffRequestKind } from "@/lib/staff-requests";
import { listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";
import { sendPush, type PushResult } from "@/server/push/send";

import { requestBranches } from "./branch";
import type { StaffRequestRow } from "./core";

/*
 * Onay isteğinin telefon bildirimi (docs/ONAYLAR.md › Bildirimler): personel yeni bir istek açınca, push aboneliği olan
 * ve "Onay bildirimleri" açık yöneticilere kısa bildirim (kim, ne istedi, şube; dokununca Onaylar'daki kart). Yalnız
 * istek ilk açıldığında: aynı isteğin güncellemesi (sürüm artar) ve çift dokunuş (aynı istemci anahtarı) yeniden
 * göndermez. Metinde tutar yok (başlık tutarsızdır, personelin nedeni yazılmaz).
 */

/**
 * İsteği açan eylem işlemden (commit) sonra çağırır. Bildirim yanıttan sonra gider (`after`): personelin "Onaya
 * gönderildi"si beklemez, bildirim servisi düşse de istek etkilenmez. Hata fırlatmaz.
 */
export function pushNewRequest(out: { row: Pick<StaffRequestRow, "id">; created: boolean }): void {
  if (!out.created) return;
  const id = out.row.id;
  after(() =>
    sendRequestPush(getDb(), id).catch((e: unknown) => {
      console.error("[push] onay isteği", (e as Error).message);
    }),
  );
}

/**
 * Bildirimi gönderir. İstek yeniden okunur: gönderim anında hâlâ bekliyorsa (arada geri çekilmediyse, karara
 * bağlanmadıysa) gider. Alıcılar etkin yöneticiler (isteyen hariç; sendPush aboneliğin "Onay bildirimleri" tercihine
 * bakar). Gönderilecek yoksa null.
 */
export async function sendRequestPush(db: DB, id: number): Promise<PushResult | null> {
  const r = s.staffRequests;
  const [row] = await db
    .select({ id: r.id, kind: r.kind, subject: r.subject, payload: r.payload, title: r.title, requestedBy: r.requestedBy, requestedByName: r.requestedByName })
    .from(r)
    .where(and(eq(r.id, id), eq(r.status, "pending"), notInArray(r.kind, [...RETIRED_REQUEST_KINDS])))
    .limit(1);
  if (!row) return null;
  const admins = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.role, "admin"), eq(s.users.active, true), row.requestedBy ? ne(s.users.id, row.requestedBy) : undefined));
  if (!admins.length) return null;
  const [branchOf, branches] = await Promise.all([requestBranches(db, [row]), listBranches(db)]);
  const open = branches.filter((b) => b.active);
  const branchId = branchOf.get(row.id) ?? null;
  const branchName = open.length > 1 && branchId ? (branches.find((b) => b.id === branchId)?.name ?? null) : null;
  const text = requestPushText({ id: row.id, kind: row.kind as StaffRequestKind, title: row.title, requestedByName: row.requestedByName, branchName });
  return sendPush("approvals", { kind: "approvals", ...text }, { userIds: admins.map((a) => a.id), ttl: 24 * 3600, urgency: "normal" });
}
