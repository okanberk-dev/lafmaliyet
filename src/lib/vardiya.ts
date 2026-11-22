import { z } from "zod";

import { addDays, isCalendarDate } from "@/lib/reminders";

/**
 * Vardiya planı: saf kurallar ve metinler (ekran, sunucu eylemi, PDF ve testler paylaşır; tests/vardiya.test.ts).
 * Operatör, 22 Kasım 2026: "ladmine de vardiya ayarlama diye ayrı sekme yap ve yazınca otomatik pdf olarak çıkarsın
 * ayarlayıp sonra düzenlenebilir olsun". Yönetici haftayı (Pazartesi–Pazar) kişi × gün ızgarasına yazar: hücre "10-18"
 * gibi serbest metindir, burada vardiyaya çevrilir; kaydedilen plan her zaman yeniden açılıp düzenlenir ve PDF'i
 * (src/server/vardiya/pdf.ts) kaydedilen plandan her istekte yeniden çizilir. Ayrıntı: docs/VARDIYA.md.
 */

export const VARDIYA_PATH = "/panel/vardiya";
export const VARDIYA_PDF_PATH = "/api/vardiya/pdf";

/** Vardiya en geç ertesi gün 06:00'da biter (günün başından dakika) */
export const SHIFT_MAX_END_MIN = 1800;
/** Tek vardiya en çok bu kadar sürer: "18-17" gibi yazım hatası 23 saatlik vardiya olmasın */
export const SHIFT_MAX_MINUTES = 16 * 60;
export const SHIFT_NOTE_MAX = 40;
export const SHIFT_NAME_MAX = 60;
/** Bir haftanın planında en çok bu kadar kişi */
export const SHIFT_PEOPLE_MAX = 60;

/** Bir kişinin bir günü: çalışıyor (saatler, isteğe bağlı görev notu) ya da izinli; planlanmadıysa null */
export type ShiftCell = { kind: "work"; startMin: number; endMin: number; note: string | null } | { kind: "off"; note: string | null };

export type ParsedCell = { ok: true; cell: ShiftCell | null } | { ok: false; error: string };

export const SHIFT_TEXT = {
  format: "Saatleri “10-18” ya da “10:30-18:00” gibi yazın; izin için “izin”.",
  hour: "Saat 00–23 arasında olmalı (bitiş için 24 de yazılır).",
  minute: "Dakika 00–59 arasında olmalı.",
  same: "Bitiş başlangıçla aynı olamaz.",
  late: "Vardiya en geç ertesi gün 06:00'da biter.",
  long: "Vardiya 16 saatten uzun olamaz; saatleri kontrol edin.",
  note: `Not en çok ${SHIFT_NOTE_MAX} karakter.`,
} as const;

const two = (n: number) => String(n).padStart(2, "0");
const fold = (v: string) => v.toLocaleLowerCase("tr-TR");

/** "10", "10:30", "10.30", "1030" (saat ve isteğe bağlı dakika); araya tire, sonuna isteğe bağlı not */
const WORK_RE = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.]?(\d{2}))?(?:\s+(.*))?$/;
const OFF_RE = /^(izinli|izin|off|tatil|x)(?:\s+(.*))?$/;

/** Notun başındaki ayraç ("· kasa", ", kasa") atılır; boşsa null */
function cleanNote(raw: string | undefined): string | null {
  const note = (raw ?? "").replace(/^[\s·,;:/-]+/, "").replace(/\s+/g, " ").trim();
  return note || null;
}

/**
 * Hücrenin metni → vardiya. Boş metin "planlanmadı" (null). "18-02" gece yarısını geçer (bitiş ertesi gün). Biçimlenmiş
 * metin ("10:00–18:00 · kasa", "İzin") yeniden okunur: kaydedilen plan aynı kutuda düzenlenir.
 */
export function parseShiftCell(text: string): ParsedCell {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { ok: true, cell: null };
  // "IZIN" Türkçe küçültmede "ızın" olur: ı de i sayılır (uzunluk değişmez, not özgün metinden kesilir)
  const off = OFF_RE.exec(fold(t).replace(/ı/g, "i"));
  if (off) {
    // Not özgün metinden (büyük / küçük harf korunur): ilk sözcükten sonrası
    const note = cleanNote(t.slice(off[1].length));
    if (note && note.length > SHIFT_NOTE_MAX) return { ok: false, error: SHIFT_TEXT.note };
    return { ok: true, cell: { kind: "off", note } };
  }
  const m = WORK_RE.exec(t);
  if (!m) return { ok: false, error: SHIFT_TEXT.format };
  const [sh, sm, eh, em] = [Number(m[1]), Number(m[2] ?? 0), Number(m[3]), Number(m[4] ?? 0)];
  if (sm > 59 || em > 59) return { ok: false, error: SHIFT_TEXT.minute };
  if (sh > 23 || eh > 24 || (eh === 24 && em > 0)) return { ok: false, error: SHIFT_TEXT.hour };
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin === startMin) return { ok: false, error: SHIFT_TEXT.same };
  // Bitiş başlangıçtan küçükse vardiya gece yarısını geçer
  if (endMin < startMin) endMin += 1440;
  if (endMin > SHIFT_MAX_END_MIN) return { ok: false, error: SHIFT_TEXT.late };
  if (endMin - startMin > SHIFT_MAX_MINUTES) return { ok: false, error: SHIFT_TEXT.long };
  const note = cleanNote(m[5]);
  if (note && note.length > SHIFT_NOTE_MAX) return { ok: false, error: SHIFT_TEXT.note };
  return { ok: true, cell: { kind: "work", startMin, endMin, note } };
}

/** Günün başından dakika → "10:00" (gece yarısını geçen bitiş "02:00", tam gece yarısı "00:00") */
export function clockOf(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${two(Math.floor(m / 60))}:${two(m % 60)}`;
}

/** "10:00–18:00" */
export function shiftTimes(cell: Extract<ShiftCell, { kind: "work" }>): string {
  return `${clockOf(cell.startMin)}–${clockOf(cell.endMin)}`;
}

// ---------------------------------------------------------------- Hazır vardiyalar (sabahçı / akşamcı)

/**
 * Şubenin hazır vardiyaları (operatör, 22 Kasım 2026): ızgarada tıklamayla yazılır, planda ve PDF'te adıyla görünür.
 * Tuzla 09:00'da açılır, vardiya 9 saat: sabahçı 09:00–18:00, akşamcı 16:00'da gelir (16:00–01:00). Marina 09:30'da
 * açılır: sabahçı 09:30–18:30, akşamcı 13:00'te gelir ve 22:00'deki kapanışa kadar kalır. Ad saatlerden türetilir
 * (veritabanında ayrı alan yok): saatleri hazır vardiyayla aynı olan hücre o vardiyadır, elle yazılsa da. Saatler
 * değişirse burası güncellenir; eski haftaların hücreleri yazıldıkları saatlerle kalır.
 */
export interface ShiftPreset {
  key: "morning" | "evening";
  label: string;
  startMin: number;
  endMin: number;
}

export const SHIFT_PRESETS: Record<string, readonly ShiftPreset[]> = {
  tuzla: [
    { key: "morning", label: "Sabahçı", startMin: 9 * 60, endMin: 18 * 60 },
    { key: "evening", label: "Akşamcı", startMin: 16 * 60, endMin: 25 * 60 },
  ],
  marina: [
    { key: "morning", label: "Sabahçı", startMin: 9 * 60 + 30, endMin: 18 * 60 + 30 },
    { key: "evening", label: "Akşamcı", startMin: 13 * 60, endMin: 22 * 60 },
  ],
};

/** Şubenin hazır vardiyaları; tanımlı değilse boş (ızgarada yalnız İzin ve Sil kalır) */
export const shiftPresets = (branchId: string): readonly ShiftPreset[] => SHIFT_PRESETS[branchId] ?? [];

/** Hücre şubenin hazır vardiyalarından biri mi (saatleri birebir aynıysa); değilse null */
export function presetOf(branchId: string, cell: ShiftCell | null): ShiftPreset | null {
  if (cell?.kind !== "work") return null;
  return shiftPresets(branchId).find((p) => p.startMin === cell.startMin && p.endMin === cell.endMin) ?? null;
}

/** Hazır vardiyanın kutuya yazılan metni: "09:00–18:00" */
export const presetText = (p: ShiftPreset) => `${clockOf(p.startMin)}–${clockOf(p.endMin)}`;

/** Hücrenin ekrandaki ve kutudaki metni: "10:00–18:00 · kasa", "İzin", planlanmadıysa boş */
export function formatShiftCell(cell: ShiftCell | null): string {
  if (!cell) return "";
  const head = cell.kind === "off" ? "İzin" : shiftTimes(cell);
  return cell.note ? `${head} · ${cell.note}` : head;
}

/** Vardiyanın süresi (dakika); izin ve boş 0 */
export function shiftMinutes(cell: ShiftCell | null): number {
  return cell?.kind === "work" ? cell.endMin - cell.startMin : 0;
}

/** Dakika → "40 sa", "37,5 sa", "7 sa 20 dk" (çeyrek ve yarım saat ondalıkla, başkası dakikayla) */
export function hoursLabel(minutes: number): string {
  if (minutes <= 0) return "0 sa";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!m) return `${h} sa`;
  if (m % 15 === 0) return `${String(h + m / 60).replace(".", ",")} sa`;
  return `${h} sa ${m} dk`;
}

export const sameCell = (a: ShiftCell | null, b: ShiftCell | null) => formatShiftCell(a) === formatShiftCell(b) && a?.kind === b?.kind;

// ---------------------------------------------------------------- Hafta

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Günün haftasının Pazartesi'si */
export function weekStart(date: string): string {
  const dow = new Date(utc(date)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/** Adresteki `?hafta=` → o haftanın Pazartesi'si; boş ya da bozuksa bu hafta */
export function weekParam(raw: unknown, today: string): string {
  return weekStart(typeof raw === "string" && isCalendarDate(raw) ? raw : today);
}

/** Haftanın yedi günü (Pazartesi–Pazar) */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const DAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const;
export const DAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;

const dayOf = (date: string) => Number(date.slice(8, 10));
const monthOf = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1];
const yearOf = (date: string) => date.slice(0, 4);

/** "23–29 Kasım 2026", "30 Kasım – 6 Aralık 2026", "28 Aralık 2026 – 3 Ocak 2027" */
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  if (yearOf(monday) !== yearOf(sunday)) return `${dayOf(monday)} ${monthOf(monday)} ${yearOf(monday)} – ${dayOf(sunday)} ${monthOf(sunday)} ${yearOf(sunday)}`;
  if (monthOf(monday) !== monthOf(sunday)) return `${dayOf(monday)} ${monthOf(monday)} – ${dayOf(sunday)} ${monthOf(sunday)} ${yearOf(sunday)}`;
  return `${dayOf(monday)}–${dayOf(sunday)} ${monthOf(sunday)} ${yearOf(sunday)}`;
}

/** Gün başlığı: "Pzt 23" (ay değişen haftada "Pzt 30 Kas") */
export function dayHeading(date: string, index: number, withMonth = false): string {
  return `${DAY_SHORT[index]} ${dayOf(date)}${withMonth ? ` ${monthOf(date).slice(0, 3)}` : ""}`;
}

/** "23 Kasım Pazartesi" */
export function dayLong(date: string, index: number): string {
  return `${dayOf(date)} ${monthOf(date)} ${DAY_NAMES[index]}`;
}

// ---------------------------------------------------------------- Kişi

/** Kişinin adı: boşluklar tek, uçlar kırpık */
export const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();
/** Panel kullanıcısının anahtarı */
export const userRef = (id: number) => `u:${id}`;
/** Hesabı olmayan çalışanın anahtarı: adının küçük harflisi (aynı ad iki kez yazılırsa aynı satır) */
export const nameRef = (name: string) => `n:${fold(cleanName(name))}`;

/** Anahtar bir kullanıcınınsa kimliği, değilse null */
export function refUserId(ref: string): number | null {
  const m = /^u:(\d{1,9})$/.exec(ref);
  return m ? Number(m[1]) : null;
}

/** Ad sırası: Türkçe alfabe, büyük / küçük harf ayırmadan */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "tr");

// ---------------------------------------------------------------- Plan

/** Veritabanındaki satırın ekrana ve PDF'e giden hâli */
export interface ShiftEntry {
  date: string;
  ref: string;
  userId: number | null;
  name: string;
  cell: ShiftCell;
}

/** Izgaranın bir satırı: kişi ve haftanın yedi günü */
export interface ShiftRow {
  ref: string;
  userId: number | null;
  name: string;
  cells: (ShiftCell | null)[];
}

/** Veritabanı satırının sütunları → hücre (bozuk satır izin sayılmaz, atlanır) */
export function cellOf(r: { kind: string; startMin: number | null; endMin: number | null; note: string | null }): ShiftCell | null {
  if (r.kind === "off") return { kind: "off", note: r.note };
  if (r.kind !== "work" || r.startMin === null || r.endMin === null || r.endMin <= r.startMin) return null;
  return { kind: "work", startMin: r.startMin, endMin: r.endMin, note: r.note };
}

/**
 * Haftanın satırları: şubenin personeli (planı boş olsa da) ve o hafta planı olan herkes (hesabı olmayan, pasife alınan
 * ya da başka şubeden gelen kişi de). Hesabı duran kişi güncel adıyla, öteki plandaki adıyla. Ada göre sıralı.
 */
export function buildRows(monday: string, roster: readonly { id: number; name: string }[], entries: readonly ShiftEntry[]): ShiftRow[] {
  const days = weekDays(monday);
  const rows = new Map<string, ShiftRow>();
  for (const u of roster) rows.set(userRef(u.id), { ref: userRef(u.id), userId: u.id, name: u.name, cells: Array<ShiftCell | null>(7).fill(null) });
  for (const e of entries) {
    const i = days.indexOf(e.date);
    if (i < 0) continue;
    let row = rows.get(e.ref);
    if (!row) rows.set(e.ref, (row = { ref: e.ref, userId: e.userId, name: e.name, cells: Array<ShiftCell | null>(7).fill(null) }));
    row.cells[i] = e.cell;
  }
  return [...rows.values()].sort(byName);
}

/** Kişinin haftalık toplamı (dakika) */
export const rowMinutes = (row: Pick<ShiftRow, "cells">) => row.cells.reduce((sum, c) => sum + shiftMinutes(c), 0);
/** Gün gün çalışan sayısı (izinli sayılmaz) */
export const dayHeadcount = (rows: readonly Pick<ShiftRow, "cells">[]) => Array.from({ length: 7 }, (_, i) => rows.filter((r) => r.cells[i]?.kind === "work").length);
/** Planda en az bir günü yazılı satırlar (PDF ve özet boş satırı taşımaz) */
export const plannedRows = <T extends Pick<ShiftRow, "cells">>(rows: readonly T[]) => rows.filter((r) => r.cells.some(Boolean));

/** İşlem geçmişinin ve bildirimin özeti: "5 kişi · 28 vardiya · 3 izin" */
export function weekSummary(rows: readonly Pick<ShiftRow, "cells">[]): string {
  const planned = plannedRows(rows);
  const cells = planned.flatMap((r) => r.cells);
  const work = cells.filter((c) => c?.kind === "work").length;
  const off = cells.filter((c) => c?.kind === "off").length;
  if (!planned.length) return "plan boş";
  return [`${planned.length} kişi`, `${work} vardiya`, off ? `${off} izin` : null].filter(Boolean).join(" · ");
}

/** PDF'in dosya adı: vardiya-tuzla-2026-11-23.pdf */
export const pdfFileName = (branchId: string, monday: string) => `vardiya-${branchId}-${monday}.pdf`;

/** PDF'in adresi (kaydedilen planı her istekte yeniden çizer) */
export function pdfHref(branchId: string, monday: string): string {
  return `${VARDIYA_PDF_PATH}?hafta=${monday}&sube=${encodeURIComponent(branchId)}`;
}

// ---------------------------------------------------------------- Kaydetme

/**
 * Sunucu eyleminin girdisi: ızgaradaki her satır, hücreler ekrandaki metniyle. Metin sunucuda aynı okuyucudan geçer
 * (tek kural); kişi kullanıcıysa adı sunucuda hesabından alınır.
 */
export const saveWeekSchema = z.object({
  branchId: z.string().min(2).max(24),
  week: z.string().refine(isCalendarDate, "Geçerli bir hafta seçin"),
  rows: z
    .array(
      z.object({
        ref: z.string().min(3).max(SHIFT_NAME_MAX + 2),
        name: z.string().max(SHIFT_NAME_MAX + 20).default(""),
        cells: z.array(z.string().max(120)).length(7),
      }),
    )
    .max(SHIFT_PEOPLE_MAX, `Bir haftada en çok ${SHIFT_PEOPLE_MAX} kişi planlanır`),
});

export type SaveWeekInput = z.input<typeof saveWeekSchema>;

/** Hücrenin kimliği (aynı gün ve kişi) */
export const cellKey = (date: string, ref: string) => `${date}|${ref}`;

/**
 * Kaydın veritabanına farkı: yazılacak (yeni ya da değişen) ve silinecek (boşaltılan) hücreler. Girdide olmayan kişinin
 * satırlarına dokunulmaz (başka bir sekmeden eklenen kişi silinmez); değişmeyen hücre yazılmaz.
 */
export function weekDiff(existing: readonly ShiftEntry[], next: readonly ShiftRow[], monday: string): { upserts: ShiftEntry[]; deletes: { date: string; ref: string }[] } {
  const days = weekDays(monday);
  const before = new Map(existing.map((e) => [cellKey(e.date, e.ref), e]));
  const upserts: ShiftEntry[] = [];
  const deletes: { date: string; ref: string }[] = [];
  for (const row of next) {
    row.cells.forEach((cell, i) => {
      const date = days[i];
      const prev = before.get(cellKey(date, row.ref));
      if (!cell) {
        if (prev) deletes.push({ date, ref: row.ref });
        return;
      }
      // Ad da karşılaştırılır: kişinin adı değiştiyse plandaki ad yenilenir
      if (prev && sameCell(prev.cell, cell) && prev.name === row.name && prev.userId === row.userId) return;
      upserts.push({ date, ref: row.ref, userId: row.userId, name: row.name, cell });
    });
  }
  return { upserts, deletes };
}

/** Bugün'ün "Bugün kafede" satırında en çok bu kadar kişi adıyla yazılır (kalanı "ve 2 kişi") */
export const TODAY_SHIFT_NAMES = 3;

/**
 * Bugün ekranının vardiya satırı: "Vardiyada: Ayşe 10:00–18:00 · Çağrı 16:00–00:00 · ve 2 kişi" (yalnız ilk ad,
 * başlangıç saatine göre). O gün için çalışan yazılmadıysa null (satır çizilmez).
 */
export function todayShiftText(list: readonly { name: string; startMin: number; endMin: number }[]): string | null {
  if (!list.length) return null;
  const shown = list.slice(0, TODAY_SHIFT_NAMES).map((s) => `${cleanName(s.name).split(" ")[0]} ${clockOf(s.startMin)}–${clockOf(s.endMin)}`);
  const more = list.length - shown.length;
  return `Vardiyada: ${[...shown, more > 0 ? `ve ${more} kişi` : null].filter(Boolean).join(" · ")}`;
}

/** Bu rol planı değiştirebilir mi (personel yalnız görür ve PDF'ini alır) */
export const canEditShifts = (role: "admin" | "staff") => role === "admin";
