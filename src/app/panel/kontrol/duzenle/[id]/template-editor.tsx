"use client";

import { ArrowDown, ArrowUp, Camera, CircleCheck, ListChecks, Pencil, Plus, RotateCcw, Thermometer, Trash2, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { ToggleRow } from "@/components/ui/toggle-row";
import { groupBySection, ITEM_TYPE_LABEL, ITEM_TYPES, listTitle, parseReading, PHOTO_PRIVACY_HINT, rangeText, type ChecklistItemType } from "@/lib/checklists";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteChecklistTemplate,
  moveChecklistItem,
  saveChecklistItem,
  setChecklistItemActive,
  updateChecklistTemplate,
} from "@/server/actions/checklists";
import type { TemplateDTO } from "@/server/data/checklists";

import { draftOf, fieldOf, TemplateFields, type BranchOption, type TemplateDraft } from "../template-fields";

type ItemDTO = TemplateDTO["items"][number];

const TYPE_ICON: Record<ChecklistItemType, ReactNode> = {
  check: <CircleCheck size={16} aria-hidden="true" />,
  photo: <Camera size={16} aria-hidden="true" />,
  number: <Thermometer size={16} aria-hidden="true" />,
  text: <Type size={16} aria-hidden="true" />,
};

const PLACEHOLDER: Record<ChecklistItemType, string> = {
  check: "ör. Tezgâh dezenfekte edildi",
  photo: "ör. Bar tezgâhı hazır",
  number: "ör. Bar buzdolabı sıcaklığı",
  text: "ör. Eksik malzeme",
};

/** Satırın alt yazısı: "0–4 °C · zorunlu", "fotoğraf · zorunlu", "kısa not · isteğe bağlı" */
function itemSub(i: ItemDTO): string {
  const kind = i.type === "number" ? rangeText(i) || "sayı" : i.type === "photo" ? "fotoğraf" : i.type === "text" ? "kısa not" : null;
  return [kind, i.required ? "zorunlu" : "isteğe bağlı"].filter(Boolean).join(" · ");
}

/**
 * Bir listenin düzenleyicisi: Liste kartı (ad, açıklama, saat, günler, personel, etkin; kaydı yoksa sil) ve Maddeler
 * kartı (bölüm bölüm; yukarı / aşağı, düzenle, kaldır; kaldırılanlar kapalı bir bölümde, geri eklenebilir). Değişiklik o
 * gün başlamış listeye değil sonrakilere uygulanır.
 */
export function TemplateEditor({ template: t, branches }: { template: TemplateDTO; branches: readonly BranchOption[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<TemplateDraft>({
    name: t.name,
    description: t.description ?? "",
    branchId: t.branchId ?? "",
    opensAt: t.opensAt,
    dueAt: t.dueAt,
    weekdays: t.weekdays,
    staffAllowed: t.staffAllowed,
    active: t.active,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<ItemDTO | "new" | null>(null);
  const [removing, setRemoving] = useState<ItemDTO | null>(null);
  const [pending, start] = useActionTransition();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await tryAction(() => updateChecklistTemplate(t.id, draftOf(draft)));
    setSaving(false);
    // Atılan eylem (E-51): bildirim çıktı, yazılanlar yerinde
    if (!res) return;
    if (!res.ok) return setError(res.error);
    toast.success(`${listTitle(draft.name.trim())} kaydedildi`);
  };

  const remove = () =>
    start(async () => {
      const res = await deleteChecklistTemplate(t.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDeleting(false);
      toast.success(`${listTitle(t.name)} silindi`);
      router.push("/panel/kontrol/duzenle");
    });

  const move = (item: ItemDTO, dir: "up" | "down") =>
    start(async () => {
      const res = await moveChecklistItem(item.id, dir);
      if (!res.ok) toast.error(res.error);
    });

  const setActive = (item: ItemDTO, active: boolean) =>
    start(async () => {
      const res = await setChecklistItemActive(item.id, active);
      if (!res.ok) return void toast.error(res.error);
      setRemoving(null);
      toast.success(active ? `${item.label} geri eklendi` : `${item.label} kaldırıldı`);
    });

  const field = error ? fieldOf(error) : null;
  const groups = groupBySection(t.items);
  const sections = [...new Set([...t.items, ...t.archived].map((i) => i.section?.trim()).filter((s): s is string => Boolean(s)))];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
      <Card className="min-w-0 xl:order-2">
        <CardHeader icon={<ListChecks />} title="Liste" />
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <TemplateFields
              value={draft}
              onChange={(d) => {
                setDraft(d);
                setError(null);
              }}
              errors={field ? { [field]: error! } : undefined}
              full
              branches={branches}
            />
            {error && !field ? (
              <Notice tone="bad" size="sm" live="assertive" title={error} />
            ) : null}
            <Button type="submit" disabled={saving} className="max-sm:h-12 max-sm:w-full">
              {saving ? "Bekleyin…" : "Kaydet"}
            </Button>
          </form>
          <div className="mt-5 border-t border-line pt-4">
            {t.hasRuns ? (
              <p className="text-[13px] text-ink-mute">Kayıtları olduğu için silinemez; kullanılmayacaksa pasife alın.</p>
            ) : (
              <Button variant="ghost" onClick={() => setDeleting(true)} className="text-bad hover:bg-bad-soft hover:text-bad">
                <Trash2 size={15} aria-hidden="true" /> Listeyi sil
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader
          title="Maddeler"
          meta={<span>{num(t.items.length)} madde</span>}
          actions={
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden="true" /> Madde ekle
            </Button>
          }
        />
        <div className="space-y-4 px-5 pb-5">
          {groups.length ? (
            groups.map((g) => (
              <section key={g.section ?? "-"} aria-label={g.section ?? "Bölümsüz maddeler"}>
                {g.section ? <h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-ink-mute uppercase">{g.section}</h3> : null}
                <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                  {g.items.map((i, k) => (
                    // Telefonda ad kendi satırında (dört düğmenin yanında bir iki kelimeye sıkışmasın), düğmeler altında
                    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
                      <span className="shrink-0 text-ink-mute">{TYPE_ICON[i.type]}</span>
                      <div className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0">
                        <p className="text-sm font-medium text-pretty text-ink">{i.label}</p>
                        <p className="text-xs text-ink-mute">{itemSub(i)}</p>
                      </div>
                      <div className="ml-7 flex shrink-0 items-center gap-1.5 sm:ml-0">
                        <IconButton label="Yukarı taşı" onClick={() => move(i, "up")} disabled={pending || k === 0}>
                          <ArrowUp size={15} />
                        </IconButton>
                        <IconButton label="Aşağı taşı" onClick={() => move(i, "down")} disabled={pending || k === g.items.length - 1}>
                          <ArrowDown size={15} />
                        </IconButton>
                        <IconButton label="Düzenle" onClick={() => setEditing(i)}>
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton label="Kaldır" tone="danger" onClick={() => setRemoving(i)} disabled={pending}>
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <EmptyState title="Bu listede madde yok" description="Madde ekle ile tamam işareti, fotoğraf, sıcaklık ya da kısa not ekleyin." />
          )}
          {t.archived.length ? (
            <details className="group rounded-2xl bg-surface ring-1 ring-line">
              <summary className="flex min-h-11 cursor-pointer list-none items-center px-3.5 text-[13px] font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">
                Kaldırılan maddeler ({num(t.archived.length)})
              </summary>
              <ul className="divide-y divide-line border-t border-line">
                {t.archived.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                    <span className="shrink-0 text-ink-quiet">{TYPE_ICON[i.type]}</span>
                    <p className="min-w-0 flex-1 text-sm text-ink-mute">{i.label}</p>
                    <Button variant="secondary" size="sm" onClick={() => setActive(i, true)} disabled={pending}>
                      <RotateCcw size={14} aria-hidden="true" /> Geri ekle
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </Card>

      {editing ? <ItemDialog key={editing === "new" ? "new" : editing.id} templateId={t.id} item={editing === "new" ? null : editing} sections={sections} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && setActive(removing, false)}
        title="Madde kaldırılsın mı?"
        description="Geçmiş kayıtlarda görünmeye devam eder."
        confirmLabel="Kaldır"
        pending={pending}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={remove}
        title={`"${t.name}" silinsin mi?`}
        description="Maddeleriyle birlikte silinir."
        pending={pending}
      />
    </div>
  );
}

/** Sınır alanının metni: "-18", "4" (boş: sınırsız) */
const boundText = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

/** Madde penceresinin hatası: alanınınsa alanın altında (alan odaklanır), değilse formun başında */
type ItemError = { text: string; field: "label" | "min" | "max" | "range" | null };

const FIELD_ID: Record<NonNullable<ItemError["field"]>, string> = { label: "madde-ad", min: "madde-en-az", max: "madde-en-cok", range: "madde-en-az" };

/**
 * Sunucunun hata metninden alan (fieldOf gibi). Sınırın aralık hatası hangi sınır olduğunu söylemez: -100 – 1000
 * dışındaki "En az" ise o, değilse "En çok".
 */
function itemFieldOf(text: string, lo: number | null): ItemError["field"] {
  if (/^Madde adı/.test(text)) return "label";
  if (/en çoktan büyük/.test(text)) return "range";
  if (/^Sınır|^Sayı yazın/.test(text)) return lo !== null && (lo < -100 || lo > 1000) ? "min" : "max";
  return null;
}

/** Madde ekle / düzenle: tür, ad, bölüm, açıklama; sayıda birim ve aralık; zorunlu */
function ItemDialog({ templateId, item, sections, onClose }: { templateId: number; item: ItemDTO | null; sections: string[]; onClose: () => void }) {
  const [type, setType] = useState<ChecklistItemType>(item?.type ?? "check");
  const [label, setLabel] = useState(item?.label ?? "");
  const [section, setSection] = useState(item?.section ?? "");
  const [hint, setHint] = useState(item?.hint ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "°C");
  const [min, setMin] = useState(boundText(item?.min ?? null));
  const [max, setMax] = useState(boundText(item?.max ?? null));
  const [required, setRequired] = useState(item?.required ?? true);
  const [error, setError] = useState<ItemError | null>(null);
  const [saving, setSaving] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // Telefonda form pencerenin içinde kayar ve alttaki hata Kaydet'in arkasında kalırdı: ret gelince alan odaklanır
  // (pencere ona kayar), genel hata formun başında görünür kılınır
  useEffect(() => {
    if (!error) return;
    if (error.field) document.getElementById(FIELD_ID[error.field])?.focus();
    else alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const pickType = (next: ChecklistItemType) => {
    // Fotoğraflı maddenin ipucu: fotoğrafta insan olmasın
    if (next === "photo" && !hint.trim()) setHint(PHOTO_PRIVACY_HINT);
    if (next !== "photo" && hint === PHOTO_PRIVACY_HINT) setHint("");
    setType(next);
    setError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const lo = min.trim() ? parseReading(min) : null;
    const hi = max.trim() ? parseReading(max) : null;
    if (type === "number" && ((min.trim() && lo === null) || (max.trim() && hi === null))) {
      return setError({ text: "Sınırı sayı olarak yazın (ör. -18 ya da 4)", field: min.trim() && lo === null ? "min" : "max" });
    }
    setSaving(true);
    const res = await tryAction(() =>
      saveChecklistItem(
        templateId,
        { label, type, section: section || null, hint: hint || null, required, unit: type === "number" ? unit || null : null, min: type === "number" ? lo : null, max: type === "number" ? hi : null },
        item?.id ?? null,
      ),
      // Yeni maddede yanıt yolda kaybolursa madde yazılmış olabilir: ikinci "Kaydet" aynı maddeyi iki kez ekler
      { maybeSaved: !item },
    );
    setSaving(false);
    if (!res) return;
    if (!res.ok) return setError({ text: res.error, field: itemFieldOf(res.error, lo) });
    toast.success(item ? "Madde kaydedildi" : "Madde eklendi");
    onClose();
  };

  const bad = (...fields: ItemError["field"][]) => (error !== null && fields.includes(error.field) ? true : undefined);
  const rangeError = error?.field === "min" || error?.field === "max" || error?.field === "range" ? error.text : null;

  return (
    <Dialog
      open
      onClose={() => !saving && onClose()}
      title={item ? "Maddeyi düzenle" : "Madde ekle"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving} className="max-sm:bg-panel">
            Vazgeç
          </Button>
          <Button type="submit" form="madde" disabled={saving}>
            {saving ? "Bekleyin…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id="madde" onSubmit={save} className="space-y-4 pb-1">
        {error && !error.field ? (
          <Notice ref={alertRef} tone="bad" size="sm" live="assertive" className="scroll-my-3" title={error.text} />
        ) : null}
        <Field label="Tür">
          <div role="radiogroup" aria-label="Tür" className="grid grid-cols-2 gap-2">
            {ITEM_TYPES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={type === k}
                onClick={() => pickType(k)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-[13px] font-medium ring-1 ring-inset transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none",
                  type === k ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-soft ring-line-strong hover:text-ink",
                )}
              >
                {TYPE_ICON[k]} {ITEM_TYPE_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Madde" htmlFor="madde-ad" error={error?.field === "label" ? error.text : undefined}>
          <Input
            id="madde-ad"
            value={label}
            maxLength={120}
            placeholder={PLACEHOLDER[type]}
            aria-invalid={bad("label")}
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field label="Bölüm" htmlFor="madde-bolum">
          <Input id="madde-bolum" list="madde-bolumler" value={section} maxLength={40} placeholder="ör. Bar, Salon, Karaoke odası" onChange={(e) => setSection(e.target.value)} />
          <datalist id="madde-bolumler">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Açıklama" hint="Personele küçük bir ipucu (ör. termometreyi orta rafta okuyun)." htmlFor="madde-ipucu">
          <Input id="madde-ipucu" value={hint} maxLength={200} onChange={(e) => setHint(e.target.value)} />
        </Field>
        {type === "number" ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Birim" htmlFor="madde-birim">
                <Input id="madde-birim" value={unit} maxLength={10} onChange={(e) => setUnit(e.target.value)} />
              </Field>
              <Field label="En az" htmlFor="madde-en-az">
                {/* Eksi yazılabilsin: iOS'un ondalık klavyesinde eksi yok */}
                <Input
                  id="madde-en-az"
                  inputMode="text"
                  autoComplete="off"
                  value={min}
                  placeholder="ör. 0"
                  aria-invalid={bad("min", "range")}
                  aria-describedby="madde-aralik"
                  onChange={(e) => {
                    setMin(e.target.value);
                    setError(null);
                  }}
                  className="text-right tabular"
                />
              </Field>
              <Field label="En çok" htmlFor="madde-en-cok">
                <Input
                  id="madde-en-cok"
                  inputMode="text"
                  autoComplete="off"
                  value={max}
                  placeholder="ör. 4"
                  aria-invalid={bad("max", "range")}
                  aria-describedby="madde-aralik"
                  onChange={(e) => {
                    setMax(e.target.value);
                    setError(null);
                  }}
                  className="text-right tabular"
                />
              </Field>
            </div>
            {rangeError ? (
              <p id="madde-aralik" className="text-xs text-bad">
                {rangeError}
              </p>
            ) : (
              <p id="madde-aralik" className="text-xs text-ink-mute">
                Aralık dışındaki değerde not istenir ve size bildirilir.
              </p>
            )}
          </div>
        ) : null}
        <ToggleRow title="Zorunlu" description="Kapalıysa liste bu madde boş da olsa tamam sayılır." checked={required} onChange={setRequired} label="Zorunlu" onText="Evet" offText="Hayır" />
      </form>
    </Dialog>
  );
}
