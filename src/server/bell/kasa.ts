import "server-only";

import { businessDate, carryChecks, carryDiffText, changesText, diffKind, diffText, isCashEvening, lateCorrections, staffCanReport } from "@/lib/cash-report";
import { staffResultBell } from "@/lib/cash-requests";
import { dateTR, money } from "@/lib/format";
import { addDays, longDateTR, todayTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { cashReportsBetween, cashRevisionsFor, previousCarryOver } from "@/server/data/cash-reports";
import { closedInfoRows, closedYesterday, pendingClosedRows } from "@/server/closed-days";
import { cashOutBellRow } from "@/server/data/cash-out-requests";
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
  // Dün onaylı kapalıysa zil yok; personel kapalıydık dediyse (onay bekliyor) gövdesine eklenir (dalga 10 §2.9)
  const closed = reports.some((r) => r.date === yesterday) ? null : ((await closedYesterday(user, now).catch(() => null))?.yesterday ?? null);
  if (!reports.some((r) => r.date === yesterday) && closed?.state !== "approved") {
    out.push({
      id: `kasa-yok-${yesterday}`,
      kind: "warning",
      title: "Dünkü kasa raporu girilmedi",
      body: `${longDateTR(yesterday)}${closed?.state === "pending" ? " · Personel: kapalıydık dedi (onay bekliyor)" : ""}`,
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
    const [rows, outs, closedRows, info] = await Promise.all([
      pendingCashBellRows(),
      cashOutBellRow(now),
      pendingClosedRows(),
      closedInfoRows(new Date(now.getTime() - 3 * 86_400_000)).catch(() => []),
    ]);
    const out: PanelNotification[] = rows.map((r) => ({
      id: `istek-${r.id}-${r.bumpedAt.getTime()}`,
      kind: "warning" as const,
      title: r.title,
      body: r.body,
      timeLabel: waitedText(r.createdAt, now),
      unread: true,
      href: `/panel/onaylar#istek-${r.id}`,
      group: "onay" as const,
    }));
    // Kasadan çıkan ve fotoğraf kaldırma istekleri tek satır ("3 kasa isteği onay bekliyor")
    if (outs) {
      out.push({
        id: outs.id,
        kind: "warning",
        title: `${outs.count} kasa isteği onay bekliyor`,
        body: outs.text,
        timeLabel: waitedText(outs.oldestAt, now),
        unread: true,
        href: `/panel/onaylar#istek-${outs.firstId}`,
        group: "onay",
      });
    }
    // Kapalı gün bildirimleri: "Kapalı gün onayı bekliyor"
    for (const r of closedRows) {
      out.push({
        id: `istek-${r.id}-${r.bumpedAt.getTime()}`,
        kind: "warning",
        title: "Kapalı gün onayı bekliyor",
        body: `${longDateTR(r.day)} · ${r.requestedByName}`,
        timeLabel: waitedText(r.createdAt, now),
        unread: true,
        href: `/panel/onaylar#istek-${r.id}`,
        group: "onay",
      });
    }
    // Bilgi: kapalı işaret kanıtla kalktı, kapalı aralığa rapor girildi; personel özel gün ekledi / düzeltti / sildi
    for (const r of info) {
      const verb = r.action === "Özel gün" ? "ekledi" : r.action === "Özel gün güncellendi" ? "düzeltti" : r.action === "Özel gün silindi" ? "sildi" : null;
      out.push({
        id: `kapali-bilgi-${r.id}`,
        kind: "info",
        title: verb ? `${r.userName ?? "Personel"} özel gün ${verb}` : r.action,
        body: r.detail ?? "",
        timeLabel: todayTR(r.at) === todayTR(now) ? "Bugün" : dateTR(todayTR(r.at)),
        unread: true,
        href: verb ? "/panel/tahmin#ozel-gunler" : "/panel/kasa",
        group: "uyari",
      });
    }
    return out;
  }
  const today = todayTR(now);
  return (await myCashRequests(user.id))
    .filter((r) => r.day && (r.status === "approved" || r.status === "rejected" || r.status === "superseded" || r.status === "expired" || r.status === "revoked"))
    .slice(0, 5)
    .map((r) => {
      const t = staffResultBell({ kind: r.kind, status: r.status as "approved" | "rejected" | "superseded" | "expired" | "revoked", day: r.day!, note: r.reviewNote, title: r.title });
      const at = todayTR(new Date(r.updatedAt));
      return {
        id: `istek-${r.id}-${r.status}`,
        kind: r.status === "approved" ? ("info" as const) : ("warning" as const),
        title: t.title,
        // Reddedilen ya da geri alınan kapalı gün bildiriminde gün personele kapandıysa raporu yönetici girer
        body: r.kind === "kapali-gun" && r.status !== "approved" && !staffCanReport(r.day!, now) ? "Raporu yönetici girecek; Z raporunu yöneticiye iletin." : t.body,
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
