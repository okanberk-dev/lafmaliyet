"use client";

import { ClipboardList, Pencil, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { stampTR } from "@/lib/cash-report";
import { genitive } from "@/lib/recipe-change";
import { STATUS_LABEL, type StaffRequestStatus } from "@/lib/staff-requests";
import { requestCashDelete } from "@/server/actions/cash-requests";
import { withdrawStaffRequest } from "@/server/actions/staff-requests";
import type { MyCashRequest, OtherPending, OwnCorrection, OwnDelete } from "@/server/data/cash-requests";

/*
 * Personelin kasa raporu istekleri (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği): kayıtlı raporun altında
 * bekleyen öneri ve silme isteği şeridi, "Silinmesini iste" penceresi ve sayfanın altındaki İsteklerim kartı. Yalnız
 * kişinin kendi yazdığı sayılar gelir; başkasının isteğinden yalnız adı ve türü.
 */

export const REQUEST_TONE: Record<StaffRequestStatus, Tone> = {
  pending: "amber",
  approved: "green",
  done: "green",
  rejected: "red",
  withdrawn: "gray",
  superseded: "gray",
  expired: "gray",
  cancelled: "gray",
  revoked: "gray",
};

/** Yeni bir istemci anahtarı (çift dokunuş ikinci istek açmaz) */
export function newClientKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Bekleyen isteği geri çeker (ortak eylem); tek dokunuş, onay sormaz (yeniden gönderilebilir) */
function useWithdraw() {
  const [pending, start] = useActionTransition();
  const withdraw = (id: number, done: string) =>
    start(async () => {
      const res = await withdrawStaffRequest(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(done);
    });
  return [pending, withdraw] as const;
}

/**
 * Kayıtlı raporun altında bekleyen istekler: kişinin kendi düzeltme önerisi (değişen satırlar ve sonuç, "Öneriyi
 * düzenle", "Geri çek"), kendi silme isteği ("Geri çek") ve başkalarının bekleyen istekleri (yalnız adı)
 */
export function PendingRequests({ own, others, onEdit }: { own: (OwnCorrection | OwnDelete)[]; others: OtherPending[]; onEdit: (c: OwnCorrection) => void }) {
  const [pending, withdraw] = useWithdraw();
  if (!own.length && !others.length) return null;
  return (
    <div className="space-y-2">
      {own.map((r) =>
        r.kind === "kasa-duzeltme" ? (
          <div key={r.id} role="status" className="space-y-1.5 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] leading-5 text-warn">
            <p className="font-semibold">Düzeltme öneriniz onay bekliyor · {stampTR(r.createdAt)}</p>
            <ul className="space-y-0.5 text-ink-soft">
              {r.lines.map((l) => (
                <li key={l} className="break-words">
                  {l}
                </li>
              ))}
              {r.result ? <li className="font-medium text-ink">{r.result}</li> : null}
              {r.carry ? <li>{r.carry}</li> : null}
            </ul>
            {r.message ? <p className="break-words text-ink-mute">Neden: {r.message}</p> : null}
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button size="sm" variant="secondary" onClick={() => onEdit(r)} disabled={pending}>
                <Pencil size={14} /> Öneriyi düzenle
              </Button>
              <Button size="sm" variant="ghost" onClick={() => withdraw(r.id, "Düzeltme öneriniz geri çekildi")} disabled={pending}>
                <Undo2 size={14} /> Geri çek
              </Button>
            </div>
          </div>
        ) : (
          <div key={r.id} role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] leading-5 text-warn">
            <p className="min-w-0 flex-1 basis-56">
              <span className="font-semibold">Silme isteğiniz onay bekliyor · {stampTR(r.createdAt)}</span>
              {r.message ? <span className="block break-words text-ink-mute">Neden: {r.message}</span> : null}
            </p>
            <Button size="sm" variant="ghost" onClick={() => withdraw(r.id, "Silme isteğiniz geri çekildi")} disabled={pending}>
              <Undo2 size={14} /> Geri çek
            </Button>
          </div>
        ),
      )}
      {others.map((o, i) => (
        <p key={i} className="rounded-xl bg-panel px-3 py-2 text-[13px] leading-5 text-ink-mute">
          {o.kind === "kasa-silme" ? `${o.requestedByName} raporun silinmesini istedi; onay bekliyor` : `${genitive(o.requestedByName)} düzeltme önerisi onay bekliyor`}
        </p>
      ))}
    </div>
  );
}

/** "Silinmesini iste": neden zorunlu; rapor silinene kadar yerinde kalır */
export function DeleteRequestButton({ date, revision, label }: { date: string; revision: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newClientKey);
  const [pending, start] = useActionTransition();

  function send() {
    const r = reason.trim();
    if (r.length < 3) return setError("Nedenini yazın");
    start(async () => {
      const res = await requestCashDelete({ date, baseRevision: revision, message: r, clientKey: key });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      toast.success("Silme isteği gönderildi", { description: "Yönetici silene kadar rapor yerinde kalır; sonucu zilde görürsünüz." });
      setOpen(false);
      setReason("");
      setKey(newClientKey());
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-ink-mute pointer-coarse:min-h-11">
        <Trash2 size={14} /> Silinmesini iste
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Bu rapor silinsin mi?"
        description={label}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending} className="max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button variant="danger" onClick={send} disabled={pending}>
              {pending ? "Gönderiliyor…" : "Silme isteği gönder"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-mute">Yanlış güne ya da iki kez girildiyse yönetici siler. Silinene kadar rapor yerinde kalır.</p>
          <Field label="Neden?" htmlFor="k-delete-reason" error={error ?? undefined}>
            <Textarea
              id="k-delete-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              rows={3}
              maxLength={500}
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/**
 * İsteklerim (kasa sayfasının altında, `#isteklerim`): son 7 günün kasa istekleri, başlık, durum ve yöneticinin notu;
 * bekleyende "Geri çek". Liste boşsa kart çizilmez.
 */
export function MyCashRequests({ requests }: { requests: MyCashRequest[] }) {
  const [pending, withdraw] = useWithdraw();
  if (!requests.length) return null;
  const waiting = requests.filter((r) => r.status === "pending").length;
  return (
    <Card id="isteklerim">
      <CardHeader icon={<ClipboardList />} title="İsteklerim" description={waiting ? `${waiting} isteğiniz yöneticinin onayını bekliyor.` : "Son 7 günün kasa istekleri ve sonuçları."} />
      <ul className="divide-y divide-line border-t border-line">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1 basis-56">
              <p className="font-medium break-words text-ink">{r.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
                <Badge tone={REQUEST_TONE[r.status]} dot>
                  {STATUS_LABEL[r.status]}
                </Badge>
                <span className="tabular">{stampTR(r.status === "pending" ? r.createdAt : r.updatedAt)}</span>
              </p>
              {r.reviewNote ? (
                <p className="mt-1 text-[13px] break-words text-ink-soft">
                  {/* Yalnız kararın notu yöneticinin; kapanma, kaldırılma ve sıfırlama notları sistemin */}
                  {r.status === "approved" || r.status === "rejected" ? `Yönetici: ${r.reviewNote}` : r.reviewNote}
                </p>
              ) : null}
            </div>
            {r.status === "pending" ? (
              <Button size="sm" variant="ghost" onClick={() => withdraw(r.id, "İstek geri çekildi")} disabled={pending}>
                <Undo2 size={14} /> Geri çek
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
