"use client";

import {
  Bean,
  Box,
  Cake,
  Cherry,
  ChevronDown,
  Cookie,
  Download,
  Droplet,
  GlassWater,
  IceCreamCone,
  Milk,
  Package,
  Pencil,
  Plus,
  SearchX,
  Trash2,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { createElement, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { PriceLine } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, fold, markUrlWritten, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Pagination, useUrlPaged } from "@/components/ui/pagination";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { countUnitsFor } from "@/lib/calc/engine";
import { formatPercentInput, parseNumberTR, parsePercentInput } from "@/lib/calc/expr";
import type { CountUnit, Ingredient, Unit } from "@/lib/calc/types";
import { COUNT_GROUPS, INGREDIENT_CATEGORIES, UNITS } from "@/lib/constants";
import { isUnpriced } from "@/lib/count-item";
import { activeUses, productListText, usageText } from "@/lib/ingredient-usage";
import { dateTR, dayTR, num, pct, tl, tlUnit } from "@/lib/format";
import { bulkPrice } from "@/lib/supplier-prices";
import { cn } from "@/lib/utils";
import { deleteIngredient, saveIngredient, setIngredientActive, setIngredientEstimate, updateIngredientPrice } from "@/server/actions/ingredients";

import { FilterSheet, FilterSheetButton, FilterSummaryLine, SHEET_CHIP, SheetSection } from "../urunler/filter-sheet";
import { filterSummary } from "../urunler/filter-text";
import { priceText } from "../urunler/price-text";

import { catOrder } from "./categories";
import { countUnitHint, groupForCategory, historyText, nearMatch, vatForGroup, type IngredientDeps } from "./form-helpers";
import { scrollToHolds } from "./price-holds";
import { SupplierPrices } from "./supplier-prices";

export interface IngredientRow extends Ingredient {
  unitCost: number;
  /** Reçetesinde geçtiği ürünler, pasif ürünler dahil (`active` false: silme engeli, ama "Reçetede yok" sayılır) */
  usedIn: { id: number; label: string; active: boolean }[];
  monthUsage: number;
  /** Fiyat geçmişi, eskiden yeniye; note: kaynak ("Excel'den aktarıldı", Paraşüt fatura numarası) */
  history: { at: string; price: number; size: number; by: string | null; note: string | null }[];
  /** Silmeyi engelleyen geçmiş kayıt sayıları */
  deps: IngredientDeps;
  /** Son 30 günde %5'ten fazla fiyat değişimi (zam uyarısıyla aynı hesap); yoksa null */
  recentChange?: { pct: number; at: string } | null;
  /**
   * Paraşüt faturasından gelen, onay bekleyen fiyat (şimdikinden %40'tan fazla farklı; "Onay bekleyen fiyatlar"):
   * önerilen birim fiyat (₺ / birim), canlı fark, faturanın tedarikçisi ve tarihi; yoksa null
   */
  pendingHold?: { pct: number | null; proposed: number; supplier: string; date: string } | null;
}

/** fiyatsiz: paket fiyatı girilmemiş (sayımda "Listeye ekle" ile eklenen kalem; zildeki bağlantı ?durum=fiyatsiz) */
type Filter = "all" | "tahmini" | "fiyatsiz" | "kullanilmayan" | "pasif";
type SortKey = "name" | "packagePrice" | "unitCost" | "usedIn" | "monthUsage";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const PAGE_SIZE = 25;
/** Görünüm çiplerinin adları (telefon süzgeç özeti de kullanır) */
const FILTER_LABELS: Record<Filter, string> = { all: "Tümü", tahmini: "Tahmini", fiyatsiz: "Fiyat yok", kullanilmayan: "Reçetede yok", pasif: "Pasif" };
const FILTERS: Filter[] = ["all", "tahmini", "fiyatsiz", "kullanilmayan", "pasif"];
const SORT_KEYS: SortKey[] = ["name", "packagePrice", "unitCost", "usedIn", "monthUsage"];

/** Adresteki sıra: ?sirala=unitCost.desc */
function parseSort(v: string): Sort {
  const [key, dir] = v.split(".");
  if (!SORT_KEYS.includes(key as SortKey) || (dir !== "asc" && dir !== "desc")) return null;
  return { key: key as SortKey, dir };
}
const sortParam = (s: Sort) => (s ? `${s.key}.${s.dir}` : "");

/** Telefonda tablo başlığı yerine sıralama seçimi */
const MOBILE_SORTS: { value: string; label: string }[] = [
  { value: "", label: "Kategori sırası" },
  { value: "name.asc", label: "Ad (A → Z)" },
  { value: "packagePrice.desc", label: "Paket fiyatı (yüksekten)" },
  { value: "unitCost.desc", label: "Birim maliyet (yüksekten)" },
  { value: "usedIn.desc", label: "En çok reçetede olan" },
  { value: "monthUsage.desc", label: "Son ay en çok kullanılan" },
];

const CATEGORY_ICON: Record<string, LucideIcon> = {
  Kahve: Bean,
  Süt: Milk,
  "Sos & Şurup": Droplet,
  Püre: Cherry,
  Toz: Wheat,
  Dondurma: IceCreamCone,
  Tatlı: Cake,
  Atıştırmalık: Cookie,
  "Şişe İçecek": GlassWater,
  Ambalaj: Package,
};

/** Arama: ad, tedarikçi, paket, kategori ve Kaynak / not (ör. "varsayım" yazınca doğrulanacaklar çıkar) */
const searchText = (r: IngredientRow) => `${r.name} ${r.supplier ?? ""} ${r.packageDesc ?? ""} ${r.category} ${r.note ?? ""}`;

const sortValue = (r: IngredientRow, key: Exclude<SortKey, "name">) => (key === "usedIn" ? activeUses(r) : r[key]);

/** Filtrenin aktif/pasif koşulu: "Pasif" dışındaki her görünüm aktif malzemeleri listeler */
const inScope = (r: IngredientRow, filter: Filter) => (filter === "pasif" ? !r.active : r.active);

/** Tahmini satırların zemini; sabit ilk hücrede opak karışım (altından kayan hücreler görünmesin) */
const ESTIMATE_ROW = "bg-warn-soft/45";
const ESTIMATE_STICKY = "bg-[color-mix(in_oklab,var(--color-warn-soft)_45%,var(--color-panel))]";

/** Türkçe Excel'in açtığı CSV: noktalı virgül ayraç, UTF-8 BOM, virgüllü ondalık */
function downloadCsv(filename: string, lines: (string | number)[][]) {
  const cell = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
  const csv = "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sayfa karolarındaki rakam: açılışta sayarak gelir (AkmanOS AnimatedNumber); hareket azaltılmışsa doğrudan yazar */
export function CountUp({ value, digits = 0, suffix = "" }: { value: number; digits?: number; suffix?: string }) {
  return <AnimatedNumber value={value} format={(v) => `${num(v, digits, digits)}${suffix}`} />;
}

/** Görünen listedeki fiyat alanları, ekrandaki sırayla (tablo ya da telefon kartları; gizli kopya ve su satırları atlanır) */
function visiblePriceInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>("input[data-price-input]")].filter((el) => el.offsetParent !== null);
}

/**
 * "Listede göster": liste kartının başını ekrana getirir (telefonda liste, "Yeni hammadde" düğmesinin ~700px altında;
 * yalnızca adresi değiştirmek görünür bir şey yapmazdı). Next önceki sayfaların gizli kopyalarını tuttuğu için görünen
 * kart seçilir; süzülmüş liste çizildikten sonra kaydırılır.
 */
function showList() {
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll<HTMLElement>("[data-ingredient-list]")].find((el) => el.offsetParent !== null);
    if (!card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "start", behavior: reduce ? "instant" : "smooth" });
  });
}

/** Excel'deki gibi: Enter ya da ↓ alttaki satırın fiyatına, ↑ üsttekine geçer (geçerken bu satır kaydedilir) */
function focusSibling(from: HTMLInputElement, step: 1 | -1): boolean {
  const list = visiblePriceInputs();
  const next = list[list.indexOf(from) + step];
  if (!next) return false;
  next.focus();
  return true;
}

/**
 * Satır içinde paket fiyatı: Enter kaydeder ve alttaki satıra geçer, ↑/↓ satırlar arasında gezer, alandan çıkmak da
 * kaydeder, Esc vazgeçer. Birim (₺) hep görünür. "Tahmini" malzemede işaret kendiliğinden kalkmaz (varsayım paket
 * içeriği ya da ürün eşleştirmesiyle ilgili olabilir): bildirimdeki düğmeyle kaldırılır.
 */
function PackagePriceCell({ row, className }: { row: IngredientRow; className?: string }) {
  const [value, setValue] = useState(priceText(row.packagePrice));
  const [last, setLast] = useState(row.packagePrice);
  const [saving, setSaving] = useState(false);
  // Esc'teki blur, eski değeri görür (setValue henüz çizilmedi); bu bayrak o blur'da kaydı atlatır
  const cancelled = useRef(false);
  if (row.priceSource === "water")
    return (
      <Badge tone="blue" title="Fiyat su faturasından hesaplanır">
        su faturasından
      </Badge>
    );
  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return setValue(priceText(last));
    }
    const v = parseNumberTR(value);
    if (v === null || v < 0) {
      setValue(priceText(last));
      return toast.error(`${row.name}: geçerli bir fiyat girin (ör. 1.022 ya da 49,50)`);
    }
    if (Math.abs(v - last) < 0.0001) return setValue(priceText(v));
    setSaving(true);
    const keepEstimate = row.isEstimate;
    const res = await tryAction(() => updateIngredientPrice(row.id, v, !keepEstimate));
    setSaving(false);
    // Kaydedilemeyen fiyat kutuda kalmaz (kaydedilmiş gibi görünmesin); atılan eylemin bildirimi tryAction'dan (E-51)
    if (!res?.ok) {
      setValue(priceText(last));
      if (res) toast.error(res.error);
      return;
    }
    setLast(v);
    setValue(priceText(v));
    const used = row.usedIn.length ? `${num(row.usedIn.length)} ürünün maliyeti güncellendi.` : "Hiçbir reçetede kullanılmıyor.";
    toast.success(`${row.name}: ${tl(last, 2)} → ${tl(v, 2)}`, {
      id: `price-${row.id}`,
      description: keepEstimate ? `${used} Tahmini işareti duruyor; varsayım doğrulandıysa kaldırın.` : used,
      duration: keepEstimate ? 10_000 : undefined,
      action: keepEstimate
        ? {
            label: "Tahmini işaretini kaldır",
            onClick: async () => {
              const r = await tryAction(() => setIngredientEstimate(row.id, false));
              toast.dismiss(`price-${row.id}`);
              if (!r) return;
              if (r.ok) toast.success(`${row.name}: Tahmini işareti kaldırıldı`);
              else toast.error(r.error);
            },
          }
        : undefined,
    });
  }
  return (
    <div className={cn("relative inline-block w-28", className)}>
      <NumberInput
        value={value}
        disabled={saving}
        data-price-input=""
        enterKeyHint="next"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const el = e.currentTarget;
            // Son satırda Enter yalnızca kaydeder
            if (!focusSibling(el, e.key === "ArrowUp" ? -1 : 1)) el.blur();
          }
          if (e.key === "Escape") {
            cancelled.current = true;
            setValue(priceText(last));
            e.currentTarget.blur();
          }
        }}
        aria-label={`${row.name} paket fiyatı (₺, KDV hariç, ${num(row.packageSize)} ${row.unit})`}
        // Telefon kartında 44px dokunma alanı ve 16px yazı (iOS alanı büyütmesin)
        className="cell-input bg-surface/70 pr-6 pl-2 ring-line hover:bg-surface hover:ring-line-strong focus:bg-surface pointer-coarse:h-11 max-sm:h-11 max-sm:font-semibold"
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-ink-mute" aria-hidden="true">
        ₺
      </span>
    </div>
  );
}

/**
 * Malzeme adı, rozetler ve kategori · tedarikçi (tablo ve telefon kartı). Excel'deki "Kaynak / Not" sütunu: tahmini
 * ya da reçetede olmayan malzemede not görünür (ne doğrulanacağını söyler), ötekilerde üzerine gelince okunur.
 */
function IngredientName({ r, onOpen, compact }: { r: IngredientRow; onOpen: () => void; compact?: boolean }) {
  const showNote = Boolean(r.note) && (r.isEstimate || !activeUses(r));
  return (
    // Telefon kartında düğme kartın tamamını kaplar (after:inset-0): karta dokunmak düzenleme penceresini açar;
    // fiyat alanı ve satır düğmeleri üstte (z-10) kalır
    <button
      type="button"
      data-card-link={compact ? "" : undefined}
      className={cn(
        "group/name flex min-w-0 cursor-pointer gap-3 text-left",
        compact ? "items-start after:absolute after:inset-0 after:rounded-xl" : "items-center",
      )}
      onClick={onOpen}
    >
      <IconTile tone={toneFor(r.category)} className={compact ? "max-[380px]:hidden" : "hidden sm:inline-flex"}>
        {createElement(CATEGORY_ICON[r.category] ?? Box)}
      </IconTile>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={cn("font-semibold break-words group-hover/name:underline", r.active ? "text-ink" : "text-ink-mute", compact && "text-[15px] leading-6")}>
            {r.name}
          </span>
          {isUnpriced(r) ? (
            <Badge tone="red" title="Paket fiyatı girilmedi: maliyetlere ve stok değerine 0 ₺ girer">
              Fiyat yok
            </Badge>
          ) : r.isEstimate ? (
            <Badge tone="amber" dot title={r.note ?? "Faturada bulunamayan, tahmini değer"}>
              Tahmini
            </Badge>
          ) : null}
          {r.recentChange ? (
            <Badge tone={r.recentChange.pct > 0 ? "red" : "green"} title={`Son 30 günde (son değişiklik ${dateTR(dayTR(r.recentChange.at))})`}>
              {r.recentChange.pct > 0 ? "↑" : "↓"} {pct(Math.abs(r.recentChange.pct), 0)}
            </Badge>
          ) : null}
          {r.pendingHold ? (
            <Badge tone="amber" dot title={`Faturadan gelen yeni fiyat onay bekliyor: ${bulkPrice(r.pendingHold.proposed, r.unit)} (${r.pendingHold.supplier}, ${dateTR(r.pendingHold.date)})`}>
              Fiyat onayda
            </Badge>
          ) : null}
          {!activeUses(r) ? (
            <Badge tone="gray" title={r.usedIn.length ? `Yalnız ${num(r.usedIn.length)} pasif ürünün reçetesinde` : undefined}>
              Reçetede yok
            </Badge>
          ) : null}
          {!r.active ? <Badge tone="gray">Pasif</Badge> : null}
        </span>
        {/* Telefonda kesilmez, sarılır (uzun tedarikçi adı) */}
        <span className={cn("block text-[13px] leading-5 text-ink-mute", compact ? "text-pretty" : "truncate")} title={showNote ? undefined : (r.note ?? undefined)}>
          {r.category}
          {r.supplier ? ` · ${r.supplier}` : ""}
        </span>
        {showNote ? (
          <span className={cn("mt-0.5 line-clamp-2 text-xs leading-4", r.isEstimate ? "text-warn" : "text-ink-mute")} title={r.note!}>
            {r.note}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function IngredientsClient({ rows, categories }: { rows: IngredientRow[]; categories: string[] }) {
  const reduce = useCalmMotion();
  // Süzgeçler adreste: ?ara=süt&durum=tahmini&kategori=Süt&sirala=unitCost.desc
  // (genel bakıştaki uyarılar ve ⌘K paleti aynı adları kullanır)
  const [q, setQ] = useQueryText("ara");
  const [filtre, setFiltre] = useQueryState<string>("durum", "all");
  const [kategori, setKategori] = useQueryState<string>("kategori", "");
  const [sira, setSira] = useQueryState<string>("sirala", "");
  const [editing, setEditing] = useState<IngredientRow | null>(null);
  const [deleting, setDeleting] = useState<IngredientRow | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  // Satırlar yalnızca kullanıcı sayfa ya da sıra değiştirince yumuşakça belirir (ilk çizimde değil)
  const [interacted, setInteracted] = useState(false);
  // Telefonda süzgeçler alttan açılan pencerede
  const [sheet, setSheet] = useState(false);

  const chosen: Filter = FILTERS.includes(filtre as Filter) ? (filtre as Filter) : "all";
  const category = categories.includes(kategori) ? kategori : "";
  const sort = useMemo(() => parseSort(sira), [sira]);

  // Arama yalnızca pasif malzemelerle eşleşiyorsa (ör. ⌘K'dan pasif bir malzeme) pasif listesi açılır
  const onlyInactiveMatch =
    chosen === "all" && q.trim() !== "" && !rows.some((r) => r.active && matches(searchText(r), q)) && rows.some((r) => !r.active && matches(searchText(r), q));
  const filter: Filter = onlyInactiveMatch ? "pasif" : chosen;

  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  // Filtre dışındaki koşullar (kategori + arama); filtre sayaçları bunun üzerinden sayılır
  const base = useMemo(() => rows.filter((r) => (!category || r.category === category) && matches(searchText(r), q)), [rows, category, q]);

  const counts = useMemo(
    () => ({
      all: base.filter((r) => r.active).length,
      tahmini: base.filter((r) => r.active && r.isEstimate).length,
      fiyatsiz: base.filter(isUnpriced).length,
      kullanilmayan: base.filter((r) => r.active && !activeUses(r)).length,
      pasif: base.filter((r) => !r.active).length,
    }),
    [base],
  );
  /** "Fiyat yok" çipi yalnız fiyatı girilmemiş malzeme varken (ya da seçiliyken) görünür */
  const unpricedChip = rows.some(isUnpriced) || chosen === "fiyatsiz";

  // Kategori seçeneklerindeki sayılar: seçili görünümün (aktif ya da pasif) malzemeleri
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (inScope(r, filter)) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [rows, filter]);

  const visible = useMemo(() => {
    const list = base.filter(
      (r) =>
        inScope(r, filter) &&
        (filter !== "tahmini" || r.isEstimate) &&
        (filter !== "fiyatsiz" || isUnpriced(r)) &&
        (filter !== "kullanilmayan" || !activeUses(r)),
    );
    const byName = (a: IngredientRow, b: IngredientRow) => a.name.localeCompare(b.name, "tr");
    if (!sort) return list.sort((a, b) => catOrder(a.category) - catOrder(b.category) || byName(a, b));
    const d = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => (sort.key === "name" ? byName(a, b) * d : (sortValue(a, sort.key) - sortValue(b, sort.key)) * d || byName(a, b)));
  }, [base, filter, sort]);

  // Sayfa adreste (?sayfa=3): yenileyince ve paylaşılan bağlantıda aynı sayfa açılır
  const paged = useUrlPaged(visible, PAGE_SIZE, `${q}|${category}|${filter}|${sira}`);

  // Görünen malzemelerin son ay reçeteye göre tüketim tutarı (miktar × birim maliyet, KDV hariç)
  const usageCost = useMemo(() => visible.reduce((a, r) => a + r.monthUsage * r.unitCost, 0), [visible]);

  // Sayısal sütunda ilk tık büyükten küçüğe, adda A→Z; üçüncü tık kategori sırasına döner
  const toggleSort = (key: SortKey) => {
    setInteracted(true);
    const firstDir = key === "name" ? "asc" : "desc";
    const next: Sort = sort?.key !== key ? { key, dir: firstDir } : sort.dir === firstDir ? { key, dir: firstDir === "asc" ? "desc" : "asc" } : null;
    setSira(sortParam(next));
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);

  const anyFilter = q.trim() !== "" || category !== "" || chosen !== "all";
  const clearFilters = () => {
    setQ("");
    clearQuery(["ara", "durum", "kategori"]);
  };
  // Çipler tek seçimlidir: etkin çipe yeniden basmak "Tümü"ne döner
  const pick = (f: Filter) => setFiltre(chosen === f ? "all" : f);
  // Telefondaki "Süzgeç" düğmesinin rozeti ve özeti (arama kutusu ayrı, hep görünür)
  const summary = filterSummary([chosen !== "all" && FILTER_LABELS[chosen], category]);
  const clearSheet = () => clearQuery(["durum", "kategori"]);

  const exportCsv = () => {
    const header = [
      "Malzeme",
      "Kategori",
      "Tedarikçi",
      "Paket",
      "Paket fiyatı (KDV hariç)",
      "Paket içeriği",
      "Birim",
      "Birim maliyet",
      "Alış KDV (%)",
      "Fiyat kaynağı",
      "Reçete sayısı (aktif ürün)",
      "Son ay kullanım",
      "Tahmini",
      "Aktif",
      "Kaynak / not",
    ];
    const lines = visible.map((r) => [
      r.name,
      r.category,
      r.supplier ?? "",
      r.packageDesc ?? "",
      r.priceSource === "water" ? "" : num(r.packagePrice, 2),
      num(r.packageSize, 3),
      r.unit,
      num(r.unitCost, 4),
      num(r.vatRate * 100, 2),
      r.priceSource === "water" ? "Su faturası" : "Fatura / elle",
      num(activeUses(r)),
      num(r.monthUsage, 2),
      r.isEstimate ? "Evet" : "",
      r.active ? "Evet" : "Hayır",
      r.note ?? "",
    ]);
    downloadCsv("hammaddeler.csv", [header, ...lines]);
    toast.success(`${num(visible.length)} malzeme CSV olarak indirildi`);
  };

  const onPage = (p: number) => {
    setInteracted(true);
    paged.setPage(p);
  };

  return (
    <Card data-ingredient-list="" className="scroll-mt-[calc(var(--mobile-top-h)+0.75rem)] lg:scroll-mt-4">
      <CardHeader
        icon={<Package />}
        title="Hammadde listesi"
        // Telefonda CSV, Süzgeç penceresinde
        actionsClassName="max-sm:hidden"
        // Dokunmatikte rakam klavyesinde Enter olmayabilir (iOS): alandan çıkmak da kaydeder
        description={
          <>
            <span className="pointer-coarse:hidden">Fatura gelince paket fiyatını yazın: Enter kaydeder ve alt satıra geçer.</span>
            <span className="hidden pointer-coarse:inline">Fatura gelince paket fiyatını yazın; alandan çıkınca kaydedilir. Malzemeye dokununca düzenleme penceresi açılır.</span>{" "}
            Tahmini işaretini, varsayımı doğrulayınca kaldırın.
          </>
        }
        meta={
          <>
            <span>Aktif</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-ink tabular">
              <AnimatedNumber value={activeCount} format={(v) => num(v)} />
            </span>
            {inactiveCount ? (
              <>
                <span className="ml-2">Pasif</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-ink tabular">{num(inactiveCount)}</span>
              </>
            ) : null}
            <span className="ml-2">{num(categories.length)} kategori</span>
          </>
        }
        actions={
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={!visible.length}
            aria-label="Görünen listeyi CSV indir"
            title="Görünen listeyi CSV olarak indir"
          >
            <Download size={16} />
            CSV
          </Button>
        }
      />

      <FilterBar
        className="px-5 pb-4"
        active={anyFilter}
        onClear={clearFilters}
        shown={visible.length}
        total={filter === "pasif" ? inactiveCount : activeCount}
        unit={filter === "pasif" ? "pasif malzeme" : "malzeme"}
      >
        {/* Telefonda arama ve Süzgeç düğmesi tek satırı doldurur (sayaç alt satıra iner); genişte satırın öğeleri */}
        <div className="flex basis-full gap-2 sm:contents">
          <SearchField
            value={q}
            onChange={setQ}
            placeholder="Malzeme ara"
            label="Malzeme adı, tedarikçi, paket ya da not ara"
            className="min-w-0 flex-1 sm:w-72 sm:flex-none max-sm:[&_input]:h-11"
          />
          <FilterSheetButton className="sm:hidden" count={summary.count} onClick={() => setSheet(true)} />
        </div>
        <FilterSummaryLine className="basis-full sm:hidden" text={summary.text} onClick={() => setSheet(true)} />
        {/* Geniş ekranda süzgeçler satırda; telefonda pencerede (aşağıda) */}
        <div className="contents max-sm:hidden">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Görünüm">
          <FilterChip active={chosen === "tahmini"} onToggle={() => pick("tahmini")} count={counts.tahmini}>
            <span className={cn("size-1.5 rounded-full bg-warn", chosen === "tahmini" && "ring-1 ring-on-solid/70")} aria-hidden="true" />
            Tahmini
          </FilterChip>
          {unpricedChip ? (
            <FilterChip active={chosen === "fiyatsiz"} onToggle={() => pick("fiyatsiz")} count={counts.fiyatsiz}>
              Fiyat yok
            </FilterChip>
          ) : null}
          <FilterChip active={chosen === "kullanilmayan"} onToggle={() => pick("kullanilmayan")} count={counts.kullanilmayan}>
            Reçetede yok
          </FilterChip>
          {inactiveCount || chosen === "pasif" ? (
            <FilterChip active={chosen === "pasif"} onToggle={() => pick("pasif")} count={counts.pasif}>
              Pasif
            </FilterChip>
          ) : null}
        </div>
        <Select
          value={category}
          onChange={(e) => setKategori(e.target.value)}
          className={cn("w-full sm:w-auto sm:min-w-48", category && "ring-ink/40")}
          aria-label="Kategori"
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c} ({categoryCounts.get(c) ?? 0})
            </option>
          ))}
        </Select>
        </div>
      </FilterBar>

      <FilterSheet
        open={sheet}
        onClose={() => setSheet(false)}
        onClear={clearSheet}
        canClear={summary.count > 0}
        shown={visible.length}
        unit={filter === "pasif" ? "pasif malzeme" : "malzeme"}
      >
        <SheetSection title="Görünüm">
          {/* İki sütunlu ızgara, sayı sağda: kategori değişip sayılar değişince çipler yer değiştirmez */}
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Görünüm">
            <FilterChip active={chosen === "all"} onToggle={() => setFiltre("all")} count={counts.all} className={SHEET_CHIP}>
              Tümü
            </FilterChip>
            <FilterChip active={chosen === "tahmini"} onToggle={() => pick("tahmini")} count={counts.tahmini} className={SHEET_CHIP}>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className={cn("size-2 shrink-0 rounded-full bg-warn", chosen === "tahmini" && "ring-1 ring-on-solid/70")} aria-hidden="true" />
                Tahmini
              </span>
            </FilterChip>
            {unpricedChip ? (
              <FilterChip active={chosen === "fiyatsiz"} onToggle={() => pick("fiyatsiz")} count={counts.fiyatsiz} className={SHEET_CHIP}>
                Fiyat yok
              </FilterChip>
            ) : null}
            <FilterChip active={chosen === "kullanilmayan"} onToggle={() => pick("kullanilmayan")} count={counts.kullanilmayan} className={SHEET_CHIP}>
              Reçetede yok
            </FilterChip>
            {inactiveCount || chosen === "pasif" ? (
              <FilterChip active={chosen === "pasif"} onToggle={() => pick("pasif")} count={counts.pasif} className={SHEET_CHIP}>
                Pasif
              </FilterChip>
            ) : null}
          </div>
        </SheetSection>
        <SheetSection title="Kategori">
          <Select
            value={category}
            onChange={(e) => setKategori(e.target.value)}
            className={cn("h-11 pointer-coarse:h-11", category && "ring-ink/40")}
            aria-label="Kategori"
          >
            <option value="">Tüm kategoriler</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c} ({categoryCounts.get(c) ?? 0})
              </option>
            ))}
          </Select>
        </SheetSection>
        <SheetSection title="Sırala">
          <Select
            value={sortParam(sort)}
            onChange={(e) => {
              setInteracted(true);
              setSira(e.target.value);
            }}
            className={cn("h-11 pointer-coarse:h-11", sort && "ring-ink/40")}
            aria-label="Sıralama"
          >
            {MOBILE_SORTS.some((o) => o.value === sortParam(sort)) ? null : <option value={sortParam(sort)}>Tablodaki sıra</option>}
            {MOBILE_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </SheetSection>
        <SheetSection title="Dışa aktar">
          <Button variant="secondary" className="h-11 w-full pointer-coarse:h-11" onClick={exportCsv} disabled={!visible.length}>
            <Download size={16} /> Görünen listeyi CSV indir
          </Button>
        </SheetSection>
      </FilterSheet>

      {onlyInactiveMatch ? (
        <Notice tone="neutral" size="sm" live="polite" className="mx-5 mb-3" title="Aramanız yalnızca pasif malzemelerle eşleşti; pasif liste gösteriliyor" />
      ) : null}

      {visible.length ? (
        // data-page-top: sayfa değişince buraya, yeni sayfanın ilk malzemesine kaydırılır (paylaşılan Pagination)
        <div data-page-top="">
          {/* Geniş ekran: tablo (ilk sütun yatay kaydırmada sabit) */}
          <TableWrap className="max-sm:hidden">
            {/* Sütun arası 16px (dış kenarlar 12px, kart başlığıyla hizalı), başlıklar sarılabilir: 1400px'lik ekranda
                satır eylemleri kaydırmadan görünür */}
            <Table className="[&_td]:px-2 [&_td:first-child]:pl-3 [&_td:last-child]:pr-3 [&_th]:px-2 [&_th:first-child]:pl-3 [&_th:last-child]:pr-3">
              <THead className="[&_th]:align-bottom [&_th]:whitespace-normal">
                <tr>
                  <TH sticky>
                    <SortButton dir={dirOf("name")} onClick={() => toggleSort("name")}>
                      Malzeme
                    </SortButton>
                  </TH>
                  <TH>Paket</TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1.5">
                      <SortButton numeric dir={dirOf("packagePrice")} onClick={() => toggleSort("packagePrice")}>
                        Paket fiyatı
                      </SortButton>
                      <InfoTip text="KDV hariç, iskonto düşülmüş. Yeni fatura geldiğinde sadece bunu değiştirin: Enter kaydeder ve alttaki satırın fiyatına geçer, ↑/↓ satırlar arasında gezer, Esc vazgeçer." />
                    </span>
                  </TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1.5">
                      <SortButton numeric dir={dirOf("unitCost")} onClick={() => toggleSort("unitCost")}>
                        Birim maliyet
                      </SortButton>
                      <InfoTip text="Paket fiyatı ÷ paket içeriği: 1 gr / 1 ml / 1 adet malzemenin maliyeti (KDV hariç). Reçeteler bunu kullanır. Altında alış KDV oranı." />
                    </span>
                  </TH>
                  <TH numeric>
                    <SortButton numeric dir={dirOf("usedIn")} onClick={() => toggleSort("usedIn")}>
                      Reçete
                    </SortButton>
                  </TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1.5">
                      <SortButton numeric dir={dirOf("monthUsage")} onClick={() => toggleSort("monthUsage")}>
                        Kullanım
                      </SortButton>
                      <InfoTip text="Son satış ayında reçetelere göre harcanan miktar (satış adedi × reçete miktarı, fire hariç)." />
                    </span>
                    <span className="block text-xs leading-4 font-normal text-ink-mute">son ay</span>
                  </TH>
                  <TH className="w-px">
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              <motion.tbody
                key={`${paged.page}|${sira}`}
                initial={reduce || !interacted ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
              >
                {paged.slice.map((r) => (
                  <TR key={r.id} className={cn(r.isEstimate && ESTIMATE_ROW)}>
                    <TD sticky className={cn("max-w-[16rem] min-w-52", r.isEstimate && ESTIMATE_STICKY)}>
                      <IngredientName r={r} onOpen={() => setEditing(r)} />
                    </TD>
                    <TD>
                      <span className="block max-w-48 truncate text-ink-soft" title={r.packageDesc ?? ""}>
                        {r.packageDesc ?? "–"}
                      </span>
                      <span className="block text-[13px] text-ink-mute tabular">
                        {num(r.packageSize)} {r.unit}
                      </span>
                    </TD>
                    <TD numeric>
                      <PackagePriceCell key={`${r.id}:${r.packagePrice}`} row={r} />
                    </TD>
                    <TD numeric>
                      <span className="font-medium">{tlUnit(r.unitCost)}</span>
                      <span className="text-xs text-ink-mute">/{r.unit}</span>
                      <span className="block text-xs text-ink-mute">KDV {pct(r.vatRate, 0)}</span>
                    </TD>
                    <TD numeric>
                      {activeUses(r) ? num(activeUses(r)) : <span className="text-ink-quiet">0</span>}
                      {r.usedIn.length > activeUses(r) ? (
                        <span className="block text-xs text-ink-mute" title="Pasif ürünlerin reçetelerinde (silmeyi engeller, tüketime girmez)">
                          +{num(r.usedIn.length - activeUses(r))} pasif
                        </span>
                      ) : null}
                    </TD>
                    <TD numeric className="text-ink-soft">
                      {r.monthUsage ? `${num(r.monthUsage)} ${r.unit}` : <span className="text-ink-quiet">–</span>}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <IconButton label={`${r.name}: düzenle`} onClick={() => setEditing(r)}>
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </TD>
                  </TR>
                ))}
              </motion.tbody>
              <tfoot>
                <TFootRow>
                  <TD sticky className="whitespace-nowrap">
                    Görünen {num(visible.length)} malzeme
                  </TD>
                  <TD colSpan={4} />
                  <TD numeric>
                    <span className="inline-flex items-center gap-1.5">
                      ≈ {tl(usageCost)}
                      <InfoTip text="Görünen malzemelerin son ay kullanım × birim maliyet toplamı (KDV hariç): reçetelere göre olması gereken malzeme tüketimi." />
                    </span>
                    <span className="block text-xs font-normal text-ink-mute">tüketim</span>
                  </TD>
                  <TD />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>

          {/* Telefon: her malzeme bir kart. Karta dokunmak düzenleme penceresini açar, paket fiyatı yine yerinde
              değişir (Enter alttaki kartın fiyatına geçer) */}
          <motion.ul
            key={`m|${paged.page}|${sira}`}
            initial={reduce || !interacted ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="mx-2 mb-2 divide-y divide-line-strong/70 sm:hidden"
            aria-label="Malzemeler"
          >
            {paged.slice.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "relative rounded-xl px-3 py-3.5 transition-colors has-[[data-card-link]:active]:bg-surface/70 has-[[data-card-link]:hover]:bg-surface/50",
                  r.isEstimate && ESTIMATE_ROW,
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <IngredientName r={r} onOpen={() => setEditing(r)} compact />
                  <PackagePriceCell key={`${r.id}:${r.packagePrice}`} row={r} className="z-10 shrink-0" />
                </div>
                <p className="mt-2 text-[13px] text-pretty text-ink-soft">
                  {r.packageDesc ? `${r.packageDesc} · ` : ""}
                  <span className="whitespace-nowrap tabular">
                    {num(r.packageSize)} {r.unit}
                  </span>
                </p>
                <div className="mt-1.5 flex items-end justify-between gap-3">
                  <p className="min-w-0 text-[13px] text-ink-mute tabular">
                    <span className="text-[15px] font-semibold text-ink">{tlUnit(r.unitCost)}</span>/{r.unit} · KDV {pct(r.vatRate, 0)}
                    <span className="block">
                      {num(activeUses(r))} reçete{r.monthUsage ? ` · son ay ${num(r.monthUsage)} ${r.unit}` : ""}
                    </span>
                  </p>
                  <div className="relative z-10 flex shrink-0 gap-1.5">
                    <IconButton label={`${r.name}: düzenle`} className="size-11 pointer-coarse:size-11" onClick={() => setEditing(r)}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton label={`${r.name}: sil`} tone="danger" className="size-11 pointer-coarse:size-11" onClick={() => setDeleting(r)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </div>
              </li>
            ))}
          </motion.ul>
          <p className="mx-5 mb-1 flex flex-wrap justify-between gap-x-3 border-t border-line-strong pt-3 text-[13px] text-ink-mute sm:hidden">
            <span>Görünen {num(visible.length)} malzeme</span>
            <span className="tabular">
              Son ay tüketim ≈ <span className="font-semibold text-ink">{tl(usageCost)}</span>
            </span>
          </p>

          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={onPage}
            unit="malzeme"
            className="border-t border-line"
          />
        </div>
      ) : (
        <div className="flex min-h-80 items-center justify-center">
          {rows.length ? (
            <EmptyState
              icon={<SearchX />}
              title={q.trim() ? `“${q.trim()}” için malzeme yok` : "Bu süzgeçlerle malzeme yok"}
              description={
                filter === "all" && counts.pasif
                  ? "Aradığınız malzemeler pasif olabilir; pasif listesine bakın."
                  : "Aramayı kısaltın ya da süzgeci kaldırın; listede yoksa yeni hammadde olarak ekleyin."
              }
              action={
                <>
                  {anyFilter ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Süzgeci temizle
                    </Button>
                  ) : null}
                  {filter === "all" && counts.pasif ? (
                    <Button variant="secondary" onClick={() => setFiltre("pasif")}>
                      Pasifleri göster ({num(counts.pasif)})
                    </Button>
                  ) : null}
                  {q.trim() && !rows.some((r) => matches(searchText(r), q)) ? (
                    <Button onClick={() => setCreating(q.trim())}>
                      <Plus size={16} /> “{q.trim()}” ekle
                    </Button>
                  ) : null}
                </>
              }
            />
          ) : (
            <EmptyState
              title="Henüz malzeme yok"
              description="İlk malzemeyi paket fiyatı ve içeriğiyle ekleyin; reçete kartlarında seçilebilir olur."
              action={
                <Button onClick={() => setCreating("")}>
                  <Plus size={16} /> Yeni hammadde
                </Button>
              }
            />
          )}
        </div>
      )}

      {editing ? (
        <IngredientDialog
          row={editing}
          rows={rows}
          categories={categories}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setDeleting(editing);
            setEditing(null);
          }}
        />
      ) : null}
      {creating !== null ? (
        <IngredientDialog
          row={null}
          rows={rows}
          categories={categories}
          initialName={creating}
          initialCategory={category || undefined}
          onClose={() => setCreating(null)}
        />
      ) : null}
      {deleting ? <DeleteDialog row={deleting} onClose={() => setDeleting(null)} /> : null}
    </Card>
  );
}

/** Sayfa başlığındaki "Yeni hammadde" düğmesi; kategori süzgeci açıksa o kategori seçili gelir */
export function NewIngredientButton({ categories, rows }: { categories: string[]; rows: IngredientRow[] }) {
  const [open, setOpen] = useState(false);
  const [kategori] = useQueryState<string>("kategori", "");
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> Yeni hammadde
      </Button>
      {open ? (
        <IngredientDialog
          row={null}
          rows={rows}
          categories={categories}
          initialCategory={categories.includes(kategori) ? kategori : undefined}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const PASSIVE_EFFECT =
  "Pasif ürünlerin reçeteleri, geçmiş sayımlar, alımlar ve zayi kayıtları korunur. Malzeme reçete seçimlerinde ve sayım listesinde görünmez (onu kullanan bir ürün yeniden aktif olursa sayım listesine döner); Pasif listesinden yeniden açabilirsiniz.";

/** Ürün bağlantıları (pencere önce kapanır: açık kalsa ürün sayfasının üstünde dururdu) */
function ProductLinks({ items, onNavigate, max = 8 }: { items: IngredientRow["usedIn"]; onNavigate: () => void; max?: number }) {
  const shown = items.slice(0, max);
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      {shown.map((u) => (
        <Link
          key={u.id}
          href={`/panel/urunler/${u.id}`}
          onClick={onNavigate}
          className="inline-flex min-h-8 items-center rounded-full bg-panel px-3 text-xs font-medium text-ink-soft transition-colors hover:bg-panel-deep hover:text-ink pointer-coarse:min-h-11"
        >
          {u.label}
        </Link>
      ))}
      {items.length > shown.length ? <span className="inline-flex min-h-8 items-center px-1 text-xs text-ink-mute">ve {num(items.length - shown.length)} ürün daha</span> : null}
    </span>
  );
}

/**
 * Silme onayı. Reçetede kullanılan ya da sayımı, alım miktarı, Paraşüt eşleştirmesi, zayi / ikram kaydı olan malzeme
 * silinemez (sunucu da reddeder; silmek geçmiş ayların stok değerini ve zayi maliyetini değiştirirdi). Aktif bir ürünün
 * reçetesindeyse pasif de yapılamaz: önce reçetelerden çıkarılır, ürünler bağlantıyla listelenir (denetim E-04).
 * Yalnız pasif ürünlerde ya da geçmiş kayıtlarda kalıyorsa "Pasif yap" önerilir.
 */
function DeleteDialog({ row, onClose }: { row: IngredientRow; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const activeProducts = row.usedIn.filter((u) => u.active);
  const passiveProducts = row.usedIn.filter((u) => !u.active);
  const inActive = activeProducts.length > 0;
  const history = historyText(row.deps);
  const blocked = row.usedIn.length > 0 || history !== null;
  // Pasif yapmak yalnız aktif bir ürün onu kullanmıyorsa (yoksa ürünler tüketmeye devam ederdi)
  const canPassivate = row.active && !inActive;

  async function makePassive() {
    const res = await tryAction(() => setIngredientActive(row.id, false));
    if (!res) return;
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${row.name} pasif yapıldı`, { description: PASSIVE_EFFECT });
  }

  async function confirm() {
    if (blocked && !canPassivate) return onClose();
    setBusy(true);
    if (blocked) {
      await makePassive();
      setBusy(false);
      return onClose();
    }
    const res = await tryAction(() => deleteIngredient(row.id));
    setBusy(false);
    if (!res) return;
    if (!res.ok) {
      // Sayfa açıkken başka yerde sayım, alım ya da zayi girildiyse sunucu reddeder: pasif yapmak tek tıkta
      toast.error(res.error, row.active ? { action: { label: "Pasif yap", onClick: () => void makePassive() } } : undefined);
      return onClose();
    }
    toast.success(`${row.name} silindi`);
    onClose();
  }

  if (blocked)
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={confirm}
        pending={busy}
        tone="primary"
        confirmLabel={canPassivate ? "Pasif yap" : "Tamam"}
        title={`${row.name} silinemiyor`}
        description={
          <>
            <Notice
              tone="warn"
              size="sm"
              risk="para"
              className="mb-3"
              title={
                <>
                  {inActive
                    ? row.active
                      ? `Bu malzeme ${num(activeProducts.length)} aktif ürünün reçetesinde kullanılıyor. Silmek ya da pasif yapmak için önce bu reçetelerden çıkarın veya yerine başka malzeme yazın; yoksa ürünler onu tüketmeye devam eder.`
                      : `Malzeme pasif ama ${num(activeProducts.length)} aktif ürünün reçetesinde: satıldıkça tüketiliyor ve sayım listesinde duruyor. Silmek için önce bu reçetelerden çıkarın veya yerine başka malzeme yazın.`
                    : passiveProducts.length
                      ? `Bu malzeme yalnız ${num(passiveProducts.length)} pasif ürünün reçetesinde kullanılıyor; silmek için önce o reçetelerden çıkarın.`
                      : null}
                  {row.usedIn.length && history ? " " : null}
                  {history ? `${row.usedIn.length ? "Ayrıca" : "Bu malzemenin"} ${history} kaydı var; silinirse geçmiş ayların stok, zayi ve tutarlılık değerleri değişir.` : null}
                </>
              }
            />
            {inActive ? (
              <span className="block">
                Kullanan aktif ürünler:
                <ProductLinks items={activeProducts} onNavigate={onClose} />
              </span>
            ) : canPassivate ? (
              `Bunun yerine pasif yapabilirsiniz. ${PASSIVE_EFFECT}`
            ) : (
              "Malzeme zaten pasif; reçetelerde ve geçmiş kayıtlarda kalmaya devam eder."
            )}
          </>
        }
      />
    );
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={confirm}
      pending={busy}
      confirmLabel="Kalıcı olarak sil"
      title={`${row.name} silinsin mi?`}
      description="Hiçbir reçetede, sayımda, alım ya da zayi kaydında yok. Fiyat geçmişiyle birlikte silinir; bu işlem geri alınamaz."
    />
  );
}

function IngredientDialog({
  row,
  rows,
  onClose,
  onDelete,
  categories,
  initialName = "",
  initialCategory,
}: {
  row: IngredientRow | null;
  /** Aynı ad denetimi, kategori/tedarikçi önerileri için bütün malzemeler */
  rows: IngredientRow[];
  onClose: () => void;
  onDelete?: () => void;
  categories: string[];
  initialName?: string;
  initialCategory?: string;
}) {
  const formId = useId();
  const [f, setF] = useState(() => {
    const category = row?.category ?? initialCategory ?? "Diğer";
    // Yeni malzeme: Excel'deki gibi sayım listesine girer (birime uyan sayım birimi, kategorinin rafı, rafın KDV'si)
    const countGroup = row ? (row.countGroup ?? "") : groupForCategory(rows, category);
    return {
      name: row?.name ?? initialName,
      category,
      supplier: row?.supplier ?? "",
      packageDesc: row?.packageDesc ?? "",
      packagePrice: row ? priceText(row.packagePrice) : "",
      packageSize: num(row?.packageSize ?? 1000, 3),
      unit: (row?.unit ?? "gr") as Unit,
      vatRate: formatPercentInput(row?.vatRate ?? vatForGroup(countGroup)),
      note: row?.note ?? "",
      isEstimate: row?.isEstimate ?? false,
      priceSource: row?.priceSource ?? "manual",
      countUnit: (row ? (row.countUnit ?? "") : countUnitsFor("gr")[0]) as CountUnit | "",
      countGroup,
      active: row?.active ?? true,
    };
  });
  // Yeni malzemede kullanıcının elle değiştirdiği alanlara öneri yazılmaz
  const [touched, setTouched] = useState<{ vat?: boolean; countGroup?: boolean; countUnit?: boolean }>({});
  const [unitNote, setUnitNote] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  // Pencere açıkken fiyat başka yerden değişebilir (satırdaki fiyat kutusu ada/kaleme basınca blur'la kaydeder, Paraşüt
  // eşitlemesi): dokunulmamış alan güncel değeri alır. Kayıtta da dokunulmamış alan `base` ile gider, sunucu kayıttaki
  // güncel değeri bırakır; yoksa "Kaydet" eski fiyatı geri yazar ve sahte bir fiyat geçmişi kaydı açar
  const live = row ? (rows.find((r) => r.id === row.id) ?? row) : null;
  const [base, setBase] = useState(live ? { packagePrice: live.packagePrice, packageSize: live.packageSize } : null);
  if (live && base && (live.packagePrice !== base.packagePrice || live.packageSize !== base.packageSize)) {
    setBase({ packagePrice: live.packagePrice, packageSize: live.packageSize });
    setF((x) => ({
      ...x,
      packagePrice: x.packagePrice === priceText(base.packagePrice) ? priceText(live.packagePrice) : x.packagePrice,
      packageSize: x.packageSize === num(base.packageSize, 3) ? num(live.packageSize, 3) : x.packageSize,
    }));
  }
  const priceUntouched = base !== null && f.packagePrice === priceText(base.packagePrice);
  const sizeUntouched = base !== null && f.packageSize === num(base.packageSize, 3);
  const water = f.priceSource === "water";
  const price = parseNumberTR(f.packagePrice);
  const size = parseNumberTR(f.packageSize);
  // Yüzde puanı: "20", "%20", "20%" → 0,2 (parsePercentInput zaten 100'e böler)
  const vat = parsePercentInput(f.vatRate);
  const allCats = [...new Set([...INGREDIENT_CATEGORIES, ...categories])];
  const suppliers = [...new Set(rows.map((r) => r.supplier?.trim()).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "tr"));
  const allowedCount = countUnitsFor(f.unit);
  const bulk = row?.unit === "gr" ? { unit: "kg", scale: 1000 } : row?.unit === "ml" ? { unit: "L", scale: 1000 } : { unit: row?.unit ?? "", scale: 1 };

  const catNear = nearMatch(f.category, allCats);
  const catNew = f.category.trim() !== "" && !catNear && !allCats.includes(f.category.trim());
  const supNear = nearMatch(f.supplier, suppliers);

  const duplicate = f.name.trim() ? rows.find((r) => r.id !== row?.id && fold(r.name.trim()) === fold(f.name.trim())) : undefined;
  const errors = {
    name: !f.name.trim() ? "Malzeme adını yazın" : duplicate ? `“${duplicate.name}” zaten var${duplicate.active ? "" : " (pasif)"}` : null,
    category: !f.category.trim() ? "Kategori yazın ya da listeden seçin" : null,
    price: !water && (price === null || price < 0) ? "Geçerli bir fiyat girin (ör. 1.022 ya da 49,50)" : null,
    size: size === null || size <= 0 ? "Paket içeriği 0'dan büyük olmalı" : null,
    vat: vat === null || vat < 0 || vat > 1 ? "0 ile 100 arasında bir oran girin (ör. 20)" : null,
    countUnit: f.countUnit && !allowedCount.includes(f.countUnit) ? `“${f.unit}” birimli malzeme ${allowedCount.join(" ya da ")} olarak sayılır` : null,
    // Aktif bir ürünün reçetesindeki malzeme pasif yapılamaz (sunucu da reddeder; denetim E-04)
    active:
      row?.active && !f.active && activeUses(row)
        ? `${num(activeUses(row))} aktif ürünün reçetesinde kullanılıyor (${productListText(row.usedIn.filter((u) => u.active).map((u) => ({ id: u.id, name: u.label })))}). Pasif yapmadan önce bu reçetelerden çıkarın ya da yerine başka malzeme yazın.`
        : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  // Hatalar ilk "Ekle/Kaydet" denemesinden sonra görünür; aynı ad ve uyumsuz sayım birimi ise hemen çıkar
  const show = (k: keyof typeof errors) => ((tried || (k === "name" && duplicate) || k === "countUnit" || k === "active") && errors[k]) || undefined;

  // Birim ya da sayım birimi değişince eski sayımların ne olacağı (kaydetmeden önce söylenir)
  const unitChanged = row !== null && (f.unit !== row.unit || (f.countUnit || null) !== row.countUnit);
  const countWarning =
    row && unitChanged && row.deps.counts
      ? !f.countUnit
        ? `Bu malzemenin ${num(row.deps.counts)} sayım kaydı var. Kaydedince sayım listesinden çıkar; eski sayımlar korunur ve geçmiş aylarda girildikleri birimle (${row.countUnit ?? "eski birim"}) görünür.`
        : `Bu malzemenin ${num(row.deps.counts)} sayım kaydı var. Eski sayımlar girildikleri birimle (${row.countUnit ?? "eski birim"}) değerlenmeye devam eder; yeni sayımları ${f.countUnit} olarak girin.`
      : null;
  const recipeWarning =
    row && f.unit !== row.unit && row.usedIn.length
      ? `${num(row.usedIn.length)} reçetede miktarlar “${row.unit}” olarak yazıldı; birimi “${f.unit}” yaparsanız o reçetelerin miktarlarını kontrol edin.`
      : null;

  function setUnit(unit: Unit) {
    const allowed = countUnitsFor(unit);
    const patch: Partial<typeof f> = { unit };
    if (!row && !touched.countUnit) patch.countUnit = allowed[0];
    else if (f.countUnit && !allowed.includes(f.countUnit)) {
      patch.countUnit = allowed[0];
      setUnitNote(`Sayım birimi ${allowed[0]} oldu: “${unit}” birimli malzeme ${allowed.join(" ya da ")} olarak sayılır.`);
    } else setUnitNote(null);
    set(patch);
  }

  function setCategory(category: string) {
    const patch: Partial<typeof f> = { category };
    // Yeni malzemede kategori seçilince rafı ve KDV'si önerilir (elle değiştirilmedikçe)
    if (!row && allCats.includes(category)) {
      const group = touched.countGroup ? f.countGroup : groupForCategory(rows, category);
      if (!touched.countGroup) patch.countGroup = group;
      if (!touched.vat) patch.vatRate = formatPercentInput(vatForGroup(group));
    }
    set(patch);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTried(true);
    if (invalid) {
      const first = (["name", "category", "price", "size", "vat", "countUnit", "active"] as const).find((k) => errors[k]);
      if (first === "active") setAdvanced(true);
      const id = { name: "i-name", category: "i-cat", price: "i-price", size: "i-size", vat: "i-vat", countUnit: "i-cu", active: "i-active" }[first!];
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    const res = await tryAction(() =>
      saveIngredient({
        id: row?.id ?? null,
        name: f.name,
        category: f.category,
        supplier: f.supplier,
        packageDesc: f.packageDesc,
        // Dokunulmamış alan kayıttaki değerle gider (2 haneye yuvarlanmaz, geçmişe sahte kayıt düşmez)
        packagePrice: base && priceUntouched ? base.packagePrice : (price ?? 0),
        packageSize: base && sizeUntouched ? base.packageSize : (size ?? 0),
        base,
        unit: f.unit,
        vatRate: vat ?? 0,
        note: f.note,
        isEstimate: f.isEstimate,
        priceSource: f.priceSource as "manual",
        countUnit: f.countUnit || null,
        countGroup: f.countGroup || null,
        active: f.active,
      }),
    );
    setBusy(false);
    // Atılan eylem (E-51): bildirim çıktı, pencere ve yazılanlar yerinde
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    const name = f.name.trim();
    toast.success(row ? `${name} güncellendi` : `${name} eklendi`, {
      description: row ? (row.usedIn.length ? `${num(row.usedIn.length)} ürünün maliyeti yeniden hesaplandı.` : undefined) : "Artık reçete kartlarında seçilebilir.",
      // Yeni malzeme listenin sonundaki sayfaya düşebilir: tek tıkla aranıp gösterilir (adres ?ara=…)
      action: row
        ? undefined
        : {
            label: "Listede göster",
            onClick: () => {
              const url = new URL(window.location.href);
              url.searchParams.set("ara", name);
              for (const k of ["durum", "kategori"]) url.searchParams.delete(k);
              window.history.replaceState(null, "", url);
              markUrlWritten();
              showList();
            },
          },
    });
    if (res.data.warning) toast.warning("Sayım birimi değişti", { description: res.data.warning, duration: 12_000 });
    onClose();
  }

  const sourceLabel = water ? "Su faturasından" : "Fatura / elle";
  const advancedSummary = [f.countGroup || "Sayım grubu yok", sourceLabel, f.active ? "Aktif" : "Pasif"].join(" · ");

  return (
    <Dialog
      open
      onClose={onClose}
      size={row ? "xl" : "lg"}
      title={row ? row.name : "Yeni hammadde"}
      description={
        row
          ? `${row.category} · ${usageText(row)}`
          : "Eklediğiniz malzeme reçete kartlarındaki listede ve sayım listesinde çıkar."
      }
      footerStart={
        row && onDelete ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={onDelete}>
            <Trash2 size={16} /> Sil
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy || (tried && invalid) || !!duplicate || !!errors.countUnit}>
            {busy ? "Kaydediliyor…" : row ? "Kaydet" : "Ekle"}
          </Button>
        </>
      }
    >
      <div className={cn("grid gap-6 pb-3", row && "lg:grid-cols-2")}>
        {/* Enter kaydeder (form gönderimi), Esc pencereyi kapatır */}
        <form id={formId} onSubmit={save} className="space-y-3" noValidate>
          <Field label="Malzeme adı" htmlFor="i-name" error={show("name")}>
            <Input
              id="i-name"
              value={f.name}
              onChange={(e) => set({ name: e.target.value })}
              maxLength={120}
              placeholder="ör. Laktozsuz süt"
              aria-invalid={show("name") ? true : undefined}
              data-autofocus={row ? undefined : true}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Kategori"
              htmlFor="i-cat"
              tip="Listeden seçin ya da yeni bir kategori adı yazın; yeni ad kaydedince listeye eklenir."
              error={show("category")}
              hint={catNear ? <NearHint value={catNear} onUse={() => setCategory(catNear)} /> : catNew ? `Yeni kategori: “${f.category.trim()}” oluşturulur` : undefined}
            >
              <Input
                id="i-cat"
                list={`${formId}-cats`}
                value={f.category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={60}
                autoComplete="off"
                aria-invalid={show("category") ? true : undefined}
              />
              <datalist id={`${formId}-cats`}>
                {allCats.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Tedarikçi" htmlFor="i-sup" hint={supNear ? <NearHint value={supNear} onUse={() => set({ supplier: supNear })} /> : undefined}>
              <Input id="i-sup" list={`${formId}-sups`} value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="ör. Sütaş" autoComplete="off" maxLength={120} />
              <datalist id={`${formId}-sups`}>
                {suppliers.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Paket açıklaması" htmlFor="i-pack" hint="Faturadaki ürün adı, ör. Espresso Blend 1 kg">
            <Input id="i-pack" value={f.packageDesc} onChange={(e) => set({ packageDesc: e.target.value })} maxLength={160} />
          </Field>
          {/* Telefonda tek sütun */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Paket fiyatı"
              htmlFor="i-price"
              hint={water ? "Su faturasından hesaplanır" : "KDV hariç, iskonto düşülmüş"}
              error={show("price")}
            >
              <div className="relative">
                <NumberInput
                  id="i-price"
                  value={water ? "" : f.packagePrice}
                  onChange={(e) => set({ packagePrice: e.target.value })}
                  disabled={water}
                  placeholder={water ? "—" : "ör. 1.022"}
                  aria-invalid={show("price") ? true : undefined}
                  className="cell-input pr-7"
                  data-autofocus={row && !water ? true : undefined}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
              </div>
            </Field>
            <Field label="Paket içeriği" htmlFor="i-size" error={show("size")} tip="Paketin içindeki miktar, birimle aynı türde: 1 kg için 1.000 gr, 1 L için 1.000 ml.">
              <div className="relative">
                <NumberInput
                  id="i-size"
                  value={f.packageSize}
                  onChange={(e) => set({ packageSize: e.target.value })}
                  aria-invalid={show("size") ? true : undefined}
                  className="cell-input pr-12"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">{f.unit}</span>
              </div>
            </Field>
            <Field label="Birim" htmlFor="i-unit" hint={unitNote ? <span className="text-warn">{unitNote}</span> : undefined}>
              <Select id="i-unit" value={f.unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </div>
          {recipeWarning ? (
            <Notice tone="warn" size="sm" live="polite" title={recipeWarning} />
          ) : null}
          <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-panel px-3.5 py-2.5 text-sm text-ink-mute" aria-live="polite">
            <span>
              Birim maliyet<span className="max-sm:hidden"> (reçetelerin kullandığı)</span>
            </span>
            <span className="shrink-0 whitespace-nowrap">
              <strong className="font-semibold text-ink tabular">
                {water ? (row ? tlUnit(row.unitCost) : "su faturasından") : size && price !== null ? tlUnit(price / size) : "–"}
              </strong>{" "}
              / {f.unit}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Alış KDV oranı"
              htmlFor="i-vat"
              hint={vat !== null && !errors.vat ? `Gıda %1, ambalaj %20 · okunan: %${formatPercentInput(vat)}` : "Gıda %1, ambalaj %20"}
              error={show("vat")}
            >
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">%</span>
                <NumberInput
                  id="i-vat"
                  value={f.vatRate}
                  onChange={(e) => {
                    setTouched((t) => ({ ...t, vat: true }));
                    set({ vatRate: e.target.value });
                  }}
                  aria-invalid={show("vat") ? true : undefined}
                  className="pl-7"
                />
              </div>
            </Field>
            <Field label="Sayım birimi" htmlFor="i-cu" hint={countUnitHint(f.countUnit, f.unit)} error={show("countUnit")}>
              <Select
                id="i-cu"
                value={f.countUnit}
                onChange={(e) => {
                  setTouched((t) => ({ ...t, countUnit: true }));
                  setUnitNote(null);
                  set({ countUnit: e.target.value as CountUnit | "" });
                }}
                aria-invalid={show("countUnit") ? true : undefined}
              >
                <option value="">Sayılmaz</option>
                {allowedCount.map((u, i) => (
                  <option key={u} value={u}>
                    {u}
                    {allowedCount.length > 1 && i === 0 ? " (önerilen)" : ""}
                  </option>
                ))}
                {f.countUnit && !allowedCount.includes(f.countUnit) ? <option value={f.countUnit}>{f.countUnit} (birimle uyumsuz)</option> : null}
              </Select>
            </Field>
          </div>
          {countWarning ? (
            <Notice tone="warn" size="sm" live="polite" title={countWarning} />
          ) : null}
          <Field
            label="Kaynak / not"
            htmlFor="i-note"
            hint={f.isEstimate ? "Neyin varsayım olduğunu ve neyin doğrulanacağını yazın; listede malzemenin altında görünür." : "Fiyatın nereden geldiği (fatura, tarih)."}
          >
            <Textarea id="i-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={3} maxLength={1000} />
          </Field>
          <Checkbox
            label="Tahmini (faturada yok ya da varsayım içeriyor)"
            className="min-h-10"
            checked={f.isEstimate}
            onChange={(e) => set({ isEstimate: e.target.checked })}
          />

          {/* Nadiren değişenler: sayım rafı, fiyat kaynağı, aktiflik */}
          <div className="rounded-2xl ring-1 ring-line">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm outline-none hover:bg-panel focus-visible:ring-2 focus-visible:ring-ink/30"
              aria-expanded={advanced}
              aria-controls={`${formId}-adv`}
              onClick={() => setAdvanced((a) => !a)}
            >
              <span className="min-w-0">
                <span className="font-medium text-ink">Gelişmiş</span>
                <span className="block truncate text-xs text-ink-mute">{advancedSummary}</span>
              </span>
              <ChevronDown size={16} className={cn("shrink-0 text-ink-mute transition-transform", advanced && "rotate-180")} aria-hidden="true" />
            </button>
            {advanced ? (
              <div id={`${formId}-adv`} className="space-y-3 border-t border-line px-3.5 pt-3 pb-3.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Sayım grubu" htmlFor="i-cg" hint="Sayım sayfasında hangi rafta">
                    <Select
                      id="i-cg"
                      value={f.countGroup}
                      onChange={(e) => {
                        setTouched((t) => ({ ...t, countGroup: true }));
                        set({ countGroup: e.target.value });
                      }}
                    >
                      <option value="">—</option>
                      {COUNT_GROUPS.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                      {f.countGroup && !COUNT_GROUPS.includes(f.countGroup) ? <option>{f.countGroup}</option> : null}
                    </Select>
                  </Field>
                  <Field label="Fiyat kaynağı" htmlFor="i-src" hint={water ? "Litre maliyeti Gelir-gider'deki SU GİDERİ'nden" : undefined}>
                    <Select id="i-src" value={f.priceSource} onChange={(e) => set({ priceSource: e.target.value as "manual" })}>
                      <option value="manual">Fatura / elle</option>
                      <option value="water">Su faturasından (su, buz)</option>
                    </Select>
                  </Field>
                </div>
                <div>
                  <Checkbox
                    id="i-active"
                    label="Aktif (reçetelerde ve sayımda seçilebilir)"
                    className="min-h-10"
                    checked={f.active}
                    onChange={(e) => set({ active: e.target.checked })}
                    aria-invalid={show("active") ? true : undefined}
                    aria-describedby={show("active") ? "i-active-err" : undefined}
                  />
                  {show("active") ? (
                    <p id="i-active-err" className="mt-1 text-xs font-medium text-pretty text-bad" role="alert">
                      {show("active")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </form>
        {row ? (
          <div className="space-y-4">
            {live?.pendingHold ? (
              <Notice
                tone="warn"
                size="sm"
                live="polite"
                title={
                  <>
                    Faturadan yeni fiyat onay bekliyor: <span className="tabular">{bulkPrice(live.pendingHold.proposed, row.unit)}</span>
                  </>
                }
                text={`${live.pendingHold.supplier}, ${dateTR(live.pendingHold.date)}`}
                action={
                  // Kart aynı sayfada: pencere kapanır, sayfa karta kayar (gezinme yok)
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      onClose();
                      setTimeout(() => scrollToHolds(true), 0);
                    }}
                  >
                    Onaya git
                  </Button>
                }
              />
            ) : null}
            {row.history.length ? (
              // Beyaz pencerede kuyu gri zeminle ayrılır
              <Well className="bg-panel">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    Birim maliyet geçmişi <span className="font-normal text-ink-mute">(₺ / {bulk.unit})</span>
                  </p>
                  <p className="text-xs text-ink-mute tabular">{num(row.history.length)} değişiklik</p>
                </div>
                {/* gr ve ml için kg / L başına: 0,0275 ₺/gr yerine 27,50 ₺/kg, eksen ve ipucu okunur kalsın */}
                <PriceLine
                  valueLabel={`1 ${bulk.unit} maliyeti`}
                  data={row.history.map((h) => ({ label: dateTR(dayTR(h.at)), value: h.size ? (h.price / h.size) * bulk.scale : 0 }))}
                />
                <ul className="mt-3 max-h-48 divide-y divide-line overflow-y-auto rounded-xl bg-surface px-3 text-xs text-ink-soft scroll-thin">
                  {row.history
                    .map((h, i, all) => {
                      const prev = all[i - 1];
                      const unitNow = h.size ? h.price / h.size : 0;
                      const unitPrev = prev?.size ? prev.price / prev.size : 0;
                      return { h, change: unitPrev ? unitNow / unitPrev - 1 : null, key: `${h.at}-${i}` };
                    })
                    .reverse()
                    .map(({ h, change, key }) => (
                      <li key={key} className="py-1.5">
                        <div className="flex justify-between gap-2">
                          <span>
                            {dateTR(dayTR(h.at))} · {h.by ?? "–"}
                          </span>
                          <span className="tabular">
                            {tl(h.price, 2)} / {num(h.size)} {row.unit}
                            {change !== null && Math.abs(change) >= 0.0005 ? (
                              <span className={cn("ml-1.5 font-medium", change > 0 ? "text-bad" : "text-good")} title="Birim maliyetin bir önceki kayda göre değişimi">
                                {change > 0 ? "+" : "−"}
                                {pct(Math.abs(change))}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        {h.note ? (
                          <p className="truncate text-ink-mute" title={h.note}>
                            {h.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </Well>
            ) : null}
            {/* Su ve buzun fiyatı su faturasından: tedarikçi karşılaştırması yok */}
            {row.priceSource !== "water" ? <SupplierPrices ingredientId={row.id} onNavigate={onClose} /> : null}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">
                Kullanıldığı ürünler ({activeUses(row)}
                {row.usedIn.length > activeUses(row) ? ` · ${num(row.usedIn.length - activeUses(row))} pasif ürün` : ""})
              </p>
              {row.usedIn.length ? (
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto scroll-thin">
                  {/* Aktif ürünler önce; pasif ürün soluk ve "pasif" etiketiyle (tüketime girmez, silmeyi engeller) */}
                  {[...row.usedIn].sort((a, b) => Number(b.active) - Number(a.active)).map((u) => (
                    // Pencere önce kapanır: açık kalsa ürün sayfasının üstünde dururdu
                    <Link
                      key={u.id}
                      href={`/panel/urunler/${u.id}`}
                      onClick={onClose}
                      className={cn(
                        "inline-flex min-h-8 items-center rounded-full bg-panel px-3 text-xs font-medium transition-colors hover:bg-panel-deep hover:text-ink pointer-coarse:min-h-11",
                        u.active ? "text-ink-soft" : "text-ink-quiet",
                      )}
                    >
                      {u.label}
                      {u.active ? null : <span className="ml-1 font-normal">· pasif</span>}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-mute">Hiçbir reçetede yok. Bir ürünün reçete kartından ekleyebilirsiniz.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** "Listede “Kaldi” olarak geçiyor · Onu kullan": yazım farkıyla ikinci bir kayıt açılmasın */
function NearHint({ value, onUse }: { value: string; onUse: () => void }) {
  return (
    <span className="text-warn">
      Listede “{value}” olarak geçiyor ·{" "}
      <button type="button" className="font-medium underline underline-offset-2 hover:text-ink" onClick={onUse}>
        Onu kullan
      </button>
    </span>
  );
}
