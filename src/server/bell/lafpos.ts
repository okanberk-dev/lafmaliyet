import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { dateTR } from "@/lib/format";
import { rejectionBells } from "@/lib/lafpos/status";
import { addDays, todayTR } from "@/lib/reminders";
import type { PanelNotification } from "@/server/actions/notifications";
import { getDb, schema as s, type DB } from "@/server/db";
import { lafposBranchId } from "@/server/lafpos/branch";
import { loadLafposSwitchDay, readLafposState } from "@/server/lafpos/status";

/*
 * LafPOS'un reddedilen gün sonunun zil satırı (yalnız yönetici; docs/LAFPOS.md › Durum ve onarım). Ret `POST /api/pos/gun`
 * sonucunda integration_state › lafpos'a güne göre yazılır (src/server/lafpos/status.ts noteDayRejection); bu modül onu
 * okur, ayrı kayıt tutmaz. Kurallar saf modülde (src/lib/lafpos/status.ts rejectionBells). Önceden ret yalnız Ayarlar ›
 * LafPOS kartında görünüyordu, e-posta da gitmiyordu: yönetici günün gelmediğini fark etmeyebilirdi.
 */

/** Ayarlar › LafPOS (kasa) kartı, LafPOS'un şubesi seçili (`?sube=`; başka şube seçiliyken kart "kullanılmıyor" der) */
export const lafposSettingsHref = (branchId: string) => `/panel/ayarlar?sube=${encodeURIComponent(branchId)}#lafpos`;

/**
 * Zilin Sistem başlığında "Marina gün sonu alınamadı: <neden>" (toplayıcı src/server/actions/notifications.ts yönetici
 * dalında çağırır), Ayarlar › LafPOS'a götürür. Açık ret yoksa tek sorgu (durum satırı)
 */
export async function lafposRejectionBell(db: DB = getDb(), now = new Date()): Promise<PanelNotification[]> {
  const state = await readLafposState(db);
  const dates = Object.keys(state.rejections);
  if (!dates.length) return [];
  const [switchDay, branchId] = await Promise.all([loadLafposSwitchDay(db), lafposBranchId(db)]);
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
    branchName: branch?.name ?? "Marina",
    today: businessDate(now),
    now,
  });
  const today = todayTR(now);
  return rows.map((r) => {
    const day = todayTR(new Date(r.at));
    return {
      id: r.id,
      kind: "danger",
      title: r.title,
      body: r.body,
      timeLabel: day === today ? "Bugün" : day === addDays(today, -1) ? "Dün" : dateTR(day),
      unread: true,
      href: lafposSettingsHref(branchId),
      group: "sistem",
    };
  });
}
