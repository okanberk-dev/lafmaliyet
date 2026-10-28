"use client";

import { CheckCircle2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { saveTaxCheck } from "@/server/actions/tax";

export interface CheckRow {
  key: string;
  priority: "temel" | "ek";
  title: string;
  assumed: string;
  ask: string;
  /** "Konuşuldu · Ad · 24.10.2026 · not"; işaretli değilse null */
  done: string | null;
  note: string | null;
}

/**
 * Kurallar › "Muhasebeciye sorulacaklar" (plan docs/planlar/vergi.md §4.4, §14, K34): temel maddeler üstte. "Muhasebecimle
 * konuştum" not alanını açar; işaret sahibindir, muhasebecinin onayı değildir. Kaldırılabilir.
 */
export function ChecksList({ rows }: { rows: CheckRow[] }) {
  const groups = [
    { key: "temel", title: "Temel", rows: rows.filter((r) => r.priority === "temel") },
    { key: "ek", title: "Ek", rows: rows.filter((r) => r.priority === "ek") },
  ];
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title}>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">
            {g.title} · {g.rows.filter((r) => r.done).length} / {g.rows.length}
          </h3>
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {g.rows.map((r) => (
              <CheckItem key={r.key} row={r} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CheckItem({ row }: { row: CheckRow }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(row.note ?? "");
  const [pending, run] = useActionTransition();
  // İşaret kaldırılırken kutu hemen boşalır (yanıt gelene kadar beklemez); hata olursa geri döner
  const [unchecking, setUnchecking] = useState(false);
  const checked = (row.done !== null && !unchecking) || editing;

  function save(next: boolean) {
    if (!next) setUnchecking(true);
    run(async () => {
      const r = await saveTaxCheck({ key: row.key, checked: next, note: next ? note.trim() || null : null }).finally(() => setUnchecking(false));
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      setEditing(false);
      if (next) toast.success(`Konuşuldu olarak işaretlendi: ${row.title}`);
      else
        toast.success(`İşaret kaldırıldı: ${row.title}`, {
          duration: 10_000,
          action: {
            label: "Geri al",
            onClick: () =>
              void tryAction(() => saveTaxCheck({ key: row.key, checked: true, note: row.note })).then((x) => x && (x.ok ? toast.success(`Yeniden işaretlendi: ${row.title}`) : toast.error(x.error))),
          },
        });
    });
  }

  return (
    <li className={cn("space-y-2 px-4 py-3", row.done && "bg-lime/10")}>
      <p className="flex items-start gap-2 text-sm leading-5 font-medium text-ink">
        {row.done ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" aria-hidden="true" /> : null}
        <span className="min-w-0">{row.title}</span>
      </p>
      <p className="text-[13px] leading-5 text-ink-mute">
        <span className="font-medium text-ink-soft">Panelin varsaydığı: </span>
        {row.assumed}
      </p>
      <p className="text-[13px] leading-5 text-ink-mute">
        <span className="font-medium text-ink-soft">Muhasebecinize sorun: </span>
        {row.ask}
      </p>
      {row.done && !editing ? <p className="text-[13px] leading-5 font-medium text-good">{row.done}</p> : null}
      <Checkbox
        label="Muhasebecimle konuştum"
        checked={checked}
        disabled={pending}
        onChange={(e) => {
          if (e.target.checked) setEditing(true);
          else if (editing && row.done === null) setEditing(false);
          else save(false);
        }}
      />
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
        >
          <Field label="Muhasebecinin söylediği / farklıysa ne" htmlFor={`${id}-not`}>
            <Textarea id={`${id}-not`} value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} disabled={pending} placeholder="İsteğe bağlı" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : row.done ? (
        <Button variant="ghost" size="xs" disabled={pending} onClick={() => setEditing(true)}>
          Notu düzenle
        </Button>
      ) : null}
    </li>
  );
}
