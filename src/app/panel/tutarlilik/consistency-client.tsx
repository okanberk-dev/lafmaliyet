"use client";

import { Info, ListChecks, Pencil, Plus, Scale, SearchX, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { startTransition, useOptimistic, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTR, monthLabel as monthLabelOf, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteFinding, saveFinding, setFindingResolved, setPurchaseQty } from "@/server/actions/consistency";


import { RATIO_BAD, RATIO_GUIDE, RATIO_WARN, scopeTotals, SEVERITY, severityOf, tableScope, type StockCheck } from "./severity";

interface Row {
  ingredientId: number;
  name: string;
  unit: string;
  unitCost: number;
  usage: number;
  purchased: number | null;
  ratio: number | null;
  diffAmount: number | null;
  opening: number | null;
  closing: number | null;
  actualUsage: number | null;
  variance: number | null;
  varianceAmount: number | null;
  /** Devir − devreden (iki sayım varsa), alım bilinmeden stoktaki düşüş */
  stockDrop: number | null;
  /** complete: sapma hesaplandı · needsPurchase: iki sayım var, alım eksik · noCount: sayım eksik */
  stock: StockCheck;
  /** Hammadde bir reçetede var mı */
  inRecipe: boolean;
  note: string | null;
}

/** Reçetede olmayan ama stoktan düşen (ya da alınıp tükenen) hammadde */
const isUnreciped = (r: Row) => !r.inRecipe && r.stockDrop !== null && r.stockDrop + (r.purchased ?? 0) > 0;

type IngredientOption = { id: number; name: string; unit: string };
type SevFilter = "all" | "fark" | "buyuk";

// ---------------------------------------------------------------- Sayaçlar ve şeritler (sunucu sayfası da kullanır)

/**
 * AkmanOS AnimatedNumber ile sayan rakam: açılışta ve ay değişince yumuşakça sayılır.
 * Ekran okuyucu yalnızca son değeri duyar; hareket azaltıldığında sayaç doğrudan son değeri yazar.
 */
export function CountUp({ value, kind = "num" }: { value: number; kind?: "num" | "tl" }) {
  const format = kind === "tl" ? (v: number) => tl(v) : (v: number) => num(v);
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={format} />
      </span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

/**
 * AkmanOS agent-limits-card'ın bölümlü paylaşım şeridi: alımı girilen malzemelerin
 * büyük fark / fark var / tutarlı dağılımı. Parçalar açılışta sırayla, yaylı hareketle dolar.
 */
export function SeverityBar({ big, diff, ok }: { big: number; diff: number; ok: number }) {
  const reduce = useCalmMotion();
  const total = big + diff + ok;
  if (!total) return null;
  const parts = [
    { key: "big" as const, n: big },
    { key: "diff" as const, n: diff },
    { key: "ok" as const, n: ok },
  ].filter((p) => p.n > 0);
  const summary = parts.map((p) => `${SEVERITY[p.key].label} ${num(p.n)}`).join(", ");
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={summary} className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface">
        {parts.map((p, i) => (
          <motion.div
            key={p.key}
            className={cn("h-full min-w-0 rounded-full", SEVERITY[p.key].bar)}
            initial={reduce ? false : { width: 0, opacity: 0.6 }}
            animate={{ width: `${(p.n / total) * 100}%`, opacity: 1 }}
            transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.12 + i * 0.05 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] leading-4 text-ink-mute" aria-hidden="true">
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", SEVERITY[p.key].bar)} />
            {SEVERITY[p.key].label} <span className="font-medium text-ink tabular">{num(p.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** AkmanOS todo-list sayacı: rakam değişince eskisi yukarı, yenisi aşağıdan kayar */
function CountRoll({ value }: { value: number }) {
  const reduce = useCalmMotion() ?? false;
  const text = num(value);
  return (
    <span className="relative inline-flex h-[1.15em] overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={reduce ? false : { y: "70%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reduce ? undefined : { y: "-70%", opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT }}
          className="inline-block tabular"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// ---------------------------------------------------------------- Reçete ↔ fatura tablosu

function RatioBadge({ row }: { row: Row }) {
  if (row.ratio === null) {
    // Ay içinde hiç kullanılmadığı hâlde alım varsa oran hesaplanamaz ama fark büyüktür
    return severityOf(row) === "big" ? (
      <Badge tone={SEVERITY.big.tone} dot title={SEVERITY.big.label}>
        Kullanım yok
      </Badge>
    ) : (
      <span className="text-ink-mute">–</span>
    );
  }
  const s = SEVERITY[row.ratio > RATIO_BAD ? "big" : row.ratio >= RATIO_WARN ? "diff" : "ok"];
  // 1×'in altı da tutarlıdır: alınandan fazlası önceki ayın stoğundan harcandı
  const title = row.ratio < 1 ? `${s.label} · ${RATIO_GUIDE.below1}` : s.label;
  return (
    <Badge tone={s.tone} dot className="tabular" title={title}>
      {num(row.ratio, 2)}×<span className="sr-only">, {title}</span>
    </Badge>
  );
}

/** Gerçek tüketim hücresi: hesaplandıysa değer, iki sayım var ama alım eksikse ne yapılacağı */
function ActualUsage({ row, compact }: { row: Row; compact?: boolean }) {
  if (row.stock === "needsPurchase")
    return (
      <span className={cn("inline-flex flex-col gap-0.5", compact ? "items-start" : "items-end")}>
        <Badge tone="amber" dot title="İki ayın sayımı var; gerçek tüketim için bu ayın alım miktarı gerekli">
          Alım girilmeli
        </Badge>
        <span className="text-xs text-ink-mute">alınmadıysa 0 yazın</span>
      </span>
    );
  return <>{row.actualUsage === null ? "–" : `${num(row.actualUsage)} ${row.unit}`}</>;
}

function UnrecipedBadge({ row }: { row: Row }) {
  if (!isUnreciped(row)) return null;
  return (
    <Badge tone="violet" title="Hiçbir reçetede yok ama stoktan düştü: satışa yansımayan tüketim (ikram, personel, fire ya da eksik reçete)">
      Reçetesiz tüketim
    </Badge>
  );
}

/** Satır içi alınan miktar: Enter ya da odaktan çıkınca kaydeder, Esc geri alır; silmeden önce sorar */
function PurchaseCell({ month, row, className, id }: { month: string; row: Row; className?: string; id?: string }) {
  const saved = row.purchased === null ? "" : num(row.purchased, 2);
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const invalid = value.trim() !== "" && (parseNumberTR(value) === null || (parseNumberTR(value) ?? 0) < 0);

  async function write(v: number | null) {
    setBusy(true);
    const res = await setPurchaseQty(month, row.ingredientId, v);
    setBusy(false);
    if (!res.ok) {
      setValue(saved);
      return toast.error(res.error);
    }
    if (v === null) {
      const prev = { qty: row.purchased, note: row.note };
      toast.success(`${row.name}: alım silindi`, {
        action: prev.qty === null ? undefined : { label: "Geri al", onClick: () => void setPurchaseQty(month, row.ingredientId, prev.qty, prev.note) },
      });
    } else toast.success(`${row.name}: ${num(v, 2)} ${row.unit} kaydedildi`);
  }

  return (
    <>
      <NumberInput
        id={id}
        value={value}
        disabled={busy}
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          const t = value.trim();
          const v = t === "" ? null : parseNumberTR(t);
          if (t !== "" && (v === null || v < 0)) {
            toast.error(`${row.name}: geçerli bir miktar girin`, { description: "Yalnızca sayı; ondalık için virgül (ör. 2,5)." });
            return setValue(saved);
          }
          if (v === row.purchased) return;
          // Boşaltmak satırı (ve yorumunu) siler: önce sorulur
          if (v === null) return setConfirmClear(true);
          void write(v);
        }}
        onKeyDown={(e) => {
          // preventDefault: boşaltılınca açılan onay penceresi aynı Enter'la ("Kapat"a basılmış gibi) hemen kapanmasın
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setValue(saved);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        placeholder="—"
        aria-label={`${row.name} alınan miktar (${row.unit})`}
        aria-invalid={invalid || undefined}
        className={cn("cell-input w-24", className)}
      />
      {/* Pencere gövdeye çizilir: tablo hücresinin sağa yaslama ve satır kaydırmama ayarları içine geçmesin */}
      {confirmClear
        ? createPortal(
            <ConfirmDialog
              open
              onClose={() => {
                setConfirmClear(false);
                setValue(saved);
              }}
              onConfirm={() => {
                setConfirmClear(false);
                void write(null);
              }}
              title={`${row.name}: alım silinsin mi?`}
              description={`Bu ay girilen ${saved} ${row.unit}${row.note ? " ve yorumu" : ""} silinir; malzeme "alımı girilmemiş" sayılır.`}
              confirmLabel="Alımı sil"
            />,
            document.body,
          )
        : null}
    </>
  );
}

type SortKey = "ad" | "oran" | "fark" | "sapma";
type SortDir = "asc" | "desc";
/** Boş (null) değerler yöne bakılmaksızın sona */
const SORT_VALUE: Record<Exclude<SortKey, "ad">, (r: Row) => number | null> = {
  // Kullanım yokken alım varsa oran sonsuz büyük sayılır (en kötü)
  oran: (r) => r.ratio ?? (severityOf(r) === "big" ? Number.POSITIVE_INFINITY : null),
  fark: (r) => r.diffAmount,
  sapma: (r) => r.varianceAmount,
};
const SORT_LABEL: Record<SortKey, string> = { ad: "Ada göre", oran: "Orana göre", fark: "Fark tutarına göre", sapma: "Sapmaya göre" };
/** Adresteki süzgeç anahtarları; "Temizle" bunları sıfırlar (sıralama kalır) */
const TABLE_KEYS = ["ara", "fark", "tum", "eksik"];

function parseSort(v: string): { key: SortKey; dir: SortDir } | null {
  const [k, d] = v.split("-");
  if (!["ad", "oran", "fark", "sapma"].includes(k)) return null;
  return { key: k as SortKey, dir: d === "asc" ? "asc" : "desc" };
}

function sortRows(rows: Row[], sort: { key: SortKey; dir: SortDir } | null): Row[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  if (sort.key === "ad") return [...rows].sort((a, b) => sign * a.name.localeCompare(b.name, "tr"));
  const get = SORT_VALUE[sort.key];
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
}

export function ConsistencyTable({
  month,
  monthLabel,
  rows,
  totalDiff,
  totalVariance,
  hasStock,
  hasComparison,
  ingredients,
  fire,
}: {
  month: string;
  monthLabel: string;
  rows: Row[];
  totalDiff: number;
  totalVariance: number;
  /** En az bir malzemenin iki ayı da sayıldı: sayım sütunları çıkar */
  hasStock: boolean;
  /** En az bir satırda sapma hesaplandı (iki sayım + alım) */
  hasComparison: boolean;
  ingredients: IngredientOption[];
  fire: number;
}) {
  /** null = kapalı, "new" = yeni alım, Row = satırdaki alımı düzenle */
  const [dialog, setDialog] = useState<Row | "new" | null>(null);
  const [allParam, setAllParam] = useQueryState<string>("tum", "0");
  const [needParam, setNeedParam] = useQueryState<string>("eksik", "0");
  const [sevParam, setSev] = useQueryState<SevFilter>("fark", "all");
  const [sortParam, setSortParam] = useQueryState<string>("sirala", "");
  const [q, setQ] = useQueryText("ara");
  const sev: SevFilter = sevParam === "fark" || sevParam === "buyuk" ? sevParam : "all";
  const showAll = allParam === "1";
  const sort = parseSort(sortParam);
  const withPurchase = rows.filter((r) => r.purchased !== null);
  const needsPurchase = rows.filter((r) => r.stock === "needsPurchase");
  const onlyNeeds = needParam === "1" && needsPurchase.length > 0;
  // Varsayılan: alımı girilen ya da iki ayı sayılan malzemeler; "Alımı girilmeyenler" yalnızca reçete kullanımı olanları da açar
  const { scope: baseScope, hidden: missing } = tableScope(rows, showAll);
  const scope = onlyNeeds ? needsPurchase : baseScope;
  const base = scope.filter((r) => matches(r.name, q));
  const isDiff = (r: Row) => {
    const s = severityOf(r);
    return s === "diff" || s === "big";
  };
  const isBig = (r: Row) => severityOf(r) === "big";
  const visible = sortRows(sev === "all" ? base : base.filter(sev === "buyuk" ? isBig : isDiff), sort);
  const paged = usePaged(visible, 25, `${sev}|${showAll}|${onlyNeeds}|${q}|${sortParam}`);
  const filtered = sev !== "all" || q.trim() !== "" || showAll || onlyNeeds;
  const visibleTotals = scopeTotals(visible);
  const visibleDiff = visibleTotals.diff;

  const clear = () => {
    setQ("");
    clearQuery(TABLE_KEYS);
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);
  // İlk tıklama: ad A→Z, rakamlar büyükten küçüğe; ikinci tıklama yönü çevirir
  const toggleSort = (key: SortKey) => {
    const first: SortDir = key === "ad" ? "asc" : "desc";
    const dir = sort?.key === key ? (sort.dir === "asc" ? "desc" : "asc") : first;
    setSortParam(`${key}-${dir}`);
  };
  const sortOptions: SortKey[] = hasStock ? ["fark", "oran", "sapma", "ad"] : ["fark", "oran", "ad"];
  // Tablo ancak tüm sütunları sığınca çıkar (sayım sütunlarıyla daha geniş); daha dar ekranda kartlar, düzenle düğmesi
  // yana kayıp gizlenmez. Sınıflar tam yazılır ki Tailwind üretsin.
  const cardsOnly = hasStock ? "2xl:hidden" : "xl:hidden";
  const tableOnly = hasStock ? "max-2xl:hidden" : "max-xl:hidden";

  return (
    <Card>
      <CardHeader
        icon={<Scale />}
        title={`Reçete ↔ fatura: ${monthLabel}`}
        description="Satılanlara göre harcanması gereken malzeme (fire hariç) ile ay içinde faturayla alınan. Alınan miktarı tıklayıp yazabilirsiniz."
        meta={
          <>
            <span>Malzeme · {num(rows.length)}</span>
            <span aria-hidden="true">·</span>
            <span>Alım girilen · {num(withPurchase.length)}</span>
          </>
        }
        actions={
          <Button onClick={() => setDialog("new")}>
            <Plus size={16} /> Alım ekle
          </Button>
        }
      />

      {rows.length ? (
        <>
          <FilterBar active={filtered} onClear={clear} shown={visible.length} total={rows.length} unit="malzeme" className="px-5 pb-3">
            <SearchField className="max-sm:basis-full sm:flex-1 sm:basis-56" value={q} onChange={setQ} placeholder="Malzeme ara" label="Malzeme ara" />
            <Segmented<SevFilter>
              label="Fark süzgeci"
              value={sev}
              onChange={setSev}
              options={[
                { value: "all", label: "Tümü", count: base.length },
                { value: "fark", label: SEVERITY.diff.label, count: base.filter(isDiff).length },
                { value: "buyuk", label: SEVERITY.big.label, count: base.filter(isBig).length },
              ]}
            />
            {needsPurchase.length ? (
              <FilterChip active={onlyNeeds} onToggle={() => setNeedParam(onlyNeeds ? "0" : "1")} count={needsPurchase.length}>
                Alım girilmeli
              </FilterChip>
            ) : null}
            {missing && missing < rows.length && !onlyNeeds ? (
              <FilterChip active={showAll} onToggle={() => setAllParam(showAll ? "0" : "1")} count={missing}>
                Alımı girilmeyenler
              </FilterChip>
            ) : null}
            {/* Kart görünümünde tablo başlığı yok: sıralama seçimle */}
            <Select
              value={sort ? `${sort.key}-${sort.dir}` : ""}
              onChange={(e) => setSortParam(e.target.value)}
              aria-label="Sırala"
              className={cn("w-auto", cardsOnly)}
            >
              <option value="">Önem sırası</option>
              {sortOptions.map((k) => (
                <option key={k} value={`${k}-${k === "ad" ? "asc" : "desc"}`}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </Select>
          </FilterBar>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pb-3 text-xs text-ink-mute" aria-label="Oran renkleri">
            {(["ok", "diff", "big"] as const).map((k) => (
              <li key={k} className="inline-flex items-center gap-1.5">
                <Badge tone={SEVERITY[k].tone} dot>
                  {SEVERITY[k].range}
                </Badge>
                <span>
                  {SEVERITY[k].hint}
                  {k === "ok" ? " (1×'in altı: önceki ay stoğundan kullanıldı)" : ""}
                  {k === "diff" ? ` (genel fire payı %${num(fire * 100, 0)})` : ""}
                </span>
              </li>
            ))}
            <li className="inline-flex">
              <InfoTip
                text={
                  <>
                    {RATIO_GUIDE.below1} {RATIO_GUIDE.bottles}
                    <span className="mt-1.5 block font-medium">{RATIO_GUIDE.fastMovers}</span>
                  </>
                }
              />
            </li>
          </ul>
        </>
      ) : null}

      {/* Sayfa değişince buraya kaydırılır (Pagination): yeni sayfanın ilk malzemesi üst çubuğun hemen altında */}
      <div data-page-top>
        {visible.length ? (
          <>
            {/*
              Telefon ve tablet: her malzeme sıkı bir kart (tablo yana kaymadan okunur), genişledikçe iki sütun. Ad ve oran
              üstte, rakamlar iki kısa satırda, altta büyük "alınan" kutusu ve düzenle düğmesi (44 px).
            */}
            <ul className={cn("grid gap-2 px-3 pb-3 md:grid-cols-2", cardsOnly)}>
              {paged.slice.map((r) => (
                <li key={r.ingredientId} className="rounded-2xl bg-surface px-3 pt-2.5 pb-3 ring-1 ring-line sm:p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-5 font-semibold break-words text-ink">{r.name}</p>
                      {isUnreciped(r) ? (
                        <span className="mt-0.5 block">
                          <UnrecipedBadge row={r} />
                        </span>
                      ) : null}
                    </div>
                    <span className="shrink-0">
                      <RatioBadge row={r} />
                    </span>
                  </div>
                  {/* Etiket ve değer aynı satırda: kart kısa kalır, sayfada daha çok malzeme görünür */}
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[13px] leading-5">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                      <dt className="text-xs text-ink-mute">Reçeteye göre</dt>
                      <dd className="text-ink tabular">
                        {num(r.usage)} {r.unit}
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 text-right">
                      <dt className="text-xs text-ink-mute">Fark</dt>
                      <dd className={cn("tabular", r.diffAmount !== null && r.diffAmount < 0 && "text-info", r.diffAmount !== null && r.diffAmount > 2000 && "font-semibold text-bad")}>
                        {r.diffAmount === null ? "–" : tl(r.diffAmount)}
                      </dd>
                    </div>
                    {hasStock ? (
                      <>
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                          <dt className="text-xs text-ink-mute">Gerçek tüketim</dt>
                          <dd className="text-ink tabular">
                            <ActualUsage row={r} compact />
                          </dd>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 text-right">
                          <dt className="text-xs text-ink-mute">Sapma</dt>
                          <dd className={cn("tabular", r.varianceAmount !== null && r.varianceAmount > 0 && "font-semibold text-bad")}>
                            {r.varianceAmount === null ? "–" : tl(r.varianceAmount)}
                          </dd>
                        </div>
                        {r.opening !== null && r.closing !== null ? (
                          <div className="col-span-2">
                            <dt className="sr-only">Sayım</dt>
                            <dd className="text-xs text-ink-mute tabular">
                              Sayım {num(r.opening)} → {num(r.closing)} {r.unit}
                            </dd>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </dl>
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor={`purchase-${r.ingredientId}`} className="shrink-0 text-xs text-ink-mute">
                      Alınan
                    </label>
                    <PurchaseCell
                      key={`${r.ingredientId}:${r.purchased ?? ""}`}
                      id={`purchase-${r.ingredientId}`}
                      month={month}
                      row={r}
                      className="h-11 w-auto min-w-0 flex-1"
                    />
                    <span className="w-9 shrink-0 text-xs text-ink-mute">{r.unit}</span>
                    <IconButton label={`${r.name}: alımı ve yorumu düzenle`} onClick={() => setDialog(r)} className="size-11">
                      <Pencil size={16} />
                    </IconButton>
                  </div>
                  {r.note ? <p className="mt-1.5 line-clamp-2 text-xs leading-5 break-words text-ink-mute">{r.note}</p> : null}
                </li>
              ))}
            </ul>

            <TableWrap className={tableOnly}>
              <Table>
                <THead>
                  <tr>
                    <TH sticky>
                      <SortButton dir={dirOf("ad")} onClick={() => toggleSort("ad")}>
                        Malzeme
                      </SortButton>
                    </TH>
                    <TH numeric>
                      Reçeteye göre
                      <InfoTip
                        text="Reçeteye göre kullanım: her ürünün bu ayki satış adedi × reçetedeki miktar. Fire payı ve ödenmez siparişler hariç."
                        className="ml-1"
                      />
                    </TH>
                    <TH numeric>
                      Faturayla alınan
                      <InfoTip text="Bu ayki faturalardaki miktar (malzemenin kendi biriminde: gr, ml, adet). Tıklayıp yazın; Enter kaydeder, Esc geri alır." className="ml-1" />
                    </TH>
                    <TH numeric>
                      <SortButton numeric dir={dirOf("oran")} onClick={() => toggleSort("oran")}>
                        Oran
                      </SortButton>
                      <InfoTip text={`Alınan ÷ reçeteye göre kullanılan. 1× = alınan kadar harcandı; büyüdükçe reçeteye göre fazla alım var. ${RATIO_GUIDE.below1}`} className="ml-1" />
                    </TH>
                    <TH numeric>
                      <SortButton numeric dir={dirOf("fark")} onClick={() => toggleSort("fark")}>
                        Fark tutarı
                      </SortButton>
                      <InfoTip
                        text="(Alınan − kullanılan) × birim maliyet. Pozitif = reçeteye göre fazla alınan malın parası (stokta duruyor ya da fire/ikram oldu)."
                        className="ml-1"
                      />
                    </TH>
                    {hasStock ? (
                      <>
                        <TH numeric>
                          Gerçek tüketim
                          <InfoTip text="Geçen ay sayımı + alınan − bu ay sayımı. İki ayın sayımı ve bu ayın alım miktarı girildiyse hesaplanır; hiç alınmadıysa alıma 0 yazın." className="ml-1" />
                        </TH>
                        <TH numeric>
                          <SortButton numeric dir={dirOf("sapma")} onClick={() => toggleSort("sapma")}>
                            Sapma (₺)
                          </SortButton>
                          <InfoTip
                            text="(Gerçek tüketim − reçeteye göre kullanım) × birim maliyet. Pozitif = fire, ikram, porsiyon kaçağı; reçetede olmayan malzemede tüketimin tamamı."
                            className="ml-1"
                          />
                        </TH>
                      </>
                    ) : null}
                    <TH>Yorum / kaynak faturalar</TH>
                    <TH>
                      <span className="sr-only">Eylemler</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {paged.slice.map((r) => (
                    <TR key={r.ingredientId}>
                      <TD sticky className="min-w-36 font-medium">
                        {r.name}
                        {isUnreciped(r) ? (
                          <span className="mt-0.5 block">
                            <UnrecipedBadge row={r} />
                          </span>
                        ) : null}
                      </TD>
                      <TD numeric>
                        {num(r.usage)} {r.unit}
                      </TD>
                      <TD numeric>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Kayıttan sonra (ya da pencereden eklenince) yeni değerle yeniden kurulur */}
                          <PurchaseCell key={`${r.ingredientId}:${r.purchased ?? ""}`} month={month} row={r} />
                          <span className="w-8 text-left text-xs text-ink-mute">{r.unit}</span>
                        </div>
                      </TD>
                      <TD numeric>
                        <RatioBadge row={r} />
                      </TD>
                      <TD
                        numeric
                        className={cn(r.diffAmount !== null && r.diffAmount < 0 && "text-info", r.diffAmount !== null && r.diffAmount > 2000 && "font-semibold text-bad")}
                      >
                        {r.diffAmount === null ? "–" : tl(r.diffAmount)}
                      </TD>
                      {hasStock ? (
                        <>
                          <TD numeric>
                            <ActualUsage row={r} />
                            {r.opening !== null && r.closing !== null ? (
                              <span className="block text-xs text-ink-mute">
                                sayım {num(r.opening)} → {num(r.closing)}
                              </span>
                            ) : null}
                          </TD>
                          <TD numeric className={cn(r.varianceAmount !== null && r.varianceAmount > 0 && "font-semibold text-bad")}>
                            {r.varianceAmount === null ? "–" : tl(r.varianceAmount)}
                            {r.variance !== null ? (
                              <span className="block text-xs font-normal text-ink-mute">
                                {num(r.variance)} {r.unit}
                              </span>
                            ) : null}
                          </TD>
                        </>
                      ) : null}
                      <TD className="max-w-72 min-w-44 text-xs text-ink-mute">
                        {/* Uzun yorum satırı uzatmasın: üç satır, tamamı ipucunda ve düzenleme penceresinde */}
                        {r.note ? (
                          <span className="line-clamp-3 break-words" title={r.note}>
                            {r.note}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <IconButton label={`${r.name}: alımı ve yorumu düzenle`} onClick={() => setDialog(r)}>
                            <Pencil size={15} />
                          </IconButton>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </tbody>
                <tfoot>
                  <TFootRow className="bg-panel-deep/40">
                    <TD colSpan={4}>
                      {filtered ? (
                        <>
                          Gösterilen {num(visible.length)} malzemenin farkı
                          <span className="ml-2 font-normal text-ink-mute">(tümü {tl(totalDiff)})</span>
                        </>
                      ) : (
                        "Toplam fark (alınan − reçeteye göre kullanılan)"
                      )}
                    </TD>
                    <TD numeric>{tl(filtered ? visibleDiff : totalDiff)}</TD>
                    {hasStock ? (
                      <>
                        <TD />
                        <TD numeric>{tl(filtered ? visibleTotals.variance : totalVariance)}</TD>
                      </>
                    ) : null}
                    <TD colSpan={2} />
                  </TFootRow>
                </tfoot>
              </Table>
            </TableWrap>
            {/* Kart görünümünde toplam (tablonun alt satırının karşılığı) */}
            <div className={cn("mx-3 mb-3 space-y-1.5 rounded-2xl bg-panel-deep/40 px-3.5 py-3 text-sm font-semibold", cardsOnly)}>
              <p className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">{filtered ? `Gösterilen ${num(visible.length)} malzemenin farkı` : "Toplam fark"}</span>
                <span className="tabular">{tl(filtered ? visibleDiff : totalDiff)}</span>
              </p>
              {hasComparison ? (
                <p className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">{filtered ? "Gösterilenlerin sapması" : "Toplam sapma"}</span>
                  <span className="tabular">{tl(filtered ? visibleTotals.variance : totalVariance)}</span>
                </p>
              ) : null}
            </div>
          </>
        ) : rows.length ? (
          <EmptyState
            icon={<SearchX />}
            title="Bu süzgece uyan malzeme yok"
            description={q.trim() ? `"${q.trim()}" adında malzeme bulunamadı ya da fark süzgecine uymuyor.` : "Seçili fark derecesinde malzeme yok; bu iyi haber olabilir."}
            action={
              <Button variant="secondary" onClick={clear}>
                Süzgeci temizle
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Scale />}
            title="Bu ay karşılaştırılacak malzeme yok"
            description="Satış raporu yüklendiğinde ya da alım girildiğinde malzemeler burada listelenir."
            action={
              <>
                <ButtonLink href={`/panel/satislar?ay=${month}`} variant="secondary">
                  Satış raporu yükle
                </ButtonLink>
                <Button onClick={() => setDialog("new")}>
                  <Plus size={16} /> Alım ekle
                </Button>
              </>
            }
          />
        )}

        {visible.length ? <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} total={paged.total} unit="malzeme" className="border-t border-line" /> : null}
      </div>

      {hasStock && !hasComparison ? (
        <CardFooter className="justify-start gap-2 text-xs">
          <Info size={14} className="shrink-0 text-ink-quiet" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            İki ayın sayımı var ama alım miktarı girilmemiş: sapma, &quot;Faturayla alınan&quot; girilen satırlarda hesaplanır. Bu ay hiç alınmayan malzemeye 0
            yazın.
            {needsPurchase.length && !onlyNeeds ? (
              <button
                type="button"
                onClick={() => setNeedParam("1")}
                className="-my-3.5 ml-1 inline-block cursor-pointer py-3.5 font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
              >
                Alımı eksik {num(needsPurchase.length)} malzemeyi göster
              </button>
            ) : null}
          </span>
        </CardFooter>
      ) : null}

      {!hasStock ? (
        <CardFooter className="justify-start gap-2 text-xs">
          <Info size={14} className="shrink-0 text-ink-quiet" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            İpucu: Bu ayın ve geçen ayın stok sayımını girerseniz &quot;gerçek tüketim&quot; ve &quot;sapma&quot; sütunları çıkar. Sapma, reçeteye göre olması gerekenden
            fazla harcanan malın parasıdır (fire, ikram, porsiyon kaçağı).{" "}
            <Link href={`/panel/sayim?ay=${month}`} className="-my-3.5 inline-block py-3.5 font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
              Sayıma git
            </Link>
          </span>
        </CardFooter>
      ) : null}

      {dialog ? <PurchaseDialog month={month} ingredients={ingredients} rows={rows} row={dialog === "new" ? null : dialog} onClose={() => setDialog(null)} /> : null}
    </Card>
  );
}

function PurchaseDialog({
  month,
  ingredients,
  rows,
  row,
  onClose,
}: {
  month: string;
  ingredients: IngredientOption[];
  rows: Row[];
  row: Row | null;
  onClose: () => void;
}) {
  // Satırdan açılan malzeme elle fiyatlı listede yoksa da seçilebilsin
  const options =
    row && !ingredients.some((i) => i.id === row.ingredientId) ? [{ id: row.ingredientId, name: row.name, unit: row.unit }, ...ingredients] : ingredients;
  const byId = new Map(rows.map((r) => [r.ingredientId, r]));
  const initialId = row?.ingredientId ?? options[0]?.id ?? 0;
  const [id, setId] = useState<number>(initialId);
  const existing = byId.get(id) ?? null;
  const [qty, setQty] = useState(row && row.purchased !== null ? num(row.purchased, 2) : "");
  const [note, setNote] = useState(row?.note ?? (existing?.purchased !== null ? (existing?.note ?? "") : ""));
  /** Yeni alımda, bu ay zaten girilmiş miktarın üstüne eklensin mi (faturalar parça parça gelir) */
  const [addToExisting, setAddToExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const unit = options.find((i) => i.id === id)?.unit ?? "";
  const parsed = parseNumberTR(qty);
  const qtyInvalid = qty.trim() !== "" && (parsed === null || parsed < 0);
  const already = !row && existing?.purchased != null ? existing.purchased : null;
  const finalQty = parsed === null ? null : already !== null && addToExisting ? already + parsed : parsed;
  const usage = existing?.usage ?? null;
  const ratio = finalQty !== null && usage ? finalQty / usage : null;

  const pick = (next: number) => {
    setId(next);
    // Seçilen malzemenin bu ayki yorumu silinmesin diye kutuya gelir
    const r = byId.get(next);
    setNote(r && r.purchased !== null ? (r.note ?? "") : "");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (finalQty === null || qtyInvalid) return toast.error("Miktar girin", { description: "Yalnızca sayı; ondalık için virgül (ör. 2,5)." });
    setBusy(true);
    const res = await setPurchaseQty(month, id, finalQty, note);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    const name = options.find((i) => i.id === id)?.name ?? "";
    toast.success(`${name}: ${num(finalQty, 2)} ${unit} ${row || already !== null ? "kaydedildi" : "eklendi"}`);
    onClose();
  }

  const removeButton =
    row && row.purchased !== null ? (
      <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" disabled={busy} onClick={() => setConfirmDelete(true)}>
        <Trash2 size={16} /> Alımı sil
      </Button>
    ) : null;

  async function remove() {
    if (!row) return;
    setBusy(true);
    const res = await setPurchaseQty(month, row.ingredientId, null);
    setBusy(false);
    setConfirmDelete(false);
    if (!res.ok) return toast.error(res.error);
    const prev = { qty: row.purchased, note: row.note };
    toast.success(`${row.name}: alım silindi`, {
      action: prev.qty === null ? undefined : { label: "Geri al", onClick: () => void setPurchaseQty(month, row.ingredientId, prev.qty, prev.note) },
    });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? `${row.name}: alınan miktar` : "Alınan miktar ekle"}
      description="Faturalardaki toplam miktarı malzemenin kendi biriminde girin (1 kg = 1.000 gr, 1 L = 1.000 ml)."
      footerStart={removeButton}
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="purchase-form" disabled={busy || !options.length || finalQty === null || qtyInvalid}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id="purchase-form" onSubmit={submit} className="space-y-3 pb-2">
        <Field label="Malzeme" htmlFor="ap-i" hint={!row && !options.length ? "Elle fiyatlı aktif malzeme yok." : undefined}>
          <Select id="ap-i" value={id} disabled={!!row} onChange={(e) => pick(Number(e.target.value))} data-autofocus={!row ? true : undefined}>
            {options.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {byId.get(i.id)?.purchased != null ? " · girildi" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {already !== null ? (
          <div className="rounded-xl bg-info-soft px-3 py-2.5 text-[13px] text-ink-soft">
            Bu ay zaten <span className="font-semibold text-ink tabular">{num(already, 2)} {unit}</span> girilmiş.
            <Checkbox
              label="Yeni miktarı bunun üstüne ekle"
              className="mt-1.5 flex min-h-9"
              checked={addToExisting}
              onChange={(e) => setAddToExisting(e.target.checked)}
            />
          </div>
        ) : null}
        <Field
          label={`Miktar (${unit})`}
          htmlFor="ap-q"
          error={qtyInvalid ? "Geçerli bir miktar girin (ör. 2.000 ya da 2,5)" : undefined}
          hint={
            finalQty !== null ? (
              <span className="tabular">
                {already !== null && addToExisting ? `Kaydedilecek: ${num(finalQty, 2)} ${unit}` : null}
                {already !== null && addToExisting && usage ? " · " : null}
                {usage ? `Reçeteye göre kullanım ${num(usage)} ${unit}${ratio !== null ? ` → oran ${num(ratio, 2)}×` : ""}` : null}
              </span>
            ) : usage ? (
              <span className="tabular">
                Reçeteye göre kullanım: {num(usage)} {unit}
              </span>
            ) : undefined
          }
        >
          <NumberInput
            id="ap-q"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="cell-input pointer-coarse:h-12 pointer-coarse:text-lg"
            aria-invalid={qtyInvalid || undefined}
            placeholder="0"
            enterKeyHint="next"
            data-autofocus={row ? true : undefined}
          />
        </Field>
        <Field label="Kaynak faturalar / yorum" htmlFor="ap-n" hint="İsteğe bağlı: hangi faturalardan geldiği, kontrol notu.">
          {/* Uzun fatura notu tek satırda kesiliyordu: çok satırlı kutu, yazdıkça uzar. Not tek satırlık metin: Enter kaydeder */}
          <Textarea
            id="ap-n"
            value={note}
            onChange={(e) => setNote(e.target.value.replace(/\s*\n\s*/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            enterKeyHint="done"
            rows={2}
            maxLength={300}
            placeholder="ör. Kaldi 01.09 + 15.09: 2 × 12 kg"
            className="min-h-9 field-sizing-content pointer-coarse:min-h-11"
          />
        </Field>
      </form>
      {row ? (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
          pending={busy}
          title={`${row.name}: alım silinsin mi?`}
          description={`${monthLabelOf(month)} için girilen miktar${row.note ? " ve yorumu" : ""} silinir. Bildirimdeki "Geri al" ile hemen geri getirebilirsiniz.`}
          confirmLabel="Alımı sil"
        />
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------- Bulgular (AkmanOS todo-list görünümü)

type FindingItem = { id: number; section: string; title: string; detail: string | null; resolved: boolean; createdAt: string };
type FindingView = "acik" | "cozulen" | "tumu";
const FINDING_KEYS = ["bulgu", "bolum", "durum"];

/** AkmanOS todo-list durum ikonu: kesik çizgili halka, çözülünce dolar ve onay işareti çizilir */
function FindingStatusIcon({ done }: { done: boolean }) {
  const reduce = useCalmMotion() ?? false;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("size-5 shrink-0 overflow-visible transition-colors", done ? "text-good" : "text-ink-quiet group-hover/toggle:text-ink-mute")}
    >
      <motion.circle
        cx="12"
        cy="12"
        r="9"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={done ? undefined : "2 3"}
        strokeLinecap="round"
        initial={false}
        animate={{ fillOpacity: done ? 0.14 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
      />
      <motion.path
        d="M7.5 12.25 10.5 15.25 16.75 8.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
      />
    </svg>
  );
}

export function Findings({ items }: { items: FindingItem[] }) {
  const reduce = useCalmMotion() ?? false;
  const [viewParam, setView] = useQueryState<FindingView>("durum", "acik");
  const [sectionParam, setSection] = useQueryState<string>("bolum", "");
  const [q, setQ] = useQueryText("bulgu");
  const [editing, setEditing] = useState<FindingItem | "new" | null>(null);
  // İşaretleme anında görünsün; sunucu yenilenince gerçek değer gelir, hata olursa geri döner
  const [list, setOptimistic] = useOptimistic(items, (state, change: { id: number; resolved: boolean }) =>
    state.map((i) => (i.id === change.id ? { ...i, resolved: change.resolved } : i)),
  );
  const view: FindingView = viewParam === "cozulen" || viewParam === "tumu" ? viewParam : "acik";
  const allSections = [...new Set(list.map((i) => i.section))];
  const section = allSections.includes(sectionParam) ? sectionParam : "";
  const inView = (i: FindingItem) => view === "tumu" || (view === "cozulen" ? i.resolved : !i.resolved);
  const searched = list.filter((i) => matches(`${i.title} ${i.detail ?? ""} ${i.section}`, q));
  const visible = searched.filter((i) => inView(i) && (!section || i.section === section));
  const sections = [...new Set(visible.map((i) => i.section))];
  const resolvedCount = list.filter((i) => i.resolved).length;
  const openCount = list.length - resolvedCount;
  const share = list.length ? resolvedCount / list.length : 0;
  const filtered = view !== "acik" || section !== "" || q.trim() !== "";

  const clear = () => {
    setQ("");
    clearQuery(FINDING_KEYS);
  };

  const toggle = (item: FindingItem, resolved: boolean) =>
    startTransition(async () => {
      setOptimistic({ id: item.id, resolved });
      const res = await setFindingResolved(item.id, resolved);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Madde bu görünümden kaybolacaksa geri alma imkânı
      const leaves = (resolved && view === "acik") || (!resolved && view === "cozulen");
      const text = resolved ? `"${item.title}" çözüldü` : `"${item.title}" yeniden açıldı`;
      if (leaves) toast.success(text, { action: { label: "Geri al", onClick: () => toggle(item, !resolved) } });
    });

  return (
    <Card>
      <CardHeader
        icon={<ListChecks />}
        title="Bulgular ve yapılacaklar"
        description="Reçetede olmayan alımlar, fiyat ve fatura kontrolleri. Çözülen maddeyi soldaki halkayla işaretleyin; düzenlemek için maddeye dokunun."
        meta={
          <>
            <span>Açık · {num(openCount)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-baseline gap-1">
              Çözülen ·{" "}
              <span className={cn("inline-flex items-baseline font-medium", list.length && resolvedCount === list.length ? "text-good" : "text-ink")}>
                <CountRoll value={resolvedCount} />
                <span className="text-ink-mute">&nbsp;/ {num(list.length)}</span>
              </span>
            </span>
          </>
        }
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus size={16} /> Bulgu ekle
          </Button>
        }
      />
      {list.length ? (
        <div className="px-5 pb-4">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-panel-deep"
            role="progressbar"
            aria-label="Çözülen bulgular"
            aria-valuemin={0}
            aria-valuemax={list.length}
            aria-valuenow={resolvedCount}
          >
            <motion.div
              className={cn("h-full rounded-full", share === 1 ? "bg-good" : "bg-ink")}
              initial={reduce ? false : { width: 0, opacity: 0.6 }}
              animate={{ width: `${share * 100}%`, opacity: 1 }}
              transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.2 }}
            />
          </div>
        </div>
      ) : null}
      {list.length ? (
        <FilterBar active={filtered} onClear={clear} shown={visible.length} total={list.length} unit="bulgu" className="px-5 pb-4">
          <SearchField className="max-sm:basis-full sm:flex-1 sm:basis-56" value={q} onChange={setQ} placeholder="Bulgularda ara" label="Bulgularda ara" shortcut={false} />
          <Segmented<FindingView>
            label="Bulgu durumu"
            value={view}
            onChange={setView}
            options={[
              { value: "acik", label: "Açık", count: searched.filter((i) => !i.resolved).length },
              { value: "cozulen", label: "Çözülen", count: searched.filter((i) => i.resolved).length },
              { value: "tumu", label: "Tümü", count: searched.length },
            ]}
          />
          {allSections.length > 1 ? (
            <div role="group" aria-label="Bölüm" className="-mx-5 flex min-w-0 gap-1.5 overflow-x-auto px-5 [scrollbar-width:none] max-sm:basis-[calc(100%+2.5rem)] sm:contents">
              {allSections.map((s) => (
                <FilterChip
                  key={s}
                  active={section === s}
                  onToggle={() => setSection(section === s ? "" : s)}
                  count={searched.filter((i) => i.section === s && inView(i)).length}
                >
                  {s}
                </FilterChip>
              ))}
            </div>
          ) : null}
        </FilterBar>
      ) : null}
      {/* Süzgeç değişince liste yeniden kurulur: çıkan maddeler yenilerin üstünde solmasın (yalnızca işaretleme hareketlenir) */}
      <CardContent key={`${view}|${section}|${q.trim()}`} className="space-y-5">
        {sections.map((sec) => {
          const secList = visible.filter((i) => i.section === sec);
          return (
            <div key={sec}>
              <p className="mb-2 text-[13px] font-semibold text-ink-soft">
                {sec} <span className="font-normal text-ink-mute tabular">· {num(secList.length)}</span>
              </p>
              <ul className="flex flex-col rounded-2xl bg-surface p-1.5 ring-1 ring-line">
                <AnimatePresence initial={false} mode="popLayout">
                  {secList.map((i) => (
                    <motion.li
                      layout="position"
                      key={i.id}
                      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                      transition={reduce ? { duration: 0 } : { opacity: { duration: 0.18, ease: EASE_OUT }, y: SPRING_LAYOUT, layout: SPRING_LAYOUT }}
                      className="flex items-start gap-1 rounded-xl py-0.5 pr-1 transition-colors hover:bg-panel/70"
                    >
                      <button
                        type="button"
                        onClick={() => toggle(i, !i.resolved)}
                        className="group/toggle flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg pointer-coarse:size-11"
                        aria-label={`${i.title}: ${i.resolved ? "yeniden aç" : "çözüldü olarak işaretle"}`}
                        title={i.resolved ? "Yeniden aç" : "Çözüldü olarak işaretle"}
                      >
                        <FindingStatusIcon done={i.resolved} />
                      </button>
                      <button type="button" className="min-w-0 flex-1 cursor-pointer rounded-lg py-2 text-left" onClick={() => setEditing(i)}>
                        <span
                          className={cn("block text-sm font-medium break-words transition-colors", i.resolved ? "text-ink-mute line-through decoration-ink-quiet" : "text-ink")}
                        >
                          {i.title}
                        </span>
                        {i.detail ? (
                          <span className={cn("mt-0.5 block text-[13px] leading-5 break-words whitespace-pre-line text-ink-mute", i.resolved && "opacity-70")}>
                            {i.detail}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-xs text-ink-mute tabular">
                          {dateTR(i.createdAt.slice(0, 10))}
                          {i.resolved ? " · çözüldü" : ""}
                        </span>
                      </button>
                      <IconButton label={`${i.title}: düzenle`} className="mt-1" onClick={() => setEditing(i)}>
                        <Pencil size={15} />
                      </IconButton>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          );
        })}
        {!visible.length ? (
          filtered && list.length ? (
            <EmptyState
              icon={<SearchX />}
              title={view === "acik" && !q.trim() && !section ? "Açık bulgu yok" : "Bu süzgece uyan bulgu yok"}
              description={
                view === "acik" && !q.trim() && !section
                  ? `${num(resolvedCount)} çözülmüş bulgu gizli.`
                  : "Aramayı, bölümü ya da durumu değiştirin veya süzgeci temizleyin."
              }
              action={
                <Button variant="secondary" onClick={clear}>
                  Süzgeci temizle
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ListChecks />}
              title={list.length ? "Açık bulgu yok" : "Henüz bulgu yok"}
              description={
                list.length
                  ? `${num(resolvedCount)} çözülmüş bulgu gizli. Yeni bir kontrol notu eklemek için "Bulgu ekle".`
                  : "Faturada, fiyatta ya da reçetede dikkatinizi çeken bir şeyi not edin; çözünce işaretlersiniz."
              }
              action={
                <>
                  {resolvedCount ? (
                    <Button variant="secondary" onClick={() => setView("cozulen")}>
                      Çözülenleri göster
                    </Button>
                  ) : null}
                  <Button onClick={() => setEditing("new")}>
                    <Plus size={16} /> Bulgu ekle
                  </Button>
                </>
              }
            />
          )
        ) : null}
      </CardContent>
      {editing ? (
        <FindingDialog
          item={editing === "new" ? null : editing}
          sections={allSections}
          defaultSection={section || undefined}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

/** Dokunmatik ekran mı (pencere yalnızca istemcide, bir dokunuşla açıldığı için çizimde okunabilir) */
const coarsePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

function FindingDialog({
  item,
  sections,
  defaultSection,
  onClose,
}: {
  item: FindingItem | null;
  sections: string[];
  /** Süzgeçte bir bölüm seçiliyse yeni bulgu oraya açılır */
  defaultSection?: string;
  onClose: () => void;
}) {
  const [section, setSection] = useState(item?.section ?? defaultSection ?? sections[0] ?? "Genel");
  const [title, setTitle] = useState(item?.title ?? "");
  const [detail, setDetail] = useState(item?.detail ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canSave = title.trim() !== "" && section.trim() !== "";

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSave) return toast.error(title.trim() ? "Bölüm adını yazın" : "Başlık yazın");
    setBusy(true);
    const res = await saveFinding({ id: item?.id ?? null, section, title, detail });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(item ? "Bulgu kaydedildi" : `"${title.trim()}" eklendi`);
    onClose();
  }

  const deleteButton = item ? (
    <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" disabled={busy} onClick={() => setConfirmDelete(true)}>
      <Trash2 size={16} /> Sil
    </Button>
  ) : null;

  async function remove() {
    if (!item) return;
    setBusy(true);
    const res = await deleteFinding(item.id);
    setBusy(false);
    setConfirmDelete(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`"${item.title}" silindi`);
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? "Bulguyu düzenle" : "Bulgu ekle"}
      description={item ? `${dateTR(item.createdAt.slice(0, 10))} tarihinde eklendi${item.resolved ? " · çözüldü" : ""}` : "Kontrol edilecek ya da düzeltilecek bir şeyi not edin."}
      footerStart={deleteButton}
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="finding-form" disabled={busy || !canSave}>
            {busy ? "Kaydediliyor…" : item ? "Kaydet" : "Ekle"}
          </Button>
        </>
      }
    >
      <form id="finding-form" onSubmit={submit} className="space-y-3 pb-2">
        <Field label="Bölüm" htmlFor="fd-s" hint="Benzer bulgular aynı bölümde toplanır. Listeden seçin ya da yeni bir ad yazın.">
          <Input id="fd-s" list="finding-sections" value={section} onChange={(e) => setSection(e.target.value)} maxLength={80} />
          <datalist id="finding-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {sections.length > 1 ? (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {sections.map((s) => (
                <FilterChip key={s} active={section === s} onToggle={() => setSection(s)} className="h-8 text-xs">
                  {s}
                </FilterChip>
              ))}
            </div>
          ) : null}
        </Field>
        <Field label="Başlık" htmlFor="fd-t">
          <Input
            id="fd-t"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="ör. Liçi şurubu reçetede yok"
            // Dokunmatik ekranda düzenlerken klavye kendiliğinden açılmasın; yeni bulguda ve masaüstünde başlığa odaklanılır
            data-autofocus={!item || !coarsePointer() ? true : undefined}
          />
        </Field>
        <Field
          label="Ayrıntı"
          htmlFor="fd-d"
          hint={
            <>
              İsteğe bağlı.<span className="max-sm:hidden"> ⌘ Enter / Ctrl Enter ile kaydedin.</span>
            </>
          }
        >
          <Textarea
            id="fd-d"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={3}
            maxLength={2000}
          />
        </Field>
      </form>
      {item ? (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
          pending={busy}
          title="Bulgu silinsin mi?"
          description={`"${item.title}" kalıcı olarak silinir; geri alınamaz. Yalnızca kapatmak istiyorsanız silmek yerine çözüldü olarak işaretleyin.`}
          confirmLabel="Bulguyu sil"
        />
      ) : null}
    </Dialog>
  );
}
