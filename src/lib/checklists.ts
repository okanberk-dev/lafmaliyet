/**
 * Kontrol listeleri (fotoğraflı açılış / kapanış) için saf kurallar: iş günü ve saat aralığı, listenin durumu,
 * yanıtların özeti (eksik, aralık dışı, katkı verenler), metinler, kim doldurur ve kim görür, zil ve sabah e-postasının
 * kutusu. Veritabanı ve tarayıcı yok; saati hiçbir fonksiyon kendisi okumaz (an ve gün argümandır). Sunucu
 * (src/server/checklists/store.ts), sayfalar (src/app/panel/kontrol), Bugün ve zil bunu kullanır. Testler:
 * tests/kontrol-listeleri.test.ts; ayrıntı docs/KONTROL-LISTELERI.md.
 */

import type { DigestBox } from "@/server/notify/digest-template";

import { businessDate, DAY_TURN_HOUR } from "./cash-report";
import { num } from "./format";
import { KEEP_DAYS } from "./photo-rules";
import { addDays, longDateTR } from "./reminders";

// ---------------------------------------------------------------- Türler

/** Madde türü: tamam işareti, fotoğraf, sayı (sıcaklık gibi; aralık dışı not ister), kısa not */
export type ChecklistItemType = "check" | "photo" | "number" | "text";
export const ITEM_TYPES: readonly ChecklistItemType[] = ["check", "photo", "number", "text"];

export const ITEM_TYPE_LABEL: Record<ChecklistItemType, string> = {
  check: "Tamam işareti",
  photo: "Fotoğraf",
  number: "Sayı / sıcaklık",
  text: "Kısa not",
};

/** Listenin o günkü maddesi: liste ilk yanıtla açılırken şablondan kopyalanır, şablon sonradan değişse de kayıt aynı kalır */
export interface ChecklistItemSnap {
  id: number;
  label: string;
  type: ChecklistItemType;
  section: string | null;
  hint: string | null;
  required: boolean;
  unit: string | null;
  min: number | null;
  max: number | null;
}

/** Yanıtın değiştirilen önceki hâli (ilk aralık dışı ölçüm kaybolmasın) */
export interface ChecklistAnswerVersion {
  status: "ok" | "issue";
  value: number | null;
  textValue: string | null;
  note: string | null;
  /** O hâlde fotoğraf var mıydı */
  photo: boolean;
  by: string;
  /** ISO */
  at: string;
}

/** Bir maddenin yanıtı (ekranlara ve özete giden hâli; anlar ISO) */
export interface AnswerLite {
  id: number;
  itemId: number;
  status: "ok" | "issue";
  value: number | null;
  textValue: string | null;
  note: string | null;
  /** photos.id; saklama süresi dolup fotoğraf silinince null olur */
  photoId: number | null;
  /** Fotoğrafın çekildiği an: fotoğraf silinse de "çekildi" bilgisi kalır */
  photoAt: string | null;
  by: string;
  at: string;
  history: ChecklistAnswerVersion[];
}

/** Bir sorun: şu an aralık dışı / "Sorun var" (açık) ya da sonradan düzeltilmiş */
export interface IssueLite {
  answerId: number;
  itemId: number;
  label: string;
  /** "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)", "… 6 °C → 3,5 °C", "Buz makinesi: su kaçırıyor", "…: sorun giderildi" */
  text: string;
  /** Sorunun notu (açık sorunda şimdiki, düzeltilmişte sorun anındaki) */
  note: string | null;
  /** Sorunu bildiren ve anı */
  by: string;
  at: string;
  /** Şu an da sorun */
  open: boolean;
  /** Yanıtın önceki hâli sayısı: yeni bir ölçüm zil bildirimini yeniden açar */
  versions: number;
  /** range: sayı aralık dışı; issue: "Sorun var" */
  kind: "range" | "issue";
}

/** Bir listenin bir günkü kaydının özeti (runSummary) ve tamamlandığı an */
export interface RunLite {
  /** Zorunlu madde sayısı (anlık görüntüden) */
  required: number;
  /** Yanıtlanan zorunlu madde */
  done: number;
  /** Bütün zorunlu maddeler yanıtlandı (en az bir yanıtla) */
  complete: boolean;
  /** Zorunlu fotoğraflı maddelerden fotoğrafı çekilmemiş olan */
  photosLeft: number;
  /** Çekilen fotoğraf */
  photos: number;
  /** Yanıtsız zorunlu maddelerin adı, listedeki sırasıyla */
  missing: string[];
  issues: IssueLite[];
  /** Yanıt verenler, ilk yanıtlarının sırasıyla */
  contributors: string[];
  firstAt: string | null;
  lastAt: string | null;
  completedAt: string | null;
}

/** Bir günün bir listesi (Bugün, zil, sabah e-postası, Kontrol listeleri ekranı) */
export interface ChecklistLite {
  templateId: number;
  /** Kayıt varsa kaydın (açıldığı andaki) adı ve aralığı, yoksa şablonun */
  name: string;
  opensAt: string;
  dueAt: string;
  /** Zorunlu madde ve zorunlu fotoğraflı madde (kayıt yoksa şablonun bugünkü maddelerinden) */
  required: number;
  photos: number;
  staffAllowed: boolean;
  /** O günün kaydı (ilk yanıtla açılır); yoksa null */
  run: RunLite | null;
}

// ---------------------------------------------------------------- Sınırlar

/** İş gününün başı (dakika): kasa raporuyla aynı sınır, 05:00 */
export const DAY_START_MIN = DAY_TURN_HOUR * 60;
/** Fotoğraflar 60 gün saklanır (photo-rules KEEP_DAYS ile aynı sayı) */
export const KONTROL_PHOTO_DAYS = KEEP_DAYS.kontrol;
/** Başlamış liste yeni gün açıldıktan sonra da bu kadar dakika bitirilebilir (05:30'a kadar) */
export const ANSWER_GRACE_MIN = 30;
/** Aralık açılmadan bundan çok önce başlayan liste geçmişte "erken dolduruldu" olarak işaretlenir */
export const EARLY_SLACK_MIN = 60;
/** Saatlik çizelge (Tuvalet çizelgesi: 16 saat × 4 madde) sığsın diye 80 madde, 40 fotoğraflı madde */
export const MAX_ITEMS = 80;
export const MAX_PHOTO_ITEMS = 40;
/** Saatlik bölümün maddeleri bölümün saatinden bu kadar dakika önce açılır (10:00'ın maddeleri 09:50'de) */
export const SLOT_EARLY_MIN = 10;
/** Bir yanıtın en çok bu kadar önceki hâli saklanır (en eskisi düşer) */
export const MAX_HISTORY = 10;
/** Saat aralığı en az bu kadar dakika */
export const MIN_WINDOW_MIN = 15;
/** Not, kısa yazı ve madde adlarının sınırları */
export const NOTE_MAX = 300;
/** Fotoğraflı maddenin hatırlatması (fotoğraflar mekânın, insanların değil; docs/planlar/CRITIQUE2.md § 5) */
export const PHOTO_PRIVACY_HINT = "Fotoğrafta müşteri ya da çalışan görünmesin.";
/** Gün kapandıktan sonra gelen yanıtın reddi (doldurma ekranı bunu görünce sayfayı yeniler: yeni günün listesi açılır) */
export const DAY_CLOSED_TEXT = "Bu günün listesi kapandı; geçmiş günler sonradan doldurulamaz.";
/** Yanıtın maddesi kaydın anlık görüntüsünde yok ya da kayıt bekleneni tutmuyor (sayfa eski) */
export const LIST_CHANGED_TEXT = "Liste değişti; sayfayı yenileyin.";

const MIN_MS = 60_000;
const DAY_MIN = 24 * 60;
/** Türkiye UTC+3, yaz saati yok (panelin her yerindeki varsayım) */
const TR_OFFSET_MIN = 180;

// ---------------------------------------------------------------- Saat ve gün

/** "08:00" → 480 (dakika); biçim bozuksa null */
export function parseClock(v: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((v ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 480 → "08:00" */
export function clockText(min: number): string {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Saatin iş günündeki dakikası (05:00 → 0, 04:59 → 1439): gece yarısını geçen aralık böyle sıralanır */
export function businessMinuteOfClock(min: number): number {
  return (((min - DAY_START_MIN) % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

/** Açılış saatinin iş dakikası (geçersiz saat 0) */
export function opensMinute(opensAt: string): number {
  return businessMinuteOfClock(parseClock(opensAt) ?? DAY_START_MIN);
}

/** Son saatin iş dakikası: 05:00 günün sonudur (1440), aralık günün sonuna kadar sürebilir */
export function dueMinute(dueAt: string): number {
  const m = businessMinuteOfClock(parseClock(dueAt) ?? DAY_START_MIN);
  return m === 0 ? DAY_MIN : m;
}

/** Şimdinin iş dakikası (Türkiye saatiyle; 05:00 → 0) */
export function nowBusinessMinute(now: Date): number {
  const tr = (Math.floor(now.getTime() / MIN_MS) + TR_OFFSET_MIN) % DAY_MIN;
  return businessMinuteOfClock(tr);
}

/** Listenin günü: kasa raporunun iş günü (05:00'te döner; gece 01:30'da doldurulan kapanış önceki güne yazılır) */
export function checklistDay(now: Date): string {
  return businessDate(now);
}

/**
 * İş günü `day`'in bir saatindeki an: 05:00'ten önceki saat ertesi takvim gününe düşer (kapanışın 02:00'si). `end`:
 * son saat olarak okunur (05:00 günün sonu, ertesi gün 05:00).
 */
export function clockInstant(day: string, clock: string, end = false): Date {
  const start = Date.parse(`${day}T00:00:00Z`) + (DAY_START_MIN - TR_OFFSET_MIN) * MIN_MS;
  return new Date(start + (end ? dueMinute(clock) : opensMinute(clock)) * MIN_MS);
}

// ---------------------------------------------------------------- Saatlik bölümler

/**
 * Bölüm adı bir saatle başlıyorsa ("10:00", "13:00 öğle") bölüm saatliktir: maddeleri o saatten SLOT_EARLY_MIN dakika
 * önce açılır, daha önce işaretlenemez (Tuvalet çizelgesi: her saat imza ve fotoğraf; bir kişi 10:00'da bütün günü
 * dolduramasın). Saat yoksa null.
 */
export function sectionSlot(section: string | null | undefined): string | null {
  const m = /^\s*([01]\d|2[0-3]):([0-5]\d)(?!\d)/.exec(section ?? "");
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Saatlik bölümün açıldığı an (saatten SLOT_EARLY_MIN önce); saatlik değilse null */
export function slotOpensInstant(day: string, section: string | null | undefined): Date | null {
  const slot = sectionSlot(section);
  return slot ? new Date(clockInstant(day, slot).getTime() - SLOT_EARLY_MIN * MIN_MS) : null;
}

/** Saatlik bölümün maddeleri henüz işaretlenemez mi (bölümün saati gelmedi) */
export function slotLocked(day: string, section: string | null | undefined, now: Date): boolean {
  const at = slotOpensInstant(day, section);
  return at !== null && now.getTime() < at.getTime();
}

/** Saati gelmemiş bölüme yanıtın reddi */
export function slotLockedText(section: string | null | undefined): string {
  return `Bu bölüm saat ${sectionSlot(section) ?? ""} olunca açılır; saati gelmeden işaretlenemez.`;
}

/** Saat aralığının hatası (Listeleri düzenle ekranının metinleri); geçerliyse null */
export function windowError(opensAt: string, dueAt: string): string | null {
  if (parseClock(opensAt) === null || parseClock(dueAt) === null) return "Saati 08:00 biçiminde yazın";
  const open = opensMinute(opensAt);
  const due = dueMinute(dueAt);
  if (due <= open) return "Son saat başlangıçtan sonra olmalı (gün 05:00'te döner)";
  if (due - open < MIN_WINDOW_MIN) return "Aralık en az 15 dakika olmalı";
  return null;
}

/** "2026-10-22" → 1 (Pazartesi) … 7 (Pazar) */
export function weekdayOf(day: string): number {
  const d = new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
  return d === 0 ? 7 : d;
}

export const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;

/** Haftanın seçili günleri: "Her gün", "Hafta içi", "Hafta sonu" ya da "Pzt, Çar, Cum" */
export function weekdaysText(days: number[]): string {
  const set = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (set.length === 7) return "Her gün";
  if (set.join() === "1,2,3,4,5") return "Hafta içi";
  if (set.join() === "6,7") return "Hafta sonu";
  if (!set.length) return "Hiçbir gün";
  return set.map((d) => WEEKDAY_SHORT[d - 1]).join(", ");
}

/** Şablonun bir güne uygulanıp uygulanmadığına bakılan alanları (anlar ISO) */
export interface TemplateTiming {
  weekdays: number[];
  opensAt: string;
  activeFrom: string;
  inactiveFrom: string | null;
}

/**
 * Liste o gün bekleniyor mu: haftanın günü seçili ve liste o günün aralığı açılırken etkindi. Gün içinde eklenen ya da
 * yeniden açılan liste, aralığı çoktan açılmışsa o gün beklenmez (bugün eklenen Açılış "gecikti" demez; akşamki
 * Kapanış beklenir). Geçmiş günler için de aynı kural: eski bir günde liste etkin değilse o gün "yapılmadı" yazılmaz.
 */
export function appliesOn(t: TemplateTiming, day: string): boolean {
  if (!t.weekdays.includes(weekdayOf(day))) return false;
  const open = clockInstant(day, t.opensAt).getTime();
  return Date.parse(t.activeFrom) < open && (t.inactiveFrom === null || Date.parse(t.inactiveFrom) > open);
}

/**
 * Liste [from, to] arasında, haftanın seçili bir gününde aralığı açıldı mı (sınırlar dahil: tam açılışta kapatılan ya
 * da açılan liste o gün beklenmez). Bir haftadan uzun aralıkta seçili her günün açılışı geçmiştir.
 */
export function openedBetween(t: Pick<TemplateTiming, "weekdays" | "opensAt">, from: Date, to: Date): boolean {
  if (to.getTime() < from.getTime()) return false;
  if (to.getTime() - from.getTime() >= 7 * DAY_MIN * MIN_MS) return t.weekdays.some((d) => d >= 1 && d <= 7);
  for (let day = businessDate(from); day <= businessDate(to); day = addDays(day, 1)) {
    if (!t.weekdays.includes(weekdayOf(day))) continue;
    const open = clockInstant(day, t.opensAt).getTime();
    if (open >= from.getTime() && open <= to.getTime()) return true;
  }
  return false;
}

/**
 * Etkinlik değişince yazılacak anlar (Listeler'deki anahtar ve listenin sayfası). Kapanan liste o andan beklenmez.
 * Açılan liste o andan beklenir (bugünün aralığı geçtiyse yarından); ama kapalıyken hiçbir günün aralığı açılmadıysa
 * (anahtara yanlışlıkla dokunulup hemen geri açıldı) kapanış hiç olmamış sayılır: eski başlangıç kalır, bugünün
 * listesi ve geçmişteki "yapılmadı"lar yerinde kalır. Saat ve günler `next`ten (aynı kayıtta değişebilirler; günlere
 * hep şimdiki kuralla bakılır).
 */
export function activityChange(
  prev: { active: boolean; inactiveFrom: Date | null },
  next: { active: boolean; weekdays: number[]; opensAt: string },
  now: Date,
): { active?: boolean; activeFrom?: Date; inactiveFrom?: Date | null } {
  if (prev.active === next.active) return {};
  if (!next.active) return { active: false, inactiveFrom: now };
  if (prev.inactiveFrom && !openedBetween(next, prev.inactiveFrom, now)) return { active: true, inactiveFrom: null };
  return { active: true, activeFrom: now, inactiveFrom: null };
}

/** Bugün olmayan listenin nedeni (yönetici ekranında): pasif, haftanın günü seçili değil ya da bugünün aralığından sonra eklendi */
export function absentReason(t: TemplateTiming & { active: boolean }, day: string): string | null {
  if (!t.active) return "pasif";
  if (!t.weekdays.includes(weekdayOf(day))) return weekdaysText(t.weekdays);
  if (!appliesOn(t, day)) return "yarından";
  return null;
}

/** Türkiye saati "09:12" (ISO andan) */
export function timeTR(iso: string): string {
  return new Date(Date.parse(iso) + TR_OFFSET_MIN * MIN_MS).toISOString().slice(11, 16);
}

// ---------------------------------------------------------------- Madde ve yanıt

/** Sayının yazımı: en çok iki ondalık, Türkçe virgül ("3,5", "-18") */
const numText = (v: number) => num(v, 2);

/** İzin verilen aralık: "0–4 °C", "-30 – -18 °C", "en az 0 °C", "en çok 4 °C"; sınır yoksa boş */
export function rangeText(i: Pick<ChecklistItemSnap, "min" | "max" | "unit">): string {
  const unit = i.unit?.trim() ? ` ${i.unit.trim()}` : "";
  if (i.min !== null && i.max !== null) {
    // Eksi sayılar arasında boşluklu tire: "-30–-18" okunmaz
    const sep = i.min < 0 || i.max < 0 ? " – " : "–";
    return `${numText(i.min)}${sep}${numText(i.max)}${unit}`;
  }
  if (i.min !== null) return `en az ${numText(i.min)}${unit}`;
  if (i.max !== null) return `en çok ${numText(i.max)}${unit}`;
  return "";
}

/** Değer ve birimi: "3,5 °C" */
export function valueText(i: Pick<ChecklistItemSnap, "unit">, v: number): string {
  return `${numText(v)}${i.unit?.trim() ? ` ${i.unit.trim()}` : ""}`;
}

/** Değer izin verilen aralıkta mı (sınırlar dahil; sınırı olmayan madde hep aralıkta) */
export function inRange(i: Pick<ChecklistItemSnap, "min" | "max">, v: number): boolean {
  return (i.min === null || v >= i.min) && (i.max === null || v <= i.max);
}

/**
 * Yazılan ölçüm: "3,5", "3.5", "-18", "−18" (yazım eksisi). `negative`: alan sabit "−" önekli (dondurucu: iOS'un
 * ondalık klavyesinde eksi yok), yazılan artı sayı eksi saklanır. Okunamazsa null.
 */
export function parseReading(raw: string, negative = false): number | null {
  const s = raw.trim().replace(/[−‒–—]/g, "-").replace(/\s+/g, "");
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(s)) return null;
  const v = Number(s.replace(",", "."));
  if (!Number.isFinite(v)) return null;
  return negative && v > 0 ? -v : v;
}

/** Bir maddenin ölçüm alanı eksi değeri nasıl alır: sabit "−" öneki, "±" düğmesi ya da yok */
export function signMode(i: Pick<ChecklistItemSnap, "min" | "max">): "negative" | "toggle" | "none" {
  if (i.max !== null && i.max <= 0) return "negative";
  if (i.min !== null && i.min < 0) return "toggle";
  return "none";
}

/** Yanıtın içeriği (sürüm karşılaştırması) */
export type AnswerContent = Pick<AnswerLite, "status" | "value" | "textValue" | "note" | "photoId">;

export function sameAnswer(a: AnswerContent, b: AnswerContent): boolean {
  return a.status === b.status && a.value === b.value && a.textValue === b.textValue && a.note === b.note && a.photoId === b.photoId;
}

/** Yanıt değişince önceki hâli sürümlere eklenir (en çok MAX_HISTORY, en eskisi düşer); değişmediyse sürümler aynı */
export function nextVersions(prev: (AnswerContent & Pick<AnswerLite, "photoAt" | "by" | "at" | "history">) | null, next: AnswerContent): ChecklistAnswerVersion[] {
  if (!prev) return [];
  if (sameAnswer(prev, next)) return prev.history;
  const version: ChecklistAnswerVersion = {
    status: prev.status,
    value: prev.value,
    textValue: prev.textValue,
    note: prev.note,
    photo: prev.photoAt !== null,
    by: prev.by,
    at: prev.at,
  };
  return [...prev.history, version].slice(-MAX_HISTORY);
}

/**
 * Fotoğraflı maddenin önceki hâli (geçmiş): bir kayıt ya fotoğrafı yeniden çeker (not aynı kalır) ya da notu değiştirir
 * (fotoğraf aynı kalır). Sonraki hâlle notu aynıysa fotoğraf değişmiştir ("Başka bir fotoğraf"); değilse aynı
 * fotoğrafın o zamanki notu (yoksa "notsuz").
 */
export function photoVersionText(v: Pick<ChecklistAnswerVersion, "photo" | "note">, next: { note: string | null }): string {
  if (!v.photo) return "Fotoğrafsız";
  if ((v.note ?? null) === (next.note ?? null)) return "Başka bir fotoğraf";
  return v.note ? "Aynı fotoğraf" : "Aynı fotoğraf, notsuz";
}

/** Madde yanıtlanmış sayılır mı: fotoğraflı maddede fotoğraf çekilmiş olmalı (silinse de çekildi sayılır) */
export function isAnswered(item: Pick<ChecklistItemSnap, "type">, a: Pick<AnswerLite, "photoAt"> | null | undefined): boolean {
  if (!a) return false;
  return item.type === "photo" ? a.photoAt !== null : true;
}

/** Sorunun metni (zil, Bugün, e-posta, geçmiş) */
function issueOf(item: ChecklistItemSnap, a: AnswerLite): IssueLite | null {
  const base = { answerId: a.id, itemId: item.id, label: item.label, versions: a.history.length };
  const range = rangeText(item);
  if (a.status === "issue") {
    if (item.type === "number" && a.value !== null) {
      return { ...base, kind: "range", open: true, note: a.note, by: a.by, at: a.at, text: `${item.label}: ${valueText(item, a.value)}${range ? ` (${range})` : ""}` };
    }
    return { ...base, kind: "issue", open: true, note: a.note, by: a.by, at: a.at, text: `${item.label}: ${a.note?.trim() || "sorun"}` };
  }
  // Düzeltilmiş: şimdi tamam ama önceki bir hâli sorundu (ilk sorunlu hâli yazılır)
  const first = a.history.find((v) => v.status === "issue");
  if (!first) return null;
  if (item.type === "number" && first.value !== null && a.value !== null) {
    return { ...base, kind: "range", open: false, note: first.note, by: first.by, at: first.at, text: `${item.label}: ${valueText(item, first.value)} → ${valueText(item, a.value)}` };
  }
  return { ...base, kind: "issue", open: false, note: first.note, by: first.by, at: first.at, text: `${item.label}: sorun giderildi` };
}

/**
 * Kaydın özeti, anlık görüntüdeki maddelere göre: zorunlu ve yanıtlanan madde, kalan fotoğraf, eksikler (sırasıyla),
 * sorunlar (açık ve düzeltilmiş), yanıt verenler (ilk yanıtlarının sırasıyla), ilk ve son yanıt. İsteğe bağlı maddeler
 * tamamlanmayı bekletmez. Anlık görüntüde olmayan maddenin yanıtı sayılmaz.
 */
export function runSummary(items: ChecklistItemSnap[], answers: AnswerLite[], completedAt: string | null = null): RunLite {
  const byItem = new Map(answers.map((a) => [a.itemId, a]));
  const known = new Set(items.map((i) => i.id));
  const mine = answers.filter((a) => known.has(a.itemId));
  const required = items.filter((i) => i.required);
  const doneItems = required.filter((i) => isAnswered(i, byItem.get(i.id)));
  const issues = items
    .flatMap((i) => {
      const a = byItem.get(i.id);
      const issue = a ? issueOf(i, a) : null;
      return issue ? [issue] : [];
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const timeline = mine.flatMap((a) => [...a.history.map((v) => ({ by: v.by, at: v.at })), { by: a.by, at: a.at }]).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const contributors = [...new Set(timeline.map((t) => t.by))];
  const lastAt = mine.length ? mine.map((a) => a.at).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)! : null;
  return {
    required: required.length,
    done: doneItems.length,
    complete: mine.length > 0 && doneItems.length >= required.length,
    photosLeft: required.filter((i) => i.type === "photo" && !isAnswered(i, byItem.get(i.id))).length,
    photos: mine.filter((a) => a.photoAt !== null).length,
    missing: required.filter((i) => !isAnswered(i, byItem.get(i.id))).map((i) => i.label),
    issues,
    contributors,
    firstAt: timeline[0]?.at ?? null,
    lastAt,
    completedAt,
  };
}

/** Bir listenin anlık durumu */
export type ListState = "before" | "open" | "overdue" | "done" | "missed";

/** Listede yanıt var mı (kayıt açılıp bütün yanıtları geri alınmış liste başlamamış sayılır) */
export function isStarted(l: Pick<ChecklistLite, "run">): boolean {
  return Boolean(l.run && l.run.lastAt !== null);
}

/**
 * Listenin durumu: tamamsa "done"; geçmiş günse "missed"; başladıysa son saatten önce "open", sonra "overdue";
 * başlamadıysa açılıştan önce "before", aralıkta "open", sonra "overdue". Aralık yalnız durumu belirler: liste günün
 * her saatinde doldurulabilir.
 */
export function listState(l: Pick<ChecklistLite, "opensAt" | "dueAt" | "run">, nowBm: number, isPastDay: boolean): ListState {
  if (l.run?.complete) return "done";
  if (isPastDay) return "missed";
  const due = dueMinute(l.dueAt);
  if (isStarted(l)) return nowBm >= due ? "overdue" : "open";
  if (nowBm < opensMinute(l.opensAt)) return "before";
  return nowBm < due ? "open" : "overdue";
}

/** İlk yanıt aralığın açılışından bir saatten çok önce mi (geçmişte "Erken dolduruldu") */
export function earlyStart(run: { date: string; opensAt: string; firstAt: string | null }): boolean {
  return run.firstAt !== null && Date.parse(run.firstAt) < clockInstant(run.date, run.opensAt).getTime() - EARLY_SLACK_MIN * MIN_MS;
}

/** Son saatten sonra mı tamamlandı */
export function lateFinish(run: { date: string; dueAt: string; completedAt: string | null }): boolean {
  return run.completedAt !== null && Date.parse(run.completedAt) > clockInstant(run.date, run.dueAt, true).getTime();
}

/** Şablonun maddelerinden günün anlık görüntüsü: etkin maddeler sırasıyla; fotoğraf deposu yoksa fotoğraflı maddeler çıkar */
export function snapshotItems(
  items: (ChecklistItemSnap & { active: boolean; sortOrder: number })[],
  opts: { photos: boolean },
): ChecklistItemSnap[] {
  return items
    .filter((i) => i.active && (opts.photos || i.type !== "photo"))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map(({ id, label, type, section, hint, required, unit, min, max }) => ({ id, label, type, section, hint, required, unit, min, max }));
}

/** Maddeler bölümlerine göre: bölümsüzler önce, sonra bölümler ilk göründükleri sırayla */
export function groupBySection<T extends { section: string | null }>(items: T[]): { section: string | null; items: T[] }[] {
  const groups: { section: string | null; items: T[] }[] = [];
  const loose = items.filter((i) => !i.section?.trim());
  if (loose.length) groups.push({ section: null, items: loose });
  for (const i of items) {
    const s = i.section?.trim();
    if (!s) continue;
    const g = groups.find((x) => x.section === s);
    if (g) g.items.push(i);
    else groups.push({ section: s, items: [i] });
  }
  return groups;
}

// ---------------------------------------------------------------- Metin

/** "Açılış" → "Açılış listesi"; adında "liste" ya da "çizelge" geçen ad olduğu gibi kalır */
export function listTitle(name: string): string {
  return /liste|çizelge/.test(name.toLocaleLowerCase("tr-TR")) ? name : `${name} listesi`;
}

/** İlk harf küçük (Türkçe: "İçecek" → "içecek") */
export function lowerFirst(s: string): string {
  return `${s.charAt(0).toLocaleLowerCase("tr-TR")}${s.slice(1)}`;
}

/** "Ayşe", "Ayşe ve Mehmet", "Ayşe, Mehmet ve Can", "Ayşe, Mehmet ve 2 kişi" */
export function whoText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ve ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} ve ${names[2]}`;
  return `${names[0]}, ${names[1]} ve ${names.length - 2} kişi`;
}

/** "{n} madde, {p} fotoğraflı" (fotoğraflı madde yoksa yalnız madde sayısı) */
export function itemsText(l: Pick<ChecklistLite, "required" | "photos">): string {
  return `${num(l.required)} madde${l.photos > 0 ? `, ${num(l.photos)} fotoğraflı` : ""}`;
}

/** Bugün'deki kısaltmayla aynı kural: en çok `max` karakter, kısalınca sonuna "…" */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

// ---------------------------------------------------------------- Yetki

/**
 * Bu güne yanıt verilebilir mi: yalnız bugün (iş günü). Geçmiş gün sonradan doldurulamaz (yönetici de); yalnız açılmış
 * (yanıtı olan) bir kayıt yeni gün açıldıktan sonra 30 dakika daha bitirilebilir (05:01'de biten kapanış kaybolmasın).
 */
export function canAnswerDay(date: string, now: Date, runExists: boolean): boolean {
  const today = businessDate(now);
  if (date === today) return true;
  return runExists && date === addDays(today, -1) && nowBusinessMinute(now) < ANSWER_GRACE_MIN;
}

/** Personelin geçmişi: bugün dahil son 7 iş günü (amaç "dün gece ne oldu"; KVKK veri azaltımı, dalga 10 §2.5) */
export const STAFF_HISTORY_DAYS = 7;
/** Yöneticinin geçmişinde bir sayfadaki gün */
export const HISTORY_PAGE_DAYS = 14;

/** Personelin görebildiği ilk gün (bugün dahil son 7 gün): 22 Ekim → 16 Ekim */
export function staffHistoryFloor(today: string): string {
  return addDays(today, -(STAFF_HISTORY_DAYS - 1));
}

/**
 * Personel bu listenin bu günkü kaydını görür mü: liste "Personel doldurabilir" olmalı ve gün listenin personele
 * açıldığı iş gününden eski olmamalı (`staffSince` boş: baştan beri açık). Yöneticinin listesi personele açılınca eski
 * kayıtları (yöneticinin notları, fotoğrafları) görünmez.
 */
export function staffSeesRun(t: { staffAllowed: boolean; staffSince: string | null }, runDate: string): boolean {
  return t.staffAllowed && (!t.staffSince || runDate >= businessDate(new Date(t.staffSince)));
}

/** "Personel doldurabilir" kapalıyken açılınca o an yazılır (yeni liste: `prev` false); öteki geçişler yazmaz */
export function staffSinceChange(prev: boolean, next: boolean, now: Date): { staffSince?: Date } {
  return !prev && next ? { staffSince: now } : {};
}

/** Geçmiş ekranının görünümü: bir günün ayrıntısı ya da günler listesi (`older`: "Daha eski günler"in bitişi) */
export type HistoryRange =
  | { kind: "day"; day: string; prev: string | null; next: string | null }
  | { kind: "days"; from: string; to: string; older: string | null };

/** "2026-10-22" biçiminde gerçek bir gün mü ("2026-13-01" ve "2026-02-30" değil) */
function isDayText(v: string | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/**
 * Kontrol geçmişinin aralığı (?gun=, ?bitis=). Yönetici: ilk kayıttan bugüne, 14 günlük sayfalar, "Daha eski günler";
 * ayrıntı ilk günden bugüne. Personel: bugün dahil son 7 gün, daha eskisi yok; ?bitis= yok sayılır, pencere dışı ya da
 * bozuk ?gun= 7 günlük listeye döner. Pencere sunucuda uygulanır; fotoğraf yolu aynı sınırı kullanır (photoAccess).
 */
export function historyRange(i: { role: "admin" | "staff"; today: string; first: string; gun?: string; bitis?: string }): HistoryRange {
  const staff = i.role !== "admin";
  const floor = staff && staffHistoryFloor(i.today) > i.first ? staffHistoryFloor(i.today) : i.first;
  const gun = isDayText(i.gun) ? i.gun : undefined;
  if (gun && gun <= i.today && (!staff || gun >= floor)) {
    const prev = addDays(gun, -1);
    const next = addDays(gun, 1);
    return { kind: "day", day: gun, prev: prev >= floor ? prev : null, next: next <= i.today ? next : null };
  }
  if (staff) return { kind: "days", from: floor, to: i.today, older: null };
  const bitis = isDayText(i.bitis) ? i.bitis : undefined;
  const to = bitis && bitis <= i.today ? bitis : i.today;
  const start = addDays(to, -(HISTORY_PAGE_DAYS - 1));
  const from = start < floor ? floor : start;
  return { kind: "days", from, to, older: from > floor ? addDays(from, -1) : null };
}

/**
 * Kontrol fotoğrafını kim görür: yönetici hepsini; personel yalnız personelin doldurduğu bir listenin son 7 gündeki
 * (iş günü, bugün dahil) kaydındaki fotoğrafı, liste personele açıldıktan sonraki günlerden; bir yanıta bağlı olmayan
 * fotoğrafı yalnız yükleyen. Fotoğraf yolunun ilk adımları (süresi dolan hayır, yönetici evet, yükleyen bağlanmamışı
 * görür) src/lib/photo-rules.ts photoViewDecision'da.
 */
export function photoAccess(i: {
  role: "admin" | "staff";
  userId: number;
  createdBy: number | null;
  run: { date: string; staffAllowed: boolean; staffSince?: string | null } | null;
  now: Date;
}): boolean {
  if (i.role === "admin") return true;
  if (!i.run) return i.createdBy !== null && i.createdBy === i.userId;
  return i.run.date >= staffHistoryFloor(businessDate(i.now)) && staffSeesRun({ staffAllowed: i.run.staffAllowed, staffSince: i.run.staffSince ?? null }, i.run.date);
}

// ---------------------------------------------------------------- Zil

/** Zilin bir satırı (src/server/actions/notifications.ts PanelNotification'a "kontrol" grubuyla çevrilir) */
export interface BellLite {
  id: string;
  kind: "danger" | "warning" | "info";
  title: string;
  body: string;
  timeLabel: string;
  unread: boolean;
  href: string;
}

/** Zildeki sorun satırlarının sınırı (en yenileri) */
export const BELL_ISSUES = 5;

/** "{a} / {n} madde" ya da başlamadıysa `none` */
function progressText(l: ChecklistLite, none: string): string {
  return isStarted(l) && l.run ? `${num(l.run.done)} / ${num(l.run.required)} madde` : none;
}

/**
 * Zil: yöneticiye bugün son saati geçen liste ("gecikti"), dün tamamlanmayan liste ("Dünkü … eksik") ve bugünün ve
 * dünün açık sorunları (aralık dışı ölçüm kırmızı, "Sorun var" turuncu; en yeni 5). Personele yalnız bugün, aralığı
 * açılan liste: açıkken "bekliyor" (bilgi, sessiz), son saat geçince "gecikti" (okunmamış). Kimlikler günü, listeyi ve
 * yanıtın sürüm sayısını taşır: yeni bir ölçüm bildirimi yeniden açar. Tutar, fotoğraf adresi yok.
 */
export function checklistBell(i: {
  role: "admin" | "staff";
  now: Date;
  today: { day: string; lists: ChecklistLite[] } | null;
  yesterday?: { day: string; lists: ChecklistLite[] } | null;
}): BellLite[] {
  const out: BellLite[] = [];
  const nowBm = nowBusinessMinute(i.now);
  const today = i.today;
  if (i.role !== "admin") {
    for (const l of today?.lists ?? []) {
      if (!l.staffAllowed) continue;
      const state = listState(l, nowBm, false);
      if (state !== "open" && state !== "overdue") continue;
      // Önceden başlanan liste "açık" sayılır; zil yine de aralık açılmadan "bekliyor" demez
      if (state === "open" && nowBm < opensMinute(l.opensAt)) continue;
      const late = state === "overdue";
      out.push({
        id: `kontrol-${late ? "gecikti" : "bekliyor"}-${l.templateId}-${today!.day}`,
        kind: late ? "warning" : "info",
        title: `${listTitle(l.name)} ${late ? "gecikti" : "bekliyor"}`,
        body: `Son saat ${l.dueAt} · ${progressText(l, `0 / ${num(l.required)} madde`)}`,
        timeLabel: "Bugün",
        unread: late,
        href: `/panel/kontrol/${l.templateId}`,
      });
    }
    return out;
  }
  for (const l of today?.lists ?? []) {
    if (listState(l, nowBm, false) !== "overdue") continue;
    out.push({
      id: `kontrol-gecikti-${l.templateId}-${today!.day}`,
      kind: "warning",
      title: `${listTitle(l.name)} gecikti`,
      body: `Son saat ${l.dueAt} · ${progressText(l, "başlanmadı")}`,
      timeLabel: "Bugün",
      unread: true,
      href: `/panel/kontrol/${l.templateId}`,
    });
  }
  const y = i.yesterday;
  for (const l of y?.lists ?? []) {
    if (l.run?.complete) continue;
    out.push({
      id: `kontrol-eksik-${l.templateId}-${y!.day}`,
      kind: "warning",
      title: `Dünkü ${lowerFirst(listTitle(l.name))} eksik`,
      body: `${longDateTR(y!.day)} · ${progressText(l, "hiç açılmadı")}`,
      timeLabel: "Dün",
      unread: true,
      href: `/panel/kontrol/gecmis?gun=${y!.day}`,
    });
  }
  const issues = [
    ...(today?.lists ?? []).flatMap((l) => (l.run?.issues ?? []).map((x) => ({ x, l, day: today!.day, label: "Bugün" }))),
    ...(y?.lists ?? []).flatMap((l) => (l.run?.issues ?? []).map((x) => ({ x, l, day: y!.day, label: "Dün" }))),
  ]
    .filter(({ x }) => x.open)
    .sort((a, b) => Date.parse(b.x.at) - Date.parse(a.x.at))
    .slice(0, BELL_ISSUES);
  for (const { x, l, day, label } of issues) {
    out.push({
      id: `kontrol-sorun-${x.answerId}-v${x.versions}`,
      kind: x.kind === "range" ? "danger" : "warning",
      title: x.kind === "range" ? x.text : `${x.label}: sorun`,
      body: clip(`${listTitle(l.name)} · ${x.by} ${timeTR(x.at)}${x.note?.trim() ? ` · Not: ${x.note.trim()}` : ""}`, 120),
      timeLabel: label,
      unread: true,
      href: `/panel/kontrol/gecmis?gun=${day}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Sabah e-postası

/** E-postadaki sorun satırlarının sınırı */
export const DIGEST_PROBLEMS = 5;

/** Tamamlanmayan liste: "3 / 12 madde; yapılmayan: A, B, C ve 2 madde daha" ya da "hiç açılmadı" */
function missingText(l: ChecklistLite): string {
  if (!isStarted(l) || !l.run) return "hiç açılmadı";
  const first = l.run.missing.slice(0, 3).join(", ");
  const rest = l.run.missing.length - 3;
  return `${num(l.run.done)} / ${num(l.run.required)} madde; yapılmayan: ${first}${rest > 0 ? ` ve ${num(rest)} madde daha` : ""}`;
}

/** E-postadaki sorun satırı: açıkta bildireni ve notu, düzeltilmişte "(düzeltildi)" */
function problemText(x: IssueLite): string {
  if (!x.open) return x.kind === "range" ? `${x.text} (düzeltildi)` : x.text;
  const note = x.note?.trim() ? `${x.by}: ${x.note.trim()}` : x.by;
  return x.kind === "range" ? `${x.text} · ${note}` : `${x.label}: sorun · ${note}`;
}

/**
 * Sabah e-postasının kontrol kutusu (docs/planlar/CRITIQUE2.md R11): dünün (iş günü) tamamlanmayan listeleri ve
 * sorunları (açık ve düzeltilmiş; en çok 5, fazlası "ve 3 kayıt daha"). O gün kasa raporu da yoksa "kafe kapalıysa
 * önemsemeyin" notu. Eksik ve sorun yoksa kutu yok. Bağlantı yalnız panelin geçmiş ekranına; fotoğraf adresi asla.
 */
export function kontrolDigestBox(day: string, lists: ChecklistLite[], cashMissing: boolean): DigestBox | null {
  const missing = lists.filter((l) => !l.run?.complete);
  const problems = lists.flatMap((l) => l.run?.issues ?? []).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!missing.length && !problems.length) return null;
  const lines: DigestBox["lines"] = [
    ...missing.map((l) => ({ strong: listTitle(l.name), text: missingText(l) })),
    ...problems.slice(0, DIGEST_PROBLEMS).map((x) => ({ text: problemText(x), tone: x.open ? ("bad" as const) : ("warn" as const) })),
  ];
  if (problems.length > DIGEST_PROBLEMS) lines.push({ text: `ve ${num(problems.length - DIGEST_PROBLEMS)} kayıt daha`, tone: "muted" });
  if (cashMissing) lines.push({ text: "Dün kasa raporu da girilmedi; kafe kapalıysa bu bölümü önemsemeyin.", tone: "muted" });
  const subjectPart = missing.length === 1
    ? `dünkü ${lowerFirst(listTitle(missing[0].name))} eksik`
    : missing.length > 1
      ? `dünkü ${num(missing.length)} kontrol listesi eksik`
      : problems.some((x) => x.kind === "range")
        ? "kontrol listesinde aralık dışı değer"
        : "kontrol listesinde sorun";
  return {
    title: `Kontrol listeleri · ${longDateTR(day)}`,
    lines,
    href: `/panel/kontrol/gecmis?gun=${day}`,
    link: "Kontrol geçmişi",
    subjectPart,
    headline: missing.length ? "Dünkü kontrol listelerinde eksik var" : "Dünkü kontrol listelerinde sorun var",
  };
}

// ---------------------------------------------------------------- Bugün

/**
 * Bugün ekranının kendiliğinden yenileneceği anlar (epoch ms): bugünün listelerinin açılış ve son saatleri (satır
 * 08:00'de "Yapılacak", 11:00'de "Gecikti" olsun). Tekrar edenler bir kez.
 */
export function checklistBoundaries(c: { day: string; lists: ChecklistLite[] } | null | undefined): number[] {
  if (!c) return [];
  return [...new Set(c.lists.flatMap((l) => [clockInstant(c.day, l.opensAt).getTime(), clockInstant(c.day, l.dueAt, true).getTime()]))];
}
