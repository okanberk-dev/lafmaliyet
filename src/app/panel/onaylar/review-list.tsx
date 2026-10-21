"use client";

import { AlertTriangle, Check, ChevronDown, ClipboardCheck, ExternalLink, History, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { RecipeDiff } from "@/components/panel/recipe-diff";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { SIZE_LABELS } from "@/lib/constants";
import { dateTimeTR, pct, tl } from "@/lib/format";
import { REQUEST_STATUS_LABEL, type RecipeSnapshot, type RequestStatus } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";
import { reviewRecipeChange } from "@/server/actions/recipe-requests";

import { STATUS_TONE } from "../receteler/my-requests";

export interface ReviewItem {
  id: number;
  productId: number;
  productName: string;
  size: "M" | "L" | "Tek";
  categoryName: string | null;
  requestedByName: string;
  createdAt: string;
  updatedAt: string;
  message: string | null;
  before: RecipeSnapshot;
  after: RecipeSnapshot;
  /** Bugünkü reçete; öneriden sonra değiştiyse `changedSince` */
  current: RecipeSnapshot | null;
  changedSince: boolean;
  cost: { before: number; after: number; price: number; ratioBefore: number; ratioAfter: number; target: number } | null;
}

export interface RecentItem {
  id: number;
  productId: number;
  productName: string;
  size: "M" | "L" | "Tek";
  status: RequestStatus;
  requestedByName: string;
  reviewedByName: string | null;
  reviewNote: string | null;
  message: string | null;
  at: string;
  before: RecipeSnapshot;
  after: RecipeSnapshot;
}

/**
 * Yöneticinin onay listesi: her öneride kim, ne zaman, neden; önce / sonra farkı; maliyet etkisi (bugünkü hammadde
 * fiyatlarıyla). "Onayla ve uygula" reçeteyi değiştirir; reçete öneriden sonra değiştiyse önce bugünkü hâl ile öneri
 * yan yana gösterilir, yönetici yine de uygulayabilir. "Reddet" isteğe bağlı bir notla.
 */
export function ReviewList({ pending, recent }: { pending: ReviewItem[]; recent: RecentItem[] }) {
  const [busy, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState<{ item: ReviewItem; current: RecipeSnapshot } | null>(null);
  const [openRecent, setOpenRecent] = useState<number | null>(null);

  function approve(item: ReviewItem, force = false) {
    startTransition(async () => {
      const res = await reviewRecipeChange({ id: item.id, decision: "approve", force });
      if (!res.ok) return void toast.error(res.error);
      if (res.data.conflict) return setConflict({ item, current: res.data.current });
      setConflict(null);
      toast.success(`${item.productName} · ${SIZE_LABELS[item.size]} reçetesi güncellendi`, { description: `${item.requestedByName} önerisi onaylandı.` });
    });
  }

  function reject() {
    const item = rejecting;
    if (!item) return;
    startTransition(async () => {
      const res = await reviewRecipeChange({ id: item.id, decision: "reject", note: reason.trim() || null });
      if (!res.ok) return void toast.error(res.error);
      setRejecting(null);
      setReason("");
      toast.success(`${item.productName} önerisi reddedildi`, { description: "Personel sonucu Önerilerim'de görür." });
    });
  }

  return (
    <div className="space-y-6">
      {pending.length ? (
        <section aria-label="Onay bekleyenler" className="space-y-4">
          {pending.map((item) => (
            <Card key={item.id} id={`oneri-${item.id}`}>
              <CardHeader
                icon={<ClipboardCheck />}
                title={
                  <>
                    {item.productName} <span className="font-normal text-ink-mute">· {SIZE_LABELS[item.size]}</span>
                  </>
                }
                description={`${item.requestedByName} önerdi · ${dateTimeTR(item.updatedAt)}${item.categoryName ? ` · ${item.categoryName}` : ""}`}
                actions={
                  <ButtonLink href={`/panel/urunler/${item.productId}`} variant="ghost" size="sm">
                    <ExternalLink size={14} aria-hidden="true" /> Reçete kartı
                  </ButtonLink>
                }
              />
              <div className="space-y-3 px-5 pb-5">
                {item.message ? (
                  <p className="rounded-2xl bg-surface px-3.5 py-2.5 text-sm break-words text-ink-soft ring-1 ring-line">
                    <span className="font-medium text-ink">Personelin notu:</span> {item.message}
                  </p>
                ) : null}
                {item.changedSince ? (
                  <p role="status" className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Reçete bu öneriden sonra değişti. “Önce” sütunu öneri anındaki reçetedir; onaylarken bugünkü hâliyle karşılaştırmanız istenir.
                  </p>
                ) : null}
                <RecipeDiff before={item.before} after={item.after} />
                {item.cost ? <CostImpact cost={item.cost} /> : null}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button onClick={() => approve(item)} disabled={busy} className="max-sm:flex-1">
                    <Check size={16} /> Onayla ve uygula
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setReason("");
                      setRejecting(item);
                    }}
                    className="max-sm:flex-1"
                  >
                    <X size={16} /> Reddet
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </section>
      ) : (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="Onay bekleyen değişiklik yok"
            description="Personel reçete defterinde kalemle değişiklik önerince burada önce ve sonra hâliyle görünür; zilde de haber verilir."
          />
        </Card>
      )}

      {recent.length ? (
        <Card>
          <CardHeader icon={<History />} title="Son kararlar" description="Son 30 günde onaylanan, reddedilen ve geri çekilen öneriler." />
          <ul className="divide-y divide-line border-t border-line">
            {recent.map((r) => {
              const expanded = openRecent === r.id;
              return (
                <li key={r.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words text-ink">
                        {r.productName} <span className="font-normal text-ink-mute">· {SIZE_LABELS[r.size]}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
                        <Badge tone={STATUS_TONE[r.status]} dot>
                          {REQUEST_STATUS_LABEL[r.status]}
                        </Badge>
                        <span>{r.requestedByName} önerdi</span>
                        {r.reviewedByName ? <span>· {r.reviewedByName}</span> : null}
                        <span className="tabular">· {dateTimeTR(r.at)}</span>
                      </p>
                      {r.reviewNote ? <p className="mt-1 text-[13px] break-words text-ink-soft">Not: {r.reviewNote}</p> : null}
                    </div>
                    <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setOpenRecent(expanded ? null : r.id)}>
                      <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                      {expanded ? "Farkı gizle" : "Farkı gör"}
                    </Button>
                  </div>
                  {expanded ? <RecipeDiff before={r.before} after={r.after} className="mt-3" /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Dialog
        open={rejecting !== null}
        onClose={() => !busy && setRejecting(null)}
        size="sm"
        title={rejecting ? `${rejecting.productName} · ${SIZE_LABELS[rejecting.size]} önerisi reddedilsin mi?` : ""}
        description="Reçete değişmez. Notunuz personelin Önerilerim listesinde görünür."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="danger" onClick={reject} disabled={busy}>
              {busy ? "Bekleyin…" : "Reddet"}
            </Button>
          </>
        }
      >
        <Field label="Gerekçe (isteğe bağlı)" htmlFor="red-not">
          <Textarea id="red-not" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder="Ör. “L boyda 2 pompa yeterli”" />
        </Field>
      </Dialog>

      <Dialog
        open={conflict !== null}
        onClose={() => !busy && setConflict(null)}
        size="lg"
        title="Reçete bu öneriden sonra değişti"
        description="Aşağıda bugünkü reçete ile önerilen reçete karşılaştırılıyor. Uygularsanız bugünkü reçetenin yerine önerilen geçer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflict(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={() => conflict && approve(conflict.item, true)} disabled={busy}>
              {busy ? "Bekleyin…" : "Yine de uygula"}
            </Button>
          </>
        }
      >
        {conflict ? <RecipeDiff before={conflict.current} after={conflict.item.after} /> : null}
      </Dialog>
    </div>
  );
}

function CostImpact({ cost }: { cost: NonNullable<ReviewItem["cost"]> }) {
  const diff = cost.after - cost.before;
  const over = cost.ratioAfter > cost.target;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] text-ink-soft ring-1 ring-line">
      <span>
        Maliyet <span className="tabular">{tl(cost.before, 2)}</span> → <span className="font-semibold text-ink tabular">{tl(cost.after, 2)}</span>{" "}
        <span className={cn("tabular", diff > 0.005 ? "text-bad" : diff < -0.005 ? "text-good-ink" : "text-ink-mute")}>
          ({diff >= 0 ? "+" : "−"}
          {tl(Math.abs(diff), 2)})
        </span>
      </span>
      {cost.price > 0 ? (
        <span>
          Maliyet oranı <span className="tabular">{pct(cost.ratioBefore, 0)}</span> → <span className={cn("font-semibold tabular", over ? "text-bad" : "text-ink")}>{pct(cost.ratioAfter, 0)}</span>{" "}
          <span className="text-ink-mute">(hedef {pct(cost.target, 0)}, fiyat {tl(cost.price)})</span>
        </span>
      ) : null}
    </p>
  );
}
