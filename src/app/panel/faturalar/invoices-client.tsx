"use client";

import { Check, ChevronDown, CircleCheck, FileText, Pencil, Plus, StickyNote, Trash2, X } from "lucide-react";
import { motion } from "motion/react";
import { startTransition, useEffect, useMemo, useOptimistic, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Fab } from "@/components/ui/fab";
import { clearQuery, FilterBar, FilterChip, keepScroll, matches, SearchField, useQueryState, useQueryText, useSettleScroll } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { ActiveFilters, BIG_FIELDS, ChoiceList, FilterButton, SHEET_BTN, type ActiveFilter } from "@/components/ui/mobile-filters";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Switch } from "@/components/ui/switch";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { ToggleRow } from "@/components/ui/toggle-row";
import { isPartiallyPaid } from "@/lib/calc/insights";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteInvoice, restoreInvoice, setInvoiceCategory, setInvoicePaid, unignoreParasutBill } from "@/server/actions/invoices";

import { InvoiceDialog } from "./invoice-dialog";
import { isEstimate, isParasutLinked, notePreview, sameSupplierOthers, splitSupplier, supplierDefaults, visibleNote, type InvoiceRow } from "./rules";

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

/** Badge tonlarıyla aynı renkler; satır içi kategori seçimi rozet gibi görünür */
const PILL_TONE: Partial<Record<Tone, string>> = {
  green: "bg-lime/25 text-good-ink",
  blue: "bg-info-soft text-info",
  gray: "bg-ink/[0.06] text-ink-soft ring-1 ring-inset ring-line-strong",
};
/** Alt sayfadaki kategori listesinin renk noktası (rozetle aynı anlam) */
const CATEGORY_DOT: Partial<Record<Tone, string>> = { green: "bg-good", blue: "bg-info", gray: "bg-ink-quiet" };
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

/** "Mal alımları" hızlı filtresi: mal maliyeti sayılan üç kategori (adreste ?kategori=mal) */
const GOODS_FILTER = "mal";
const PAGE_SIZE = 25;
/** "Geri al"lı bildirimlerin süresi (silme, ödendi, kategori): okuyup karar verecek kadar */
const UNDO_MS = 10000;
/** "Temizle" düğmesinin sıfırladığı adres anahtarları (sıralama süzgeç sayılmaz, korunur) */
const FILTER_KEYS = ["ara", "durum", "kategori", "ay", "kaynak"];

/** Adresteki ?durum= değerleri (bildirimdeki bağlantı ?durum=odenmedi kullanır) */
type Status = "tumu" | "odenmedi" | "odendi";
type SortKey = "tarih" | "tedarikci" | "net" | "odenecek";
type Sort = { key: SortKey; dir: "asc" | "desc" };
/** Varsayılan sıra sunucudaki gibi: yeniden eskiye (aynı günde son eklenen üstte) */
const DEFAULT_SORT = "tarih-azalan";

const netOf = (i: InvoiceRow) => i.amount - i.discount;

const COMPARE: Record<SortKey, (a: InvoiceRow, b: InvoiceRow) => number> = {
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
function haystack(i: InvoiceRow) {
  return [i.supplier, i.description, i.invoiceNo, i.note, i.category, dateTR(i.date), num(netOf(i), 2), num(i.payable, 2)].filter(Boolean).join(" ");
}

type Optimistic =
  | { kind: "paid"; ids: number[]; paid: boolean }
  | { kind: "delete"; id: number }
  | { kind: "category"; changes: { id: number; category: string }[] };

function applyChange(state: InvoiceRow[], a: Optimistic): InvoiceRow[] {
  if (a.kind === "delete") return state.filter((i) => i.id !== a.id);
  if (a.kind === "paid") {
    const ids = new Set(a.ids);
    return state.map((i) => (ids.has(i.id) ? { ...i, unpaid: !a.paid } : i));
  }
  const next = new Map(a.changes.map((c) => [c.id, c.category]));
  return state.map((i) => (next.has(i.id) ? { ...i, category: next.get(i.id)! } : i));
}

export function InvoicesClient({
  invoices,
  months,
  suppliers,
  parasutCompanyId,
  ignoredCount = 0,
}: {
  invoices: InvoiceRow[];
  /** Paraşüt firma numarası; varsa Paraşüt'ten gelen faturada "Paraşüt'te aç" bağlantısı çıkar */
  parasutCompanyId?: string | null;
  months: string[];
  suppliers: string[];
  /** Silinip yok sayılan Paraşüt faturası sayısı (silme onayında geri alma yolunu söylemek için) */
  ignoredCount?: number;
}) {
  const reduce = useCalmMotion();
  useSettleScroll(invoices);
  // Doğrudan açılan /panel/faturalar?…#fatura-listesi: liste sonradan aktığı için tarayıcının çapa kaydırması
  // listeye ulaşamaz; liste çizilince bir kez kaydırılır
  useEffect(() => {
    if (window.location.hash !== "#fatura-listesi") return;
    const id = requestAnimationFrame(() => document.getElementById("fatura-listesi")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(id);
  }, []);
  // Ödendi işareti, kategori ve silme sunucu yanıtını beklemeden görünür; hata olursa liste eski haline döner
  const [list, applyOptimistic] = useOptimistic(invoices, applyChange);
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
  const [editing, setEditing] = useState<InvoiceRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<InvoiceRow | null>(null);
  /** Az önce ödendi işaretlenen fatura: yeni "Ödendi" rozeti yaylı belirir */
  const [popId, setPopId] = useState<number | null>(null);
  /** Telefon: süzgeç alt sayfası ve seçim kipi (kartlara dokununca düzenleme yerine seçim) */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  /** Telefon: kategorisi alt sayfada değiştirilen fatura */
  const [catFor, setCatFor] = useState<number | null>(null);
  const defaults = useMemo(() => supplierDefaults(invoices), [invoices]);

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
  const sum = (f: (i: InvoiceRow) => number) => visible.reduce((a, i) => a + f(i), 0);
  const viewKey = `${month}|${category}|${status}|${source}|${sort.key}|${sort.dir}`;
  const paged = usePaged(visible, PAGE_SIZE, `${q}|${viewKey}`);
  const anyFilter = Boolean(q.trim() || month || category || status !== "tumu" || source);
  const totalUnpaid = list.filter((i) => i.unpaid).length;
  const totalDiscount = sum((i) => i.discount);

  // Seçim süzgece bağlıdır: süzgeç ya da arama değişince boşalır, gizli satırlara toplu işlem uygulanmaz
  const selKey = `${q.trim()}|${month}|${category}|${status}|${source}`;
  const [selection, setSelection] = useState<{ key: string; ids: Set<number> }>({ key: selKey, ids: new Set() });
  const visibleIds = new Set(visible.map((i) => i.id));
  const selectedIds = selection.key === selKey ? [...selection.ids].filter((id) => visibleIds.has(id)) : [];
  const selected = visible.filter((i) => selectedIds.includes(i.id));
  const pageIds = paged.slice.map((i) => i.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const pageSome = !pageAll && pageIds.some((id) => selectedIds.includes(id));
  const clearSelection = () => setSelection({ key: selKey, ids: new Set() });
  const toggle = (id: number) =>
    setSelection(() => {
      const ids = new Set(selectedIds);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { key: selKey, ids };
    });
  const selectIds = (ids: number[], on: boolean) =>
    setSelection(() => {
      const next = new Set(selectedIds);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return { key: selKey, ids: next };
    });

  // Esc seçimi kaldırır (açık pencere yokken)
  const hasSelection = selectedIds.length > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA"].includes(t.tagName) && (t as HTMLInputElement).type !== "checkbox") return;
      setSelection((s) => ({ key: s.key, ids: new Set() }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  const toggleSort = (key: SortKey) => {
    const dir = sort.key === key ? (sort.dir === "asc" ? "azalan" : "artan") : key === "tedarikci" ? "artan" : "azalan";
    setSort(`${key}-${dir}`);
  };
  const dirOf = (key: SortKey) => (sort.key === key ? sort.dir : null);

  const clearFilters = () => {
    setQ("");
    clearQuery(FILTER_KEYS);
  };

  // Telefon: arama kutusunun altında kalan, tek dokunuşla kaldırılan süzgeç çipleri (alt sayfadaki seçimlerin özeti)
  const sortValue = `${sort.key}-${sort.dir === "asc" ? "artan" : "azalan"}`;
  const chips: ActiveFilter[] = [];
  if (status !== "tumu") chips.push({ key: "durum", label: status === "odenmedi" ? "Ödenmemiş" : "Ödendi", onRemove: () => setStatus("tumu") });
  if (category) chips.push({ key: "kategori", label: category === GOODS_FILTER ? "Mal alımları" : category, onRemove: () => setCategory("") });
  if (month) chips.push({ key: "ay", label: monthLabel(month), onRemove: () => setMonth("") });
  if (source) chips.push({ key: "kaynak", label: "Paraşüt'ten", onRemove: () => setSource("") });
  if (sortValue !== DEFAULT_SORT) {
    chips.push({ key: "sirala", label: SORT_OPTIONS.find((o) => o.value === sortValue)?.label ?? "Özel sıra", onRemove: () => setSort(DEFAULT_SORT) });
  }
  const catRow = catFor === null ? null : (list.find((i) => i.id === catFor) ?? null);
  /** Telefonda seçim kutuları görünür: "Seç" kipi açıkken ya da seçim varken */
  const picking = selectMode || selectedIds.length > 0;

  /** Sayfa değişince listenin başına dönülür (ui/pagination: liste başı ekranın üstündeyse kaydırır) */
  const toPage = (p: number) => paged.setPage(p);

  /** Ödendi / ödenmedi (tek fatura ya da seçilenler); bildirimdeki "Geri al" tersini yapar */
  function setPaid(targets: InvoiceRow[], paid: boolean, opts: { undo?: boolean } = {}) {
    const ids = targets.filter((i) => i.unpaid === paid).map((i) => i.id);
    if (!ids.length) return;
    if (paid && ids.length === 1) setPopId(ids[0]);
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "paid", ids, paid });
      const res = await setInvoicePaid(ids.length === 1 ? ids[0] : ids, paid);
      if (!res.ok) {
        setPopId(null);
        toast.error(res.error);
        return;
      }
      if (opts.undo) return void toast.success(paid ? "Yeniden ödendi olarak işaretlendi" : "Yeniden ödenmedi olarak işaretlendi");
      const changed = targets.filter((i) => ids.includes(i.id));
      const description =
        changed.length === 1
          ? `${splitSupplier(changed[0].supplier).base} · ${tl(changed[0].payable, 2)}`
          : `${changed.length} fatura · ${tl(changed.reduce((a, i) => a + i.payable, 0), 2)}`;
      toast.success(paid ? "Ödendi olarak işaretlendi" : "Ödenmedi olarak işaretlendi", {
        description,
        action: { label: "Geri al", onClick: () => setPaid(changed.map((i) => ({ ...i, unpaid: !paid })), !paid, { undo: true }) },
        // Silme bildirimleriyle aynı süre: "Geri al" birkaç saniyede kaybolmasın
        duration: UNDO_MS,
      });
    });
  }

  /** Kategori değişikliği (satır içi, toplu, geri alma, "aynı tedarikçinin diğerlerine") */
  function changeCategory(changes: { id: number; category: string }[], opts: { undo?: boolean; from?: InvoiceRow } = {}) {
    if (!changes.length) return;
    keepScroll();
    // "Hepsine uygula" önerisi değişiklikten önceki listeye göre (aynı tedarikçinin farklı kategorideki diğerleri)
    const others = opts.from ? sameSupplierOthers(list, opts.from, changes[0].category) : [];
    startTransition(async () => {
      applyOptimistic({ kind: "category", changes });
      const res = await setInvoiceCategory(changes);
      if (!res.ok) return void toast.error(res.error);
      const { previous, missing } = res.data;
      if (missing) toast.warning(`${missing} fatura bulunamadı (silinmiş olabilir)`);
      if (opts.undo) return void toast.success("Kategori geri alındı");
      if (!previous.length) return;
      const undo = { label: "Geri al", onClick: () => changeCategory(previous, { undo: true }) };
      const target = changes[0].category;
      if (opts.from) {
        const base = splitSupplier(opts.from.supplier).base;
        toast.success(`Kategori: ${target}`, {
          description: others.length
            ? `${base} · önceki ${previous[0].category}. Bu tedarikçinin ${others.length} faturası daha başka kategoride.`
            : `${base} · önceki ${previous[0].category}`,
          action: undo,
          duration: UNDO_MS,
          ...(others.length
            ? { cancel: { label: `${others.length} faturaya da uygula`, onClick: () => changeCategory(others.map((id) => ({ id, category: target }))) } }
            : {}),
        });
      } else {
        toast.success(previous.length === 1 ? `1 faturanın kategorisi “${target}” oldu` : `${previous.length} faturanın kategorisi “${target}” oldu`, {
          action: undo,
          duration: UNDO_MS,
        });
      }
    });
  }

  function bulkCategory(e: ChangeEvent<HTMLSelectElement>) {
    const c = e.target.value;
    e.target.value = "";
    if (!c) return;
    changeCategory(selected.map((i) => ({ id: i.id, category: c })));
    clearSelection();
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
      if (!res.ok) return void toast.error(res.error);
      const { externalId, snapshot, quantitiesRecomputed } = res.data;
      const restore = async () => {
        keepScroll();
        const r = externalId ? await unignoreParasutBill(externalId) : snapshot ? await restoreInvoice(snapshot) : null;
        if (!r) return;
        if (!r.ok) return void toast.error(r.error);
        toast.success("Fatura geri alındı", { description: "message" in r.data ? r.data.message : `${splitSupplier(target.supplier).base} · ${dateTR(target.date)}` });
      };
      toast.success("Fatura silindi", {
        description: [
          `${splitSupplier(target.supplier).base} · ${dateTR(target.date)}`,
          quantitiesRecomputed ? "O ayın Paraşüt'ten gelen alınan miktarları yeniden hesaplandı." : null,
        ]
          .filter(Boolean)
          .join(" · "),
        action: { label: "Geri al", onClick: () => void restore() },
        duration: UNDO_MS,
      });
    });
  }

  /** "Ödenmedi" rozeti: tıklayınca ödendi işaretlenir; ödenmişte yaylı beliren "Ödendi". Kısmi ödemede kalan yazar. */
  const statusBadge = (i: InvoiceRow) =>
    i.unpaid ? (
      <span className="inline-flex flex-col items-start gap-0.5">
        <motion.button
          type="button"
          onClick={() => setPaid([i], true)}
          whileTap={reduce ? undefined : { scale: 0.94 }}
          transition={SPRING_PRESS}
          title="Ödendi olarak işaretle"
          aria-label={`${i.supplier}: ödenmedi. Ödendi olarak işaretle`}
          className="group/pay -my-1 inline-flex min-h-8 cursor-pointer items-center rounded-full pointer-coarse:min-h-11"
        >
          <Badge tone="red" dot className="transition-shadow group-hover/pay:ring-1 group-hover/pay:ring-bad/30">
            Ödenmedi
          </Badge>
        </motion.button>
        {isPartiallyPaid(i) ? (
          <span className="text-xs whitespace-nowrap text-warn tabular" title={`Ödenecek ${tl(i.payable, 2)}; Paraşüt'e göre kısmen ödendi`}>
            Kalan {tl(i.outstanding, 2)}
          </span>
        ) : null}
      </span>
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

  const sourceBadges = (i: InvoiceRow, note: string, base: string) => {
    const estimate = isEstimate(i) && !/tahmin/i.test(note);
    return (
      <>
        {i.source === "parasut" ? (
          <Badge tone="blue" title="Paraşüt'ten otomatik alındı; tutar ve tarih Paraşüt'ten gelir">
            Paraşüt
          </Badge>
        ) : null}
        {note ? (
          <Badge tone={/tahmin/i.test(note) ? "amber" : "gray"} dot={/tahmin/i.test(note)} title={`Tedarikçi adındaki not. Gelir-giderde “${base}” altında toplanır.`}>
            {note}
          </Badge>
        ) : null}
        {estimate ? (
          <Badge tone="amber" dot title="Notta tahmin / varsayım var (Excel'de sarı satır): tutarı faturayla karşılaştırın">
            tahmini
          </Badge>
        ) : null}
      </>
    );
  };

  /** Faturanın notu (Excel hücre notu, elle not); Paraşüt'ün otomatik notu gösterilmez */
  const noteLine = (i: InvoiceRow, className?: string) => {
    const n = visibleNote(i.note);
    if (!n) return null;
    return (
      <p className={cn("mt-1 flex items-start gap-1.5 text-xs text-ink-mute", className)} title={n}>
        <StickyNote size={12} className="mt-0.5 shrink-0 text-ink-quiet" aria-hidden="true" />
        <span className="line-clamp-2 break-words">
          <span className="sr-only">Not: </span>
          {notePreview(n)}
        </span>
      </p>
    );
  };

  const categoryPicker = (i: InvoiceRow) => (
    <CategorySelect
      value={i.category}
      label={`${splitSupplier(i.supplier).base}, ${dateTR(i.date)}: kategori`}
      onChange={(c) => changeCategory([{ id: i.id, category: c }], { from: i })}
    />
  );

  const checkbox = (i: InvoiceRow, className?: string) => (
    <label className={cn("relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-ink/[0.04] pointer-coarse:size-11", className)}>
      <input
        type="checkbox"
        checked={selectedIds.includes(i.id)}
        onChange={() => toggle(i.id)}
        aria-label={`${splitSupplier(i.supplier).base}, ${dateTR(i.date)} faturasını seç`}
        className="size-4 cursor-pointer rounded accent-ink pointer-coarse:size-5"
      />
    </label>
  );

  const selectedUnpaid = selected.filter((i) => i.unpaid);

  return (
    // Özet kartlarındaki ve aylık tablodaki bağlantılar buraya iner; telefonda sabit üst çubuğun altında kalmasın
    <Card id="fatura-listesi" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
      <CardHeader
        icon={<FileText />}
        title="Fatura listesi"
        description={
          <>
            <span className="lg:hidden">Karta dokunun: düzenlenir; sağdaki anahtar ödendi durumunu değiştirir. Birden çok faturayı “Seç” ile seçip toplu değiştirebilirsiniz.</span>
            <span className="max-lg:hidden">Satıra tıklayınca düzenlenir. Kategori satırdan değişir; birden çok faturayı seçip toplu değiştirebilirsiniz.</span>
          </>
        }
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
                  className="inline-flex cursor-pointer items-center gap-1 text-warn underline-offset-2 hover:underline pointer-coarse:min-h-11"
                >
                  <AnimatedNumber value={totalUnpaid} format={(v) => num(v)} className="font-semibold tabular" /> ödenmemiş
                </button>
              </>
            ) : null}
          </>
        }
        actions={
          // Telefonda aynı düğme başparmağın altında yüzer (aşağıda)
          <Button onClick={() => setEditing("new")} className="pointer-coarse:h-11 max-lg:hidden">
            <Plus size={16} /> Fatura ekle
          </Button>
        }
      />

      {/* Telefon: arama + tek "Süzgeç" düğmesi; seçimler alt sayfada, etkin olanlar çip olarak burada */}
      <div role="search" className="space-y-2.5 px-4 pb-3 lg:hidden">
        <div className="flex items-center gap-2">
          <SearchField
            value={q}
            onChange={setQ}
            placeholder="Fatura ara"
            label="Fatura ara: tedarikçi, fatura no, tutar, not"
            shortcut={false}
            className="flex-1 [&_input]:h-11"
          />
          <FilterButton count={chips.length} onClick={() => setSheetOpen(true)} />
        </div>
        <ActiveFilters items={chips} />
        <p className="flex min-h-6 items-center justify-between gap-2 text-[13px] text-ink-mute tabular" aria-live="polite">
          <span>
            {anyFilter ? (
              <>
                <span className="font-semibold text-ink">{num(visible.length)}</span> / {num(list.length)} fatura
              </>
            ) : (
              `${num(list.length)} fatura`
            )}
          </span>
          {visible.length ? (
            <span>
              net <span className="font-semibold text-ink">{tl(sum(netOf), 2)}</span>
            </span>
          ) : null}
        </p>
      </div>
      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Süzgeç ve sıralama"
        description={`${num(visible.length)} / ${num(list.length)} fatura gösteriliyor`}
        footer={
          <>
            <Button
              variant="ghost"
              className={SHEET_BTN}
              disabled={!chips.length && !q.trim()}
              onClick={() => {
                setQ("");
                clearQuery([...FILTER_KEYS, "sirala"]);
              }}
            >
              Temizle
            </Button>
            <Button className={SHEET_BTN} onClick={() => setSheetOpen(false)}>
              {visible.length ? `${num(visible.length)} faturayı göster` : "Kapat"}
            </Button>
          </>
        }
      >
        <div className={cn("space-y-4 pb-2", BIG_FIELDS)}>
          <ChoiceList<Status>
            label="Ödeme durumu"
            value={status}
            onChange={setStatus}
            options={[
              { value: "tumu", label: "Tümü", count: filtered.length },
              { value: "odenmedi", label: "Ödenmemiş", count: filteredUnpaid },
              { value: "odendi", label: "Ödendi", count: filtered.length - filteredUnpaid },
            ]}
          />
          <Field label="Kategori" htmlFor="m-cat">
            <Select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={cn(category && "ring-ink/40")}>
              <option value="">Tüm kategoriler</option>
              <option value={GOODS_FILTER}>Mal alımları (mal maliyeti)</option>
              {INVOICE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ay" htmlFor="m-ay">
            <Select id="m-ay" value={month} onChange={(e) => setMonth(e.target.value)} className={cn(month && "ring-ink/40")}>
              <option value="">Tüm aylar</option>
              {[...months].reverse().map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          {parasutCount && parasutCount < list.length ? (
            <ToggleRow
              title="Yalnız Paraşüt'ten gelenler"
              description={`${num(parasutCount)} fatura Paraşüt'ten otomatik alındı`}
              checked={!!source}
              onChange={(on) => setSource(on ? "parasut" : "")}
              label="Yalnız Paraşüt'ten gelen faturalar"
              onText="Açık"
              offText="Kapalı"
            />
          ) : null}
          <Field label="Sıralama" htmlFor="m-sort">
            <Select id="m-sort" value={sortValue} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <FilterBar active={anyFilter} onClear={clearFilters} shown={visible.length} total={list.length} unit="fatura" className="px-5 pb-4 max-lg:hidden">
        <SearchField value={q} onChange={setQ} placeholder="Tedarikçi, fatura no, tutar, not" label="Fatura ara" className="w-full lg:w-72" />
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
            className={cn("min-w-0 sm:w-44 pointer-coarse:h-11", category && "ring-ink/40")}
            aria-label="Kategori süzgeci"
          >
            <option value="">Tüm kategoriler</option>
            <option value={GOODS_FILTER}>Mal alımları (mal maliyeti)</option>
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className={cn("min-w-0 sm:w-36 pointer-coarse:h-11", month && "ring-ink/40")} aria-label="Ay">
            <option value="">Tüm aylar</option>
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {visible.length ? (
        <>
          {/* Telefon: seçim kipi (masaüstündeki başlık kutusunun karşılığı); kipte karta dokunmak seçer */}
          <div className="flex items-center justify-between gap-3 border-t border-line pr-2 pl-4 text-[13px] text-ink-mute lg:hidden">
            <span className="tabular">{picking ? `${num(selectedIds.length)} seçili` : `${num(pageIds.length)} fatura bu sayfada`}</span>
            <span className="flex items-center">
              {picking ? (
                <button
                  type="button"
                  onClick={() => selectIds(pageIds, !pageAll)}
                  className="min-h-11 cursor-pointer px-2.5 font-medium text-info underline-offset-2 hover:underline"
                >
                  {pageAll ? "Sayfadakileri bırak" : "Sayfadakileri seç"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (!picking) return setSelectMode(true);
                  clearSelection();
                  setSelectMode(false);
                }}
                aria-pressed={picking}
                className="min-h-11 min-w-11 cursor-pointer px-2.5 font-medium text-ink underline-offset-2 hover:underline"
              >
                {picking ? "Bitti" : "Seç"}
              </button>
            </span>
          </div>
          {/* Telefon: kart listesi. Tedarikçi, tarih, tutar, kategori hapı ve ödendi anahtarı; karta dokunmak düzenler */}
          <ul className="divide-y divide-line-strong/70 border-t border-line lg:hidden">
            {paged.slice.map((i) => {
              const { base, note } = splitSupplier(i.supplier);
              const net = netOf(i);
              const isSel = selectedIds.includes(i.id);
              const vat = i.payable - net;
              return (
                <li key={i.id} className={cn("px-4 pt-3 pb-3.5 transition-colors", isSel && "bg-surface/70")}>
                  <div className="flex items-start gap-2">
                    {picking ? checkbox(i, "-ml-1.5 -mt-1 size-11 pointer-coarse:size-11") : null}
                    <button
                      type="button"
                      onClick={() => (picking ? toggle(i.id) : setEditing(i))}
                      aria-pressed={picking ? isSel : undefined}
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-xl text-left"
                    >
                      {picking ? null : <Avatar name={base} className="mt-0.5" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] leading-5 font-medium break-words text-ink">{base}</span>
                        <span className="mt-0.5 block text-[13px] break-words text-ink-mute">
                          <span className="tabular">{dateTR(i.date)}</span>
                          {i.description ? ` · ${i.description}` : ""}
                        </span>
                        {i.invoiceNo ? <span className="mt-0.5 block text-xs break-all text-ink-quiet">No {i.invoiceNo}</span> : null}
                        {note || i.source === "parasut" || isEstimate(i) ? <span className="mt-1 flex flex-wrap gap-1">{sourceBadges(i, note, base)}</span> : null}
                      </span>
                      <span className="shrink-0 text-right tabular">
                        <span className="block text-[15px] leading-5 font-semibold text-ink">{tl(net, 2)}</span>
                        <span className="block text-xs text-ink-mute">KDV hariç</span>
                        {Math.abs(vat) >= 0.005 ? <span className="block text-xs text-ink-mute">öd. {tl(i.payable, 2)}</span> : null}
                      </span>
                    </button>
                  </div>
                  {noteLine(i, picking ? "pl-10" : "pl-12")}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                    {/* Telefonda yerel seçici yerine alt sayfa: 48px satırlar, rozet 13px kalır (iOS yakınlaştırmaz) */}
                    <CategoryPill value={i.category} label={`${base}, ${dateTR(i.date)}: kategori ${i.category}. Değiştir`} onClick={() => setCatFor(i.id)} />
                    <span className="ml-auto flex flex-col items-end">
                      <Switch
                        checked={!i.unpaid}
                        onChange={(paid) => setPaid([i], paid)}
                        label={`${base}, ${dateTR(i.date)}: ödendi`}
                        showText
                        onText="Ödendi"
                        offText="Ödenmedi"
                        className={cn("mx-0 h-11 px-2 text-sm pointer-coarse:h-11", i.unpaid && "text-bad")}
                      />
                    </span>
                  </div>
                  {i.unpaid && (isPartiallyPaid(i) || i.dueDate) ? (
                    <p className="mt-0.5 text-right text-xs text-warn tabular">
                      {isPartiallyPaid(i) ? `Kalan ${tl(i.outstanding, 2)}` : null}
                      {isPartiallyPaid(i) && i.dueDate ? " · " : null}
                      {i.dueDate ? `Vade ${dateTR(i.dueDate)}` : null}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line-strong px-5 py-3 text-sm font-semibold lg:hidden">
            <span>{anyFilter ? `Süzülen ${num(visible.length)} fatura` : `${num(visible.length)} fatura`}</span>
            <span className="text-right tabular">
              {tl(sum(netOf), 2)} <span className="text-xs font-normal text-ink-mute">net</span>
              <span className="block text-xs font-normal text-ink-mute">ödenecek {tl(sum((i) => i.payable), 2)}</span>
            </span>
          </div>

          <TableWrap className="max-lg:hidden">
            <Table>
              <THead>
                <tr>
                  <TH sticky>
                    <span className="inline-flex items-center gap-2">
                      <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-ink/[0.04]" title="Bu sayfadakileri seç">
                        <input
                          type="checkbox"
                          checked={pageAll}
                          ref={(el) => {
                            if (el) el.indeterminate = pageSome;
                          }}
                          onChange={() => selectIds(pageIds, !pageAll)}
                          aria-label={pageAll ? "Bu sayfadaki seçimleri kaldır" : "Bu sayfadaki faturaları seç"}
                          className="size-4 cursor-pointer rounded accent-ink"
                        />
                      </label>
                      <SortButton dir={dirOf("tedarikci")} onClick={() => toggleSort("tedarikci")}>
                        Tedarikçi
                      </SortButton>
                      <InfoTip text="Adın sonundaki parantezli not ayrı tedarikçi sayılmaz: “Kaldi (ödenmedi)” gelir-giderde “Kaldi” altında toplanır. Not ya da adında “tahmin” / “varsayım” geçen fatura turuncu “tahmini” işaretlenir. Soldaki kutuyla seçip toplu değiştirin." />
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
                      <InfoTip text="Excel'deki açılır liste gibi satırdan değiştirin. Yeşil: mal maliyeti, gelir-giderde tedarikçi bazında. Mavi: komisyon giderleri. Gri: gelir-gider tablosuna girmez, sabit giderlerden izlenir. Paraşüt eşitlemesi kategoriyi korur." />
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
                      <InfoTip text="“Ödenmedi” rozetine tıklayınca fatura ödendi olarak işaretlenir; bildirimdeki “Geri al” ile geri alınır. Kısmen ödenmiş Paraşüt faturasında kalan tutar altında yazar." />
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
                  const isSel = selectedIds.includes(i.id);
                  return (
                    <TR key={i.id} className={cn("cursor-pointer", isSel && "bg-surface/70")} onClick={() => setEditing(i)} aria-selected={isSel || undefined}>
                      <TD sticky className="min-w-56 max-w-96">
                        <div className="flex items-center gap-3">
                          {/* Avatar, satırın üzerine gelince / klavyeyle / seçim varken seçim kutusuna döner (dokunmatikte hep kutu) */}
                          <span onClick={(e) => e.stopPropagation()} className="relative flex size-9 shrink-0 items-center justify-center">
                            <span
                              className={cn(
                                "flex transition-opacity duration-150",
                                hasSelection ? "opacity-0" : "group-hover:opacity-0 group-focus-within:opacity-0 pointer-coarse:opacity-0",
                              )}
                            >
                              <Avatar name={base} />
                            </span>
                            <span
                              className={cn(
                                "absolute inset-0 flex items-center justify-center transition-opacity duration-150",
                                hasSelection ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100",
                              )}
                            >
                              {checkbox(i)}
                            </span>
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium break-words text-ink">{base}</span>
                              {sourceBadges(i, note, base)}
                            </div>
                            {second ? <p className="mt-0.5 text-[13px] break-words text-ink-mute">{second}</p> : null}
                            {noteLine(i)}
                          </div>
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-ink-soft tabular">
                        {dateTR(i.date)}
                        {i.unpaid && i.dueDate ? <span className="block text-xs text-warn">Vade {dateTR(i.dueDate)}</span> : null}
                      </TD>
                      <TD>{categoryPicker(i)}</TD>
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
                            <IconButton label="Ödendi olarak işaretle" onClick={() => setPaid([i], true)}>
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
                  <TD colSpan={3}>{anyFilter ? `Süzülen ${num(visible.length)} fatura toplamı` : `${num(visible.length)} fatura toplamı`}</TD>
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

      {/* Toplu işlem çubuğu: seçim varken altta yüzer */}
      <FloatingBar open={selected.length > 0}>
        <p className="min-w-0 text-sm text-ink" aria-live="polite">
          <span className="font-semibold tabular">{selected.length}</span> fatura seçildi
          <span className="text-ink-mute tabular"> · net {tl(selected.reduce((a, i) => a + netOf(i), 0), 2)}</span>
          {selected.length < visible.length && pageAll ? (
            <button
              type="button"
              onClick={() => selectIds(visible.map((i) => i.id), true)}
              className="ml-2 cursor-pointer font-medium text-info underline-offset-2 hover:underline pointer-coarse:min-h-11"
            >
              Süzülen {visible.length} faturanın tümünü seç
            </button>
          ) : null}
        </p>
        {/* Telefonda tek satır: seçim kutusu kalan genişliği alır */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Select defaultValue="" onChange={bulkCategory} aria-label="Seçilenlerin kategorisini değiştir" className="min-w-0 flex-1 font-medium text-ink sm:w-auto sm:min-w-44 sm:flex-none">
            <option value="" disabled>
              Kategori ata…
            </option>
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          {selectedUnpaid.length ? (
            <Button
              variant="secondary"
              title={selectedUnpaid.length === selected.length ? undefined : `Seçilenlerden ödenmemiş ${selectedUnpaid.length} faturayı ödendi yapar`}
              onClick={() => {
                setPaid(selected, true);
                clearSelection();
              }}
            >
              <CircleCheck size={16} /> {selectedUnpaid.length === selected.length ? "Ödendi yap" : `Ödendi yap (${selectedUnpaid.length})`}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setPaid(selected, false);
                clearSelection();
              }}
            >
              Ödenmedi yap
            </Button>
          )}
          <IconButton label="Seçimi kaldır (Esc)" onClick={clearSelection}>
            <X size={15} />
          </IconButton>
        </div>
      </FloatingBar>

      {/* Telefon ve tablet: "Fatura ekle" başparmağın altında, alt gezinme çubuğunun üstünde (seçim çubuğu açıkken
          gizli). Aşağı kaydırırken kaybolur: kartlardaki ödendi anahtarını ve aylık listedeki tutarları örtmez. */}
      {selected.length === 0 ? (
        <Fab onClick={() => setEditing("new")} className="h-12 pr-5 pl-4">
          <Plus size={18} aria-hidden="true" /> Fatura ekle
        </Fab>
      ) : null}

      <Dialog
        open={catRow !== null}
        onClose={() => setCatFor(null)}
        title="Kategori"
        description={catRow ? `${splitSupplier(catRow.supplier).base} · ${dateTR(catRow.date)} · ${tl(netOf(catRow), 2)}` : undefined}
      >
        {catRow ? (
          <div className="space-y-3 pb-2">
            <ChoiceList
              label="Faturanın kategorisi"
              value={catRow.category}
              onChange={(c) => {
                setCatFor(null);
                if (c !== catRow.category) changeCategory([{ id: catRow.id, category: c }], { from: catRow });
              }}
              options={INVOICE_CATEGORIES.map((c) => ({
                value: c,
                label: (
                  <span className="flex items-center gap-2.5">
                    <span className={cn("size-2 shrink-0 rounded-full", CATEGORY_DOT[categoryTone(c)])} aria-hidden="true" />
                    {c}
                  </span>
                ),
              }))}
            />
            <p className="text-xs leading-5 text-ink-mute">
              Yeşil: mal maliyeti, gelir-giderde tedarikçi bazında. Mavi: komisyon giderleri. Gri: gelir-gider tablosuna girmez, sabit giderlerden izlenir.
            </p>
          </div>
        ) : null}
      </Dialog>

      {editing ? (
        <InvoiceDialog
          key={editing === "new" ? "new" : editing.id}
          invoice={editing === "new" ? null : editing}
          suppliers={suppliers}
          defaults={defaults}
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
        description={deleting ? <DeleteSummary invoice={deleting} ignoredCount={ignoredCount} /> : null}
      />
    </Card>
  );
}

/** Satır içi kategori seçimi: rozet görünümlü yerel <select> (telefonda sistem seçicisi açılır) */
function CategorySelect({ value, onChange, label }: { value: string; onChange: (category: string) => void; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value !== value) onChange(e.target.value);
      }}
      // Satıra tıklamak pencereyi açar; seçimin kendisi açmasın
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      title="Kategoriyi değiştir"
      className={cn(
        // field-sizing: seçili kategorinin genişliği (en uzun seçeneğinki değil)
        "h-7 max-w-full cursor-pointer appearance-none truncate rounded-full border-0 bg-no-repeat py-0 pr-6 pl-2.5 text-[11px] leading-4 font-medium outline-none [field-sizing:content]",
        "transition-shadow hover:ring-1 hover:ring-ink/25 focus-visible:ring-2 focus-visible:ring-ink/30 pointer-coarse:h-11",
        PILL_TONE[categoryTone(value)],
      )}
      style={{ backgroundImage: CHEVRON, backgroundPosition: "right 8px center", backgroundSize: "12px" }}
    >
      {INVOICE_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

/** Telefondaki kartta kategori rozeti: dokununca alt sayfa açılır. Görünen 36px, dokunma alanı 44px. */
function CategoryPill({ value, onClick, label }: { value: string; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={label}
      className={cn(
        "relative inline-flex h-9 max-w-full cursor-pointer items-center gap-1 rounded-full pr-2.5 pl-3 text-[13px] font-medium before:absolute before:-inset-1 before:content-['']",
        PILL_TONE[categoryTone(value)],
      )}
    >
      <span className="min-w-0 truncate">{value}</span>
      <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
    </button>
  );
}

/** Onay penceresindeki özet (ConfirmDialog açıklamayı <p> içine koyar; burada yalnızca satır içi öğeler) */
function DeleteSummary({ invoice, ignoredCount }: { invoice: InvoiceRow; ignoredCount: number }) {
  const linked = isParasutLinked(invoice);
  return (
    <>
      Gelir-gider tablosu yeniden hesaplanır. Bildirimdeki “Geri al” ile hemen geri alabilirsiniz.
      {linked
        ? ` Paraşüt'ten gelen fatura sonraki eşitlemelerde geri gelmez; sonradan sayfanın altındaki “Silinen Paraşüt faturaları”ndan${ignoredCount ? ` (şu an ${ignoredCount})` : ""} geri alınabilir.`
        : ""}
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
