import { z } from "zod";

import { isCalendarDate } from "@/lib/reminders";
import {
  cleanName,
  DAY_NAMES,
  formatShiftCell,
  nameRef,
  parseShiftCell,
  presetText,
  SHIFT_NAME_MAX,
  SHIFT_NOTE_MAX,
  SHIFT_PEOPLE_MAX,
  userRef,
  weekDays,
  type ShiftPreset,
} from "@/lib/vardiya";

/**
 * Vardiyayı yazarak doldurma (operatör, 22 Kasım 2026: "vardiya kısmına prompt yazarak ekleme yap ... sabahçı akşamcıyı
 * kolayca yapmak için"): yönetici haftayı düz cümleyle yazar ("Ayşe hafta içi sabahçı, Mehmet akşamcı, Zeynep Salı
 * izinli"), Claude bunu atamalara çevirir, atamalar ızgaraya **taslak** olarak düşer. Hiçbir şey kendiliğinden
 * kaydedilmez: yönetici kutuları görür, düzeltir, "Kaydet"e basar. Burası saf yarı (istem, yanıtın şeması, atamaların
 * hücre metnine çevrilmesi; tests/vardiya-taslak.test.ts); çağrı src/server/vardiya/draft.ts'te. Ayrıntı: docs/VARDIYA.md.
 */

export const SHIFT_PROMPT_MIN = 3;
export const SHIFT_PROMPT_MAX = 1500;
/** Yazarak doldurmanın günlük sınırı (yönetici başına değil, işletme için). Fotoğraf okumanın sınırından ayrıdır */
export const SHIFT_DRAFT_DAILY_CAP = 40;

/** Haftanın günleri, modelin yazdığı adlarla (Pazartesi–Pazar) */
export const DRAFT_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DraftDay = (typeof DRAFT_DAYS)[number];
export const DRAFT_KINDS = ["morning", "evening", "off", "hours", "clear"] as const;
/** "Listedeki herkes" */
export const DRAFT_EVERYONE = "all";

/** Modelin yanıtı: sırayla uygulanacak atamalar (sonraki öncekinin üstüne yazar) */
export const ShiftDraftRaw = z.object({
  assignments: z.array(
    z.object({
      /** Listedeki kişinin anahtarı ("p1"), herkes için "all"; listede olmayan kişide "" ve `newName` */
      person: z.string(),
      newName: z.string().nullable(),
      days: z.array(z.enum(DRAFT_DAYS)),
      shift: z.enum(DRAFT_KINDS),
      /** Yalnız "hours": "HH:MM" */
      start: z.string().nullable(),
      end: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
  /** Uygulanamayan kısım, kısa bir Türkçe cümleyle; her şey uygulandıysa null */
  unclear: z.string().nullable(),
});
export type ShiftDraftRaw = z.infer<typeof ShiftDraftRaw>;

/** Sunucu eyleminin girdisi: yazılan metin ve ızgaranın o anki hâli (kaydedilmemiş kutular dahil) */
export const draftWeekSchema = z.object({
  branchId: z.string().min(2).max(24),
  week: z.string().refine(isCalendarDate, "Geçerli bir hafta seçin"),
  prompt: z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(SHIFT_PROMPT_MIN, "Ne yapılacağını birkaç sözcükle yazın").max(SHIFT_PROMPT_MAX, `Metin en çok ${SHIFT_PROMPT_MAX} karakter olabilir`)),
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
export type DraftWeekInput = z.input<typeof draftWeekSchema>;

/** Izgaradaki bir kişi, modele giden anahtarıyla */
export interface DraftPerson {
  key: string;
  ref: string;
  userId: number | null;
  name: string;
  /** Yedi günün o anki metni (ekrandaki biçimiyle; boş: planlanmadı) */
  cells: readonly string[];
}

/** Izgaranın satırları → modele giden kişi listesi ("p1", "p2", …; sıra ızgaradaki sıra) */
export function draftPeople(rows: readonly { ref: string; userId: number | null; name: string; cells: readonly string[] }[]): DraftPerson[] {
  return rows.map((r, i) => ({ key: `p${i + 1}`, ref: r.ref, userId: r.userId, name: cleanName(r.name), cells: r.cells }));
}

const presetLine = (p: ShiftPreset) => `${p.key} (${p.label.toLocaleLowerCase("tr-TR")}) ${presetText(p)}`;

/**
 * Modelin sabit yönergesi (İngilizce; yöneticinin metni Türkçe veri olarak gelir). Kuralların nedeni yazılıdır: sonuç
 * yöneticinin gözden geçireceği bir taslaktır, bu yüzden yalnız söylenen yazılır ve belirsiz ad tahmin edilmez.
 */
export const SHIFT_DRAFT_SYSTEM = `You turn a café manager's free-text instruction, written in Turkish, into shift assignments for one week of a staff schedule (a grid of people by days, Monday to Sunday).

Your answer fills the grid as a draft the manager reviews before saving. So apply what the instruction says or clearly implies and leave every other cell alone; a cell you do not mention keeps its current content.

Shift kinds:
- "morning": the branch's morning shift (sabahçı, sabah, S).
- "evening": the branch's evening shift (akşamcı, akşam, A).
- "off": a day off (izin, izinli, tatil, off, İ).
- "hours": any other working hours. Give start and end as "HH:MM" in 24-hour time. An end earlier than the start means the shift runs past midnight ("18-02" is 18:00 to 02:00).
- "clear": empty the cell (boşalt, sil, planlanmadı).
start and end are null for every kind except "hours". If the branch has no preset morning or evening shift, use "hours" only when the instruction gives the times; otherwise leave it out and explain in "unclear".

People: use the key from the list ("p1", "p2", …). Use "${DRAFT_EVERYONE}" when the instruction covers everyone on the list (herkes, tüm ekip). Match names loosely: first name only, a nickname, missing Turkish letters (ş, ç, ğ, ı, ö, ü) and small typos all count. When a name matches nobody on the list, the manager means someone new: set person to "" and newName to the name with normal capitalisation. When a name could be two different people on the list, do not guess: leave that part out and say so in "unclear". newName is null whenever person is a key.

Days: "mon" to "sun". "Hafta içi" is mon to fri, "hafta sonu" is sat and sun. "Her gün", "bu hafta", "tüm hafta" or no day at all means all seven days. Dates and words such as "yarın" or "bugün" refer to the calendar in the message; a day outside this week cannot be applied and belongs in "unclear".

Order matters: assignments are applied in the order you list them, and a later one overwrites an earlier one for the same person and day. "Ayşe sabahçı ama Salı izinli" is two assignments, the general one first.
"The rest" (kalanlar, diğerleri, boş günler) refers to cells that are still empty after the assignments before it; the current plan in the message tells you which those are.

note is a short duty note for the cell ("kasa", "bar", "açılış") only when the instruction gives one, at most ${SHIFT_NOTE_MAX} characters; otherwise null.

unclear: one short sentence in Turkish naming whatever you could not apply (an ambiguous name, a day outside the week, a request that is not about this week's shifts). null when everything was applied. If the instruction is not about shifts at all, return no assignments and say so here.`;

export interface DraftContext {
  branch: { id: string; name: string };
  /** Şubenin hazır vardiyaları (şube ayarı; src/server/vardiya/presets.ts loadShiftPresets) */
  presets: readonly ShiftPreset[];
  monday: string;
  today: string;
  people: readonly DraftPerson[];
}

/**
 * İsteğin değişen kısmı: şube, haftanın takvimi, hazır vardiyaların saatleri, kişi listesi, o anki plan ve yöneticinin
 * metni. Metin etiketin içinde veri olarak durur. Kişilerin yalnız adı gider (e-posta, telefon, rol gitmez).
 */
export function shiftDraftTask(ctx: DraftContext, prompt: string): string {
  const days = weekDays(ctx.monday);
  const presets = ctx.presets;
  const filled = ctx.people.flatMap((p) => p.cells.flatMap((t, i) => (t.trim() ? [`${p.key} ${DRAFT_DAYS[i]}: ${t.trim()}`] : [])));
  return [
    `Branch: ${ctx.branch.name}`,
    `Week: ${DRAFT_DAYS.map((d, i) => `${d}=${days[i]}`).join(", ")}`,
    `Today: ${ctx.today}`,
    presets.length ? `Preset shifts: ${presets.map(presetLine).join("; ")}` : "Preset shifts: none at this branch (no morning or evening preset).",
    ctx.people.length ? `People:\n${ctx.people.map((p) => `${p.key}: ${p.name}`).join("\n")}` : "People: nobody is on the list yet.",
    filled.length ? `Current plan (filled cells only):\n${filled.join("\n")}` : "Current plan: every cell is empty.",
    `Instruction:\n<instruction>\n${prompt}\n</instruction>`,
  ].join("\n\n");
}

/** Taslağın bir hücresi: kişi, gün (0 Pazartesi) ve kutuya yazılacak metin (boş metin: kutu boşaltılır) */
export interface DraftCell {
  ref: string;
  day: number;
  text: string;
}

export interface DraftResult {
  cells: DraftCell[];
  /** Listede olmayan, taslakla eklenen kişiler */
  added: { ref: string; userId: number | null; name: string }[];
  /** Uygulanamayan atamalar, yöneticinin okuyacağı cümlelerle */
  skipped: string[];
  /** Modelin "anlayamadım" notu */
  unclear: string | null;
}

const fold = (v: string) => cleanName(v).toLocaleLowerCase("tr-TR");
const CLOCK = /^([01]?\d|2[0-4])[:.]([0-5]\d)$/;
/** Ekrana en çok bu kadar "işlenemedi" satırı gider */
const SKIPPED_MAX = 8;

/** Atamanın kutu metni (okuyucudan geçmeden önce); yazılamıyorsa nedeni */
function draftText(presets: readonly ShiftPreset[], a: ShiftDraftRaw["assignments"][number]): { text: string } | { error: string } {
  const note = cleanName(a.note ?? "").slice(0, SHIFT_NOTE_MAX);
  const withNote = (head: string) => (note ? `${head} ${note}` : head);
  if (a.shift === "clear") return { text: "" };
  if (a.shift === "off") return { text: withNote("İzin") };
  if (a.shift === "hours") {
    const [start, end] = [a.start?.trim() ?? "", a.end?.trim() ?? ""];
    if (!CLOCK.test(start) || !CLOCK.test(end)) return { error: "saatleri anlaşılamadı" };
    return { text: withNote(`${start.replace(".", ":")}-${end.replace(".", ":")}`) };
  }
  const preset = presets.find((p) => p.key === a.shift);
  if (!preset) return { error: `bu şubede hazır ${a.shift === "morning" ? "sabahçı" : "akşamcı"} vardiyası yok; saatleri yazın` };
  return { text: withNote(presetText(preset)) };
}

/**
 * Modelin atamaları → ızgaraya yazılacak hücreler. Her metin ekranın ve kaydın okuyucusundan (parseShiftCell) geçer:
 * okunamayan atama yazılmaz, `skipped`'e düşer. Tanınmayan anahtar, adı olmayan yeni kişi ve kişi sınırını aşan ekleme
 * de atlanır. Aynı kişi ve günde sonraki atama öncekinin üstüne yazar. Yeni kişi adı bir hesabınkiyle aynıysa o hesabın
 * satırı olur ("Kişi ekle" ile aynı kural).
 */
export function draftToCells(raw: ShiftDraftRaw, ctx: Pick<DraftContext, "branch" | "people" | "presets">, accounts: readonly { id: number; name: string }[] = []): DraftResult {
  type Person = { ref: string; userId: number | null; name: string };
  const byKey = new Map(ctx.people.map((p) => [p.key, p]));
  const known = new Map<string, Person>(ctx.people.map((p) => [fold(p.name), { ref: p.ref, userId: p.userId, name: p.name }]));
  const everyone: Person[] = ctx.people.map((p) => ({ ref: p.ref, userId: p.userId, name: p.name }));
  const added: Person[] = [];
  const cells = new Map<string, DraftCell>();
  const skipped: string[] = [];
  const skip = (text: string) => {
    if (skipped.length < SKIPPED_MAX && !skipped.includes(text)) skipped.push(text);
  };

  for (const a of raw.assignments) {
    const days = [...new Set(a.days.map((d) => DRAFT_DAYS.indexOf(d)))].filter((i) => i >= 0);
    if (!days.length) continue;
    let targets: readonly Person[];
    if (a.person === DRAFT_EVERYONE) targets = [...everyone];
    else if (byKey.has(a.person)) targets = [byKey.get(a.person)!];
    else {
      const name = cleanName(a.newName ?? "");
      if (!name) {
        skip("Bir kişi tanınamadı; adını listedeki gibi yazın.");
        continue;
      }
      if (name.length > SHIFT_NAME_MAX) {
        skip(`“${name.slice(0, 20)}…” adı çok uzun.`);
        continue;
      }
      let person = known.get(fold(name));
      if (!person) {
        const account = accounts.find((u) => fold(u.name) === fold(name));
        const fresh: Person = account ? { ref: userRef(account.id), userId: account.id, name: account.name } : { ref: nameRef(name), userId: null, name };
        // Hesabın satırı zaten ızgaradaysa (ad başka yazılmış) yeni satır açılmaz
        const row = everyone.find((p) => p.ref === fresh.ref);
        if (!row) {
          if (everyone.length >= SHIFT_PEOPLE_MAX) {
            skip(`${name} eklenemedi: bir haftada en çok ${SHIFT_PEOPLE_MAX} kişi planlanır.`);
            continue;
          }
          added.push(fresh);
          everyone.push(fresh);
        }
        person = row ?? fresh;
        known.set(fold(name), person);
      }
      targets = [person];
    }
    const made = draftText(ctx.presets, a);
    for (const t of targets) {
      for (const day of days) {
        if ("error" in made) {
          skip(`${t.name}, ${DAY_NAMES[day]}: ${made.error}.`);
          continue;
        }
        const parsed = parseShiftCell(made.text);
        if (!parsed.ok) {
          skip(`${t.name}, ${DAY_NAMES[day]}: ${parsed.error}`);
          continue;
        }
        cells.set(`${t.ref}|${day}`, { ref: t.ref, day, text: formatShiftCell(parsed.cell) });
      }
    }
  }
  const unclear = cleanName(raw.unclear ?? "").slice(0, 300) || null;
  // Hiç hücresi kalmayan yeni kişi satır olarak eklenmez
  const used = new Set([...cells.values()].map((c) => c.ref));
  return { cells: [...cells.values()], added: added.filter((p) => used.has(p.ref)), skipped, unclear };
}

/** Izgaranın satırı, taslağın uyguladığı kadarıyla */
interface DraftRow {
  ref: string;
  userId: number | null;
  name: string;
  texts: string[];
  added?: boolean;
}

/**
 * Taslağın ızgaraya uygulanması (saf; ekran ve test paylaşır): satırların yeni hâli, gerçekten değişen kutu ve eklenen
 * kişi sayısı. Yeni kişiler sona eklenir (`added: true`: kaydedilene kadar kaldırılabilir). `norm` kutunun okunmuş
 * hâlini verir (ekran aynı karşılaştırmayı kullanır); taslağın metni zaten o biçimdedir.
 */
export function applyDraft<R extends DraftRow>(rows: readonly R[], draft: Pick<DraftResult, "cells" | "added">, norm: (text: string) => string = (t) => t): { rows: (R | DraftRow)[]; changed: number; people: number } {
  const next: (R | DraftRow)[] = rows.map((r) => ({ ...r, texts: [...r.texts] }));
  let people = 0;
  for (const p of draft.added) {
    if (next.some((r) => r.ref === p.ref)) continue;
    next.push({ ref: p.ref, userId: p.userId, name: p.name, texts: Array<string>(7).fill(""), added: true });
    people++;
  }
  let changed = 0;
  for (const c of draft.cells) {
    const row = next.find((r) => r.ref === c.ref);
    if (!row || c.day < 0 || c.day > 6) continue;
    if (norm(row.texts[c.day]) !== c.text) changed++;
    row.texts[c.day] = c.text;
  }
  return { rows: next, changed, people };
}

/** Sonucun yöneticiye özeti: "12 kutu değişti · 1 kişi eklendi" */
export function draftSummary(changed: number, people: number): string {
  return [`${changed} kutu değişti`, people ? `${people} kişi eklendi` : null].filter(Boolean).join(" · ");
}
