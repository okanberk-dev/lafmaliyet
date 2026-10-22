"use client";

import { Check, Copy, Mail, MessageCircle, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { SHEET_BTN } from "@/components/ui/mobile-filters";
import { dateTR, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useCopied } from "../kullanicilar/password-field";
import { amountForBank, dueOf, emailDraftHref, formatIban, paymentRequestText, transferNote, whatsappShareHref, type SupplierCard } from "./logic";

/** Talebe girebilecek (ödenmemiş) fatura */
export interface RequestInvoice {
  id: number;
  date: string;
  invoiceNo: string | null;
  /** Ödenecek (kalan) tutar */
  amount: number;
  dueDate: string | null;
  paymentRequestedAt: string | null;
  /** İade: ödenmedi duruyor (kalan borçtan düşülüyor), pencerede seçili gelir */
  open?: boolean;
}

/**
 * Ödeme talebi: faturalar seçilir, alıcı (unvan / hesap sahibi), IBAN, tutar ve havale açıklamasıyla hazır metin
 * kopyalanır, WhatsApp'ta ya da e-postayla gönderilir (ödemeyi yapacak kişiye ya da bankanın havale ekranına).
 * "Talep edildi işaretle" seçilen faturaları talep edildi yapar; ödenince Ödendi işaretlenir. Tedarikçinin son iade
 * faturaları (`credits`, eksi tutar) ayrıca listelenir: hangisinin daha önce düşüldüğü bilinmediğinden seçili gelmez;
 * seçilen iade tutardan ve metinden düşülür.
 */
export function RequestDialog({
  name,
  card,
  taxNumber = null,
  invoices,
  credits = [],
  selected,
  termDays,
  payer,
  onClose,
  onMark,
  onEditCard,
}: {
  name: string;
  card: SupplierCard | null;
  /** Kartta vergi no yoksa faturalardaki tek vergi no (metindeki "Vergi no:" satırı; kartsız tedarikçide de) */
  taxNumber?: string | null;
  /** Tedarikçinin ödenmemiş faturaları (eskiden yeniye) */
  invoices: RequestInvoice[];
  /** Ödemeden düşülebilecek son iade faturaları (tutar eksi) */
  credits?: RequestInvoice[];
  /** Açılışta seçili olanlar; boşsa hepsi */
  selected: number[];
  termDays: number;
  /** Ödeyen işletmenin adı (metnin başlığı) */
  payer: string;
  onClose: () => void;
  onMark: (ids: number[]) => void;
  onEditCard: () => void;
}) {
  const [ids, setIds] = useState<ReadonlySet<number>>(
    () => new Set([...(selected.length ? selected : invoices.map((i) => i.id)), ...credits.filter((c) => c.open).map((c) => c.id)]),
  );
  const [note, setNote] = useState("");
  const { copied, copy } = useCopied();
  const chosen = invoices.filter((i) => ids.has(i.id));
  const chosenCredits = credits.filter((i) => ids.has(i.id));
  const total = [...chosen, ...chosenCredits].reduce((a, i) => a + i.amount, 0);
  const toLine = (i: RequestInvoice) => ({ date: i.date, invoiceNo: i.invoiceNo, amount: i.amount, dueDate: i.dueDate });
  // İadeler faturaları karşılıyorsa ödenecek bir şey yok: tutar ve gönderme kapanır
  const payable = chosen.length > 0 && total > 0.005;
  const lines = chosen.map(toLine);
  const text = paymentRequestText({ payer, name, card, taxNumber, lines: [...lines, ...chosenCredits.map(toLine)], note });
  const subject = `Ödeme talebi: ${card?.legalName?.trim() || name} · ${money(total)}`;
  const toMark = chosen.filter((i) => !i.paymentRequestedAt).map((i) => i.id);
  const toggle = (id: number) =>
    setIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Ödeme talebi"
      description={`${name} · ${num(invoices.length)} ödenmemiş fatura. Seçin, metni kopyalayın ya da gönderin; ödeyince “Ödendi” işaretleyin.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Kapat
          </Button>
          <Button
            onClick={() => {
              onMark(toMark);
              onClose();
            }}
            disabled={!toMark.length}
            title={chosen.length && !toMark.length ? "Seçilenlerin hepsi zaten talep edildi" : undefined}
            className={SHEET_BTN}
          >
            <Send size={16} aria-hidden="true" /> {toMark.length ? `Talep edildi işaretle (${num(toMark.length)})` : "Talep edildi"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <fieldset>
          <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-[13px] font-medium text-ink-soft">
            <span>Faturalar</span>
            <button
              type="button"
              onClick={() => {
                // İade seçimi olduğu gibi kalır
                const kept = chosenCredits.map((i) => i.id);
                setIds(new Set(chosen.length === invoices.length ? kept : [...invoices.map((i) => i.id), ...kept]));
              }}
              className="cursor-pointer font-medium text-info underline-offset-2 hover:underline pointer-coarse:min-h-11"
            >
              {chosen.length === invoices.length ? "Hiçbirini seçme" : "Hepsini seç"}
            </button>
          </legend>
          <ul className="max-h-64 divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl bg-surface ring-1 ring-line-strong">
            {invoices.map((i) => {
              const due = dueOf(i, termDays);
              return (
                <li key={i.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2">
                    <input type="checkbox" checked={ids.has(i.id)} onChange={() => toggle(i.id)} className="size-4 shrink-0 cursor-pointer rounded accent-ink pointer-coarse:size-5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink tabular">
                        {dateTR(i.date)}
                        {i.invoiceNo ? <span className="text-ink-mute"> · {i.invoiceNo}</span> : null}
                      </span>
                      <span className="block text-xs text-ink-mute tabular">
                        {due.estimated ? "Tahmini vade" : "Vade"} {dateTR(due.date)}
                        {i.paymentRequestedAt ? ` · talep edildi ${dateTR(i.paymentRequestedAt)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-ink tabular">{money(i.amount)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 flex items-center justify-between gap-2 px-1 text-[13px] text-ink-mute tabular" aria-live="polite">
            <span>
              {chosen.length ? `${num(chosen.length)} fatura seçildi` : "Fatura seçilmedi"}
              {chosenCredits.length ? ` · ${num(chosenCredits.length)} iade düşüldü` : ""}
            </span>
            <span className="font-semibold text-ink">{money(total)}</span>
          </p>
        </fieldset>

        {credits.length ? (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">İade faturaları</legend>
            <p className="mb-2 flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Bu tedarikçinin iade faturası var. Ödenmedi duranlar seçili gelir; ötekiler daha önce düşülmediyse seçin: tutardan ve metinden düşülür.</span>
            </p>
            <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line-strong">
              {credits.map((i) => (
                <li key={i.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3.5 py-2">
                    <input type="checkbox" checked={ids.has(i.id)} onChange={() => toggle(i.id)} className="size-4 shrink-0 cursor-pointer rounded accent-ink pointer-coarse:size-5" />
                    <span className="min-w-0 flex-1 text-sm text-ink tabular">
                      {dateTR(i.date)}
                      {i.invoiceNo ? <span className="text-ink-mute"> · {i.invoiceNo}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-good tabular">−{money(-i.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {chosen.length && !payable ? (
          <p className="flex items-start gap-2 rounded-2xl bg-info-soft px-3.5 py-2.5 text-[13px] leading-5 text-info" role="status">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Seçilen iadeler faturaları karşılıyor; ödenecek tutar yok. İadeyi ya da faturaları değiştirin.</span>
          </p>
        ) : null}

        {!card?.iban ? (
          <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              IBAN girilmemiş; metinde “IBAN: (girilmemiş)” yazar.{" "}
              <button type="button" onClick={onEditCard} className="cursor-pointer font-semibold underline underline-offset-2">
                IBAN&apos;ı ekleyin
              </button>
            </span>
          </p>
        ) : null}

        {/* Bankanın havale ekranına tek tek yapıştırmak için */}
        <div className="grid gap-2 sm:grid-cols-2">
          <CopyField
            label={card?.bankName ? `IBAN · ${card.bankName}` : "IBAN"}
            value={card?.iban ? formatIban(card.iban) : null}
            copyValue={card?.iban ?? ""}
            copied={copied === "iban"}
            onCopy={() => copy("iban", card?.iban ?? "", "IBAN kopyalandı")}
            mono
            className="sm:col-span-2"
          />
          <CopyField label="Tutar" value={payable ? money(total) : null} copyValue={amountForBank(total)} copied={copied === "tutar"} onCopy={() => copy("tutar", amountForBank(total), "Tutar kopyalandı")} />
          <CopyField label="Açıklama" value={lines.length ? transferNote(lines) : null} copyValue={transferNote(lines)} copied={copied === "aciklama"} onCopy={() => copy("aciklama", transferNote(lines), "Açıklama kopyalandı")} />
        </div>

        <Field label="Not (isteğe bağlı)" htmlFor="r-note" hint="Metnin sonuna eklenir, ör. “Cuma gününe kadar”">
          <Textarea id="r-note" value={note} onChange={(e) => setNote(e.target.value)} rows={1} className="max-h-28 min-h-11 [field-sizing:content]" />
        </Field>

        <div>
          <p className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink-soft">
            Metin
            {chosen.some((i) => i.paymentRequestedAt) ? (
              <Badge tone="blue" title="Seçilenlerden bazılarının ödemesi daha önce talep edildi">
                daha önce talep edilen var
              </Badge>
            ) : null}
          </p>
          <pre className="max-h-56 overflow-y-auto overscroll-contain rounded-2xl bg-panel p-3.5 font-sans text-[13px] leading-5 whitespace-pre-wrap text-ink">{text}</pre>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => copy("metin", text, "Ödeme talebi kopyalandı")} disabled={!payable} className="text-ink max-sm:min-h-11 max-sm:flex-1">
              {copied === "metin" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} Metni kopyala
            </Button>
            <a
              href={whatsappShareHref(text)}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!payable || undefined}
              className={cn(buttonClass("secondary", "md", "text-ink max-sm:min-h-11 max-sm:flex-1"), !payable && "pointer-events-none opacity-45")}
            >
              <MessageCircle size={16} aria-hidden="true" /> WhatsApp
            </a>
            <a
              href={emailDraftHref(subject, text)}
              aria-disabled={!payable || undefined}
              className={cn(buttonClass("secondary", "md", "text-ink max-sm:min-h-11 max-sm:flex-1"), !payable && "pointer-events-none opacity-45")}
            >
              <Mail size={16} aria-hidden="true" /> E-posta
            </a>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Tek değerlik kopyalama kutusu (IBAN, tutar, açıklama) */
function CopyField({
  label,
  value,
  copyValue,
  copied,
  onCopy,
  mono,
  className,
}: {
  label: string;
  value: string | null;
  copyValue: string;
  copied: boolean;
  onCopy: () => void;
  mono?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={!value || !copyValue}
      className={cn(
        "group flex min-h-14 min-w-0 cursor-pointer items-center gap-2 rounded-2xl bg-surface px-3.5 py-2 text-left ring-1 ring-line-strong transition-shadow ring-inset hover:ring-ink/30 disabled:cursor-default disabled:opacity-60",
        className,
      )}
      title={value ? `${label}: kopyala` : undefined}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-ink-mute">{label}</span>
        <span className={cn("block truncate text-sm font-medium text-ink tabular", mono && "font-mono text-[13px]")}>{value ?? "–"}</span>
      </span>
      {value ? (
        copied ? (
          <Check size={16} className="shrink-0 text-good" aria-hidden="true" />
        ) : (
          <Copy size={16} className="shrink-0 text-ink-mute group-hover:text-ink" aria-hidden="true" />
        )
      ) : null}
      <span className="sr-only">{copied ? "kopyalandı" : "kopyala"}</span>
    </button>
  );
}
