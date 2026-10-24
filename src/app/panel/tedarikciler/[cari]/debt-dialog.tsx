"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { toastUnreachable, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { BIG_FIELDS, SHEET_BTN } from "@/components/ui/mobile-filters";
import { ToggleRow } from "@/components/ui/toggle-row";
import { parseNumberTR } from "@/lib/calc/expr";
import { COST_MODE_LABEL, type CostMode } from "@/lib/cari/account";
import { CARI_METHODS, EPS, METHOD_LABEL, round2, type CariMethod } from "@/lib/cari/balance";
import { adoptCandidates, expenseDuplicates, type ExpenseLite } from "@/lib/cari/match";
import type { MonthEffect } from "@/lib/cari/months";
import { dateTR, monthLabel, tl } from "@/lib/format";
import { addDays } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { deleteSupplierEntry, saveSupplierDebt } from "@/server/actions/cari";
import { loadDebtOptions } from "@/server/actions/cari-options";

import { KasaLinePicker, type CariTarget } from "../cari-payment-dialog";
import { amountText, CARI_UNDO_MS, CariPhotoField, PastConfirm } from "../cari-ui";

/** Penceredeki harcama kaydı (Aylık harcamalar) */
type ExpenseOption = ExpenseLite & { categoryName: string; section: string };

/** Düzeltilen borç */
export interface EditDebt {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  costMode: CostMode;
  categoryId: number | null;
  dueDate: string | null;
  note: string | null;
  /** Borca sayılmış ödemeler */
  counted: number;
  /** "Gideri zaten girildi"de sahiplenilen kayıt */
  adoptedExpenseId: number | null;
  photoId: number | null;
}

const MODE_NOTE: Record<CostMode, string> = {
  fatura: "Şimdi gider yazılmaz; fatura gelince fatura gider olur.",
  gider: "Aylık harcamalar'a tek bir kayıt yazılır (KDV dahil, KDV'siz).",
  mevcut: "Alımı Aylık harcamalar'a zaten yazdıysanız o kaydı seçin.",
  devir: "Panelden önceki borç; hiçbir zaman gider sayılmaz.",
};

const MODES: CostMode[] = ["fatura", "gider", "mevcut", "devir"];

/**
 * Borç ekle / Borcu düzenle (§3.1): faturasız ya da elden alınan mal veya hizmet, eski borç. Gider dört seçenekten
 * biriyle belirlenir (K8); "Faturası yok" Aylık harcamalar'a bir kayıt yazar, "Gideri zaten girildi" var olan kaydı
 * borca eşitleyip sahiplenir. Kopya uyarıları ve eski borç uyarısı kaydı engellemez. Geçmiş ayın gideri değişecekse
 * sunucu onay ister (K18).
 */
export function DebtDialog({
  target,
  supplierName,
  names,
  today,
  businessDay,
  termDays,
  categories,
  defaultCategoryId,
  defaultMode,
  defaultMethod,
  credit,
  unpaidInvoices,
  debt,
  initialMode,
  onClose,
  onSaved,
}: {
  target: CariTarget;
  supplierName: string;
  names: string[];
  today: string;
  businessDay: string;
  termDays: number;
  categories: { id: number; name: string; section: string }[];
  defaultCategoryId: number | null;
  defaultMode: CostMode;
  defaultMethod: CariMethod;
  /** Kartın hesabındaki sayılmamış ödeme */
  credit: number;
  /** Ödenmemiş faturalar (eski borç uyarısı) */
  unpaidInvoices: { date: string; balance: number }[];
  debt?: EditDebt | null;
  /** Açılışta seçili gider (ör. 45 gün şeridinden "Gider olarak yaz") */
  initialMode?: CostMode;
  onClose: () => void;
  onSaved?: (r: { slug: string | null }) => void;
}) {
  const edit = debt ?? null;
  const [date, setDate] = useState(edit?.date ?? today);
  const [amount, setAmount] = useState(amountText(edit?.amount ?? null));
  const [description, setDescription] = useState(edit?.description ?? "");
  const [mode, setMode] = useState<CostMode>(initialMode ?? edit?.costMode ?? defaultMode);
  const [categoryId, setCategoryId] = useState<number | null>(edit?.categoryId ?? defaultCategoryId);
  const [adoptId, setAdoptId] = useState<number | null>(edit?.adoptedExpenseId ?? null);
  const [adoptOk, setAdoptOk] = useState(false);
  const [dueDate, setDueDate] = useState(edit?.dueDate ?? "");
  const [note, setNote] = useState(edit?.note ?? "");
  const [photoId, setPhotoId] = useState<number | null>(edit?.photoId ?? null);
  const [useCredit, setUseCredit] = useState(credit > EPS);
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<CariMethod>(defaultMethod);
  const [paidDate, setPaidDate] = useState(today);
  const [line, setLine] = useState<number | "new" | null>(null);
  const [past, setPast] = useState<MonthEffect[]>([]);
  const [pastOk, setPastOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<{ date: string; expenses: ExpenseOption[]; digerMal: number | null } | null>(null);
  const [pending, run] = useActionTransition();

  const value = parseNumberTR(amount) ?? 0;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  useEffect(() => {
    if (!validDate) return;
    let alive = true;
    loadDebtOptions({ date, debtId: edit?.id ?? null })
      .then((r) => alive && r.ok && setOptions({ date, ...r.data }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [date, validDate, edit?.id]);

  const goods = new Set(categories.filter((c) => c.section === "mal").map((c) => c.id));
  const expenses = options?.date === date ? options.expenses : [];
  const candidates = mode === "mevcut" ? adoptCandidates(expenses, { date, amount: value }, goods, edit?.id ?? null) : [];
  const duplicates = mode === "gider" && value > 0 ? expenseDuplicates(expenses, { date, amount: value }, goods) : [];
  const chosen = candidates.find((c) => c.id === adoptId) ?? null;
  // Seçili kayıt yoksa tutarı en yakın aday
  const adopted = chosen ?? candidates[0] ?? null;
  const adoptDiffers = Boolean(adopted && (Math.abs(adopted.amount - value) >= 0.005 || adopted.date !== date));
  const olderUnpaid = mode === "devir" ? unpaidInvoices.filter((i) => i.date < date && i.balance > 0) : [];
  const digerMal = mode === "gider" && options?.date === date ? options.digerMal : null;
  const remaining = round2(value - (edit?.counted ?? 0));
  // "Ödendi"nin ödemesi: hesaptaki para sayıldıktan sonra kalan
  const paidAmount = round2(Math.max(0, remaining - (useCredit && credit > EPS ? Math.min(credit, remaining) : 0)));

  const maxDate = addDays(today, 1);
  const dateError = !date ? "Alım gününü seçin" : date > maxDate ? "Alım günü ileri bir tarih olamaz" : null;
  const dueError = dueDate && date && dueDate < date ? "Vade alım gününden önce olamaz" : null;
  const amountError = amount.trim() && !(value > 0) ? "Tutar girin" : edit && value < edit.counted - EPS ? `Bu alıma ${tl(edit.counted, 2)} ödeme sayılmış; tutar bundan az olamaz` : null;
  const paidMax = paidMethod === "kasa" ? businessDay : maxDate;
  const paidError = paid ? (!paidDate ? "Ödeme gününü seçin" : paidDate > paidMax ? (paidMethod === "kasa" ? "Kasadan ödeme kasanın bugünkü gününden ileri olamaz" : "İleri bir tarih olamaz") : null) : null;
  const estimatedDue = validDate ? addDays(date, termDays) : null;

  function save() {
    setError(null);
    if (dateError || dueError || amountError || paidError) return;
    if (!(value > 0)) return void setError("Tutar girin");
    if (!description.trim()) return void setError("Ne alındığını yazın");
    if (mode === "gider" && !categoryId) return void setError("Kategori seçin");
    if (mode === "mevcut" && !adopted) return void setError("Harcama kaydını seçin");
    if (mode === "mevcut" && adoptDiffers && !adoptOk) return void setError("Kaydın borca eşitlenmesini onaylayın");
    if (past.length && !pastOk) return void setError("Geçmiş ayın değişeceğini onaylayın");
    if (paid && paidMethod === "kasa" && line === null) return void setError("Kasa satırını seçin ya da kasaya yeni satır ekleyin");
    run(async () => {
      const r = await saveSupplierDebt({
        target,
        id: edit?.id ?? null,
        date,
        amount: value,
        description: description.trim(),
        costMode: mode,
        categoryId: mode === "gider" ? categoryId : null,
        adoptExpenseId: mode === "mevcut" ? (adopted?.id ?? null) : null,
        dueDate: dueDate || null,
        note: note.trim() || null,
        photoId,
        applyCredit: useCredit && credit > EPS,
        paid: paid ? { method: paidMethod, date: paidDate, cashOut: paidMethod === "kasa" ? (line === "new" ? { mode: "new" } : { mode: "existing", id: line as number }) : null } : null,
        confirmPast: pastOk ? past.map((e) => e.month) : [],
      });
      if (!r.ok) return void setError(r.error);
      if (r.data.needs === "past") {
        setPast(r.data.effects);
        setPastOk(false);
        return;
      }
      const d = r.data;
      const parts = [supplierName, `${dateTR(date).slice(0, 5)} · ${description.trim()}`, tl(value, 2), COST_MODE_LABEL[mode].toLocaleLowerCase("tr")];
      if (d.credited > EPS) parts.push(`hesaptaki ${tl(d.credited, 2)} sayıldı`);
      if (d.paidAmount > EPS) parts.push(`${tl(d.paidAmount, 2)} ödendi`);
      const months = d.effects.map((e) => e.month);
      const prev = edit;
      const cardTarget = { cardId: d.cardId };
      const undo = d.created
        ? async () => {
            // Ödendi ile açılan ödeme önce silinir (borç ödemesiz silinir)
            if (d.paymentId) {
              const p = await deleteSupplierEntry({ id: d.paymentId });
              if (!p.ok) return p;
            }
            return deleteSupplierEntry({ id: d.id, confirmPast: months });
          }
        : prev
          ? () =>
              saveSupplierDebt({
                target: cardTarget,
                id: prev.id,
                date: prev.date,
                amount: prev.amount,
                description: prev.description ?? description.trim(),
                costMode: prev.costMode,
                categoryId: prev.costMode === "gider" ? prev.categoryId : null,
                adoptExpenseId: prev.costMode === "mevcut" ? prev.adoptedExpenseId : null,
                dueDate: prev.dueDate,
                note: prev.note,
                photoId: prev.photoId,
                applyCredit: false,
                paid: null,
                confirmPast: [...new Set([...months, prev.date.slice(0, 7), date.slice(0, 7)])].filter((m) => m < today.slice(0, 7)),
              })
          : null;
      toast.success(d.created ? "Borç eklendi" : "Borç düzeltildi", {
        description: parts.join(" · "),
        duration: CARI_UNDO_MS,
        ...(undo
          ? {
              action: {
                label: "Geri al",
                onClick: async () => {
                  try {
                    const u = await undo();
                    if (!u.ok) return void toast.error(u.error);
                    if (u.data && "needs" in u.data && u.data.needs === "past") return void toast.error("Geri almak geçmiş ayı değiştiriyor; kaydı Hesap hareketleri'nden düzeltin.");
                    toast.success(d.created ? "Borç silindi" : "Borç eski hâline döndü");
                  } catch (e) {
                    toastUnreachable(e);
                  }
                },
              },
            }
          : {}),
      });
      onClose();
      onSaved?.({ slug: d.slug });
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={edit ? "Borcu düzenle" : "Borç ekle"}
      description={`${supplierName} · faturasız ya da elden aldığınız mal veya hizmet, eski borç`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending || Boolean(dateError || dueError || amountError || paidError) || (past.length > 0 && !pastOk)} className={SHEET_BTN}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className={cn("space-y-4 pb-2", BIG_FIELDS)}>
        <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
          <Field label="Alım günü" htmlFor="db-date" error={dateError ?? undefined}>
            <Input
              id="db-date"
              type="date"
              value={date}
              max={maxDate}
              onChange={(e) => {
                setDate(e.target.value);
                setPast([]);
              }}
              aria-invalid={Boolean(dateError) || undefined}
            />
          </Field>
          <Field label="Tutar (KDV dahil, ₺)" htmlFor="db-amount" error={amountError ?? undefined}>
            <NumberInput
              id="db-amount"
              value={amount}
              placeholder="0,00"
              onChange={(e) => {
                setAmount(e.target.value);
                setPast([]);
              }}
              aria-invalid={Boolean(amountError) || undefined}
              data-autofocus
            />
          </Field>
        </div>
        <Field label="Ne alındı" htmlFor="db-what">
          <Input id="db-what" value={description} maxLength={200} placeholder="ör. 12 kg kaşar, irsaliye 4411" onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Gider</legend>
          <div role="radiogroup" aria-label="Gider" className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
            {MODES.map((m) => {
              const on = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setMode(m);
                    setPast([]);
                  }}
                  className={cn("flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors", on ? "bg-panel text-ink" : "text-ink-soft hover:bg-panel/60")}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[15px]", on && "font-medium")}>{COST_MODE_LABEL[m]}</span>
                    <span className="block text-[13px] leading-5 text-ink-mute">{MODE_NOTE[m]}</span>
                  </span>
                  <span className={cn("size-5 shrink-0 rounded-full", on ? "border-[6px] border-ink bg-surface" : "ring-1 ring-line-strong ring-inset")} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </fieldset>

        {mode === "gider" ? (
          <>
            <Field label="Kategori" htmlFor="db-cat" hint="Aylık harcamalar'daki kategori; mal bölümündekiler Mal alışları'na girer">
              <Select id="db-cat" value={categoryId ?? ""} onChange={(e) => setCategoryId(Number(e.target.value) || null)}>
                <option value="">Seçin</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.section === "mal" ? " (mal)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {duplicates.slice(0, 2).map((x) => (
              <Warn key={x.id}>
                {dateTR(x.date).slice(0, 5)} {x.categoryName} {tl(x.amount, 2)} zaten gider: bu alımsa “Gideri zaten girildi”yi seçin.{" "}
                <button
                  type="button"
                  className="cursor-pointer font-semibold underline underline-offset-2"
                  onClick={() => {
                    setMode("mevcut");
                    setAdoptId(x.id);
                  }}
                >
                  Bu kaydı seç
                </button>
              </Warn>
            ))}
            {digerMal !== null ? (
              <Warn>
                {monthLabel(date.slice(0, 7)).split(" ")[0]} ayının DİĞER (market / nakit alımlar) hücresinde {tl(digerMal)} var; bu alım oradaysa “Eski borç” seçin ya da hücreyi düzeltin.
              </Warn>
            ) : null}
          </>
        ) : null}

        {mode === "mevcut" ? (
          candidates.length ? (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Harcama kaydı</legend>
              <div role="radiogroup" aria-label="Harcama kaydı" className="max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl bg-surface ring-1 ring-line-strong">
                {candidates.slice(0, 20).map((c) => {
                  const on = adopted?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setAdoptId(c.id);
                        setAdoptOk(false);
                      }}
                      className={cn("flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-[14px]", on ? "bg-panel font-medium text-ink" : "text-ink-soft hover:bg-panel/60")}
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {dateTR(c.date)} · {c.categoryName} · {tl(c.amount, 2)}
                        {c.description ? <span className="block text-xs font-normal text-ink-mute">{c.description}</span> : null}
                      </span>
                      <span className={cn("size-5 shrink-0 rounded-full", on ? "border-[6px] border-ink bg-surface" : "ring-1 ring-line-strong ring-inset")} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              {adopted && adoptDiffers && value > 0 ? (
                <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
                  <input type="checkbox" checked={adoptOk} onChange={(e) => setAdoptOk(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink" />
                  <span>
                    Kaydı borca eşitle:{" "}
                    {[
                      Math.abs(adopted.amount - value) >= 0.005 ? `${tl(adopted.amount, 2)} → ${tl(value, 2)}` : null,
                      adopted.date !== date ? `${dateTR(adopted.date).slice(0, 5)} → ${dateTR(date).slice(0, 5)}` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </label>
              ) : null}
            </fieldset>
          ) : (
            <Warn>Uygun harcama kaydı yok. Gideri başka yerdeyse “Eski borç (devir)” seçin.</Warn>
          )
        ) : null}

        {olderUnpaid.length ? (
          <Warn>
            Bu tarihten önce {olderUnpaid.length} ödenmemiş fatura var ({tl(round2(olderUnpaid.reduce((a, i) => a + i.balance, 0)), 2)}); eski borç bunları da içeriyorsa önce onları ödendi yapın.
          </Warn>
        ) : null}

        <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
          <Field label="Vade" htmlFor="db-due" error={dueError ?? undefined} hint={dueDate ? undefined : estimatedDue ? `Boşsa ${dateTR(estimatedDue)} (alım günü + ${termDays} gün)` : undefined}>
            <Input id="db-due" type="date" value={dueDate} min={date || undefined} onChange={(e) => setDueDate(e.target.value)} aria-invalid={Boolean(dueError) || undefined} />
          </Field>
          <Field label="Not" htmlFor="db-note">
            <Textarea id="db-note" value={note} maxLength={1000} rows={1} onChange={(e) => setNote(e.target.value)} className="max-h-28 min-h-11 [field-sizing:content]" />
          </Field>
        </div>

        <CariPhotoField label="Fotoğraf (irsaliye / el fişi)" value={photoId} onChange={setPhotoId} day={date && date < businessDay ? date : businessDay} />

        {credit > EPS && remaining > EPS ? (
          <ToggleRow
            title="Hesaptaki ödemeyi say"
            description={`Hesapta ${tl(credit, 2)} sayılmamış ödeme var; bu alıma sayılır.`}
            checked={useCredit}
            onChange={setUseCredit}
            label="Hesaptaki ödemeyi say"
            onText="Sayılır"
            offText="Sayılmaz"
          />
        ) : null}
        {remaining > EPS ? (
          <ToggleRow
            title="Ödendi"
            description={useCredit && credit > EPS ? "Hesaptaki para sayıldıktan sonra kalanı için ödeme kaydı açılır." : "Borç, ödemesi ve tam dağıtım birlikte yazılır."}
            checked={paid}
            onChange={setPaid}
            label="Ödendi"
            onText="Ödendi"
            offText="Ödenmedi"
          />
        ) : null}
        {paid ? (
          <div className="space-y-4 rounded-2xl bg-panel/60 p-3.5">
            <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
              <Field label="Nasıl ödendi" htmlFor="db-method">
                <Select
                  id="db-method"
                  value={paidMethod}
                  onChange={(e) => {
                    setPaidMethod(e.target.value as CariMethod);
                    setLine(null);
                  }}
                >
                  {CARI_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ödeme günü" htmlFor="db-paid" error={paidError ?? undefined}>
                <Input id="db-paid" type="date" value={paidDate} max={paidMax} onChange={(e) => setPaidDate(e.target.value)} aria-invalid={Boolean(paidError) || undefined} />
              </Field>
            </div>
            {paidMethod === "kasa" ? (
              <KasaLinePicker
                date={paidDate}
                names={names}
                value={line}
                amount={paidAmount}
                onChange={(v) => setLine(v)}
              />
            ) : null}
          </div>
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

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
