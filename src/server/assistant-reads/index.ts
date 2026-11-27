import "server-only";

import { cafeLines, dayTasks, daySummary, splitTasks, type DayTask } from "@/app/panel/bugun/logic";
import { soldOutLine } from "@/app/panel/bugun/rows-ops";
import { todayShiftText, VARDIYA_PATH } from "@/lib/vardiya";
import { dueGroup } from "@/lib/user-reminders";
import { combineTillPos } from "@/lib/prices/pos";
import { productLabel } from "@/lib/waste";
import type { DayIkramRead, ReadToolDeps, TaskRead } from "@/server/ai/assistant/read-tools";
import { loadPanelNotifications } from "@/server/actions/notifications";
import { getCurrentUser } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { dailyBranchSalesFrom } from "@/server/data/daily-sales";
import { loadDayAsilposIkram } from "@/server/data/asilpos-ikram";
import { loadAsilposDayEnd, loadAsilposZTotals } from "@/server/data/asilpos-day-end";
import { loadSoldOut } from "@/server/data/menu-status";
import { posPendingSummaries } from "@/server/data/prices";
import { loadStockEstimate } from "@/server/data/stock-estimate";
import { loadToday } from "@/server/data/today";
import { safe } from "@/server/data/today-safe";
import { loadDueReminders } from "@/server/data/user-reminders";
import { getDb, schema as s } from "@/server/db";
import { loadAsilposCard } from "@/server/asilpos/status";
import { loadPosTills, loadSwitchDays } from "@/server/pos/tills";
import { loadShiftWeek, shiftsOn, todayShifts } from "@/server/vardiya/store";

/*
 * Panel asistanının AsilPOS ve operasyon okuma araçlarının gerçek okuyucuları (araçlar ve kuralları
 * src/server/ai/assistant/read-tools.ts; docs/ASISTAN.md). YALNIZ OKUR: buradaki her içe aktarım panelin mevcut okuma
 * işlevidir (tests/asistan-okuma.test.ts izin listesiyle denetler). AsilPOS'un yazıcıları (src/server/asilpos/gun-sonu.ts,
 * ingest.ts, status.ts'in handlePosDay / noteUnverified) içe aktarılmaz. Serbest metinler (ikram ve iptal gerekçesi,
 * vardiya ve hatırlatıcı notu) burada atılır: asistanın aracına hiç gelmez. Okumalar uçta seçili şubeyle
 * (withBranchScope) çalışır; şubeyi parametre alan okuyuculara şube açıkça verilir.
 */

const taskRead = (t: DayTask): TaskRead => ({ title: t.title, status: t.status, ...(t.badge ? { badge: t.badge } : {}), detail: t.detail, href: t.href });

function ikramRead(ik: Awaited<ReturnType<typeof loadDayAsilposIkram>>): DayIkramRead | null {
  if (!ik || !ik.received) return null;
  return {
    // Gerekçe (reason, detail) ve kişi türü okunmaz
    lines: ik.lines.map((l) => ({ name: l.name, kind: l.compKind ?? l.kind, qty: l.qty, menuValue: l.menuValue, iptal: Boolean(l.iptal) })),
    unprepared: ik.unprepared ? ik.unprepared.length : null,
  };
}

export const assistantReads: ReadToolDeps = {
  branches: async () => {
    const [scope, rows] = await Promise.all([currentBranchScope(), listBranches()]);
    return { scope, rows };
  },
  switchDays: () => loadSwitchDays(),
  dayEnd: async (date, branchId) => {
    const [end, ikram] = await Promise.all([loadAsilposDayEnd(date, branchId), loadDayAsilposIkram(date, getDb(), branchId)]);
    return { end, ikram: ikramRead(ikram) };
  },
  zTotals: (dates, branchId) => loadAsilposZTotals(dates, branchId),
  dailySales: async (from, to, branchId) => {
    const db = getDb();
    const [rows, products] = await Promise.all([
      dailyBranchSalesFrom(db, from, to, branchId),
      db.select({ id: s.products.id, name: s.products.name, size: s.products.size }).from(s.products),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => {
      const p = r.productId !== null ? byId.get(r.productId) : undefined;
      return { date: r.date, name: p ? productLabel(p) : r.posName, matched: Boolean(p) || r.isService, qty: r.qty, revenue: r.revenue, gross: r.gross, isService: r.isService };
    });
  },
  // Kasanın bölümü (çok şube): seçili şubenin kasası, "Tümü"de ya da kasası ModPOS olan şubede ilk açık kasa
  asilposCard: async () => {
    const [scope, { active, ids }] = await Promise.all([currentBranchScope(), loadPosTills()]);
    return loadAsilposCard(undefined, active.includes(scope) ? scope : (active[0] ?? ids[0]));
  },
  menu: async () => {
    // Seçimin kasaları (şube kapsamı A3): tek şubede onunki, "Tümü"de birden çok kasa açıkken toplam ve kasa başına
    const [soldOut, tills] = await Promise.all([loadSoldOut(), posPendingSummaries()]);
    const pos = combineTillPos(tills);
    return {
      configured: soldOut.configured,
      entries: soldOut.entries.map((e) => ({ name: e.name, category: e.category, sizes: e.sizes, state: e.state, marker: e.marker })),
      pos: { count: pos.count, oldest: pos.oldest ? pos.oldest.toISOString() : null, kasa: pos.kasa, byBranch: pos.byBranch },
    };
  },
  shiftsOn: async (date, branchId) => (await shiftsOn(getDb(), branchId, date)).map((x) => ({ name: x.name, startMin: x.startMin, endMin: x.endMin })),
  shiftWeek: async (branch, monday) => {
    const w = await loadShiftWeek(getDb(), branch, monday, { roster: false });
    // Hücrenin notu (serbest metin) atılır
    return {
      branch: w.branch,
      monday: w.monday,
      rows: w.rows.map((r) => ({ name: r.name, cells: r.cells.map((c) => (c ? { ...c, note: null } : null)) })),
      updated: w.updated,
    };
  },
  today: async () => {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") throw new Error("Bugün özeti yalnız yöneticiye");
    const [data, shifts] = await Promise.all([loadToday(user), safe(todayShifts())]);
    const tasks = dayTasks(data.facts);
    const split = splitTasks(tasks);
    const summary = daySummary(tasks, data.reminders?.length ?? 0);
    const shiftText = todayShiftText(shifts ?? []);
    const extra = [shiftText ? { key: "vardiya" as const, text: shiftText, tone: "info" as const, href: VARDIYA_PATH } : null, soldOutLine(data.facts)].filter((l) => l !== null);
    // Sıradaki karaoke satırı misafirin adını taşır: gönderilmez
    const cafe = cafeLines(data.cafe, data.facts.now.getTime(), extra).filter((l) => l.key !== "siradaki");
    return {
      headline: summary.headline,
      next: split.next ? taskRead(split.next) : null,
      now: split.now.map(taskRead),
      later: split.later.map(taskRead),
      done: split.done.map(taskRead),
      cafe: cafe.map((l) => ({ text: l.text, tone: l.tone, ...(l.href ? { href: l.href } : {}) })),
      reminders: data.reminders?.length ?? 0,
    };
  },
  pending: async () => {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") throw new Error("Bekleyen işler yalnız yöneticiye");
    const now = new Date();
    const [notifications, due] = await Promise.all([loadPanelNotifications(), loadDueReminders(user.id)]);
    return {
      notifications: notifications.map((n) => ({ kind: n.kind, title: n.title, body: n.group === "hatirlatici" ? "" : n.body, timeLabel: n.timeLabel, href: n.href, ...(n.group ? { group: n.group } : {}) })),
      // Notu (serbest metin) okunmaz
      reminders: due.filter((r) => ["overdue", "today"].includes(dueGroup(r, now))).map((r) => ({ title: r.title, dueDate: r.dueDate, dueTime: r.dueTime })),
    };
  },
  stock: () => loadStockEstimate(),
};
