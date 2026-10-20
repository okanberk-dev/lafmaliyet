"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { prepareBreakdown, shareLabel, type BreakdownGroup, type PreparedGroup, type PreparedRow } from "@/lib/breakdown";
import { money, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Dialog } from "./dialog";

/** Uzun bölümde (ör. yılın tedarikçileri) ilk bu kadar kalem görünür, gerisi "N kalem daha" ile açılır */
const FOLD_AT = 10;
const FOLD_SHOW = 8;

/**
 * Özet kartı (`Stat`) dökümüyle: karta dokununca rakamı oluşturan kalemler pencerede açılır (bölüm bölüm, büyükten
 * küçüğe, tutar, toplamdaki pay ve toplam satırı; toplama girmeyen bölümler toplamın altında ayrı). Kartın görünümü
 * aynı kalır: üstüne görünmez bir düğme serilir, sağ üstte "Döküm ›" ipucu çıkar. Karttaki InfoTip ve bağlantılar
 * düğmenin üstünde kalır (kendi işlerini görür). İpucu ikon satırında durur; kartın ikonu olmalı.
 *
 * Veri sunucuda kurulur (`groups`); pencere yalnızca sıralar ve payları bulur (`lib/breakdown.ts`).
 */
export function StatBreakdown({
  children,
  title,
  description,
  groups,
  total,
  totalLabel = "Toplam",
  order,
  shares = true,
  exact = false,
  empty = "Bu dönemde kalem yok.",
  className,
}: {
  /** Kart: `<Stat … />` */
  children: ReactNode;
  /** Pencerenin başlığı; düğmenin erişilebilir adı da buradan ("… dökümünü aç") */
  title: string;
  description?: ReactNode;
  groups: BreakdownGroup[];
  /** Toplam satırı (kartın rakamı); verilmezse toplama giren bölümlerin toplamı */
  total?: number;
  totalLabel?: string;
  /** "given": bölüm ve kalem sırası verildiği gibi (ör. kâr: önce ciro, sonra giderler) */
  order?: "amount" | "given";
  /** Toplamdaki pay sütunu (kâr dökümü gibi artı/eksi karışık dökümde kapatılır) */
  shares?: boolean;
  /** Kalemler kuruşlu (girilen harcamalar); değilse tam lira */
  exact?: boolean;
  empty?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const close = () => setOpen(false);
  const amount = (v: number) => (exact ? money(v) : tl(v));
  const prepared = open ? prepareBreakdown(groups, { total, order }) : null;

  const row = (r: PreparedRow) => {
    const body = (
      <>
        <span className="min-w-0 flex-1">
          <span className="block text-sm break-words text-ink">{r.label}</span>
          {r.sub ? <span className="block text-xs break-words text-ink-mute">{r.sub}</span> : null}
          {shares && r.share !== null && r.share > 0 ? (
            <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-ink/[0.06]">
              <span className="block h-full rounded-full bg-ink/35" style={{ width: `${Math.min(100, r.share * 100)}%` }} />
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className={cn("block text-sm text-ink tabular", r.amount < 0 && "text-bad")}>{amount(r.amount)}</span>
          {shares && r.share !== null ? <span className="block text-xs text-ink-mute tabular">{shareLabel(r.share)}</span> : null}
        </span>
      </>
    );
    return (
      <li key={r.key}>
        {r.href ? (
          // Aynı sayfaya giden bağlantıda (ör. Faturalar'da süzülmüş liste) pencere açık kalmasın
          <Link href={r.href} onClick={close} className="-mx-3 flex min-h-11 items-start gap-3 px-3 py-2 hover:bg-ink/[0.03] focus-visible:bg-ink/[0.04] focus-visible:outline-none">
            {body}
            <ChevronRight size={14} className="mt-0.5 -mr-1 shrink-0 text-ink-quiet" aria-hidden="true" />
          </Link>
        ) : (
          <div className="flex items-start gap-3 py-2">{body}</div>
        )}
      </li>
    );
  };

  const group = (g: PreparedGroup) => {
    const folded = g.rows.length > FOLD_AT && !unfolded.has(g.key);
    const rows = folded ? g.rows.slice(0, FOLD_SHOW) : g.rows;
    return (
      <section key={g.key} aria-label={g.label} className="rounded-2xl bg-panel px-3 py-1">
        {g.label ? (
          <div className="flex items-baseline justify-between gap-3 border-b border-line-strong py-2">
            <h3 className="min-w-0 text-sm font-semibold break-words text-ink">
              {g.label}
              {g.apart ? <span className="ml-1.5 text-xs font-normal text-ink-mute">· toplama girmez</span> : null}
            </h3>
            <p className="shrink-0 text-right text-sm font-semibold text-ink tabular">
              <span className={cn(g.subtotal < 0 && "text-bad")}>{amount(g.subtotal)}</span>
              {shares && g.share !== null ? <span className="ml-1.5 text-xs font-normal text-ink-mute">{shareLabel(g.share)}</span> : null}
            </p>
          </div>
        ) : null}
        {g.note ? <p className="pt-2 text-xs text-pretty text-ink-mute">{g.note}</p> : null}
        <ul className="divide-y divide-line">{rows.map(row)}</ul>
        {g.rows.length > FOLD_AT ? (
          <button
            type="button"
            onClick={() =>
              setUnfolded((s) => {
                const next = new Set(s);
                if (next.has(g.key)) next.delete(g.key);
                else next.add(g.key);
                return next;
              })
            }
            aria-expanded={!folded}
            className="flex min-h-9 w-full cursor-pointer items-center border-t border-line text-xs font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11"
          >
            {folded ? `${num(g.rows.length - FOLD_SHOW)} kalem daha göster` : "Daha az göster"}
          </button>
        ) : null}
      </section>
    );
  };

  return (
    <div className={cn("relative grid [&_a]:relative", className)}>
      {/* Kartın tamamı düğme: içerikten önce gelir, karttaki bilgi ikonu ve bağlantılar (konumlu) üstünde kalır */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${title}: dökümü aç`}
        onClick={() => setOpen(true)}
        className="peer absolute inset-0 cursor-pointer rounded-2xl transition-[background-color,box-shadow] hover:bg-ink/[0.025] hover:ring-1 hover:ring-ink/10 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none active:bg-ink/[0.04]"
      />
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-5 right-3.5 flex items-center gap-0.5 text-xs leading-4 font-medium text-ink-mute transition-colors peer-hover:text-ink peer-focus-visible:text-ink"
      >
        Döküm
        <ChevronRight size={14} className="-mr-1" />
      </span>
      <Dialog
        open={open}
        onClose={close}
        title={title}
        description={description}
        footer={
          <Button variant="secondary" onClick={close}>
            Kapat
          </Button>
        }
      >
        {prepared && prepared.groups.length ? (
          <div className="space-y-3 pb-1">
            {prepared.groups.filter((g) => !g.apart).map(group)}
            <p className="flex items-baseline justify-between gap-3 rounded-2xl bg-ink/[0.05] px-3 py-2.5 text-sm font-semibold text-ink">
              <span className="min-w-0 break-words">{totalLabel}</span>
              <span className={cn("shrink-0 tabular", prepared.total < 0 && "text-bad")}>{amount(prepared.total)}</span>
            </p>
            {prepared.groups.filter((g) => g.apart).map(group)}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-ink-mute">{empty}</p>
        )}
      </Dialog>
    </div>
  );
}
