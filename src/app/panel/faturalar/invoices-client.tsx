"use client";

import { Check, CheckCheck, ChevronDown, CircleCheck, FileText, Paperclip, Pencil, Plus, StickyNote, Trash2, X } from "lucide-react";
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
import { isPartiallyPaid, openBalance } from "@/lib/calc/insights";
import type { InvoiceCariLinks } from "@/lib/cari/account";
import { parasutDifference } from "@/lib/cari/balance";
import { COMMISSION_CATEGORY, GOODS_CATEGORIES, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { STOCK_ONLY_TEXT, stockOnlyCategory } from "@/lib/invoice-linking";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  confirmInvoices,
  deleteInvoice,
  restoreInvoice,
  restoreInvoicePayment,
  setInvoiceCategory,
  setInvoicePaid,
  unignoreParasutBill,
  type InvoicePaymentState,
} from "@/server/actions/invoices";
import type { DocumentMeta } from "@/server/documents";

import { supplierPairKey } from "../tedarikciler/logic";
import { canHaveDocument, isParasutDocument } from "./document-rules";
import { DocumentSheet } from "./document-sheet";
import { InvoiceDialog } from "./invoice-dialog";
import {
  confirmToast,
  isEInvoiceOnly,
  isEstimate,
  isParasutLinked,
  matchesStatus,
  notePreview,
  parseStatus,
  sameSupplierOthers,
  splitSupplier,
  statusCounts,
  supplierDefaults,
  visibleNote,
  type InvoiceRow,
  type InvoiceStatus,
} from "./rules";

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
  if (SEPARATE_CATEGORIES.includes(category)) return "violet";
  return "gray";
}

/** Badge tonlarıyla aynı renkler; satır içi kategori seçimi rozet gibi görünür */
const PILL_TONE: Partial<Record<Tone, string>> = {
  green: "bg-lime/25 text-good-ink",
  blue: "bg-info-soft text-info",
  gray: "bg-ink/[0.06] text-ink-soft ring-1 ring-inset ring-line-strong",
  violet: "bg-bordo-50 text-bordo-800",
};
/** Alt sayfadaki kategori listesinin renk noktası (rozetle aynı anlam) */
const CATEGORY_DOT: Partial<Record<Tone, string>> = { green: "bg-good", blue: "bg-info", gray: "bg-ink-quiet", violet: "bg-bordo-600" };
/** Renklerin anlamı (tablo başlığındaki bilgi ve telefondaki kategori sayfası); categoryTone ile aynı sıra */
const CATEGORY_LEGEND = `Yeşil: mal maliyeti, gelir-giderde tedarikçi bazında. Mavi: komisyon giderleri. Gri: Aylık harcamalar'da bir kategoriye bağlıysa gelir-giderde orada sayılır, değilse sabit giderlerden izlenir. Bordo: kafe dışı (${SEPARATE_CATEGORIES.join(", ")}), kafenin toplamlarına girmez.`;
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

/** "Mal alımları" hızlı filtresi: mal maliyeti sayılan üç kategori (adreste ?kategori=mal) */
const GOODS_FILTER = "mal";
const PAGE_SIZE = 25;
/** "Geri al"lı bildirimlerin süresi (silme, ödendi, kategori): okuyup karar verecek kadar */
const UNDO_MS = 10000;
/** "Temizle" düğmesinin sıfırladığı adres anahtarları (sıralama süzgeç sayılmaz, korunur) */
const FILTER_KEYS = ["ara", "durum", "kategori", "ay", "kaynak"];

/** Belgesi olmayan fatura için sabit boş liste (her çizimde yeni dizi olmasın) */
const NO_CARI: Record<number, InvoiceCariLinks> = {};
const NO_DOCS: DocumentMeta[] = [];

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
  /** Kategori değişince fatura kontrol edilmiş sayılır (sunucu da needsReview'u kaldırır); `review` geri almada yeniden işaretlenenler */
  | { kind: "category"; changes: { id: number; category: string }[]; review?: number[] }
  /** Onayla (needsReview false) ya da "Geri al" (true) */
  | { kind: "review"; ids: number[]; needsReview: boolean };

function applyChange(state: InvoiceRow[], a: Optimistic): InvoiceRow[] {
  if (a.kind === "delete") return state.filter((i) => i.id !== a.id);
  if (a.kind === "paid") {
    const ids = new Set(a.ids);
    return state.map((i) => (ids.has(i.id) ? { ...i, unpaid: !a.paid } : i));
  }
  if (a.kind === "review") {
    const ids = new Set(a.ids);
    return state.map((i) => (ids.has(i.id) ? { ...i, needsReview: a.needsReview } : i));
  }
  const next = new Map(a.changes.map((c) => [c.id, c.category]));
  const review = new Set(a.review ?? []);
  return state.map((i) => (next.has(i.id) || review.has(i.id) ? { ...i, category: next.get(i.id) ?? i.category, needsReview: review.has(i.id) } : i));
}

export function InvoicesClient({
  invoices,
  documents = {},
  months,
  suppliers,
  parasutCompanyId,
  ignoredCount = 0,
  expenseLinks,
  supplierSlugs,
  cariLinks = NO_CARI,
}: {
  invoices: InvoiceRow[];
  /** Fatura kimliği → saklanan belgeler (Paraşüt PDF kopyası, yüklenen fotoğraf / PDF); yalnız bilgileri */
  documents?: Record<number, DocumentMeta[]>;
  /** Paraşüt firma numarası; varsa Paraşüt'ten gelen faturada "Paraşüt'te aç" bağlantısı çıkar */
  parasutCompanyId?: string | null;
  months: string[];
  suppliers: string[];
  /** Silinip yok sayılan Paraşüt faturası sayısı (silme onayında geri alma yolunu söylemek için) */
  ignoredCount?: number;
  /** Fatura kategorisi → bağlı Aylık harcamalar kategorisinin adı (pencerenin kategori ipucu; verilmezse ipucu iki olasılığı da söyler) */
  expenseLinks?: Record<string, string>;
  /** (Ad, vergi no) çifti (supplierPairKey) → Tedarikçiler'deki sayfasının adres parçası (pencerede tedarikçi bağlantısı) */
  supplierSlugs?: Record<string, string>;
  /** Fatura kimliği → sayılan cari ödemeler ve bağlı faturasız alımlar (pencere ve silme onayı) */
  cariLinks?: Record<number, InvoiceCariLinks>;
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
  const [rawStatus, setStatus] = useQueryState<InvoiceStatus>("durum", "tumu");
  const [rawSource, setSource] = useQueryState<string>("kaynak", "");
  const [rawSort, setSort] = useQueryState<string>("sirala", DEFAULT_SORT);
  // Adresten gelen değerler doğrulanır: elle yazılmış ya da eskimiş bağlantı listeyi boşaltmasın
  const month = months.includes(rawMonth) ? rawMonth : "";
  const category = rawCategory === GOODS_FILTER || INVOICE_CATEGORIES.includes(rawCategory) ? rawCategory : "";
  const status = parseStatus(rawStatus);
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
  /** Belgesi açılan fatura (satırdan, karttan ya da fatura penceresinden) */
  const [docFor, setDocFor] = useState<number | null>(null);
  const defaults = useMemo(() => supplierDefaults(invoices), [invoices]);
  const docsOf = (id: number) => documents[id] ?? NO_DOCS;

  const parasutCount = list.filter((i) => i.source === "parasut").length;
  // Durum dışındaki filtreler: durum çiplerinin sayaçları bunlara göre
  const filtered = list.filter(
    (i) =>
      (!month || i.date.startsWith(month)) &&
      (!category || (category === GOODS_FILTER ? GOODS_CATEGORIES.includes(i.category) : i.category === category)) &&
      (!source || i.source === "parasut") &&
      matches(haystack(i), q),
  );
  const counts = statusCounts(filtered);
  const filteredUnpaid = counts.unpaid;
  const byStatus = filtered.filter((i) => matchesStatus(i, status));
  /** "Kontrol bekleyen" çipi: bekleyen varsa en başta; süzgeç açıkken sayı 0'a inse de (kapatılabilsin) */
  const showReviewChip = counts.review > 0 || status === "kontrol";
  const totalReview = list.filter((i) => i.needsReview).length;
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
  if (status !== "tumu") {
    chips.push({ key: "durum", label: status === "kontrol" ? "Kontrol bekleyen" : status === "odenmedi" ? "Ödenmemiş" : "Ödendi", onRemove: () => setStatus("tumu") });
  }
  if (category) chips.push({ key: "kategori", label: category === GOODS_FILTER ? "Mal alımları" : category, onRemove: () => setCategory("") });
  if (month) chips.push({ key: "ay", label: monthLabel(month), onRemove: () => setMonth("") });
  if (source) chips.push({ key: "kaynak", label: "Paraşüt'ten", onRemove: () => setSource("") });
  if (sortValue !== DEFAULT_SORT) {
    chips.push({ key: "sirala", label: SORT_OPTIONS.find((o) => o.value === sortValue)?.label ?? "Özel sıra", onRemove: () => setSort(DEFAULT_SORT) });
  }
  const catRow = catFor === null ? null : (list.find((i) => i.id === catFor) ?? null);
  const docRow = docFor === null ? null : (list.find((i) => i.id === docFor) ?? null);
  /** Telefonda seçim kutuları görünür: "Seç" kipi açıkken ya da seçim varken */
  const picking = selectMode || selectedIds.length > 0;

  /** Sayfa değişince listenin başına dönülür (ui/pagination: liste başı ekranın üstündeyse kaydırır) */
  const toPage = (p: number) => paged.setPage(p);

  /**
   * Ödendi / ödenmedi (tek fatura ya da seçilenler). Bildirimdeki "Geri al" faturaların önceki ödeme alanlarını
   * olduğu gibi geri yazar (ödeme günü, şekli, talep günü; undoPaid).
   */
  function setPaid(targets: InvoiceRow[], paid: boolean) {
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
      const changed = targets.filter((i) => ids.includes(i.id));
      // Önce hesaptaki cari ödemesi kullanılır (K6): ne kadarının sayıldığı söylenir
      const used = res.data.credit?.used ?? 0;
      const description = [
        changed.length === 1 ? `${splitSupplier(changed[0].supplier).base} · ${tl(changed[0].payable, 2)}` : `${changed.length} fatura · ${tl(changed.reduce((a, i) => a + i.payable, 0), 2)}`,
        used > 0.005 ? `hesaptaki ${tl(used, 2)} sayıldı` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(paid ? "Ödendi olarak işaretlendi" : "Ödenmedi olarak işaretlendi", {
        description,
        action: { label: "Geri al", onClick: () => undoPaid(res.data.previous, !paid) },
        // Silme bildirimleriyle aynı süre: "Geri al" birkaç saniyede kaybolmasın
        duration: UNDO_MS,
      });
    });
  }

  function undoPaid(previous: InvoicePaymentState[], paid: boolean) {
    if (!previous.length) return;
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "paid", ids: previous.map((p) => p.id), paid });
      const res = await restoreInvoicePayment(previous);
      if (!res.ok) return void toast.error(res.error);
      toast.success(paid ? "Yeniden ödendi olarak işaretlendi" : "Yeniden ödenmedi olarak işaretlendi");
    });
  }

  /**
   * Kategori değişikliği (satır içi, toplu, geri alma, "aynı tedarikçinin diğerlerine"). Kategorisi tahminle
   * yazılmış fatura bununla onaylanmış olur; "Geri al" kategoriyle birlikte "Kontrol" işaretini de geri koyar.
   */
  function changeCategory(changes: { id: number; category: string }[], opts: { undo?: boolean; from?: InvoiceRow; reReview?: number[] } = {}) {
    if (!changes.length) return;
    keepScroll();
    // "Hepsine uygula" önerisi değişiklikten önceki listeye göre (aynı tedarikçinin farklı kategorideki diğerleri)
    const others = opts.from ? sameSupplierOthers(list, opts.from, changes[0].category) : [];
    const ids = new Set(changes.map((c) => c.id));
    const wasReview = list.filter((i) => ids.has(i.id) && i.needsReview).map((i) => i.id);
    const reReview = opts.reReview ?? [];
    startTransition(async () => {
      applyOptimistic({ kind: "category", changes, review: reReview });
      const res = await setInvoiceCategory(changes);
      if (!res.ok) return void toast.error(res.error);
      if (reReview.length) {
        const back = await confirmInvoices(reReview, true);
        if (!back.ok) toast.error(back.error);
      }
      const { previous, missing } = res.data;
      if (missing) toast.warning(`${missing} fatura bulunamadı (silinmiş olabilir)`);
      // Mal alışı olmayan kategoriye geçen (ya da onda onaylanan) kalemi hammaddeye bağlı fatura kontrolde kalır (E-07)
      const kept = res.data.stockOnly.map((id) => list.find((i) => i.id === id)).filter((i): i is InvoiceRow => Boolean(i));
      if (kept.length) {
        const target = new Map(changes.map((c) => [c.id, c.category]));
        stockOnlyWarning(kept.map((i) => ({ ...i, category: target.get(i.id) ?? i.category })));
      }
      if (opts.undo) return void toast.success("Kategori geri alındı");
      if (!previous.length) {
        // Kategori zaten buydu: değişiklik yok ama tahmin onaylandı
        if (!wasReview.length) return;
        const confirmed = list.filter((i) => wasReview.includes(i.id));
        const t = confirmToast(confirmed);
        return void toast.success(t.title, {
          description: t.description,
          action: { label: "Geri al", onClick: () => confirmRows(confirmed.map((i) => ({ ...i, needsReview: false })), { undo: true }) },
          duration: UNDO_MS,
        });
      }
      const undo = { label: "Geri al", onClick: () => changeCategory(previous, { undo: true, reReview: wasReview }) };
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

  /**
   * Kontrolde kalan faturalar (E-07): kalemi hammaddeye bağlı, kategorisi mal alışı değil; stoğa giriyor, gelir-gidere
   * girmiyor. Kategorisi değişmeli; tek faturada bilerek "Kalsın" denebilir (kalemler stoğa girmeye devam eder)
   */
  function stockOnlyWarning(kept: InvoiceRow[]) {
    if (!kept.length) return;
    const one = kept.length === 1 ? kept[0] : null;
    toast.warning(one ? `${splitSupplier(one.supplier).base}: kontrolde kaldı` : `${kept.length} fatura kontrolde kaldı`, {
      description: one ? `${STOCK_ONLY_TEXT} Bilerek “${one.category}” kalacaksa Kalsın'a dokunun.` : `${STOCK_ONLY_TEXT} Faturaları tek tek açın.`,
      duration: 12_000,
      ...(one ? { action: { label: "Kalsın", onClick: () => acceptStockOnly(one) } } : {}),
    });
  }

  /** "Kalsın": kategorisi bilerek mal alışı değil; fatura onaylanır ve yeniden kontrole düşmez (geri alınabilir) */
  function acceptStockOnly(i: InvoiceRow) {
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "review", ids: [i.id], needsReview: false });
      const res = await confirmInvoices([i.id], false, { acceptStockOnly: true });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${splitSupplier(i.supplier).base}: ${i.category} kaldı`, {
        description: "Hammaddeye bağlı kalemleri stoğa girmeye devam eder; gelir-gidere girmez.",
        action: { label: "Geri al", onClick: () => confirmRows([{ ...i, needsReview: false }], { undo: true }) },
        duration: UNDO_MS,
      });
    });
  }

  /**
   * Eşitlemenin tahmin ettiği kategoriyi onaylar (✓ Onayla, seçilenler, Hepsini onayla). Satır hemen "Kontrol"
   * işaretini kaybeder; bildirimdeki "Geri al" aynı faturaları yeniden kontrol bekleyene döndürür. Kalemi hammaddeye
   * bağlı, kategorisi mal alışı olmayan fatura onaylanmaz (E-07; stockOnlyWarning).
   */
  function confirmRows(targets: InvoiceRow[], opts: { undo?: boolean } = {}) {
    const undo = Boolean(opts.undo);
    const rows = targets.filter((i) => Boolean(i.needsReview) !== undo);
    const ids = rows.map((i) => i.id);
    if (!ids.length) return;
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "review", ids, needsReview: undo });
      const res = await confirmInvoices(ids, undo);
      if (!res.ok) return void toast.error(res.error);
      const done = rows.filter((i) => res.data.ids.includes(i.id));
      if (undo) {
        if (done.length) toast.success(done.length === 1 ? "Yeniden kontrol bekliyor" : `${done.length} fatura yeniden kontrol bekliyor`);
        return;
      }
      // Kalemi hammaddeye bağlı, kategorisi mal alışı olmayan fatura onaylanmadı (E-07): neden ve tek faturada "Kalsın"
      stockOnlyWarning(rows.filter((i) => res.data.kept.includes(i.id)));
      if (!done.length) return void (res.data.kept.length ? undefined : toast.info("Bu faturalar zaten onaylanmış"));
      const t = confirmToast(done);
      toast.success(t.title, {
        description: t.description,
        action: { label: "Geri al", onClick: () => confirmRows(done.map((i) => ({ ...i, needsReview: false })), { undo: true }) },
        duration: UNDO_MS,
      });
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
          {i.paymentRequestedAt ? (
            <Badge tone="blue" dot className="transition-shadow group-hover/pay:ring-1 group-hover/pay:ring-info/30" title={`Ödemesi ${dateTR(i.paymentRequestedAt)} tarihinde talep edildi (Tedarikçiler)`}>
              Talep edildi
            </Badge>
          ) : (
            <Badge tone="red" dot className="transition-shadow group-hover/pay:ring-1 group-hover/pay:ring-bad/30">
              Ödenmedi
            </Badge>
          )}
        </motion.button>
        {isPartiallyPaid(i) ? (
          <span className="text-xs whitespace-nowrap text-warn tabular" title={`Ödenecek ${tl(i.payable, 2)}; ${i.ledgerBase != null ? "panelde kısmen ödendi" : "Paraşüt'e göre kısmen ödendi"}`}>
            Kalan {tl(openBalance(i), 2)}
          </span>
        ) : null}
        {parasutDiff(i) ? <span className="text-xs whitespace-nowrap text-ink-mute tabular">{parasutDiff(i)}</span> : null}
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
        {isEInvoiceOnly(i) ? (
          <Badge tone="gray" title="Paraşüt'e gelen e-faturadan doğrudan alındı (Paraşüt'te “içeri al” yapılmadı); PDF'i belge simgesinden açılır">
            e-fatura
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

  const reviewBadge = (i: InvoiceRow) =>
    i.stockOnly && stockOnlyCategory(i.category) ? (
      // Kalemi hammaddeye bağlı, kategorisi mal alışı değil (E-07); "kalsın" denmişse yalnız bilgi
      i.needsReview ? (
        <Badge tone="amber" dot title={STOCK_ONLY_TEXT}>
          Mal alışı sayılmıyor
        </Badge>
      ) : (
        <Badge tone="gray" title="Kalemleri hammaddeye bağlı, kategorisi mal alışı değil: stoğa giriyor, gelir-gidere girmiyor">
          Stoğa giriyor
        </Badge>
      )
    ) : i.needsReview ? (
      <Badge tone="amber" dot title="Kategori eşitlemede tahminle yazıldı: doğruysa onaylayın, değilse kategoriyi değiştirin (değiştirmek de onaylar)">
        Kontrol
      </Badge>
    ) : null;

  /** Satırın belge düğmesi: Paraşüt'e bağlıysa PDF simgesi, yalnız yüklenen dosya varsa ataş */
  const docButton = (i: InvoiceRow, className?: string) =>
    canHaveDocument(i, docsOf(i.id).length) ? (
      <IconButton
        label="Belgeyi aç"
        aria-haspopup="dialog"
        onClick={(e) => {
          // Masaüstünde satıra tıklamak düzenleme penceresini açar
          e.stopPropagation();
          setDocFor(i.id);
        }}
        className={className}
      >
        {isParasutDocument(i) ? <FileText size={15} /> : <Paperclip size={15} />}
      </IconButton>
    ) : null;

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
  const selectedReview = selected.filter((i) => i.needsReview);
  /** "Kontrol bekleyen" süzgecinde seçim yokken alttaki çubuk "Hepsini onayla"yı gösterir */
  const reviewBar = status === "kontrol" && visible.length > 0 && selected.length === 0;
  const barOpen = selected.length > 0 || reviewBar;
  const allSelected = selected.length > 0 && selected.length === visible.length;
  const confirmLabel =
    status === "kontrol" && allSelected
      ? `Hepsini onayla (${num(selectedReview.length)})`
      : selectedReview.length === selected.length
        ? "Onayla"
        : `Onayla (${num(selectedReview.length)})`;
  const confirmSelected = () => {
    confirmRows(selected);
    clearSelection();
  };

  return (
    // Özet kartlarındaki ve aylık tablodaki bağlantılar buraya iner; telefonda sabit üst çubuğun altında kalmasın
    <Card id="fatura-listesi" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
      <CardHeader
        icon={<FileText />}
        title="Fatura listesi"
        description={
          <>
            <span className="lg:hidden">
              Karta dokunun: düzenlenir; sağdaki anahtar ödendi durumunu değiştirir, belge simgesi faturanın PDF&apos;ini açar. Birden çok faturayı “Seç” ile seçip toplu değiştirebilirsiniz.
            </span>
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
            {totalReview ? (
              // Telefonda satıra sığmaz; orada listenin üstündeki uyarı ve süzgeç aynı işi görür
              <>
                <span aria-hidden="true" className="max-sm:hidden">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => setStatus(status === "kontrol" ? "tumu" : "kontrol")}
                  className="inline-flex cursor-pointer items-center gap-1 text-warn underline-offset-2 hover:underline pointer-coarse:min-h-11 max-sm:hidden"
                >
                  <AnimatedNumber value={totalReview} format={(v) => num(v)} className="font-semibold tabular" /> kontrol bekliyor
                </button>
              </>
            ) : null}
          </>
        }
        actions={
          // Telefonda aynı düğme başparmağın altında yüzer (aşağıda). Tablette başlıkta: yüzen düğme ilk kartın
          // ödendi anahtarını örtüyordu (kartlar tam genişlikte, anahtar sağ kenarda)
          <Button onClick={() => setEditing("new")} className="pointer-coarse:h-11 max-sm:hidden">
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
          <ChoiceList<InvoiceStatus>
            label="Durum"
            value={status}
            onChange={setStatus}
            options={[
              { value: "tumu", label: "Tümü", count: filtered.length },
              ...(showReviewChip
                ? [
                    {
                      value: "kontrol" as const,
                      label: (
                        <span className="flex items-center gap-2.5">
                          <span className="size-2 shrink-0 rounded-full bg-brass-500" aria-hidden="true" />
                          Kontrol bekleyen
                        </span>
                      ),
                      count: counts.review,
                    },
                  ]
                : []),
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
        {showReviewChip ? (
          <FilterChip active={status === "kontrol"} onToggle={() => setStatus(status === "kontrol" ? "tumu" : "kontrol")} count={counts.review}>
            {status === "kontrol" ? null : <span className="size-1.5 rounded-full bg-brass-500" aria-hidden="true" />}
            Kontrol bekleyen
          </FilterChip>
        ) : null}
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
          {/* Telefon: kart listesi. Tedarikçi, tarih, tutar, rozetler ve belge, kategori hapı ve ödendi anahtarı. Kartın
              üst bölümü tek düğme; görünmez katmanı (before) bütün kartı kaplar, kartın içindeki öteki denetimler (seçim
              kutusu, belge, kategori, Onayla, anahtar) bu katmanın üstünde durur (relative z-10). */}
          <ul className="divide-y divide-line-strong/70 border-t border-line lg:hidden">
            {paged.slice.map((i) => {
              const { base, note } = splitSupplier(i.supplier);
              const net = netOf(i);
              const isSel = selectedIds.includes(i.id);
              const vat = i.payable - net;
              const doc = docButton(i, "relative size-9 before:absolute before:-inset-1 before:content-[''] pointer-coarse:size-9");
              const badges = note || i.source === "parasut" || isEstimate(i) || i.needsReview || (i.stockOnly && stockOnlyCategory(i.category));
              return (
                <li key={i.id} className={cn("relative px-4 pt-3 pb-3.5 transition-colors", isSel && "bg-surface/70")}>
                  <div className="flex items-start gap-2">
                    {picking ? checkbox(i, "z-10 -ml-1.5 -mt-1 size-11 pointer-coarse:size-11") : null}
                    <button
                      type="button"
                      onClick={() => (picking ? toggle(i.id) : setEditing(i))}
                      aria-pressed={picking ? isSel : undefined}
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-xl text-left outline-none before:absolute before:inset-0 before:content-[''] focus-visible:before:ring-2 focus-visible:before:ring-ink/30 focus-visible:before:ring-inset"
                    >
                      {picking ? null : <Avatar name={base} className="mt-0.5" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] leading-5 font-medium break-words text-ink">{base}</span>
                        <span className="mt-0.5 block text-[13px] break-words text-ink-mute">
                          <span className="tabular">{dateTR(i.date)}</span>
                          {i.description ? ` · ${i.description}` : ""}
                        </span>
                        {i.invoiceNo ? <span className="mt-0.5 block text-xs break-all text-ink-mute">No {i.invoiceNo}</span> : null}
                      </span>
                      <span className="shrink-0 text-right tabular">
                        <span className="block text-[15px] leading-5 font-semibold text-ink">{tl(net, 2)}</span>
                        <span className="block text-xs text-ink-mute">KDV hariç</span>
                        {Math.abs(vat) >= 0.005 ? <span className="block text-xs text-ink-mute">ödenecek {tl(i.payable, 2)}</span> : null}
                      </span>
                    </button>
                  </div>
                  {badges || doc ? (
                    // Rozetler ve belge düğmesi (tutarın altında, sağda)
                    <div className={cn("mt-1 flex items-center gap-2", picking ? "pl-10" : "pl-12")}>
                      <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                        {sourceBadges(i, note, base)}
                        {reviewBadge(i)}
                      </span>
                      {doc ? <span className="relative z-10 -my-1 shrink-0">{doc}</span> : null}
                    </div>
                  ) : null}
                  {noteLine(i, picking ? "pl-10" : "pl-12")}
                  <div className="relative z-10 mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      {/* Telefonda yerel seçici yerine alt sayfa: 48px satırlar, rozet 13px kalır (iOS yakınlaştırmaz) */}
                      <CategoryPill value={i.category} label={`${base}, ${dateTR(i.date)}: kategori ${i.category}. Değiştir`} onClick={() => setCatFor(i.id)} />
                      {i.needsReview ? <ConfirmPill onClick={() => confirmRows([i])} label={`${base}, ${dateTR(i.date)}: kategori ${i.category} doğru, onayla`} /> : null}
                    </span>
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
                      {isPartiallyPaid(i) ? `Kalan ${tl(openBalance(i), 2)}` : null}
                      {isPartiallyPaid(i) && i.dueDate ? " · " : null}
                      {i.dueDate ? `Vade ${dateTR(i.dueDate)}` : null}
                    </p>
                  ) : null}
                  {parasutDiff(i) ? <p className="mt-0.5 text-right text-xs text-ink-mute tabular">{parasutDiff(i)}</p> : null}
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
                      <InfoTip text={`Excel'deki açılır liste gibi satırdan değiştirin. ${CATEGORY_LEGEND} Paraşüt eşitlemesi kategoriyi korur.`} />
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
                              {/* Eylem sütununda değil: tablo 1280px'te sığsın (ad sütunu sarılır, genişlemez) */}
                              {docButton(i, "-my-1 size-7 text-ink-soft pointer-coarse:size-11")}
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
                      <TD>
                        {i.needsReview ? (
                          // Tahmin edilen kategori: altında "Kontrol" ve tek tıkla onay (sütun genişlemesin diye alt satırda)
                          <div className="flex flex-col items-start gap-1">
                            {categoryPicker(i)}
                            <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              {reviewBadge(i)}
                              <ConfirmPill size="sm" onClick={() => confirmRows([i])} label={`${splitSupplier(i.supplier).base}, ${dateTR(i.date)}: kategori ${i.category} doğru, onayla`} />
                            </span>
                          </div>
                        ) : i.stockOnly && stockOnlyCategory(i.category) ? (
                          // "Kalsın" denmiş (ya da henüz işaretlenmemiş) stoğa giren fatura: yalnız bilgi rozeti (E-07)
                          <div className="flex flex-col items-start gap-1">
                            {categoryPicker(i)}
                            {reviewBadge(i)}
                          </div>
                        ) : (
                          categoryPicker(i)
                        )}
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
          {status === "kontrol" && !counts.review ? (
            <EmptyState
              icon={<CheckCheck />}
              title="Kontrol bekleyen fatura kalmadı"
              description={
                totalReview
                  ? "Bu süzgeçte bekleyen yok; ay, kategori ya da aramayı temizleyince diğerleri görünür."
                  : "Eşitlemenin tahminle yazdığı bütün kategoriler onaylandı. Yeni faturalar her sabah gelir; kategorisi tahmin edilenler yeniden burada toplanır."
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!totalReview) return setStatus("tumu");
                    setQ("");
                    clearQuery(["ay", "kategori", "kaynak"]);
                  }}
                >
                  {totalReview ? "Süzgeci temizle" : "Tüm faturaları göster"}
                </Button>
              }
            />
          ) : list.length ? (
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

      {/* Toplu işlem çubuğu: seçim varken altta yüzer. "Kontrol bekleyen" süzgecinde seçim yokken kuyruğun tamamını
          onaylatır ("Hepsini onayla"). */}
      <FloatingBar open={barOpen}>
        {selected.length ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-ink sm:flex-none" aria-live="polite">
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
            {/* Telefonda Onayla sayının yanında (alt satırda kategori seçimine yer kalsın), masaüstünde düğmelerin başında */}
            {selectedReview.length ? (
              <Button onClick={confirmSelected} className="sm:hidden">
                <Check size={16} aria-hidden="true" /> {confirmLabel}
              </Button>
            ) : null}
            {/* Telefonda tek satır: seçim kutusu kalan genişliği alır */}
            <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
              {selectedReview.length ? (
                <Button onClick={confirmSelected} className="max-sm:hidden">
                  <Check size={16} aria-hidden="true" /> {confirmLabel}
                </Button>
              ) : null}
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
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-sm text-ink" aria-live="polite">
              <span className="font-semibold tabular">{num(visible.length)}</span> fatura kontrol bekliyor
              <span className="text-ink-mute max-sm:hidden"> · kategoriler tahminle yazıldı</span>
            </p>
            <Button onClick={() => confirmRows(visible)} className="max-sm:w-full max-sm:min-h-11">
              <CheckCheck size={16} aria-hidden="true" /> Hepsini onayla ({num(visible.length)})
            </Button>
          </>
        )}
      </FloatingBar>

      {/* Telefon: "Fatura ekle" başparmağın altında, alt gezinme çubuğunun üstünde (alttaki çubuk açıkken gizli).
          Aşağı kaydırırken kaybolur. Tablette (sm ve üstü) düğme kartın başlığında: tam genişlikteki kartlarda yüzen
          düğme ilk kartın ödendi anahtarını örtüyordu. */}
      {barOpen ? null : (
        <Fab onClick={() => setEditing("new")} className="h-12 pr-5 pl-4 sm:hidden">
          <Plus size={18} aria-hidden="true" /> Fatura ekle
        </Fab>
      )}

      <Dialog
        open={catRow !== null}
        onClose={() => setCatFor(null)}
        title="Kategori"
        description={catRow ? `${splitSupplier(catRow.supplier).base} · ${dateTR(catRow.date)} · ${tl(netOf(catRow), 2)}` : undefined}
        footer={
          catRow?.needsReview ? (
            <Button
              className={SHEET_BTN}
              onClick={() => {
                setCatFor(null);
                confirmRows([catRow]);
              }}
            >
              <Check size={16} aria-hidden="true" /> {catRow.category} doğru, onayla
            </Button>
          ) : undefined
        }
      >
        {catRow ? (
          <div className="space-y-3 pb-2">
            {catRow.needsReview ? (
              <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brass-500" aria-hidden="true" />
                {catRow.stockOnly && stockOnlyCategory(catRow.category)
                  ? STOCK_ONLY_TEXT
                  : "Kategori eşitlemede tahminle yazıldı. Doğruysa onaylayın; değilse doğrusunu seçin (seçmek de onaylar)."}
              </p>
            ) : null}
            <ChoiceList
              label="Faturanın kategorisi"
              value={catRow.category}
              onChange={(c) => {
                setCatFor(null);
                if (c !== catRow.category) changeCategory([{ id: catRow.id, category: c }], { from: catRow });
                // Tahmin edilen kategoriye yeniden dokunmak "doğru" demektir
                else if (catRow.needsReview) confirmRows([catRow]);
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
            <p className="text-xs leading-5 text-ink-mute">{CATEGORY_LEGEND}</p>
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
          documents={editing === "new" ? NO_DOCS : docsOf(editing.id)}
          onOpenDocuments={editing === "new" ? undefined : () => setDocFor(editing.id)}
          expenseLinks={expenseLinks}
          cari={editing === "new" ? undefined : cariLinks[editing.id]}
          supplierHref={(i) => {
            const slug = supplierSlugs?.[supplierPairKey(i.supplier, i.supplierTaxNumber)];
            return slug ? `/panel/tedarikciler/${slug}` : null;
          }}
        />
      ) : null}
      {/* Fatura penceresinden açılınca onun üstünde durur (sonra açılan modal en üstte) */}
      {docRow ? <DocumentSheet key={`belge-${docRow.id}`} invoice={docRow} documents={docsOf(docRow.id)} onClose={() => setDocFor(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Fatura silinsin mi?"
        confirmLabel="Faturayı sil"
        description={deleting ? <DeleteSummary invoice={deleting} ignoredCount={ignoredCount} cari={cariLinks[deleting.id]} /> : null}
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

/**
 * Tahmin edilen kategoriyi tek dokunuşla onaylar. Telefonda (md) kategori hapı boyunda, 36px görünür / 44px dokunma
 * alanı; tabloda (sm) rozet boyunda, dokunmatikte 44px.
 */
function ConfirmPill({ onClick, label, size = "md" }: { onClick: () => void; label: string; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title="Kategori doğru: onayla"
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-surface font-medium text-ink ring-1 ring-ink/20 transition-shadow ring-inset hover:ring-ink/45 focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none",
        size === "md" ? "h-9 pr-3 pl-2.5 text-[13px] before:absolute before:-inset-1 before:content-['']" : "h-6 pr-2 pl-1.5 text-[11px] pointer-coarse:h-11 pointer-coarse:px-3",
      )}
    >
      <Check size={size === "md" ? 14 : 12} aria-hidden="true" />
      Onayla
    </button>
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

/**
 * Paraşüt ipucu (§4.2): tedarikçiye panelde ödeme girildiyse (takipli fatura) kalan paneldendir; Paraşüt'ün kalanı
 * farklıysa yalnız bilgi olarak söylenir ("Paraşüt'te açık görünüyor" tedarikçi sayfasında)
 */
function parasutDiff(i: InvoiceRow): string | null {
  const d = parasutDifference(i);
  if (!d) return null;
  return d.lower ? `Paraşüt'te kalan ${tl(d.parasut, 2)}; panelde girilmemiş ödeme olabilir` : `Paraşüt'te kalan ${tl(d.parasut, 2)} (ödememiz henüz işlenmemiş olabilir)`;
}

/** Onay penceresindeki özet (ConfirmDialog açıklamayı <p> içine koyar; burada yalnızca satır içi öğeler) */
function DeleteSummary({ invoice, ignoredCount, cari }: { invoice: InvoiceRow; ignoredCount: number; cari?: InvoiceCariLinks }) {
  const linked = isParasutLinked(invoice);
  // Cari bağları (§6.4): sayılan ödemeler tedarikçinin hesabına geçer, bağlı faturasız alımlar yeniden açılır
  const counted = (cari?.payments ?? []).reduce((a, p) => a + p.amount, 0);
  const debts = cari?.debts.length ?? 0;
  return (
    <>
      Gelir-gider tablosu yeniden hesaplanır. Bildirimdeki “Geri al” ile hemen geri alabilirsiniz.
      {linked
        ? ` Paraşüt'ten gelen fatura sonraki eşitlemelerde geri gelmez; sonradan sayfanın altındaki “Silinen Paraşüt faturaları”ndan${ignoredCount ? ` (şu an ${ignoredCount})` : ""} geri alınabilir.`
        : ""}
      {counted > 0.005 ? ` Bu faturaya ${tl(counted, 2)} ödeme sayılmış; silinirse para tedarikçinin hesabına geçer${cari?.card ? ` (${cari.card})` : ""}.` : ""}
      {debts ? ` Bağlı ${debts} faturasız alım yeniden açılır.` : ""}
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
