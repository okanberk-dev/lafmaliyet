"use client";

import {
  ArrowUpRight,
  Cake,
  Cherry,
  Coffee,
  Cookie,
  CupSoda,
  Download,
  FilePlus2,
  FileText,
  GlassWater,
  IceCreamCone,
  Leaf,
  Plus,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { createElement, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, IconLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { NumberInput, Select } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, Signed } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import type { ProductStatus } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { num, pct, tl } from "@/lib/format";
import { cn, slugify } from "@/lib/utils";
import { updateProductPrice } from "@/server/actions/products";

import { NewProductDialog } from "./new-product";
import { priceText } from "./price-text";

export interface ProductRow {
  id: number;
  name: string;
  size: string;
  categoryId: number;
  category: string;
  note: string | null;
  active: boolean;
  price: number;
  net: number;
  commission: number;
  cost: number;
  totalCost: number;
  unitProfit: number;
  margin: number;
  costRatio: number;
  suggestedPrice: number;
  status: ProductStatus;
  fireRate: number;
  fireOverridden: boolean;
  soldQty: number;
  monthProfit: number;
  monthNet: number;
  lineCount: number;
  hasEstimate: boolean;
}

type NumKey = keyof Pick<
  ProductRow,
  "price" | "cost" | "unitProfit" | "margin" | "costRatio" | "suggestedPrice" | "soldQty" | "monthProfit" | "net" | "commission" | "totalCost" | "monthNet"
>;
type SortKey = NumKey | "name";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const STATUSES: ProductStatus[] = ["İyi", "Dikkat", "Düşük kâr", "Reçete yok"];
const SORT_KEYS: SortKey[] = [
  "name",
  "price",
  "cost",
  "unitProfit",
  "margin",
  "costRatio",
  "suggestedPrice",
  "soldQty",
  "monthProfit",
  "net",
  "commission",
  "totalCost",
  "monthNet",
];

/** Adresteki sıra: ?sirala=unitProfit.desc */
function parseSort(v: string): Sort {
  const [key, dir] = v.split(".");
  if (!SORT_KEYS.includes(key as SortKey) || (dir !== "asc" && dir !== "desc")) return null;
  return { key: key as SortKey, dir };
}
const sortParam = (s: Sort) => (s ? `${s.key}.${s.dir}` : "");

/** Durum rozetiyle aynı anlam: olumlu, uyarı, olumsuz, nötr. Renk her yerde metinle birlikte durur. */
const STATUS_DOT: Record<ProductStatus, string> = {
  İyi: "bg-good",
  Dikkat: "bg-warn",
  "Düşük kâr": "bg-bad",
  "Reçete yok": "bg-ink-quiet",
};

const PAGE_SIZE = 25;

/** Kategori adından ikon: aynı kategori her yerde aynı ikon ve tonda */
function categoryIcon(category: string): LucideIcon {
  const c = category.toLocaleLowerCase("tr-TR");
  if (/tatlı|pasta|kek|cake/.test(c)) return Cake;
  if (/atıştırmalık|sandviç|tost|kurabiye/.test(c)) return Cookie;
  if (/smoothie|strawberry|çilek|meyve/.test(c)) return Cherry;
  if (/frozen|dondurma|affogato|gelato/.test(c)) return IceCreamCone;
  if (/ice tea|çay|tea/.test(c)) return Leaf;
  if (/frappe|buzlu|soğuk|cold|iced/.test(c)) return CupSoda;
  if (/şişe/.test(c)) return GlassWater;
  if (/ekstra|şurup|sos/.test(c)) return Sparkles;
  return Coffee;
}

const sizeLabel = (s: string) => SIZE_LABELS[s as Size] ?? s;

// Aramada boyun kodu da (M) tabloda görünen adı da (Medium) eşleşir
const searchText = (r: ProductRow) => `${r.name} ${r.size} ${sizeLabel(r.size)} ${r.category}`;

/** Maliyet oranının hedefe göre rengi (Durum rozetiyle aynı eşikler) */
const ratioClass = (ratio: number, target: number) => (ratio > target + 0.1 ? "text-bad" : ratio > target ? "text-warn" : "text-good");

/** Telefonda tablo başlığı yerine sıralama seçimi */
const MOBILE_SORTS: { value: string; label: string }[] = [
  { value: "", label: "Menü sırası" },
  { value: "name.asc", label: "Ad (A → Z)" },
  { value: "unitProfit.desc", label: "Birim kâr (yüksekten)" },
  { value: "unitProfit.asc", label: "Birim kâr (düşükten)" },
  { value: "costRatio.desc", label: "Maliyet oranı (yüksekten)" },
  { value: "margin.desc", label: "Kâr marjı (yüksekten)" },
  { value: "price.desc", label: "Satış fiyatı (yüksekten)" },
  { value: "soldQty.desc", label: "Satış adedi (çoktan)" },
  { value: "monthProfit.desc", label: "Aylık brüt kâr (yüksekten)" },
];

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

/**
 * Menünün durum dağılımı: AkmanOS agent-limits-card'daki bölümlü pay çubuğu, altında renkli noktalı açıklama.
 * Çubuk yalnızca görsel; sayılar açıklamada yazılı.
 */
export function StatusShare({ parts }: { parts: { status: ProductStatus; count: number }[] }) {
  const reduce = useCalmMotion();
  const total = parts.reduce((a, p) => a + p.count, 0);
  return (
    <div className="space-y-2">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        {total
          ? parts
              .filter((p) => p.count > 0)
              .map((p, i) => (
                // Başlangıç her zaman aynı (sunucu çizimiyle eşleşsin); hareket azaltılmışsa süre 0
                <motion.span
                  key={p.status}
                  className={cn("h-full min-w-0 rounded-full", STATUS_DOT[p.status])}
                  initial={reduce ? false : { width: 0, opacity: 0.6 }}
                  animate={{ width: `${(p.count / total) * 100}%`, opacity: 1 }}
                  transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.12 + i * 0.05 }}
                />
              ))
          : null}
      </div>
      <ul className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs leading-5 text-ink-mute">
        {parts
          .filter((p) => p.status !== "Reçete yok" || p.count > 0)
          .map((p) => (
            <li key={p.status} className="inline-flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[p.status])} aria-hidden="true" />
              {p.status}
              <span className="font-medium text-ink tabular">{num(p.count)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Satır içinde fiyat düzenleme: Enter ya da alandan çıkmak kaydeder, Esc vazgeçer. Birim (₺) hep görünür. */
function PriceCell({ row, className }: { row: ProductRow; className?: string }) {
  const [value, setValue] = useState(priceText(row.price));
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState(row.price);
  // Esc'teki blur, eski değeri görür (setValue henüz çizilmedi); bu bayrak o blur'da kaydı atlatır
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      setValue(priceText(last));
      return;
    }
    const v = parseNumberTR(value);
    if (v === null || v < 0) {
      toast.error("Geçerli bir fiyat girin (ör. 185 ya da 185,50)");
      setValue(priceText(last));
      return;
    }
    if (Math.abs(v - last) < 0.005) {
      setValue(priceText(v));
      return;
    }
    setSaving(true);
    const res = await updateProductPrice(row.id, v);
    setSaving(false);
    if (res.ok) {
      setLast(v);
      setValue(priceText(v));
      toast.success(`${row.name} ${row.size}: ${tl(last, 2)} → ${tl(v, 2)}`);
    } else {
      toast.error(res.error);
      setValue(priceText(last));
    }
  }

  return (
    <div className={cn("relative inline-block w-24", className)}>
      <NumberInput
        aria-label={`${row.name} ${row.size} satış fiyatı (₺, KDV dahil)`}
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setValue(priceText(last));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="cell-input bg-surface/70 pr-6 pl-2 ring-line hover:bg-surface hover:ring-line-strong focus:bg-surface pointer-coarse:h-10"
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-ink-mute" aria-hidden="true">
        ₺
      </span>
    </div>
  );
}

/** Telefon kartındaki küçük ölçü: etiket üstte, değer altta */
function Metric({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs leading-5 text-ink-mute">{label}</dt>
      <dd className={cn("text-sm font-medium text-ink tabular", className)}>{children}</dd>
    </div>
  );
}

/** Ürün adı hücresi (tablo ve telefon kartı); telefonda durum rozetleri adın altında */
function ProductName({ r, compact }: { r: ProductRow; compact?: boolean }) {
  return (
    <Link href={`/panel/urunler/${r.id}`} className={cn("group/name flex min-w-0 gap-3", compact ? "items-start" : "items-center")}>
      {/* Tabloda karo yalnızca geniş ekranda: 1400px'te ad sütunu yer kazanır, satırlar sarılmaz */}
      <IconTile tone={toneFor(r.category)} className={compact ? undefined : "hidden 2xl:inline-flex"}>
        {createElement(categoryIcon(r.category))}
      </IconTile>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={cn("font-semibold break-words group-hover/name:underline", r.active ? "text-ink" : "text-ink-mute")}>{r.name}</span>
          {!r.active ? <Badge tone="gray">Pasif</Badge> : null}
          {r.hasEstimate && !compact ? (
            <Badge tone="amber" dot title="Reçetesinde faturada bulunamayan, tahmini fiyatlı malzeme var">
              Tahmini maliyet
            </Badge>
          ) : null}
        </span>
        {/* Kesilmez, sarılır: uzun kategori adı ürün sütununu genişletip tabloyu kaydırmasın */}
        <span className="block text-[13px] leading-5 text-pretty text-ink-mute">
          {sizeLabel(r.size)} · {r.category}
        </span>
        {compact ? (
          <span className="mt-1 flex flex-wrap gap-1">
            <StatusBadge status={r.status} />
            {r.hasEstimate ? (
              <Badge tone="amber" dot>
                Tahmini maliyet
              </Badge>
            ) : null}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function ProductsTable({
  rows,
  categories,
  monthLabel,
  target,
}: {
  rows: ProductRow[];
  categories: { id: number; name: string }[];
  monthLabel: string;
  target: number;
}) {
  const reduce = useCalmMotion();
  // Süzgeçler adreste: ?ara=latte&kategori=3&durum=Dikkat,Düşük kâr&pasif=1&sirala=unitProfit.desc
  // (genel bakıştaki ve ⌘K paletindeki bağlantılar aynı adları kullanır)
  const [q, setQ] = useQueryText("ara");
  const [kategori, setKategori] = useQueryState<string>("kategori", "");
  const [durum, setDurum] = useQueryState<string>("durum", "");
  const [pasif, setPasif] = useQueryState<string>("pasif", "");
  const [sira, setSira] = useQueryState<string>("sirala", "");
  const [details, setDetails] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  // Satırlar yalnızca kullanıcı sayfa ya da sıra değiştirince yumuşakça belirir (ilk çizimde değil)
  const [interacted, setInteracted] = useState(false);

  const category = categories.some((c) => String(c.id) === kategori) ? Number(kategori) : null;
  const statuses = useMemo(() => durum.split(",").filter((s): s is ProductStatus => STATUSES.includes(s as ProductStatus)), [durum]);
  const showInactive = pasif === "1";
  const sort = useMemo(() => parseSort(sira), [sira]);

  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  // Arama yalnızca pasif ürünlerle eşleşiyorsa (ör. ⌘K'dan pasif bir ürün) pasifler de listelenir
  const onlyInactiveMatch =
    !showInactive && q.trim() !== "" && !rows.some((r) => r.active && matches(searchText(r), q)) && rows.some((r) => !r.active && matches(searchText(r), q));
  const includeInactive = showInactive || onlyInactiveMatch;

  // Durum dışındaki süzgeçler; durum sayaçları bunun üzerinden sayılır
  const base = useMemo(
    () =>
      rows.filter((r) => (includeInactive || r.active) && (category === null || r.categoryId === category) && matches(searchText(r), q)),
    [rows, q, category, includeInactive],
  );

  const statusCounts = useMemo(() => {
    const m = new Map<ProductStatus, number>();
    for (const r of base) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [base]);

  const categoryCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) if (includeInactive || r.active) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1);
    return m;
  }, [rows, includeInactive]);

  const filtered = useMemo(() => {
    let list = statuses.length ? base.filter((r) => statuses.includes(r.status)) : base;
    if (sort) {
      const d = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) =>
        sort.key === "name" ? (a.name.localeCompare(b.name, "tr") || a.size.localeCompare(b.size, "tr")) * d : (a[sort.key] - b[sort.key]) * d,
      );
    }
    return list;
  }, [base, statuses, sort]);

  const paged = usePaged(filtered, PAGE_SIZE, `${q}|${category}|${durum}|${includeInactive}|${sira}`);

  // Görünen ürünlerin bu ayki toplamları (tablonun alt satırı ve telefon özeti)
  const totals = useMemo(
    () => ({
      qty: filtered.reduce((a, r) => a + r.soldQty, 0),
      profit: filtered.reduce((a, r) => a + r.monthProfit, 0),
      net: filtered.reduce((a, r) => a + r.monthNet, 0),
    }),
    [filtered],
  );

  // Sayısal sütunda ilk tık büyükten küçüğe, adda A→Z; üçüncü tık sıralamayı kaldırır
  const toggleSort = (key: SortKey) => {
    setInteracted(true);
    const firstDir = key === "name" ? "asc" : "desc";
    const next: Sort = sort?.key !== key ? { key, dir: firstDir } : sort.dir === firstDir ? { key, dir: firstDir === "asc" ? "desc" : "asc" } : null;
    setSira(sortParam(next));
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);

  const toggleStatus = (s: ProductStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : STATUSES.filter((x) => x === s || statuses.includes(x));
    setDurum(next.join(","));
  };

  const head = (key: NumKey, label: string, info?: string, sub?: string) => (
    <TH numeric>
      <span className="inline-flex items-center gap-1.5">
        <SortButton numeric dir={dirOf(key)} onClick={() => toggleSort(key)}>
          {label}
        </SortButton>
        {info ? <InfoTip text={info} /> : null}
      </span>
      {sub ? <span className="block text-xs leading-4 font-normal text-ink-mute">{sub}</span> : null}
    </TH>
  );

  const anyFilter = q.trim() !== "" || category !== null || statuses.length > 0 || showInactive;
  const clearFilters = () => {
    setQ("");
    clearQuery(["ara", "kategori", "durum", "pasif"]);
  };

  const exportCsv = () => {
    const header = [
      "Ürün",
      "Boy",
      "Kategori",
      "Aktif",
      "Satış fiyatı (KDV dahil)",
      "Net satış",
      "POS komisyonu",
      "Maliyet",
      "Toplam maliyet",
      "Birim kâr",
      "Kâr marjı (%)",
      "Maliyet oranı (%)",
      "Önerilen fiyat",
      "Durum",
      `${monthLabel} adet`,
      `${monthLabel} brüt kâr`,
      `${monthLabel} net ciro`,
      "Fire (%)",
      "Tahmini malzeme",
    ];
    const lines = filtered.map((r) => [
      r.name,
      sizeLabel(r.size),
      r.category,
      r.active ? "Evet" : "Hayır",
      num(r.price, 2),
      num(r.net, 2),
      num(r.commission, 2),
      num(r.cost, 2),
      num(r.totalCost, 2),
      num(r.unitProfit, 2),
      num(r.margin * 100, 1),
      num(r.costRatio * 100, 1),
      num(r.suggestedPrice, 0),
      r.status,
      num(r.soldQty),
      num(r.monthProfit, 2),
      num(r.monthNet, 2),
      num(r.fireRate * 100, 1) + (r.fireOverridden ? " (özel)" : ""),
      r.hasEstimate ? "Evet" : "",
    ]);
    downloadCsv(`urunler-${slugify(monthLabel)}.csv`, [header, ...lines]);
    toast.success(`${num(filtered.length)} ürün CSV olarak indirildi`);
  };

  const onPage = (p: number) => {
    setInteracted(true);
    paged.setPage(p);
  };

  return (
    <Card>
      <CardHeader
        icon={<Coffee />}
        title="Ürün listesi"
        description="Satış fiyatına tıklayıp değiştirin; Enter kaydeder, Esc vazgeçer. Ürün adı reçete kartını açar."
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
          <>
            <Button
              variant="secondary"
              className={cn("pointer-coarse:h-10", details && "text-ink ring-ink/30")}
              aria-pressed={details}
              onClick={() => setDetails((d) => !d)}
              title="Net satış, POS komisyonu, toplam maliyet, net ciro ve fire"
            >
              <SlidersHorizontal size={16} />
              {details ? "Sade görünüm" : "Tüm sütunlar"}
            </Button>
            <Button
              variant="secondary"
              className="pointer-coarse:h-10"
              onClick={exportCsv}
              disabled={!filtered.length}
              aria-label="Görünen listeyi CSV indir"
              title="Görünen listeyi CSV olarak indir"
            >
              <Download size={16} />
              CSV
            </Button>
          </>
        }
      />

      <FilterBar
        className="px-5 pb-4"
        active={anyFilter}
        onClear={clearFilters}
        shown={filtered.length}
        total={includeInactive ? rows.length : activeCount}
        unit="ürün"
      >
        <SearchField value={q} onChange={setQ} placeholder="Ürün, boy ya da kategori ara" label="Ürün ara" className="w-full sm:w-64" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Durum">
          {STATUSES.filter((s) => s !== "Reçete yok" || statuses.includes(s) || statusCounts.get(s)).map((s) => (
            <FilterChip key={s} active={statuses.includes(s)} onToggle={() => toggleStatus(s)} count={statusCounts.get(s) ?? 0}>
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[s], statuses.includes(s) && "ring-1 ring-white/70")} aria-hidden="true" />
              {s}
            </FilterChip>
          ))}
        </div>
        <Select
          value={category ?? ""}
          onChange={(e) => setKategori(e.target.value)}
          className={cn("w-full sm:w-auto sm:min-w-48 pointer-coarse:h-10", category !== null && "ring-ink/40")}
          aria-label="Kategori"
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({categoryCounts.get(c.id) ?? 0})
            </option>
          ))}
        </Select>
        {inactiveCount ? (
          <FilterChip active={showInactive} onToggle={() => setPasif(showInactive ? "" : "1")} count={inactiveCount}>
            Pasifleri de göster
          </FilterChip>
        ) : null}
        <Select
          value={sortParam(sort)}
          onChange={(e) => {
            setInteracted(true);
            setSira(e.target.value);
          }}
          className="w-full sm:hidden pointer-coarse:h-10"
          aria-label="Sıralama"
        >
          {MOBILE_SORTS.some((o) => o.value === sortParam(sort)) ? null : <option value={sortParam(sort)}>Tablodaki sıra</option>}
          {MOBILE_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              Sırala: {o.label}
            </option>
          ))}
        </Select>
      </FilterBar>

      {onlyInactiveMatch ? (
        <p className="mx-5 mb-3 rounded-xl bg-info-soft px-3.5 py-2 text-[13px] text-info" role="status">
          Aramanız yalnızca pasif ürünlerle eşleşti; pasifler de listeleniyor.
        </p>
      ) : null}

      {filtered.length ? (
        <>
          {/* Geniş ekran: tablo (ilk sütun yatay kaydırmada sabit) */}
          <TableWrap className="max-sm:hidden">
            {/* Sütun arası 16px (ilk ve son sütunun dış kenarı 12px, kart başlığıyla hizalı); başlıklar iki satıra
                sarılabilir. Böylece sade görünüm 1400px'lik ekranda yatay kaydırmasız sığar. */}
            <Table className="[&_td]:px-2 [&_td:first-child]:pl-3 [&_td:last-child]:pr-3 [&_th]:px-2 [&_th:first-child]:pl-3 [&_th:last-child]:pr-3">
              <THead className="[&_th]:align-bottom [&_th]:whitespace-normal">
                <tr>
                  <TH sticky>
                    <SortButton dir={dirOf("name")} onClick={() => toggleSort("name")}>
                      Ürün
                    </SortButton>
                  </TH>
                  {head("price", "Satış fiyatı", "KDV dahil menü fiyatı. Üzerine tıklayıp değiştirebilirsiniz; Enter ile kaydedilir.")}
                  {details ? head("net", "Net satış", "Satış fiyatı ÷ (1 + KDV). Devlete ödenecek KDV çıktıktan sonra kasanıza kalan.") : null}
                  {details ? head("commission", "POS kom.", "Satış fiyatı × banka komisyonu × kartlı satış oranı. Nakitte komisyon yoktur.") : null}
                  {head("cost", "Maliyet", "Reçete kartındaki malzeme + ambalaj + fire payı (KDV hariç).")}
                  {details ? head("totalCost", "Toplam maliyet", "Malzeme + ambalaj + POS komisyonu.") : null}
                  {head("unitProfit", "Birim kâr", "Net satış − toplam maliyet. Bir adet satınca kira/personel öncesi elinize kalan.")}
                  {head(
                    "costRatio",
                    "Maliyet oranı",
                    `Malzeme maliyeti ÷ net satış (food cost). Hedef ≤ %${num(target * 100)}. Altındaki durum: İyi = hedefin altında, Dikkat = hedefin 10 puan üstüne kadar, Düşük kâr = daha fazlası, Reçete yok = reçete kartı boş.`,
                    "ve durum",
                  )}
                  {head("margin", "Kâr marjı", "Birim kâr ÷ net satış.")}
                  {head("suggestedPrice", "Önerilen fiyat", "Maliyetin hedef orana denk geldiği KDV dahil fiyat, 5 ₺'ye yuvarlanmış. Ok işareti: fiyatınız bunun altında.")}
                  {head("soldQty", "Adet", "Satış raporundan bu ürünle eşleşen adet.", monthLabel)}
                  {head("monthProfit", "Brüt kâr", "Birim kâr × satış adedi.", monthLabel)}
                  {details ? head("monthNet", "Net ciro", "Net satış × satış adedi.", monthLabel) : null}
                  {details ? <TH numeric>Fire</TH> : null}
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
                {paged.slice.map((r) => {
                  const underPriced = r.price < r.suggestedPrice;
                  return (
                    <TR key={r.id}>
                      <TD sticky className="max-w-[15rem] min-w-48">
                        <ProductName r={r} />
                      </TD>
                      <TD numeric>
                        <PriceCell key={`${r.id}:${r.price}`} row={r} />
                      </TD>
                      {details ? <TD numeric>{tl(r.net, 2)}</TD> : null}
                      {details ? <TD numeric>{tl(r.commission, 2)}</TD> : null}
                      <TD numeric>{tl(r.cost, 2)}</TD>
                      {details ? <TD numeric>{tl(r.totalCost, 2)}</TD> : null}
                      <TD numeric className="font-medium">
                        <Signed value={r.unitProfit}>{tl(r.unitProfit, 2)}</Signed>
                      </TD>
                      {/* Durum maliyet oranından gelir: ikisi aynı hücrede, tablo dar ekranda da sığsın */}
                      <TD numeric>
                        <span className={cn("font-medium", ratioClass(r.costRatio, target))}>{pct(r.costRatio)}</span>
                        <span className="mt-1 flex justify-end">
                          <StatusBadge status={r.status} />
                        </span>
                      </TD>
                      <TD numeric className="text-ink-soft">
                        {pct(r.margin)}
                      </TD>
                      <TD numeric>
                        <span
                          className={cn("inline-flex items-center gap-1", underPriced ? "font-semibold text-ink" : "text-ink-soft")}
                          title={underPriced ? "Satış fiyatı önerilen fiyatın altında" : undefined}
                        >
                          {underPriced ? (
                            <>
                              <ArrowUpRight size={14} className="text-bad" aria-hidden="true" />
                              <span className="sr-only">Fiyatınız önerilenin altında:</span>
                            </>
                          ) : null}
                          {tl(r.suggestedPrice)}
                        </span>
                      </TD>
                      <TD numeric>{r.soldQty ? num(r.soldQty) : <span className="text-ink-quiet">0</span>}</TD>
                      <TD numeric>{r.soldQty ? <Signed value={r.monthProfit}>{tl(r.monthProfit)}</Signed> : <span className="text-ink-quiet">–</span>}</TD>
                      {details ? <TD numeric>{r.soldQty ? tl(r.monthNet) : <span className="text-ink-quiet">–</span>}</TD> : null}
                      {details ? (
                        <TD numeric>
                          {pct(r.fireRate, 0)}
                          {r.fireOverridden ? <span className="ml-1 text-xs text-ink-mute">(özel)</span> : null}
                        </TD>
                      ) : null}
                      <TD>
                        <div className="flex justify-end">
                          <IconLink href={`/panel/urunler/${r.id}`} label={r.lineCount ? "Reçete kartını aç" : "Reçeteyi girin"}>
                            {r.lineCount ? <FileText size={15} /> : <FilePlus2 size={15} />}
                          </IconLink>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </motion.tbody>
              <tfoot>
                <TFootRow>
                  <TD sticky className="font-semibold whitespace-nowrap">
                    Görünen {num(filtered.length)} ürün
                  </TD>
                  <TD colSpan={details ? 9 : 6} />
                  <TD numeric>{num(totals.qty)} adet</TD>
                  <TD numeric>
                    <Signed value={totals.profit}>{tl(totals.profit)}</Signed>
                  </TD>
                  {details ? <TD numeric>{tl(totals.net)}</TD> : null}
                  <TD colSpan={details ? 2 : 1} />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>

          {/* Telefon: her ürün bir kart; fiyat yine yerinde değişir */}
          <motion.ul
            key={`m|${paged.page}|${sira}`}
            initial={reduce || !interacted ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="mx-2 mb-2 divide-y divide-line-strong/70 sm:hidden"
            aria-label="Ürünler"
          >
            {paged.slice.map((r) => (
              <li key={r.id} className="px-3 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <ProductName r={r} compact />
                  <PriceCell key={`${r.id}:${r.price}`} row={r} className="shrink-0" />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                  <Metric label="Maliyet">{tl(r.cost, 2)}</Metric>
                  <Metric label="Birim kâr">
                    <Signed value={r.unitProfit}>{tl(r.unitProfit, 2)}</Signed>
                  </Metric>
                  <Metric label="Maliyet oranı" className={ratioClass(r.costRatio, target)}>
                    {pct(r.costRatio)}
                  </Metric>
                  <Metric label="Kâr marjı">{pct(r.margin)}</Metric>
                  <Metric label="Önerilen" className={r.price < r.suggestedPrice ? "font-semibold" : "text-ink-soft"}>
                    {r.price < r.suggestedPrice ? (
                      <>
                        <ArrowUpRight size={13} className="-mt-0.5 mr-0.5 inline text-bad" aria-hidden="true" />
                        <span className="sr-only">Fiyatınız önerilenin altında:</span>
                      </>
                    ) : null}
                    {tl(r.suggestedPrice)}
                  </Metric>
                  <Metric label={monthLabel}>
                    {num(r.soldQty)} adet
                    {r.soldQty ? (
                      <Signed value={r.monthProfit} className="block text-xs font-normal text-ink-mute">
                        {tl(r.monthProfit)} kâr
                      </Signed>
                    ) : null}
                  </Metric>
                  {details ? (
                    <>
                      <Metric label="Net satış">{tl(r.net, 2)}</Metric>
                      <Metric label="POS kom.">{tl(r.commission, 2)}</Metric>
                      <Metric label="Toplam maliyet">{tl(r.totalCost, 2)}</Metric>
                      <Metric label="Net ciro">{r.soldQty ? tl(r.monthNet) : "–"}</Metric>
                      <Metric label="Fire">
                        {pct(r.fireRate, 0)}
                        {r.fireOverridden ? <span className="ml-1 text-xs font-normal text-ink-mute">(özel)</span> : null}
                      </Metric>
                    </>
                  ) : null}
                </dl>
                {!r.lineCount ? (
                  <Link
                    href={`/panel/urunler/${r.id}`}
                    className="mt-2.5 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-info hover:underline"
                  >
                    <FilePlus2 size={15} aria-hidden="true" /> Reçeteyi girin
                  </Link>
                ) : null}
              </li>
            ))}
          </motion.ul>
          <p className="mx-5 mb-1 flex flex-wrap justify-between gap-x-3 border-t border-line-strong pt-3 text-[13px] text-ink-mute sm:hidden">
            <span>Görünen {num(filtered.length)} ürün</span>
            <span className="tabular">
              {monthLabel}: {num(totals.qty)} adet ·{" "}
              <Signed value={totals.profit} className="font-semibold text-ink">
                {tl(totals.profit)}
              </Signed>{" "}
              brüt kâr
            </span>
          </p>

          {/* Dokunmatikte sayfa düğmeleri 40px (paylaşılan bileşen 36px) */}
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={onPage}
            unit="ürün"
            className="border-t border-line pointer-coarse:[&_button]:h-10 pointer-coarse:[&_button]:min-w-10"
          />
        </>
      ) : (
        <div className="flex min-h-80 items-center justify-center">
          {rows.length ? (
            <EmptyState
              icon={<SearchX />}
              title={q.trim() ? `“${q.trim()}” için ürün yok` : "Bu süzgeçlerle ürün yok"}
              description={
                !showInactive && inactiveCount && !anyFilter
                  ? "Menüdeki bütün ürünler pasif. Pasifleri göstererek listeyi açın."
                  : "Aramayı kısaltın, durum ya da kategori süzgecini kaldırın; menüde yoksa yeni ürün olarak ekleyin."
              }
              action={
                <>
                  {anyFilter ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Süzgeci temizle
                    </Button>
                  ) : null}
                  {!includeInactive && inactiveCount ? (
                    <Button variant="secondary" onClick={() => setPasif("1")}>
                      Pasifleri de göster
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
              title="Henüz ürün yok"
              description="İlk ürünü ekleyin; sonra reçete kartına malzemelerini girersiniz."
              action={
                <Button onClick={() => setCreating("")}>
                  <Plus size={16} /> Yeni ürün
                </Button>
              }
            />
          )}
        </div>
      )}

      {creating !== null ? (
        <NewProductDialog
          categories={categories}
          products={rows.map((r) => ({
            id: r.id,
            name: r.name,
            size: r.size,
            label: `${r.name} · ${r.size}`,
            categoryId: r.categoryId,
            active: r.active,
            price: r.price,
          }))}
          initialName={creating}
          initialCategory={category ?? undefined}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </Card>
  );
}
