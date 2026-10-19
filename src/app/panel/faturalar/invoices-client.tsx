"use client";

import { Check, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { startTransition, useOptimistic, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, keepScroll, matches, SearchField, useQueryState, useQueryText, useSettleScroll } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
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
import { cn } from "@/lib/utils";
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

/** "Mal alımları" hızlı filtresi: mal maliyeti sayılan üç kategori (adreste ?kategori=mal) */
const GOODS_FILTER = "mal";
const PAGE_SIZE = 25;
/** "Temizle" düğmesinin sıfırladığı adres anahtarları (sıralama süzgeç sayılmaz, korunur) */
const FILTER_KEYS = ["ara", "durum", "kategori", "ay", "kaynak"];

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

/** Adresteki ?durum= değerleri (bildirimdeki bağlantı ?durum=odenmedi kullanır) */
type Status = "tumu" | "odenmedi" | "odendi";
type SortKey = "tarih" | "tedarikci" | "net" | "odenecek";
type Sort = { key: SortKey; dir: "asc" | "desc" };
/** Varsayılan sıra sunucudaki gibi: yeniden eskiye (aynı günde son eklenen üstte) */
const DEFAULT_SORT = "tarih-azalan";

const netOf = (i: Invoice) => i.amount - i.discount;

const COMPARE: Record<SortKey, (a: Invoice, b: Invoice) => number> = {
  tarih: (a, b) => a.date.localeCompare(b.date),
  tedarikci: (a, b) => splitSupplier(a.supplier).base.localeCompare(splitSupplier(b.supplier).base, "tr"),
  net: (a, b) => netOf(a) - netOf(b),
  odenecek: (a, b) => a.payable - b.payable,
};

/** ?sirala=net-artan -> { key: "net", dir: "asc" } */
function parseSort(v: string): Sort {
  const [k, d] = v.split("-");
  const key = (k in COMPARE ? k : "tarih") as SortKey;
  return { key, dir: d === "artan" ? "asc" : "desc" };
}

/** Telefonda tablo başlığı görünmediği için sıralama seçimi (?sirala= değerleri) */
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "tarih-azalan", label: "Tarih: yeniden eskiye" },
  { value: "tarih-artan", label: "Tarih: eskiden yeniye" },
  { value: "net-azalan", label: "Net: yüksekten düşüğe" },
  { value: "net-artan", label: "Net: düşükten yükseğe" },
  { value: "odenecek-azalan", label: "Ödenecek: yüksekten düşüğe" },
  { value: "odenecek-artan", label: "Ödenecek: düşükten yükseğe" },
  { value: "tedarikci-artan", label: "Tedarikçi: A → Z" },
  { value: "tedarikci-azalan", label: "Tedarikçi: Z → A" },
];

/** Aramada tedarikçi, açıklama, fatura no, not, kategori, tarih ve tutarlar taranır ("7.410" da bulur) */
function haystack(i: Invoice) {
  return [i.supplier, i.description, i.invoiceNo, i.note, i.category, dateTR(i.date), num(netOf(i), 2), num(i.payable, 2)].filter(Boolean).join(" ");
}

type Optimistic = { kind: "paid"; id: number; paid: boolean } | { kind: "delete"; id: number };

export function InvoicesClient({
  invoices,
  months,
  suppliers,
  parasutCompanyId,
}: {
  invoices: Invoice[];
  /** Paraşüt firma numarası; varsa Paraşüt'ten gelen faturada "Paraşüt'te aç" bağlantısı çıkar */
  parasutCompanyId?: string | null;
  months: string[];
  suppliers: string[];
}) {
  const reduce = useCalmMotion();
  useSettleScroll(invoices);
  // Ödendi işareti ve silme sunucu yanıtını beklemeden görünür; hata olursa liste eski haline döner
  const [list, applyOptimistic] = useOptimistic(invoices, (state: Invoice[], a: Optimistic) =>
    a.kind === "delete" ? state.filter((i) => i.id !== a.id) : state.map((i) => (i.id === a.id ? { ...i, unpaid: !a.paid } : i)),
  );
  const [q, setQ] = useQueryText("ara");
  const [rawMonth, setMonth] = useQueryState<string>("ay", "");
  const [rawCategory, setCategory] = useQueryState<string>("kategori", "");
  const [rawStatus, setStatus] = useQueryState<Status>("durum", "tumu");
  const [rawSource, setSource] = useQueryState<string>("kaynak", "");
  const [rawSort, setSort] = useQueryState<string>("sirala", DEFAULT_SORT);
  // Adresten gelen değerler doğrulanır: elle yazılmış ya da eskimiş bağlantı listeyi boşaltmasın
  const month = months.includes(rawMonth) ? rawMonth : "";
  const category = rawCategory === GOODS_FILTER || INVOICE_CATEGORIES.includes(rawCategory) ? rawCategory : "";
  const status: Status = rawStatus === "odenmedi" || rawStatus === "odendi" ? rawStatus : "tumu";
  const source = rawSource === "parasut" ? "parasut" : "";
  const sort = parseSort(rawSort);
  const [editing, setEditing] = useState<Invoice | "new" | null>(null);
  const [deleting, setDeleting] = useState<Invoice | null>(null);
  /** Az önce ödendi işaretlenen fatura: yeni "Ödendi" rozeti yaylı belirir */
  const [popId, setPopId] = useState<number | null>(null);

  const parasutCount = list.filter((i) => i.source === "parasut").length;
  // Durum dışındaki filtreler: durum çiplerinin sayaçları bunlara göre
  const filtered = list.filter(
    (i) =>
      (!month || i.date.startsWith(month)) &&
      (!category || (category === GOODS_FILTER ? GOODS_CATEGORIES.includes(i.category) : i.category === category)) &&
      (!source || i.source === "parasut") &&
      matches(haystack(i), q),
  );
  const filteredUnpaid = filtered.filter((i) => i.unpaid).length;
  const byStatus = status === "odenmedi" ? filtered.filter((i) => i.unpaid) : status === "odendi" ? filtered.filter((i) => !i.unpaid) : filtered;
  // Sıralama kararlı: eşit değerlerde sunucunun tarih sırası korunur
  const visible = [...byStatus].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * COMPARE[sort.key](a, b));
  const sum = (f: (i: Invoice) => number) => visible.reduce((a, i) => a + f(i), 0);
  const viewKey = `${month}|${category}|${status}|${source}|${sort.key}|${sort.dir}`;
  const paged = usePaged(visible, PAGE_SIZE, `${q}|${viewKey}`);
  const anyFilter = Boolean(q.trim() || month || category || status !== "tumu" || source);
  const totalUnpaid = list.filter((i) => i.unpaid).length;
  const totalDiscount = sum((i) => i.discount);

  const toggleSort = (key: SortKey) => {
    const dir = sort.key === key ? (sort.dir === "asc" ? "azalan" : "artan") : key === "tedarikci" ? "artan" : "azalan";
    setSort(`${key}-${dir}`);
  };
  const dirOf = (key: SortKey) => (sort.key === key ? sort.dir : null);

  const clearFilters = () => {
    setQ("");
    clearQuery(FILTER_KEYS);
  };

  /** Sayfa değişince listenin başına dön (alttaki sayfalamadan tıklanınca yeni sayfanın sonunda kalınmasın) */
  const toPage = (p: number) => {
    paged.setPage(p);
    const el = document.getElementById("fatura-listesi");
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  };

  function setPaid(i: Invoice, paid: boolean) {
    if (paid) setPopId(i.id);
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "paid", id: i.id, paid });
      const res = await setInvoicePaid(i.id, paid);
      if (!res.ok) {
        setPopId(null);
        toast.error(res.error);
        return;
      }
      const name = splitSupplier(i.supplier).base;
      if (paid)
        toast.success("Ödendi olarak işaretlendi", {
          description: `${name} · ${tl(i.payable, 2)}`,
          action: { label: "Geri al", onClick: () => setPaid(i, false) },
        });
      else toast.success("Yeniden ödenmedi olarak işaretlendi", { description: name });
    });
  }

  function confirmDelete() {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    // Düzenleme penceresinden silindiyse o da kapansın
    if (editing && editing !== "new" && editing.id === target.id) setEditing(null);
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "delete", id: target.id });
      const res = await deleteInvoice(target.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Fatura silindi", { description: `${splitSupplier(target.supplier).base} · ${dateTR(target.date)}` });
    });
  }

  /** "Ödenmedi" rozeti: tıklayınca ödendi işaretlenir; ödenmişte yaylı beliren "Ödendi" */
  const statusBadge = (i: Invoice) =>
    i.unpaid ? (
      <motion.button
        type="button"
        onClick={() => setPaid(i, true)}
        whileTap={reduce ? undefined : { scale: 0.94 }}
        transition={SPRING_PRESS}
        title="Ödendi olarak işaretle"
        aria-label={`${i.supplier}: ödenmedi. Ödendi olarak işaretle`}
        className="group/pay -my-1 inline-flex min-h-8 cursor-pointer items-center rounded-full pointer-coarse:min-h-10"
      >
        <Badge tone="red" dot className="transition-shadow group-hover/pay:ring-1 group-hover/pay:ring-bad/30">
          Ödenmedi
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
    );

  const sourceBadges = (i: Invoice, note: string, base: string) => (
    <>
      {i.source === "parasut" ? (
        <Badge tone="blue" title="Paraşüt'ten otomatik alındı">
          Paraşüt
        </Badge>
      ) : null}
      {note ? (
        <Badge tone={/tahmin/i.test(note) ? "amber" : "gray"} dot={/tahmin/i.test(note)} title={`Tedarikçi adındaki not. Gelir-giderde “${base}” altında toplanır.`}>
          {note}
        </Badge>
      ) : null}
    </>
  );

  return (
    // Özet kartlarındaki ve aylık tablodaki bağlantılar buraya iner; telefonda sabit üst çubuğun altında kalmasın
    <Card id="fatura-listesi" className="scroll-mt-20 lg:scroll-mt-6">
      <CardHeader
        icon={<FileText />}
        title="Fatura listesi"
        description="Satıra tıklayınca düzenlenir. “Ödenmedi” rozetine tıklamak faturayı ödendi yapar."
        meta={
          <>
            <span>
              <AnimatedNumber value={list.length} format={(v) => num(v)} className="font-semibold text-ink tabular" /> fatura
            </span>
            {totalUnpaid ? (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setStatus(status === "odenmedi" ? "tumu" : "odenmedi")}
                  className="inline-flex cursor-pointer items-center gap-1 text-warn underline-offset-2 hover:underline pointer-coarse:min-h-10"
                >
                  <AnimatedNumber value={totalUnpaid} format={(v) => num(v)} className="font-semibold tabular" /> ödenmemiş
                </button>
              </>
            ) : null}
          </>
        }
        actions={
          <Button onClick={() => setEditing("new")} className="pointer-coarse:h-10">
            <Plus size={16} /> Fatura ekle
          </Button>
        }
      />

      <FilterBar active={anyFilter} onClear={clearFilters} shown={visible.length} total={list.length} unit="fatura" className="px-5 pb-4">
        <SearchField value={q} onChange={setQ} placeholder="Tedarikçi, fatura no, tutar" label="Fatura ara" className="w-full lg:w-72" />
        <FilterChip active={status === "odenmedi"} onToggle={() => setStatus(status === "odenmedi" ? "tumu" : "odenmedi")} count={filteredUnpaid}>
          Ödenmemiş
        </FilterChip>
        <FilterChip active={status === "odendi"} onToggle={() => setStatus(status === "odendi" ? "tumu" : "odendi")} count={filtered.length - filteredUnpaid}>
          Ödendi
        </FilterChip>
        {parasutCount && parasutCount < list.length ? (
          <FilterChip active={!!source} onToggle={() => setSource(source ? "" : "parasut")}>
            Paraşüt&apos;ten
          </FilterChip>
        ) : null}
        <div className="grid w-full grid-cols-[3fr_2fr] gap-2 sm:flex sm:w-auto">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={cn("min-w-0 sm:w-44 pointer-coarse:h-10", category && "ring-ink/40")}
            aria-label="Kategori"
          >
            <option value="">Tüm kategoriler</option>
            <option value={GOODS_FILTER}>Mal alımları (mal maliyeti)</option>
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={cn("min-w-0 sm:w-36 pointer-coarse:h-10", month && "ring-ink/40")}
            aria-label="Ay"
          >
            <option value="">Tüm aylar</option>
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </div>
        <Select
          value={`${sort.key}-${sort.dir === "asc" ? "artan" : "azalan"}`}
          onChange={(e) => setSort(e.target.value)}
          className="w-full md:hidden pointer-coarse:h-10"
          aria-label="Sıralama"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sırala · {o.label}
            </option>
          ))}
        </Select>
      </FilterBar>

      {visible.length ? (
        <>
          {/* Telefon: kart listesi (tablo 375px'e sığmaz, tutarlar görünmez kalırdı) */}
          <ul className="divide-y divide-line-strong/70 border-t border-line md:hidden">
            {paged.slice.map((i) => {
              const { base, note } = splitSupplier(i.supplier);
              const net = netOf(i);
              return (
                <li key={i.id} className="px-4 py-3">
                  <button type="button" onClick={() => setEditing(i)} className="flex w-full cursor-pointer items-start gap-3 text-left">
                    <Avatar name={base} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium break-words text-ink">{base}</span>
                        {sourceBadges(i, note, base)}
                      </span>
                      <span className="mt-0.5 block text-[13px] break-words text-ink-mute">
                        {dateTR(i.date)}
                        {i.description ? ` · ${i.description}` : ""}
                      </span>
                      {i.invoiceNo ? <span className="block truncate text-xs text-ink-quiet">No {i.invoiceNo}</span> : null}
                    </span>
                    <span className="shrink-0 text-right tabular">
                      <span className="block font-semibold text-ink">{tl(net, 2)}</span>
                      <span className="block text-xs text-ink-mute">KDV hariç</span>
                      <span className="block text-xs text-ink-mute">öd. {tl(i.payable, 2)}</span>
                    </span>
                  </button>
                  <div className="mt-2 flex items-center gap-2 pl-12">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {statusBadge(i)}
                      <Badge tone={categoryTone(i.category)}>{i.category}</Badge>
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <IconButton label="Düzenle" onClick={() => setEditing(i)} className="pointer-coarse:size-10">
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton label="Sil" tone="danger" onClick={() => setDeleting(i)} className="pointer-coarse:size-10">
                        <Trash2 size={15} />
                      </IconButton>
                    </span>
                  </div>
                  {i.unpaid && i.dueDate ? <p className="mt-1 pl-12 text-xs text-warn">Vade {dateTR(i.dueDate)}</p> : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line-strong px-5 py-3 text-sm font-semibold md:hidden">
            <span>{anyFilter ? `Süzülen ${num(visible.length)} fatura` : `${num(visible.length)} fatura`}</span>
            <span className="text-right tabular">
              {tl(sum(netOf), 2)} <span className="text-xs font-normal text-ink-mute">net</span>
              <span className="block text-xs font-normal text-ink-mute">ödenecek {tl(sum((i) => i.payable), 2)}</span>
            </span>
          </div>

          <TableWrap className="max-md:hidden">
            <Table>
              <THead>
                <tr>
                  <TH sticky>
                    <span className="inline-flex items-center gap-1.5">
                      <SortButton dir={dirOf("tedarikci")} onClick={() => toggleSort("tedarikci")}>
                        Tedarikçi
                      </SortButton>
                      <InfoTip text="Adın sonundaki parantezli not ayrı tedarikçi sayılmaz: “Kaldi (ödenmedi)” gelir-giderde “Kaldi” altında toplanır. “tahmini” notu turuncu işaretlenir." />
                    </span>
                  </TH>
                  <TH>
                    <SortButton dir={dirOf("tarih")} onClick={() => toggleSort("tarih")}>
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
                      <InfoTip text="Mal/hizmet tutarı − iskonto. KDV'yi indirebildiğiniz için gerçek maliyetiniz budur. İskonto varsa altında yazar; üzerine gelince iskontodan önceki tutar görünür." />
                      <SortButton numeric dir={dirOf("net")} onClick={() => toggleSort("net")}>
                        Net
                      </SortButton>
                    </span>
                    <span className="block text-xs font-normal text-ink-mute">KDV hariç</span>
                  </TH>
                  <TH numeric>
                    <SortButton numeric dir={dirOf("odenecek")} onClick={() => toggleSort("odenecek")}>
                      Ödenecek
                    </SortButton>
                    <span className="block text-xs font-normal text-ink-mute">KDV dahil</span>
                  </TH>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      Durum
                      <InfoTip text="“Ödenmedi” rozetine tıklayınca fatura ödendi olarak işaretlenir; bildirimdeki “Geri al” ile geri alınır." />
                    </span>
                  </TH>
                  <TH className="w-px px-2">
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
                  return (
                    <TR key={i.id} className="cursor-pointer" onClick={() => setEditing(i)}>
                      <TD sticky className="min-w-48 max-w-80">
                        <div className="flex items-center gap-3">
                          <Avatar name={base} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium break-words text-ink">{base}</span>
                              {sourceBadges(i, note, base)}
                            </div>
                            {second ? <p className="mt-0.5 text-[13px] break-words text-ink-mute">{second}</p> : null}
                          </div>
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-ink-soft tabular">
                        {dateTR(i.date)}
                        {i.unpaid && i.dueDate ? <span className="block text-xs text-warn">Vade {dateTR(i.dueDate)}</span> : null}
                      </TD>
                      <TD>
                        <Badge tone={categoryTone(i.category)}>{i.category}</Badge>
                      </TD>
                      <TD numeric>
                        <span className="font-semibold">{tl(net, 2)}</span>
                        {/* Kısa tutulur (sütun dar kalsın, tablo 1280px'te sığsın); iskontodan önceki tutar ipucunda */}
                        {i.discount ? (
                          <span className="block text-xs text-ink-mute" title={`Tutar ${tl(i.amount, 2)} − iskonto ${tl(i.discount, 2)}`}>
                            iskonto {tl(i.discount, 2)}
                          </span>
                        ) : null}
                      </TD>
                      <TD numeric>
                        {tl(i.payable, 2)}
                        <span className="block text-xs text-ink-mute">KDV {tl(i.payable - net, 2)}</span>
                      </TD>
                      <TD onClick={(e) => e.stopPropagation()} className="cursor-default">
                        {statusBadge(i)}
                      </TD>
                      <TD onClick={(e) => e.stopPropagation()} className="cursor-default px-2">
                        <div className="flex justify-end gap-1">
                          {i.unpaid ? (
                            <IconButton label="Ödendi olarak işaretle" onClick={() => setPaid(i, true)}>
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
                  <TD colSpan={3}>
                    {anyFilter ? `Süzülen ${num(visible.length)} fatura toplamı` : `${num(visible.length)} fatura toplamı`}
                  </TD>
                  {/* Satırlarla aynı hassasiyet (kuruşlu); tek faturada toplam satırdakiyle birebir aynı görünsün */}
                  <TD numeric>
                    {tl(sum(netOf), 2)}
                    {totalDiscount ? (
                      <span className="block text-xs font-normal text-ink-mute" title={`Tutar ${tl(sum((i) => i.amount), 2)} − iskonto ${tl(totalDiscount, 2)}`}>
                        iskonto {tl(totalDiscount, 2)}
                      </span>
                    ) : null}
                  </TD>
                  <TD numeric>
                    {tl(sum((i) => i.payable), 2)}
                    <span className="block text-xs font-normal text-ink-mute">KDV {tl(sum((i) => i.payable - i.amount + i.discount), 2)}</span>
                  </TD>
                  <TD colSpan={2} />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={toPage}
            total={paged.pageCount > 1 ? paged.total : undefined}
            unit="fatura"
            // Telefonda sayfa düğmeleri karta sığmazsa alt satıra geçer, kartın dışına taşmaz
            className="border-t border-line max-sm:px-3 [&>div]:flex-wrap max-sm:[&>div]:gap-1"
          />
        </>
      ) : (
        <div className="border-t border-line">
          {list.length ? (
            <EmptyState
              title="Bu süzgece uyan fatura yok"
              description={
                q.trim()
                  ? `“${q.trim()}” için sonuç bulunamadı. Aramayı kısaltın ya da süzgeci temizleyin.`
                  : "Seçili durum, kategori ya da ayda fatura yok. Süzgeci temizleyin ya da yeni fatura ekleyin."
              }
              action={
                <>
                  <Button variant="secondary" onClick={clearFilters}>
                    Süzgeci temizle
                  </Button>
                  <Button onClick={() => setEditing("new")}>
                    <Plus size={16} /> Fatura ekle
                  </Button>
                </>
              }
            />
          ) : (
            <EmptyState
              title="Henüz fatura yok"
              description="Paraşüt bağlıysa alış faturaları otomatik gelir. Elle eklemek için faturadaki tutar, iskonto ve KDV dahil toplamı girin."
              action={
                <Button onClick={() => setEditing("new")}>
                  <Plus size={16} /> İlk faturayı ekle
                </Button>
              }
            />
          )}
        </div>
      )}

      {editing ? (
        <InvoiceDialog
          key={editing === "new" ? "new" : editing.id}
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
        title="Fatura silinsin mi?"
        confirmLabel="Faturayı sil"
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
      {invoice.source === "parasut" ? " Paraşüt'ten gelen fatura sonraki eşitlemede geri gelmez." : ""}
      <span className="mt-3 flex items-center gap-3 rounded-2xl bg-panel p-3">
        <Avatar name={splitSupplier(invoice.supplier).base} />
        <span className="min-w-0">
          <span className="block font-medium break-words text-ink">{invoice.supplier}</span>
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

const VAT_RATES = ["1", "10", "20"];

/** Kayıtlı faturanın KDV oranına en yakın seçenek (Hesapla düğmesi aynı oranla başlasın) */
function guessVat(invoice: Invoice | null) {
  if (!invoice) return "1";
  const net = netOf(invoice);
  if (net <= 0 || invoice.payable <= net) return "1";
  const rate = (invoice.payable / net - 1) * 100;
  return VAT_RATES.reduce((best, r) => (Math.abs(Number(r) - rate) < Math.abs(Number(best) - rate) ? r : best));
}

function blankForm(invoice: Invoice | null, keep?: { date: string; category: string }) {
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
  const [f, setF] = useState(() => blankForm(invoice));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  /** Bu pencerede art arda eklenen fatura sayısı ("Kaydet, yenisini ekle") */
  const [added, setAdded] = useState(0);
  const supplierRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const amount = parseNumberTR(f.amount) ?? 0;
  const discount = parseNumberTR(f.discount) ?? 0;
  const net = amount - discount;
  const payable = parseNumberTR(f.payable);
  const bad = { amount: badNumber(f.amount), discount: badNumber(f.discount), payable: badNumber(f.payable) };
  const supplierMissing = tried && !f.supplier.trim();
  const dateMissing = tried && !f.date;
  const groupedAs = normalizeSupplier(f.supplier);
  const supplierHint = groupedAs && groupedAs !== f.supplier.trim() ? `Gelir-giderde “${groupedAs}” altında toplanır; parantezdeki not sayılmaz.` : undefined;
  const withVat = net * (1 + Number(f.vatRate) / 100);

  async function save(again: boolean) {
    setTried(true);
    if (!f.supplier.trim()) {
      supplierRef.current?.focus();
      return toast.error("Tedarikçi girin");
    }
    if (!f.date) return toast.error("Fatura tarihini seçin");
    if (bad.amount || bad.discount || bad.payable) return toast.error("Tutarları kontrol edin");
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
    toast.success(invoice ? "Fatura güncellendi" : "Fatura eklendi", { description: `${f.supplier.trim()} · ${tl(payable ?? net, 2)}` });
    if (!again) return onClose();
    // Art arda giriş: tarih ve kategori kalır, diğer alanlar boşalır, imleç tedarikçiye döner
    setF(blankForm(null, { date: f.date, category: f.category }));
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
          : "Tutarlar faturadaki gibi: mal/hizmet tutarı, iskonto ve KDV dahil ödenecek tutar."
      }
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
          <Button variant="ghost" onClick={onClose} className="pointer-coarse:h-10">
            {added ? "Kapat" : "Vazgeç"}
          </Button>
          {invoice ? null : (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => save(true)}
              title="Kaydeder ve yeni fatura için formu boşaltır"
              className="pointer-coarse:h-10"
            >
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
          tip="Aynı tedarikçi adını kullanın; gelir-giderde birlikte toplanır. Listeden seçebilirsiniz."
          hint={supplierHint}
          error={supplierMissing ? "Tedarikçi girin" : undefined}
        >
          <Input
            ref={supplierRef}
            id="f-sup"
            list="supplier-list"
            value={f.supplier}
            onChange={(e) => set({ supplier: e.target.value })}
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
        <Field label="Tarih" htmlFor="f-date" error={dateMissing ? "Tarih seçin" : undefined}>
          <Input id="f-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} aria-invalid={dateMissing || undefined} />
        </Field>
        <Field label="Açıklama" htmlFor="f-desc">
          <Input id="f-desc" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="ör. Eylül kira, tatlı, süt" />
        </Field>
        <Field label="Fatura no" htmlFor="f-no">
          <Input id="f-no" value={f.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} autoComplete="off" />
        </Field>
        <Field
          label="Kategori"
          htmlFor="f-cat"
          className="sm:col-span-2"
          hint={
            GOODS_CATEGORIES.includes(f.category)
              ? "Mal maliyeti sayılır: gelir-gider tablosunda tedarikçi bazında görünür."
              : f.category === COMMISSION_CATEGORY
                ? "Komisyon giderlerine eklenir."
                : "Gelir-gider tablosuna eklenmez (sabit giderlerden izlenir)."
          }
        >
          <Select id="f-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>

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
            error={bad.payable ? "Geçerli bir sayı girin" : undefined}
            hint={
              payable !== null
                ? `Net ${tl(net, 2)} · KDV ${tl(payable - net, 2)}`
                : net
                  ? `Boş kalırsa net ${tl(net, 2)} yazılır · %${f.vatRate} KDV ile ${tl(withVat, 2)}`
                  : "Faturadaki genel toplam. “Hesapla” net tutara seçili KDV'yi ekler."
            }
          >
            {/* Telefonda tutar tam satır (38.602,20 gibi değerler kesilmesin), KDV oranı ve Hesapla altında */}
            <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex">
              <NumberInput
                id="f-pay"
                value={f.payable}
                onChange={(e) => set({ payable: e.target.value })}
                placeholder={num(net, 2, 2)}
                aria-invalid={bad.payable || undefined}
                className={cn("col-span-2 min-w-0 sm:flex-1", !bad.payable && "cell-input")}
              />
              <Select value={f.vatRate} onChange={(e) => set({ vatRate: e.target.value })} className="shrink-0 sm:w-20" aria-label="KDV oranı">
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
        <Field label="Vade (son ödeme günü)" htmlFor="f-due" hint={f.unpaid ? "Ödenmemişse Ödemeler & hatırlatıcılar'a düşer" : "İsteğe bağlı"}>
          <Input id="f-due" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </Field>
        <Field label="Not" className="sm:col-span-2" htmlFor="f-note">
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
