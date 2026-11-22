"use client";

import { CalendarRange, Copy, Eraser, FileDown, Save, Sparkles, Undo2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Input, Textarea } from "@/components/ui/form";
import { BRANCH_LEAVE, useLeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { useIsPhone } from "@/components/ui/use-media";
import type { ReadingState } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";
import {
  cleanName,
  DAY_NAMES,
  DAY_SHORT,
  dayHeading,
  dayLong,
  formatShiftCell,
  hoursLabel,
  nameRef,
  parseShiftCell,
  expandShiftAbbr,
  pdfHref,
  presetOf,
  presetShort,
  presetText,
  SHIFT_NAME_MAX,
  SHIFT_PEOPLE_MAX,
  SHIFT_TEXT,
  shiftMinutes,
  shiftPresets,
  shiftTimes,
  userRef,
  weekDays,
  weekLabel,
  type ShiftCell,
} from "@/lib/vardiya";
import { applyDraft, draftSummary, SHIFT_PROMPT_MAX, SHIFT_PROMPT_MIN } from "@/lib/vardiya-taslak";
import { draftShiftWeekAction, saveShiftWeekAction } from "@/server/actions/vardiya";

/** Izgaranın satırı: kişi ve yedi günün ekrandaki metni */
export interface GridRow {
  ref: string;
  userId: number | null;
  name: string;
  texts: string[];
  /** Bu oturumda eklenen, henüz kaydedilmemiş satır (kaldırılabilir) */
  added?: boolean;
}

interface Props {
  branch: { id: string; name: string };
  monday: string;
  today: string;
  canEdit: boolean;
  /** Bakan kişinin satır anahtarı: personelin görünümünde kendi satırı öne çıkar */
  meRef: string;
  rows: GridRow[];
  /** "Kişi ekle"nin önerdiği, ızgarada satırı olmayan hesaplar */
  others: { id: number; name: string }[];
  /** Geçen haftanın planı ("Geçen haftayı kopyala"); yalnız yöneticiye gelir */
  previous: GridRow[] | null;
  /** Kaydedilen planın damgası: değişince (kayıt, başka sekmenin kaydı) ızgara sunucunun satırlarıyla yeniden kurulur */
  stamp: string;
  updatedText: string | null;
  /** Yazarak doldurma kullanılabilir mi (yalnız yöneticiye gelir; personelde null) */
  draftState: ReadingState | null;
}

/** Yazarak doldurmanın son sonucu: kutunun altındaki uyarı */
interface DraftNote {
  tone: "good" | "neutral" | "bad";
  title: string;
  text: string;
  /** Uygulanamayanlar ve modelin notu */
  lines: string[];
  /** Taslaktan önceki satırlar ("Taslağı geri al"); hata ve değişiklik yoksa null */
  undo: GridRow[] | null;
}

/** Yazarak doldurma kullanılamıyorken kutunun yerinde duran açıklama */
const DRAFT_OFF: Record<Exclude<ReadingState, "on">, { title: string; text: string }> = {
  nokey: { title: "Yazarak doldurma kurulu değil", text: "Kutuları seçerek ya da elle yazarak doldurun." },
  off: { title: "Yazarak doldurma kapalı", text: "Ayarlar › Fotoğraftan okuma açılınca kullanılır." },
  cap: { title: "Yazarak doldurmanın bugünkü sınırı doldu", text: "Yarın yeniden açılır; kutuları seçerek doldurun." },
};

const fold = (v: string) => cleanName(v).toLocaleLowerCase("tr-TR");

/**
 * Telefonun gün seçicisi: haftanın yedi günü tek satırda, kaydırmadan (genel Segmented dar telefonda yana kayar ve son
 * günler görünmezdi). Kısa gün adı üstte, ayın günü altta; bugünün rakamı mavi. Ok tuşlarıyla gezilir (radiogroup).
 */
function DayPicker({ days, today, value, onChange }: { days: readonly string[]; today: string; value: number; onChange: (day: number) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Gün"
      className="grid grid-cols-7 gap-1"
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = (value + step + 7) % 7;
        onChange(next);
        (e.currentTarget.querySelector(`[data-day="${next}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {days.map((d, i) => {
        const on = i === value;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${dayLong(d, i)}${d === today ? ", bugün" : ""}`}
            tabIndex={on ? 0 : -1}
            data-day={i}
            onClick={() => onChange(i)}
            className={cn(
              "flex h-12 min-w-0 cursor-pointer flex-col items-center justify-center rounded-xl text-[11px] leading-4 font-medium ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none",
              on ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-mute ring-line-strong",
            )}
          >
            <span>{DAY_SHORT[i]}</span>
            <span className={cn("text-sm leading-4 font-semibold tabular", !on && (d === today ? "text-info" : "text-ink"))}>{Number(d.slice(8, 10))}</span>
          </button>
        );
      })}
    </div>
  );
}


/**
 * Vardiya ızgarası (docs/VARDIYA.md): yönetici haftayı kişi × gün kutularına yazar ("10-18", "18-02 bar", "izin"), kutudan
 * çıkınca metin biçimlenir, "Kaydet" bütün haftayı tek eylemle yazar. PDF kaydedilen plandan çizilir: kayıttan sonra
 * kendiliğinden günceldir. Personel aynı planı salt okunur görür; kendi haftası üstte ayrı kartta.
 */
export function ShiftGrid({ branch, monday, today, canEdit, meRef, rows: saved, others, previous, stamp, updatedText, draftState }: Props) {
  const router = useRouter();
  const addId = useId();
  const [pending, run] = useActionTransition();
  // Yazarak doldurma (docs/VARDIYA.md): metin sunucuda atamalara çevrilir, sonuç ızgaraya taslak olarak yazılır
  const [drafting, runDraft] = useActionTransition();
  const [prompt, setPrompt] = useState("");
  const [draftNote, setDraftNote] = useState<DraftNote | null>(null);
  const [rows, setRows] = useState<GridRow[]>(saved);
  // Sunucudaki plan değişti (kayıttan sonraki yenileme, başka sekmenin kaydı): ızgara onunla yeniden kurulur
  const [seen, setSeen] = useState(stamp);
  if (seen !== stamp) {
    setSeen(stamp);
    setRows(saved);
    setDraftNote(null);
  }
  const [newName, setNewName] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  /** Bu oturumda kaydedildi: "PDF hazır" satırı */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Hücrenin okunuşu: elle yazarken "s" / "a" şubenin sabahçı / akşamcı saatlerine açılır (expandShiftAbbr)
  const read = (text: string) => parseShiftCell(expandShiftAbbr(branch.id, text));
  /** Metnin okunmuş hâli: geçerliyse biçimlenmiş metni (karşılaştırma ve kayıt aynı metne bakar), değilse kendisi */
  const norm = (text: string): string => {
    const p = read(text);
    return p.ok ? formatShiftCell(p.cell) : text.trim();
  };
  const cellOfText = (text: string): ShiftCell | null => {
    const p = read(text);
    return p.ok ? p.cell : null;
  };
  const minutesOf = (texts: readonly string[]) => texts.reduce((sum, t) => sum + shiftMinutes(cellOfText(t)), 0);
  /**
   * Hücreler seçerek doldurulur (22 Kasım 2026: "saat yazmaktansa seçimli yap, S ve A ekle"): her kutuda S (sabahçı),
   * A (akşamcı) ve İ (izin) düğmeleri; seçili harfe yeniden tıklamak kutuyu boşaltır. "Elle yaz"da kutular klavyeyle
   * yazılır (başka saat, görev notu). Hazır vardiyası olmayan şube elle yazmayla açılır
   */
  const presets = shiftPresets(branch.id);
  const [mode, setMode] = useState<"pick" | "type">(presets.length ? "pick" : "type");
  const choices: { key: string; short: string; title: string; text: string }[] = [
    ...presets.map((p) => ({ key: p.key, short: presetShort(p), title: `${p.label} ${presetText(p)}`, text: presetText(p) })),
    { key: "off", short: "İ", title: "İzin", text: "İzin" },
  ];
  /** Hücrenin hazır vardiya adı ("Sabahçı" / "Akşamcı"); saatleri şubenin hazır vardiyasıyla aynıysa */
  const presetLabel = (text: string) => presetOf(branch.id, cellOfText(text))?.label ?? null;
  // Telefonda ızgara gün gün yazılır (yedi sütun sığmaz): seçili gün, açılışta bugün (hafta bu haftaysa) ya da Pazartesi
  const phone = useIsPhone();
  const [day, setDay] = useState(() => Math.max(0, weekDays(monday).indexOf(today)));

  const days = weekDays(monday);
  const crossMonth = days[0].slice(5, 7) !== days[6].slice(5, 7);
  const pdf = pdfHref(branch.id, monday);
  const before = useMemo(() => new Map(saved.map((r) => [r.ref, r.texts])), [saved]);

  // Okunamayan hücreler: kutu kırmızı, ilk hatanın metni üstte, Kaydet kapalı
  const problems = rows.flatMap((r) =>
    r.texts.flatMap((t, i) => {
      const p = read(t);
      return p.ok ? [] : [{ ref: r.ref, day: i, text: `${r.name}, ${DAY_NAMES[i]}: ${p.error}` }];
    }),
  );
  const bad = new Set(problems.map((p) => `${p.ref}|${p.day}`));
  const changes = rows.reduce((n, r) => n + r.texts.filter((t, i) => norm(t) !== (before.get(r.ref)?.[i] ?? "")).length, 0);
  const dirty = changes > 0;
  const [leaveHref, setLeaveHref] = useLeaveGuard(canEdit && dirty, BRANCH_LEAVE);

  const headcount = days.map((_, i) => rows.filter((r) => cellOfText(r.texts[i])?.kind === "work").length);
  const totalMinutes = rows.reduce((sum, r) => sum + minutesOf(r.texts), 0);
  const planned = rows.filter((r) => r.texts.some((t) => t.trim()));

  function setText(ref: string, day: number, text: string) {
    setSavedNote(null);
    setRows((list) => list.map((r) => (r.ref === ref ? { ...r, texts: r.texts.map((t, i) => (i === day ? text : t)) } : r)));
  }

  /** Kutudan çıkınca geçerli metin biçimlenir: "10-18 kasa" → "10:00–18:00 · kasa" */
  function tidy(ref: string, day: number) {
    setRows((list) => list.map((r) => (r.ref === ref ? { ...r, texts: r.texts.map((t, i) => (i === day ? norm(t) : t)) } : r)));
  }

  function addPerson() {
    const name = cleanName(newName);
    if (!name) return void document.getElementById(addId)?.focus();
    if (name.length > SHIFT_NAME_MAX) return void toast.error(`Ad en çok ${SHIFT_NAME_MAX} karakter olabilir`);
    if (rows.length >= SHIFT_PEOPLE_MAX) return void toast.error(`Bir haftada en çok ${SHIFT_PEOPLE_MAX} kişi planlanır`);
    // Adı bir hesabınkiyle aynıysa o hesabın satırı (vardiyası hesabına bağlanır); değilse yalnız adıyla
    const user = others.find((u) => fold(u.name) === fold(name));
    const ref = user ? userRef(user.id) : nameRef(name);
    const dup = rows.find((r) => r.ref === ref || fold(r.name) === fold(name));
    if (dup) {
      toast.info(`${dup.name} zaten listede`);
      document.getElementById(`${addId}-${dup.ref}-0`)?.focus();
      return void setNewName("");
    }
    setRows((list) => [...list, { ref, userId: user?.id ?? null, name: user?.name ?? name, texts: Array<string>(7).fill(""), added: true }]);
    setNewName("");
    // Yeni satırın ilk kutusu çizildikten sonra odaklanır
    requestAnimationFrame(() => document.getElementById(`${addId}-${ref}-0`)?.focus());
  }

  /** Geçen haftanın planı boş hücrelere kopyalanır (yazılmış hücrenin üstüne yazmaz); kaydedilene kadar taslaktır */
  function copyPrevious() {
    if (!previous?.length) return void toast.info("Geçen hafta için kayıtlı plan yok");
    let copied = 0;
    const next = rows.map((r) => ({ ...r, texts: [...r.texts] }));
    for (const p of previous) {
      let row = next.find((r) => r.ref === p.ref);
      if (!row) {
        if (next.length >= SHIFT_PEOPLE_MAX) continue;
        next.push((row = { ref: p.ref, userId: p.userId, name: p.name, texts: Array<string>(7).fill(""), added: true }));
      }
      p.texts.forEach((t, i) => {
        if (t && !row.texts[i].trim()) {
          row.texts[i] = t;
          copied++;
        }
      });
    }
    if (!copied) return void toast.info("Kopyalanacak boş hücre yok", { description: "Geçen haftanın planı yalnız boş hücrelere kopyalanır." });
    setSavedNote(null);
    setRows(next);
    toast.success(`Geçen haftadan ${copied} hücre kopyalandı`, { description: "Düzenleyip Kaydet'e basın; kaydedilene kadar taslaktır." });
  }

  /**
   * Yazılan metni plana işler. İstek sürerken ızgara kilitlidir (`inert`): dönen taslak, gönderildiği andaki satırların
   * üstüne yazılır. Sonuç kaydedilmez; değişen kutular mavi görünür, "Kaydet" bütün haftayı yazar, "Taslağı geri al"
   * taslaktan önceki hâle döner.
   */
  function draftFromPrompt() {
    const text = prompt.trim();
    if (text.length < SHIFT_PROMPT_MIN) return void document.getElementById(`${addId}-yaz`)?.focus();
    const snapshot = rows;
    runDraft(async () => {
      // Okunamayan kutu boş gider: ekranda zaten kırmızıdır, taslak onun üstüne yazabilir
      const res = await draftShiftWeekAction({ branchId: branch.id, week: monday, prompt: text, rows: snapshot.map((r) => ({ ref: r.ref, name: r.name, cells: r.texts.map((t) => (read(t).ok ? norm(t) : "")) })) });
      if (!res.ok) return void setDraftNote({ tone: "bad", title: "Plan doldurulamadı", text: res.error, lines: [], undo: null });
      const applied = applyDraft(snapshot, res.data, norm);
      const lines = [...res.data.skipped, ...(res.data.unclear ? [res.data.unclear] : [])];
      if (!applied.changed && !applied.people) {
        return void setDraftNote({
          tone: "neutral",
          title: "Değişen kutu yok",
          text: lines.length ? "Yazdıklarınız plana işlenemedi; aşağıdaki nota bakıp yeniden yazın." : "Yazdıklarınız planla aynı. Başka bir şey yazabilirsiniz.",
          lines,
          undo: null,
        });
      }
      setSavedNote(null);
      setRows(applied.rows);
      setDraftNote({
        tone: lines.length ? "neutral" : "good",
        title: `Taslak hazır: ${draftSummary(applied.changed, applied.people)}`,
        text: lines.length ? "Bir kısmı işlenemedi. Kutuları kontrol edin; plan Kaydet'e basınca yazılır." : "Kutuları kontrol edin; plan Kaydet'e basınca yazılır.",
        lines,
        undo: snapshot,
      });
      // Her şey işlendiyse kutu boşalır; işlenemeyen varsa metin düzeltilmek üzere kalır
      if (!lines.length) setPrompt("");
    });
  }

  function save() {
    if (problems.length) return void toast.error(problems[0].text);
    run(async () => {
      const res = await saveShiftWeekAction({ branchId: branch.id, week: monday, rows: rows.map((r) => ({ ref: r.ref, name: r.name, cells: r.texts.map(norm) })) });
      if (!res.ok) return void toast.error(res.error);
      const r = res.data;
      setSavedNote(r.summary);
      if (!r.written && !r.removed) return void toast.info("Değişiklik yok; plan zaten kayıtlı");
      toast.success("Vardiya planı kaydedildi", {
        description: `${weekLabel(monday)} · ${r.summary}. PDF güncellendi.`,
        action: { label: "PDF'i aç", onClick: () => window.open(r.pdf, "_blank", "noopener") },
      });
    });
  }

  /** Aynı günün bir alt kutusuna geçer (Enter) */
  function focusBelow(ref: string, day: number) {
    const i = rows.findIndex((r) => r.ref === ref);
    const next = rows[i + 1];
    if (next) document.getElementById(`${addId}-${next.ref}-${day}`)?.focus();
  }

  /** Bir kişinin bir gününün kutusu (masaüstü ızgarası ve telefonun gün listesi aynı kutuyu çizer) */
  const cellInput = (r: GridRow, i: number, className: string) => {
    const t = r.texts[i];
    const invalid = bad.has(`${r.ref}|${i}`);
    return (
      <Input
        id={`${addId}-${r.ref}-${i}`}
        value={t}
        onChange={(e) => setText(r.ref, i, e.target.value)}
        onBlur={() => tidy(r.ref, i)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          tidy(r.ref, i);
          focusBelow(r.ref, i);
        }}
        maxLength={80}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="next"
        placeholder="–"
        aria-label={`${r.name}, ${dayLong(days[i], i)}`}
        aria-invalid={invalid || undefined}
        title={invalid ? SHIFT_TEXT.format : t || undefined}
        className={cn("px-2 tabular", cellOfText(t)?.kind === "off" && "text-ink-mute", norm(t) !== (before.get(r.ref)?.[i] ?? "") && !invalid && "ring-info/50", className)}
      />
    );
  };

  /**
   * Bir kişinin bir gününün seçim düğmeleri: S (sabahçı), A (akşamcı), İ (izin). Tıklanan yazılır, seçili olana yeniden
   * tıklamak kutuyu boşaltır. Altında saatler (ve not); elle yazılmış başka saat de orada görünür, bir harf seçilince
   * onun yerine geçer
   */
  const cellPicker = (r: GridRow, i: number, big = false) => {
    const t = r.texts[i];
    const cell = cellOfText(t);
    const preset = presetOf(branch.id, cell);
    const chosen = cell?.kind === "off" ? "off" : (preset?.key ?? null);
    const invalid = bad.has(`${r.ref}|${i}`);
    const changed = norm(t) !== (before.get(r.ref)?.[i] ?? "");
    const under = invalid ? t : cell ? (cell.kind === "off" ? (cell.note ?? "İzin") : formatShiftCell(cell)) : "–";
    return (
      <div className={cn(big ? "flex items-center gap-3" : "min-w-[5.5rem]")}>
        <div role="group" aria-label={`${r.name}, ${dayLong(days[i], i)}`} className={cn("inline-flex shrink-0", big ? "gap-1.5" : "gap-1")}>
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={chosen === c.key}
              aria-label={c.title}
              title={c.title}
              onClick={() => setText(r.ref, i, chosen === c.key ? "" : c.text)}
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-lg text-[13px] font-semibold ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none",
                big ? "size-11" : "size-7 pointer-coarse:size-10",
                chosen === c.key ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-mute ring-line-strong hover:text-ink hover:ring-ink/30",
              )}
            >
              {c.short}
            </button>
          ))}
        </div>
        <span
          className={cn(
            "block tabular",
            // Telefonda saat ve not kesilmez (iki satıra iner); masaüstü ızgarasında dar sütunda kesilir
            big ? "min-w-0 flex-1 text-[13px] leading-5 break-words" : "mt-0.5 max-w-[7rem] truncate text-[11px] leading-4",
            invalid ? "text-bad" : changed ? "text-info" : cell ? "text-ink-mute" : "text-ink-quiet",
          )}
          title={invalid ? SHIFT_TEXT.format : cell ? formatShiftCell(cell) : undefined}
        >
          {under}
        </span>
      </div>
    );
  };

  /** Satırın eylemi: bu oturumda eklenen satır kaldırılır, kayıtlı satırın haftası boşaltılır */
  const rowAction = (r: GridRow) =>
    r.added ? (
      <IconButton label={`${r.name} satırını kaldır`} onClick={() => setRows((list) => list.filter((x) => x.ref !== r.ref))}>
        <X size={14} />
      </IconButton>
    ) : r.texts.some((t) => t.trim()) ? (
      <IconButton
        label={`${r.name} haftasını boşalt`}
        onClick={() => {
          setSavedNote(null);
          setRows((list) => list.map((x) => (x.ref === r.ref ? { ...x, texts: Array<string>(7).fill("") } : x)));
        }}
      >
        <Eraser size={14} />
      </IconButton>
    ) : null;

  const pdfButton = (
    <a
      href={pdf}
      target="_blank"
      rel="noopener"
      className={buttonClass("secondary", "sm")}
      title="Kaydedilen planın PDF'i (yeni sekmede)"
      onClick={(e) => {
        if (!dirty) return;
        e.preventDefault();
        toast.info("Önce kaydedin", { description: "PDF kaydedilen planı gösterir; yazdıklarınız henüz kaydedilmedi." });
      }}
    >
      <FileDown size={14} aria-hidden="true" /> PDF
    </a>
  );

  const mine = rows.find((r) => r.ref === meRef);
  const empty = !planned.length;

  /** Salt okunur değer (personelin telefondaki listeleri): saatler tek satırda, altında hazır vardiyanın adı ve not */
  const shiftValue = (text: string) => {
    const cell = cellOfText(text);
    const under = [presetLabel(text), cell?.kind === "work" ? cell.note : null].filter(Boolean).join(" · ");
    return (
      <span className={cn("shrink-0 text-right text-sm tabular", cell?.kind === "work" ? "font-semibold text-ink" : "text-ink-mute")}>
        <span className="block whitespace-nowrap">{cell ? (cell.kind === "work" ? shiftTimes(cell) : formatShiftCell(cell)) : "–"}</span>
        {under ? <span className="block max-w-[11rem] truncate text-xs font-normal text-ink-mute">{under}</span> : null}
      </span>
    );
  };

  if (!canEdit) {
    return (
      <div className="space-y-4">
        {mine && mine.texts.some((t) => t.trim()) ? (
          <Card>
            <CardHeader icon={<CalendarRange />} title="Benim haftam" description={`${weekLabel(monday)} · ${hoursLabel(minutesOf(mine.texts))}`} actions={pdfButton} />
            <ul className="mx-5 mb-5 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {days.map((d, i) => (
                <li key={d} className={cn("flex items-start justify-between gap-3 px-4 py-2.5", d === today && "bg-panel/60")}>
                  <span className="min-w-0 text-sm text-ink-mute">
                    {dayLong(d, i)}
                    {d === today ? <span className="block text-xs font-medium text-ink">bugün</span> : null}
                  </span>
                  {shiftValue(mine.texts[i])}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card>
          <CardHeader
            icon={<CalendarRange />}
            title={`${branch.name} · ${weekLabel(monday)}`}
            description={empty ? undefined : `${planned.length} kişi · toplam ${hoursLabel(totalMinutes)}`}
            actions={empty || (mine && mine.texts.some((t) => t.trim())) ? undefined : pdfButton}
          />
          {empty ? (
            <EmptyState icon={<CalendarRange />} title="Bu hafta için vardiya yazılmadı" description="Yönetici planı kaydedince burada görünür." />
          ) : phone ? (
            // Telefon: gün seçilir, o günün planı kişi kişi alt alta (yedi sütunluk tablo yana kayardı)
            <div className="px-5 pb-4">
              <DayPicker days={days} today={today} value={day} onChange={setDay} />
              <p className="mt-2 mb-2 text-[13px] text-ink-mute">
                {dayLong(days[day], day)}
                {days[day] === today ? " · bugün" : ""} · {headcount[day] ? `${headcount[day]} kişi çalışıyor` : "çalışan yazılmadı"}
              </p>
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {planned.map((r) => (
                  <li key={r.ref} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 text-sm leading-5 font-medium break-words text-ink">
                      {r.name}
                      {r.ref === meRef ? (
                        <Badge tone="blue" className="ml-2">
                          Siz
                        </Badge>
                      ) : null}
                    </span>
                    {shiftValue(r.texts[day])}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-ink-mute tabular">Haftanın toplamı {hoursLabel(totalMinutes)}</p>
            </div>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH sticky>Kişi</TH>
                    {days.map((d, i) => (
                      <TH key={d} className={cn(d === today && "text-info")}>
                        {dayHeading(d, i, crossMonth)}
                      </TH>
                    ))}
                    <TH numeric>Toplam</TH>
                  </tr>
                </THead>
                <tbody>
                  {planned.map((r) => (
                    <TR key={r.ref}>
                      <TD sticky className="font-medium whitespace-nowrap">
                        {r.name}
                        {r.ref === meRef ? (
                          <Badge tone="blue" className="ml-2">
                            Siz
                          </Badge>
                        ) : null}
                      </TD>
                      {r.texts.map((t, i) => {
                        const cell = cellOfText(t);
                        return (
                          <TD key={i} className={cn("whitespace-nowrap tabular", cell?.kind === "work" ? "text-ink" : "text-ink-quiet")}>
                            {cell ? formatShiftCell(cell) : "–"}
                            {presetLabel(t) ? <span className="block text-[11px] leading-4 text-ink-mute">{presetLabel(t)}</span> : null}
                          </TD>
                        );
                      })}
                      <TD numeric className="font-semibold">
                        {hoursLabel(minutesOf(r.texts))}
                      </TD>
                    </TR>
                  ))}
                </tbody>
                <tfoot>
                  <TFootRow>
                    <TD sticky className="text-ink-mute">
                      Çalışan
                    </TD>
                    {headcount.map((n, i) => (
                      <TD key={i} className="font-normal text-ink-mute tabular">
                        {n ? `${n} kişi` : "–"}
                      </TD>
                    ))}
                    <TD numeric>{hoursLabel(totalMinutes)}</TD>
                  </TFootRow>
                </tfoot>
              </Table>
            </TableWrap>
          )}
          {updatedText ? <CardFooter>{updatedText}</CardFooter> : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {savedNote !== null && !dirty ? (
        <Notice
          tone="good"
          size="sm"
          live="polite"
          title="Plan kayıtlı; PDF güncel"
          text={savedNote}
          action={
            <a href={pdf} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">
              PDF&apos;i aç
            </a>
          }
        />
      ) : null}
      {problems.length ? <Notice tone="bad" size="sm" live="polite" title={problems.length > 1 ? `${problems.length} hücre okunamadı` : "Bir hücre okunamadı"} text={problems[0].text} /> : null}
      <Card>
        <CardHeader
          icon={<CalendarRange />}
          title={`${branch.name} · ${weekLabel(monday)}`}
          description={presets.length ? "Kutularda S (sabahçı), A (akşamcı) ya da İ (izin) seçin; başka saat için “Elle yaz”. Boş kutu: planlanmadı." : "Kutulara saatleri yazın: “10-18”, “18-02 bar”, izin için “izin”. Boş kutu: planlanmadı."}
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={copyPrevious} disabled={pending}>
                <Copy size={14} aria-hidden="true" /> Geçen haftayı kopyala
              </Button>
              {pdfButton}
            </>
          }
        />
        {/* Yazarak doldurma: haftayı düz cümleyle yazınca kutular taslak olarak dolar (src/lib/vardiya-taslak.ts) */}
        {draftState === "on" ? (
          <form
            className="px-5 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              draftFromPrompt();
            }}
          >
            <label htmlFor={`${addId}-yaz`} className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Sparkles size={15} aria-hidden="true" className="text-ink-mute" /> Yazarak doldur
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-start">
              <Textarea
                id={`${addId}-yaz`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // Ctrl / ⌘ + Enter gönderir; yalın Enter yeni satır
                  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
                  e.preventDefault();
                  draftFromPrompt();
                }}
                rows={2}
                maxLength={SHIFT_PROMPT_MAX}
                disabled={drafting}
                enterKeyHint="enter"
                placeholder="Ayşe hafta içi sabahçı, Mehmet akşamcı. Zeynep Salı izinli. Hafta sonu herkes akşamcı."
                aria-describedby={`${addId}-yaz-ipucu`}
                className="min-h-[4.5rem] flex-1 sm:min-h-[3.25rem]"
              />
              <Button type="submit" disabled={drafting || pending || prompt.trim().length < SHIFT_PROMPT_MIN} className="max-sm:w-full sm:mt-0.5">
                <Sparkles size={15} aria-hidden="true" />
                {drafting ? "Hazırlanıyor…" : "Plana işle"}
              </Button>
            </div>
            <p id={`${addId}-yaz-ipucu`} className="mt-1.5 text-[13px] text-ink-mute">
              Kimin hangi gün sabahçı, akşamcı ya da izinli olduğunu yazın; başka saat de yazılır (“Can Cuma 12-20”). Sonuç taslaktır, Kaydet&apos;e basana kadar plan değişmez.
            </p>
            {draftNote ? (
              <Notice
                className="mt-2"
                tone={draftNote.tone}
                size="sm"
                live={draftNote.tone === "bad" ? "assertive" : "polite"}
                title={draftNote.title}
                text={draftNote.text}
                defaultOpen={draftNote.lines.length > 0}
                detailsLabel="İşlenemeyenler"
                action={
                  draftNote.undo ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        if (draftNote.undo) setRows(draftNote.undo);
                        setDraftNote(null);
                      }}
                    >
                      <Undo2 size={13} aria-hidden="true" /> Taslağı geri al
                    </Button>
                  ) : undefined
                }
              >
                {draftNote.lines.length ? (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {draftNote.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}
          </form>
        ) : draftState ? (
          <div className="px-5 pb-4">
            <Notice
              tone="neutral"
              size="sm"
              title={DRAFT_OFF[draftState].title}
              text={DRAFT_OFF[draftState].text}
              action={draftState === "off" ? <NoticeLink href="/panel/ayarlar">Ayarlar</NoticeLink> : undefined}
              tech={
                draftState === "nokey" ? (
                  <>
                    Vercel&apos;de <code>ANTHROPIC_API_KEY</code> (Production) tanımlanınca açılır; fotoğraftan okumayla aynı anahtardır.
                  </>
                ) : undefined
              }
            />
          </div>
        ) : null}
        {/* Doldurma biçimi: seçerek (S / A / İ düğmeleri) ya da elle yazarak. Sabahçı ve akşamcının saatleri şubeye göre (src/lib/vardiya.ts) */}
        <div className="px-5 pb-3">
          {presets.length ? (
            <Segmented
              label="Doldurma biçimi"
              value={mode}
              onChange={setMode}
              options={[
                { value: "pick", label: "Seçerek" },
                { value: "type", label: "Elle yaz" },
              ]}
            />
          ) : null}
          <p className={cn("text-[13px] text-ink-mute", presets.length > 0 && "mt-1.5")} aria-live="polite">
            {mode === "pick"
              ? `${choices.map((c) => `${c.short} = ${c.title}`).join(" · ")}. Seçili harfe yeniden tıklayınca kutu boşalır.`
              : presets.length
                ? `Saatleri yazın: “10-18”, “18-02 bar”, “izin”. Kısaltma: ${presets.map((p) => `“${presetShort(p).toLocaleLowerCase("tr-TR")}” ${p.label.toLocaleLowerCase("tr-TR")}`).join(", ")}.`
                : "Saatleri yazın: “10-18”, “18-02 bar”, “izin”."}
          </p>
        </div>
        {phone ? (
          // Telefon: gün seçilir, o günün kutuları kişi kişi alt alta (yatay kaydırma yok). Taslak hazırlanırken kilitli
          <div className={cn("px-5 pb-4", drafting && "opacity-60")} inert={drafting} aria-busy={drafting || undefined}>
            <DayPicker days={days} today={today} value={day} onChange={setDay} />
            <p className="mt-2 mb-2 text-[13px] text-ink-mute">
              {dayLong(days[day], day)}
              {days[day] === today ? " · bugün" : ""} · {headcount[day] ? `${headcount[day]} kişi çalışıyor` : "çalışan yazılmadı"}
            </p>
            {rows.length ? (
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {rows.map((r) => {
                  const minutes = minutesOf(r.texts);
                  return (
                    // Ad kendi satırında (dar telefonda kesilmez); altında o günün düğmeleri ya da kutusu tam genişlikte
                    <li key={r.ref} className="px-3 py-2.5">
                      <div className="flex min-h-9 items-center gap-2">
                        <p className="min-w-0 flex-1 text-sm leading-5 font-medium break-words text-ink">
                          {r.name}
                          <span className="ml-2 text-xs font-normal whitespace-nowrap text-ink-mute tabular">
                            {r.userId === null ? "hesabı yok · " : ""}
                            {minutes ? `hafta ${hoursLabel(minutes)}` : "hafta boş"}
                          </span>
                        </p>
                        <div className="flex shrink-0 justify-end">{rowAction(r)}</div>
                      </div>
                      <div className="mt-1.5">
                        {mode === "pick" ? (
                          cellPicker(r, day, true)
                        ) : (
                          <>
                            {cellInput(r, day, "")}
                            {presetLabel(r.texts[day]) ? <span className="mt-0.5 block px-2 text-[11px] leading-4 text-ink-mute">{presetLabel(r.texts[day])}</span> : null}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-mute ring-1 ring-line">Bu şubede personel hesabı yok. Aşağıdan kişi ekleyin.</p>
            )}
            <p className="mt-2 text-[13px] text-ink-mute tabular">Haftanın toplamı {hoursLabel(totalMinutes)}</p>
          </div>
        ) : (
          <TableWrap className={cn(drafting && "opacity-60")} inert={drafting} aria-busy={drafting || undefined}>
            <Table>
              <THead>
                <tr>
                  <TH sticky>Kişi</TH>
                  {days.map((d, i) => (
                    <TH key={d} className={cn("px-2", d === today && "text-info")} title={dayLong(d, i)}>
                      {dayHeading(d, i, crossMonth)}
                    </TH>
                  ))}
                  <TH numeric className="px-2">
                    Toplam
                  </TH>
                  <TH aria-label="Satır eylemleri" className="px-0.5" />
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => {
                  const minutes = minutesOf(r.texts);
                  return (
                    <TR key={r.ref}>
                      <TD sticky className="py-2 pr-1 font-medium">
                        <span className="block max-w-28 min-w-20 truncate xl:max-w-40" title={r.name}>
                          {r.name}
                        </span>
                        {r.userId === null ? <span className="block text-xs font-normal text-ink-quiet">hesabı yok</span> : null}
                      </TD>
                      {r.texts.map((text, i) => {
                        // Kutunun altında küçük yazı: hazır vardiyanın adı ve not (dar kutuda not kesilir)
                        const under = [presetLabel(text), cellOfText(text)?.note].filter(Boolean).join(" · ");
                        return mode === "pick" ? (
                          <TD key={i} className="px-1 py-1.5 align-top">
                            {cellPicker(r, i)}
                          </TD>
                        ) : (
                          <TD key={i} className="px-0.5 py-1.5 align-top">
                            {cellInput(r, i, "min-w-[5.5rem] px-1.5 sm:text-[13px]")}
                            {under ? <span className="mt-0.5 block max-w-[7rem] truncate px-1.5 text-[11px] leading-4 text-ink-mute">{under}</span> : null}
                          </TD>
                        );
                      })}
                      <TD numeric className={cn("px-2 font-semibold", !minutes && "font-normal text-ink-quiet")}>
                        {minutes ? hoursLabel(minutes) : "–"}
                      </TD>
                      <TD className="w-9 px-0.5 py-1.5 text-right">{rowAction(r)}</TD>
                    </TR>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-sm text-ink-mute">
                      Bu şubede personel hesabı yok. Aşağıdan kişi ekleyin; hesabı olmayan çalışan adıyla yazılır.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {rows.length ? (
                <tfoot>
                  <TFootRow>
                    <TD sticky className="text-ink-mute">
                      Çalışan
                    </TD>
                    {headcount.map((n, i) => (
                      <TD key={i} className="px-2 font-normal text-ink-mute tabular">
                        {n ? `${n} kişi` : "–"}
                      </TD>
                    ))}
                    <TD numeric className="px-2">
                      {hoursLabel(totalMinutes)}
                    </TD>
                    <TD />
                  </TFootRow>
                </tfoot>
              ) : null}
            </Table>
          </TableWrap>
        )}
        <form
          className="flex flex-wrap items-center gap-2 px-5 pt-1 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            addPerson();
          }}
        >
          <Input
            id={addId}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            list={`${addId}-kisiler`}
            maxLength={SHIFT_NAME_MAX}
            autoComplete="off"
            placeholder="Kişi ekle: ad yazın"
            aria-label="Eklenecek kişinin adı"
            className="max-w-64"
          />
          <datalist id={`${addId}-kisiler`}>
            {others.map((u) => (
              <option key={u.id} value={u.name} />
            ))}
          </datalist>
          <Button type="submit" variant="secondary" disabled={pending}>
            <UserPlus size={15} aria-hidden="true" /> Kişi ekle
          </Button>
          <p className="basis-full text-xs text-ink-mute">Hesabı olan kişi adından bulunur; hesabı olmayan çalışan yalnız adıyla yazılır.</p>
        </form>
        {updatedText ? <CardFooter>{updatedText}</CardFooter> : null}
      </Card>

      <FloatingBar open={dirty}>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-semibold text-ink">{changes} değişiklik</p>
          <p className={cn("truncate text-xs", problems.length ? "font-medium text-bad" : "text-ink-mute")}>{problems.length ? problems[0].text : "Kaydedilmedi; PDF kaydedince güncellenir"}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" onClick={() => setDiscardOpen(true)} disabled={pending} aria-label="Değişikliklerden vazgeç" className="max-sm:size-10 max-sm:px-0">
            <Undo2 size={16} aria-hidden="true" />
            <span className="max-sm:sr-only">Vazgeç</span>
          </Button>
          <Button onClick={save} disabled={pending || drafting || problems.length > 0} size="lg" className="max-sm:px-4">
            <Save size={18} aria-hidden="true" />
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </FloatingBar>

      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          setRows(saved);
        }}
        title="Değişikliklerden vazgeçilsin mi?"
        description="Yazdıklarınız silinir, kaydedilen plan geri gelir."
        confirmLabel="Vazgeç ve geri al"
      />
      <ConfirmDialog
        open={leaveHref !== null}
        onClose={() => setLeaveHref(null)}
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          if (href) router.push(href);
        }}
        title="Kaydedilmemiş vardiya var"
        confirmLabel="Kaydetmeden geç"
        description={`${weekLabel(monday)} haftasına yazdıklarınız henüz kaydedilmedi; başka haftaya, şubeye ya da sayfaya geçerseniz kaybolur. Kalmak için Vazgeç'e basıp Kaydet'i kullanın.`}
      />
    </div>
  );
}
