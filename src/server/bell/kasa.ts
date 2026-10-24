import "server-only";

import { businessDate, carryChecks, carryDiffText, changesText, diffKind, diffText, isCashEvening, lateCorrections, staffCanReport } from "@/lib/cash-report";
import { staffResultBell } from "@/lib/cash-requests";
import { dateTR, money } from "@/lib/format";
import { addDays, longDateTR, todayTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { cashReportsBetween, cashRevisionsFor, previousCarryOver } from "@/server/data/cash-reports";
import { myCashRequests, pendingCashBellRows, proposedByForReports } from "@/server/data/cash-requests";

/*
 * Zilin kasa satırları (src/server/actions/notifications.ts toplar; docs/BILDIRIMLER.md). Kasa grubunun modülü: gün
 * sonu raporu, kasanın bütünlüğü ve (yönetici) kasa isteklerinin onay satırları, (personel) kasa isteklerinin sonucu
 * burada üretilir (plan docs/planlar/personel-yetki.md §2.3, §2.6, §2.7, §2.9). İki rol dalında da çağrılır; personele
 * maliyet ya da başkasının tutarı gitmez.
 */

/**
 * Gün sonu kasa raporu: personele akşam (20:00'den sonra) bugünün raporu girilmediyse hatırlatma; yöneticiye dünün
 * raporu girilmediyse, son raporda kasa farkı varsa (eksik kırmızı, fazla turuncu), açılış devirle tutmuyorsa ve rapor
 * ertesi gün kasa alanı değiştirilerek düzeltildiyse.
 */
async function cashNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const day = businessDate(now);
  const reports = await cashReportsBetween(addDays(day, -6), day);
  if (user.role !== "admin") {
    if (!isCashEvening(now) || reports.some((r) => r.date === day)) return [];
    return [
      {
        id: `kasa-bekliyor-${day}`,
        kind: "warning",
        title: "Bugünün kasa raporu bekliyor",
        body: "Kapanışta ModPOS'un Z raporunu ve kasayı girin",
        timeLabel: "Bugün",
        unread: true,
        href: "/panel/kasa",
        group: "kasa",
      },
    ];
  }
  const out: PanelNotification[] = [];
  const yesterday = addDays(day, -1);
  if (!reports.some((r) => r.date === yesterday)) {
    out.push({
      id: `kasa-yok-${yesterday}`,
      kind: "warning",
      title: "Dünkü kasa raporu girilmedi",
      body: longDateTR(yesterday),
      timeLabel: "Dün",
      unread: true,
      href: `/panel/kasa?gun=${yesterday}`,
      group: "kasa",
    });
  }
  const last = reports[0];
  if (last && diffKind(last.cashDiff) !== "even") {
    out.push({
      // Rapor güncellenince yeniden okunmamış olur
      id: `kasa-fark-${last.date}-r${last.revision}`,
      kind: last.cashDiff < 0 ? "danger" : "warning",
      title: `Kasa: ${diffText(last.cashDiff)}`,
      body: [longDateTR(last.date), last.submittedByName, last.note].filter(Boolean).join(" · "),
      timeLabel: dateTR(last.date),
      unread: true,
      href: `/panel/kasa?gun=${last.date}`,
      group: "kasa",
    });
  }
  // Bütünlük uyarıları ayrı: okunamazsa yukarıdaki kasa bildirimleri yine görünür
  out.push(...(await cashIntegrityNotifications(reports, day, user.id).catch(() => [])));
  return out;
}

/**
 * Yönetici: kasanın bütünlüğü (docs/KASA-RAPORU.md › Açılış ve devir, Düzeltmeler). Bugünün ve dünün raporunda açılış
 * önceki devirle tutmuyorsa (kimlik raporun sürümünden: yeniden gönderilince yeniden okunmamış olur); son 7 günün bir
 * raporu iş günü kapandıktan sonra kasa alanı değiştirilerek düzeltildiyse (src/lib/cash-report.ts lateCorrections:
 * bütün geç düzeltmeler, bakan yöneticinin kendileri hariç; kimlik en yeni geç düzeltmeden). İki küçük sorgu.
 */
async function cashIntegrityNotifications(reports: Awaited<ReturnType<typeof cashReportsBetween>>, day: string, viewer: number): Promise<PanelNotification[]> {
  if (!reports.length) return [];
  const oldest = reports[reports.length - 1];
  const revised = reports.filter((r) => r.revision > 1).map((r) => r.id);
  const [before, revisions, proposed] = await Promise.all([previousCarryOver(oldest.date), cashRevisionsFor(revised), proposedByForReports(revised)]);
  const checks = carryChecks(reports, before);
  const yesterday = addDays(day, -1);
  const timeLabel = (date: string) => (date === day ? "Bugün" : date === yesterday ? "Dün" : dateTR(date));
  const out: PanelNotification[] = [];
  for (const r of reports) {
    const c = checks.get(r.date);
    if (!c || (r.date !== day && r.date !== yesterday)) continue;
    out.push({
      id: `kasa-acilis-${r.date}-r${r.revision}`,
      kind: "warning",
      title: "Kasa açılışı devirle tutmuyor",
      body: [`${longDateTR(r.date)} · açılış ${money(c.opening)}, önceki devir ${money(c.carry)} (${carryDiffText(c)})`, r.note].filter(Boolean).join(" · "),
      timeLabel: timeLabel(r.date),
      unread: true,
      href: `/panel/kasa?gun=${r.date}`,
      group: "kasa",
    });
  }
  for (const r of reports) {
    // Onaylanan düzeltme önerisi: "Mehmet önerdi · Ayşe onayladı"
    const late = r.revision > 1 ? lateCorrections(r, revisions.filter((x) => x.reportId === r.id), viewer, proposed.get(r.id)) : null;
    if (!late) continue;
    out.push({
      id: `kasa-duzeltme-${r.date}-r${late.revision}`,
      kind: "warning",
      title: "Kasa raporu ertesi gün değişti",
      body: [longDateTR(r.date), late.by.join(", "), changesText(late.changes)].join(" · "),
      timeLabel: timeLabel(r.date),
      unread: true,
      href: `/panel/kasa?gun=${r.date}`,
      group: "kasa",
    });
  }
  return out;
}

/**
 * Kasa istekleri (docs/ONAYLAR.md): yöneticiye bekleyen her düzeltme ve silme isteği bir satır (Onaylar'daki karta;
 * kimlik isteğin zil anından, güncellenince en çok 10 dakikada bir yeniden okunmamış olur); personele son 7 günde
 * sonuçlanan kendi istekleri ("22 Ekim kasa düzeltmeniz onaylandı"). Personelin satırında tutar yok.
 */
async function requestNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  if (user.role === "admin") {
    return (await pendingCashBellRows()).map((r) => ({
      id: `istek-${r.id}-${r.bumpedAt.getTime()}`,
      kind: "warning" as const,
      title: r.title,
      body: r.body,
      timeLabel: waitedText(r.createdAt, now),
      unread: true,
      href: `/panel/onaylar#istek-${r.id}`,
      group: "onay" as const,
    }));
  }
  const today = todayTR(now);
  return (await myCashRequests(user.id))
    .filter((r) => r.day && (r.status === "approved" || r.status === "rejected" || r.status === "superseded" || r.status === "expired"))
    .slice(0, 5)
    .map((r) => {
      const t = staffResultBell({ kind: r.kind, status: r.status as "approved" | "rejected" | "superseded" | "expired", day: r.day!, note: r.reviewNote });
      const at = todayTR(new Date(r.updatedAt));
      return {
        id: `istek-${r.id}-${r.status}`,
        kind: r.status === "approved" ? ("info" as const) : ("warning" as const),
        title: t.title,
        body: t.body,
        timeLabel: at === today ? "Bugün" : dateTR(at),
        unread: true,
        // Sonuç çoğu zaman sabah gelir: gün hâlâ personele açıksa rapora, değilse İsteklerim'e
        href: staffCanReport(r.day!, now) ? `/panel/kasa?gun=${r.day}` : "/panel/kasa#isteklerim",
        group: "onay" as const,
      };
    });
}

/** Zilin kasa satırları, iki rolde (loadPanelNotifications iki dalda çağırır) */
export async function kasaBell(user: CurrentUser): Promise<PanelNotification[]> {
  const [cash, requests] = await Promise.all([cashNotifications(user), requestNotifications(user).catch(() => [])]);
  return [...cash, ...requests];
}
