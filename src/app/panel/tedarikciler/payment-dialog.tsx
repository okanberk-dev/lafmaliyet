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

/**
 * Tek faturanın cari bilgisi (docs/TEDARIKCILER.md "Hesap hareketleri"): bu faturaya sayılan ödemeler (her birinde
 * "Ödemeden çıkar"), panelde ödenen ve kalan, kartın hesabındaki sayılmamış para ("Hesaptaki ödemeden say" ya da
 * "Ayrıca ödendi") ve dağıtımla tamamen kapanmışsa "Ödenmedi" / "Talep edildi" kapalı.
 */
export interface PaymentLedger {
  counted: { allocationId: number; date: string; method: string; amount: number }[];
  /** Panelde sayılan ve kalan (takipli fatura) */
  panelPaid: number;
  remaining: number;
  /** Dağıtımla tamamen karşılanmış: ödenmedi yapılamaz (önce ödemeden çıkarılır) */
  covered: boolean;
  /** Kartın hesabındaki sayılmamış ödeme */
  credit: number;
  onRemove: (allocationId: number) => void;
  /** "Kısmi ödeme gir": Ödeme ekle penceresi bu fatura seçili açılır */
  onPartial?: () => void;
}

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
  ledger,
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
  /** Tek fatura ve cari takipte: sayılan ödemeler, hesaptaki para */
  ledger?: PaymentLedger | null;
  onClose: () => void;
  /** `separately`: "Ayrıca ödendi" (hesaptaki para kullanılmaz) */
  onSave: (choice: PaymentChoice, opts: { separately: boolean }) => void;
}) {
  const one = targets.length === 1 ? targets[0] : null;
  const current: PayState | null = targets.every((t) => payState(t) === payState(targets[0])) && targets.length ? payState(targets[0]) : null;
  // Varsayılan "Ödendi" (pencere çoğunlukla ödemeyi işaretlemek için açılır); ödenmiş faturada gün ve şekil düzelir
  const [status, setStatus] = useState<PayState>(ledger?.covered ? "paid" : (initial ?? "paid"));
  // Ödenmiş faturada kayıtlı gün (yoksa boş: bilinmiyor); ödenmemişte bugün
  const [paidAt, setPaidAt] = useState(one && !one.unpaid ? (one.paidAt ?? "") : today);
  // Ödenmiş faturada yalnız kayıtlı şekli (bilinmiyorsa boş): kartın varsayılanı kaydedilmiş gibi görünmesin
  const [via, setVia] = useState<PaymentMethod | "">(one && !one.unpaid ? (one.paidVia ?? "") : (one?.paidVia ?? defaultMethod ?? ""));
  const [requestedAt, setRequestedAt] = useState(one?.paymentRequestedAt ?? today);
  // Hesaptaki para önce (K6); "Ayrıca ödendi" seçilirse kullanılmaz
  const [separately, setSeparately] = useState(false);
  const covered = Boolean(ledger?.covered);
  const askCredit = Boolean(ledger && ledger.credit > 0.005 && one?.unpaid && status === "paid");
  const total = targets.reduce((a, t) => a + t.amount, 0);
  // Ödeme günü ileri bir tarih olamaz (bugün Türkiye saatine göre; saat farkı için bir gün pay)
  const maxDate = addDays(today, 1);
  const dateError = status === "paid" ? (paidAt && paidAt > maxDate ? "İleri bir tarih olamaz" : null) : status === "requested" && !requestedAt ? "Talep gününü seçin" : null;
  // Toplu işlemde zaten ödenmiş olanlar ödendi / talep edildi seçilince değişmez
  const settled = targets.length > 1 ? targets.filter((t) => !t.unpaid).length : 0;

  function save() {
    if (dateError) return;
    const opts = { separately: askCredit && separately };
    if (status === "paid") onSave({ status, date: paidAt || null, via: via || null }, opts);
    else if (status === "requested") onSave({ status, date: requestedAt }, opts);
    else onSave({ status: "unpaid" }, opts);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Ödeme durumu"
      description={`${title} · ${targets.length > 1 ? `${num(targets.length)} fatura · ` : ""}${money(total)}${
        ledger && ledger.panelPaid > 0.005 ? ` · Kalan ${money(ledger.remaining)} (panelde ödenen ${money(ledger.panelPaid)})` : ""
      }`}
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
        {ledger?.counted.length ? (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-soft">Bu faturaya sayılan ödemeler</p>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
              {ledger.counted.map((c) => (
                <li key={c.allocationId} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-sm">
                  <span className="min-w-0 flex-1 text-ink tabular">
                    {dateTR(c.date).slice(0, 5)} · {c.method} · {money(c.amount)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => ledger.onRemove(c.allocationId)} className="shrink-0">
                    Ödemeden çıkar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ChoiceList<PayState>
          label="Durum"
          value={status}
          onChange={setStatus}
          options={[
            { value: "paid" as const, label: <StateLabel dot="bg-good" text="Ödendi" note={current === "paid" && one?.paidAt ? `şu an ${dateTR(one.paidAt)}` : null} /> },
            ...(covered
              ? []
              : [
                  {
                    value: "requested" as const,
                    label: <StateLabel dot="bg-info" text="Ödemesi talep edildi" note={current === "requested" && one?.paymentRequestedAt ? `şu an ${dateTR(one.paymentRequestedAt)}` : "henüz ödenmedi"} />,
                  },
                  { value: "unpaid" as const, label: <StateLabel dot="bg-bad" text="Ödenmedi" note={null} /> },
                ]),
          ]}
        />
        {covered && ledger?.counted.length ? (
          <p className="text-[13px] leading-5 text-ink-mute">
            {dateTR(ledger.counted[ledger.counted.length - 1].date).slice(0, 5)} ödemesiyle kapandı; ödenmedi yapmak için yukarıda ya da Hesap hareketleri&apos;nde ödemeden çıkarın.
          </p>
        ) : null}
        {askCredit && ledger ? (
          <ChoiceList<"credit" | "separate">
            label="Hesaptaki ödeme"
            value={separately ? "separate" : "credit"}
            onChange={(v) => setSeparately(v === "separate")}
            options={[
              { value: "credit", label: <StateLabel dot="bg-good" text={`Hesaptaki ödemeden say (${money(ledger.credit)})`} note={null} /> },
              { value: "separate", label: <StateLabel dot="bg-ink-quiet" text="Ayrıca ödendi" note="hesaptaki para olduğu gibi kalır" /> },
            ]}
          />
        ) : null}
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
        {ledger?.onPartial && one?.unpaid ? (
          <button type="button" onClick={ledger.onPartial} className="min-h-9 cursor-pointer text-[13px] font-medium text-info underline-offset-2 hover:underline pointer-coarse:min-h-11">
            Kısmi ödeme gir
          </button>
        ) : null}
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
