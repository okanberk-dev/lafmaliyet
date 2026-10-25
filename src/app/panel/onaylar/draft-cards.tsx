"use client";

import { Check, CheckCheck, Minus, Plus, ShoppingBasket, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { stampTR } from "@/lib/cash-report";
import { dateTR, money, num } from "@/lib/format";
import { DRAFT_NOTE_MAX } from "@/lib/reorder/draft";
import { orderMessage, qtyLabel } from "@/lib/reorder/message";
import { genitive } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";
import { approveCleanDrafts, reviewOrderDraft } from "@/server/actions/order-drafts";
import type { DraftQueueCard, DraftQueueLine } from "@/server/data/order-drafts";

/*
 * Onaylar › Mal siparişi (yalnız yönetici; docs/MAL-SIPARISI.md › Personelin sipariş taslağı). Taslak başına kapalı
 * gelen bir kart (#istek-<id>): satırların işaretleri (öneriden fazla, öneri yoktu, sayım beklenenden düşük, sayım
 * taslaktan hemen önce değişti), öneri, eldeki, geçen sayım ve beklenen; adımlayıcı ve tahmini tutar; yoldaki
 * siparişler; tedarikçiye gidecek mesajın tam metni (tedarikçiye not düzenlenir); personele not (retle zorunlu).
 * Bölüm başında "İşaretsizleri onayla". Tutar yalnız burada görünür.
 */

export function DraftQueueCards({ cards }: { cards: DraftQueueCard[] }) {
  const clean = cards.filter((c) => c.clean);
  const [pending, run] = useActionTransition();
  return (
    <Card>
      <CardHeader
        icon={<ShoppingBasket />}
        title="Mal siparişi"
        description="Personelin hızlı sayımdan sonra hazırladığı taslaklar. Onaylayınca personel WhatsApp'tan gönderir; reddederseniz notunuz personele görünür (tutar yazmayın)."
        actions={
          clean.length ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              className="pointer-coarse:h-11"
              onClick={() =>
                run(async () => {
                  const res = await approveCleanDrafts({ items: clean.map((c) => ({ id: c.id, seenVersion: c.version })) });
                  if (!res.ok) return void toast.error(res.error);
                  const skipped = res.data.skipped.length;
                  toast.success(`${num(res.data.approved)} taslak onaylandı`, skipped ? { description: `${num(skipped)} taslak atlandı: ${res.data.skipped[0].reason}` } : undefined);
                })
              }
            >
              <CheckCheck size={15} aria-hidden="true" /> İşaretsizleri onayla ({num(clean.length)})
            </Button>
          ) : undefined
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {cards.map((c) => (
          <DraftItem key={c.id} card={c} />
        ))}
      </div>
    </Card>
  );
}

const amount = (v: number | null, unit: string | null) => (v === null ? "–" : `${num(v, 1)} ${unit ?? ""}`.trim());

function DraftItem({ card }: { card: DraftQueueCard }) {
  const [qty, setQty] = useState<Record<number, number>>(() => Object.fromEntries(card.lines.map((l) => [l.ingredientId, l.qty])));
  const [supplierNote, setSupplierNote] = useState(card.supplierNote ?? "");
  const [note, setNote] = useState("");
  const [pending, run] = useActionTransition();
  const q = (l: DraftQueueLine) => qty[l.ingredientId] ?? 0;
  const chosen = card.lines.filter((l) => q(l) > 0);
  const priced = chosen.filter((l) => l.packPrice !== null);
  const total = priced.reduce((a, l) => a + (l.packPrice ?? 0) * q(l), 0);
  const estimated = priced.some((l) => l.priceEstimated);
  const message = orderMessage({ signature: card.signature, lines: card.lines.map((l) => ({ orderName: l.orderName, qty: q(l), unit: l.unit })), note: supplierNote.trim() || null, ref: card.ref });
  const flagged = card.lines.some((l) => l.flags.length);
  const who = genitive(card.requestedByName);

  function decide(decision: "approve" | "reject") {
    run(async () => {
      const res = await reviewOrderDraft({
        id: card.id,
        seenVersion: card.version,
        decision,
        lines: decision === "approve" ? card.lines.map((l) => ({ ingredientId: l.ingredientId, qty: q(l) })) : null,
        supplierNote: supplierNote.trim() || null,
        note: note.trim() || null,
      });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      toast.success(res.data.status === "approved" ? `${card.supplier} taslağı onaylandı; personel gönderecek` : `${who} taslağı reddedildi`);
    });
  }

  return (
    <details id={`istek-${card.id}`} className="group scroll-mt-24">
      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 inline-block shrink-0 text-ink-mute transition-transform group-open:rotate-90" aria-hidden="true">
          ›
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
            {card.title}
            {flagged ? <Badge tone="amber">İşaretli</Badge> : card.clean ? <Badge tone="green">Öneriyle aynı</Badge> : null}
          </span>
          <span className="block text-[13px] text-ink-mute tabular">
            {card.requestedByName} hazırladı · {stampTR(card.createdAt)}
            {card.countAt ? ` · Sayım ${stampTR(card.countAt)}${card.countBy ? ` (${card.countBy})` : ""}` : ""}
          </span>
        </span>
      </summary>
      <div className="space-y-3 px-5 pb-4">
        {card.newerCount ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">Taslaktan sonra bu kalemlerden biri yeniden sayıldı; miktarları kontrol edin.</p> : null}
        <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
          {card.lines.map((l) => (
            <DraftQueueRow key={l.ingredientId} l={l} qty={q(l)} onQty={(v) => setQty((x) => ({ ...x, [l.ingredientId]: Math.max(0, Math.min(9999, Math.round(v * 100) / 100)) }))} />
          ))}
        </ul>
        {card.onOrder.length ? (
          <div className="space-y-0.5 text-[13px] text-ink-soft">
            {card.onOrder.map((o) => (
              <p key={o}>Yolda: {o}</p>
            ))}
          </div>
        ) : null}
        {priced.length ? (
          <p className="text-sm font-medium text-ink tabular">
            Tahmini tutar ≈ {money(total)} (KDV hariç, son fatura fiyatıyla{estimated ? "; bazı fiyatlar tahmini" : ""})
          </p>
        ) : null}
        <Field label="Tedarikçiye not (mesaja girer)" htmlFor={`taslak-tnot-${card.id}`}>
          <Textarea id={`taslak-tnot-${card.id}`} rows={2} maxLength={DRAFT_NOTE_MAX} value={supplierNote} onChange={(e) => setSupplierNote(e.target.value)} />
        </Field>
        <section aria-label="Tedarikçiye gidecek mesaj">
          <p className="mb-1 text-[13px] font-medium text-ink-soft">Tedarikçiye gidecek mesaj</p>
          <pre className="max-h-56 overflow-y-auto overscroll-contain rounded-2xl bg-panel p-3.5 font-sans text-[13px] leading-5 whitespace-pre-wrap text-ink">{message}</pre>
        </section>
        <Field label="Not (personele görünür; tutar yazmayın)" htmlFor={`taslak-not-${card.id}`} hint="Reddederken zorunlu.">
          <Textarea id={`taslak-not-${card.id}`} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => (note.trim() ? decide("reject") : void toast.error("Reddederken personele bir not yazın"))}
          >
            <X size={15} aria-hidden="true" /> Reddet
          </Button>
          <Button disabled={pending || !chosen.length} onClick={() => decide("approve")}>
            <Check size={15} aria-hidden="true" /> Onayla ({num(chosen.length)} kalem)
          </Button>
        </div>
      </div>
    </details>
  );
}

/** Satır (390 px'te üç satır): ad ve işaretler; öneri, eldeki, geçen, beklenen; adımlayıcı ve tutar */
function DraftQueueRow({ l, qty, onQty }: { l: DraftQueueLine; qty: number; onQty: (q: number) => void }) {
  const facts = [
    l.suggested === null ? "Öneri yok" : `Öneri ${qtyLabel(l.suggested, l.unit)}`,
    `Eldeki ${amount(l.onHand, l.countUnit)}`,
    l.prevCount !== null && l.prevCountDay ? `Geçen ${amount(l.prevCount, l.countUnit)} · ${dateTR(l.prevCountDay).slice(0, 5)}` : null,
    l.expectedOnHand !== null ? `beklenen ≈ ${num(l.expectedOnHand, 1)}` : null,
  ].filter(Boolean);
  return (
    <li className="space-y-1.5 px-4 py-3">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium break-words text-ink">
        <span>{l.orderName}</span>
        {l.flags.map((f) => (
          <Badge key={f.key} tone={f.key === "dusuk-sayim" ? "red" : "amber"}>
            {f.text}
          </Badge>
        ))}
        {!l.inPlan ? <Badge tone="gray">Listede değil</Badge> : null}
      </p>
      <p className="text-xs break-words text-ink-mute tabular">{facts.join(" · ")}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label={`${l.orderName} miktarı`}>
          <button
            type="button"
            onClick={() => onQty(Math.max(0, Math.ceil(qty) - 1))}
            disabled={qty <= 0}
            aria-label="Bir azalt"
            className="flex size-9 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink disabled:cursor-default disabled:opacity-40 pointer-coarse:size-11"
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <span className={cn("flex h-9 min-w-[4.5rem] flex-col items-center justify-center rounded-xl px-2 leading-tight ring-1 ring-inset pointer-coarse:h-11", qty > 0 ? "bg-surface text-ink ring-line-strong" : "bg-panel text-ink-mute ring-line")}>
            <span className="text-sm font-semibold tabular">{num(qty, 2)}</span>
            <span className="text-[11px] text-ink-mute">{l.unit}</span>
          </span>
          <button
            type="button"
            onClick={() => onQty(Math.floor(qty) + 1)}
            aria-label="Bir artır"
            className="flex size-9 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink pointer-coarse:size-11"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        {l.packPrice !== null && qty > 0 ? (
          <span className="text-[13px] text-ink-soft tabular">
            ≈ {money(l.packPrice * qty)}
            {l.priceEstimated ? " tahmini" : ""}
          </span>
        ) : null}
      </div>
    </li>
  );
}
