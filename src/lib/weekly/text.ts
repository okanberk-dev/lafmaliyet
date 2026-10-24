/**
 * Haftalık özetin metinleri (saf; tests/haftalik-ozet.test.ts): kaynak adları, hafta aralığı, ciro eğilimi, konu,
 * başlık, okunamayanlar, Ödemeler'deki durum satırı ve alıcılar. Rakamdan ve tarihten sonra ek gelmez ("Latte: …",
 * "Latte'de" değil): ek okunuşa göre değişir, yanlış yazılmasın.
 */

import { MONTH_NAMES } from "@/lib/constants";
import { dateTimeTR } from "@/lib/format";

import { claimStateOf, WEEKLY_LAST_WEEKDAY, type WeekInfo, type WeeklySource, type WeeklySummary } from "./core";

export const SOURCE_LABELS: Record<WeeklySource, string> = {
  zam: "zam etkisi",
  nakit: "nakit planı",
  kasa: "kasa raporları",
  komisyon: "komisyon ve hakediş",
  "kasa-fiyat": "ModPOS fiyatları",
  zayi: "zayi ve ikram",
  stok: "stok sayımı",
  karaoke: "karaoke doluluğu",
  kontrol: "kontrol listeleri",
};

const dayOf = (d: string) => Number(d.slice(8, 10));
const monthOf = (d: string) => MONTH_NAMES[Number(d.slice(5, 7)) - 1];

/** "19–25 Ekim", "26 Ekim – 1 Kasım", "28 Aralık 2026 – 3 Ocak 2027" */
export function weekRangeText(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayOf(from)}–${dayOf(to)} ${monthOf(to)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${dayOf(from)} ${monthOf(from)} – ${dayOf(to)} ${monthOf(to)}`;
  return `${dayOf(from)} ${monthOf(from)} ${from.slice(0, 4)} – ${dayOf(to)} ${monthOf(to)} ${to.slice(0, 4)}`;
}

/** Geçen haftanın cirosu önceki haftaların ortalamasına göre: "önceki 4 haftaya göre %12 az", %2'den az farkta "aynı" */
export function trendText(last: number, avg: number): string {
  const d = avg > 0 ? (last - avg) / avg : 0;
  if (Math.abs(d) < 0.02) return "önceki 4 haftayla aynı";
  return `önceki 4 haftaya göre %${Math.round(Math.abs(d) * 100)} ${d < 0 ? "az" : "fazla"}`;
}

const SUBJECT_MAX = 150;
const QUIET = "bu hafta dikkat isteyen bir şey yok";

/**
 * Konu: "Haftalık özet: <ilk madde> · +4 madde"; maddesizse "Haftalık özet: bu hafta dikkat isteyen bir şey yok";
 * örnekte başta "Örnek · ". En çok 150 karakter: uzun başlık kısalır ("…"), madde sayısı kalır.
 */
export function subjectOf(s: Pick<WeeklySummary, "items">, sample = false): string {
  const head = `${sample ? "Örnek · " : ""}Haftalık özet: `;
  if (!s.items.length) return `${head}${QUIET}`;
  const tail = s.items.length > 1 ? ` · +${s.items.length - 1} madde` : "";
  let title = s.items[0].title;
  const room = SUBJECT_MAX - head.length - tail.length;
  if (title.length > room) title = `${title.slice(0, room - 1).trimEnd()}…`;
  return `${head}${title}${tail}`;
}

/** E-postanın başlığı */
export function headlineOf(s: Pick<WeeklySummary, "items">): string {
  return s.items.length ? `Bu hafta bakmanız gereken ${s.items.length} konu` : "Bu hafta dikkat isteyen bir şey yok";
}

/** "Bu hafta okunamadı: nakit planı, karaoke doluluğu."; okunamayan yoksa null */
export function failedText(failed: readonly WeeklySource[]): string | null {
  return failed.length ? `Bu hafta okunamadı: ${failed.map((f) => SOURCE_LABELS[f]).join(", ")}.` : null;
}

/**
 * Ödemeler › E-posta bildirimleri › Haftalık özet satırının durumu. `row`: bu haftanın gönderim kaydı
 * (notification_log "haftalik:<hafta>"); `weekSentAt`: haftalik.gecmis'teki bu haftanın gönderimi (kayıt silinse de
 * kalır); `lastSentAt`: son başarılı gönderim.
 */
export function weeklyStatusText(i: {
  enabled: boolean;
  week: WeekInfo;
  row: { ok: boolean; error: string | null; sentAt: string } | null;
  weekSentAt?: string | null;
  lastSentAt: string | null;
  now: number;
}): string {
  if (!i.enabled) return "Kapalı: pazartesi e-postası gitmez.";
  const state = claimStateOf(i.row, i.now);
  if (state === "sent") return `Bu hafta gönderildi · ${dateTimeTR(i.row!.sentAt)}`;
  if (i.weekSentAt) return `Bu hafta gönderildi · ${dateTimeTR(i.weekSentAt)}`;
  if (state === "retry") return i.week.weekday < WEEKLY_LAST_WEEKDAY ? "Bu hafta gönderilemedi; yarın sabah yeniden denenecek." : "Bu hafta gönderilemedi.";
  if (state === "busy") return "Bu haftaki özet şu an gönderiliyor.";
  if (state === "unknown") return "Bu haftaki gönderim yarıda kaldı; e-posta gelmediyse “Örneği bana gönder” ile alabilirsiniz.";
  return i.lastSentAt ? `Son gönderim ${dateTimeTR(i.lastSentAt)} · sıradaki pazartesi sabahı` : "Henüz gönderilmedi · ilk özet pazartesi sabahı gider";
}

/** "Yöneticilere gider: Okan, Ayşe." / "Etkin yönetici yok." */
export function recipientsText(names: readonly string[]): string {
  return names.length ? `Yöneticilere gider: ${names.join(", ")}.` : "Etkin yönetici yok.";
}
