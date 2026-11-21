/**
 * Kontrol listelerinin personele giden e-posta hatırlatmaları (saf; saat argümandır). İş açık bir panel sekmesinin canlı
 * yoklamasıyla (/api/canli, en çok 5 dakikada bir) ve yedek olarak saatlik uçla (/api/cron/kontrol, GitHub Actions saat
 * başını 7 geçe) tetiklenir; her çalışmada bugünün listelerine bakar ve henüz gönderilmemiş olanları üretir:
 *
 * - **Saatlik bölümlü liste** (Tuvalet çizelgesi; bölüm adı saat, lib/checklists.ts sectionSlot): her saat için
 *   "zamanı geldi" (bölüm açıldı, zorunlu maddesi eksik) ve "gecikti" (sıradaki saat geldi, hâlâ eksik).
 * - **Öteki listeler** (Açılış, Kapanış…): aralık açılınca "zamanı geldi", son saat geçince "gecikti".
 *
 * Bitmiş (zorunlu maddeleri yanıtlanmış) saat ya da liste için e-posta yok. İş gecikir ya da bir çalışma kaçarsa
 * durum yine doğru hesaplanır: aralığı bitmiş saat için "zamanı geldi" değil yalnız "gecikti" gider; LATE_ALERT_MIN'den
 * eski gecikme hiç gönderilmez (iş bir gün durup dönünce yığın halinde eski uyarı gitmesin). Her uyarının tekil
 * anahtarı notification_log'a yazılır: aynı uyarı iki kez gitmez. Ayrıntı docs/KONTROL-LISTELERI.md § 6.
 */

import { clockInstant, groupBySection, isAnswered, sectionSlot, slotOpensInstant, type AnswerLite, type ChecklistItemSnap } from "./checklists";

/** Gecikme uyarısı son saatten en çok bu kadar dakika sonra gider (sonra artık eskidir) */
export const LATE_ALERT_MIN = 120;
/** Uyarının e-postasında yazılan eksik madde sınırı */
export const ALERT_MISSING_MAX = 6;
/** notification_log anahtarının öneki (sabah e-postasının `kontrol:<gün>` anahtarından ayrı) */
export const ALERT_KEY_PREFIX = "kontrol-eposta";
/**
 * Açık panel sekmesinin canlı yoklaması (/api/canli) hatırlatma işini en çok bu sıklıkla tetikler (sunucu örneği
 * başına). GitHub'ın saatlik zamanlanmış işi yoğunlukta saatlerce gecikip düşebildiği için (17–20 Kasım 2026: 3 günde
 * 57 yerine 11 çalışma) asıl tetikleyici budur; GitHub işi kimse bakmazken yedektir.
 */
export const ALERT_POLL_GAP_MS = 5 * 60_000;

/** Canlı yoklama hatırlatma işini şimdi tetiklemeli mi (son tetiklemeden ALERT_POLL_GAP_MS geçti; saat geri gittiyse de) */
export function alertPollDue(nowMs: number, lastMs: number): boolean {
  return nowMs - lastMs >= ALERT_POLL_GAP_MS || nowMs < lastMs;
}

/** Bugünün bir listesi: kaydın (yoksa şablonun) maddeleri ve yanıtlar */
export interface AlertList {
  templateId: number;
  name: string;
  /** Şube; boş: bütün şubeler */
  branchId: string | null;
  opensAt: string;
  dueAt: string;
  items: ChecklistItemSnap[];
  answers: Pick<AnswerLite, "itemId" | "photoAt">[];
  /** O gün kaydı var mı (liste açıldı; kapalı işaretli günde yalnız bunlar hatırlatılır, remindableLists) */
  hasRun: boolean;
}

export interface ChecklistAlert {
  /** notification_log anahtarı: kontrol-eposta:{liste}:{gün}:{saat|liste}:{due|late} */
  key: string;
  kind: "due" | "late";
  templateId: number;
  listName: string;
  branchId: string | null;
  /** Saatlik bölümün saati ("10:00"); bütün liste için null */
  slot: string | null;
  /** Bitiş: sıradaki saat ya da listenin son saati ("11:00") */
  until: string;
  /** Yanıtlanmamış zorunlu maddeler, sırasıyla */
  missing: string[];
}

const MIN_MS = 60_000;

/** Bugünün listelerinden şimdi gönderilecek uyarılar (gecikmeler önce, sonra listelerin sırasıyla) */
export function checklistAlerts(day: string, now: Date, lists: AlertList[]): ChecklistAlert[] {
  const out: ChecklistAlert[] = [];
  const t = now.getTime();
  for (const l of lists) {
    const answered = new Map(l.answers.map((a) => [a.itemId, a]));
    const missingOf = (items: ChecklistItemSnap[]) => items.filter((i) => i.required && !isAnswered(i, answered.get(i.id))).map((i) => i.label);
    const push = (slot: string | null, opens: number, end: number, until: string, missing: string[]) => {
      if (!missing.length || t < opens) return;
      const kind = t >= end ? "late" : "due";
      if (kind === "late" && t >= end + LATE_ALERT_MIN * MIN_MS) return;
      out.push({ key: `${ALERT_KEY_PREFIX}:${l.templateId}:${day}:${slot ?? "liste"}:${kind}`, kind, templateId: l.templateId, listName: l.name, branchId: l.branchId, slot, until, missing });
    };
    const groups = groupBySection(l.items);
    const hourly = groups.filter((g) => sectionSlot(g.section) !== null);
    const listEnd = clockInstant(day, l.dueAt, true).getTime();
    hourly.forEach((g, n) => {
      const slot = sectionSlot(g.section)!;
      const next = hourly[n + 1] ? sectionSlot(hourly[n + 1].section)! : null;
      const end = next ? clockInstant(day, next).getTime() : listEnd;
      push(slot, slotOpensInstant(day, g.section)!.getTime(), end, next ?? l.dueAt, missingOf(g.items));
    });
    // Saatsiz maddeler (ya da hiç saatlik bölüm yoksa bütün liste): aralık açılınca, son saat geçince
    const plain = groups.filter((g) => sectionSlot(g.section) === null).flatMap((g) => g.items);
    if (plain.length) push(null, clockInstant(day, l.opensAt).getTime(), listEnd, l.dueAt, missingOf(plain));
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "late" ? -1 : 1));
}

/** Uyarının başlığı: "Tuvalet çizelgesi · 10:00 zamanı geldi", "Açılış listesi gecikti" */
export function alertTitle(a: Pick<ChecklistAlert, "kind" | "listName" | "slot">, listTitle: (n: string) => string): string {
  const name = listTitle(a.listName);
  if (a.slot) return a.kind === "due" ? `${name} · ${a.slot} zamanı geldi` : `${name} · ${a.slot} gecikti`;
  return a.kind === "due" ? `${name} zamanı geldi` : `${name} gecikti`;
}

/** Uyarının açıklaması: son saat ve eksik maddeler */
export function alertText(a: Pick<ChecklistAlert, "kind" | "until" | "missing">): string {
  const count = a.missing.length;
  return a.kind === "due" ? `Son saat ${a.until}. Yapılacak ${count} madde var.` : `Son saat ${a.until} geçti; ${count} madde yapılmadı. Hemen tamamlayın.`;
}

/** Konunun sırası: tek uyarıda başlığı, birden çoksa ilki ve "(+n)" */
export function alertSubject(alerts: Pick<ChecklistAlert, "kind" | "listName" | "slot">[], listTitle: (n: string) => string): string {
  const first = alerts[0];
  if (!first) return "Kontrol listeleri";
  return `${alertTitle(first, listTitle)}${alerts.length > 1 ? ` (+${alerts.length - 1})` : ""}`;
}

/**
 * Kapalı işaretli gün (Özel günler › Kafe kapalı; kapalı gün işletmenindir, docs/SUBE.md): o gün hiç açılmamış listeler
 * için hatırlatma gitmez, açılmış (kaydı olan) liste yine hatırlatılır. Zilin ve Bugün'ün dünkü listeler kuralının
 * aynısı (src/server/actions/notifications.ts `!closedYesterday || l.run`; 21 Kasım denetimi #25).
 */
export function remindableLists<T extends Pick<AlertList, "hasRun">>(lists: T[], closed: boolean): T[] {
  return closed ? lists.filter((l) => l.hasRun) : lists;
}

/**
 * Uyarı kime gider: listeyi doldurabilen etkin personel. Şubeli listede o şubenin personeli ve şubesi boş (bütün
 * şubelerde çalışan) personel; şubesiz listede bütün personel.
 */
export function alertReaches(listBranch: string | null, user: { branchId: string | null }): boolean {
  return listBranch === null || user.branchId === null || user.branchId === listBranch;
}
