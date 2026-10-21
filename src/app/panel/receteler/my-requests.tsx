"use client";

import { ChevronDown, ClipboardList, Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { RecipeDiff } from "@/components/panel/recipe-diff";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SIZE_LABELS } from "@/lib/constants";
import { dateTimeTR } from "@/lib/format";
import { REQUEST_STATUS_LABEL, type RecipeSnapshot, type RequestStatus } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";
import { withdrawRecipeChange } from "@/server/actions/recipe-requests";

export interface MyRequest {
  id: number;
  productId: number;
  productName: string;
  size: "M" | "L" | "Tek";
  status: RequestStatus;
  before: RecipeSnapshot;
  after: RecipeSnapshot;
  message: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  updatedAt: string;
}

export const STATUS_TONE: Record<RequestStatus, Tone> = { pending: "amber", approved: "green", rejected: "red", withdrawn: "gray" };

/**
 * Personelin önerileri: bekleyenler ve son iki haftada sonuçlananlar. Her birinde önce / sonra farkı açılır; bekleyen
 * öneri geri çekilebilir. Reddedilende yöneticinin notu yazar.
 */
export function MyRequests({ requests }: { requests: MyRequest[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<MyRequest | null>(null);
  const [pending, startTransition] = useTransition();
  const waiting = requests.filter((r) => r.status === "pending").length;

  function withdraw(r: MyRequest) {
    setConfirm(null);
    startTransition(async () => {
      const res = await withdrawRecipeChange(r.id);
      if (res.ok) toast.success(`${r.productName} önerisi geri çekildi`);
      else toast.error(res.error);
    });
  }

  return (
    <Card id="onerilerim" className="no-print mb-6">
      <CardHeader
        icon={<ClipboardList />}
        title="Önerilerim"
        description={
          waiting
            ? `${waiting} öneriniz yöneticinin onayını bekliyor. Onaylanınca reçete kartı değişir.`
            : "Son iki haftadaki önerileriniz ve sonuçları."
        }
      />
      <ul className="divide-y divide-line border-t border-line">
        {requests.map((r) => {
          const expanded = open === r.id;
          return (
            <li key={r.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words text-ink">
                    {r.productName} <span className="font-normal text-ink-mute">· {SIZE_LABELS[r.size]}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
                    <Badge tone={STATUS_TONE[r.status]} dot>
                      {REQUEST_STATUS_LABEL[r.status]}
                    </Badge>
                    <span className="tabular">{dateTimeTR(r.updatedAt)}</span>
                    {r.reviewedByName && r.status !== "pending" && r.status !== "withdrawn" ? <span>· {r.reviewedByName}</span> : null}
                  </p>
                  {r.reviewNote ? <p className="mt-1.5 rounded-xl bg-surface px-3 py-2 text-[13px] break-words text-ink-soft ring-1 ring-line">Yönetici: {r.reviewNote}</p> : null}
                  {r.message ? <p className="mt-1.5 text-[13px] break-words text-ink-mute">Notunuz: {r.message}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.id)}>
                    <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                    {expanded ? "Farkı gizle" : "Farkı gör"}
                  </Button>
                  {r.status === "pending" ? (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirm(r)}>
                      <Undo2 size={14} /> Geri çek
                    </Button>
                  ) : null}
                </div>
              </div>
              {expanded ? <RecipeDiff before={r.before} after={r.after} className="mt-3" /> : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && withdraw(confirm)}
        title={confirm ? `${confirm.productName} · ${SIZE_LABELS[confirm.size]} önerisi geri çekilsin mi?` : ""}
        description="Öneri yöneticinin listesinden kalkar; reçete bugünkü hâliyle kalır. İsterseniz sonra yeniden önerebilirsiniz."
        confirmLabel="Geri çek"
        pending={pending}
      />
    </Card>
  );
}
