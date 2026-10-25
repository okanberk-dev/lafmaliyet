"use client";

import { Check, Copy, Link2, ListTree, Pencil, Trash2, Unlink } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { AccountInvoice, CariAllocation, CariDebt, CariPayment } from "@/lib/cari/account";
import { statementFooter, statementRows, statementText, type ForeignCredit, type StatementRow } from "@/lib/cari/statement";
import { dateTR, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useCopied } from "../../kullanicilar/password-field";

type Range = "uc-ay" | "yil" | "tumu";

/** Süzgecin başlangıcı: son 3 ay (iki ay önceki ayın ilk günü), bu yıl, tümü */
function rangeFrom(range: Range, today: string): string | null {
  if (range === "tumu") return null;
  if (range === "yil") return `${today.slice(0, 4)}-01-01`;
  const [y, m] = today.split("-").map(Number);
  const total = y * 12 + (m - 1) - 2;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** Bakiyeyi etkilemeyen ya da elle girilmemiş (faturadan çıkan) satırlar gri */
const IMPLICIT = new Set<StatementRow["kind"]>(["isaretli", "parasut-kismi", "iade-dusuldu", "baska-odeme"]);

export type StatementAction = { type: "debt"; action: "edit" | "delete" | "link" | "unlink"; id: number } | { type: "payment"; action: "edit" | "delete" | "allocate"; id: number };

/**
 * Hesap hareketleri (ekstre, §4.8): faturalar, faturalardaki ödendi işaretleri, Paraşüt'te ödenen kısımlar, faturasız
 * alımlar, eski borçlar ve ödemeler gün sırasıyla; bakiye satır satır yürür. Süzgeçte ilk satır devreden bakiye.
 * Masaüstünde tablo, telefonda liste. "Ekstreyi kopyala" tedarikçiye gönderilecek mutabakat metnini panoya alır.
 */
export function StatementPanel({
  name,
  today,
  invoices,
  debts,
  payments,
  allocations,
  foreign,
  onAction,
}: {
  name: string;
  today: string;
  invoices: readonly AccountInvoice[];
  debts: readonly CariDebt[];
  payments: readonly CariPayment[];
  allocations: readonly CariAllocation[];
  /** Başka kartların ödemelerinden bu tedarikçinin faturalarına sayılanlar */
  foreign: readonly ForeignCredit[];
  onAction: (a: StatementAction) => void;
}) {
  const [range, setRange] = useState<Range>("uc-ay");
  const from = rangeFrom(range, today);
  const st = useMemo(() => statementRows({ invoices, debts, payments, allocations, foreign }, { from }), [invoices, debts, payments, allocations, foreign, from]);
  const { copied, copy } = useCopied();
  const rows = st.rows;
  const closing = st.closing;
  const text = () => statementText(name, st, { from: from ?? st.rows[0]?.date ?? today, to: today });

  const actions = (r: StatementRow, size?: string) => {
    if (r.ref.type === "debt") {
      const id = r.ref.id;
      if (r.kind === "bagli")
        return (
          <IconButton label="Bağı kaldır" onClick={() => onAction({ type: "debt", action: "unlink", id })} className={size}>
            <Unlink size={15} />
          </IconButton>
        );
      return (
        <>
          <IconButton label="Faturası geldi" onClick={() => onAction({ type: "debt", action: "link", id })} className={size}>
            <Link2 size={15} />
          </IconButton>
          <IconButton label="Düzenle" onClick={() => onAction({ type: "debt", action: "edit", id })} className={size}>
            <Pencil size={15} />
          </IconButton>
          <IconButton label="Sil" onClick={() => onAction({ type: "debt", action: "delete", id })} className={cn("text-bad", size)}>
            <Trash2 size={15} />
          </IconButton>
        </>
      );
    }
    if (r.ref.type === "payment" && r.kind === "odeme") {
      const id = r.ref.id;
      return (
        <>
          <IconButton label="Neye sayıldı" onClick={() => onAction({ type: "payment", action: "allocate", id })} className={size}>
            <ListTree size={15} />
          </IconButton>
          <IconButton label="Düzenle" onClick={() => onAction({ type: "payment", action: "edit", id })} className={size}>
            <Pencil size={15} />
          </IconButton>
          <IconButton label="Sil" onClick={() => onAction({ type: "payment", action: "delete", id })} className={cn("text-bad", size)}>
            <Trash2 size={15} />
          </IconButton>
        </>
      );
    }
    return null;
  };

  const allocationLine = (r: StatementRow) =>
    r.kind === "odeme" && (r.allocations?.length || (r.left ?? 0) > 0.005) ? (
      <span className="mt-0.5 block pl-3 text-xs leading-5 text-ink-mute tabular">
        {[...(r.allocations ?? []).map((a) => `${a.label} ${tl(a.amount, 2).replace(/\s*₺$/u, "")}`), `hesapta ${tl(r.left ?? 0, 2).replace(/\s*₺$/u, "")}`].join(" · ")}
      </span>
    ) : null;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 max-sm:px-4">
        <Segmented<Range>
          label="Dönem"
          value={range}
          onChange={setRange}
          options={[
            { value: "uc-ay", label: "Son 3 ay" },
            { value: "yil", label: "Bu yıl" },
            { value: "tumu", label: "Tümü" },
          ]}
        />
        <Button variant="secondary" size="sm" onClick={() => void copy("ekstre", text(), "Ekstre kopyalandı")} className="text-ink">
          {copied === "ekstre" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} Ekstreyi kopyala
        </Button>
      </div>

      {/* Telefon: liste */}
      <ul className="divide-y divide-line-strong/70 border-t border-line lg:hidden">
        {st.opening !== null ? (
          <li className="flex items-baseline justify-between gap-3 bg-panel/50 px-4 py-2.5 text-[13px] text-ink-mute tabular">
            <span>Devreden bakiye</span>
            <span>{tl(st.opening, 2)}</span>
          </li>
        ) : null}
        {rows.map((r) => (
          <li key={r.key} className={cn("px-4 py-3", (r.muted || IMPLICIT.has(r.kind)) && "text-ink-mute")}>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[14px] leading-5 break-words">
                <span className="text-ink-mute tabular">{dateTR(r.date)}</span> · <span className={cn(!r.muted && !IMPLICIT.has(r.kind) && "text-ink")}>{r.label}</span>
                {allocationLine(r)}
              </p>
              <span className="-my-1 flex shrink-0 gap-1">{actions(r, "size-11")}</span>
            </div>
            <p className="mt-1 flex items-baseline justify-end gap-3 text-[14px] tabular">
              {r.debit ? <span className={cn("font-semibold", r.muted ? "text-ink-quiet line-through" : "text-ink")}>{tl(r.debit, 2)}</span> : null}
              {r.credit ? <span className="font-semibold text-good">−{tl(r.credit, 2)}</span> : null}
              <span className="text-xs text-ink-mute">Bakiye {tl(r.balance, 2)}</span>
            </p>
          </li>
        ))}
      </ul>

      <TableWrap className="max-lg:hidden">
        <Table>
          <THead>
            <tr>
              <TH>Tarih</TH>
              <TH>Hareket</TH>
              <TH numeric>Borç</TH>
              <TH numeric>Ödeme</TH>
              <TH numeric>Bakiye</TH>
              <TH className="w-px px-2">
                <span className="sr-only">Eylemler</span>
              </TH>
            </tr>
          </THead>
          <tbody>
            {st.opening !== null ? (
              <TR className="text-ink-mute">
                <TD />
                <TD>Devreden bakiye</TD>
                <TD />
                <TD />
                <TD numeric>{tl(st.opening, 2)}</TD>
                <TD />
              </TR>
            ) : null}
            {rows.map((r) => (
              <TR key={r.key} className={cn((r.muted || IMPLICIT.has(r.kind)) && "text-ink-mute")}>
                <TD className="whitespace-nowrap tabular">{dateTR(r.date)}</TD>
                <TD className="min-w-64">
                  <span className={cn(!r.muted && !IMPLICIT.has(r.kind) && "text-ink")}>{r.label}</span>
                  {allocationLine(r)}
                </TD>
                <TD numeric className={cn(r.muted && "text-ink-quiet line-through")}>
                  {r.debit ? tl(r.debit, 2) : ""}
                </TD>
                <TD numeric className="text-good">
                  {r.credit ? tl(r.credit, 2) : ""}
                </TD>
                <TD numeric className="font-medium">
                  {tl(r.balance, 2)}
                </TD>
                <TD className="px-2">
                  <div className="flex justify-end gap-1">{actions(r)}</div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {!st.rows.length ? <p className="border-t border-line px-5 py-6 text-center text-sm text-ink-mute">Bu dönemde hareket yok.</p> : null}
      <p className={cn("border-t border-line px-5 py-3 text-right text-sm font-semibold tabular max-sm:px-4", closing < -0.005 ? "text-good" : "text-ink")}>
        {statementFooter(closing)}
      </p>
    </div>
  );
}
