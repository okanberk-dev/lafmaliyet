"use client";

import { Check, CircleCheck, Undo2 } from "lucide-react";
import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, NumberInput, Textarea } from "@/components/ui/form";
import { Progress } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import {
  DAY_CLOSED_TEXT,
  groupBySection,
  inRange,
  NOTE_MAX,
  parseReading,
  rangeText,
  runSummary,
  signMode,
  timeTR,
  valueText,
  whoText,
  type AnswerLite,
  type ChecklistItemSnap,
  type RunLite,
} from "@/lib/checklists";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { answerChecklistItem } from "@/server/actions/checklists";

import { PhotoItem } from "./photo-item";

/** Sunucuya giden işlem (fotoğraf hariç: o /api/kontrol/foto'dan) */
type Op = { op: "ok" } | { op: "issue"; note: string } | { op: "value"; value: number; note: string | null } | { op: "text"; text: string } | { op: "note"; note: string | null } | { op: "clear" };

/** Maddenin kaydetme işlevi: iyimser yanıt hemen görünür, sunucu yanıtı gelince yerini alır; başarı döner */
export type Submit = (item: ChecklistItemSnap, op: Op, optimistic?: AnswerLite | null) => Promise<boolean>;

/** Sıcaklık maddesinde aralık dışı ölçümün hazır notları (nota eklenir) */
const QUICK_NOTES = ["Kapı kapatıldı", "Termostat ayarlandı", "Ürünler başka dolaba alındı", "Servis arandı"];

/** Eylem hiç yanıt vermedi (ağ kesik); fotoğraf yüklemesinin bağlantı hatasıyla aynı söz */
const OFFLINE_TEXT = "Kaydedilemedi: bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.";
/** Sayfa eski sürümün eylemini çağırdı (bu arada panel güncellendi): yenileyince düzelir */
const STALE_TEXT = "Panel güncellendi; sayfayı yenileyip yeniden deneyin.";

/**
 * Listeyi doldurma formu. Yanıtlar sunucudan gelir (prop); yerelde yalnız katmanlar durur: işaretlerin iyimser hâli
 * (useOptimistic; eylemin refresh()'i sayfayı yeniler) ve yüklenen fotoğrafın yanıtı (sayfa yenilenene kadar).
 * Bileşen yalnız liste ve günle anahtarlanır, verinin sürümüyle değil: bir fotoğrafın ardından gelen yenileme
 * yüklenmekte olan başka bir fotoğrafı silmez. Gün kapandıktan sonra gelen ret sayfayı yeniler (yeni günün listesi).
 */
export function RunForm({
  templateId,
  day,
  title,
  items,
  answers,
  completedAt,
  renderedAt,
  photos,
  me,
}: {
  templateId: number;
  day: string;
  title: string;
  items: ChecklistItemSnap[];
  answers: AnswerLite[];
  completedAt: string | null;
  /** Sayfanın sunucuda çizildiği an: bundan yeni fotoğraf yanıtı sayfadakinden yenidir */
  renderedAt: string;
  photos: boolean;
  me: string;
}) {
  const router = useRouter();
  const [, start] = useActionTransition();
  // Yüklenen fotoğrafların yanıtı: sayfa yenilenip (renderedAt ilerleyince) sunucunun yanıtı gelene kadar
  const [uploaded, setUploaded] = useState<Record<number, AnswerLite>>({});
  const base = useMemo(() => {
    const m = new Map<number, AnswerLite | null>(answers.map((a) => [a.itemId, a]));
    for (const [id, a] of Object.entries(uploaded)) if (Date.parse(a.at) > Date.parse(renderedAt)) m.set(Number(id), a);
    return m;
  }, [answers, uploaded, renderedAt]);
  const [shown, setShown] = useOptimistic(base, (state: Map<number, AnswerLite | null>, p: { itemId: number; answer: AnswerLite | null }) => {
    const next = new Map(state);
    next.set(p.itemId, p.answer);
    return next;
  });
  const list = useMemo(() => [...shown.values()].filter((a): a is AnswerLite => a !== null), [shown]);
  const summary = runSummary(items, list, completedAt);

  const refused = (error: string) => {
    toast.error(error);
    // Gün 05:00'te döndü (ya da liste değişti): sayfa yeni günün listesini açar
    if (error === DAY_CLOSED_TEXT || error.startsWith("Liste değişti")) router.refresh();
  };

  // Eylem atılırsa (ağ kesildi, panel güncellendi) hata geçişten taşıp sayfayı hata ekranına düşürmesin: iyimser
  // işaret geçiş bitince kendiliğinden geri döner, açık not alanları ve bekleyen fotoğraf yerinde kalır. Bildirimler
  // tek kimlikle: art arda dokunuşlar üst üste yığılmaz.
  const unreachable = (e: unknown) => {
    if (unstable_isUnrecognizedActionError(e)) {
      toast.error(STALE_TEXT, { id: "kontrol-kayit", duration: 30_000, action: { label: "Yenile", onClick: () => window.location.reload() } });
    } else {
      toast.error(OFFLINE_TEXT, { id: "kontrol-kayit" });
    }
  };

  const submit: Submit = (item, op, optimistic) =>
    new Promise((resolve) => {
      start(async () => {
        if (optimistic !== undefined) setShown({ itemId: item.id, answer: optimistic });
        let res: Awaited<ReturnType<typeof answerChecklistItem>>;
        try {
          res = await answerChecklistItem({ templateId, date: day, itemId: item.id, ...op });
        } catch (e) {
          unreachable(e);
          resolve(false);
          return;
        }
        if (!res.ok) {
          refused(res.error);
          resolve(false);
          return;
        }
        if (res.data.completedNow) toast.success(`${title} tamam. Teşekkürler!`);
        resolve(true);
      });
    });

  const onUploaded = (itemId: number, answer: AnswerLite, completedNow: boolean) => {
    setUploaded((u) => ({ ...u, [itemId]: answer }));
    if (completedNow) toast.success(`${title} tamam. Teşekkürler!`);
    router.refresh();
  };

  /** İyimser yanıt: kişinin adı ve şimdiki an, önceki sürümler korunur */
  const draft = (item: ChecklistItemSnap, fields: Partial<AnswerLite>): AnswerLite => {
    const prev = shown.get(item.id) ?? null;
    return {
      id: prev?.id ?? -item.id,
      itemId: item.id,
      status: "ok",
      value: null,
      textValue: null,
      note: null,
      photoId: null,
      photoAt: null,
      by: me,
      at: new Date().toISOString(),
      history: prev?.history ?? [],
      ...fields,
    };
  };

  return (
    <div className="max-w-3xl space-y-5 pb-6">
      <ProgressBar summary={summary} />
      {summary.complete ? (
        <Notice
          tone="good"
          live="polite"
          title={`Liste tamam${summary.completedAt ? ` · ${timeTR(summary.completedAt)}` : ""} · ${whoText(summary.contributors)}`}
          action={
            <ButtonLink href="/panel/bugun" variant="secondary" size="xs">
              Bugün&apos;e dön
            </ButtonLink>
          }
        />
      ) : null}
      {groupBySection(items).map((g) => (
        <section key={g.section ?? "-"} aria-label={g.section ?? "Maddeler"} className="space-y-2.5">
          {g.section ? <h2 className="px-1 text-[12px] font-semibold tracking-wide text-ink-mute uppercase">{g.section}</h2> : null}
          {g.items.map((item) => {
            const answer = shown.get(item.id) ?? null;
            return (
              <ItemRow key={item.id} item={item} answer={answer}>
                {item.type === "check" ? (
                  <CheckItem item={item} answer={answer} submit={submit} draft={draft} />
                ) : item.type === "number" ? (
                  <NumberItem item={item} answer={answer} submit={submit} draft={draft} />
                ) : item.type === "text" ? (
                  <TextItem item={item} answer={answer} submit={submit} draft={draft} />
                ) : (
                  <PhotoItem item={item} answer={answer} templateId={templateId} day={day} photos={photos} submit={submit} onUploaded={onUploaded} onRefused={refused} />
                )}
              </ItemRow>
            );
          })}
        </section>
      ))}
      <ButtonLink href="/panel/bugun" variant="ghost" className="max-sm:h-12 max-sm:w-full">
        Bugün&apos;e dön
      </ButtonLink>
    </div>
  );
}

/** Yapışkan ilerleme: "3 / 11 madde · 1 fotoğraf kaldı"; tamamken "Liste tamam" */
function ProgressBar({ summary: s }: { summary: RunLite }) {
  return (
    <div className="sticky top-(--mobile-top-h) z-20 -mx-4 border-b border-line bg-background/90 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <p role="status" aria-live="polite" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink tabular">
        {s.complete ? (
          <>
            <CircleCheck size={16} className="text-good" aria-hidden="true" /> Liste tamam
          </>
        ) : (
          <>
            {num(s.done)} / {num(s.required)} madde
            {s.photosLeft ? <span className="font-normal text-ink-mute"> · {num(s.photosLeft)} fotoğraf kaldı</span> : null}
          </>
        )}
      </p>
      <Progress value={s.required ? s.done / s.required : s.complete ? 1 : 0} tone={s.complete ? "green" : "ink"} />
    </div>
  );
}

/** Bir maddenin satırı: ad, "isteğe bağlı", ipucu, yanıt veren ve saati */
function ItemRow({ item, answer, children }: { item: ChecklistItemSnap; answer: AnswerLite | null; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-[15px] leading-6 font-medium text-pretty text-ink">
          {item.label}
          {!item.required ? <span className="ml-2 text-xs font-normal text-ink-mute">isteğe bağlı</span> : null}
        </p>
        {answer ? <Meta answer={answer} /> : null}
      </div>
      {item.hint ? <p className="-mt-2 mb-3 text-[13px] leading-5 text-ink-mute">{item.hint}</p> : null}
      {children}
    </div>
  );
}

function Meta({ answer }: { answer: AnswerLite }) {
  return (
    <span className="shrink-0 text-xs text-ink-mute tabular">
      {answer.by} · {timeTR(answer.at)}
    </span>
  );
}

/** Metin düğmesi (Geri al, Düzelt, Değiştir): satır içi, dokunmatikte 44 px */
function TextButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} className="text-ink underline decoration-line-strong underline-offset-2">
      {children}
    </Button>
  );
}

type ItemProps = {
  item: ChecklistItemSnap;
  answer: AnswerLite | null;
  submit: Submit;
  draft: (item: ChecklistItemSnap, fields: Partial<AnswerLite>) => AnswerLite;
};

/** Sorunlu hâli olan yanıt geri alınmaz (ilk sorun kaydı kalsın): "Geri al" yerine "Düzelt" */
const hadIssue = (a: AnswerLite) => a.status === "issue" || a.history.some((v) => v.status === "issue");

// ---------------------------------------------------------------- Tamam / Sorun var

function CheckItem({ item, answer, submit, draft }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ok = () => {
    setEditing(false);
    void submit(item, { op: "ok" }, draft(item, { status: "ok" }));
  };
  const openEditor = () => {
    setNote(answer?.status === "issue" ? (answer.note ?? "") : "");
    setError(null);
    setEditing(true);
  };
  const saveIssue = async (e: FormEvent) => {
    e.preventDefault();
    const text = note.trim();
    if (!text) return setError("Sorunu kısaca yazın");
    setSaving(true);
    const done = await submit(item, { op: "issue", note: text }, draft(item, { status: "issue", note: text }));
    setSaving(false);
    if (done) setEditing(false);
  };

  if (editing) {
    return (
      <form onSubmit={saveIssue} className="space-y-3">
        <Field label="Ne sorun var?" error={error} htmlFor={`sorun-${item.id}`}>
          <Textarea
            id={`sorun-${item.id}`}
            value={note}
            maxLength={NOTE_MAX}
            placeholder="ör. buz makinesi su kaçırıyor"
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving} className="max-sm:h-12 max-sm:flex-1">
            Kaydet
          </Button>
          {answer ? (
            <Button variant="secondary" onClick={ok} disabled={saving} className="max-sm:h-12 max-sm:flex-1">
              <Check size={16} aria-hidden="true" /> Tamam
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving} className="max-sm:h-12">
            Vazgeç
          </Button>
        </div>
      </form>
    );
  }
  if (!answer) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={ok} className="flex-1 text-ink max-sm:h-12">
          <Check size={17} aria-hidden="true" /> Tamam
        </Button>
        <TextButton onClick={openEditor}>Sorun var</TextButton>
      </div>
    );
  }
  if (answer.status === "issue") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Notice tone="warn" size="sm" className="min-w-0 flex-1" title={`Sorun: ${answer.note}`} action={<TextButton onClick={openEditor}>Düzelt</TextButton>} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-good text-sm font-medium text-white max-sm:h-12">
        <Check size={17} aria-hidden="true" /> Tamam
      </p>
      {hadIssue(answer) ? (
        <TextButton onClick={openEditor}>Sorun var</TextButton>
      ) : (
        <TextButton onClick={() => void submit(item, { op: "clear" }, null)}>
          <Undo2 size={14} aria-hidden="true" /> Geri al
        </TextButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Sayı / sıcaklık

/** Alanın gösterdiği sayı: işaret düğmesi varsa işaretsiz (işareti düğme taşır) */
const rawOf = (v: number, signed: boolean) => (signed ? Math.abs(v) : v).toString().replace(".", ",");

function NumberItem({ item, answer, submit, draft }: ItemProps) {
  const mode = signMode(item);
  const signed = mode !== "none";
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const [negative, setNegative] = useState(mode === "negative");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const range = rangeText(item);
  const typed = parseReading(raw);
  // İşaret düğmesi "−" iken yazılan sayı eksi saklanır (iOS'un ondalık klavyesinde eksi yok)
  const value = typed === null ? null : signed && negative ? -Math.abs(typed) : typed;
  const out = value !== null && !inRange(item, value);
  const showInput = !answer || editing;
  const prevVersion = answer ? [...answer.history].reverse().find((v) => v.value !== null && v.value !== answer.value) : undefined;

  const startEdit = () => {
    if (answer?.value !== null && answer?.value !== undefined) {
      setRaw(rawOf(answer.value, signed));
      if (signed) setNegative(answer.value < 0);
    }
    setNote(answer?.note ?? "");
    setError(null);
    setEditing(true);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (value === null) return setError("Sayıyı yazın");
    // Not yalnız aralık dışı değerde istenir ve gösterilir; aralıktaki yeni ölçüm eski notu taşımaz (o, önceki hâlde kalır)
    const n = out ? note.trim() || null : null;
    if (out && !n) return setError("Ne yaptığınızı yazın");
    setSaving(true);
    const ok = await submit(item, { op: "value", value, note: n }, draft(item, { status: out ? "issue" : "ok", value, note: n }));
    setSaving(false);
    if (ok) {
      setEditing(false);
      setRaw("");
      setNote("");
    }
  };

  if (!showInput && answer && answer.value !== null) {
    const bad = answer.status === "issue";
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-3 py-1 text-sm font-semibold tabular", bad ? "bg-bad-soft text-bad" : "bg-lime/25 text-good-ink")}>
            {valueText(item, answer.value)}
            {bad ? " · aralık dışı" : ""}
          </span>
          {range ? <span className="text-[13px] text-ink-mute">İzin verilen: {range}</span> : null}
          <span className="ml-auto">
            <TextButton onClick={startEdit}>Değiştir</TextButton>
          </span>
        </div>
        {answer.note ? <p className="text-[13px] leading-5 text-pretty break-words text-ink-soft">Not: {answer.note}</p> : null}
        {prevVersion && prevVersion.value !== null ? (
          <p className="text-xs text-ink-mute">
            Önceki ölçüm: {valueText(item, prevVersion.value)} · {timeTR(prevVersion.at)}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-stretch gap-2">
          {signed ? (
            <Button
              variant="secondary"
              size="icon"
              aria-label={negative ? "Eksi (artıya çevir)" : "Artı (eksiye çevir)"}
              aria-pressed={negative}
              title="İşaret"
              onClick={() => setNegative((v) => !v)}
              className="shrink-0 text-lg font-semibold text-ink max-sm:size-12"
            >
              {negative ? "−" : "+"}
            </Button>
          ) : null}
          <div className="relative min-w-0 flex-1">
            <NumberInput
              aria-label={item.label}
              aria-describedby={range ? `aralik-${item.id}` : undefined}
              value={raw}
              placeholder="0"
              aria-invalid={error && !out ? true : undefined}
              data-warn={out ? true : undefined}
              onChange={(e) => {
                setRaw(e.target.value);
                setError(null);
              }}
              className={cn("max-sm:h-12", item.unit ? "pr-12" : "")}
            />
            {item.unit ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">{item.unit}</span> : null}
          </div>
          <Button type="submit" disabled={saving} className="shrink-0 max-sm:h-12">
            Kaydet
          </Button>
        </div>
        {error && !out ? (
          <p className="text-xs text-bad">{error}</p>
        ) : range ? (
          <p id={`aralik-${item.id}`} className="text-xs text-ink-mute">
            İzin verilen: {range}
          </p>
        ) : null}
      </div>
      {out && value !== null ? (
        <div className="space-y-2.5 rounded-xl bg-warn-soft p-3 text-[13px] text-warn">
          <label htmlFor={`not-${item.id}`} className="block font-medium">
            {valueText(item, value)} izin verilen aralığın dışında ({range}). Ne yaptınız?
          </label>
          <Textarea
            id={`not-${item.id}`}
            value={note}
            maxLength={NOTE_MAX}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            className="min-h-16"
          />
          {item.unit === "°C" ? (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_NOTES.map((q) => (
                <Button
                  key={q}
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    setNote((n) => (n.trim() ? `${n.trim().replace(/[.;,]$/, "")}; ${q.toLocaleLowerCase("tr-TR")}` : q));
                    setError(null);
                  }}
                >
                  {q}
                </Button>
              ))}
            </div>
          ) : null}
          {error ? <p className="text-xs text-bad">{error}</p> : null}
          <p className="text-xs text-warn/90">Yarım saat sonra yeniden ölçüp yeni değeri yazın; ilk ölçüm de kayıtta kalır.</p>
        </div>
      ) : null}
      {editing ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
          Vazgeç
        </Button>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------- Kısa not

function TextItem({ item, answer, submit, draft }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const showInput = !answer || editing;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t && !answer) return;
    setSaving(true);
    const ok = await submit(item, t ? { op: "text", text: t } : { op: "clear" }, t ? draft(item, { textValue: t }) : null);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setText("");
    }
  };

  if (!showInput && answer) {
    return (
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm leading-6 text-pretty break-words whitespace-pre-line text-ink">{answer.textValue}</p>
        <TextButton
          onClick={() => {
            setText(answer.textValue ?? "");
            setEditing(true);
          }}
        >
          Değiştir
        </TextButton>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      {/* İpucu satırın üstünde yazıyor: yer tutucu onu yinelemez */}
      <Input aria-label={item.label} value={text} maxLength={NOTE_MAX} placeholder="Kısa not" onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 max-sm:h-12" />
      <Button type="submit" disabled={saving || (!text.trim() && !answer)} className="max-sm:h-12">
        Kaydet
      </Button>
      {editing ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
          Vazgeç
        </Button>
      ) : null}
    </form>
  );
}
