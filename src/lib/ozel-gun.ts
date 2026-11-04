/**
 * Özel günlerin ve saatlerin Türkçe metinleri (saf; tests/ozel-gun.test.ts).
 *
 * Satış tahmini 4 Kasım 2026'da kaldırıldı (sahibin isteği); tahmine özgü metinler o zaman silindi. Burada
 * kalanlar Özel günler ekranının, kapalı gün akışının, Bugün'ün, zilin ve işlem geçmişinin kullandıklarıdır.
 * Özel gün artık bir tahmin girdisi değil, yalnız takvim notudur: "etki" yüzdesi hiçbir sayıyı değiştirmez,
 * ekranda notun yanında durur (eski kayıtlar da okunabilsin diye alan korundu).
 */

import { dayMonthTR, todayTR } from "@/lib/reminders";
import { rangeTR, shortRangeTR, type SpecialKind } from "@/lib/takvim";

/** Listede görünen geçmiş pencere (gün), ileriye izin verilen en uzak gün ve en uzun süre */
export const SPECIAL_PAST_DAYS = 60;
export const SPECIAL_AHEAD_DAYS = 60;
export const SPECIAL_MAX_AHEAD_DAYS = 365;
export const SPECIAL_MAX_SPAN_DAYS = 14;

/** Özel günün türünün adı */
export const SPECIAL_KIND_LABEL: Record<SpecialKind, string> = {
  derbi: "Derbi / maç",
  avm: "AVM etkinliği",
  kampanya: "Kampanya",
  kapali: "Kafe kapalı",
  diger: "Diğer",
};

/** Yöneticinin ya da personelin girdiği özel gün (special_days) */
export interface SpecialDay {
  id: number;
  dateFrom: string;
  dateTo: string;
  kind: SpecialKind;
  title: string;
  /** Beklenen etki (−0,30 … +0,30; kapalıda −1). Yalnız not: hiçbir hesaba girmez */
  effect: number;
  note?: string | null;
  /** Personel ekledi (/panel/ozel-gunler; dalga 10 §2.9) */
  byStaff?: boolean;
  /** Personelin satırında ekleyenin adı */
  addedBy?: string | null;
}

/** İşaretli yüzde: "+%15", "−%30" */
export function signedPct(v: number): string {
  const pct = Math.round(Math.abs(v) * 100);
  return `${v < 0 ? "−" : "+"}%${pct}`;
}

/** Özel günün etkisinin seçenekleri (formdaki sıra) */
export const EFFECT_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0.3, label: "Çok yoğun olur (+%30)" },
  { value: 0.15, label: "Yoğun olur (+%15)" },
  { value: 0, label: "Etkisini bilmiyorum (yalnız not)" },
  { value: -0.15, label: "Sakin olur (−%15)" },
  { value: -0.3, label: "Çok sakin olur (−%30)" },
];

/** Özel günün türü ve etkisi: "Derbi / maç · +%15", "Diğer", "Kafe kapalı" */
export function specialTail(d: Pick<SpecialDay, "kind" | "effect">): string {
  return d.kind === "kapali"
    ? SPECIAL_KIND_LABEL.kapali
    : `${SPECIAL_KIND_LABEL[d.kind]}${d.effect ? ` · ${signedPct(d.effect)}` : ""}`;
}

/** Listedeki satır: "25 Eki Cmt · Fenerbahçe – Galatasaray maçı · Derbi / maç · +%15" */
export function specialRow(d: Pick<SpecialDay, "dateFrom" | "dateTo" | "kind" | "title" | "effect">): string {
  return `${shortRangeTR(d.dateFrom, d.dateTo)} · ${d.title} · ${specialTail(d)}`;
}

/** İşlem geçmişi ve bildirim: "25 Ekim Cumartesi · … maçı (Derbi / maç, +%15)" */
export function specialSummary(d: Pick<SpecialDay, "dateFrom" | "dateTo" | "kind" | "title" | "effect">): string {
  const effect = d.kind === "kapali" ? "" : d.effect ? `, ${signedPct(d.effect)}` : ", etkisi bilinmiyor";
  return `${rangeTR(d.dateFrom, d.dateTo)} · ${d.title} (${SPECIAL_KIND_LABEL[d.kind]}${effect})`;
}

const CLOCK = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "08:02" (Türkiye) */
export function clockTR(iso: string): string {
  return CLOCK.format(new Date(iso));
}

/** "22 Ekim 08:02" (Türkiye) */
export function stampTR(iso: string): string {
  const d = new Date(iso);
  return `${dayMonthTR(todayTR(d))} ${CLOCK.format(d)}`;
}

/** Türkçe katlama (aynı adı yakalamak için): "Fenerbahçe" ≡ "fenerbahce" */
export function foldTR(v: string): string {
  return v
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
