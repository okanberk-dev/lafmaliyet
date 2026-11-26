"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { dateTR, money } from "@/lib/format";
import { closePeriod, decideHeldRecord, reopenPeriod } from "@/server/actions/closed-period";

export interface ClosedRow {
  month: string;
  title: string;
  at: string;
  by: string;
  /** Bugünkü sağlama (son 12 kapanış); eskisinde null */
  check: string | null;
  /** Kapanıştan sonra değiştiyse tek cümle */
  drift: string | null;
}

export interface HeldRow {
  kind: "invoice" | "expense";
  id: number;
  date: string;
  month: string;
  monthTitle: string;
  title: string;
  detail: string | null;
  amount: number;
  createdAt: string;
  source: string | null;
}

/**
 * Dönem kapanışının istemci kısmı: kapalı döneme düşen kayıtların kararı, ay kapatma (onaylı) ve yeniden açma
 * (gerekçeyle). Her eylemden sonra sayfa sunucudan yenilenir (refresh).
 */
export function ClosedPeriodPanel({ closed, closable, heldText, held }: { closed: ClosedRow[]; closable: { month: string; title: string }[]; heldText: string | null; held: HeldRow[] }) {
  const [pending, start] = useActionTransition();
  const [month, setMonth] = useState(closable[0]?.month ?? "");
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopen, setReopen] = useState<ClosedRow | null>(null);
  const [reason, setReason] = useState("");
  const [accept, setAccept] = useState<HeldRow | null>(null);
  const picked = closable.find((c) => c.month === month) ?? null;

  function doClose() {
    if (!picked) return;
    start(async () => {
      const r = await closePeriod(picked.month);
      setConfirmClose(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${picked.title} kapatıldı`, { description: `${r.data.invoices} fatura, ${r.data.expenses} harcama kapanışta kayıtlı` });
    });
  }

  function doReopen() {
    if (!reopen) return;
    const row = reopen;
    start(async () => {
      const r = await reopenPeriod(row.month, reason);
      if (!r.ok) return void toast.error(r.error);
      setReopen(null);
      setReason("");
      toast.success(`${row.title} yeniden açıldı`, { description: "Bekleyen kayıtlar o aya girdi" });
    });
  }

  function decide(row: HeldRow, decision: "move" | "accept") {
    start(async () => {
      const r = await decideHeldRecord({ kind: row.kind, id: row.id, decision });
      setAccept(null);
      if (!r.ok) return void toast.error(r.error);
      toast.success(decision === "move" ? `${dateTR(r.data.periodDate)} tarihinde sayılacak` : `${row.monthTitle} rakamına işlendi`);
    });
  }

  return (
    <div className="space-y-4">
      {heldText ? (
        <div className="space-y-2">
          <Notice tone="warn" title="Kapalı döneme düşenler" text={`${heldText} "Bu aya al": kayıt bugünün ayında sayılır, belgenin tarihi değişmez. "Kapalı aya işle": kapalı ayın rakamı bilerek değişir.`} />
          <ul className="divide-y divide-line-strong/70 rounded-2xl bg-surface px-4 ring-1 ring-line">
            {held.map((h) => (
              <li key={`${h.kind}-${h.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 text-sm">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
                    <Badge tone={h.kind === "invoice" ? "coffee" : "gray"}>{h.kind === "invoice" ? "Fatura" : "Harcama"}</Badge>
                    <span className="font-medium">{h.title}</span>
                    {h.detail ? <span className="text-ink-mute">{h.detail}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-mute tabular">
                    {dateTR(h.date)} ({h.monthTitle} kapalı) · {money(h.amount)} · {h.source === "parasut" ? "Paraşüt'ten" : "eklendi"} {h.createdAt}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => decide(h, "move")} disabled={pending}>
                    Bu aya al
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAccept(h)} disabled={pending}>
                    Kapalı aya işle
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Kapatılacak ay" htmlFor="donem-ay" className="w-48">
          <Select id="donem-ay" value={month} onChange={(e) => setMonth(e.target.value)} disabled={!closable.length}>
            {closable.length ? (
              closable.map((c) => (
                <option key={c.month} value={c.month}>
                  {c.title}
                </option>
              ))
            ) : (
              <option value="">Kapatılacak ay yok</option>
            )}
          </Select>
        </Field>
        <Button onClick={() => setConfirmClose(true)} disabled={pending || !picked}>
          Ayı kapat
        </Button>
      </div>

      {closed.length ? (
        <ul className="divide-y divide-line-strong/70 rounded-2xl bg-surface px-4 ring-1 ring-line">
          {closed.map((c) => (
            <li key={c.month} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="flex flex-wrap items-center gap-2 text-ink">
                  <span className="font-medium">{c.title}</span>
                  <Badge tone="gray" dot>
                    Kapalı
                  </Badge>
                  <span className="text-xs text-ink-mute">
                    {c.by} · {c.at}
                  </span>
                </p>
                <Button size="sm" variant="ghost" onClick={() => setReopen(c)} disabled={pending}>
                  Yeniden aç
                </Button>
              </div>
              {c.check ? <p className="text-xs text-ink-mute tabular">Bugün: {c.check}</p> : null}
              {c.drift ? <Notice tone="warn" size="sm" title={c.drift} text="Paraşüt'te sonradan değişen ya da silinen fatura olabilir; muhasebecinizle karşılaştırın." /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-mute">Henüz kapalı ay yok. Muhasebeci ayın beyannamesini verince o ayı buradan kapatın.</p>
      )}

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={doClose}
        pending={pending}
        tone="primary"
        confirmLabel="Ayı kapat"
        title={picked ? `${picked.title} kapatılsın mı?` : "Ay kapatılsın mı?"}
        description="Bu ayın faturaları ve harcamaları düzeltilemez, silinemez. Bu aya tarihli yeni fatura ya da harcama gelirse hesaplara girmez, burada kararınızı bekler. Gerekirse ayı yeniden açabilirsiniz."
      />
      <ConfirmDialog
        open={accept !== null}
        onClose={() => setAccept(null)}
        onConfirm={() => accept && decide(accept, "accept")}
        pending={pending}
        tone="primary"
        confirmLabel="Kapalı aya işle"
        title={accept ? `${accept.monthTitle} rakamı değişsin mi?` : "Kapalı aya işlensin mi?"}
        description={accept ? `${accept.title} (${money(accept.amount)}) ${accept.monthTitle} hesaplarına girer; beyan edilmiş rakam değişir. Muhasebecinize haber verin.` : undefined}
      />
      <Dialog
        open={reopen !== null}
        onClose={() => setReopen(null)}
        title={reopen ? `${reopen.title} yeniden açılsın mı?` : "Dönem yeniden açılsın mı?"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReopen(null)} disabled={pending}>
              Vazgeç
            </Button>
            <Button variant="danger" onClick={doReopen} disabled={pending || reason.trim().length < 3}>
              {pending ? "Bekleyin…" : "Yeniden aç"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-mute">
          <p>Bekleyen kayıtlar o aya girer, kayıtlar yeniden düzeltilebilir. Gerekçe işlem geçmişine yazılır.</p>
          <Field label="Gerekçe" htmlFor="donem-gerekce">
            <Textarea id="donem-gerekce" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. muhasebeci düzeltme beyannamesi verecek" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
