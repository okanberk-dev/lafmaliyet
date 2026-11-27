import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { ALL_BRANCHES } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { dateTR } from "@/lib/format";
import { rejectionBells } from "@/lib/asilpos/status";
import { LEGACY_POS_BRANCH_ID } from "@/lib/pos/tills";
import { addDays, todayTR } from "@/lib/reminders";
import type { PanelNotification } from "@/server/actions/notifications";
import { getDb, schema as s, type DB } from "@/server/db";
import { readAsilposState } from "@/server/asilpos/status";
import { currentBranchScope } from "@/server/branch-scope";
import { loadPosTills } from "@/server/pos/tills";

/*
 * AsilPOS'un reddedilen gün sonunun zil satırı (yalnız yönetici; docs/ASILPOS.md › Durum ve onarım). Ret `POST /api/pos/gun`
 * sonucunda integration_state'in durum satırına güne göre yazılır (src/server/asilpos/status.ts noteDayRejection); bu modül onu
 * okur, ayrı kayıt tutmaz. Kurallar saf modülde (src/lib/asilpos/status.ts rejectionBells). Önceden ret yalnız Ayarlar ›
 * AsilPOS kartında görünüyordu, e-posta da gitmiyordu: yönetici günün gelmediğini fark etmeyebilirdi.
 */

/** Ayarlar › AsilPOS (kasa) kartı, AsilPOS'un şubesi seçili (`?sube=`; başka şube seçiliyken kart "kullanılmıyor" der) */
export const asilposSettingsHref = (branchId: string) => `/panel/ayarlar?sube=${encodeURIComponent(branchId)}#asilpos`;

/**
 * Zilin Sistem başlığında "Marina gün sonu alınamadı: <neden>" (toplayıcı src/server/actions/notifications.ts yönetici
 * dalında çağırır), Ayarlar › AsilPOS'a götürür. Çok şube: her açık AsilPOS kasası kendi satırlarıyla, başlıkta şubenin
 * adı; şube seçiliyken yalnız o şubenin kasası (`scope`; verilmezse seçicinin seçimi). Birden çok kasada Marina dışındaki
 * satırların kimliği şubeyi taşır (aynı günün iki reddi ayrı satır). Açık ret yoksa kasa başına tek sorgu (durum satırı)
 */
export async function asilposRejectionBell(db: DB = getDb(), now = new Date(), scope?: string): Promise<PanelNotification[]> {
  const [{ active, switchDays }, sel] = await Promise.all([loadPosTills(db), scope !== undefined ? Promise.resolve(scope) : currentBranchScope()]);
  const tills = active.filter((id) => sel === ALL_BRANCHES || id === sel);
  const out = await Promise.all(tills.map((id) => tillRejectionBell(db, id, switchDays[id] ?? null, now, active.length > 1)));
  return out.flat();
}

async function tillRejectionBell(db: DB, branchId: string, switchDay: string | null, now: Date, many: boolean): Promise<PanelNotification[]> {
  const state = await readAsilposState(db, branchId);
  const dates = Object.keys(state.rejections);
  if (!dates.length) return [];
  const [days, [branch]] = await Promise.all([
    db
      .select({ date: s.posDayReports.date, receivedAt: s.posDayReports.receivedAt })
      .from(s.posDayReports)
      .where(and(inArray(s.posDayReports.date, dates), eq(s.posDayReports.branchId, branchId))),
    db.select({ name: s.branches.name }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1),
  ]);
  const rows = rejectionBells({
    rejections: state.rejections,
    switchDay,
    received: Object.fromEntries(days.map((d) => [d.date, d.receivedAt.toISOString()])),
    branchName: branch?.name ?? branchId,
    today: businessDate(now),
    now,
  });
  const today = todayTR(now);
  return rows.map((r) => {
    const day = todayTR(new Date(r.at));
    return {
      // Eski kurulumun şubesinin kimliği değişmez (okundu işaretleri kalsın)
      id: many && branchId !== LEGACY_POS_BRANCH_ID ? `${r.id}-${branchId}` : r.id,
      kind: "danger",
      title: r.title,
      body: r.body,
      timeLabel: day === today ? "Bugün" : day === addDays(today, -1) ? "Dün" : dateTR(day),
      unread: true,
      href: asilposSettingsHref(branchId),
      group: "sistem",
    };
  });
}
