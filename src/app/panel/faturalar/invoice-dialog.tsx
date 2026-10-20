"use client";

import { Lock, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { keepScroll } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { normalizeSupplier } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveInvoice } from "@/server/actions/invoices";

import { guessVat, isParasutLinked, parasutBillUrl, supplierMatchKey, VAT_RATES, type InvoiceRow, type SupplierDefault } from "./rules";

/** Boş değil ama sayı olarak okunamayan tutar */
const badNumber = (t: string) => t.trim() !== "" && parseNumberTR(t) === null;

/** Yerel saatle bugün (YYYY-AA-GG); toISOString UTC verir, gece 03:00'e kadar dünü gösterirdi */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function blankForm(invoice: InvoiceRow | null, keep?: { date: string; category: string }) {
  return {
    date: invoice?.date ?? keep?.date ?? localToday(),
    supplier: invoice?.supplier ?? "",
    description: invoice?.description ?? "",
    invoiceNo: invoice?.invoiceNo ?? "",
    category: invoice?.category ?? keep?.category ?? "Hammadde & İçecek",
    amount: invoice ? num(invoice.amount, 2, 2) : "",
    discount: invoice?.discount ? num(invoice.discount, 2, 2) : "0",
    payable: invoice ? num(invoice.payable, 2, 2) : "",
    vatRate: guessVat(invoice),
    unpaid: invoice?.unpaid ?? false,
    note: invoice?.note ?? "",
    dueDate: invoice?.dueDate ?? "",
  };
}

/** Kategorinin gelir-giderde nereye gittiği (pencere ve toplu değiştirme ipucu) */
export function categoryEffect(category: string) {
  if (GOODS_CATEGORIES.includes(category)) return "Mal maliyeti sayılır: gelir-gider tablosunda tedarikçi bazında görünür.";
  if (category === COMMISSION_CATEGORY) return "Komisyon giderlerine eklenir.";
  return "Gelir-gider tablosuna eklenmez (sabit giderlerden izlenir).";
}

export function InvoiceDialog({
  invoice,
  suppliers,
  defaults,
  onClose,
  onDelete,
  parasutCompanyId,
}: {
  invoice: InvoiceRow | null;
  suppliers: string[];
  /** Tedarikçinin son faturasından kategori ve KDV (yalnızca yeni faturada önerilir) */
  defaults: Map<string, SupplierDefault>;
  onClose: () => void;
  onDelete: (invoice: InvoiceRow) => void;
  parasutCompanyId: string | null;
}) {
  const [f, setF] = useState(() => blankForm(invoice));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  /** Kullanıcı kategoriyi / KDV oranını elle seçtiyse tedarikçi önerisi onu ezmez */
  const [touched, setTouched] = useState({ category: false, vat: false });
  /** Bu pencerede art arda eklenen fatura sayısı ("Kaydet, yenisini ekle") */
  const [added, setAdded] = useState(0);
  const supplierRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  /** Paraşüt'e bağlı: tarih, fatura no ve tutarlar Paraşüt'ten gelir, burada salt okunur */
  const locked = invoice ? isParasutLinked(invoice) : false;
  const parasutHref = invoice?.externalId && parasutCompanyId ? parasutBillUrl(parasutCompanyId, invoice.externalId) : null;

  const amount = parseNumberTR(f.amount) ?? 0;
  const discount = parseNumberTR(f.discount) ?? 0;
  const net = amount - discount;
  const payable = parseNumberTR(f.payable);
  const withVat = Math.round(net * (1 + Number(f.vatRate) / 100) * 100) / 100;
  /** Ödenecek boş bırakılırsa: net + seçili KDV (oran yanında görünür) */
  const payableToSave = payable ?? withVat;
  const bad = { amount: badNumber(f.amount), discount: badNumber(f.discount), payable: badNumber(f.payable) };
  const supplierMissing = tried && !f.supplier.trim();
  const dateMissing = tried && !f.date;
  const groupedAs = normalizeSupplier(f.supplier);
  const known = invoice ? undefined : defaults.get(supplierMatchKey(f.supplier));

  const supplierHint = [
    groupedAs && groupedAs !== f.supplier.trim() ? `Gelir-giderde “${groupedAs}” altında toplanır; parantezdeki not sayılmaz.` : null,
    known && known.category === f.category
      ? `Son faturası ${dateTR(known.date)}: ${known.category}, %${known.vatRate} KDV. Kategori ve KDV buna göre seçildi.`
      : null,
    locked ? "Eşitleme bu adı korur." : null,
  ]
    .filter(Boolean)
    .join(" ");

  /** Yeni faturada tedarikçi önerisi yoksa dönülecek değerler (pencere açılırken / "yenisini ekle"de kalanlar) */
  const [start, setStart] = useState(() => ({ category: f.category, vatRate: f.vatRate }));

  function onSupplier(value: string) {
    if (invoice) return set({ supplier: value });
    // Elle seçilmemişse kategori ve KDV tedarikçinin son faturasından; tanınmayan ada geçilince öneri geri alınır
    const d = defaults.get(supplierMatchKey(value));
    set({
      supplier: value,
      ...(touched.category ? {} : { category: d?.category ?? start.category }),
      ...(touched.vat ? {} : { vatRate: d?.vatRate ?? start.vatRate }),
    });
  }

  async function save(again: boolean) {
    setTried(true);
    if (!f.supplier.trim()) {
      supplierRef.current?.focus();
      return toast.error("Tedarikçi girin");
    }
    if (!f.date) return toast.error("Fatura tarihini seçin");
    if (!locked && (bad.amount || bad.discount || bad.payable)) return toast.error("Tutarları kontrol edin");
    setBusy(true);
    keepScroll();
    let res: Awaited<ReturnType<typeof saveInvoice>>;
    try {
      res = await saveInvoice({
        id: invoice?.id ?? null,
        date: f.date,
        supplier: f.supplier,
        description: f.description,
        invoiceNo: f.invoiceNo,
        category: f.category,
        // Paraşüt faturasında kayıtlı tutarlar aynen geri gider; sunucu da bu alanları yazmaz
        amount: locked && invoice ? invoice.amount : amount,
        discount: locked && invoice ? invoice.discount : discount,
        payable: locked && invoice ? invoice.payable : payableToSave,
        unpaid: f.unpaid,
        note: f.note,
        dueDate: f.dueDate || null,
      });
    } finally {
      setBusy(false);
    }
    if (!res.ok) return toast.error(res.error);
    const shown = locked && invoice ? invoice.payable : payableToSave;
    if (res.data.message) toast.warning("Fatura kaydedildi", { description: res.data.message, duration: 8000 });
    else toast.success(invoice ? "Fatura güncellendi" : "Fatura eklendi", { description: `${f.supplier.trim()} · ${tl(shown, 2)}` });
    if (!again) return onClose();
    // Art arda giriş: tarih ve kategori kalır, diğer alanlar boşalır, imleç tedarikçiye döner
    const next = blankForm(null, { date: f.date, category: f.category });
    setF(next);
    setStart({ category: next.category, vatRate: next.vatRate });
    setTouched({ category: false, vat: false });
    setTried(false);
    setAdded((n) => n + 1);
    requestAnimationFrame(() => supplierRef.current?.focus());
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save(false);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={invoice ? "Faturayı düzenle" : "Fatura ekle"}
      description={
        added
          ? `${added} fatura eklendi. Sıradakini girin ya da pencereyi kapatın.`
          : locked
            ? "Paraşüt'ten gelen fatura: kategori, açıklama, not, vade ve ödeme durumu burada değişir."
            : "Tutarlar faturadaki gibi: mal/hizmet tutarı, iskonto ve KDV dahil ödenecek tutar."
      }
      footerStart={
        invoice ? (
          <>
            <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => onDelete(invoice)}>
              <Trash2 size={16} /> Sil
            </Button>
            {parasutHref ? (
              <a href={parasutHref} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-ink-mute hover:text-ink hover:underline">
                Paraşüt&apos;te aç ↗
              </a>
            ) : null}
          </>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="pointer-coarse:h-10">
            {added ? "Kapat" : "Vazgeç"}
          </Button>
          {invoice ? null : (
            <Button variant="secondary" disabled={busy} onClick={() => save(true)} title="Kaydeder ve yeni fatura için formu boşaltır" className="pointer-coarse:h-10">
              {/* Telefonda üç düğme tek satıra sığsın */}
              <span className="sm:hidden">Kaydet + yeni</span>
              <span className="max-sm:hidden">Kaydet, yenisini ekle</span>
            </Button>
          )}
          <Button type="submit" form="invoice-form" disabled={busy} className="pointer-coarse:h-10">
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      {/* Enter ile kaydedilir (not alanında Ctrl/⌘ + Enter) */}
      <form
        id="invoice-form"
        onSubmit={onSubmit}
        noValidate
        className="grid gap-x-3 gap-y-4 pb-2 sm:grid-cols-2 pointer-coarse:[&_input]:h-10 pointer-coarse:[&_select]:h-10"
      >
        <Field
          label="Tedarikçi"
          htmlFor="f-sup"
          tip="Aynı tedarikçi adını kullanın; gelir-giderde birlikte toplanır. Listeden seçince son faturasındaki kategori ve KDV önerilir."
          hint={supplierHint || undefined}
          error={supplierMissing ? "Tedarikçi girin" : undefined}
        >
          <Input
            ref={supplierRef}
            id="f-sup"
            list="supplier-list"
            value={f.supplier}
            onChange={(e) => onSupplier(e.target.value)}
            aria-invalid={supplierMissing || undefined}
            autoComplete="off"
            placeholder="ör. Sütaş"
            data-autofocus={invoice ? undefined : true}
          />
          <datalist id="supplier-list">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Tarih" htmlFor="f-date" error={dateMissing ? "Tarih seçin" : undefined} hint={locked ? "Paraşüt'ten gelir" : undefined}>
          <Input id="f-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} aria-invalid={dateMissing || undefined} disabled={locked} />
        </Field>
        <Field label="Açıklama" htmlFor="f-desc">
          <Input id="f-desc" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="ör. Eylül kira, tatlı, süt" />
        </Field>
        <Field label="Fatura no" htmlFor="f-no" hint={locked ? "Paraşüt'ten gelir" : undefined}>
          <Input id="f-no" value={f.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} autoComplete="off" disabled={locked} />
        </Field>
        <Field label="Kategori" htmlFor="f-cat" className="sm:col-span-2" hint={categoryEffect(f.category)}>
          <Select
            id="f-cat"
            value={f.category}
            onChange={(e) => {
              setTouched((t) => ({ ...t, category: true }));
              set({ category: e.target.value });
            }}
          >
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>

        {locked && invoice ? (
          <LockedAmounts invoice={invoice} href={parasutHref} />
        ) : (
          <fieldset className="grid gap-x-3 gap-y-4 rounded-2xl bg-panel p-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="sr-only">Tutarlar</legend>
            <Field label="Mal / hizmet tutarı (₺)" htmlFor="f-amt" tip="KDV hariç, iskontodan önceki tutar" error={bad.amount ? "Geçerli bir sayı girin (ör. 1.250,50)" : undefined}>
              <NumberInput
                id="f-amt"
                value={f.amount}
                onChange={(e) => set({ amount: e.target.value })}
                placeholder="0,00"
                aria-invalid={bad.amount || undefined}
                className={bad.amount ? undefined : "cell-input"}
              />
            </Field>
            <Field label="İskonto (₺)" htmlFor="f-disc" error={bad.discount ? "Geçerli bir sayı girin" : undefined}>
              <NumberInput
                id="f-disc"
                value={f.discount}
                onChange={(e) => set({ discount: e.target.value })}
                onFocus={(e) => e.currentTarget.select()}
                aria-invalid={bad.discount || undefined}
                className={bad.discount ? undefined : "cell-input"}
              />
            </Field>
            <Field
              label="Ödenecek, KDV dahil (₺)"
              htmlFor="f-pay"
              className="sm:col-span-2"
              tip="Faturadaki genel toplam. Boş bırakırsanız net tutara seçili KDV eklenerek yazılır."
              error={bad.payable ? "Geçerli bir sayı girin" : undefined}
              hint={
                payable !== null
                  ? `Net ${tl(net, 2)} · KDV ${tl(payable - net, 2)}`
                  : net
                    ? `Boş kalırsa %${f.vatRate} KDV ile ${tl(withVat, 2)} yazılır (net ${tl(net, 2)}).`
                    : "Faturadaki genel toplam. Boş kalırsa net tutara seçili KDV eklenir."
              }
            >
              {/* Telefonda tutar tam satır (38.602,20 gibi değerler kesilmesin), KDV oranı ve Hesapla altında */}
              <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex">
                <NumberInput
                  id="f-pay"
                  value={f.payable}
                  onChange={(e) => set({ payable: e.target.value })}
                  placeholder={num(withVat, 2, 2)}
                  aria-invalid={bad.payable || undefined}
                  className={cn("col-span-2 min-w-0 sm:flex-1", !bad.payable && "cell-input")}
                />
                <Select
                  value={f.vatRate}
                  onChange={(e) => {
                    setTouched((t) => ({ ...t, vat: true }));
                    set({ vatRate: e.target.value });
                  }}
                  className="shrink-0 sm:w-20"
                  aria-label="KDV oranı"
                >
                  {VAT_RATES.map((v) => (
                    <option key={v} value={v}>
                      %{v}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => set({ payable: num(withVat, 2, 2) })} title="Net tutar + seçilen KDV" className="pointer-coarse:h-10">
                  Hesapla
                </Button>
              </div>
            </Field>
          </fieldset>
        )}

        <Field label="Ödeme durumu">
          <Segmented<"paid" | "unpaid">
            label="Ödeme durumu"
            stretch
            value={f.unpaid ? "unpaid" : "paid"}
            onChange={(v) => set({ unpaid: v === "unpaid" })}
            options={[
              { value: "paid", label: "Ödendi" },
              { value: "unpaid", label: "Ödenmedi" },
            ]}
          />
        </Field>
        <Field
          label="Vade (son ödeme günü)"
          htmlFor="f-due"
          hint={
            locked
              ? "Paraşüt'te vade girilmişse eşitleme onu yazar; yoksa buradaki kalır."
              : f.unpaid
                ? "Ödenmemişse Ödemeler & hatırlatıcılar'a düşer"
                : "İsteğe bağlı"
          }
        >
          <Input id="f-due" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </Field>
        <Field label="Not" className="sm:col-span-2" htmlFor="f-note" hint="Listede tedarikçinin altında görünür. “tahmin” ya da “varsayım” geçerse fatura tahmini işaretlenir.">
          <Textarea
            id="f-note"
            value={f.note}
            onChange={(e) => set({ note: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save(false);
              }
            }}
            rows={2}
            className="[field-sizing:content] max-h-40"
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** Paraşüt faturasının tutarları: salt okunur özet + nerede düzeltileceği */
function LockedAmounts({ invoice, href }: { invoice: InvoiceRow; href: string | null }) {
  const net = invoice.amount - invoice.discount;
  const rows: [string, string][] = [
    ["Mal / hizmet tutarı", tl(invoice.amount, 2)],
    ["İskonto", tl(invoice.discount, 2)],
    ["Net (KDV hariç)", tl(net, 2)],
    ["KDV", tl(invoice.payable - net, 2)],
    ["Ödenecek, KDV dahil", tl(invoice.payable, 2)],
  ];
  return (
    <div className="rounded-2xl bg-panel p-4 sm:col-span-2">
      <p className="flex items-start gap-2 text-[13px] text-ink-soft">
        <Lock size={14} className="mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
        <span>
          Tutar, tarih ve fatura no Paraşüt&apos;ten gelir; burada değiştirilse sonraki eşitlemede geri dönerdi. Değiştirmek için Paraşüt&apos;te düzeltin
          {href ? (
            <>
              {" "}
              (
              <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline-offset-2 hover:underline">
                Paraşüt&apos;te aç ↗
              </a>
              )
            </>
          ) : null}
          .
        </span>
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map(([k, v], idx) => (
          <div key={k} className={cn("min-w-0", idx === rows.length - 1 && "font-semibold")}>
            <dt className="text-xs text-ink-mute">{k}</dt>
            <dd className="tabular text-ink">{v}</dd>
          </div>
        ))}
        {invoice.unpaid && invoice.outstanding && invoice.outstanding > 0 && invoice.outstanding < invoice.payable - 0.005 ? (
          <div className="min-w-0">
            <dt className="text-xs text-ink-mute">Kalan borç</dt>
            <dd className="tabular text-warn">{tl(invoice.outstanding, 2)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
