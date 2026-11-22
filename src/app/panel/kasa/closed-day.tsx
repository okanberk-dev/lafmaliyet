"use client";

import { DoorClosed, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
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

/** Çubuğun kasası: bildirim ve işaret bu şubeye yazılır; birden çok şube açıkken adı metne girer (tek şubede null) */
type Till = { id: string; name: string | null };

export type ClosedDayBarProps =
  | { role: "staff"; date: string; till: Till; marked: boolean; pending: { id: number; by: string; mine: boolean } | null; rejected: { note: string | null } | null; canAsk: boolean }
  | { role: "admin"; date: string; till: Till; marked: boolean; warnings: string[] };

export function ClosedDayBar(p: ClosedDayBarProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newClientKey);
  const [pending, start] = useActionTransition();

  if (p.marked) {
    return (
      <Notice tone="neutral" title={`${longDateTR(p.date)} ${p.till.name ? `${p.till.name} kapalı` : "kafe kapalı"} işaretli`} text="Kafe açıktıysa raporu girin; işaret kendiliğinden kalkar." />
    );
  }

  function send() {
    start(async () => {
      const res = p.role === "staff" ? await requestClosedDay({ date: p.date, reason: reason.trim() || null, clientKey: key, branchId: p.till.id }) : await markClosedDay({ date: p.date, note: reason.trim() || null, branchId: p.till.id });
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

  // Tek satır: durum (başlık) ve varsa tek eylem
  let title: string;
  let action: ReactNode = undefined;
  if (p.role === "staff" && p.pending) {
    title = p.pending.mine ? "Kapalıydı dediniz · onay bekliyor" : `${p.pending.by} kapalıydı dedi · onay bekliyor`;
    if (p.pending.mine) {
      action = (
        <Button size="xs" variant="ghost" onClick={() => withdraw(p.pending!.id)} disabled={pending}>
          <Undo2 size={14} aria-hidden="true" /> Geri çek
        </Button>
      );
    }
  } else if (p.role === "staff" && p.rejected) {
    title = `Yönetici bildirimi reddetti${p.rejected.note ? `: ${p.rejected.note}` : ""}. Raporu girin.`;
  } else if (p.role === "staff" && !p.canAsk) {
    return null;
  } else {
    // Birden çok şube açıkken hangi şubenin kapalı olduğu sorulur (işaret yalnız o şubeye yazılır)
    const place = p.till.name ?? "kafe";
    title = p.role === "staff" ? `Dün ${place} kapalı mıydı?` : `Bu gün ${place} kapalı mıydı?`;
    action = (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)} disabled={pending}>
        <DoorClosed size={14} aria-hidden="true" /> Kafe kapalıydı
      </Button>
    );
  }

  return (
    <>
      <Notice tone="neutral" title={title} action={action} />
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={p.till.name ? `${p.till.name} kapalıydı` : "Kafe kapalıydı"}
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
            <Notice
              tone="warn"
              size="sm"
              title={p.warnings[0]}
              text={
                p.warnings.length > 1
                  ? p.warnings.slice(1).map((w) => (
                      <span key={w} className="block break-words">
                        {w}
                      </span>
                    ))
                  : undefined
              }
            />
          ) : null}
          <Field label="Neden? (isteğe bağlı)" htmlFor="kapali-neden">
            <Input id="kapali-neden" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={CLOSED_REASON_MAX} placeholder="ör. tadilat, elektrik kesintisi" autoComplete="off" />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
