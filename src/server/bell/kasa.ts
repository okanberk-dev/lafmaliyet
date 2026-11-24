import "server-only";

import { inArray } from "drizzle-orm";

import { ALL_BRANCHES, DEFAULT_BRANCH_ID, tillBranches } from "@/lib/branches";
import {
  branchDayKey,
  businessDate,
  carryChecks,
  carryChecksByBranch,
  carryDiffText,
  changesText,
  diffKind,
  diffText,
  isCashEvening,
  lateCorrections,
  staffCanReport,
  type CarryCheck,
} from "@/lib/cash-report";
import { closedFollowUp, CLOSED_FOLLOW_UP_TEXT, staffResultBell } from "@/lib/cash-requests";
import { dateTR, money } from "@/lib/format";
import { lafposDiffs, lafposDiffText } from "@/lib/lafpos/diffs";
import { photoUnsureText } from "@/lib/lafpos/foto";
import { branchSwitchDay, kasaName } from "@/lib/lafpos/switch";
import { modposMismatchBell, modposMismatches } from "@/lib/modpos/zil";
import { addDays, longDateTR, todayTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import type { PanelNotification } from "@/server/actions/notifications";
import type { CurrentUser } from "@/server/auth/dal";
import { currentBranchScope, currentTillBranch, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { cashReportsBetween, cashRevisionsFor, firstCashReportDate, previousCarryOver, previousCarryOverByBranch, reportedDays, type CashReportDTO } from "@/server/data/cash-reports";
import { closedInfoRows, closedYesterday, pendingClosedRows } from "@/server/closed-days";
import { cashOutBellRow } from "@/server/data/cash-out-requests";
import { loadKasaLafposDays } from "@/server/data/lafpos-day";
import { loadLafposSwitchDay } from "@/server/lafpos/status";
import { getDb, schema as s } from "@/server/db";
import { loadModposSheets } from "@/server/modpos/store";
import { myCashRequests, pendingCashBellRows, proposedByForReports } from "@/server/data/cash-requests";

/*
 * Zilin kasa satırları (src/server/actions/notifications.ts toplar; docs/BILDIRIMLER.md). Kasa grubunun modülü: gün
 * sonu raporu, kasanın bütünlüğü ve (yönetici) kasa isteklerinin onay satırları, (personel) kasa isteklerinin sonucu
 * burada üretilir (plan docs/planlar/personel-yetki.md §2.3, §2.6, §2.7, §2.9). İki rol dalında da çağrılır; personele
 * maliyet ya da başkasının tutarı gitmez.
 */

/** Zil satırının kasası: şube, adı ve birden çok kasa açık mı (adı başlığa, `?sube=` adrese girer) */
interface TillOf {
  id: string;
  name: string;
  /** Birden çok kasa açık: başlıkta şubenin adı, kasa sayfasının adresinde `&sube=` */
  named: boolean;
}

/**
 * Yöneticinin zilindeki kasalar: "Tümü"de birden çok kasa açıkken her şube ayrı (`many`); değilse tek kasa (`till`:
 * seçili fiziksel şube; "Tümü"de ve online kanalda Tuzla, kasa sayfasının formu gibi)
 */
interface BellTills {
  of: (branchId: string) => TillOf;
  many: { id: string; name: string }[] | null;
  till: string;
}

async function bellTills(): Promise<BellTills> {
  const [scope, branches, till] = await Promise.all([currentBranchScope(), listBranches(), currentTillBranch()]);
  const tills = tillBranches(branches);
  const named = tills.length > 1;
  return {
    of: (id) => ({ id, name: branches.find((b) => b.id === id)?.name ?? id, named }),
    many: scope === ALL_BRANCHES && named ? tills.map(({ id, name }) => ({ id, name })) : null,
    till,
  };
}

/**
 * Satırın şubesi: kimlikte Tuzla'dan başka şube (Tuzla'nın kimliği bugünkü gibi; okundu işareti korunur), başlıkta birden
 * çok kasa açıkken şubenin adı, kasa sayfasının adresinde `&sube=` (seçici onu seçer, form o kasayı gösterir)
 */
const idPart = (t: TillOf) => (t.id !== DEFAULT_BRANCH_ID ? `-${t.id}` : "");
const titleOf = (title: string, t: TillOf) => (t.named ? `${title} · ${t.name}` : title);
const kasaHref = (date: string, t: TillOf) => `/panel/kasa?gun=${date}${t.named ? `&sube=${encodeURIComponent(t.id)}` : ""}`;

/**
 * Gün sonu kasa raporu: personele akşam (20:00'den sonra) bugünün raporu girilmediyse hatırlatma (kendi kasasının:
 * kilitli şube, seçili fiziksel şube, "Tümü"de Tuzla; formu o kasaya yazar); yöneticiye dünün raporu girilmediyse, son
 * raporda kasa farkı varsa (eksik kırmızı, fazla turuncu), açılış devirle tutmuyorsa ve rapor ertesi gün kasa alanı
 * değiştirilerek düzeltildiyse. "Tümü"de birden çok kasa açıkken yöneticiye her şubenin kasası ayrı.
 */
async function cashNotifications(user: CurrentUser): Promise<PanelNotification[]> {
  const now = new Date();
  const day = businessDate(now);
  const tills = user.role === "admin" ? await bellTills() : null;
  // Okunan kasa: personelin ve yöneticinin tek kasası (okumalar onun kapsamında); "Tümü"de birden çok kasa açıkken
  // süzülmez (hepsi birlikte, şube şube ayrılır)
  const till = tills ? (tills.many ? null : tills.till) : await currentTillBranch();
  const inTill = <T>(fn: () => Promise<T>) => (till ? withBranchScope(till, fn) : fn());
  const reports = await inTill(() => cashReportsBetween(addDays(day, -6), day));
  if (user.role !== "admin") {
    if (!isCashEvening(now) || reports.some((r) => r.date === day)) return [];
    // Günün kasası (denetim E-39): geçiş gününden itibaren LafPOS'ta "Günü kapat"; okunamazsa bugünkü gibi ModPOS. Geçiş
    // günü yalnız LafPOS'un şubesinin kasasınındır (branchSwitchDay): ModPOS'ta kalan şubenin personeli ModPOS'u okur
    const lafpos = kasaName(day, branchSwitchDay(await loadLafposSwitchDay().catch(() => null), till ?? (await currentTillBranch()))) === "LafPOS";
    return [
      {
        id: `kasa-bekliyor-${day}`,
        kind: "warning",
        title: "Bugünün kasa raporu bekliyor",
        body: lafpos ? "Kapanışta LafPOS'ta Günü kapat'a basın; rapor LafPOS'tan gelir, sonra Pavo'nun gün sonu fişinin fotoğrafını ekleyin" : "Kapanışta ModPOS'un Z raporunu ve kasayı girin",
        timeLabel: "Bugün",
        unread: true,
        href: "/panel/kasa",
        group: "kasa",
      },
    ];
  }
  if (!tills) return [];
  const out: PanelNotification[] = [];
  const yesterday = addDays(day, -1);
  // "Tümü"de birden çok kasa: her şubenin dünü ve son raporu ayrı (bir şubenin raporu ötekinin eksiğini örtmez); şube
  // hiç rapor girmediyse ya da ilk raporu dünden sonraysa dünü beklenmez (Bugün'ün kuralı). Tek kasada bugünkü gibi
  const groups = tills.many
    ? await Promise.all(
        tills.many.map(async (b) => {
          const own = reports.filter((r) => r.branchId === b.id);
          const first = own.some((r) => r.date <= yesterday) ? yesterday : await withBranchScope(b.id, () => firstCashReportDate()).catch(() => null);
          return { till: tills.of(b.id), reports: own, expects: first !== null && first <= yesterday };
        }),
      )
    : [{ till: tills.of(tills.till), reports, expects: true }];
  const missing = groups.filter((g) => g.expects && !g.reports.some((r) => r.date === yesterday));
  // Dün onaylı kapalıysa zil yok; personel kapalıydık dediyse (onay bekliyor) gövdesine eklenir (dalga 10 §2.9). Kapalı
  // gün şubenin: her kasanın eksiği kendi şubesinin işaretine ve bildirimine bakar (Tuzla kapalıyken Marina'nınki kalır)
  const closedOf = new Map(
    await Promise.all(missing.map(async (g) => [g.till.id, (await closedYesterday(user, now, g.till.id).catch(() => null))?.yesterday ?? null] as const)),
  );
  for (const g of missing) {
    const closed = closedOf.get(g.till.id) ?? null;
    if (closed?.state === "approved") continue;
    out.push({
      id: `kasa-yok-${yesterday}${idPart(g.till)}`,
      kind: "warning",
      title: titleOf("Dünkü kasa raporu girilmedi", g.till),
      body: `${longDateTR(yesterday)}${closed?.state === "pending" ? " · Personel: kapalıydık dedi (onay bekliyor)" : ""}`,
      timeLabel: "Dün",
      unread: true,
      href: kasaHref(yesterday, g.till),
      group: "kasa",
    });
  }
  for (const g of groups) {
    const last = g.reports[0];
    if (!last || diffKind(last.cashDiff) === "even") continue;
    const t = tills.of(last.branchId);
    out.push({
      // Rapor güncellenince yeniden okunmamış olur
      id: `kasa-fark-${last.date}${idPart(t)}-r${last.revision}`,
      kind: last.cashDiff < 0 ? "danger" : "warning",
      title: titleOf(`Kasa: ${diffText(last.cashDiff)}`, t),
      body: [longDateTR(last.date), last.submittedByName, last.note].filter(Boolean).join(" · "),
      timeLabel: dateTR(last.date),
      unread: true,
      href: kasaHref(last.date, t),
      group: "kasa",
    });
  }
  // Bütünlük uyarıları ayrı: okunamazsa yukarıdaki kasa bildirimleri yine görünür
  out.push(...(await inTill(() => cashIntegrityNotifications(reports, day, user.id, tills)).catch(() => [])));
  return out;
}

/**
 * Yönetici: kasanın bütünlüğü (docs/KASA-RAPORU.md › Açılış ve devir, Düzeltmeler). Bugünün ve dünün raporunda açılış
 * önceki devirle tutmuyorsa (kimlik raporun sürümünden: yeniden gönderilince yeniden okunmamış olur); son 7 günün bir
 * raporu iş günü kapandıktan sonra kasa alanı değiştirilerek düzeltildiyse (src/lib/cash-report.ts lateCorrections:
 * bütün geç düzeltmeler, bakan yöneticinin kendileri hariç; kimlik en yeni geç düzeltmeden). LafPOS gününde (geçiş
 * gününden sonra) rapor LafPOS'un gün sonundan farklıysa da satır (E-09): rapordan sonra gelen LafPOS yeniden gönderimi
 * de görünür (kimlik raporun sürümü ve LafPOS'un geliş anından). ModPOS gününde (geçiş günü boşken ya da gün ondan
 * önceyken) rapor saklanan ModPOS kasa föyünden farklıysa da satır (docs/MODPOS-API.md › Nerede görünür; kural
 * src/lib/modpos/zil.ts: kasası açık föy karşılaştırılmaz; kimlik raporun ve föyün sürümünden). Küçük sorgular; LafPOS
 * ve ModPOS okunamazsa yalnız kendi satırları düşer.
 */
async function cashIntegrityNotifications(reports: CashReportDTO[], day: string, viewer: number, tills: BellTills): Promise<PanelNotification[]> {
  if (!reports.length) return [];
  const oldest = reports[reports.length - 1];
  const revised = reports.filter((r) => r.revision > 1).map((r) => r.id);
  const [checks, revisions, proposed, lafposOf, modpos] = await Promise.all([
    carryOf(reports, oldest.date, tills),
    cashRevisionsFor(revised),
    proposedByForReports(revised),
    loadKasaLafposDays(oldest.date, day).catch(() => null),
    Promise.all([loadModposSheets(oldest.date, day), loadLafposSwitchDay()]).catch(() => null),
  ]);
  const yesterday = addDays(day, -1);
  const timeLabel = (date: string) => (date === day ? "Bugün" : date === yesterday ? "Dün" : dateTR(date));
  const out: PanelNotification[] = [];
  for (const r of reports) {
    const c = checks(r);
    if (!c || (r.date !== day && r.date !== yesterday)) continue;
    const t = tills.of(r.branchId);
    out.push({
      id: `kasa-acilis-${r.date}${idPart(t)}-r${r.revision}`,
      kind: "warning",
      title: titleOf("Kasa açılışı devirle tutmuyor", t),
      body: [`${longDateTR(r.date)} · açılış ${money(c.opening)}, önceki devir ${money(c.carry)} (${carryDiffText(c)})`, r.note].filter(Boolean).join(" · "),
      timeLabel: timeLabel(r.date),
      unread: true,
      href: kasaHref(r.date, t),
      group: "kasa",
    });
  }
  for (const r of reports) {
    // Onaylanan düzeltme önerisi: "Mehmet önerdi · Ayşe onayladı"
    const late = r.revision > 1 ? lateCorrections(r, revisions.filter((x) => x.reportId === r.id), viewer, proposed.get(r.id)) : null;
    if (!late) continue;
    const t = tills.of(r.branchId);
    out.push({
      id: `kasa-duzeltme-${r.date}${idPart(t)}-r${late.revision}`,
      kind: "warning",
      title: titleOf("Kasa raporu ertesi gün değişti", t),
      body: [longDateTR(r.date), late.by.join(", "), changesText(late.changes)].join(" · "),
      timeLabel: timeLabel(r.date),
      unread: true,
      href: kasaHref(r.date, t),
      group: "kasa",
    });
  }
  // LafPOS'tan farklı yazılan (yalnız LafPOS günlerinde; geçiş günü boşken loadKasaLafposDays hiçbir günü vermez). Gün
  // sonu raporun kendi şubesinin: Marina'nın raporu Tuzla'nın gün sonuyla karşılaştırılmaz
  for (const r of reports) {
    const lafpos = lafposOf?.(r.date, r.branchId).day;
    const diffs = lafpos ? lafposDiffs(r, lafpos) : [];
    if (!lafpos || !diffs.length) continue;
    const t = tills.of(r.branchId);
    const after = lafpos.receivedAt > r.updatedAt;
    const body = `${longDateTR(r.date)} · ${diffs.map(lafposDiffText).join("; ")}`;
    out.push({
      id: `kasa-lafpos-${r.date}${idPart(t)}-r${r.revision}-${Date.parse(lafpos.receivedAt)}`,
      kind: "warning",
      title: titleOf(after ? "LafPOS rapordan sonra farklı rakamla geldi" : "Kasa raporu LafPOS'tan farklı", t),
      body: body.length > 220 ? `${body.slice(0, 219)}…` : body,
      timeLabel: timeLabel(r.date),
      unread: true,
      href: kasaHref(r.date, t),
      group: "kasa",
    });
  }
  // ModPOS föyünden farklı yazılan (yalnız ModPOS günlerinde, kasası kapanmış föyle; föy hiç çekilmediyse satır yok).
  // Rapor kendi şubesinin föyüyle; birden çok kasa açıkken gövdede şubenin adı
  for (const m of modpos ? modposMismatches(reports, modpos[0], modpos[1]) : []) {
    const t = tills.of(m.report.branchId);
    out.push({ ...modposMismatchBell(m, t.named ? t.name : undefined), kind: "warning", timeLabel: timeLabel(m.report.date), unread: true, group: "kasa" });
  }
  // Gün sonu tam (24 Kasım 2026): LafPOS gününün gün sonu fotoğrafı LafPOS'un rakamlarından farklı ya da kodla okunup güvenle seçilmedi (yalnız yönetici, son 7
  // gün; src/lib/lafpos/foto.ts). Kimlik karşılaştırmanın anından: yeni fotoğraf ya da LafPOS'un yeniden gönderimi yeniden okunmamış
  const photoRows = await getDb()
    .select({ reportId: s.lafposDayEnds.reportId, photoCheck: s.lafposDayEnds.photoCheck })
    .from(s.lafposDayEnds)
    .where(inArray(s.lafposDayEnds.reportId, reports.map((r) => r.id)))
    .catch(() => []);
  for (const row of photoRows) {
    const r = reports.find((x) => x.id === row.reportId);
    const check = row.photoCheck;
    // Kodla okunup bir satırı güvenle seçilmeyen fotoğraf da yöneticinin (yapay zekâ yokken; "yönetici baksın")
    if (!r || (check?.state !== "fark" && check?.state !== "belirsiz")) continue;
    const t = tills.of(r.branchId);
    const body = check.state === "fark" ? check.issues.join("; ") : `${photoUnsureText(check)}; fotoğrafa bakın.`;
    out.push({
      id: `kasa-foto-${r.date}${idPart(t)}-${Date.parse(check.at)}`,
      kind: "warning",
      title: `${check.state === "fark" ? "Kasa fotoğrafı LafPOS'tan farklı" : "Kasa fotoğrafı okunamadı, yönetici baksın"} · ${t.name} ${longDateTR(r.date)}`,
      body: body.length > 220 ? `${body.slice(0, 219)}…` : body,
      timeLabel: timeLabel(r.date),
      unread: true,
      href: kasaHref(r.date, t),
      group: "kasa",
    });
  }
  return out;
}

/**
 * Açılış ↔ devir zinciri: tek kasada listenin en eski gününden önceki son rapordan; "Tümü"de birden çok kasa açıkken
 * şube şube (her şubenin kendi önceki devriyle; Marina'nın açılışı Tuzla'nın deviriyle karşılaştırılmaz)
 */
async function carryOf(reports: CashReportDTO[], oldest: string, tills: BellTills): Promise<(r: CashReportDTO) => CarryCheck | undefined> {
  if (!tills.many) {
    const checks = carryChecks(reports, await previousCarryOver(oldest));
    return (r) => checks.get(r.date);
  }
  const checks = carryChecksByBranch(reports, await previousCarryOverByBranch(oldest, [...tills.many.map((b) => b.id), ...reports.map((r) => r.branchId)]));
  return (r) => checks.get(branchDayKey(r.branchId, r.date));
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
    // Bilgi: kapalı işaret kanıtla kalktı, kapalı aralığa rapor girildi; personel özel gün ekledi / düzeltti / sildi.
    // Özel günler Kafe › Özel günler'de (/panel/ozel-gunler; /panel/tahmin satış tahminiyle 4 Kasım 2026'da kalktı,
    // eski adres 404 veriyordu: denetim 21 Kasım #23)
    for (const r of info) {
      const verb = r.action === "Özel gün" ? "ekledi" : r.action === "Özel gün güncellendi" ? "düzeltti" : r.action === "Özel gün silindi" ? "sildi" : null;
      out.push({
        id: `kapali-bilgi-${r.id}`,
        kind: "info",
        title: verb ? `${r.userName ?? "Personel"} özel gün ${verb}` : r.action,
        body: r.detail ?? "",
        timeLabel: todayTR(r.at) === todayTR(now) ? "Bugün" : dateTR(todayTR(r.at)),
        unread: true,
        href: verb ? "/panel/ozel-gunler#ozel-gunler" : "/panel/kasa",
        group: "uyari",
      });
    }
    return out;
  }
  const today = todayTR(now);
  const rows = (await myCashRequests(user.id))
    .filter((r) => r.day && (r.status === "approved" || r.status === "rejected" || r.status === "superseded" || r.status === "expired" || r.status === "revoked"))
    .slice(0, 5);
  // Reddedilen ya da kaldırılan kapalı gün bildirimi: o günün raporu personelin kasasına girildi mi (yalnız tarih; kasa
  // kilitli şube, seçili fiziksel şube, "Tümü"de Tuzla: öteki şubenin raporu bu kasanın gününü kapatmaz)
  const closedDays = rows.flatMap((r) => (r.kind === "kapali-gun" && r.status !== "approved" ? [r.day!] : []));
  const reported = closedDays.length ? await withBranchScope(await currentTillBranch(), () => reportedDays(closedDays)) : new Set<string>();
  return rows.map((r) => {
    const t = staffResultBell({ kind: r.kind, status: r.status as "approved" | "rejected" | "superseded" | "expired" | "revoked", day: r.day!, note: r.reviewNote, title: r.title });
    const at = todayTR(new Date(r.updatedAt));
    // Kapalı gün bildirimi reddedildi ya da kaldırıldı ve gün personele kapandı: geç rapor penceresindeyse personel Z
    // fotoğrafıyla geç rapor girer (yönetici onaylar), değilse raporu yönetici girer
    const follow = r.kind === "kapali-gun" && r.status !== "approved" ? closedFollowUp(r.day!, now, reported.has(r.day!)) : "staff";
    return {
      id: `istek-${r.id}-${r.status}`,
      kind: r.status === "approved" ? ("info" as const) : ("warning" as const),
      title: t.title,
      body: follow === "staff" ? t.body : CLOSED_FOLLOW_UP_TEXT[follow],
      timeLabel: at === today ? "Bugün" : dateTR(at),
      unread: true,
      // Sonuç çoğu zaman sabah gelir: gün hâlâ personele açıksa (ya da geç rapor girilecekse) o güne, değilse İsteklerim'e
      href: follow === "late" || staffCanReport(r.day!, now) ? `/panel/kasa?gun=${r.day}` : "/panel/kasa#isteklerim",
      group: "onay" as const,
    };
  });
}

/** Zilin kasa satırları, iki rolde (loadPanelNotifications iki dalda çağırır) */
export async function kasaBell(user: CurrentUser): Promise<PanelNotification[]> {
  const [cash, requests] = await Promise.all([cashNotifications(user), requestNotifications(user).catch(() => [])]);
  return [...cash, ...requests];
}
