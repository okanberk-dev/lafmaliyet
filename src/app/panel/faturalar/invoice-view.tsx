"use client";

import { FileText, Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SHEET_BTN } from "@/components/ui/mobile-filters";
import type { InvoiceCariLinks } from "@/lib/cari/account";
import { isPartiallyPaid, openBalance } from "@/lib/cari/balance";
import type { Role } from "@/lib/constants";
import { dateTR, tl } from "@/lib/format";
import type { DocumentMeta } from "@/server/documents";

import { documentSummary, isParasutDocument } from "./document-rules";
import { InvoiceCari } from "./invoice-dialog";
import { InvoiceLines } from "./invoice-lines";
import { parasutBillUrl, splitSupplier, visibleNote, type InvoiceRow } from "./rules";

/**
 * Faturanın salt okunur penceresi (muhasebeci; docs/ROLLER.md): tedarikçi, tarih, kategori, tutarlar, ödeme durumu,
 * belge, kalemler ve cari bağları. Alan, Kaydet ve Sil yok; belge açılır ve indirilir. Yöneticinin düzenleme penceresi
 * InvoiceDialog'dur: bu pencere onun formunu çizmez, bu yüzden ekranda basılacak yazma düğmesi kalmaz.
 */
export function InvoiceView({
  invoice,
  role,
  onClose,
  parasutCompanyId,
  hasDocument,
  documents,
  onOpenDocuments,
  cari,
}: {
  invoice: InvoiceRow;
  /** Bakanın rolü: kalemlerdeki bağlantılar rolün açabildiği ekranlara (openableHref) */
  role: Role;
  onClose: () => void;
  parasutCompanyId: string | null;
  /** Açılacak belge var mı (Paraşüt PDF'i ya da yüklenmiş dosya; canHaveDocument) */
  hasDocument: boolean;
  documents: DocumentMeta[];
  onOpenDocuments: () => void;
  cari?: InvoiceCariLinks;
}) {
  const { base } = splitSupplier(invoice.supplier);
  const net = invoice.amount - invoice.discount;
  const parasutHref = invoice.externalId && parasutCompanyId ? parasutBillUrl(parasutCompanyId, invoice.externalId) : null;
  const note = visibleNote(invoice.note);
  const summary = documentSummary(invoice, documents);
  const facts: [string, string][] = [
    ["Tedarikçi", invoice.supplier],
    ...(invoice.supplierTaxNumber ? ([["Vergi no", invoice.supplierTaxNumber]] as [string, string][]) : []),
    ["Tarih", dateTR(invoice.date)],
    ...(invoice.invoiceNo ? ([["Fatura no", invoice.invoiceNo]] as [string, string][]) : []),
    ...(invoice.description ? ([["Açıklama", invoice.description]] as [string, string][]) : []),
    ["Kategori", invoice.category],
    ...(invoice.branchName ? ([["Şube", invoice.branchName]] as [string, string][]) : []),
    ...(invoice.dueDate ? ([["Vade", dateTR(invoice.dueDate)]] as [string, string][]) : []),
    ...(!invoice.unpaid && invoice.paidAt ? ([["Ödeme günü", dateTR(invoice.paidAt)]] as [string, string][]) : []),
  ];
  const amounts: [string, string][] = [
    ["Mal / hizmet tutarı", tl(invoice.amount, 2)],
    ["İskonto", tl(invoice.discount, 2)],
    ["Net (KDV hariç)", tl(net, 2)],
    ["KDV", tl(invoice.payable - net, 2)],
    ["Ödenecek, KDV dahil", tl(invoice.payable, 2)],
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Fatura"
      description={`${base} · ${dateTR(invoice.date)} · salt okunur`}
      footerStart={
        parasutHref ? (
          <a
            href={parasutHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-sm font-medium text-ink-mute hover:text-ink hover:underline max-sm:min-h-12 max-sm:px-1"
          >
            Paraşüt&apos;te aç ↗
          </a>
        ) : null
      }
      footer={
        <Button onClick={onClose} className={SHEET_BTN}>
          Kapat
        </Button>
      }
    >
      <div className="grid gap-x-3 gap-y-4 pb-2 sm:grid-cols-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:col-span-2 sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-ink-mute">{k}</dt>
              <dd className="break-words text-ink">{v}</dd>
            </div>
          ))}
          <div className="min-w-0">
            <dt className="text-xs text-ink-mute">Ödeme durumu</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {invoice.unpaid ? (
                <Badge tone={invoice.paymentRequestedAt ? "blue" : "red"} dot>
                  {invoice.paymentRequestedAt ? "Talep edildi" : "Ödenmedi"}
                </Badge>
              ) : (
                <Badge tone="green" dot>
                  Ödendi
                </Badge>
              )}
              {invoice.needsReview ? (
                <Badge tone="amber" dot>
                  Kontrol
                </Badge>
              ) : null}
            </dd>
          </div>
        </dl>

        <div className="rounded-2xl bg-panel p-4 sm:col-span-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {amounts.map(([k, v], idx) => (
              <div key={k} className={idx === amounts.length - 1 ? "min-w-0 font-semibold" : "min-w-0"}>
                <dt className="text-xs text-ink-mute">{k}</dt>
                <dd className="tabular text-ink">{v}</dd>
              </div>
            ))}
            {invoice.unpaid && isPartiallyPaid(invoice) ? (
              <div className="min-w-0">
                <dt className="text-xs text-ink-mute">Kalan borç</dt>
                <dd className="tabular text-warn">{tl(openBalance(invoice), 2)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex items-center gap-3 rounded-2xl bg-panel p-3 sm:col-span-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink" aria-hidden="true">
            {isParasutDocument(invoice) ? <FileText size={16} /> : <Paperclip size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{hasDocument ? summary.title : "Belge yok"}</p>
            {hasDocument ? <p className="text-xs text-pretty text-ink-mute">{summary.hint}</p> : null}
          </div>
          {hasDocument ? (
            <Button variant="secondary" onClick={onOpenDocuments} aria-haspopup="dialog" className="text-ink max-sm:min-h-11">
              Belgeyi aç
            </Button>
          ) : null}
        </div>

        {invoice.eInvoiceId || invoice.externalId ? <InvoiceLines invoiceId={invoice.id} invoiceNet={net} category={invoice.category} role={role} /> : null}

        {cari && (cari.payments.length || cari.debts.length) ? <InvoiceCari cari={cari} href={null} readOnly /> : null}

        {note ? (
          <div className="min-w-0 text-sm sm:col-span-2">
            <p className="text-xs text-ink-mute">Not</p>
            <p className="break-words whitespace-pre-line text-ink">{note}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
