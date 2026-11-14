"use client";

import { Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { toastUnreachable, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/form";
import { BIG_FIELDS, ChoiceList, SHEET_BTN } from "@/components/ui/mobile-filters";
import { Notice } from "@/components/ui/notice";
import { parseNumberTR } from "@/lib/calc/expr";
import { allocateFifo, allocationPreview, validateManual, type AllocationLine, type OpenItem } from "@/lib/cari/account";
import { EPS, round2 } from "@/lib/cari/balance";
import { dateTR, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { removeAllocations, setPaymentAllocation } from "@/server/actions/cari";

import { ModeLabel, type AllocationMode } from "../cari-payment-dialog";
import { amountText, CARI_UNDO_MS } from "../cari-ui";

/** Ödemenin bir dağıtımı (ekranda) */
export interface PaymentAllocationRow {
  id: number;
  kind: "invoice" | "debt";
  targetId: number;
  label: string;
  amount: number;
  /** Başka tedarikçide görünen faturaya sayılmış (eski veri) */
  foreign?: boolean;
}

const itemKey = (i: { kind: string; id: number }) => `${i.kind}:${i.id}`;

/** "Geri al": ödemenin önceki dağıtımı yeniden yazılır */
async function restoreAllocation(paymentId: number, lines: AllocationLine[]) {
  try {
    const u = await setPaymentAllocation({ paymentId, mode: lines.length ? "manual" : "none", lines });
    if (!u.ok) return void toast.error(u.error);
    toast.success("Dağıtım geri alındı");
  } catch (e) {
    toastUnreachable(e);
  }
}

/**
 * Neye sayıldı (§6.1, §6.2): ödemenin hangi faturalara ve faturasız alımlara sayıldığı; her dağıtımın yanında
 * "Ödemeden çıkar" (para hesaba döner, defterin kapattığı fatura yeniden açılır). Dağıtım baştan da yazılabilir: en
 * eski borçtan, seçerek ya da hesapta beklesin. Seçenekler, bu ödemenin şimdiki dağıtımı serbest kalmış hâliyle.
 */
export function AllocationDialog({
  payment,
  title,
  current,
  options,
  onClose,
}: {
  payment: { id: number; date: string; amount: number };
  /** "22.10 · Havale / EFT · 10.000,00 ₺" */
  title: string;
  current: PaymentAllocationRow[];
  /** Ödemenin sayılabileceği kalemler: açık kalemler, bu ödemenin şimdiki payı eklenmiş olarak */
  options: OpenItem[];
  onClose: () => void;
}) {
  const counted = round2(current.reduce((a, c) => a + c.amount, 0));
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<AllocationMode>(current.length ? "manual" : "auto");
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map(current.filter((c) => !c.foreign).map((c) => [itemKey({ kind: c.kind, id: c.targetId }), amountText(c.amount)])));
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useActionTransition();

  const plan = useMemo((): { lines: AllocationLine[]; left: number } => {
    if (mode === "none") return { lines: [], left: payment.amount };
    if (mode === "auto") return allocateFifo(options.filter((i) => i.quiet !== "link"), payment.amount);
    const lines = [...picked].flatMap(([k, t]) => {
      const [kind, id] = k.split(":");
      const a = parseNumberTR(t) ?? 0;
      return a > 0 ? [{ kind: kind as AllocationLine["kind"], id: Number(id), amount: round2(a) }] : [];
    });
    return { lines, left: round2(payment.amount - lines.reduce((a, l) => a + l.amount, 0)) };
  }, [mode, options, payment.amount, picked]);
  const problem = mode === "manual" ? validateManual(plan.lines, options, payment.amount) : null;

  function remove(row: PaymentAllocationRow) {
    run(async () => {
      const r = await removeAllocations({ allocationIds: [row.id] });
      if (!r.ok) return void toast.error(r.error);
      const prev = r.data.previous[0]?.lines ?? [];
      toast.success("Ödemeden çıkarıldı", {
        description: `${row.label} ${tl(row.amount, 2)} hesaba geçti${r.data.reopened ? " · fatura ödenmemişe döndü" : ""}`,
        duration: CARI_UNDO_MS,
        action: { label: "Geri al", onClick: () => void restoreAllocation(payment.id, prev) },
      });
      onClose();
    });
  }

  function save() {
    setError(null);
    if (problem) return void setError(problem);
    run(async () => {
      const r = await setPaymentAllocation({ paymentId: payment.id, mode, lines: plan.lines });
      if (!r.ok) return void setError(r.error);
      const prev = r.data.previous;
      toast.success("Dağıtım değişti", {
        description: `${r.data.lines.length ? `${r.data.lines.length} kaleme sayıldı` : "hiçbir kaleme sayılmadı"} · hesapta ${tl(r.data.left, 2)}`,
        duration: CARI_UNDO_MS,
        action: { label: "Geri al", onClick: () => void restoreAllocation(payment.id, prev) },
      });
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Neye sayıldı"
      description={title}
      footer={
        editing ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} className={SHEET_BTN}>
              Vazgeç
            </Button>
            <Button onClick={save} disabled={pending || Boolean(problem)} className={SHEET_BTN}>
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Kapat
          </Button>
        )
      }
    >
      <div className={cn("space-y-4 pb-2", BIG_FIELDS)}>
        {!editing ? (
          <>
            {current.length ? (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
                {current.map((c) => (
                  <li key={c.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
                    <span className="min-w-0 flex-1 text-sm break-words text-ink">
                      {c.kind === "debt" ? `Faturasız alım · ${c.label}` : c.label}
                      {c.foreign ? <span className="block text-xs text-warn">başka tedarikçide görünen fatura</span> : null}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-ink tabular">{tl(c.amount, 2)}</span>
                    <Button variant="secondary" size="sm" onClick={() => remove(c)} disabled={pending} className="shrink-0 text-ink">
                      <Undo2 size={14} aria-hidden="true" /> Ödemeden çıkar
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-mute">Bu ödeme hiçbir kaleme sayılmadı.</p>
            )}
            <p className="flex items-center justify-between gap-2 px-1 text-[13px] text-ink-mute tabular">
              <span>Hesapta duran</span>
              <span className="font-semibold text-ink">{tl(round2(payment.amount - counted), 2)}</span>
            </p>
            <Button variant="secondary" onClick={() => setEditing(true)} className="w-full text-ink">
              Dağıtımı değiştir
            </Button>
          </>
        ) : (
          <>
            <ChoiceList<AllocationMode>
              label="Neye sayılsın"
              value={mode}
              onChange={setMode}
              options={[
                { value: "auto", label: <ModeLabel text="En eski borçtan" note="vadesi en yakın kalemden başlayarak" /> },
                { value: "manual", label: <ModeLabel text="Seçerek" note="kalemleri ve tutarları siz seçin" /> },
                { value: "none", label: <ModeLabel text="Hesapta beklesin" note="hiçbir kaleme sayılmaz" /> },
              ]}
            />
            {mode === "manual" ? (
              options.length ? (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
                  {options.map((it) => {
                    const k = itemKey(it);
                    const on = picked.has(k);
                    return (
                      <li key={k} className="px-3.5 py-2.5">
                        <label className="flex min-h-11 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setPicked((m) => {
                                const next = new Map(m);
                                if (next.has(k)) next.delete(k);
                                else next.set(k, amountText(it.balance));
                                return next;
                              })
                            }
                            className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-ink pointer-coarse:size-5"
                          />
                          <span className="min-w-0 flex-1 text-sm leading-5">
                            <span className="block break-words text-ink">{it.kind === "debt" ? `Faturasız alım · ${it.label}` : it.label}</span>
                            <span className="block text-xs text-ink-mute tabular">
                              {dateTR(it.date).slice(0, 5)} · sayılabilir {tl(it.balance, 2)} · {it.dueEstimated ? "tahmini vade" : "vade"} {dateTR(it.due).slice(0, 5)}
                            </span>
                          </span>
                        </label>
                        {on ? <NumberInput value={picked.get(k) ?? ""} onChange={(e) => setPicked((m) => new Map(m).set(k, e.target.value))} aria-label={`${it.label} için sayılacak tutar`} className="mt-2 w-full" /> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-mute">Açık kalem yok.</p>
              )
            ) : null}
            <div className="rounded-2xl bg-panel px-3.5 py-2.5 text-[13px] leading-5 text-ink-soft tabular" aria-live="polite">
              {allocationPreview(plan.lines, options, Math.max(0, plan.left))}
            </div>
            {plan.left > EPS ? <p className="text-[13px] text-ink-mute">{tl(plan.left, 2)} hesapta kalır.</p> : null}
            {error ?? problem ? (
              <Notice tone="bad" size="sm" live="assertive" title={error ?? problem} />
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
