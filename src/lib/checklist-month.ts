// Kontrol listelerinin aylık denetim raporu (docs/KONTROL-LISTELERI.md › Aylık PDF): ayın her günü, o gün beklenen
// listeler; her maddenin yanıtı, işaretleyen, saat ve fotoğraf; eksik ve doldurulmamış günler, kafenin kapalı olduğu
// günler. Saf: veriyi src/server/checklists/month-pdf.ts okur ve çizer; tests/kontrol-aylik.test.ts sınar.

import { rangeText, timeTR, valueText, type AnswerLite, type ChecklistItemSnap, type RunLite } from "./checklists";
import { monthTitle } from "./closed-period";

/** Geçmişin bir günündeki bir liste (src/server/checklists/store.ts HistoryList'in okunan kısmı) */
export interface MonthListInput {
  lite: { name: string; opensAt: string; dueAt: string; run: RunLite | null };
  run: { completedAt: string | null; completedByName: string | null } | null;
  items: ChecklistItemSnap[];
  answers: AnswerLite[];
}

export interface MonthItemRow {
  label: string;
  section: string | null;
  /** "Tamam", "6 °C (0–4 °C) · aralık dışı", "Sorun var: su kaçırıyor", "Yanıtsız" */
  answer: string;
  /** Sorun ya da aralık dışı */
  issue: boolean;
  /** Zorunlu ve yanıtsız */
  missing: boolean;
  by: string | null;
  /** Türkiye saati "HH:MM" */
  time: string | null;
  /** Fotoğraf: Var (çekildi; 60 gün sonra dosyası silinse de), Yok (fotoğraflı madde, çekilmedi), boş (fotoğrafsız madde) */
  photo: "Var" | "Yok" | null;
}

export type MonthListState = "complete" | "partial" | "missing";

export interface MonthListBlock {
  name: string;
  /** "08:00–10:30" */
  window: string;
  state: MonthListState;
  /** "Tamamlandı 09:12 · Selin", "Eksik: 3 madde", "Doldurulmadı" */
  stateText: string;
  items: MonthItemRow[];
}

export interface MonthDay {
  day: string;
  /** Kafe kapalı işaretli (özel günlerin "kapalı" satırı): beklenen liste eksik sayılmaz */
  closed: boolean;
  lists: MonthListBlock[];
}

export interface MonthReport {
  month: string;
  title: string;
  branch: string;
  days: MonthDay[];
  totals: { expected: number; complete: number; partial: number; missing: number; closedDays: number; issues: number; photos: number };
  /** Eksik ya da doldurulmamış listesi olan günler (kapalı günler hariç), eskiden yeniye */
  gaps: { day: string; lists: string[] }[];
}

function answerText(item: ChecklistItemSnap, a: AnswerLite): string {
  const note = a.note?.trim() ? `: ${a.note.trim()}` : "";
  if (item.type === "number" && a.value !== null) {
    const range = rangeText(item);
    return `${valueText(item, a.value)}${range ? ` (${range})` : ""}${a.status === "issue" ? " · aralık dışı" : ""}${note}`;
  }
  if (item.type === "text") return a.textValue?.trim() || (a.status === "issue" ? `Sorun var${note}` : "Not yazılmadı");
  return a.status === "issue" ? `Sorun var${note}` : `Tamam${a.note?.trim() ? ` (${a.note.trim()})` : ""}`;
}

/** Bir günün bir listesi: madde madde yanıt ve listenin durumu */
export function listBlock(l: MonthListInput): MonthListBlock {
  const answers = new Map(l.answers.map((a) => [a.itemId, a]));
  const items = l.items.map((item): MonthItemRow => {
    const a = answers.get(item.id);
    if (!a) return { label: item.label, section: item.section, answer: item.required ? "Yanıtsız" : "Yanıtsız (isteğe bağlı)", issue: false, missing: item.required, by: null, time: null, photo: item.type === "photo" ? "Yok" : null };
    return {
      label: item.label,
      section: item.section,
      answer: answerText(item, a),
      issue: a.status === "issue",
      missing: false,
      by: a.by,
      time: timeTR(a.at),
      photo: a.photoAt || a.photoId ? "Var" : item.type === "photo" ? "Yok" : null,
    };
  });
  const window = `${l.lite.opensAt}–${l.lite.dueAt}`;
  const r = l.lite.run;
  if (!r || !l.answers.length) return { name: l.lite.name, window, state: "missing", stateText: "Doldurulmadı", items };
  if (r.complete) {
    const at = l.run?.completedAt ?? r.completedAt ?? r.lastAt;
    const who = l.run?.completedByName ?? r.contributors[r.contributors.length - 1] ?? null;
    return { name: l.lite.name, window, state: "complete", stateText: ["Tamamlandı", at ? timeTR(at) : null, who].filter(Boolean).join(" · "), items };
  }
  const left = r.missing.length || items.filter((i) => i.missing).length;
  return { name: l.lite.name, window, state: "partial", stateText: `Eksik: ${left} madde`, items };
}

/**
 * Ayın raporu. `days`: geçmişin günleri (herhangi bir sırada; rapor eskiden yeniye), `closedDays`: kafenin kapalı işaretli
 * günleri. Kapalı günde doldurulmamış liste eksik sayılmaz ("Kafe kapalıydı"); doldurulmuşsa olduğu gibi yazılır.
 */
export function buildMonthReport(input: { month: string; branch: string; days: { day: string; lists: MonthListInput[] }[]; closedDays: readonly string[] }): MonthReport {
  const closed = new Set(input.closedDays);
  const totals = { expected: 0, complete: 0, partial: 0, missing: 0, closedDays: 0, issues: 0, photos: 0 };
  const gaps: MonthReport["gaps"] = [];
  const days = [...input.days]
    .filter((d) => d.day.slice(0, 7) === input.month)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d): MonthDay => {
      const isClosed = closed.has(d.day);
      const lists = d.lists.map(listBlock).filter((b) => !(isClosed && b.state === "missing"));
      if (isClosed) totals.closedDays++;
      const open: string[] = [];
      for (const b of lists) {
        totals.expected++;
        totals[b.state]++;
        totals.issues += b.items.filter((i) => i.issue).length;
        totals.photos += b.items.filter((i) => i.photo === "Var").length;
        if (b.state !== "complete") open.push(`${b.name} (${b.state === "missing" ? "doldurulmadı" : b.stateText.toLocaleLowerCase("tr-TR")})`);
      }
      if (open.length) gaps.push({ day: d.day, lists: open });
      return { day: d.day, closed: isClosed, lists };
    });
  return { month: input.month, title: monthTitle(input.month), branch: input.branch, days, totals, gaps };
}

/** PDF'in dosya adı: kontrol-listeleri-2026-10-marina.pdf */
export const monthPdfName = (month: string, branchId: string | null) => `kontrol-listeleri-${month}${branchId ? `-${branchId}` : ""}.pdf`;
