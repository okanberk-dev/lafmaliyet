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
  SearchX,
  SlidersHorizontal,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, IconLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { NumberInput, SearchInput, Select } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, Signed } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SortButton, Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { ProductStatus } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { num, pct, tl } from "@/lib/format";
import { cn, matchesSearch, slugify } from "@/lib/utils";
import { updateProductPrice } from "@/server/actions/products";

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
type StatusFilter = "all" | ProductStatus;

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

function PriceCell({ row }: { row: ProductRow }) {
  const [value, setValue] = useState(num(row.price, 2));
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState(row.price);
  // Esc'teki blur, eski değeri görür (setValue henüz çizilmedi); bu bayrak o blur'da kaydı atlatır
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      setValue(num(last, 2));
      return;
    }
    const v = parseNumberTR(value);
    if (v === null || v < 0) {
      toast.error("Geçerli bir fiyat girin");
      setValue(num(last, 2));
      return;
    }
    if (Math.abs(v - last) < 0.005) {
      setValue(num(v, 2));
      return;
    }
    setSaving(true);
    const res = await updateProductPrice(row.id, v);
    setSaving(false);
    if (res.ok) {
      setLast(v);
      setValue(num(v, 2));
      toast.success(`${row.name} ${row.size}: ${tl(v)}`);
    } else {
      toast.error(res.error);
      setValue(num(last, 2));
    }
  }

  return (
    <NumberInput
      aria-label={`${row.name} ${row.size} satış fiyatı`}
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setValue(num(last, 2));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="cell-input w-24 bg-surface/70 px-2 ring-line hover:bg-surface hover:ring-line-strong focus:bg-surface"
    />
  );
}

export function ProductsTable({
  rows,
  categories,
  monthLabel,
  target,
  initialCategory,
  initialStatus,
  initialQuery = "",
}: {
  rows: ProductRow[];
  categories: { id: number; name: string }[];
  monthLabel: string;
  target: number;
  initialCategory: number | null;
  initialStatus: string | null;
  initialQuery?: string;
}) {
  const reduce = useCalmMotion();
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState<number | null>(
    initialCategory !== null && categories.some((c) => c.id === initialCategory) ? initialCategory : null,
  );
  const [status, setStatus] = useState<StatusFilter>(
    initialStatus && STATUSES.includes(initialStatus as ProductStatus) ? (initialStatus as ProductStatus) : "all",
  );
  // ?ara ile gelinen ürün yalnızca pasiflerde varsa pasifler açık başlar
  const [showInactive, setShowInactive] = useState(
    () =>
      !!initialQuery &&
      !rows.some((r) => r.active && matchesSearch(searchText(r), initialQuery)) &&
      rows.some((r) => !r.active && matchesSearch(searchText(r), initialQuery)),
  );
  const [details, setDetails] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  // Satırlar yalnızca kullanıcı sayfa ya da sıra değiştirince yumuşakça belirir (ilk çizimde değil)
  const [interacted, setInteracted] = useState(false);

  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  // Durum dışındaki filtreler; durum sayaçları bunun üzerinden sayılır
  const base = useMemo(
    () =>
      rows.filter(
        (r) =>
          (showInactive || r.active) &&
          (category === null || r.categoryId === category) &&
          matchesSearch(searchText(r), q),
      ),
    [rows, q, category, showInactive],
  );

  const statusCounts = useMemo(() => {
    const m = new Map<ProductStatus, number>();
    for (const r of base) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [base]);

  const categoryCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) if (showInactive || r.active) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1);
    return m;
  }, [rows, showInactive]);

  const filtered = useMemo(() => {
    let list = status === "all" ? base : base.filter((r) => r.status === status);
    if (sort) {
      const d = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) =>
        sort.key === "name"
          ? (a.name.localeCompare(b.name, "tr") || a.size.localeCompare(b.size, "tr")) * d
          : (a[sort.key] - b[sort.key]) * d,
      );
    }
    return list;
  }, [base, status, sort]);

  const paged = usePaged(filtered, PAGE_SIZE, `${q}|${category}|${status}|${showInactive}|${sort?.key}|${sort?.dir}`);

  // Sayısal sütunda ilk tık büyükten küçüğe, adda A→Z; üçüncü tık sıralamayı kaldırır
  const toggleSort = (key: SortKey) => {
    setInteracted(true);
    setSort((s) => {
      const firstDir = key === "name" ? "asc" : "desc";
      if (s?.key !== key) return { key, dir: firstDir };
      return s.dir === firstDir ? { key, dir: firstDir === "asc" ? "desc" : "asc" } : null;
    });
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);

  const head = (key: NumKey, label: string, info?: string) => (
    <TH numeric>
      <span className="inline-flex items-center gap-1.5">
        <SortButton numeric dir={dirOf(key)} onClick={() => toggleSort(key)}>
          {label}
        </SortButton>
        {info ? <InfoTip text={info} /> : null}
      </span>
    </TH>
  );

  const anyFilter = q !== "" || category !== null || status !== "all";
  const clearFilters = () => {
    setQ("");
    setCategory(null);
    setStatus("all");
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
  };

  return (
    <Card>
      <CardHeader
        icon={<Coffee />}
        title="Ürün listesi"
        description="Satış fiyatına tıklayıp değiştirin; Enter kaydeder, Esc vazgeçer."
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
            <p className="mr-1 text-sm text-ink-mute tabular" aria-live="polite">
              {num(filtered.length)} ürün gösteriliyor
            </p>
            <Switch checked={showInactive} onChange={setShowInactive} label="Pasifleri göster" showText onText="Pasifleri göster" offText="Pasifleri göster" />
            <Button variant="secondary" className={cn(details && "text-ink")} onClick={() => setDetails((d) => !d)}>
              <SlidersHorizontal size={16} />
              {details ? "Sade görünüm" : "Tüm sütunlar"}
            </Button>
            <Button variant="secondary" onClick={exportCsv} disabled={!filtered.length} aria-label="CSV indir" title="Görünen listeyi CSV olarak indir">
              <Download size={16} />
              CSV
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-2 px-5 pb-4 xl:flex-row xl:items-center">
        <SearchInput
          wrapperClassName="min-w-0 xl:max-w-xs xl:flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ürün ara…"
          aria-label="Ürün ara"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Segmented<StatusFilter>
            label="Durum"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Tümü", count: base.length },
              ...STATUSES.map((s) => ({
                value: s,
                label: (
                  <>
                    <span className={cn("size-1.5 rounded-full", STATUS_DOT[s])} aria-hidden="true" />
                    {s}
                  </>
                ),
                count: statusCounts.get(s) ?? 0,
              })),
            ]}
          />
          <Select
            value={category ?? ""}
            onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : null)}
            className="w-auto min-w-0 flex-1 basis-44 sm:min-w-48 sm:flex-none sm:basis-auto"
            aria-label="Kategori"
          >
            <option value="">Tüm kategoriler</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({categoryCounts.get(c.id) ?? 0})
              </option>
            ))}
          </Select>
          {anyFilter ? (
            <Button variant="ghost" onClick={clearFilters}>
              <X size={15} /> Temizle
            </Button>
          ) : null}
        </div>
      </div>

      {filtered.length ? (
        <TableWrap>
          <Table>
            <THead>
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
                {head("margin", "Kâr marjı", "Birim kâr ÷ net satış.")}
                {head("costRatio", "Maliyet oranı", `Malzeme maliyeti ÷ net satış (food cost). Hedef ≤ %${num(target * 100)}.`)}
                {head("suggestedPrice", "Önerilen fiyat", "Maliyetin hedef orana denk geldiği KDV dahil fiyat, 5 ₺'ye yuvarlanmış. Ok işareti: fiyatınız bunun altında.")}
                <TH>
                  <span className="inline-flex items-center gap-1.5">
                    Durum
                    <InfoTip text="İyi = maliyet oranı hedefin altında. Dikkat = hedefin 10 puan üstüne kadar. Düşük kâr = daha fazlası. Reçete yok = reçete kartı boş." />
                  </span>
                </TH>
                {head("soldQty", `${monthLabel} adet`, "Satış raporundan bu ürünle eşleşen adet.")}
                {head("monthProfit", `${monthLabel} brüt kâr`, "Birim kâr × satış adedi.")}
                {details ? head("monthNet", "Net ciro", "Net satış × satış adedi.") : null}
                {details ? <TH numeric>Fire</TH> : null}
                <TH className="w-px">
                  <span className="sr-only">Eylemler</span>
                </TH>
              </tr>
            </THead>
            <motion.tbody
              key={`${paged.page}|${sort?.key}|${sort?.dir}`}
              initial={reduce || !interacted ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
            >
              {paged.slice.map((r) => {
                const Icon = categoryIcon(r.category);
                const underPriced = r.price < r.suggestedPrice;
                return (
                  <TR key={r.id}>
                    <TD sticky className="max-w-[15rem] min-w-40 sm:min-w-52">
                      <Link href={`/panel/urunler/${r.id}`} className="group/name flex items-center gap-3">
                        <IconTile tone={toneFor(r.category)} className="hidden sm:inline-flex">
                          <Icon />
                        </IconTile>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className={cn("font-semibold group-hover/name:underline", r.active ? "text-ink" : "text-ink-mute")}>{r.name}</span>
                            {!r.active ? <Badge tone="gray">Pasif</Badge> : null}
                            {r.hasEstimate ? (
                              <Badge tone="amber" dot title="Reçetesinde faturada bulunamayan, tahmini fiyatlı malzeme var">
                                Tahmini maliyet
                              </Badge>
                            ) : null}
                          </span>
                          <span className="block truncate text-[13px] leading-5 text-ink-mute">
                            {sizeLabel(r.size)} · {r.category}
                          </span>
                        </span>
                      </Link>
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
                    <TD numeric className="text-ink-soft">
                      {pct(r.margin)}
                    </TD>
                    <TD numeric className={cn("font-medium", r.costRatio > target + 0.1 ? "text-bad" : r.costRatio > target ? "text-warn" : "text-good")}>
                      {pct(r.costRatio)}
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
                    <TD>
                      <StatusBadge status={r.status} />
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
          </Table>
        </TableWrap>
      ) : (
        <div className="flex min-h-80 items-center justify-center">
          {rows.length ? (
            <EmptyState
              icon={<SearchX />}
              title="Bu filtrelerle ürün bulunamadı"
              description={
                !showInactive && inactiveCount && !anyFilter
                  ? "Menüdeki bütün ürünler pasif. Pasifleri göstererek listeyi açın."
                  : "Aramayı veya filtreleri değiştirin."
              }
              action={
                <>
                  {anyFilter ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Filtreleri temizle
                    </Button>
                  ) : null}
                  {!showInactive && inactiveCount ? (
                    <Button variant="secondary" onClick={() => setShowInactive(true)}>
                      Pasifleri göster
                    </Button>
                  ) : null}
                </>
              }
            />
          ) : (
            <EmptyState title="Henüz ürün yok" description="Sağ üstteki Yeni ürün düğmesiyle ilk ürünü ekleyin." />
          )}
        </div>
      )}

      {filtered.length ? (
        <Pagination
          page={paged.page}
          pageCount={paged.pageCount}
          onChange={(p) => {
            setInteracted(true);
            paged.setPage(p);
          }}
          unit="ürün"
          className="border-t border-line"
        />
      ) : null}
    </Card>
  );
}
