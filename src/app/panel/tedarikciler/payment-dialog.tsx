"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { BIG_FIELDS, ChoiceList, SHEET_BTN } from "@/components/ui/mobile-filters";
import { dateTR, money, num } from "@/lib/format";
import { addDays } from "@/lib/reminders";
import { cn } from "@/lib/utils";

import { PAYMENT_METHODS, payState, type PaymentMethod, type PayState } from "./logic";

/** Pencerenin yazacağı değişiklik (setInvoicePayment); ödeme günü null: bilinmiyor */
export type PaymentChoice = { status: "paid"; date: string | null; via: PaymentMethod | null } | { status: "requested"; date: string } | { status: "unpaid" };

/** Penceredeki faturanın bilgileri */
export interface PaymentTarget {
  id: number;
  unpaid: boolean;
  paidAt: string | null;
  paidVia: PaymentMethod | null;
  paymentRequestedAt: string | null;
  /** Ödenecek (kalan) tutar */
  amount: number;
}

/**
 * Ödeme durumu penceresi (bir ya da seçilen faturalar): ödendi (ödeme günü ve şekli), ödemesi talep edildi (talep
 * günü) ya da ödenmedi. Tek faturada kayıtlı gün ve şekil gelir; ödenmemiş faturada ödeme günü bugün, şekil
 * tedarikçinin kartındaki. Ödeme günü boş bırakılabilir (bilinmiyor). Birden çok faturada ödendi / talep edildi
 * yalnız ödenmemişlere yazılır.
 */
export function PaymentDialog({
  targets,
  title,
  today,
  defaultMethod,
  initial,
  onClose,
  onSave,
}: {
  targets: PaymentTarget[];
  /** "Sütaş · 14.10.2026 faturası" gibi */
  title: string;
  today: string;
  /** Kartın "genelde nasıl ödenir" seçimi */
  defaultMethod: PaymentMethod | null;
  /** Açılışta seçili durum (ör. "Ödendi" düğmesinden) */
  initial?: PayState;
  onClose: () => void;
  onSave: (choice: PaymentChoice) => void;
}) {
  const one = targets.length === 1 ? targets[0] : null;
  const current: PayState | null = targets.every((t) => payState(t) === payState(targets[0])) && targets.length ? payState(targets[0]) : null;
  // Varsayılan "Ödendi" (pencere çoğunlukla ödemeyi işaretlemek için açılır); ödenmiş faturada gün ve şekil düzelir
  const [status, setStatus] = useState<PayState>(initial ?? "paid");
  // Ödenmiş faturada kayıtlı gün (yoksa boş: bilinmiyor); ödenmemişte bugün
  const [paidAt, setPaidAt] = useState(one && !one.unpaid ? (one.paidAt ?? "") : today);
  const [via, setVia] = useState<PaymentMethod | "">(one?.paidVia ?? defaultMethod ?? "");
  const [requestedAt, setRequestedAt] = useState(one?.paymentRequestedAt ?? today);
  const total = targets.reduce((a, t) => a + t.amount, 0);
  // Ödeme günü ileri bir tarih olamaz (bugün Türkiye saatine göre; saat farkı için bir gün pay)
  const maxDate = addDays(today, 1);
  const dateError = status === "paid" ? (paidAt && paidAt > maxDate ? "İleri bir tarih olamaz" : null) : status === "requested" && !requestedAt ? "Talep gününü seçin" : null;
  // Toplu işlemde zaten ödenmiş olanlar ödendi / talep edildi seçilince değişmez
  const settled = targets.length > 1 ? targets.filter((t) => !t.unpaid).length : 0;

  function save() {
    if (dateError) return;
    if (status === "paid") onSave({ status, date: paidAt || null, via: via || null });
    else if (status === "requested") onSave({ status, date: requestedAt });
    else onSave({ status: "unpaid" });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Ödeme durumu"
      description={`${title} · ${targets.length > 1 ? `${num(targets.length)} fatura · ` : ""}${money(total)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={Boolean(dateError)} className={SHEET_BTN}>
            Kaydet
          </Button>
        </>
      }
    >
      <div className={cn("space-y-4 pb-2", BIG_FIELDS)}>
        <ChoiceList<PayState>
          label="Durum"
          value={status}
          onChange={setStatus}
          options={[
            { value: "paid", label: <StateLabel dot="bg-good" text="Ödendi" note={current === "paid" && one?.paidAt ? `şu an ${dateTR(one.paidAt)}` : null} /> },
            {
              value: "requested",
              label: <StateLabel dot="bg-info" text="Ödemesi talep edildi" note={current === "requested" && one?.paymentRequestedAt ? `şu an ${dateTR(one.paymentRequestedAt)}` : "henüz ödenmedi"} />,
            },
            { value: "unpaid", label: <StateLabel dot="bg-bad" text="Ödenmedi" note={null} /> },
          ]}
        />
        {status === "paid" ? (
          <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
            <Field label="Ödeme günü" htmlFor="p-date" error={dateError ?? undefined} hint={paidAt ? undefined : "Bilinmiyorsa boş bırakın"}>
              <Input id="p-date" type="date" value={paidAt} max={maxDate} onChange={(e) => setPaidAt(e.target.value)} aria-invalid={Boolean(dateError) || undefined} />
            </Field>
            <Field label="Ödeme şekli" htmlFor="p-via">
              <Select id="p-via" value={via} onChange={(e) => setVia(e.target.value as PaymentMethod | "")}>
                <option value="">Belirtilmedi</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : status === "requested" ? (
          <Field label="Talep günü" htmlFor="p-req" error={dateError ?? undefined} hint="Ödeme istendiği ya da ödeme talebinin verildiği gün. Ödenince “Ödendi” yapın.">
            <Input id="p-req" type="date" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} aria-invalid={Boolean(dateError) || undefined} />
          </Field>
        ) : (
          <p className="text-[13px] leading-5 text-ink-mute">Ödeme günü ve talep bilgisi silinir; fatura vadesiyle Ödemeler&apos;e ve sabah e-postasına düşer.</p>
        )}
        {settled && status !== "unpaid" ? (
          <p className="text-[13px] leading-5 text-ink-mute" role="status">
            Seçilenlerden {num(settled)} fatura zaten ödenmiş; onlar olduğu gibi kalır.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function StateLabel({ dot, text, note }: { dot: string; text: string; note: string | null }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden="true" />
      <span>
        {text}
        {note ? <span className="ml-1.5 text-[13px] font-normal text-ink-mute">· {note}</span> : null}
      </span>
    </span>
  );
}
