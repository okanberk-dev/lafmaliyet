"use client";

import { Info, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PhotoStatus, PhotoThumb, ReadError, type PhotoPhase } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { parseNumberTR } from "@/lib/calc/expr";
import { cashOutShortLabel, cashOutWritesExpense, type CashOutDocType, type CashOutKind } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import type { PhotoUploadResponse } from "@/lib/photo-read/reading";
import type { ReceiptCheck, ReceiptField, ReceiptReading } from "@/lib/photo-read/receipt";
import { photoCaption } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";
import { deleteCashOut, restoreCashOut, saveCashOut } from "@/server/actions/cash-outs";
import type { CashOutCategory, CashOutDTO } from "@/server/data/cash-outs";

/** Pencerenin taslağı (metin alanları formdaki gibi) */
interface Draft {
  kind: CashOutKind;
  amount: string;
  store: string;
  description: string;
  receiptDate: string;
  vat: string;
  categoryId: string;
  /** Yöneticinin anahtarı */
  toExpenses: boolean;
  docType: CashOutDocType;
  receiptNo: string | null;
}

type DraftField = "amount" | "store" | "description" | "receiptDate" | "vat" | "categoryId";

const amountText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

function draftOf(line: CashOutDTO | null, kind: CashOutKind): Draft {
  if (!line) return { kind, amount: "", store: "", description: "", receiptDate: "", vat: "", categoryId: "", toExpenses: true, docType: "yok", receiptNo: null };
  return {
    kind: line.kind,
    amount: amountText(line.amount),
    store: line.store ?? "",
    description: line.description ?? "",
    receiptDate: line.receiptDate ?? "",
    vat: amountText(line.vat),
    categoryId: line.categoryId ? String(line.categoryId) : "",
    toExpenses: line.expenseEntryId !== null,
    docType: line.docType,
    receiptNo: line.receiptNo,
  };
}

/** Fiş okumasının taslağa uygulanışı: yalnız boş alanlar dolar */
function applyReceipt(d: Draft, r: ReceiptReading, admin: boolean): { draft: Draft; filled: Partial<Record<DraftField, string>> } {
  const filled: Partial<Record<DraftField, string>> = {};
  const next = { ...d };
  const put = (k: DraftField, v: string | null) => {
    if (v && !next[k].trim()) {
      next[k] = v;
      filled[k] = v;
    }
  };
  put("amount", r.values.amount !== null ? amountText(r.values.amount) : null);
  put("store", r.values.store);
  put("description", r.values.summary);
  put("receiptDate", r.values.receiptDate);
  put("vat", r.values.vat !== null ? amountText(r.values.vat) : null);
  put("categoryId", r.values.categoryId !== null ? String(r.values.categoryId) : null);
  next.docType = r.docType;
  next.receiptNo = next.receiptNo ?? r.values.receiptNo;
  if (admin) next.toExpenses = r.toExpensesDefault;
  return { draft: next, filled };
}

export type CashOutDialogMode = { mode: "photo" } | { mode: "plain" } | { mode: "edit"; line: CashOutDTO };

/**
 * Kasadan çıkan: fişin fotoğrafından okunan (ya da elle yazılan) tutar, yer, ne alındı, tarih, KDV ve kategori.
 * Okuma yalnız boş alanları doldurur ("Fişten" rozeti); denetimler altta, turuncu olanlar alanı da işaretler. Kaydet'e
 * basılmadan hiçbir şey yazılmaz. Yönetici "Aylık harcamalar'a da yaz"ı seçer; personelin yeni fişi kurala göre
 * yazılır (fatura ve e-Arşiv hayır), düzeltmesi kaydı açmaz ve silmez (cashOutWritesExpense). Kaydı yöneticinin
 * kategorisindeki satırı personel silemez, kategorisini ve türünü değiştiremez. Telefonda alttan açılan sayfa; içinde
 * sayfa değişmez.
 */
export function CashOutDialog({
  open,
  mode,
  date,
  categories,
  admin,
  me,
  phase,
  uploaded,
  onRetry,
  onClose,
}: {
  open: boolean;
  mode: CashOutDialogMode;
  date: string;
  categories: CashOutCategory[];
  admin: boolean;
  me: string;
  /** Fotoğrafın yükleme / okuma aşaması (yalnız "photo") */
  phase: PhotoPhase;
  uploaded: PhotoUploadResponse | null;
  onRetry: (photoId: number) => void;
  onClose: () => void;
}) {
  const line = mode.mode === "edit" ? mode.line : null;
  const [draft, setDraft] = useState<Draft>(() => draftOf(line, "harcama"));
  const [filled, setFilled] = useState<Partial<Record<DraftField, string>>>({});
  const [applied, setApplied] = useState<number | null>(null);
  const [reading, setReading] = useState<ReceiptReading | null>(null);
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const [pending, start] = useActionTransition();

  // Okuma gelince (yükleme pencere açıkken biter) taslağa bir kez uygulanır; o arada yazılanlar kalır
  const fresh = uploaded && uploaded.reading?.kind === "fis" ? uploaded.reading : null;
  const freshKey = uploaded ? uploaded.photo.id * 10 + (fresh ? 1 : 0) : null;
  if (freshKey !== null && freshKey !== applied) {
    setApplied(freshKey);
    if (fresh) {
      setReading(fresh.ok ? fresh : null);
      if (fresh.ok) {
        const r = applyReceipt(draft, fresh, admin);
        setDraft(r.draft);
        setFilled((f) => ({ ...f, ...r.filled }));
      }
    } else {
      setDraft((d) => ({ ...d, docType: d.docType === "yok" ? "fis" : d.docType }));
    }
  }

  const photoId = line ? line.photoId : (uploaded?.photo.id ?? null);
  const withPhoto = photoId !== null || mode.mode === "photo";
  const harcama = draft.kind === "harcama";
  const docInvoice = draft.docType === "fatura" || draft.docType === "e_arsiv";
  const writes = cashOutWritesExpense({ admin, mode: line ? "edit" : "new", kind: draft.kind, docType: draft.docType, requested: draft.toExpenses, hasExpense: line?.expenseEntryId != null });
  // Kaydı yöneticinin kategorisinde (personelin listesinde yok): personel tutarı düzeltir, silemez ve taşıyamaz
  const locked = !admin && line !== null && line.expenseEntryId !== null && !categories.some((c) => c.id === line.categoryId);
  const checks: ReceiptCheck[] = reading?.checks ?? [];
  const warnFields = new Set<ReceiptField>(checks.filter((c) => c.level === "warn").flatMap((c) => c.fields));
  const suggested = reading && reading.confidence.categoryId === "high" ? categories.find((c) => c.id === reading.values.categoryId) : undefined;
  // Personel listede olmayan (yöneticinin seçtiği) kategoriyi değiştirmeden kaydedebilsin; adı personele gelmez
  const options =
    line?.categoryId && !categories.some((c) => c.id === line.categoryId)
      ? [...categories, { id: line.categoryId, name: line.categoryName ?? "Yöneticinin seçtiği kategori", section: "" }]
      : categories;

  const set = (k: DraftField) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const chip = (k: DraftField, label: string) =>
    filled[k] !== undefined && draft[k] === filled[k] ? (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {label}
        <Badge tone="blue">Fişten</Badge>
      </span>
    ) : (
      label
    );
  const warn = (k: ReceiptField) => (warnFields.has(k) ? true : undefined);

  function save() {
    const amount = parseNumberTR(draft.amount);
    if (amount === null || amount <= 0) return void (toast.error("Tutarı yazın (ör. 412,50)"), document.getElementById("co-amount")?.focus());
    const vat = draft.vat.trim() ? parseNumberTR(draft.vat) : null;
    if (draft.vat.trim() && (vat === null || vat < 0)) return void (toast.error("KDV'yi tutar olarak yazın (ör. 15,31)"), document.getElementById("co-vat")?.focus());
    if (writes && !draft.categoryId) return void (toast.error("Kategori seçin"), document.getElementById("co-cat")?.focus());
    start(async () => {
      const res = await saveCashOut({
        id: line?.id ?? null,
        date,
        kind: draft.kind,
        amount,
        store: draft.store,
        description: draft.description,
        receiptDate: harcama && draft.receiptDate ? draft.receiptDate : null,
        receiptNo: harcama ? draft.receiptNo : null,
        vat: harcama ? vat : null,
        docType: harcama ? (photoId ? (draft.docType === "yok" ? "fis" : draft.docType) : draft.docType) : "yok",
        categoryId: writes && draft.categoryId ? Number(draft.categoryId) : null,
        toExpenses: admin ? draft.toExpenses && harcama : writes,
        photoId,
      });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      const label = cashOutShortLabel({ kind: draft.kind, amount, store: draft.store.trim() || null, description: draft.description.trim() || null });
      toast.success(`${line ? "Düzeltildi" : "Eklendi"}: ${label} · ${money(amount)}${res.data.expenseId ? " · Aylık harcamalar'a yazıldı" : ""}`);
      onClose();
    });
  }

  function remove() {
    if (!line) return;
    start(async () => {
      const res = await deleteCashOut(line.id);
      if (!res.ok) return void toast.error(res.error);
      onClose();
      toast.success(`Silindi: ${cashOutShortLabel(line)} · ${money(line.amount)}`, {
        duration: 8000,
        action: {
          label: "Geri al",
          onClick: () =>
            void restoreCashOut(res.data.undo).then((r) => {
              if (!r.ok) toast.error(r.error);
              else toast.success(`Geri alındı: ${cashOutShortLabel(line)} · ${money(line.amount)}`);
            }),
        },
      });
    });
  }

  const busyPhoto = phase.kind === "compressing" || phase.kind === "uploading" || phase.kind === "reading";
  const caption = photoId ? photoCaption("fis", line?.createdAt ?? new Date().toISOString(), line?.createdByName ?? me) : "";

  return (
    <Dialog
      open={open}
      onClose={() => !pending && onClose()}
      title={line ? "Kasadan çıkanı düzelt" : "Kasadan çıkan"}
      footerStart={
        line && !locked ? (
          <Button variant="ghost" className="text-bad" onClick={remove} disabled={pending}>
            <Trash2 size={15} /> Sil
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending || busyPhoto}>
            {pending ? "Kaydediliyor…" : busyPhoto ? "Fotoğraf bekleniyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {withPhoto ? (
          <div className="space-y-2">
            {photoId ? <PhotoThumb id={photoId} caption={caption} onOpen={() => setViewer({ id: photoId, caption })} /> : null}
            <PhotoStatus phase={phase} />
            {uploaded?.readError ? <ReadError message={uploaded.readError} onRetry={uploaded.canRetry ? () => onRetry(uploaded.photo.id) : undefined} busy={busyPhoto} /> : null}
            {fresh && !fresh.ok && fresh.error ? <p className="text-[13px] leading-5 text-bad">{fresh.error}</p> : null}
          </div>
        ) : locked ? null : (
          <Field label="Ne için">
            <Segmented<CashOutKind>
              label="Ne için"
              stretch
              value={draft.kind}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v }))}
              options={[
                { value: "harcama", label: "Alışveriş / ödeme" },
                { value: "teslim", label: "Teslim" },
              ]}
            />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={chip("amount", "Tutar (₺)")} htmlFor="co-amount">
            <NumberInput id="co-amount" value={draft.amount} onChange={set("amount")} placeholder="0" enterKeyHint="next" data-warn={warn("amount")} />
          </Field>
          <Field label={chip("store", harcama ? "Yer" : "Kime")} htmlFor="co-store">
            <Input id="co-store" value={draft.store} onChange={set("store")} maxLength={60} placeholder={harcama ? "ör. Migros" : "ör. patrona, bankaya"} autoComplete="off" data-warn={warn("store")} />
          </Field>
          <Field label={chip("description", harcama ? "Ne alındı" : "Açıklama")} htmlFor="co-desc" className="sm:col-span-2">
            <Input id="co-desc" value={draft.description} onChange={set("description")} maxLength={200} placeholder={harcama ? "ör. süt, buz" : "isteğe bağlı"} autoComplete="off" data-warn={warn("summary")} />
          </Field>
          {withPhoto && harcama ? (
            <>
              <Field label={chip("receiptDate", "Fiş tarihi")} htmlFor="co-date">
                <Input id="co-date" type="date" value={draft.receiptDate} onChange={set("receiptDate")} data-warn={warn("receiptDate")} />
              </Field>
              <Field label={chip("vat", "KDV (₺)")} htmlFor="co-vat" hint="Fişteki toplam KDV; muhasebe için">
                <NumberInput id="co-vat" value={draft.vat} onChange={set("vat")} placeholder="isteğe bağlı" data-warn={warn("vat")} />
              </Field>
            </>
          ) : null}
          {harcama && admin ? (
            <div className="sm:col-span-2">
              <Switch checked={draft.toExpenses} onChange={(v) => setDraft((d) => ({ ...d, toExpenses: v }))} label="Aylık harcamalar'a da yaz" showText onText="Aylık harcamalar'a da yaz" offText="Aylık harcamalar'a yazılmaz" />
            </div>
          ) : null}
          {writes ? (
            <Field label={chip("categoryId", "Kategori")} htmlFor="co-cat" hint={suggested ? `Önerilen: ${suggested.name}` : undefined} className="sm:col-span-2">
              <Select id="co-cat" value={draft.categoryId} onChange={set("categoryId")} disabled={locked} data-warn={warn("categoryId")}>
                <option value="">Kategori seçin</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        {harcama && !admin && !writes && docInvoice ? (
          <p className="flex items-start gap-2 rounded-xl bg-info-soft px-3 py-2 text-[13px] leading-5 text-info">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            Fatura olduğu için Aylık harcamalar&apos;a yazılmadı; yönetici bakar.
          </p>
        ) : null}
        {locked ? (
          <p className="flex items-start gap-2 rounded-xl bg-info-soft px-3 py-2 text-[13px] leading-5 text-info">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            Bu satır yöneticinin harcama kaydına bağlı; silmek için yöneticiye haber verin.
          </p>
        ) : null}
        {checks.length ? (
          <ul className="space-y-1.5">
            {checks.slice(0, 5).map((c, i) => (
              <li key={i} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-5", c.level === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info")}>
                {c.level === "warn" ? <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
                <span className="min-w-0">{c.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </Dialog>
  );
}
