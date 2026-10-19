"use client";

import { Check, FileText, Pencil, Plus, Trash2, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, SearchInput, Select, Textarea } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { normalizeSupplier } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Invoice } from "@/lib/calc/types";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { deleteInvoice, saveInvoice, setInvoicePaid } from "@/server/actions/invoices";

/**
 * Sunucu sayfasının özet rakamları için AkmanOS sayacı (charts/animated-number).
 * Biçim işlevi sunucudan istemciye geçemediği için adıyla verilir.
 */
export function CountUp({ value, format = "num" }: { value: number; format?: "num" | "tl" }) {
  return <AnimatedNumber value={value} format={format === "tl" ? (v) => tl(v) : (v) => num(v)} className="tabular" />;
}

/** Kategori rozeti, faturanın gelir-gider tablosunda nereye gittiğini söyler */
function categoryTone(category: string): Tone {
  if (GOODS_CATEGORIES.includes(category)) return "green";
  if (category === COMMISSION_CATEGORY) return "blue";
  return "gray";
}

/** "Mal alımları" hızlı filtresi: mal maliyeti sayılan üç kategori */
const GOODS_FILTER = "__mal";
const PAGE_SIZE = 25;

/**
 * Tedarikçi adını gelir-giderdeki gruplamayla aynı biçimde böler:
 * "Kaldi (ödenmedi)" -> { base: "Kaldi", note: "ödenmedi" }
 */
function splitSupplier(supplier: string) {
  const base = normalizeSupplier(supplier);
  if (!base) return { base: supplier, note: "" };
  const note = supplier
    .trim()
    .slice(base.length)
    .trim()
    .replace(/^\(\s*/, "")
    .replace(/\s*\)$/, "");
  return { base, note };
}

type Status = "all" | "unpaid" | "paid";
type SortKey = "date" | "supplier" | "net" | "payable";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const netOf = (i: Invoice) => i.amount - i.discount;

const COMPARE: Record<SortKey, (a: Invoice, b: Invoice) => number> = {
  date: (a, b) => a.date.localeCompare(b.date),
  supplier: (a, b) => splitSupplier(a.supplier).base.localeCompare(splitSupplier(b.supplier).base, "tr"),
  net: (a, b) => netOf(a) - netOf(b),
  payable: (a, b) => a.payable - b.payable,
};

export function InvoicesClient({
  invoices,
  months,
  suppliers,
  initialUnpaid,
  parasutCompanyId,
}: {
  invoices: Invoice[];
  /** Paraşüt firma numarası; varsa Paraşüt'ten gelen faturada "Paraşüt'te aç" bağlantısı çıkar */
  parasutCompanyId?: string | null;
  months: string[];
  suppliers: string[];
  initialUnpaid: boolean;
}) {
  const reduce = useCalmMotion();
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<Status>(initialUnpaid ? "unpaid" : "all");
  // Varsayılan sıra sunucudaki gibi: yeniden eskiye (aynı günde son eklenen üstte)
  const [sort, setSort] = useState<Sort>({ key: "date", dir: "desc" });
  const [editing, setEditing] = useState<Invoice | "new" | null>(null);
  const [deleting, setDeleting] = useState<Invoice | null>(null);
  const [removing, setRemoving] = useState(false);
  const [paying, setPaying] = useState<number | null>(null);
  /** Az önce ödendi işaretlenen fatura: yeni "Ödendi" rozeti yaylı belirir */
  const [popId, setPopId] = useState<number | null>(null);

  // Durum dışındaki filtreler: Segmented sayaçları bunlara göre
  const filtered = invoices.filter(
    (i) =>
      (!month || i.date.startsWith(month)) &&
      (!category || (category === GOODS_FILTER ? GOODS_CATEGORIES.includes(i.category) : i.category === category)) &&
      matchesSearch(`${i.supplier} ${i.description ?? ""} ${i.invoiceNo ?? ""} ${i.note ?? ""}`, q),
  );
  const filteredUnpaid = filtered.filter((i) => i.unpaid).length;
  const byStatus = status === "unpaid" ? filtered.filter((i) => i.unpaid) : status === "paid" ? filtered.filter((i) => !i.unpaid) : filtered;
  // Sıralama kararlı: eşit değerlerde sunucunun tarih sırası korunur
  const visible = [...byStatus].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * COMPARE[sort.key](a, b));
  const sum = (f: (i: Invoice) => number) => visible.reduce((a, i) => a + f(i), 0);
  const viewKey = `${month}|${category}|${status}|${sort.key}|${sort.dir}`;
  const paged = usePaged(visible, PAGE_SIZE, `${q}|${viewKey}`);
  const anyFilter = Boolean(q || month || category || status !== "all");
  const visibleUnpaid = visible.filter((i) => i.unpaid).length;
  const totalDiscount = sum((i) => i.discount);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "supplier" ? "asc" : "desc" }));
  const dirOf = (key: SortKey) => (sort.key === key ? sort.dir : null);

  const clearFilters = () => {
    setQ("");
    setMonth("");
    setCategory("");
    setStatus("all");
  };

  async function markPaid(i: Invoice) {
    setPaying(i.id);
    setPopId(i.id);
    let res: Awaited<ReturnType<typeof setInvoicePaid>>;
    try {
      res = await setInvoicePaid(i.id, true);
    } finally {
      setPaying(null);
    }
    if (res.ok) toast.success("Ödendi olarak işaretlendi");
    else {
      setPopId(null);
      toast.error(res.error);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setRemoving(true);
    let res: Awaited<ReturnType<typeof deleteInvoice>>;
    try {
      res = await deleteInvoice(deleting.id);
    } finally {
      setRemoving(false);
    }
    if (!res.ok) return toast.error(res.error);
    toast.success("Fatura silindi");
    // Düzenleme penceresinden silindiyse o da kapansın
    if (editing && editing !== "new" && editing.id === deleting.id) setEditing(null);
    setDeleting(null);
  }

  return (
    <Card>
      <CardHeader
        icon={<FileText />}
        title="Fatura listesi"
        description="Satıra tıklayınca düzenlenir."
        meta={
          <>
            <span>
              <AnimatedNumber value={visible.length} format={(v) => num(v)} className="font-semibold text-ink tabular" /> fatura
            </span>
            {visibleUnpaid ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-warn">
                  <AnimatedNumber value={visibleUnpaid} format={(v) => num(v)} className="font-semibold tabular" /> ödenmemiş
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus size={16} /> Fatura ekle
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tedarikçi, açıklama, fatura no ara…"
          aria-label="Fatura ara"
          wrapperClassName="min-w-0 flex-1 basis-64"
        />
        <Segmented<Status>
          label="Ödeme durumu"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Tümü", count: filtered.length },
            { value: "unpaid", label: "Ödenmemiş", count: filteredUnpaid },
            { value: "paid", label: "Ödendi", count: filtered.length - filteredUnpaid },
          ]}
        />
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto min-w-0 flex-1 basis-40 sm:min-w-44 sm:flex-none sm:basis-auto" aria-label="Kategori">
            <option value="">Tüm kategoriler</option>
            <option value={GOODS_FILTER}>Mal alımları (mal maliyeti)</option>
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto min-w-0 flex-1 basis-36 sm:min-w-36 sm:flex-none sm:basis-auto" aria-label="Ay">
            <option value="">Tüm aylar</option>
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
          {anyFilter ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X size={15} /> Temizle
            </Button>
          ) : null}
        </div>
      </div>

      {visible.length ? (
        <>
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      <SortButton dir={dirOf("supplier")} onClick={() => toggleSort("supplier")}>
                        Tedarikçi
                      </SortButton>
                      <InfoTip text="Adın sonundaki parantezli not ayrı tedarikçi sayılmaz: “Kaldi (ödenmedi)” gelir-giderde “Kaldi” altında toplanır. “tahmini” notu turuncu işaretlenir." />
                    </span>
                  </TH>
                  <TH>
                    <SortButton dir={dirOf("date")} onClick={() => toggleSort("date")}>
                      Tarih
                    </SortButton>
                  </TH>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      Kategori
                      <InfoTip text="Yeşil: mal maliyeti, gelir-giderde tedarikçi bazında. Mavi: komisyon giderleri. Gri: gelir-gider tablosuna girmez, sabit giderlerden izlenir." />
                    </span>
                  </TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1.5">
                      <SortButton numeric dir={dirOf("net")} onClick={() => toggleSort("net")}>
                        Net (KDV hariç)
                      </SortButton>
                      <InfoTip text="Mal/hizmet tutarı − iskonto. KDV'yi indirebildiğiniz için gerçek maliyetiniz budur. İskonto varsa altında tutar ve iskonto yazar." />
                    </span>
                  </TH>
                  <TH numeric>
                    <SortButton numeric dir={dirOf("payable")} onClick={() => toggleSort("payable")}>
                      Ödenecek (KDV dahil)
                    </SortButton>
                  </TH>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      Durum
                      <InfoTip text="“Ödenmedi” rozetine tıklayınca fatura ödendi olarak işaretlenir." />
                    </span>
                  </TH>
                  <TH className="w-px">
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              <motion.tbody
                key={`${viewKey}|${paged.page}`}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.22, ease: EASE_OUT }}
              >
                {paged.slice.map((i) => {
                  const { base, note } = splitSupplier(i.supplier);
                  const net = netOf(i);
                  const second = [i.description, i.invoiceNo ? `No ${i.invoiceNo}` : null].filter(Boolean).join(" · ");
                  const estimate = /tahmin/i.test(note);
                  return (
                    <TR key={i.id} className="cursor-pointer" onClick={() => setEditing(i)}>
                      <TD className="min-w-60">
                        <div className="flex items-center gap-3">
                          <Avatar name={base} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-ink">{base}</span>
                              {i.source === "parasut" ? (
                                <Badge tone="blue" title="Paraşüt'ten otomatik alındı">
                                  Paraşüt
                                </Badge>
                              ) : null}
                              {note ? (
                                <Badge
                                  tone={estimate ? "amber" : "gray"}
                                  dot={estimate}
                                  title={`Tedarikçi adındaki not. Gelir-giderde “${base}” altında toplanır.`}
                                >
                                  {note}
                                </Badge>
                              ) : null}
                            </div>
                            {second ? <p className="mt-0.5 text-[13px] text-ink-mute">{second}</p> : null}
                          </div>
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-ink-soft tabular">
                        {dateTR(i.date)}
                        {i.unpaid && i.dueDate ? <span className="block text-xs text-ink-mute">Vade {dateTR(i.dueDate)}</span> : null}
                      </TD>
                      <TD>
                        <Badge tone={categoryTone(i.category)}>{i.category}</Badge>
                      </TD>
                      <TD numeric>
                        <span className="font-semibold">{tl(net, 2)}</span>
                        {i.discount ? (
                          <span className="block text-xs text-ink-mute">
                            {tl(i.amount, 2)} − {tl(i.discount, 2)} iskonto
                          </span>
                        ) : null}
                      </TD>
                      <TD numeric>
                        {tl(i.payable, 2)}
                        <span className="block text-xs text-ink-mute">KDV {tl(i.payable - net, 2)}</span>
                      </TD>
                      <TD onClick={(e) => e.stopPropagation()} className="cursor-default">
                        {i.unpaid ? (
                          <motion.button
                            type="button"
                            disabled={paying === i.id}
                            onClick={() => markPaid(i)}
                            whileTap={reduce ? undefined : { scale: 0.94 }}
                            transition={SPRING_PRESS}
                            title="Ödendi olarak işaretle"
                            aria-label={`${i.supplier}: ödenmedi. Ödendi olarak işaretle`}
                            className="group/pay -my-1 inline-flex min-h-8 cursor-pointer items-center rounded-full pointer-coarse:min-h-9 disabled:cursor-wait disabled:opacity-60"
                          >
                            <Badge tone="red" dot className="transition-shadow group-hover/pay:ring-1 group-hover/pay:ring-bad/30">
                              {paying === i.id ? "İşaretleniyor…" : "Ödenmedi"}
                            </Badge>
                          </motion.button>
                        ) : (
                          <motion.span
                            className="inline-flex"
                            initial={popId === i.id && !reduce ? { opacity: 0, scale: 0.8 } : false}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={SPRING_SWAP}
                            onAnimationComplete={() => setPopId((id) => (id === i.id ? null : id))}
                          >
                            <Badge tone="green" dot>
                              Ödendi
                            </Badge>
                          </motion.span>
                        )}
                      </TD>
                      <TD onClick={(e) => e.stopPropagation()} className="cursor-default">
                        <div className="flex justify-end gap-1.5">
                          {i.unpaid ? (
                            <IconButton label="Ödendi olarak işaretle" disabled={paying === i.id} onClick={() => markPaid(i)}>
                              <Check size={15} />
                            </IconButton>
                          ) : null}
                          <IconButton label="Düzenle" onClick={() => setEditing(i)}>
                            <Pencil size={15} />
                          </IconButton>
                          <IconButton label="Sil" tone="danger" onClick={() => setDeleting(i)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </motion.tbody>
              <tfoot>
                <TFootRow>
                  <TD colSpan={3}>{num(visible.length)} fatura</TD>
                  <TD numeric>
                    {tl(sum(netOf))}
                    {totalDiscount ? (
                      <span className="block text-xs font-normal text-ink-mute">
                        {tl(sum((i) => i.amount))} − {tl(totalDiscount)} iskonto
                      </span>
                    ) : null}
                  </TD>
                  <TD numeric>
                    {tl(sum((i) => i.payable))}
                    <span className="block text-xs font-normal text-ink-mute">KDV {tl(sum((i) => i.payable - i.amount + i.discount))}</span>
                  </TD>
                  <TD colSpan={2} />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={paged.setPage}
            total={paged.pageCount > 1 ? paged.total : undefined}
            unit="fatura"
            className="border-t border-line"
          />
        </>
      ) : (
        <div className="border-t border-line">
          <EmptyState
            title="Fatura bulunamadı"
            description="Filtreleri değiştirin ya da yeni fatura ekleyin."
            action={
              anyFilter ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Filtreleri temizle
                </Button>
              ) : (
                <Button onClick={() => setEditing("new")}>
                  <Plus size={16} /> Fatura ekle
                </Button>
              )
            }
          />
        </div>
      )}

      {editing ? (
        <InvoiceDialog
          invoice={editing === "new" ? null : editing}
          suppliers={suppliers}
          onClose={() => setEditing(null)}
          onDelete={(i) => setDeleting(i)}
          parasutCompanyId={parasutCompanyId ?? null}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        pending={removing}
        title="Fatura silinsin mi?"
        description={deleting ? <DeleteSummary invoice={deleting} /> : null}
      />
    </Card>
  );
}

/** Onay penceresindeki özet (ConfirmDialog açıklamayı <p> içine koyar; burada yalnızca satır içi öğeler) */
function DeleteSummary({ invoice }: { invoice: Invoice }) {
  return (
    <>
      Bu işlem geri alınamaz. Gelir-gider tablosu yeniden hesaplanır.
      <span className="mt-3 flex items-center gap-3 rounded-2xl bg-panel p-3">
        <Avatar name={splitSupplier(invoice.supplier).base} />
        <span className="min-w-0">
          <span className="block font-medium text-ink">{invoice.supplier}</span>
          <span className="block text-[13px] text-ink-mute tabular">
            {dateTR(invoice.date)}
            {invoice.invoiceNo ? ` · No ${invoice.invoiceNo}` : ""} · {tl(invoice.payable, 2)}
          </span>
        </span>
      </span>
    </>
  );
}

/** Boş değil ama sayı olarak okunamayan tutar */
const badNumber = (t: string) => t.trim() !== "" && parseNumberTR(t) === null;

/** Yerel saatle bugün (YYYY-AA-GG); toISOString UTC verir, gece 03:00'e kadar dünü gösterirdi */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function InvoiceDialog({
  invoice,
  suppliers,
  onClose,
  onDelete,
  parasutCompanyId,
}: {
  invoice: Invoice | null;
  suppliers: string[];
  onClose: () => void;
  onDelete: (invoice: Invoice) => void;
  parasutCompanyId: string | null;
}) {
  const [f, setF] = useState(() => ({
    date: invoice?.date ?? localToday(),
    supplier: invoice?.supplier ?? "",
    description: invoice?.description ?? "",
    invoiceNo: invoice?.invoiceNo ?? "",
    category: invoice?.category ?? "Hammadde & İçecek",
    amount: invoice ? num(invoice.amount, 2) : "",
    discount: invoice ? num(invoice.discount, 2) : "0",
    payable: invoice ? num(invoice.payable, 2) : "",
    vatRate: "1",
    unpaid: invoice?.unpaid ?? false,
    note: invoice?.note ?? "",
    dueDate: invoice?.dueDate ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const amount = parseNumberTR(f.amount) ?? 0;
  const discount = parseNumberTR(f.discount) ?? 0;
  const net = amount - discount;
  const payable = parseNumberTR(f.payable);
  const bad = { amount: badNumber(f.amount), discount: badNumber(f.discount), payable: badNumber(f.payable) };
  const supplierMissing = tried && !f.supplier.trim();
  const groupedAs = normalizeSupplier(f.supplier);
  const supplierHint =
    groupedAs && groupedAs !== f.supplier.trim()
      ? `Gelir-giderde “${groupedAs}” altında toplanır; parantezdeki not sayılmaz.`
      : "Aynı tedarikçi adını kullanın; gelir-giderde birlikte toplanır.";

  async function save() {
    if (!f.supplier.trim()) {
      setTried(true);
      return toast.error("Tedarikçi girin");
    }
    if (bad.amount || bad.discount || bad.payable) return toast.error("Tutarları kontrol edin");
    setBusy(true);
    let res: Awaited<ReturnType<typeof saveInvoice>>;
    try {
      res = await saveInvoice({
        id: invoice?.id ?? null,
        date: f.date,
        supplier: f.supplier,
        description: f.description,
        invoiceNo: f.invoiceNo,
        category: f.category,
        amount,
        discount,
        payable: payable ?? net,
        unpaid: f.unpaid,
        note: f.note,
        dueDate: f.dueDate || null,
      });
    } finally {
      setBusy(false);
    }
    if (!res.ok) return toast.error(res.error);
    toast.success("Fatura kaydedildi");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={invoice ? "Faturayı düzenle" : "Fatura ekle"}
      description="Tutarlar faturadaki gibi: mal/hizmet tutarı, iskonto ve KDV dahil ödenecek tutar."
      footerStart={
        invoice ? (
          <>
            <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => onDelete(invoice)}>
              <Trash2 size={16} /> Sil
            </Button>
            {invoice.externalId && parasutCompanyId ? (
              <a
                href={`https://uygulama.parasut.com/${encodeURIComponent(parasutCompanyId)}/fis-faturalar/${encodeURIComponent(invoice.externalId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-ink-mute hover:text-ink hover:underline"
              >
                Paraşüt&apos;te aç ↗
              </a>
            ) : null}
          </>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-3 gap-y-4 pb-2 sm:grid-cols-2">
        <Field label="Tarih" htmlFor="f-date">
          <Input id="f-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label="Fatura no" htmlFor="f-no">
          <Input id="f-no" value={f.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} />
        </Field>
        <Field label="Tedarikçi" htmlFor="f-sup" hint={supplierHint} error={supplierMissing ? "Tedarikçi girin" : undefined}>
          <Input
            id="f-sup"
            list="supplier-list"
            value={f.supplier}
            onChange={(e) => set({ supplier: e.target.value })}
            aria-invalid={supplierMissing || undefined}
            data-autofocus={invoice ? undefined : true}
          />
          <datalist id="supplier-list">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Açıklama" htmlFor="f-desc">
          <Input id="f-desc" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="ör. Eylül kira, tatlı, süt" />
        </Field>
        <Field
          label="Kategori"
          htmlFor="f-cat"
          hint={
            GOODS_CATEGORIES.includes(f.category)
              ? "Mal maliyeti sayılır"
              : f.category === COMMISSION_CATEGORY
                ? "Komisyon giderlerine eklenir"
                : "Gelir-gider tablosuna eklenmez (sabit giderlerden izlenir)"
          }
        >
          <Select id="f-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Vade (son ödeme günü)" htmlFor="f-due" hint={f.unpaid ? "Ödenmemişse Ödemeler & hatırlatıcılar'a düşer" : undefined}>
          <Input id="f-due" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </Field>
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
        <Field label="Mal / hizmet tutarı (₺)" htmlFor="f-amt" error={bad.amount ? "Geçerli bir sayı girin" : undefined}>
          <NumberInput id="f-amt" value={f.amount} onChange={(e) => set({ amount: e.target.value })} aria-invalid={bad.amount || undefined} className={bad.amount ? undefined : "cell-input"} />
        </Field>
        <Field label="İskonto (₺)" htmlFor="f-disc" error={bad.discount ? "Geçerli bir sayı girin" : undefined}>
          <NumberInput id="f-disc" value={f.discount} onChange={(e) => set({ discount: e.target.value })} aria-invalid={bad.discount || undefined} className={bad.discount ? undefined : "cell-input"} />
        </Field>
        <Field
          label="Ödenecek, KDV dahil (₺)"
          htmlFor="f-pay"
          className="sm:col-span-2"
          error={bad.payable ? "Geçerli bir sayı girin" : undefined}
          hint={`Net ${tl(net, 2)} · KDV ${payable !== null ? tl(payable - net, 2) : "–"}`}
        >
          <div className="flex gap-2">
            <NumberInput
              id="f-pay"
              value={f.payable}
              onChange={(e) => set({ payable: e.target.value })}
              aria-invalid={bad.payable || undefined}
              className={cn("min-w-0 flex-1", !bad.payable && "cell-input")}
            />
            <Select value={f.vatRate} onChange={(e) => set({ vatRate: e.target.value })} className="w-20 shrink-0" aria-label="KDV oranı">
              {["1", "10", "20"].map((v) => (
                <option key={v} value={v}>
                  %{v}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => set({ payable: num(net * (1 + Number(f.vatRate) / 100), 2) })} title="Net tutar + seçilen KDV">
              Hesapla
            </Button>
          </div>
        </Field>
        <Field label="Not" className="sm:col-span-2" htmlFor="f-note">
          <Textarea id="f-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
