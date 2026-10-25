"use client";

import { AlertTriangle, DoorClosed, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { CLOSED_REASON_MAX, closedDialogText } from "@/lib/closed-days";
import { longDateTR } from "@/lib/reminders";
import { markClosedDay, requestClosedDay } from "@/server/actions/closed-days";
import { withdrawStaffRequest } from "@/server/actions/staff-requests";

import { newClientKey } from "./cash-requests";

/*
 * Kasa raporu › raporsuz gün: "Kafe kapalıydı" (docs/KASA-RAPORU.md › Kafe kapalıydı). Personel yalnız dün için
 * bildirir (yöneticinin onayına gider; bekleyen bildirimi geri çekebilir); yönetici raporsuz bir günü doğrudan işaretler,
 * pencerede o günün izleri uyarı olarak görünür. Form yerinde kalır: kafe açıktıysa rapor girilir.
 */

export type ClosedDayBarProps =
  | { role: "staff"; date: string; marked: boolean; pending: { id: number; by: string; mine: boolean } | null; rejected: { note: string | null } | null; canAsk: boolean }
  | { role: "admin"; date: string; marked: boolean; warnings: string[] };

export function ClosedDayBar(p: ClosedDayBarProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newClientKey);
  const [pending, start] = useActionTransition();

  if (p.marked) {
    return (
      <p role="note" className="flex items-start gap-2 rounded-2xl bg-panel px-4 py-3 text-sm leading-5 text-ink-soft">
        <DoorClosed size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{longDateTR(p.date)} kafe kapalı işaretli. Kafe açıktıysa raporu girin; işaret kendiliğinden kalkar.</span>
      </p>
    );
  }

  function send() {
    start(async () => {
      const res = p.role === "staff" ? await requestClosedDay({ date: p.date, reason: reason.trim() || null, clientKey: key }) : await markClosedDay({ date: p.date, note: reason.trim() || null });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      setOpen(false);
      setReason("");
      setKey(newClientKey());
      toast.success(p.role === "staff" ? "Yöneticiye gönderildi" : "Gün kapalı işaretlendi", {
        description: p.role === "staff" ? "Onaylanınca eksik rapor uyarısı kalkar." : "Eksik rapor ve kontrol listesi uyarıları kalktı.",
      });
    });
  }

  function withdraw(id: number) {
    start(async () => {
      const res = await withdrawStaffRequest(id);
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      toast.success("Bildirim geri çekildi");
    });
  }

  let body: ReactNode;
  if (p.role === "staff" && p.pending) {
    body = (
      <>
        <span className="min-w-0 flex-1 basis-48">{p.pending.mine ? "Kapalıydı dediniz · onay bekliyor" : `${p.pending.by} kapalıydı dedi · onay bekliyor`}</span>
        {p.pending.mine ? (
          <Button size="sm" variant="ghost" onClick={() => withdraw(p.pending!.id)} disabled={pending} className="pointer-coarse:min-h-11">
            <Undo2 size={14} aria-hidden="true" /> Geri çek
          </Button>
        ) : null}
      </>
    );
  } else if (p.role === "staff" && p.rejected) {
    body = <span className="min-w-0">Yönetici bildirimi reddetti{p.rejected.note ? `: ${p.rejected.note}` : ""}. Raporu girin.</span>;
  } else if (p.role === "staff" && !p.canAsk) {
    return null;
  } else {
    body = (
      <>
        <span className="min-w-0 flex-1 basis-48">{p.role === "staff" ? "Dün kafe kapalı mıydı?" : "Bu gün kafe kapalı mıydı?"}</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={pending} className="pointer-coarse:min-h-11">
          <DoorClosed size={14} aria-hidden="true" /> Kafe kapalıydı
        </Button>
      </>
    );
  }

  return (
    <>
      <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-panel px-4 py-2.5 text-sm leading-5 text-ink-soft">
        {body}
      </div>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Kafe kapalıydı"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending} className="max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button onClick={send} disabled={pending}>
              {pending ? "Gönderiliyor…" : p.role === "staff" ? "Yöneticiye gönder" : "Kapalı işaretle"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-mute">
            {p.role === "staff" ? closedDialogText(p.date) : `${longDateTR(p.date)} için eksik kasa raporu ve kontrol listesi uyarıları kalkar; tahmin o günü kapalı sayar.`}
          </p>
          {p.role === "admin" && p.warnings.length ? (
            <ul className="space-y-1 rounded-xl bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn">
              {p.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{w}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Field label="Neden? (isteğe bağlı)" htmlFor="kapali-neden">
            <Input id="kapali-neden" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={CLOSED_REASON_MAX} placeholder="ör. tadilat, elektrik kesintisi" autoComplete="off" />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
