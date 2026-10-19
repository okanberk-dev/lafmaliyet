"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Download,
  Eye,
  Package,
  Pencil,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { RefreshIcon } from "@/components/akmanos/charts/area-chart/icons";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { Icon } from "@/components/akmanos/icons/icon";
import { MetricIconBox } from "@/components/akmanos/icons/metric-icon-box";
import {
  BulkSelectionBar,
  IconActionButton,
  ListSkeletonBar,
  ListSortableHeader,
  ListTableEmptyState,
  ListTableErrorState,
  ListTablePagination,
  LIST_TABLE_FADE_MS,
  LIST_TABLE_LOAD_MS,
  LIST_TABLE_PAGE_SIZE,
  nextListSort,
  wait,
} from "@/components/akmanos/list-table";
import {
  COLUMNS,
  DEFAULT_SORT,
  ROW_NUMBER_LABEL,
  type ProductColumnKey,
  type ProductSort,
  type ProductStatus,
} from "./constants";
import {
  downloadProductsCsv,
  formatListCount,
  formatPrice,
  generateProducts,
  getActiveProductCount,
  getPageCount,
  getStatusLabel,
  paginateRows,
  sortProducts,
  type ProductRow,
} from "./data";

const THUMB_TONES = [
  "from-emerald-500/20 to-emerald-500/5",
  "from-sky-500/20 to-sky-500/5",
  "from-violet-500/20 to-violet-500/5",
  "from-amber-500/20 to-amber-500/5",
  "from-rose-500/20 to-rose-500/5",
] as const;

function thumbTone(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash + seed.charCodeAt(index)) % THUMB_TONES.length;
  }
  return THUMB_TONES[hash];
}

function ProductThumb({ product }: { product: ProductRow }) {
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${thumbTone(product.id)}`}
      aria-hidden="true"
    >
      <Icon icon={Package} size={16} className="text-chart-muted" />
    </span>
  );
}

function StatusBadge({ status }: { status: ProductStatus }) {
  const archived = status === "archived";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        archived
          ? "bg-chart-metric-bg text-chart-muted"
          : "bg-[#c0f21e]/25 text-[#1f3a08] dark:bg-[#a3d018]/20 dark:text-[#c0f21e]"
      }`}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="size-4 shrink-0 rounded border-border accent-foreground disabled:opacity-40"
    />
  );
}

function ProductRowView({
  product,
  rowNumber,
  banded,
  selected,
  onToggleSelect,
  onView,
  onEdit,
  onDelete,
  onArchive,
  onActivate,
  disabled,
}: {
  product: ProductRow;
  rowNumber: number;
  banded: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onActivate: () => void;
  disabled?: boolean;
}) {
  const archived = product.status === "archived";

  return (
    <tr
      className={`border-b border-border/70 transition-colors ${
        banded ? "bg-chart-bg/50" : ""
      } ${archived ? "opacity-70" : ""}`}
    >
      <td className="w-10 min-w-10 py-3 pl-1 pr-2">
        <SelectCheckbox
          checked={selected}
          onChange={onToggleSelect}
          label={`Select ${product.name}`}
          disabled={disabled}
        />
      </td>
      <td className="w-11 min-w-11 py-3 pr-4 font-mono text-sm tabular-nums text-chart-muted">
        {rowNumber}
      </td>
      <td className="py-3 pr-4">
        <div className="flex min-w-[11rem] items-center gap-2.5">
          <ProductThumb product={product} />
          <p className="truncate font-medium text-foreground">{product.name}</p>
        </div>
      </td>
      <td className="py-3 pr-4 font-mono text-sm tabular-nums text-foreground">
        {product.sku}
      </td>
      <td className="py-3 pr-4 text-foreground">{product.category}</td>
      <td className="py-3 pr-4 font-mono text-sm tabular-nums text-foreground">
        {formatPrice(product.price)}
      </td>
      <td className="py-3 pr-4 font-mono text-sm tabular-nums text-foreground">
        {product.stock}
      </td>
      <td className="py-3 pr-4">
        <StatusBadge status={product.status} />
      </td>
      <td className="py-3 pr-1">
        <div className="flex items-center gap-1">
          <IconActionButton
            icon={Eye}
            label="View product"
            onClick={onView}
            disabled={disabled}
          />
          <IconActionButton
            icon={Pencil}
            label="Edit product"
            onClick={onEdit}
            disabled={disabled}
          />
          <IconActionButton
            icon={Trash2}
            label="Delete product"
            onClick={onDelete}
            tone="danger"
            disabled={disabled}
          />
          {archived ? (
            <IconActionButton
              icon={PlayCircle}
              label="Activate product"
              onClick={onActivate}
              disabled={disabled}
            />
          ) : (
            <IconActionButton
              icon={Archive}
              label="Archive product"
              onClick={onArchive}
              disabled={disabled}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

function SkeletonRow({ rowNumber, banded }: { rowNumber: number; banded: boolean }) {
  return (
    <tr className={`border-b border-border/70 ${banded ? "bg-chart-bg/50" : ""}`}>
      <td className="w-10 min-w-10 py-3 pl-1 pr-2">
        <ListSkeletonBar className="size-4 rounded" />
      </td>
      <td className="w-11 min-w-11 py-3 pr-4 font-mono text-sm tabular-nums text-chart-muted">
        {rowNumber}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2.5">
          <ListSkeletonBar className="size-9 rounded-xl" />
          <ListSkeletonBar className="h-4 w-32" />
        </div>
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-4 w-24" />
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-4 w-20" />
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-4 w-16" />
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-4 w-10" />
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-5 w-16 rounded-full" />
      </td>
      <td className="py-3 pr-1">
        <ListSkeletonBar className="h-8 w-40" />
      </td>
    </tr>
  );
}

export function ProductListTable() {
  const [seed, setSeed] = useState(0);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ProductSort>(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [tableVisible, setTableVisible] = useState(true);
  const loadIdRef = useRef(0);
  const tableTransitionRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortedProducts = useMemo(
    () => sortProducts(products, sort),
    [products, sort],
  );
  const activeCount = useMemo(
    () => getActiveProductCount(products),
    [products],
  );
  const pageCount = getPageCount(sortedProducts.length, LIST_TABLE_PAGE_SIZE);
  const pageProducts = useMemo(
    () => paginateRows(sortedProducts, page, LIST_TABLE_PAGE_SIZE),
    [sortedProducts, page],
  );
  const pageIds = useMemo(
    () => pageProducts.map((product) => product.id),
    [pageProducts],
  );
  const selectedCount = selectedIds.size;
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected =
    pageIds.some((id) => selectedIds.has(id)) && !allPageSelected;

  const showTable = !loading && !error && sortedProducts.length > 0;
  const showEmpty = !loading && !error && sortedProducts.length === 0;
  const showError = !loading && error !== null;
  const tableBusy = loading || !tableVisible;

  function updateProductStatus(ids: string[], status: ProductStatus) {
    const idSet = new Set(ids);
    setProducts((current) =>
      current.map((product) =>
        idSet.has(product.id) ? { ...product, status } : product,
      ),
    );
  }

  function deleteProducts(ids: string[]) {
    const idSet = new Set(ids);
    setProducts((current) => current.filter((product) => !idSet.has(product.id)));
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runTableTransition(action: () => void) {
    if (loading || tableTransitionRef.current) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion || !tableVisible) {
      action();
      return;
    }

    tableTransitionRef.current = true;
    setTableVisible(false);
    await wait(LIST_TABLE_FADE_MS);
    action();
    requestAnimationFrame(() => {
      setTableVisible(true);
      tableTransitionRef.current = false;
    });
  }

  async function loadProducts(nextSeed: number, withFadeOut: boolean) {
    const loadId = ++loadIdRef.current;

    if (withFadeOut && visible) {
      setVisible(false);
      await wait(LIST_TABLE_FADE_MS);
      if (loadId !== loadIdRef.current) return;
    }

    setLoading(true);
    setError(null);
    setVisible(true);
    await wait(LIST_TABLE_LOAD_MS);
    if (loadId !== loadIdRef.current) return;

    setVisible(false);
    await wait(LIST_TABLE_FADE_MS);
    if (loadId !== loadIdRef.current) return;

    try {
      const nextProducts = generateProducts(nextSeed);
      setProducts(nextProducts);
      setPage(1);
      setSort(DEFAULT_SORT);
      setSelectedIds(new Set());
      setError(null);
      setLoading(false);
      setTableVisible(true);
      requestAnimationFrame(() => {
        if (loadId !== loadIdRef.current) return;
        setVisible(true);
        scrollRef.current?.scrollTo({ top: 0, left: 0 });
      });
    } catch (loadError) {
      setProducts([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load products",
      );
      setLoading(false);
      setTableVisible(true);
      requestAnimationFrame(() => {
        if (loadId !== loadIdRef.current) return;
        setVisible(true);
      });
    }
  }

  useEffect(() => {
    void loadProducts(0, false);
    // Initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRefresh() {
    if (loading) return;
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    void loadProducts(nextSeed, true);
  }

  function handlePageChange(nextPage: number) {
    if (tableBusy || nextPage === page) return;
    void runTableTransition(() => {
      setPage(nextPage);
      scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function handleSort(key: ProductColumnKey) {
    if (tableBusy) return;
    void runTableTransition(() => {
      setSort((current) => nextListSort(current, key));
      setPage(1);
      scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function handleExportCsv() {
    if (loading || sortedProducts.length === 0) return;
    downloadProductsCsv(sortedProducts);
  }

  function handleRetry() {
    if (loading) return;
    void loadProducts(seed, true);
  }

  const bulkActions = [
    {
      id: "bulk-archive",
      label: "Archive",
      onClick: () => updateProductStatus([...selectedIds], "archived"),
    },
    {
      id: "bulk-activate",
      label: "Activate",
      onClick: () => updateProductStatus([...selectedIds], "active"),
    },
    {
      id: "bulk-delete",
      label: "Delete",
      tone: "danger" as const,
      onClick: () => deleteProducts([...selectedIds]),
    },
  ];

  const tableHead = (
    <thead className="sticky top-0 z-10 bg-chart-card-bg">
      <tr className="border-b border-border">
        <th className="w-10 min-w-10 pb-3 pl-1 pr-2">
          {showTable ? (
            <SelectCheckbox
              checked={allPageSelected}
              indeterminate={somePageSelected}
              onChange={togglePageSelection}
              label="Select all on page"
              disabled={tableBusy}
            />
          ) : (
            <span className="sr-only">Select</span>
          )}
        </th>
        <th className="w-11 min-w-11 pb-3 pr-4 text-sm font-medium text-chart-muted">
          {ROW_NUMBER_LABEL}
        </th>
        {COLUMNS.map((column) => (
          <ListSortableHeader
            key={column.key}
            columnKey={column.key}
            label={column.label}
            sort={sort}
            onSort={handleSort}
            disabled={tableBusy || loading}
          />
        ))}
        <th className="pb-3 pr-1 text-sm font-medium text-chart-muted">Actions</th>
      </tr>
    </thead>
  );

  return (
    <div
      className="w-full rounded-3xl bg-chart-card-bg p-4 sm:p-5"
      data-component="product-list-table"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <MetricIconBox icon={Package} />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Product list</h2>
            <p className="text-sm text-chart-muted">Catalog inventory and status</p>
            <div
              className="mt-1 flex min-h-5 items-center gap-2"
              aria-live="polite"
              aria-label={`Active products ${formatListCount(activeCount)}`}
            >
              <span className="text-sm text-chart-muted">Active</span>
              <span className="text-sm text-chart-muted">·</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {loading ? (
                  "…"
                ) : (
                  <AnimatedNumber value={activeCount} format={formatListCount} />
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <p className="text-sm text-chart-muted tabular-nums">
            {loading
              ? "…"
              : error
                ? "0 products"
                : `${products.length} products`}
          </p>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || sortedProducts.length === 0}
            className="flex h-9 min-h-9 items-center gap-1.5 rounded-xl bg-chart-metric-bg px-3 text-sm font-medium text-chart-muted transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label="Export CSV"
          >
            <Icon icon={Download} size="sm" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="flex h-9 min-h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chart-metric-bg text-chart-muted transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label="Refresh products"
          >
            <RefreshIcon
              className={loading ? "animate-spin text-chart-muted" : undefined}
            />
          </button>
        </div>
      </div>

      <div
        className={`transition-opacity duration-200 ease-out ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {loading ? (
          <div
            ref={scrollRef}
            className="traffic-table-scroll h-[320px] overflow-auto overscroll-contain px-3 sm:px-4"
          >
            <table className="w-full min-w-[54rem] text-left text-sm">
              {tableHead}
              <tbody aria-busy={true}>
                {Array.from({ length: LIST_TABLE_PAGE_SIZE }, (_, index) => (
                  <SkeletonRow
                    key={`skeleton-${index}`}
                    rowNumber={index + 1}
                    banded={index % 2 === 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {showError ? (
          <ListTableErrorState message={error ?? ""} onRetry={handleRetry} />
        ) : null}

        {showEmpty ? (
          <ListTableEmptyState
            title="No products found"
            description="Products will appear here once items are added to the catalog."
            onRefresh={handleRefresh}
          />
        ) : null}

        {showTable ? (
          <div
            ref={scrollRef}
            className="traffic-table-scroll h-[320px] overflow-auto overscroll-contain px-3 sm:px-4"
          >
            <table className="w-full min-w-[54rem] text-left text-sm">
              {tableHead}
              <tbody
                className={`transition-opacity duration-200 ease-out ${
                  tableVisible ? "opacity-100" : "opacity-0"
                }`}
              >
                {pageProducts.map((product, index) => (
                  <ProductRowView
                    key={product.id}
                    product={product}
                    rowNumber={(page - 1) * LIST_TABLE_PAGE_SIZE + index + 1}
                    banded={index % 2 === 1}
                    selected={selectedIds.has(product.id)}
                    onToggleSelect={() => toggleSelect(product.id)}
                    onView={() => undefined}
                    onEdit={() => undefined}
                    onDelete={() => deleteProducts([product.id])}
                    onArchive={() => updateProductStatus([product.id], "archived")}
                    onActivate={() => updateProductStatus([product.id], "active")}
                    disabled={tableBusy}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {showTable ? (
        <div
          className={`mt-4 border-t border-border pt-4 transition-opacity duration-200 ease-out ${
            tableVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <ListTablePagination
            page={page}
            pageCount={pageCount}
            onPageChange={handlePageChange}
            disabled={tableBusy}
          />
        </div>
      ) : null}

      <BulkSelectionBar
        selectedCount={selectedCount}
        actions={bulkActions}
        onClear={clearSelection}
      />
    </div>
  );
}
