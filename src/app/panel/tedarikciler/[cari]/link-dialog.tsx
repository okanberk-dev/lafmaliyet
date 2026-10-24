"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { toastUnreachable, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SHEET_BTN } from "@/components/ui/mobile-filters";
import { debtLabel, invoiceLabel, type CostMode } from "@/lib/cari/account";
import { round2 } from "@/lib/cari/balance";
import { LINK_WINDOW } from "@/lib/cari/match";
import { linkPreview, type MonthEffect } from "@/lib/cari/months";
import { GOODS_CATEGORIES } from "@/lib/constants";
import { dateTR, tl } from "@/lib/format";
import { addDays } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { linkDebtsToInvoice, unlinkDebts } from "@/server/actions/cari";

import { CARI_UNDO_MS, PastConfirm } from "../cari-ui";

export interface LinkDebt {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  costMode: CostMode;
}

export interface LinkInvoice {
  id: number;
  date: string;
  invoiceNo: string | null;
  payable: number;
  amount: number;
  discount: number;
  category: string;
}

/**
 * Faturası geldi / Faturaya bağla (§5.2): bir ya da birkaç faturasız alım tek faturaya bağlanır. Önerilen faturalar
 * en eski alımdan 7 gün önce ile en yeni alımdan 45 gün sonra arasındakiler. Önizleme giderin ve KDV tahmininin ay ay
 * nasıl değişeceğini söyler; eski borç seçildiyse çift sayım uyarısı çıkar. Geçmiş ayın gideri değişecekse onay ister.
 */
export function LinkDialog({
  cardId,
  supplierName,
  today,
  debts,
  invoices,
  expenses,
  preselect,
  onClose,
}: {
  cardId: number;
  supplierName: string;
  today: string;
  /** Bağsız alımlar (kalanı olsun olmasın) */
  debts: LinkDebt[];
  /** Grubun bağlanabilecek faturaları (Ödenecek > 0, henüz bağ yok) */
  invoices: LinkInvoice[];
  /** Borçların gider kayıtları (bağlayınca silinir) */
  expenses: Record<number, { date: string; amount: number; categoryName: string }>;
  preselect: { debtIds: number[]; invoiceId: number | null };
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => new Set(preselect.debtIds));
  const [invoiceId, setInvoiceId] = useState<number | null>(preselect.invoiceId);
  const [showOther, setShowOther] = useState(() => preselect.debtIds.some((id) => debts.find((d) => d.id === id)?.costMode === "devir"));
  const [past, setPast] = useState<MonthEffect[]>([]);
  const [pastOk, setPastOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useActionTransition();

  const main = debts.filter((d) => d.costMode !== "devir");
  const other = debts.filter((d) => d.costMode === "devir");
  const selected = debts.filter((d) => chosen.has(d.id));
  const dates = selected.map((d) => d.date).sort();
  const from = dates.length ? addDays(dates[0], -LINK_WINDOW.before) : null;
  const to = dates.length ? addDays(dates[dates.length - 1], LINK_WINDOW.after) : null;
  const suggested = invoices.filter((i) => from && to && i.date >= from && i.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const rest = invoices.filter((i) => !suggested.includes(i)).sort((a, b) => b.date.localeCompare(a.date));
  const invoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const debtTotal = round2(selected.reduce((a, d) => a + d.amount, 0));
  const net = invoice ? round2(invoice.amount - invoice.discount) : 0;
  const preview =
    invoice && selected.length
      ? linkPreview({
          removed: selected.flatMap((d) => {
            const e = (d.costMode === "gider" || d.costMode === "mevcut") && expenses[d.id];
            return e ? [{ date: e.date, amount: e.amount, categoryName: e.categoryName }] : [];
          }),
          invoice: { date: invoice.date, net, vat: round2(invoice.payable - net), payable: invoice.payable, goods: GOODS_CATEGORIES.includes(invoice.category) },
          debtTotal,
          today,
        })
      : null;

  const toggle = (id: number) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function save() {
    setError(null);
    if (!selected.length) return void setError("Alım seçin");
    if (!invoice) return void setError("Fatura seçin");
    if (past.length && !pastOk) return void setError("Geçmiş ayın değişeceğini onaylayın");
    const debtIds = selected.map((d) => d.id);
    run(async () => {
      const r = await linkDebtsToInvoice({ cardId, debtIds, invoiceId: invoice.id, confirmPast: pastOk ? past.map((e) => e.month) : [] });
      if (!r.ok) return void setError(r.error);
      if (r.data.needs === "past") {
        setPast(r.data.effects);
        setPastOk(false);
        return;
      }
      const months = r.data.effects.map((e) => e.month);
      toast.success("Faturaya bağlandı", {
        description: `${supplierName} · ${selected.length} alım (${tl(debtTotal, 2)}) → ${invoiceLabel(invoice)} (${tl(invoice.payable, 2)})`,
        duration: CARI_UNDO_MS,
        action: {
          label: "Geri al",
          onClick: async () => {
            try {
              const u = await unlinkDebts({ debtIds, confirmPast: months });
              if (!u.ok) return void toast.error(u.error);
              if (u.data.needs === "past") return void toast.error("Bağı kaldırmak geçmiş ayı değiştiriyor; Hesap hareketleri'nden kaldırın.");
              toast.success("Bağ kaldırıldı");
            } catch (e) {
              toastUnreachable(e);
            }
          },
        },
      });
      onClose();
    });
  }

  const debtRow = (d: LinkDebt) => (
    <li key={d.id}>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2">
        <input type="checkbox" checked={chosen.has(d.id)} onChange={() => toggle(d.id)} className="size-4 shrink-0 cursor-pointer rounded accent-ink pointer-coarse:size-5" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block break-words text-ink">{debtLabel(d)}</span>
          <span className="block text-xs text-ink-mute tabular">{dateTR(d.date)}</span>
        </span>
        <span className="shrink-0 text-sm font-medium text-ink tabular">{tl(d.amount, 2)}</span>
      </label>
    </li>
  );
  const invoiceRow = (i: LinkInvoice) => {
    const on = invoiceId === i.id;
    return (
      <button
        key={i.id}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setInvoiceId(i.id)}
        className={cn("flex min-h-12 w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left text-sm", on ? "bg-panel font-medium text-ink" : "text-ink-soft hover:bg-panel/60")}
      >
        <span className="min-w-0 flex-1 break-words">
          {invoiceLabel(i)}
          <span className="block text-xs font-normal text-ink-mute tabular">{dateTR(i.date)}</span>
        </span>
        <span className="shrink-0 tabular">{tl(i.payable, 2)}</span>
        <span className={cn("size-5 shrink-0 rounded-full", on ? "border-[6px] border-ink bg-surface" : "ring-1 ring-line-strong ring-inset")} aria-hidden="true" />
      </button>
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Faturası geldi"
      description={`${supplierName} · faturasız alımları geldiği faturaya bağlayın; gider faturadan sayılır`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending || !selected.length || !invoice || (past.length > 0 && !pastOk)} className={SHEET_BTN}>
            {pending ? "Bağlanıyor…" : "Bağla"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Faturasız alımlar</legend>
          {main.length ? <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">{main.map(debtRow)}</ul> : <p className="text-[13px] text-ink-mute">Bağsız alım yok.</p>}
          {other.length ? (
            showOther ? (
              <>
                <p className="mt-3 mb-1.5 text-[13px] font-medium text-ink-soft">Diğer: eski borç (devir)</p>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">{other.map(debtRow)}</ul>
              </>
            ) : (
              <button type="button" onClick={() => setShowOther(true)} className="mt-2 min-h-9 cursor-pointer text-[13px] font-medium text-info underline-offset-2 hover:underline pointer-coarse:min-h-11">
                Diğer: eski borçlar ({other.length})
              </button>
            )
          ) : null}
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Fatura</legend>
          <div role="radiogroup" aria-label="Fatura" className="max-h-72 divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl bg-surface ring-1 ring-line-strong">
            {suggested.length ? <p className="bg-panel/60 px-3.5 py-1.5 text-xs font-medium text-ink-mute">Önerilenler</p> : null}
            {suggested.map(invoiceRow)}
            {rest.length ? <p className="bg-panel/60 px-3.5 py-1.5 text-xs font-medium text-ink-mute">Bu tedarikçinin diğer faturaları</p> : null}
            {rest.map(invoiceRow)}
            {!invoices.length ? <p className="px-3.5 py-3 text-[13px] text-ink-mute">Bağlanabilecek fatura yok.</p> : null}
          </div>
        </fieldset>
        {preview ? <p className="rounded-2xl bg-panel px-3.5 py-2.5 text-[13px] leading-5 text-ink-soft tabular">{preview}</p> : null}
        {selected.some((d) => d.costMode === "devir") ? (
          <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Eski borç gider sayılmıyordu; fatura gider sayılır. Bu alımın gideri önceki aylarda başka yerde girildiyse (ör. Gelir-gider › DİĞER) orayı düzeltin, yoksa çift sayılır.
            </span>
          </p>
        ) : null}
        <PastConfirm effects={past} checked={pastOk} onChange={setPastOk} />
        {error ? (
          <p className="rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] leading-5 text-bad" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
