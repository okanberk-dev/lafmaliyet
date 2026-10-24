"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { toastUnreachable, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { BIG_FIELDS, ChoiceList, SHEET_BTN } from "@/components/ui/mobile-filters";
import { parseNumberTR } from "@/lib/calc/expr";
import { allocateFifo, allocationPreview, validateManual, type AllocationLine, type OpenItem } from "@/lib/cari/account";
import { CARI_METHODS, EPS, METHOD_LABEL, round2, type CariMethod } from "@/lib/cari/balance";
import { dateTR, tl } from "@/lib/format";
import { addDays } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { deleteSupplierEntry, saveSupplierPayment } from "@/server/actions/cari";
import { loadKasaLines } from "@/server/actions/cari-options";

import { amountText, CARI_UNDO_MS } from "./cari-ui";

/** Cari kaydının tedarikçisi: kartı varsa kartın kimliği, yoksa grubun anahtarı (sunucu çözer; ad gönderilmez) */
export type CariTarget = { cardId: number } | { key: string };

export type AllocationMode = "auto" | "manual" | "none";

/** Kasadan ödemenin seçilebilen satırı (o günün işlenmemiş Teslim satırı) */
export interface KasaOption {
  id: number;
  date: string;
  amount: number;
  store: string | null;
  createdByName: string;
  match: boolean;
}

/** Pencerenin açılış değerleri (fatura satırından "Kısmi ödeme", Kasa şeridinden "İşle") */
export interface CariPaymentInitial {
  amount?: number;
  /** Seçerek: bu kalemler kalanlarıyla seçili gelir */
  select?: { kind: "invoice" | "debt"; id: number }[];
  mode?: AllocationMode;
  method?: CariMethod;
  date?: string;
  cashOutId?: number;
}

/** Düzeltilen ödeme */
export interface EditPayment {
  id: number;
  date: string;
  amount: number;
  method: CariMethod;
  note: string | null;
  cashOutId: number | null;
  cashOutCreated: boolean;
  cashOutStore: string | null;
  /** Kalemlere sayılmış toplam */
  counted: number;
}

const itemKey = (i: { kind: string; id: number }) => `${i.kind}:${i.id}`;

/** "Teslim · Sütaş · 2.200,00 ₺ · Ayşe" */
export const kasaLineText = (l: Pick<KasaOption, "store" | "amount" | "createdByName">) => ["Teslim", l.store || "Kime yazılmamış", tl(l.amount, 2), l.createdByName].join(" · ");

/**
 * Kasadan ödemenin satırı: o günün işlenmemiş Teslim satırları (tedarikçinin adıyla eşleşenler önce) ya da kasaya yeni
 * Teslim satırı. `amount` verilirse tutarı farklı satır seçilemez (borç ekle'nin "Ödendi"si kalan kadar öder).
 */
export function KasaLinePicker({
  date,
  names,
  paymentId,
  value,
  onChange,
  amount,
}: {
  date: string;
  names: string[];
  paymentId?: number | null;
  value: number | "new" | null;
  onChange: (v: number | "new", line: KasaOption | null) => void;
  amount?: number | null;
}) {
  const [lines, setLines] = useState<{ date: string; list: KasaOption[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const namesKey = names.join("|");
  useEffect(() => {
    if (!valid) return;
    let alive = true;
    loadKasaLines({ date, names: namesKey.split("|"), paymentId: paymentId ?? null })
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setLines({ date, list: r.data });
          setFailed(null);
        } else setFailed(r.error);
      })
      .catch(() => alive && setFailed("Kasa satırları okunamadı; bağlantıyı kontrol edin."));
    return () => {
      alive = false;
    };
  }, [date, valid, namesKey, paymentId]);
  const list = lines?.date === date ? lines.list : null;
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Kasa satırı · {valid ? dateTR(date) : "gün seçin"}</legend>
      <div role="radiogroup" aria-label="Kasa satırı" className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
        {list === null ? (
          <p className="px-4 py-3 text-[13px] text-ink-mute">{failed ?? "Kasa satırları okunuyor…"}</p>
        ) : (
          list.map((l) => {
            const off = amount !== undefined && amount !== null && Math.abs(l.amount - amount) > EPS;
            const on = value === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={off}
                onClick={() => onChange(l.id, l)}
                className={cn("flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-50", on ? "bg-panel font-medium text-ink" : "text-ink-soft hover:bg-panel/60")}
              >
                <span className="min-w-0 flex-1 break-words">
                  {kasaLineText(l)}
                  {off ? <span className="block text-xs font-normal text-ink-mute">tutar farklı</span> : l.match ? null : <span className="block text-xs font-normal text-ink-mute">adı eşleşmiyor</span>}
                </span>
                <Radio on={on} />
              </button>
            );
          })
        )}
        <button
          type="button"
          role="radio"
          aria-checked={value === "new"}
          onClick={() => onChange("new", null)}
          className={cn("flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-[14px] transition-colors", value === "new" ? "bg-panel font-medium text-ink" : "text-ink-soft hover:bg-panel/60")}
        >
          <Plus size={15} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">Bu ayrı bir ödeme, kasaya yeni satır ekle</span>
          <Radio on={value === "new"} />
        </button>
      </div>
      {list && !list.length ? <p className="mt-1.5 text-xs text-ink-mute">O gün kasada işlenmemiş Teslim satırı yok.</p> : null}
    </fieldset>
  );
}

function Radio({ on }: { on: boolean }) {
  return <span className={cn("size-5 shrink-0 rounded-full", on ? "border-[6px] border-ink bg-surface" : "ring-1 ring-line-strong ring-inset")} aria-hidden="true" />;
}

/**
 * Ödeme ekle / Ödemeyi düzenle (§3.2): tek bir faturaya bağlı olmayan ödeme (hesaba, kısmi, toptan, elden, kasadan).
 * Yeni ödeme en eski borçtan, seçilen kalemlere ya da hiçbir kaleme sayılır; canlı önizleme kapanacakları, kısmen
 * ödenecekleri ve hesapta kalacak parayı söyler. Kasadan ödeme bir Kasa satırıdır (o günün Teslim satırı ya da yeni
 * satır). Düzeltmede dağıtım değişmez ("Neye sayıldı").
 */
export function CariPaymentDialog({
  target,
  supplierName,
  names,
  today,
  businessDay,
  defaultMethod,
  items,
  payment,
  initial,
  onClose,
  onSaved,
}: {
  target: CariTarget;
  supplierName: string;
  /** Tedarikçinin adları (Kasa satırlarının eşleşmesi) */
  names: string[];
  today: string;
  /** Kasanın bugünkü günü (Kasadan ödeme bundan ileri olamaz) */
  businessDay: string;
  /** Kartın ödeme şeklinden (Nakit → Elden) */
  defaultMethod: CariMethod;
  /** Açık kalemler, dağıtım sırasıyla (kalanlarıyla) */
  items: OpenItem[];
  payment?: EditPayment | null;
  initial?: CariPaymentInitial;
  onClose: () => void;
  /** Kayıttan sonra (kart yeni açıldıysa adresi değişebilir) */
  onSaved?: (r: { slug: string | null }) => void;
}) {
  const edit = payment ?? null;
  const [date, setDate] = useState(initial?.date ?? edit?.date ?? today);
  const [amount, setAmount] = useState(amountText(initial?.amount ?? edit?.amount ?? null));
  const [method, setMethod] = useState<CariMethod>(initial?.method ?? edit?.method ?? defaultMethod);
  const [line, setLine] = useState<number | "new" | null>(initial?.cashOutId ?? null);
  const [mode, setMode] = useState<AllocationMode>(initial?.mode ?? (initial?.select?.length ? "manual" : "auto"));
  const balanceOf = useMemo(() => new Map(items.map((i) => [itemKey(i), i.balance])), [items]);
  const [picked, setPicked] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    let rest = initial?.amount ?? Infinity;
    for (const s of initial?.select ?? []) {
      const b = balanceOf.get(itemKey(s)) ?? 0;
      const take = Math.min(b, rest);
      m.set(itemKey(s), amountText(round2(take)));
      rest -= take;
    }
    return m;
  });
  const [note, setNote] = useState(edit?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useActionTransition();

  const value = parseNumberTR(amount) ?? 0;
  const stayKasa = Boolean(edit && edit.method === "kasa" && method === "kasa" && edit.cashOutId !== null);
  const plan = useMemo((): { lines: AllocationLine[]; left: number } => {
    if (edit || mode === "none") return { lines: [], left: round2(value) };
    if (mode === "auto") return allocateFifo(items.filter((i) => i.quiet !== "link"), value);
    const lines = [...picked].flatMap(([k, t]) => {
      const [kind, id] = k.split(":");
      const a = parseNumberTR(t) ?? 0;
      return a > 0 ? [{ kind: kind as AllocationLine["kind"], id: Number(id), amount: round2(a) }] : [];
    });
    return { lines, left: round2(value - lines.reduce((a, l) => a + l.amount, 0)) };
  }, [edit, mode, items, value, picked]);
  const manualProblem = !edit && mode === "manual" && value > 0 ? validateManual(plan.lines, items, value) : null;
  const preview = !edit && value > 0 ? allocationPreview(plan.lines, items, Math.max(0, plan.left)) : null;

  const maxDate = method === "kasa" ? businessDay : addDays(today, 1);
  const dateError = !date ? "Ödeme gününü seçin" : date > maxDate ? (method === "kasa" ? "Kasadan ödeme kasanın bugünkü gününden ileri olamaz" : "İleri bir tarih olamaz") : null;
  const amountError = amount.trim() && !(value > 0) ? "Tutar girin" : edit && value < edit.counted - EPS ? `Bu ödemenin ${tl(edit.counted, 2)}'si kalemlere sayılmış; önce 'Neye sayıldı'dan azaltın` : null;

  function save() {
    setError(null);
    if (dateError || amountError) return;
    if (!(value > 0)) return void setError("Tutar girin");
    if (method === "kasa" && !stayKasa && line === null) return void setError("Kasa satırını seçin ya da kasaya yeni satır ekleyin");
    if (manualProblem) return void setError(manualProblem);
    const cashOut = method === "kasa" && !stayKasa ? (line === "new" ? { mode: "new" as const } : { mode: "existing" as const, id: line as number }) : null;
    run(async () => {
      const r = await saveSupplierPayment({
        target,
        id: edit?.id ?? null,
        date,
        amount: value,
        method,
        cashOut,
        allocation: { mode: edit ? "none" : mode, lines: plan.lines },
        note: note.trim() || null,
        photoId: null,
      });
      if (!r.ok) return void setError(r.error);
      const d = r.data;
      const parts = [supplierName, tl(value, 2), METHOD_LABEL[method]];
      if (d.created) parts.push(d.lines.length ? `${d.closed ? `${d.closed} kapandı` : ""}${d.closed && d.partial ? ", " : ""}${d.partial ? `${d.partial} kısmen` : ""}` : "hiçbir kaleme sayılmadı", `hesapta ${tl(d.left, 2)}`);
      const cardTarget = { cardId: d.cardId };
      // Geri al: yeni ödeme silinir; düzeltme önceki değerlerle yeniden yazılır (ödemenin açtığı kasa satırı silindiyse olmaz)
      const prev = d.prev;
      const undo = d.created
        ? () => deleteSupplierEntry({ id: d.id })
        : prev && !(prev.method === "kasa" && method !== "kasa")
          ? () =>
              saveSupplierPayment({
                target: cardTarget,
                id: d.id,
                date: prev.date,
                amount: prev.amount,
                method: prev.method,
                cashOut: null,
                allocation: { mode: "none", lines: [] },
                note: edit?.note ?? null,
                photoId: null,
              })
          : null;
      toast.success(d.created ? "Ödeme eklendi" : "Ödeme düzeltildi", {
        description: parts.filter(Boolean).join(" · "),
        duration: CARI_UNDO_MS,
        ...(undo
          ? {
              action: {
                label: "Geri al",
                onClick: async () => {
                  try {
                    const u = await undo();
                    if (!u.ok) return void toast.error(u.error);
                    toast.success(d.created ? "Ödeme silindi" : "Ödeme eski hâline döndü");
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

  const toggle = (it: OpenItem) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(itemKey(it))) next.delete(itemKey(it));
      else {
        const used = [...next.values()].reduce((a, t) => a + (parseNumberTR(t) ?? 0), 0);
        const room = value > 0 ? Math.max(0, round2(value - used)) : it.balance;
        next.set(itemKey(it), amountText(round2(Math.min(it.balance, room || it.balance))));
      }
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={edit ? "Ödemeyi düzenle" : "Ödeme ekle"}
      description={`${supplierName} · tek bir faturaya bağlı olmayan ödeme: hesaba, kısmi, toptan, elden`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={SHEET_BTN}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending || Boolean(dateError || amountError)} className={SHEET_BTN}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className={cn("space-y-4 pb-2", BIG_FIELDS)}>
        <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
          <Field label="Ödeme günü" htmlFor="cp-date" error={dateError ?? undefined}>
            <Input id="cp-date" type="date" value={date} max={maxDate} onChange={(e) => setDate(e.target.value)} aria-invalid={Boolean(dateError) || undefined} />
          </Field>
          <Field label="Tutar (₺)" htmlFor="cp-amount" error={amountError ?? undefined} hint={typeof line === "number" && method === "kasa" ? "Kasa satırının tutarı" : undefined}>
            <NumberInput
              id="cp-amount"
              value={amount}
              placeholder="0,00"
              onChange={(e) => setAmount(e.target.value)}
              disabled={method === "kasa" && typeof line === "number"}
              aria-invalid={Boolean(amountError) || undefined}
              data-autofocus={initial?.amount ? undefined : true}
            />
          </Field>
        </div>
        <Field label="Nasıl ödendi" htmlFor="cp-method">
          <Select
            id="cp-method"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as CariMethod);
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
        {method === "kasa" ? (
          stayKasa ? (
            <p className="rounded-2xl bg-panel px-3.5 py-2.5 text-[13px] leading-5 text-ink-soft">
              Kasa satırı: Teslim · {edit?.cashOutStore ?? supplierName}. Günü ve tutarı ödemeyle birlikte değişir.
            </p>
          ) : (
            <KasaLinePicker
              date={date}
              names={names}
              paymentId={edit?.id ?? null}
              value={line}
              onChange={(v, l) => {
                setLine(v);
                if (l) setAmount(amountText(l.amount));
              }}
            />
          )
        ) : edit?.method === "kasa" ? (
          <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
            {edit.cashOutCreated ? "Bu ödemenin kasaya açtığı satır silinir." : "Bağlı kasa satırı kalır ve işlenmemişe döner."}
          </p>
        ) : null}

        {edit ? (
          edit.counted > EPS ? (
            <p className="text-[13px] leading-5 text-ink-mute">
              Bu ödemenin {tl(edit.counted, 2)}&apos;si kalemlere sayılmış. Neye sayıldığını Hesap hareketleri&apos;nde “Neye sayıldı”dan değiştirin.
            </p>
          ) : null
        ) : (
          <>
            <ChoiceList<AllocationMode>
              label="Neye sayılsın"
              value={mode}
              onChange={setMode}
              options={[
                { value: "auto", label: <ModeLabel text="En eski borçtan" note="vadesi en yakın kalemden başlayarak" /> },
                { value: "manual", label: <ModeLabel text="Seçerek" note="kalemleri ve tutarları siz seçin" /> },
                { value: "none", label: <ModeLabel text="Hesapta beklesin" note="avans ya da toptan ödeme; sonra borçlara sayılır" /> },
              ]}
            />
            {mode === "manual" ? (
              items.length ? (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
                  {items.map((it) => {
                    const k = itemKey(it);
                    const on = picked.has(k);
                    return (
                      <li key={k} className="px-3.5 py-2.5">
                        <label className="flex min-h-11 cursor-pointer items-start gap-3">
                          <input type="checkbox" checked={on} onChange={() => toggle(it)} className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-ink pointer-coarse:size-5" />
                          <span className="min-w-0 flex-1 text-sm leading-5">
                            <span className="block break-words text-ink">{it.kind === "debt" ? `Faturasız alım · ${it.label}` : it.label}</span>
                            <span className="block text-xs text-ink-mute tabular">
                              {dateTR(it.date).slice(0, 5)} · kalan {tl(it.balance, 2)} · {it.dueEstimated ? "tahmini vade" : "vade"} {dateTR(it.due).slice(0, 5)}
                              {it.quiet === "link" ? " · faturasız alımın faturası olabilir" : ""}
                            </span>
                          </span>
                        </label>
                        {on ? (
                          <NumberInput
                            value={picked.get(k) ?? ""}
                            onChange={(e) => setPicked((m) => new Map(m).set(k, e.target.value))}
                            aria-label={`${it.label} için sayılacak tutar`}
                            className="mt-2 w-full"
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-mute">Açık kalem yok; ödeme hesapta bekler.</p>
              )
            ) : null}
            {preview ? (
              <div className="rounded-2xl bg-panel px-3.5 py-2.5 text-[13px] leading-5 text-ink-soft" aria-live="polite">
                <p className="tabular">{preview}</p>
                {plan.left > EPS ? <p className="mt-1 text-ink-mute">{tl(plan.left, 2)} hesapta kalır; yeni borca ya da faturaya “Borçlara say” ile sayılır.</p> : null}
              </div>
            ) : null}
          </>
        )}

        <Field label="Not" htmlFor="cp-note">
          <Textarea id="cp-note" value={note} onChange={(e) => setNote(e.target.value)} rows={1} maxLength={500} className="max-h-28 min-h-11 [field-sizing:content]" />
        </Field>
        {error ? (
          <p className="rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] leading-5 text-bad" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ModeLabel({ text, note }: { text: string; note: string }) {
  return (
    <span className="block">
      <span className="block">{text}</span>
      <span className="block text-[13px] font-normal text-ink-mute">{note}</span>
    </span>
  );
}
