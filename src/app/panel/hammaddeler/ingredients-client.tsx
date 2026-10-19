"use client";

import {
  Bean,
  Box,
  Cake,
  Cherry,
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
  X,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { PriceLine } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, SearchInput, Select, Textarea } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Ingredient } from "@/lib/calc/types";
import { COUNT_GROUPS, COUNT_UNITS, INGREDIENT_CATEGORIES, UNITS } from "@/lib/constants";
import { dateTR, num, pct, tl, tlUnit } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { deleteIngredient, saveIngredient, updateIngredientPrice } from "@/server/actions/ingredients";

import { catOrder } from "./categories";

export interface IngredientRow extends Ingredient {
  unitCost: number;
  usedIn: { id: number; label: string }[];
  monthUsage: number;
  history: { at: string; price: number; size: number; by: string | null }[];
}

type Filter = "all" | "tahmini" | "kullanilmayan" | "pasif";
type SortKey = "name" | "packagePrice" | "unitCost" | "usedIn" | "monthUsage";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const PAGE_SIZE = 25;
const FILTERS: Filter[] = ["all", "tahmini", "kullanilmayan", "pasif"];

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

const searchText = (r: IngredientRow) => `${r.name} ${r.supplier ?? ""} ${r.packageDesc ?? ""}`;

const sortValue = (r: IngredientRow, key: Exclude<SortKey, "name">) => (key === "usedIn" ? r.usedIn.length : r[key]);

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

function PackagePriceCell({ row }: { row: IngredientRow }) {
  const [value, setValue] = useState(num(row.packagePrice, 2));
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
      return setValue(num(last, 2));
    }
    const v = parseNumberTR(value);
    if (v === null || v < 0) {
      setValue(num(last, 2));
      return toast.error("Geçerli bir fiyat girin");
    }
    if (Math.abs(v - last) < 0.0001) return setValue(num(v, 2));
    setSaving(true);
    const res = await updateIngredientPrice(row.id, v);
    setSaving(false);
    if (!res.ok) {
      setValue(num(last, 2));
      return toast.error(res.error);
    }
    setLast(v);
    setValue(num(v, 2));
    toast.success(`${row.name}: yeni paket fiyatı ${tl(v, 2)}. ${row.usedIn.length} ürünün maliyeti güncellendi.`);
  }
  return (
    <NumberInput
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
      aria-label={`${row.name} paket fiyatı`}
      className="cell-input w-28 bg-surface/70 px-2 ring-line hover:bg-surface hover:ring-line-strong focus:bg-surface"
    />
  );
}

export function IngredientsClient({
  rows,
  categories,
  initialFilter,
  initialQuery = "",
}: {
  rows: IngredientRow[];
  categories: string[];
  initialFilter: string | null;
  initialQuery?: string;
}) {
  const reduce = useCalmMotion();
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState<string>("");
  const [filter, setFilter] = useState<Filter>(() => {
    const f = FILTERS.includes(initialFilter as Filter) ? (initialFilter as Filter) : "all";
    // ?ara ile gelinen malzeme yalnızca pasiflerdeyse doğrudan pasif listesi açılır
    if (
      f === "all" &&
      initialQuery &&
      !rows.some((r) => r.active && matchesSearch(searchText(r), initialQuery)) &&
      rows.some((r) => !r.active && matchesSearch(searchText(r), initialQuery))
    )
      return "pasif";
    return f;
  });
  const [sort, setSort] = useState<Sort>(null);
  const [editing, setEditing] = useState<IngredientRow | null>(null);
  const [deleting, setDeleting] = useState<IngredientRow | null>(null);
  // Satırlar yalnızca kullanıcı sayfa ya da sıra değiştirince yumuşakça belirir (ilk çizimde değil)
  const [interacted, setInteracted] = useState(false);

  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  // Filtre dışındaki koşullar (kategori + arama); filtre sayaçları bunun üzerinden sayılır
  const base = useMemo(() => rows.filter((r) => (!category || r.category === category) && matchesSearch(searchText(r), q)), [rows, category, q]);

  const counts = useMemo(
    () => ({
      all: base.filter((r) => r.active).length,
      tahmini: base.filter((r) => r.active && r.isEstimate).length,
      kullanilmayan: base.filter((r) => r.active && !r.usedIn.length).length,
      pasif: base.filter((r) => !r.active).length,
    }),
    [base],
  );

  // Kategori seçeneklerindeki sayılar: seçili görünümün (aktif ya da pasif) malzemeleri
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (inScope(r, filter)) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [rows, filter]);

  const visible = useMemo(() => {
    const list = base.filter(
      (r) => inScope(r, filter) && (filter !== "tahmini" || r.isEstimate) && (filter !== "kullanilmayan" || !r.usedIn.length),
    );
    const byName = (a: IngredientRow, b: IngredientRow) => a.name.localeCompare(b.name, "tr");
    if (!sort) return list.sort((a, b) => catOrder(a.category) - catOrder(b.category) || byName(a, b));
    const d = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => (sort.key === "name" ? byName(a, b) * d : (sortValue(a, sort.key) - sortValue(b, sort.key)) * d || byName(a, b)));
  }, [base, filter, sort]);

  const paged = usePaged(visible, PAGE_SIZE, `${q}|${category}|${filter}|${sort?.key}|${sort?.dir}`);

  // Sayısal sütunda ilk tık büyükten küçüğe, adda A→Z; üçüncü tık kategori sırasına döner
  const toggleSort = (key: SortKey) => {
    setInteracted(true);
    setSort((s) => {
      const firstDir = key === "name" ? "asc" : "desc";
      if (s?.key !== key) return { key, dir: firstDir };
      return s.dir === firstDir ? { key, dir: firstDir === "asc" ? "desc" : "asc" } : null;
    });
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);

  const anyFilter = q !== "" || category !== "" || filter !== "all";
  const clearFilters = () => {
    setQ("");
    setCategory("");
    setFilter("all");
  };

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
      "Reçete sayısı",
      "Son ay kullanım",
      "Tahmini",
      "Aktif",
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
      num(r.usedIn.length),
      num(r.monthUsage, 2),
      r.isEstimate ? "Evet" : "",
      r.active ? "Evet" : "Hayır",
    ]);
    downloadCsv("hammaddeler.csv", [header, ...lines]);
  };

  return (
    <Card>
      <CardHeader
        icon={<Package />}
        title="Hammadde listesi"
        description="Yeni fatura gelince yalnızca paket fiyatını değiştirin; Enter kaydeder, Esc vazgeçer. Gerçek fiyatı yazınca Tahmini işareti kalkar."
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
              {num(visible.length)} malzeme
            </p>
            <Button variant="secondary" onClick={exportCsv} disabled={!visible.length} aria-label="CSV indir" title="Görünen listeyi CSV olarak indir">
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
          placeholder="Malzeme, tedarikçi ara…"
          aria-label="Malzeme ara"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Segmented<Filter>
            label="Filtre"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Tümü", count: counts.all },
              {
                value: "tahmini",
                label: (
                  <>
                    <span className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
                    Tahmini fiyat
                  </>
                ),
                count: counts.tahmini,
              },
              { value: "kullanilmayan", label: "Reçetede yok", count: counts.kullanilmayan },
              { value: "pasif", label: "Pasif", count: counts.pasif },
            ]}
          />
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-auto min-w-0 flex-1 basis-44 sm:min-w-48 sm:flex-none sm:basis-auto"
            aria-label="Kategori"
          >
            <option value="">Tüm kategoriler</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c} ({categoryCounts.get(c) ?? 0})
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

      {visible.length ? (
        <TableWrap>
          <Table>
            <THead>
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
                    <InfoTip text="KDV hariç, iskonto düşülmüş. Yeni fatura geldiğinde sadece bunu değiştirin; Enter ile kaydedilir." />
                  </span>
                </TH>
                <TH numeric>
                  <span className="inline-flex items-center gap-1.5">
                    <SortButton numeric dir={dirOf("unitCost")} onClick={() => toggleSort("unitCost")}>
                      Birim maliyet
                    </SortButton>
                    <InfoTip text="Paket fiyatı ÷ paket içeriği: 1 gr / 1 ml / 1 adet malzemenin maliyeti. Reçeteler bunu kullanır." />
                  </span>
                </TH>
                <TH numeric>Alış KDV</TH>
                <TH numeric>
                  <SortButton numeric dir={dirOf("usedIn")} onClick={() => toggleSort("usedIn")}>
                    Reçete
                  </SortButton>
                </TH>
                <TH numeric>
                  <SortButton numeric dir={dirOf("monthUsage")} onClick={() => toggleSort("monthUsage")}>
                    Son ay kullanım
                  </SortButton>
                </TH>
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
                const Icon = CATEGORY_ICON[r.category] ?? Box;
                return (
                  <TR key={r.id} className={cn(r.isEstimate && ESTIMATE_ROW)}>
                    <TD sticky className={cn("max-w-[17rem] min-w-44 sm:min-w-56", r.isEstimate && ESTIMATE_STICKY)}>
                      <button type="button" className="group/name flex items-center gap-3 text-left" onClick={() => setEditing(r)}>
                        <IconTile tone={toneFor(r.category)} className="hidden sm:inline-flex">
                          <Icon />
                        </IconTile>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className={cn("font-semibold group-hover/name:underline", r.active ? "text-ink" : "text-ink-mute")}>{r.name}</span>
                            {r.isEstimate ? (
                              <Badge tone="amber" dot title="Faturada bulunamayan, tahmini değer">
                                Tahmini
                              </Badge>
                            ) : null}
                            {!r.usedIn.length ? <Badge tone="gray">Reçetede yok</Badge> : null}
                          </span>
                          <span className="block truncate text-[13px] leading-5 text-ink-mute">
                            {r.category}
                            {r.supplier ? ` · ${r.supplier}` : ""}
                          </span>
                        </span>
                      </button>
                    </TD>
                    <TD>
                      <span className="block max-w-60 truncate text-ink-soft" title={r.packageDesc ?? ""}>
                        {r.packageDesc ?? "–"}
                      </span>
                      <span className="block text-[13px] text-ink-mute tabular">
                        {num(r.packageSize)} {r.unit}
                      </span>
                    </TD>
                    <TD numeric>
                      <PackagePriceCell key={`${r.id}:${r.packagePrice}`} row={r} />
                    </TD>
                    <TD numeric className="font-medium">
                      {tlUnit(r.unitCost)}
                      <span className="text-xs font-normal text-ink-mute">/{r.unit}</span>
                    </TD>
                    <TD numeric className="text-ink-soft">
                      {pct(r.vatRate, 0)}
                    </TD>
                    <TD numeric>{r.usedIn.length ? num(r.usedIn.length) : <span className="text-ink-quiet">0</span>}</TD>
                    <TD numeric className="text-ink-soft">
                      {r.monthUsage ? `${num(r.monthUsage)} ${r.unit}` : <span className="text-ink-quiet">–</span>}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <IconButton label="Düzenle" onClick={() => setEditing(r)}>
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton label="Sil" tone="danger" onClick={() => setDeleting(r)}>
                          <Trash2 size={15} />
                        </IconButton>
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
              title="Malzeme bulunamadı"
              description={
                filter === "all" && counts.pasif ? "Aradığınız malzemeler pasif olabilir; pasif listesine bakın." : "Aramayı veya filtreleri değiştirin."
              }
              action={
                <>
                  {anyFilter ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Filtreleri temizle
                    </Button>
                  ) : null}
                  {filter === "all" && counts.pasif ? (
                    <Button variant="secondary" onClick={() => setFilter("pasif")}>
                      Pasifleri göster ({num(counts.pasif)})
                    </Button>
                  ) : null}
                </>
              }
            />
          ) : (
            <EmptyState title="Henüz malzeme yok" description="Sağ üstteki Yeni hammadde düğmesiyle ilk malzemeyi ekleyin." />
          )}
        </div>
      )}

      {visible.length ? (
        <Pagination
          page={paged.page}
          pageCount={paged.pageCount}
          onChange={(p) => {
            setInteracted(true);
            paged.setPage(p);
          }}
          unit="malzeme"
          className="border-t border-line"
        />
      ) : null}

      {editing ? (
        <IngredientDialog
          row={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setDeleting(editing);
            setEditing(null);
          }}
        />
      ) : null}
      {deleting ? <DeleteDialog row={deleting} onClose={() => setDeleting(null)} /> : null}
    </Card>
  );
}

/** Sayfa başlığındaki "Yeni hammadde" düğmesi */
export function NewIngredientButton({ categories }: { categories: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> Yeni hammadde
      </Button>
      {open ? <IngredientDialog row={null} categories={categories} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DeleteDialog({ row, onClose }: { row: IngredientRow; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    const res = await deleteIngredient(row.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Silindi");
    onClose();
  }
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={confirm}
      pending={busy}
      title={`${row.name} silinsin mi?`}
      description={
        row.usedIn.length ? (
          <>
            <span className="mb-3 block rounded-2xl bg-warn-soft px-3.5 py-2.5 text-warn">
              Bu malzeme {num(row.usedIn.length)} üründe kullanılıyor. Silmeden önce reçetelerden çıkarın ya da düzenleyip pasif yapın.
            </span>
            Bu işlem geri alınamaz.
          </>
        ) : (
          "Hiçbir reçetede kullanılmıyor. Bu işlem geri alınamaz."
        )
      }
    />
  );
}

function IngredientDialog({
  row,
  onClose,
  onDelete,
  categories,
}: {
  row: IngredientRow | null;
  onClose: () => void;
  onDelete?: () => void;
  categories: string[];
}) {
  const formId = useId();
  const [f, setF] = useState({
    name: row?.name ?? "",
    category: row?.category ?? "Diğer",
    supplier: row?.supplier ?? "",
    packageDesc: row?.packageDesc ?? "",
    packagePrice: num(row?.packagePrice ?? 0, 2),
    packageSize: num(row?.packageSize ?? 1000, 3),
    unit: row?.unit ?? "gr",
    vatRate: num((row?.vatRate ?? 0.01) * 100, 2),
    note: row?.note ?? "",
    isEstimate: row?.isEstimate ?? false,
    priceSource: row?.priceSource ?? "manual",
    countUnit: row?.countUnit ?? "",
    countGroup: row?.countGroup ?? "",
    active: row?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const price = parseNumberTR(f.packagePrice) ?? 0;
  const size = parseNumberTR(f.packageSize) ?? 0;
  const allCats = [...new Set([...INGREDIENT_CATEGORIES, ...categories])];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveIngredient({
      id: row?.id ?? null,
      name: f.name,
      category: f.category,
      supplier: f.supplier,
      packageDesc: f.packageDesc,
      packagePrice: price,
      packageSize: size,
      unit: f.unit as "gr",
      vatRate: (parseNumberTR(f.vatRate) ?? 0) / 100,
      note: f.note,
      isEstimate: f.isEstimate,
      priceSource: f.priceSource as "manual",
      countUnit: (f.countUnit || null) as "KG" | null,
      countGroup: f.countGroup || null,
      active: f.active,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(row ? "Malzeme güncellendi" : "Malzeme eklendi; artık reçetelerde seçilebilir");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size={row ? "xl" : "lg"}
      title={row ? row.name : "Yeni hammadde"}
      description={row ? `${row.category} · ${row.usedIn.length} üründe kullanılıyor` : "Eklediğiniz malzeme reçete kartlarındaki listede çıkar."}
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
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className={cn("grid gap-6 pb-3", row && "lg:grid-cols-2")}>
        <form id={formId} onSubmit={save} className="space-y-3">
          <Field label="Malzeme adı" htmlFor="i-name">
            <Input id="i-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kategori" htmlFor="i-cat">
              <Select id="i-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
                {allCats.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tedarikçi" htmlFor="i-sup">
              <Input id="i-sup" value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} />
            </Field>
          </div>
          <Field label="Paket açıklaması" htmlFor="i-pack" hint="ör. Espresso Blend 1 kg">
            <Input id="i-pack" value={f.packageDesc} onChange={(e) => set({ packageDesc: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Paket fiyatı (₺)" htmlFor="i-price" hint="KDV hariç">
              <NumberInput
                id="i-price"
                value={f.packagePrice}
                onChange={(e) => set({ packagePrice: e.target.value })}
                disabled={f.priceSource === "water"}
                className="cell-input"
              />
            </Field>
            <Field label="Paket içeriği" htmlFor="i-size">
              <NumberInput id="i-size" value={f.packageSize} onChange={(e) => set({ packageSize: e.target.value })} className="cell-input" />
            </Field>
            <Field label="Birim" htmlFor="i-unit">
              <Select id="i-unit" value={f.unit} onChange={(e) => set({ unit: e.target.value as "gr" })}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-panel px-3.5 py-2.5 text-sm text-ink-mute" aria-live="polite">
            <span>Birim maliyet</span>
            <span>
              <strong className="font-semibold text-ink tabular">{size ? tlUnit(price / size) : "–"}</strong> / {f.unit}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Alış KDV oranı (%)" htmlFor="i-vat" hint="Gıda %1, ambalaj %20">
              <NumberInput id="i-vat" value={f.vatRate} onChange={(e) => set({ vatRate: e.target.value })} />
            </Field>
            <Field label="Fiyat kaynağı" htmlFor="i-src">
              <Select id="i-src" value={f.priceSource} onChange={(e) => set({ priceSource: e.target.value as "manual" })}>
                <option value="manual">Fatura / elle</option>
                <option value="water">Su faturasından (su, buz)</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sayım birimi" htmlFor="i-cu" hint="Boş = sayım listesinde yok">
              <Select id="i-cu" value={f.countUnit} onChange={(e) => set({ countUnit: e.target.value })}>
                <option value="">Sayılmaz</option>
                {COUNT_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="Sayım grubu" htmlFor="i-cg">
              <Select id="i-cg" value={f.countGroup} onChange={(e) => set({ countGroup: e.target.value })}>
                <option value="">—</option>
                {COUNT_GROUPS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Kaynak / not" htmlFor="i-note">
            <Textarea id="i-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={3} />
          </Field>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Checkbox label="Tahmini fiyat (faturada yok)" className="min-h-9" checked={f.isEstimate} onChange={(e) => set({ isEstimate: e.target.checked })} />
            <Checkbox label="Aktif" className="min-h-9" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          </div>
        </form>
        {row ? (
          <div className="space-y-4">
            {row.history.length ? (
              // Beyaz pencerede kuyu gri zeminle ayrılır
              <Well className="bg-panel">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">Birim maliyet geçmişi</p>
                  <p className="text-xs text-ink-mute tabular">{num(row.history.length)} değişiklik</p>
                </div>
                <PriceLine data={row.history.map((h) => ({ label: dateTR(h.at.slice(0, 10)), value: h.size ? h.price / h.size : 0 }))} />
                <ul className="mt-3 max-h-36 divide-y divide-line overflow-y-auto rounded-xl bg-surface px-3 text-xs text-ink-soft scroll-thin">
                  {[...row.history].reverse().map((h, i) => (
                    <li key={i} className="flex justify-between gap-2 py-1.5">
                      <span>
                        {dateTR(h.at.slice(0, 10))} · {h.by ?? "–"}
                      </span>
                      <span className="tabular">
                        {tl(h.price, 2)} / {num(h.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Well>
            ) : null}
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Kullanıldığı ürünler ({row.usedIn.length})</p>
              {row.usedIn.length ? (
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto scroll-thin">
                  {row.usedIn.map((u) => (
                    <Link
                      key={u.id}
                      href={`/panel/urunler/${u.id}`}
                      className="inline-flex min-h-8 items-center rounded-full bg-panel px-3 text-xs font-medium text-ink-soft transition-colors hover:bg-panel-deep hover:text-ink pointer-coarse:min-h-9"
                    >
                      {u.label}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-mute">Hiçbir reçetede yok.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
