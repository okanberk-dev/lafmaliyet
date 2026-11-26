"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { dateTR, money } from "@/lib/format";
import { RECORD_LABEL, type Candidate } from "@/lib/mutabakat/match";
import { ACTION_DECISION, ACTION_LABEL, type LineAction } from "@/lib/mutabakat/view";
import { cn } from "@/lib/utils";
import { decideLine, manualOptions } from "@/server/actions/mutabakat";

/** Satırın düğmeleri (src/lib/mutabakat/view.ts lineActions) ve elle eşleştirme penceresi */
export function LineActions({
  lineId,
  amount,
  actions,
  pos,
  matched,
  summary,
  description,
}: {
  lineId: number;
  amount: number;
  actions: readonly LineAction[];
  /** POS hakedişi satırı: "Ayır" düğmesi "POS değil" der */
  pos: boolean;
  /** Bir kayıtla eşleşmiş: "Eşleştir" düğmesi "Değiştir" der */
  matched: boolean;
  summary: string;
  description: string;
}) {
  const [pending, start] = useActionTransition();
  const [open, setOpen] = useState(false);
  const label = (a: LineAction) => (a === "ayir" && pos ? "POS değil" : a === "eslestir" && matched ? "Değiştir" : ACTION_LABEL[a]);

  function decide(a: Exclude<LineAction, "eslestir">) {
    start(async () => {
      const r = await decideLine({ lineId, decision: ACTION_DECISION[a] });
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      toast.success(a === "geri-al" ? "Karar geri alındı" : `${summary}: ${label(a).toLocaleLowerCase("tr-TR")}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 max-lg:justify-start">
      {actions.map((a) => (
        <Button key={a} variant={a === "eslestir" && !matched ? "secondary" : "ghost"} size="xs" disabled={pending} onClick={() => (a === "eslestir" ? setOpen(true) : decide(a))}>
          {label(a)}
        </Button>
      ))}
      {open ? <MatchDialog lineId={lineId} amount={amount} summary={summary} description={description} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function MatchDialog({ lineId, amount, summary, description, onClose }: { lineId: number; amount: number; summary: string; description: string; onClose: () => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; error: string } | { status: "ready"; options: Candidate[]; current: { kind: string; id: number } | null }>({
    status: "loading",
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, start] = useActionTransition();
  // Pencere açılınca bir kez: satırın havuzunda boşta kalan kayıtlar (sunucuda eşleşme yeniden hesaplanır)
  useEffect(() => {
    let live = true;
    void tryAction(() => manualOptions(lineId)).then((r) => {
      if (!live) return;
      if (!r) return setState({ status: "error", error: "Seçenekler okunamadı; yeniden deneyin." });
      if (!r.ok) return setState({ status: "error", error: r.error });
      setState({ status: "ready", options: r.data.options, current: r.data.current });
      if (r.data.current) setPicked(`${r.data.current.kind}:${r.data.current.id}`);
    });
    return () => {
      live = false;
    };
  }, [lineId]);
  const options = state.status === "ready" ? state.options : [];
  const choice = options.find((c) => `${c.kind}:${c.id}` === picked) ?? null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Panel kaydıyla eşleştir"
      description={`${summary} · ${description || "açıklamasız"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending} className="max-sm:bg-panel">
            Vazgeç
          </Button>
          <Button
            disabled={!choice || pending}
            onClick={() =>
              choice &&
              start(async () => {
                const r = await decideLine({ lineId, decision: "elle", match: { kind: choice.kind, id: choice.id } });
                if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
                toast.success(`Eşleştirildi: ${choice.label}`);
                onClose();
              })
            }
          >
            {pending ? "Kaydediliyor…" : "Eşleştir"}
          </Button>
        </>
      }
    >
      {state.status === "loading" ? <p className="text-sm text-ink-mute">Kayıtlar okunuyor…</p> : null}
      {state.status === "error" ? <p className="text-sm text-bad">{state.error}</p> : null}
      {state.status === "ready" && !options.length ? (
        <p className="text-sm text-ink-mute">Bu hareketin yönünde, ±45 gün içinde boşta panel kaydı yok. Kayıt panelde yoksa önce ekleyin (Aylık harcamalar, Tedarikçiler) ya da hareketi yok sayın.</p>
      ) : null}
      {options.length ? (
        <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Panel kaydı">
          {options.map((c) => {
            const key = `${c.kind}:${c.id}`;
            const on = picked === key;
            const same = Math.abs(Math.abs(c.amount) - Math.abs(amount)) <= 0.01;
            return (
              <li key={key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPicked(key)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition-colors pointer-coarse:min-h-11",
                    on ? "bg-surface ring-ink" : "ring-line-strong hover:bg-surface/60",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words text-ink">{c.label}</span>
                    <span className="block text-xs text-ink-mute">
                      {RECORD_LABEL[c.kind]} · {dateTR(c.date)}
                      {state.status === "ready" && state.current && `${state.current.kind}:${state.current.id}` === key ? " · şu anki eşleşme" : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm tabular">{money(c.amount)}</span>
                    {same ? <Badge tone="green">Tutar aynı</Badge> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Dialog>
  );
}
