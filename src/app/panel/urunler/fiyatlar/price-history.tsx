"use client";

import { ChevronDown, History, RotateCcw, SearchX } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { matches, SearchField, useQueryText } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { money, num, pct } from "@/lib/format";
import { numPossessive } from "@/lib/prices/bulk";
import { groupHistory, historyDayLabel, PRICE_SOURCE_LABEL, timeTR, undoPlan, type HistoryEntry, type HistoryRow } from "@/lib/prices/history";
import { batchPosNote } from "@/lib/prices/pos";
import { todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { undoPriceBatch } from "@/server/actions/prices";

import { productHref } from "../logic";

const PAGE_SIZE = 50;
const sizeLabel = (s: string) => SIZE_LABELS[s as Size] ?? s;
const rowText = (r: HistoryRow) => `${r.name} ${r.size} ${sizeLabel(r.size)}`;

/** "195 ₺ → 205 ₺ (+%5,1)"; yeni üründe yalnız fiyat */
function Change({ r }: { r: HistoryRow }) {
  if (r.priceBefore === null) return <span className="font-semibold text-ink tabular">{money(r.price)}</span>;
  const d = r.priceBefore > 0 ? (r.price - r.priceBefore) / r.priceBefore : null;
  return (
    <span className="whitespace-nowrap tabular">
      <span className="text-ink-mute">{money(r.priceBefore)}</span> → <span className="font-semibold text-ink">{money(r.price)}</span>
      {d !== null ? <span className={cn("ml-1 text-xs", d < 0 ? "text-warn" : "text-ink-mute")}>({`${d < 0 ? "−" : "+"}${pct(Math.abs(d))}`})</span> : null}
    </span>
  );
}

/** Aramada toplu kaydın yalnız eşleşen satırları gösterilir; geri alma planı bütün satırlarla */
type Shown = { entry: HistoryEntry; rows: HistoryRow[] };

/**
 * Ürünler › Fiyatlar › Geçmiş: menünün satış fiyatı geçmişi, en yeni önce ve güne göre (Türkiye saati). Toplu değişiklik
 * tek satırda katlanır, açılınca ürünleri; fiyatı hâlâ toplu değişikliğin yazdığı ürün varsa "Geri al".
 */
export function PriceHistory({ rows, products }: { rows: HistoryRow[]; products: { id: number; price: number; linked: boolean }[] }) {
  const [q, setQ] = useQueryText("ara");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [confirm, setConfirm] = useState<Extract<HistoryEntry, { kind: "batch" }> | null>(null);
  const [pending, start] = useActionTransition();
  const current = useMemo(() => new Map(products.map((p) => [p.id, p.price])), [products]);
  const linked = useMemo(() => new Set(products.filter((p) => p.linked).map((p) => p.id)), [products]);
  const entries = useMemo(() => groupHistory(rows), [rows]);
  const shown = useMemo<Shown[]>(() => {
    if (!q.trim()) return entries.map((entry) => ({ entry, rows: entry.kind === "batch" ? entry.rows : [entry.row] }));
    return entries.flatMap((entry) => {
      const list = (entry.kind === "batch" ? entry.rows : [entry.row]).filter((r) => matches(rowText(r), q));
      return list.length ? [{ entry, rows: list }] : [];
    });
  }, [entries, q]);
  const paged = usePaged(shown, PAGE_SIZE, q);
  const today = todayTR();

  const planOf = (e: Extract<HistoryEntry, { kind: "batch" }>) =>
    undoPlan(
      e.rows.map((r) => ({ id: r.id, productId: r.productId, label: `${r.name} · ${r.size}`, priceBefore: r.priceBefore, price: r.price, changedAt: r.changedAt })),
      current,
    );

  function undo(e: Extract<HistoryEntry, { kind: "batch" }>) {
    setConfirm(null);
    start(async () => {
      const r = await undoPriceBatch(e.batchId);
      if (!r.ok) return void toast.error(r.error);
      const { applied, failed } = r.data;
      if (applied.length) {
        toast.success(`${num(applied.length)} fiyat eski haline döndü`, {
          description: failed.length
            ? `${num(failed.length)} ürün geri alınamadı: ${failed[0].label} — ${failed[0].reason}`
            : batchPosNote("undo", applied),
          duration: failed.length ? 12_000 : undefined,
        });
      } else toast.error("Hiçbir fiyat geri alınmadı", { description: failed[0] ? `${failed[0].label} — ${failed[0].reason}` : undefined });
    });
  }

  const confirmPlan = confirm ? planOf(confirm) : null;
  const confirmSite = confirmPlan ? confirmPlan.revert.filter((x) => linked.has(x.productId)).length : 0;
  const changedLater = confirmPlan ? confirmPlan.skipped.filter((x) => x.kind === "changed").length : 0;

  return (
    <Card>
      <CardHeader
        icon={<History />}
        title="Fiyat geçmişi"
        description="Panelde, toplu ya da laffogato.net'te değişen her satış fiyatı. Toplu değişiklik, fiyatı sonradan değişmeyen ürünler için geri alınabilir."
        meta={rows.length ? <span className="tabular">{num(rows.length)} değişiklik</span> : null}
      />
      {rows.length ? (
        <div className="px-5 pb-4">
          <SearchField value={q} onChange={setQ} placeholder="Ürün ara" label="Geçmişte ürün ara" className="sm:w-72 max-sm:[&_input]:h-11" />
        </div>
      ) : null}
      {!rows.length ? (
        <EmptyState
          icon={<History />}
          title="Henüz fiyat değişikliği yok"
          description="Bundan sonra panelde, toplu ya da laffogato.net'te değişen her satış fiyatı burada görünür."
        />
      ) : !shown.length ? (
        <EmptyState icon={<SearchX />} title={`“${q.trim()}” için kayıt yok`} description="Aramayı kısaltın ya da ürünün adını kontrol edin." />
      ) : (
        <>
          <div className="px-3 pb-2" data-page-top="">
            {paged.slice.map(({ entry, rows: list }, i) => {
              const prev = paged.slice[i - 1]?.entry;
              const head = !prev || prev.day !== entry.day;
              return (
                <Fragment key={entry.kind === "batch" ? `b:${entry.batchId}` : `r:${entry.row.id}`}>
                  {head ? <h3 className="px-2 pt-3 pb-1.5 text-[13px] font-semibold text-ink-soft">{historyDayLabel(entry.day, today)}</h3> : null}
                  {entry.kind === "single" ? (
                    <SingleItem r={entry.row} />
                  ) : (
                    <BatchItem
                      e={entry}
                      rows={list}
                      searching={!!q.trim()}
                      open={open.has(entry.batchId) || !!q.trim()}
                      onToggle={() =>
                        setOpen((s) => {
                          const next = new Set(s);
                          if (next.has(entry.batchId)) next.delete(entry.batchId);
                          else next.add(entry.batchId);
                          return next;
                        })
                      }
                      canUndo={entry.source === "bulk" && planOf(entry).revert.length > 0}
                      pending={pending}
                      onUndo={() => setConfirm(entry)}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
          <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} unit="kayıt" className="border-t border-line" />
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && undo(confirm)}
        tone="primary"
        confirmLabel="Geri al"
        title="Toplu değişiklik geri alınsın mı?"
        description={
          confirmPlan
            ? `${num(confirmPlan.revert.length)} ürünün fiyatı eski haline döner${confirmSite ? ` (${numPossessive(confirmSite)} sitede de)` : ""}.${
                changedLater ? ` Sonradan değişmiş ${num(changedLater)} ürüne dokunulmaz.` : ""
              }`
            : undefined
        }
      />
    </Card>
  );
}

/** Kim, ne zaman, nereden: "14:05 · Selin · Elle · sitede de" */
function Meta({ r }: { r: HistoryRow }) {
  return (
    <span className="text-xs text-ink-mute">
      {[timeTR(r.changedAt), r.source !== "site" ? r.changedBy : null, PRICE_SOURCE_LABEL[r.source], r.onSite ? "sitede de" : null].filter(Boolean).join(" · ")}
    </span>
  );
}

function SingleItem({ r }: { r: HistoryRow }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-xl px-2 py-2.5 hover:bg-surface/60">
      <span className="min-w-0">
        <Link href={productHref(r.productId)} className="font-semibold break-words text-ink hover:underline pointer-coarse:-my-2 pointer-coarse:py-2">
          {r.name} · {sizeLabel(r.size)}
        </Link>
        <span className="block">
          <Meta r={r} />
        </span>
      </span>
      <Change r={r} />
    </div>
  );
}

function BatchItem({
  e,
  rows,
  searching,
  open,
  onToggle,
  canUndo,
  pending,
  onUndo,
}: {
  e: Extract<HistoryEntry, { kind: "batch" }>;
  rows: HistoryRow[];
  searching: boolean;
  open: boolean;
  onToggle: () => void;
  canUndo: boolean;
  pending: boolean;
  onUndo: () => void;
}) {
  const label = PRICE_SOURCE_LABEL[e.source];
  // Geri almanın notu "Geri alındı: …" diye başlar; başlıkta kaynağın adı zaten yazılı
  const note = (e.note ?? "").replace(/^Geri alındı:\s*/, "");
  return (
    <div className="rounded-xl px-2 py-2.5 hover:bg-surface/60">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <button type="button" onClick={onToggle} aria-expanded={open} disabled={searching} className="flex min-w-0 cursor-pointer items-start gap-1.5 text-left disabled:cursor-default">
          <ChevronDown size={15} className={cn("mt-1 shrink-0 text-ink-mute transition-transform", open && "rotate-180")} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block break-words text-ink">
              <span className="font-semibold">{label}:</span> {note ? `${note} · ` : ""}
              {num(e.rows.length)} ürün
              {searching && rows.length !== e.rows.length ? <span className="text-ink-mute"> (aramayla {num(rows.length)})</span> : null}
            </span>
            <span className="block text-xs text-ink-mute">
              {[timeTR(e.changedAt), e.changedBy, e.onSite ? `${numPossessive(e.onSite)} sitede de` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
        {canUndo ? (
          <Button size="sm" variant="secondary" onClick={onUndo} disabled={pending}>
            <RotateCcw size={14} aria-hidden="true" /> Geri al
          </Button>
        ) : e.source === "undo" ? (
          <Badge tone="gray">Geri alma</Badge>
        ) : null}
      </div>
      {open ? (
        <ul className="mt-2 ml-6 divide-y divide-line-strong/60 rounded-xl bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm">
              <Link href={productHref(r.productId)} className="min-w-0 font-medium break-words text-ink hover:underline pointer-coarse:-my-2 pointer-coarse:py-2">
                {r.name} · {sizeLabel(r.size)}
                {r.onSite ? <span className="ml-1.5 text-xs font-normal text-info">sitede de</span> : null}
              </Link>
              <Change r={r} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
