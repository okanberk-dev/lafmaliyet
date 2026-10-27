"use client";

import { FileText, Lock, Paperclip, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PhotoThumb } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { toastUnreachable } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { keepScroll } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { BIG_FIELDS, SHEET_BTN } from "@/components/ui/mobile-filters";
import { Segmented } from "@/components/ui/segmented";
import { useIsPhone } from "@/components/ui/use-media";
import { normalizeSupplier } from "@/lib/calc/engine";
import type { InvoiceCariLinks } from "@/lib/cari/account";
import { isPartiallyPaid, METHOD_LABEL, openBalance } from "@/lib/cari/balance";
import { parseNumberTR } from "@/lib/calc/expr";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { stockOnlyCategory, stockOnlyText } from "@/lib/invoice-linking";
import { formatBytes } from "@/lib/documents";
import { dateTR, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { confirmInvoices, saveInvoice } from "@/server/actions/invoices";
import type { DocumentMeta } from "@/server/documents";

import { canHaveDocument, documentKind, documentSummary, isParasutDocument, uploadPlan } from "./document-rules";
import { DocumentPicker, UploadStatus, useDocumentUpload } from "./document-sheet";
import { prepareDocument, uploadDocument, type UploadResult } from "./document-upload";
import { InvoiceLines } from "./invoice-lines";
import { guessVat, isEInvoiceOnly, isParasutLinked, parasutBillUrl, supplierMatchKey, VAT_RATES, type InvoiceRow, type SupplierDefault } from "./rules";

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
    /** Ödeme günü (ödendi faturada); boşsa yeni faturada fatura günü, ödenmemişten geçerken bugün yazılır */
    paidAt: invoice?.paidAt ?? "",
  };
}

/**
 * Kategorinin gelir-giderde nereye gittiği (pencere ve toplu değiştirme ipucu). `links`: fatura kategorisi → bağlı
 * Aylık harcamalar kategorisinin adı; bağlı kategorinin faturaları orada gelir-gidere girer. Liste verilmediyse
 * iki olasılık da söylenir (yanlışlıkla "eklenmez" deyip giderin elle ikinci kez girilmesine yol açmasın).
 */
export function categoryEffect(category: string, links?: Record<string, string>) {
  if (GOODS_CATEGORIES.includes(category)) return "Mal maliyeti sayılır: gelir-gider tablosunda tedarikçi bazında görünür.";
  if (category === COMMISSION_CATEGORY) return "Komisyon giderlerine eklenir.";
  if (SEPARATE_CATEGORIES.includes(category)) return `Kafe dışı (${category}): kafenin fatura toplamına, gelir-giderine ve mal maliyetine girmez.`;
  const linked = links?.[category];
  if (linked) return `Gelir-giderde Aylık harcamalar'daki “${linked}” kategorisinde sayılır (KDV hariç); tutarı orada ayrıca girmeyin.`;
  if (!links) return "Aylık harcamalar'da bir kategoriye bağlıysa gelir-giderde orada sayılır; değilse gelir-gider tablosuna eklenmez (sabit giderlerden izlenir).";
  return "Gelir-gider tablosuna eklenmez (sabit giderlerden izlenir).";
}

export function InvoiceDialog({
  invoice,
  suppliers,
  defaults,
  onClose,
  onDelete,
  parasutCompanyId,
  documents = [],
  onOpenDocuments,
  expenseLinks,
  supplierHref,
  cari,
}: {
  invoice: InvoiceRow | null;
  suppliers: string[];
  /** Tedarikçinin son faturasından kategori ve KDV (yalnızca yeni faturada önerilir) */
  defaults: Map<string, SupplierDefault>;
  onClose: () => void;
  onDelete: (invoice: InvoiceRow) => void;
  parasutCompanyId: string | null;
  /** Faturanın saklanan belgeleri (yeni faturada boş) */
  documents?: DocumentMeta[];
  /** Belge sayfasını açar (kayıtlı faturada) */
  onOpenDocuments?: () => void;
  /** Fatura kategorisi → bağlı Aylık harcamalar kategorisinin adı (kategori ipucu için; bkz. categoryEffect) */
  expenseLinks?: Record<string, string>;
  /**
   * Tedarikçinin Tedarikçiler'deki sayfası (cari bilgileri ve ödeme takibi); kayıtlı faturada bağlantı olur. Adla ve
   * vergi noyla bulunur: aynı vergi noyla başka adla gelen fatura da birleşik tedarikçiye gider
   */
  supplierHref?: (invoice: { supplier: string; supplierTaxNumber?: string | null }) => string | null;
  /** Bu faturaya sayılan cari ödemeler ve bağlı faturasız alımlar (salt okunur; Tedarikçiler'de değişir) */
  cari?: InvoiceCariLinks;
}) {
  const [f, setF] = useState(() => blankForm(invoice));
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const router = useRouter();
  // Belge: kayıtlı faturada hemen yüklenir; yeni faturada seçilen dosya hazırlanıp kayıttan sonra yüklenir
  const up = useDocumentUpload();
  const [attachment, setAttachment] = useState<File | null>(null);
  const [addedDocs, setAddedDocs] = useState<DocumentMeta[]>([]);
  const docs = useMemo(() => [...addedDocs.filter((d) => !documents.some((x) => x.id === d.id)), ...documents], [addedDocs, documents]);
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

  const cariHref = invoice && supplierHref ? supplierHref(invoice) : null;
  // Paraşüt'ten gelen tedarikçi vergi nosu (kontrol hanesi tutmasa da görünür; eşleşmede kullanılmaz)
  const taxNo = invoice?.supplierTaxNumber ?? null;
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

  // Telefonda açıklama ve fatura no formun sonunda (az kullanılır); masaüstünde tarihin yanında
  const phone = useIsPhone();
  const descAndNo = (
    <>
      <Field label="Açıklama" htmlFor="f-desc">
        <Input id="f-desc" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="ör. Eylül kira, tatlı, süt" />
      </Field>
      <Field label="Fatura no" htmlFor="f-no" hint={locked ? "Paraşüt'ten gelir" : undefined}>
        <Input id="f-no" value={f.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} autoComplete="off" disabled={locked} />
      </Field>
    </>
  );

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

  /** Kategorisi bilerek mal alışı olmayan, kalemi hammaddeye bağlı fatura (E-07): "Kalsın" ancak böyleyse */
  const canKeep = Boolean(invoice?.stockOnly && invoice.needsReview && stockOnlyCategory(f.category));

  /**
   * "Kalsın" (E-07): kategori bilerek mal alışı değil; fatura onaylanır ve yeniden kontrole düşmez, hammaddeye bağlı
   * kalemleri stoğa girmeye devam eder. Geri al yeniden kontrol bekleyene döndürür (karar da düşer)
   */
  async function keepCategory(id: number, category: string) {
    const r = await confirmInvoices([id], false, { acceptStockOnly: true });
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Fatura kaydedildi · ${category} kaldı`, {
      description: "Hammaddeye bağlı kalemleri stoğa girmeye devam eder; gelir-gidere mal alışı olarak girmez.",
      action: {
        label: "Geri al",
        onClick: () => void confirmInvoices([id], true).then((b) => (b.ok ? toast.success("Yeniden kontrol bekliyor") : toast.error(b.error))),
      },
      duration: 8000,
    });
  }

  /** `keep`: "Kalsın" düğmesi; kaydeder, fatura hâlâ mal alışı sayılmıyorsa bilerek böyle bırakıldığını kaydeder */
  async function save(again: boolean, keep = false) {
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
    let uploaded: UploadResult | null = null;
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
        // Boş ödeme günü: yeni faturada fatura günü (ileri tarihli faturada bugün); kayıtlı faturada bilinmiyor (ödendiye
        // geçerken pencere bugünü yazar)
        paidAt: f.unpaid ? null : f.paidAt || (invoice ? null : f.date > localToday() ? localToday() : f.date),
      });
      if (res.ok && !invoice && attachment) {
        setBusyText("Belge yükleniyor…");
        uploaded = await uploadDocument(res.data.id, attachment);
      }
    } catch (e) {
      toastUnreachable(e);
      return;
    } finally {
      setBusy(false);
      setBusyText(null);
    }
    if (!res.ok) return toast.error(res.error);
    const shown = locked && invoice ? invoice.payable : payableToSave;
    const withDoc = uploaded?.ok ? " · belge eklendi" : "";
    // Ödendi yapılan fatura önce tedarikçinin hesabındaki cari ödemesini kullanır (K6): ne kadarı sayıldı söylenir
    const used = res.data.credit?.used ?? 0;
    const withCredit = used > 0.005 ? ` · hesaptaki ${tl(used, 2)} sayıldı` : "";
    const savedId = invoice?.id ?? null;
    if (res.data.message) toast.warning("Fatura kaydedildi", { description: res.data.message, duration: 8000 });
    else if (res.data.stockOnly && keep && savedId !== null) await keepCategory(savedId, f.category);
    else if (res.data.stockOnly) {
      const category = f.category;
      toast.warning("Fatura kaydedildi, kontrolde kaldı", {
        description: `${stockOnlyText(category, expenseLinks)} Bilerek “${category}” kalacaksa Kalsın'a dokunun.`,
        duration: 12_000,
        ...(savedId !== null ? { action: { label: "Kalsın", onClick: () => void keepCategory(savedId, category) } } : {}),
      });
    } else toast.success(invoice ? "Fatura güncellendi" : "Fatura eklendi", { description: `${f.supplier.trim()} · ${tl(shown, 2)}${withCredit}${withDoc}` });
    if (uploaded) {
      // Kayıt eylemi listeyi yeniledi ama belge ondan sonra eklendi: satırın belge simgesi için bir kez daha
      keepScroll();
      startTransition(() => router.refresh());
      if (!uploaded.ok) toast.error("Belge yüklenemedi", { description: `${uploaded.error} Fatura kaydedildi; listeden açıp belgeyi yeniden ekleyin.`, duration: 10000 });
    }
    setAttachment(null);
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
    // Telefonda alttan açılan tam boy sayfa: tek sütun, 48px alanlar, Kaydet başparmağın altında
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
            <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad max-sm:min-h-12 max-sm:px-3" onClick={() => onDelete(invoice)}>
              <Trash2 size={16} /> Sil
            </Button>
            {parasutHref ? (
              <a
                href={parasutHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm font-medium text-ink-mute hover:text-ink hover:underline max-sm:min-h-12 max-sm:px-1"
              >
                Paraşüt&apos;te aç ↗
              </a>
            ) : null}
          </>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={cn(SHEET_BTN, !invoice && "max-sm:flex-none! max-sm:px-3")}>
            {added ? "Kapat" : "Vazgeç"}
          </Button>
          {canKeep ? (
            <Button
              variant="secondary"
              disabled={busy || up.busy}
              onClick={() => save(false, true)}
              title={`Kategori bilerek “${f.category}”: kaydeder ve onaylar; hammaddeye bağlı kalemleri stoğa girmeye devam eder, gelir-gidere mal alışı olarak girmez`}
              className={SHEET_BTN}
            >
              Kalsın
            </Button>
          ) : null}
          {invoice ? null : (
            <Button
              variant="secondary"
              disabled={busy || up.busy}
              onClick={() => save(true)}
              title="Kaydeder ve yeni fatura için formu boşaltır"
              className="max-sm:min-h-12 max-sm:px-3 max-sm:text-sm"
            >
              {/* Telefonda üç düğme tek satıra sığsın */}
              <span className="sm:hidden">Kaydet + yeni</span>
              <span className="max-sm:hidden">Kaydet, yenisini ekle</span>
            </Button>
          )}
          <Button type="submit" form="invoice-form" disabled={busy || up.busy} className={SHEET_BTN}>
            {busy ? (busyText ?? "Kaydediliyor…") : "Kaydet"}
          </Button>
        </>
      }
    >
      {/* Enter ile kaydedilir (not alanında Ctrl/⌘ + Enter) */}
      {/* Telefonda tek sütun ve 48px alanlar; sıra: tedarikçi, tarih, kategori, tutarlar, ödeme, vade, sonra açıklama
          ve fatura no. Sıra CSS ile değil DOM'da değişir: klavyenin "sonraki" oku ekrandaki sırayı izler. */}
      <form
        id="invoice-form"
        onSubmit={onSubmit}
        noValidate
        className={cn("grid gap-x-3 gap-y-4 pb-2 sm:grid-cols-2", BIG_FIELDS)}
      >
        <Field
          label="Tedarikçi"
          htmlFor="f-sup"
          tip="Aynı tedarikçi adını kullanın; gelir-giderde birlikte toplanır. Listeden seçince son faturasındaki kategori ve KDV önerilir."
          hint={
            supplierHint || cariHref || taxNo ? (
              <>
                {supplierHint}
                {taxNo ? (
                  <>
                    {supplierHint ? " " : null}
                    <span className="tabular">Vergi no {taxNo}</span>
                    {cariHref ? " · " : null}
                  </>
                ) : null}
                {cariHref ? (
                  <>
                    {supplierHint && !taxNo ? " " : null}
                    {/* Önce pencere kapanır: gizlenen Faturalar sayfasında açık kalan pencere yeni sayfayı kilitlerdi */}
                    <Link href={cariHref} onClick={onClose} className="font-medium text-info underline-offset-2 hover:underline">
                      Tedarikçinin sayfası →
                    </Link>
                  </>
                ) : null}
              </>
            ) : undefined
          }
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
            enterKeyHint="next"
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
        {phone ? null : descAndNo}
        <Field
          label={
            invoice?.needsReview ? (
              <span className="inline-flex items-center gap-1.5">
                Kategori
                <Badge tone="amber" dot>
                  Kontrol
                </Badge>
              </span>
            ) : (
              "Kategori"
            )
          }
          htmlFor="f-cat"
          className="sm:col-span-2"
          hint={
            invoice?.stockOnly && stockOnlyCategory(f.category) ? (
              // Kalemi hammaddeye bağlı, kategorisi mal alışı değil (E-07): kaydetmek onaylamaz, "Kalsın" onaylar. Kategori
              // bir Aylık harcamalar giderine bağlıysa gelir-giderdeki yeri de söylenir
              <>
                <span className="text-warn">
                  {stockOnlyText(f.category, expenseLinks)}
                  {invoice.needsReview ? " Bilerek böyleyse Kalsın'a dokunun." : ""}
                </span>
                {expenseLinks?.[f.category] ? ` ${categoryEffect(f.category, expenseLinks)}` : null}
              </>
            ) : (
              `${invoice?.needsReview ? "Eşitlemede tahminle yazıldı; kaydedince onaylanır. " : ""}${categoryEffect(f.category, expenseLinks)}`
            )
          }
        >
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

        <DocumentField
          invoice={invoice}
          docs={docs}
          attachment={attachment}
          phase={up.phase}
          busy={up.busy || busy}
          onOpen={onOpenDocuments}
          onRemove={() => {
            setAttachment(null);
            up.setPhase({ kind: "idle" });
          }}
          onPick={async (file) => {
            if (invoice) {
              const doc = await up.upload(invoice.id, file);
              if (!doc) return;
              setAddedDocs((a) => [doc, ...a]);
              toast.success("Belge eklendi", { description: `${documentKind(doc.mime) === "pdf" ? "PDF" : "Fotoğraf"} · ${formatBytes(doc.size)}` });
              keepScroll();
              startTransition(() => router.refresh());
              return;
            }
            up.setPhase(uploadPlan(file).action === "compress" ? { kind: "preparing" } : { kind: "idle" });
            const prepared = await prepareDocument(file);
            if (!prepared.ok) return up.setPhase({ kind: "error", message: prepared.error });
            up.setPhase({ kind: "idle" });
            setAttachment(prepared.file);
          }}
        />

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
                  title="KDV oranı"
                >
                  {VAT_RATES.map((v) => (
                    <option key={v} value={v}>
                      %{v}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => set({ payable: num(withVat, 2, 2) })} title="Net tutar + seçilen KDV" className="max-sm:min-h-12">
                  Hesapla
                </Button>
              </div>
            </Field>
          </fieldset>
        )}

        {invoice && (invoice.eInvoiceId || invoice.externalId) ? <InvoiceLines invoiceId={invoice.id} invoiceNet={invoice.amount - invoice.discount} category={invoice.category} /> : null}

        {cari && (cari.payments.length || cari.debts.length) ? <InvoiceCari cari={cari} href={cariHref} /> : null}

        <Field label="Ödeme durumu">
          <Segmented<"paid" | "unpaid">
            label="Ödeme durumu"
            stretch
            className="max-sm:[&_button]:h-11"
            value={f.unpaid ? "unpaid" : "paid"}
            onChange={(v) => set(v === "unpaid" ? { unpaid: true } : { unpaid: false, paidAt: f.paidAt || (invoice?.unpaid ? localToday() : "") })}
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
        {f.unpaid ? null : (
          <Field label="Ödeme günü" htmlFor="f-paid" hint={invoice ? (f.paidAt ? undefined : "Bilinmiyorsa boş bırakın") : "Boş kalırsa fatura günü yazılır"}>
            <Input id="f-paid" type="date" value={f.paidAt} max={localToday()} onChange={(e) => set({ paidAt: e.target.value })} />
          </Field>
        )}
        {phone ? descAndNo : null}
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
            className="max-h-40 [field-sizing:content]"
          />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Formdaki "Belge" alanı. Belgesi olan (Paraşüt e-fatura PDF'i ya da yüklenmiş dosya) kayıtlı faturada "Belgeyi
 * aç"; belgesi yoksa (elle ya da Excel'le girilmiş) kâğıt faturanın fotoğrafı buradan hemen eklenir. Yeni faturada
 * seçilen dosya hazırlanır (fotoğraf küçültülür) ve "Kaydet"ten sonra yüklenir.
 */
function DocumentField({
  invoice,
  docs,
  attachment,
  phase,
  busy,
  onOpen,
  onPick,
  onRemove,
}: {
  invoice: InvoiceRow | null;
  docs: DocumentMeta[];
  attachment: File | null;
  phase: Parameters<typeof UploadStatus>[0]["phase"];
  busy: boolean;
  onOpen?: () => void;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const has = invoice ? canHaveDocument(invoice, docs.length) : false;
  const summary = invoice ? documentSummary(invoice, docs) : null;
  const title = attachment ? attachment.name : summary ? summary.title : "Belge yok";
  const hint = attachment
    ? `${formatBytes(attachment.size)} · kaydedince yüklenir`
    : summary
      ? summary.hint
      : "Kâğıt faturanın fotoğrafını çekin ya da PDF'ini ekleyin; kaydedince yüklenir.";
  return (
    <Field label="Belge" className="sm:col-span-2">
      <div className="rounded-2xl bg-panel p-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink" aria-hidden="true">
            {invoice && isParasutDocument(invoice) ? <FileText size={16} /> : <Paperclip size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{title}</p>
            <p className="text-xs text-pretty text-ink-mute">{hint}</p>
          </div>
          {has && onOpen ? (
            <Button variant="secondary" onClick={onOpen} aria-haspopup="dialog" className="text-ink max-sm:min-h-11">
              Belgeyi aç
            </Button>
          ) : null}
          {attachment ? (
            <IconButton label="Belgeyi çıkar" onClick={onRemove} disabled={busy}>
              <X size={15} />
            </IconButton>
          ) : null}
        </div>
        {!has && !attachment ? <DocumentPicker className="mt-3" onPick={onPick} disabled={busy} /> : null}
        <UploadStatus phase={phase} className="mt-2" />
      </div>
    </Field>
  );
}

/** Paraşüt faturasının tutarları: salt okunur özet + nerede düzeltileceği */
/**
 * Faturanın cari bağları (§6.4; salt okunur): sayılan ödemeler (gün, şekil, tutar) ve bağlı faturasız alımlar,
 * fotoğraflarıyla (irsaliye ya da el fişi). Değiştirmek için tedarikçinin Hesap hareketleri.
 */
function InvoiceCari({ cari, href }: { cari: InvoiceCariLinks; href: string | null }) {
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  return (
    <section className="space-y-3 rounded-2xl bg-panel p-4 text-sm sm:col-span-2" aria-label="Cari bağları">
      {cari.payments.length ? (
        <div>
          <p className="text-[13px] font-medium text-ink-soft">Bu faturaya sayılan ödemeler</p>
          <ul className="mt-1 space-y-0.5 text-ink tabular">
            {cari.payments.map((p, i) => (
              <li key={i}>
                {dateTR(p.date).slice(0, 5)} · {METHOD_LABEL[p.method]} · {tl(p.amount, 2)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {cari.debts.length ? (
        <div>
          <p className="text-[13px] font-medium text-ink-soft">Bağlı faturasız alımlar</p>
          <ul className="mt-1 space-y-2">
            {cari.debts.map((d) => {
              const caption = `İrsaliye fotoğrafı · ${dateTR(d.date).slice(0, 5)} · ${d.description?.trim() || "alım"}`;
              return (
                <li key={d.id} className="space-y-1.5">
                  <p className="text-ink tabular">
                    {dateTR(d.date).slice(0, 5)} · {d.description?.trim() || "alım"} · {tl(d.amount, 2)}
                  </p>
                  {d.photoId ? <PhotoThumb id={d.photoId} caption={caption} size="sm" onOpen={() => setViewer({ id: d.photoId!, caption })} /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-ink-mute">
        Değiştirmek için tedarikçinin{" "}
        {href ? (
          <Link href={`${href}?sekme=hareketler`} className="font-medium text-info underline-offset-2 hover:underline">
            Hesap hareketlerini açın
          </Link>
        ) : (
          "Hesap hareketlerini açın"
        )}
        .
      </p>
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </section>
  );
}

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
        {isEInvoiceOnly(invoice) ? (
          <span>
            Tutar, tarih ve fatura no Paraşüt&apos;e gelen e-faturadan alınır; burada değiştirilse sonraki eşitlemede geri dönerdi. E-faturanın PDF&apos;i yukarıdaki “Belge”den açılır.
          </span>
        ) : (
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
        )}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map(([k, v], idx) => (
          <div key={k} className={cn("min-w-0", idx === rows.length - 1 && "font-semibold")}>
            <dt className="text-xs text-ink-mute">{k}</dt>
            <dd className="tabular text-ink">{v}</dd>
          </div>
        ))}
        {isPartiallyPaid(invoice) ? (
          <div className="min-w-0">
            <dt className="text-xs text-ink-mute">Kalan borç</dt>
            <dd className="tabular text-warn">{tl(openBalance(invoice), 2)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
