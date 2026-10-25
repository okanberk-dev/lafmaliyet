"use client";

import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useIsPhone } from "@/components/ui/use-media";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { money, num } from "@/lib/format";
import { groupPosMarks, type RecentPosMark } from "@/lib/prices/pos";
import { cn } from "@/lib/utils";
import { undoPosMarks } from "@/server/actions/pos-marks";

const sizeLabel = (s: string) => SIZE_LABELS[s as Size] ?? s;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/**
 * Fiyatlar › Kasaya işle › "Son işaretlenenler" (dalga 10 §2.2): son 14 günün işaretleri, kişi ve gün başına
 * ("Ayşe · dün · 34 fiyat", açılır). Personel kasada onaysız işaretler; yanlış işaret buradan geri alınır (ürün listeye
 * işaretten önceki hâliyle döner). Geri alınamıyorsa nedeni yazar, geri alınmış satır soluk. Telefonda kapalı gelir.
 */
export function RecentPosMarks({ marks, now }: { marks: RecentPosMark[]; now: string }) {
  const phone = useIsPhone();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? !phone;
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, start] = useActionTransition();
  const groups = groupPosMarks(marks, new Date(now));

  function undo(m: RecentPosMark) {
    start(async () => {
      const r = await undoPosMarks([m.markId]);
      if (!r.ok) return void toast.error(r.error);
      if (r.data.refused.length) return void toast.warning(r.data.refused[0].reason);
      toast.success(`${m.name} ${sizeLabel(m.size)} listeye döndü; kasada ${money(m.stalePrice)} duruyor`);
    });
  }

  return (
    <Card id="son-isaretlenenler" className="scroll-mt-24">
      <CardHeader
        icon={<History />}
        title="Son işaretlenenler"
        description="Son 14 günde kasada işaretlenen fiyatlar, kişi ve gün başına."
        meta={marks.length ? <span className="tabular">{num(marks.length)} işaret</span> : null}
        actions={
          <Button variant="ghost" size="sm" onClick={() => setToggled(!open)} aria-expanded={open} aria-controls="son-isaretlenenler-liste">
            {open ? "Gizle" : "Göster"} <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        }
      />
      {open ? (
        <CardContent id="son-isaretlenenler-liste" className="space-y-2">
          {groups.length ? (
            groups.map((g) => {
              const expanded = openGroups.has(g.key);
              return (
                <section key={g.key} className="rounded-2xl bg-surface">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm"
                    aria-expanded={expanded}
                    onClick={() =>
                      setOpenGroups((s) => {
                        const next = new Set(s);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                  >
                    <span className="min-w-0 break-words">
                      <span className="font-medium text-ink">{g.by}</span> · {g.dayLabel} · <span className="tabular">{num(g.marks.filter((m) => !m.undoneAt).length)} fiyat</span>
                      {g.marks.some((m) => m.undoneAt) ? <span className="text-ink-mute tabular"> · {num(g.marks.filter((m) => m.undoneAt).length)} geri alındı</span> : null}
                    </span>
                    <ChevronDown size={16} className={cn("shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                  </button>
                  {expanded ? (
                    <ul className="divide-y divide-line-strong/70 border-t border-line-strong/70">
                      {g.marks.map((m) => (
                        <li key={m.markId} className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm", m.undoneAt && "opacity-60")}>
                          <span className="min-w-0">
                            <span className="block break-words">
                              <span className="font-medium text-ink">
                                {m.name} · {sizeLabel(m.size)}
                              </span>{" "}
                              <span className="whitespace-nowrap tabular">
                                {money(m.stalePrice).replace(/\s?₺$/, "")} → {money(m.price)}
                              </span>
                            </span>
                            <span className="block text-xs text-ink-mute">
                              {m.by} · <span className="tabular">{clock(m.markedAt)}</span>
                              {m.undoneAt ? ` · Geri alındı${m.undoneBy ? ` · ${m.undoneBy}` : ""}` : m.refusal ? ` · ${m.refusal}` : ""}
                            </span>
                          </span>
                          {!m.undoneAt && !m.refusal ? (
                            <Button size="sm" variant="secondary" onClick={() => undo(m)} disabled={pending}>
                              Geri al
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })
          ) : (
            <p className="px-1 py-2 text-sm text-ink-mute">Son 14 günde kasada işaretlenen fiyat yok.</p>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
