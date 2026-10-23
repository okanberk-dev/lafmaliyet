"use client";

import { Field, Input, Textarea } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { WEEKDAY_SHORT } from "@/lib/checklists";
import { cn } from "@/lib/utils";

/** Liste formunun alanları (yeni liste penceresi ve listenin sayfası ortak) */
export interface TemplateDraft {
  name: string;
  description: string;
  opensAt: string;
  dueAt: string;
  weekdays: number[];
  staffAllowed: boolean;
  active: boolean;
}

export const EMPTY_TEMPLATE: TemplateDraft = { name: "", description: "", opensAt: "08:00", dueAt: "11:00", weekdays: [1, 2, 3, 4, 5, 6, 7], staffAllowed: true, active: true };

/** Haftanın günleri: yedi aç / kapa çipi (Pzt … Paz) */
export function WeekdayChips({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div role="group" aria-label="Günler" className="grid max-w-md grid-cols-7 gap-1.5">
      {WEEKDAY_SHORT.map((label, i) => {
        const d = i + 1;
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b))}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center justify-center rounded-xl text-[13px] font-medium ring-1 ring-inset transition-colors pointer-coarse:h-11",
              "focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none",
              on ? "bg-ink text-white ring-ink" : "bg-surface text-ink-mute ring-line-strong hover:text-ink",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Liste alanları: ad, (sayfada) açıklama, saat aralığı, günler, personel ve (sayfada) etkin. Son saat gece yarısını
 * geçebilir (gün 05:00'te döner).
 */
export function TemplateFields({
  value: v,
  onChange,
  errors,
  full,
}: {
  value: TemplateDraft;
  onChange: (v: TemplateDraft) => void;
  /** Alan adına göre hata (sunucunun metni) */
  errors?: Partial<Record<keyof TemplateDraft, string>>;
  /** Listenin sayfası: açıklama ve "Etkin" de */
  full?: boolean;
}) {
  const set = <K extends keyof TemplateDraft>(k: K, x: TemplateDraft[K]) => onChange({ ...v, [k]: x });
  return (
    <div className="space-y-4">
      <Field label="Ad" error={errors?.name} htmlFor="liste-ad">
        <Input id="liste-ad" value={v.name} maxLength={60} placeholder="ör. Haftalık derin temizlik" onChange={(e) => set("name", e.target.value)} aria-invalid={errors?.name ? true : undefined} />
      </Field>
      {full ? (
        <Field label="Açıklama" hint="Listenin başında görünür." htmlFor="liste-aciklama">
          <Textarea id="liste-aciklama" value={v.description} maxLength={300} onChange={(e) => set("description", e.target.value)} className="min-h-24" />
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç" htmlFor="liste-baslangic" error={errors?.opensAt}>
          <Input id="liste-baslangic" type="time" step={300} value={v.opensAt} onChange={(e) => set("opensAt", e.target.value)} />
        </Field>
        <Field label="Son saat" htmlFor="liste-son" error={errors?.dueAt}>
          <Input id="liste-son" type="time" step={300} value={v.dueAt} onChange={(e) => set("dueAt", e.target.value)} aria-invalid={errors?.dueAt ? true : undefined} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-ink-mute">Gün 05:00&apos;te döner: gece 02:00&apos;yi son saat olarak yazabilirsiniz.</p>
      <Field label="Günler" error={errors?.weekdays}>
        <WeekdayChips value={v.weekdays} onChange={(d) => set("weekdays", d)} />
      </Field>
      <ToggleRow
        title="Personel doldurabilir"
        description="Kapalıysa listeyi yalnız yöneticiler görür ve doldurur."
        checked={v.staffAllowed}
        onChange={(x) => set("staffAllowed", x)}
        label="Personel doldurabilir"
        onText="Açık"
        offText="Kapalı"
      />
      {full ? (
        <ToggleRow
          title="Etkin"
          description="Pasif liste Bugün'de, zilde ve e-postada görünmez; kayıtları kalır."
          checked={v.active}
          onChange={(x) => set("active", x)}
          label="Liste etkin"
          onText="Etkin"
          offText="Pasif"
        />
      ) : null}
    </div>
  );
}

/** Sunucunun hata metninden alan (pencerede ilgili alanın altında görünsün) */
export function fieldOf(error: string): keyof TemplateDraft | null {
  if (/^Liste adı|adda bir liste/.test(error)) return "name";
  if (/Son saat|Aralık en az/.test(error)) return "dueAt";
  if (/Saati 08:00/.test(error)) return "opensAt";
  if (/En az bir gün/.test(error)) return "weekdays";
  return null;
}

export const draftOf = (d: TemplateDraft) => ({ ...d, name: d.name.trim(), description: d.description.trim() || null });
