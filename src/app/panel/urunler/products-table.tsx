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
  GlobeCheck,
  GlobeOff,
  GlobeX,
  IceCreamCone,
  Leaf,
  Plus,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { toastUnreachable } from "@/components/ui/action-error";
import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink, IconLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { NumberInput, Select } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, Signed } from "@/components/ui/misc";
import { Pagination, useUrlPaged } from "@/components/ui/pagination";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import type { ProductStatus } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Size } from "@/lib/calc/types";
import { RECIPE_COST_NOTE, SIZE_LABELS, SIZES } from "@/lib/constants";
import { num, pct, tl } from "@/lib/format";
import { priceReminder } from "@/lib/prices/pos";
import type { SiteMarker } from "@/lib/site-menu/view";
import { cn, slugify } from "@/lib/utils";
import { updateProductPrice } from "@/server/actions/products";

import { compareBy, LIST_QUERY_KEY, menuAverages, NO_RECIPE_LAST_KEYS, productHref, soldProfit, STATUS_CHIPS, statusChips } from "./logic";
import { FilterSheet, FilterSheetButton, FilterSummaryLine, SHEET_CHIP, SheetSection, SheetToggle } from "./filter-sheet";
import { filterSummary } from "./filter-text";
import { bulkHref, productSearchText } from "./fiyatlar/logic";
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
  /** laffogato.net menü bağlantısı (bağlantı kapalıysa ve ürün bağlı değilse null); ref: "mnu-0007 M" */
  site?: (SiteMarker & { ref: string | null }) | null;
}

type NumKey = keyof Pick<
  ProductRow,
  "price" | "cost" | "unitProfit" | "margin" | "costRatio" | "suggestedPrice" | "soldQty" | "monthProfit" | "net" | "commission" | "totalCost" | "monthNet"
>;
/** Sayısal olmayan sıralamalar: ad, durum (en kötüsü önce), kategori (A → Z), fire */
type TextKey = "name" | "status" | "category" | "fireRate";
type SortKey = NumKey | TextKey;
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;
const TEXT_KEYS: TextKey[] = ["name", "status", "category", "fireRate"];

const STATUSES = STATUS_CHIPS;
const SORT_KEYS: SortKey[] = [
  ...TEXT_KEYS,
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

/** Sayfa boyu seçenekleri (?goster=100 / ?goster=tumu); Excel'deki gibi bütün menü tek sayfada da görülebilir */
const PAGE_SIZES = [
  { value: "", label: "50", size: 50 },
  { value: "100", label: "100", size: 100 },
  { value: "tumu", label: "Tümü", size: Number.POSITIVE_INFINITY },
] as const;

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

// Aramada boyun kodu da (M) tabloda görünen adı da (Medium) eşleşir; ürün notu ("varsayıldı") ve site işareti
// ("sitede", "bağlı değil") da aranır. Toplu değiştir de aynı metinde arar: "Toplu fiyat" listenin gösterdiği ürünlerle açılır
const searchText = (r: ProductRow) => productSearchText({ ...r, siteText: r.site?.text });

/** Site işaretinin rengi ve ikonu: bağlı bilgi mavisi, sorunlu kırmızı / turuncu, bağlı değil soluk */
const SITE_MARK: Record<SiteMarker["kind"], { icon: LucideIcon; tone: string; badge: "blue" | "gray" | "red" | "amber" }> = {
  linked: { icon: GlobeCheck, tone: "text-info", badge: "blue" },
  pending: { icon: GlobeCheck, tone: "text-info", badge: "blue" },
  broken: { icon: GlobeX, tone: "text-bad", badge: "red" },
  missing: { icon: GlobeX, tone: "text-warn", badge: "amber" },
  none: { icon: GlobeOff, tone: "text-ink-quiet", badge: "gray" },
};

/**
 * laffogato.net menüsü işareti ("Sitede", "Bağlı değil", "Bağlantı kopuk", "Sitede yok"). Tabloda adın yanında küçük
 * ikon (metni ipucunda ve ekran okuyucuda; satır yüksekliği değişmesin), sorunluysa metinli rozet; telefon kartında
 * rozet.
 */
function SiteMark({ site, compact }: { site: NonNullable<ProductRow["site"]>; compact?: boolean }) {
  const mark = SITE_MARK[site.kind];
  if (compact || site.kind === "broken" || site.kind === "missing") {
    return (
      <Badge tone={mark.badge} dot={site.kind !== "none"} title={site.title}>
        {site.text}
      </Badge>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0", mark.tone)} title={site.title}>
      {createElement(mark.icon, { size: 14, "aria-hidden": true })}
      <span className="sr-only">{site.text}</span>
    </span>
  );
}

/** Oran anlamsız: reçete yok (%0 ve ~%97) ya da fiyat girilmemiş (0 ₺; oran %0 görünür ama ürün zararına satılır) */
const noRatio = (r: Pick<ProductRow, "status" | "price">) => r.status === "Reçete yok" || r.price <= 0;

/** Maliyet oranının hedefe göre rengi (Durum rozetiyle aynı eşikler); oranı anlamsız üründe renk yok */
const ratioClass = (r: Pick<ProductRow, "costRatio" | "status" | "price">, target: number) =>
  noRatio(r) ? "text-ink-quiet" : r.costRatio > target + 0.1 ? "text-bad" : r.costRatio > target ? "text-warn" : "text-good";

/** Oranı anlamsız üründe maliyet oranı ve marj yerine tire */
const ratioText = (r: Pick<ProductRow, "status" | "price">, v: number) => (noRatio(r) ? "–" : pct(v));

/** Telefonda tablo başlığı yerine sıralama seçimi */
const MOBILE_SORTS: { value: string; label: string }[] = [
  { value: "", label: "Menü sırası" },
  { value: "name.asc", label: "Ad (A → Z)" },
  { value: "unitProfit.desc", label: "Birim kâr (yüksekten)" },
  { value: "unitProfit.asc", label: "Birim kâr (düşükten)" },
  { value: "costRatio.desc", label: "Maliyet oranı (yüksekten)" },
  { value: "status.desc", label: "Durum (en kötüsü önce)" },
  { value: "category.asc", label: "Kategori (A → Z)" },
  { value: "margin.desc", label: "Kâr marjı (yüksekten)" },
  { value: "price.desc", label: "Satış fiyatı (yüksekten)" },
  { value: "soldQty.desc", label: "Satış adedi (çoktan)" },
  { value: "monthProfit.desc", label: "Aylık brüt kâr (yüksekten)" },
  { value: "fireRate.desc", label: "Zayi / fire (yüksekten)" },
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

/**
 * Satır içinde fiyat düzenleme: Enter ya da alandan çıkmak kaydeder, Esc vazgeçer. Birim (₺) hep görünür. Kayıt hücrenin
 * gördüğü fiyatı da gönderir (`last`): fiyat bu arada başka yerde değiştiyse yazılmaz, liste yenilenir (denetim E-11).
 */
function PriceCell({ row, className }: { row: ProductRow; className?: string }) {
  const [value, setValue] = useState(priceText(row.price));
  const [saving, setSaving] = useState(false);
  // Hücre gördüğü fiyatı (`last`) kayıtta gönderir. Liste bu ürünün yeni fiyatıyla çizilince (eşitleme, toplu
  // değişiklik, başka sekme, reddedilen kayıt) hücre baştan kurulur (anahtarında fiyat var): yeni fiyatı görür,
  // o sırada yazılıp henüz kaydedilmemiş değer bırakılır
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
    let res: Awaited<ReturnType<typeof updateProductPrice>>;
    try {
      res = await updateProductPrice(row.id, v, false, "manual", last);
    } catch (e) {
      toastUnreachable(e, `fiyat-${row.id}`);
      setValue(priceText(last));
      return;
    } finally {
      setSaving(false);
    }
    if (res.ok) {
      // Siteye bağlı üründe yazılan fiyat sitenin kuruşudur; kasada (ModPOS) değişecekse Kasaya işle listesine girdi
      const written = res.data.price;
      setLast(written);
      setValue(priceText(written));
      const reminder = priceReminder(res.data);
      toast.success(`${row.name} ${row.size}: ${tl(last, 2)} → ${tl(written, 2)}`, reminder ? { description: reminder, duration: res.data.site ? 12_000 : 8_000 } : undefined);
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
        // Telefon kartında 44px dokunma alanı ve 16px yazı (iOS alanı büyütmesin)
        className="cell-input bg-surface/70 pr-6 pl-2 ring-line hover:bg-surface hover:ring-line-strong focus:bg-surface pointer-coarse:h-11 max-sm:h-11 max-sm:font-semibold"
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

/**
 * Ürün adı hücresi (tablo ve telefon kartı); telefonda durum rozetleri adın altında. Ad, seçili ayla reçete
 * kartını açar. Ürün notu (Excel'deki hücre notu) adın yanında ⓘ: bağlantının dışında, tıklamak kartı açmaz.
 */
function ProductName({ r, compact, month }: { r: ProductRow; compact?: boolean; month: string }) {
  const href = productHref(r.id, month);
  return (
    <div className={cn("flex min-w-0 gap-3", compact ? "items-start" : "items-center")}>
      {/* Tabloda karo yalnızca geniş ekranda: 1400px'te ad sütunu yer kazanır, satırlar sarılmaz. Telefon kartında
          da yok: ad ve rozetler fiyat alanının yanında tek satıra sığsın. */}
      <Link href={href} tabIndex={-1} aria-hidden="true" className="hidden shrink-0 2xl:inline-flex">
        <IconTile tone={toneFor(r.category)}>{createElement(categoryIcon(r.category))}</IconTile>
      </Link>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {/* Telefon kartında bağlantı kartın tamamını kaplar (after:inset-0): karta dokunmak reçete kartını açar;
              fiyat alanı, ⓘ ve "Reçeteyi girin" üstte (z-10) kalır */}
          <Link
            href={href}
            data-card-link={compact ? "" : undefined}
            className={cn(
              "font-semibold break-words hover:underline",
              r.active ? "text-ink" : "text-ink-mute",
              compact && "text-[15px] leading-6 after:absolute after:inset-0 after:rounded-2xl",
            )}
          >
            {r.name}
          </Link>
          {r.note ? <InfoTip text={r.note} className={compact ? "relative z-10" : undefined} /> : null}
          {r.site && !compact ? <SiteMark site={r.site} /> : null}
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
            {r.site ? <SiteMark site={r.site} compact /> : null}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function ProductsTable({
  rows,
  categories,
  month,
  monthLabel,
  target,
  siteConfigured = false,
}: {
  rows: ProductRow[];
  categories: { id: number; name: string }[];
  /** Seçili ay (YYYY-MM): kart bağlantıları aynı ayı açar */
  month: string;
  monthLabel: string;
  target: number;
  /** laffogato.net menü bağlantısı açık: "Sitede" ürünlerin fiyatı sitede de değişir */
  siteConfigured?: boolean;
}) {
  const reduce = useCalmMotion();
  // Süzgeçler adreste: ?ara=latte&kategori=3&boy=L&durum=Dikkat,Düşük kâr&pasif=1&sirala=unitProfit.desc&goster=tumu
  // (genel bakıştaki ve ⌘K paletindeki bağlantılar aynı adları kullanır)
  const [q, setQ] = useQueryText("ara");
  const [kategori, setKategori] = useQueryState<string>("kategori", "");
  const [boy, setBoy] = useQueryState<string>("boy", "");
  const [durum, setDurum] = useQueryState<string>("durum", "");
  const [pasif, setPasif] = useQueryState<string>("pasif", "");
  const [sira, setSira] = useQueryState<string>("sirala", "");
  const [goster, setGoster] = useQueryState<string>("goster", "");
  const pageSize = (PAGE_SIZES.find((p) => p.value === goster) ?? PAGE_SIZES[0]).size;

  // Karttaki "← Ürünler" bu süzgeçlere dönsün: listenin adres sorgusu oturumda saklanır (yalnızca bu tarayıcıda)
  const search = useSearchParams().toString();
  useEffect(() => {
    try {
      window.sessionStorage.setItem(LIST_QUERY_KEY, search);
    } catch {
      // gizli pencere ya da engellenmiş depolama: kart düz bağlantıyla döner
    }
  }, [search]);
  const [details, setDetails] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  // Telefonda süzgeçler alttan açılan pencerede
  const [sheet, setSheet] = useState(false);
  const router = useRouter();
  // Satırlar yalnızca kullanıcı sayfa ya da sıra değiştirince yumuşakça belirir (ilk çizimde değil)
  const [interacted, setInteracted] = useState(false);

  const category = categories.some((c) => String(c.id) === kategori) ? Number(kategori) : null;
  const size = SIZES.includes(boy as Size) ? (boy as Size) : null;
  const statuses = useMemo(() => durum.split(",").filter((s): s is ProductStatus => STATUSES.includes(s as ProductStatus)), [durum]);
  const showInactive = pasif === "1";
  const sort = useMemo(() => parseSort(sira), [sira]);
  // Sade görünümde gizli bir sütuna göre sıralanınca o sütun da görünür (sıra açıklamasız kalmasın)
  const col = (k: SortKey) => details || sort?.key === k;

  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  // Arama yalnızca pasif ürünlerle eşleşiyorsa (ör. ⌘K'dan pasif bir ürün) pasifler de listelenir
  const onlyInactiveMatch =
    !showInactive && q.trim() !== "" && !rows.some((r) => r.active && matches(searchText(r), q)) && rows.some((r) => !r.active && matches(searchText(r), q));
  const includeInactive = showInactive || onlyInactiveMatch;

  // Durum dışındaki süzgeçler; durum sayaçları bunun üzerinden sayılır
  const base = useMemo(
    () =>
      rows.filter(
        (r) =>
          (includeInactive || r.active) &&
          (category === null || r.categoryId === category) &&
          (size === null || r.size === size) &&
          matches(searchText(r), q),
      ),
    [rows, q, category, size, includeInactive],
  );

  // Çipler süzgeçle kaybolmaz (sayı 0 olabilir): telefondaki pencerede satırlar kaymasın
  const chips = useMemo(() => statusChips(rows, statuses), [rows, statuses]);

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

  const sizeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if ((includeInactive || r.active) && (category === null || r.categoryId === category)) m.set(r.size, (m.get(r.size) ?? 0) + 1);
    return m;
  }, [rows, includeInactive, category]);

  const filtered = useMemo(() => {
    let list = statuses.length ? base.filter((r) => statuses.includes(r.status)) : base;
    if (sort) {
      const d = sort.dir === "asc" ? 1 : -1;
      const key = sort.key;
      // Reçetesiz ürünün kârı ve oranı anlamsız (tire): bu sütunlarda yön ne olursa olsun sona kalır
      const noRecipeLast = (NO_RECIPE_LAST_KEYS as readonly string[]).includes(key);
      const last = (r: ProductRow) => (noRecipeLast && r.status === "Reçete yok" ? 1 : 0);
      // Sıralama kararlı: eşitlikte menü sırası korunur
      list = [...list].sort(
        (a, b) => last(a) - last(b) || (TEXT_KEYS.includes(key as TextKey) ? compareBy(key as TextKey, a, b) : a[key as NumKey] - b[key as NumKey]) * d,
      );
    }
    return list;
  }, [base, statuses, sort]);

  const paged = useUrlPaged(filtered, pageSize, `${q}|${category}|${size}|${durum}|${includeInactive}|${sira}|${pageSize}`);

  // Görünen ürünlerin bu ayki toplamları ve Excel'in "ORTALAMA" satırı (tablonun alt satırı ve telefon özeti)
  // Brüt kâr reçeteli satılanlardan (kartla aynı kural); net ciro görünen bütün satılanlardan
  const totals = useMemo(() => {
    const sp = soldProfit(filtered);
    return {
      qty: filtered.reduce((a, r) => a + r.soldQty, 0),
      profit: sp.profit,
      noRecipe: sp.noRecipe.length,
      net: filtered.reduce((a, r) => a + r.monthNet, 0),
      avg: menuAverages(filtered),
    };
  }, [filtered]);

  // Sayısal sütunda ve durumda ilk tık büyükten küçüğe, ad ve kategoride A→Z; üçüncü tık sıralamayı kaldırır
  const toggleSort = (key: SortKey) => {
    setInteracted(true);
    const firstDir = key === "name" || key === "category" ? "asc" : "desc";
    const next: Sort = sort?.key !== key ? { key, dir: firstDir } : sort.dir === firstDir ? { key, dir: firstDir === "asc" ? "desc" : "asc" } : null;
    setSira(sortParam(next));
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);

  const toggleStatus = (s: ProductStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : STATUSES.filter((x) => x === s || statuses.includes(x));
    setDurum(next.join(","));
  };

  /** Başlığın altındaki küçük ikinci sıralama (ör. "Maliyet oranı" altında "durum") */
  const subSort = (key: TextKey, label: string, numeric?: boolean) => (
    <span className="block text-xs leading-4 [&_button]:font-normal [&_button]:text-ink-mute [&_button]:hover:text-ink">
      <SortButton numeric={numeric} dir={dirOf(key)} onClick={() => toggleSort(key)}>
        {label}
      </SortButton>
    </span>
  );

  const head = (key: SortKey, label: string, info?: string, sub?: ReactNode) => (
    <TH numeric>
      <span className="inline-flex items-center gap-1.5">
        <SortButton numeric dir={dirOf(key)} onClick={() => toggleSort(key)}>
          {label}
        </SortButton>
        {info ? <InfoTip text={info} /> : null}
      </span>
      {typeof sub === "string" ? <span className="block text-xs leading-4 font-normal text-ink-mute">{sub}</span> : sub}
    </TH>
  );

  const anyFilter = q.trim() !== "" || category !== null || size !== null || statuses.length > 0 || showInactive;
  const clearFilters = () => {
    setQ("");
    clearQuery(["ara", "kategori", "boy", "durum", "pasif"]);
  };
  // Telefondaki "Süzgeç" düğmesinin rozeti ve özeti (arama kutusu ayrı, hep görünür)
  const summary = filterSummary([
    ...statuses,
    categories.find((c) => c.id === category)?.name,
    size ? SIZE_LABELS[size] : null,
    showInactive && "Pasifler dahil",
  ]);
  const clearSheet = () => clearQuery(["kategori", "boy", "durum", "pasif"]);
  // Görünen ürünlerle Fiyatlar › Toplu değiştir (kategori, boy, arama, pasifler; durum süzgeci orada yok). Arama yalnız
  // pasiflerle eşleştiği için gösterilen pasifler de gider
  const bulk = bulkHref({ categoryId: category, size, q, includeInactive });
  const bulkTitle = `Görünen ürünlerin fiyatını birlikte değiştir${statuses.length ? " (durum süzgeci taşınmaz)" : ""}`;

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
      "Not",
      "Tahmini malzeme",
      "Site menüsü",
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
      r.note ?? "",
      r.hasEstimate ? "Evet" : "",
      r.site?.ref ? `${r.site.ref}${r.site.kind === "linked" || r.site.kind === "pending" ? "" : ` (${r.site.text})`}` : "",
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
        // Dokunmatikte Enter/Esc yok (rakam klavyesi), kart ya da ad dokununca açılır
        description={
          <>
            <span className="pointer-coarse:hidden">Satış fiyatına tıklayıp değiştirin; Enter kaydeder, Esc vazgeçer. Ürün adı reçete kartını bu ayla açar.</span>
            <span className="hidden pointer-coarse:inline">Satış fiyatına dokunup değiştirin; alandan çıkınca kaydedilir. Ürüne dokununca reçete kartı bu ayla açılır.</span>
            {siteConfigured ? (
              <>
                {" "}
                Adın yanındaki küre: laffogato.net menüsüne bağlı (üzerine gelince sitedeki kalem ve fiyat); bağlı ürünün fiyatı sitede de değişir.
              </>
            ) : null}
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
        // Telefonda bu iki düğme Süzgeç penceresinin "Görünüm" bölümünde
        actionsClassName="max-sm:hidden"
        actions={
          <>
            <Button
              variant="secondary"
              className={cn(details && "text-ink ring-ink/30")}
              aria-pressed={details}
              onClick={() => setDetails((d) => !d)}
              title="Net satış, POS komisyonu, toplam maliyet, net ciro ve fire"
            >
              <SlidersHorizontal size={16} />
              {details ? "Sade görünüm" : "Tüm sütunlar"}
            </Button>
            <Button
              variant="secondary"
              onClick={exportCsv}
              disabled={!filtered.length}
              aria-label="Görünen listeyi CSV indir"
              title="Görünen listeyi CSV olarak indir"
            >
              <Download size={16} />
              CSV
            </Button>
            <ButtonLink href={bulk} variant="secondary" title={bulkTitle}>
              <Tags size={16} aria-hidden="true" />
              Toplu fiyat
            </ButtonLink>
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
        {/* Telefonda arama ve Süzgeç düğmesi tek satırı doldurur (sayaç alt satıra iner); genişte satırın öğeleri */}
        <div className="flex basis-full gap-2 sm:contents">
          <SearchField
            value={q}
            onChange={setQ}
            placeholder="Ürün ara"
            label="Ürün, boy, kategori ya da not ara"
            className="min-w-0 flex-1 sm:w-64 sm:flex-none max-sm:[&_input]:h-11"
          />
          <FilterSheetButton className="sm:hidden" count={summary.count} onClick={() => setSheet(true)} />
        </div>
        <FilterSummaryLine className="basis-full sm:hidden" text={summary.text} onClick={() => setSheet(true)} />
        {/* Geniş ekranda süzgeçler satırda; telefonda pencerede (aşağıda) */}
        <div className="contents max-sm:hidden">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Durum">
          {chips.map((s) => (
            <FilterChip key={s} active={statuses.includes(s)} onToggle={() => toggleStatus(s)} count={statusCounts.get(s) ?? 0}>
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[s], statuses.includes(s) && "ring-1 ring-white/70")} aria-hidden="true" />
              {s}
            </FilterChip>
          ))}
        </div>
        <Select
          value={category ?? ""}
          onChange={(e) => setKategori(e.target.value)}
          // Telefonda kategori ve boy yan yana (iki seçim alt alta yer kaplamasın)
          className={cn("w-[calc(58%-0.25rem)] sm:w-auto sm:min-w-48", category !== null && "ring-ink/40")}
          aria-label="Kategori"
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({categoryCounts.get(c.id) ?? 0})
            </option>
          ))}
        </Select>
        <Select
          value={size ?? ""}
          onChange={(e) => setBoy(e.target.value)}
          className={cn("w-[calc(42%-0.25rem)] sm:w-auto", size !== null && "ring-ink/40")}
          aria-label="Boy"
        >
          <option value="">Tüm boylar</option>
          {SIZES.map((x) => (
            <option key={x} value={x}>
              {SIZE_LABELS[x]} ({sizeCounts.get(x) ?? 0})
            </option>
          ))}
        </Select>
        {inactiveCount ? (
          <FilterChip active={showInactive} onToggle={() => setPasif(showInactive ? "" : "1")} count={inactiveCount}>
            Pasifleri de göster
          </FilterChip>
        ) : null}
        </div>
      </FilterBar>

      <FilterSheet
        open={sheet}
        onClose={() => setSheet(false)}
        onClear={clearSheet}
        canClear={summary.count > 0}
        shown={filtered.length}
        unit="ürün"
      >
        {/* Pencerede çipler iki sütunlu ızgarada, sayı sağda: sayılar değişince (ör. "Large" seçilince) satırlar
            kaymaz, art arda dokunuşlar hedeflenen çipe gelir */}
        <SheetSection title="Durum" aside={`Hedef ≤ %${num(target * 100)}`}>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Durum">
            {chips.map((s) => (
              <FilterChip
                key={s}
                active={statuses.includes(s)}
                onToggle={() => toggleStatus(s)}
                count={statusCounts.get(s) ?? 0}
                className={SHEET_CHIP}
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[s], statuses.includes(s) && "ring-1 ring-white/70")} aria-hidden="true" />
                  {s}
                </span>
              </FilterChip>
            ))}
          </div>
        </SheetSection>
        <SheetSection title="Kategori">
          <Select
            value={category ?? ""}
            onChange={(e) => setKategori(e.target.value)}
            className={cn("h-11 pointer-coarse:h-11", category !== null && "ring-ink/40")}
            aria-label="Kategori"
          >
            <option value="">Tüm kategoriler</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({categoryCounts.get(c.id) ?? 0})
              </option>
            ))}
          </Select>
        </SheetSection>
        <SheetSection title="Boy">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Boy">
            <FilterChip active={size === null} onToggle={() => setBoy("")} className={SHEET_CHIP}>
              Tüm boylar
            </FilterChip>
            {SIZES.map((x) => (
              <FilterChip
                key={x}
                active={size === x}
                onToggle={() => setBoy(size === x ? "" : x)}
                count={sizeCounts.get(x) ?? 0}
                className={SHEET_CHIP}
              >
                {SIZE_LABELS[x]}
              </FilterChip>
            ))}
          </div>
        </SheetSection>
        {inactiveCount ? (
          <SheetToggle
            title="Pasif ürünleri de göster"
            description={`${num(inactiveCount)} ürün menüde pasif`}
            checked={showInactive}
            onChange={(v) => setPasif(v ? "1" : "")}
            label="Pasif ürünleri de göster"
          />
        ) : null}
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
        <SheetSection title="Görünüm">
          <SheetToggle
            title="Tüm ölçüler"
            description="Kartlarda net satış, POS komisyonu, toplam maliyet, net ciro ve fire de görünür"
            checked={details}
            onChange={setDetails}
            label="Tüm ölçüleri göster"
          />
          <Button variant="secondary" className="h-11 w-full pointer-coarse:h-11" onClick={exportCsv} disabled={!filtered.length}>
            <Download size={16} /> Görünen listeyi CSV indir
          </Button>
          {/* Pencere gezinmeden önce kapanır (açık pencereyle sayfa değişmesin) */}
          <Button
            variant="secondary"
            className="h-11 w-full pointer-coarse:h-11"
            title={bulkTitle}
            onClick={() => {
              setSheet(false);
              router.push(bulk);
            }}
          >
            <Tags size={16} aria-hidden="true" /> Görünenlere toplu fiyat
          </Button>
        </SheetSection>
      </FilterSheet>

      {onlyInactiveMatch ? (
        <p className="mx-5 mb-3 rounded-xl bg-info-soft px-3.5 py-2 text-[13px] text-info" role="status">
          Aramanız yalnızca pasif ürünlerle eşleşti; pasifler de listeleniyor.
        </p>
      ) : null}

      {filtered.length ? (
        // data-page-top: sayfa değişince (telefonda uzun kart listesinin altındaki "Sonraki sayfa") buraya, yeni
        // sayfanın ilk ürününe kaydırılır (paylaşılan Pagination); kartın başlığı ve süzgeçleri değil
        <div data-page-top="">
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
                    {/* Hücredeki ikinci satır "boy · kategori": kategoriye göre de sıralanır */}
                    {subSort("category", "kategori")}
                  </TH>
                  {head("price", "Satış fiyatı", "KDV dahil menü fiyatı. Üzerine tıklayıp değiştirebilirsiniz; Enter ile kaydedilir.")}
                  {col("net") ? head("net", "Net satış", "Satış fiyatı ÷ (1 + KDV). Devlete ödenecek KDV çıktıktan sonra kasanıza kalan.") : null}
                  {col("commission") ? head("commission", "POS kom.", "Satış fiyatı × banka komisyonu × kartlı satış oranı. Nakitte komisyon yoktur.") : null}
                  {head("cost", "Maliyet", `Reçete kartındaki malzeme + ambalaj + fire payı (KDV hariç). ${RECIPE_COST_NOTE}`)}
                  {col("totalCost") ? head("totalCost", "Toplam maliyet", "Malzeme + ambalaj + POS komisyonu.") : null}
                  {head("unitProfit", "Birim kâr", "Net satış − toplam maliyet. Bir adet satınca kira/personel öncesi elinize kalan.")}
                  {head(
                    "costRatio",
                    "Maliyet oranı",
                    `Malzeme maliyeti ÷ net satış (food cost). Hedef ≤ %${num(target * 100)}. Altındaki durum: İyi = hedefin altında, Dikkat = hedefin 10 puan üstüne kadar, Düşük kâr = daha fazlası, Reçete yok = reçete kartı boş. "durum"a tıklayınca en kötüsü önce sıralanır.`,
                    subSort("status", "ve durum", true),
                  )}
                  {head("margin", "Kâr marjı", "Birim kâr ÷ net satış.")}
                  {head("suggestedPrice", "Önerilen fiyat", "Maliyetin hedef orana denk geldiği KDV dahil fiyat, 5 ₺'ye yuvarlanmış. Ok işareti: fiyatınız bunun altında.")}
                  {head("soldQty", "Adet", "Satış raporundan (ModPOS) ve laffogato.net online siparişlerinden bu ürünle eşleşen adet.", monthLabel)}
                  {head("monthProfit", "Brüt kâr", "Birim kâr × satış adedi. Reçetesi boş üründe hesaplanmaz (tire) ve toplama girmez.", monthLabel)}
                  {col("monthNet") ? head("monthNet", "Net ciro", "Net satış × satış adedi.", monthLabel) : null}
                  {col("fireRate") ? head("fireRate", "Fire", "Zayi / fire oranı. (özel) = reçete kartında bu ürüne özel oran; yoksa Ayarlar'daki genel oran.") : null}
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
                        <ProductName r={r} month={month} />
                      </TD>
                      <TD numeric>
                        <PriceCell key={`${r.id}:${r.price}`} row={r} />
                      </TD>
                      {col("net") ? <TD numeric>{tl(r.net, 2)}</TD> : null}
                      {col("commission") ? <TD numeric>{tl(r.commission, 2)}</TD> : null}
                      <TD numeric>{tl(r.cost, 2)}</TD>
                      {col("totalCost") ? <TD numeric>{tl(r.totalCost, 2)}</TD> : null}
                      <TD numeric className="font-medium">
                        {r.status === "Reçete yok" ? <span className="text-ink-quiet">–</span> : <Signed value={r.unitProfit}>{tl(r.unitProfit, 2)}</Signed>}
                      </TD>
                      {/* Durum maliyet oranından gelir: ikisi aynı hücrede, tablo dar ekranda da sığsın */}
                      <TD numeric>
                        <span className={cn("font-medium", ratioClass(r, target))}>{ratioText(r, r.costRatio)}</span>
                        <span className="mt-1 flex justify-end">
                          <StatusBadge status={r.status} />
                        </span>
                      </TD>
                      <TD numeric className="text-ink-soft">
                        {ratioText(r, r.margin)}
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
                      <TD numeric>
                        {r.soldQty && r.status !== "Reçete yok" ? (
                          <Signed value={r.monthProfit}>{tl(r.monthProfit)}</Signed>
                        ) : (
                          <span className="text-ink-quiet" title={r.soldQty ? "Reçete boş: kâr hesaplanmaz" : undefined}>
                            –
                          </span>
                        )}
                      </TD>
                      {col("monthNet") ? <TD numeric>{r.soldQty ? tl(r.monthNet) : <span className="text-ink-quiet">–</span>}</TD> : null}
                      {col("fireRate") ? (
                        <TD numeric>
                          {pct(r.fireRate, 1)}
                          {r.fireOverridden ? <span className="ml-1 text-xs text-ink-mute">(özel)</span> : null}
                        </TD>
                      ) : null}
                      <TD>
                        <div className="flex justify-end">
                          <IconLink href={productHref(r.id, month)} label={r.lineCount ? "Reçete kartını aç" : "Reçeteyi girin"}>
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
                  <TD colSpan={3 + Number(col("net")) + Number(col("commission")) + Number(col("totalCost"))} />
                  {/* Excel Ürün Kârlılık satır 134 "ORTALAMA": basit ortalama, her ürün bir oy */}
                  <TD numeric>
                    <span className="inline-flex items-center gap-1">
                      <InfoTip
                        text={`Görünen ürünlerin basit ortalaması (Excel Ürün Kârlılık, TOPLAM / ORTALAMA satırı). Reçetesi olmayan ürün katılmaz${
                          totals.avg.count !== filtered.length ? ` (${num(filtered.length - totals.avg.count)} ürün dışarıda)` : ""
                        }. Satışa göre ağırlıklı marj üstteki brüt kâr kartında.`}
                      />
                      <span className="text-xs font-normal text-ink-mute">ort.</span> {pct(totals.avg.costRatio)}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="text-xs font-normal text-ink-mute">ort.</span> {pct(totals.avg.margin)}
                  </TD>
                  <TD />
                  <TD numeric>{num(totals.qty)} adet</TD>
                  <TD numeric>
                    <Signed value={totals.profit}>{tl(totals.profit)}</Signed>
                    {totals.noRecipe ? <span className="block text-xs font-normal text-ink-mute">reçetesiz {num(totals.noRecipe)} hariç</span> : null}
                  </TD>
                  {col("monthNet") ? <TD numeric>{tl(totals.net)}</TD> : null}
                  <TD colSpan={1 + Number(col("fireRate"))} />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>

          {/* Telefon: her ürün bir kart. Karta dokunmak reçete kartını açar, fiyat yine yerinde değişir. Önce
              maliyet oranı ve durum (ekranın asıl sorusu), sonra kâr ve maliyet; geri kalanlar küçük satırda. */}
          <motion.ul
            key={`m|${paged.page}|${sira}`}
            initial={reduce || !interacted ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="mx-2 mb-2 divide-y divide-line-strong/70 sm:hidden"
            aria-label="Ürünler"
          >
            {paged.slice.map((r) => (
              <li
                key={r.id}
                className="relative rounded-2xl px-3 py-3.5 transition-colors has-[[data-card-link]:active]:bg-surface/70 [@media(hover:hover)]:has-[[data-card-link]:hover]:bg-surface/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <ProductName r={r} compact month={month} />
                  <PriceCell key={`${r.id}:${r.price}`} row={r} className="z-10 shrink-0" />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                  <Metric label="Maliyet oranı" className={cn("text-base font-semibold", ratioClass(r, target))}>
                    {ratioText(r, r.costRatio)}
                  </Metric>
                  <Metric label="Birim kâr" className="text-base font-semibold">
                    {r.status === "Reçete yok" ? <span className="text-ink-quiet">–</span> : <Signed value={r.unitProfit}>{tl(r.unitProfit, 2)}</Signed>}
                  </Metric>
                  <Metric label="Maliyet" className="text-base">
                    {tl(r.cost, 2)}
                  </Metric>
                  <Metric label="Kâr marjı">{ratioText(r, r.margin)}</Metric>
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
                    {r.soldQty && r.status !== "Reçete yok" ? (
                      <Signed value={r.monthProfit} className="block text-xs font-normal text-ink-mute">
                        {tl(r.monthProfit)} kâr
                      </Signed>
                    ) : null}
                  </Metric>
                  {col("net") ? <Metric label="Net satış">{tl(r.net, 2)}</Metric> : null}
                  {col("commission") ? <Metric label="POS kom.">{tl(r.commission, 2)}</Metric> : null}
                  {col("totalCost") ? <Metric label="Toplam maliyet">{tl(r.totalCost, 2)}</Metric> : null}
                  {col("monthNet") ? <Metric label="Net ciro">{r.soldQty ? tl(r.monthNet) : "–"}</Metric> : null}
                  {col("fireRate") ? (
                    <Metric label="Fire">
                      {pct(r.fireRate, 1)}
                      {r.fireOverridden ? <span className="ml-1 text-xs font-normal text-ink-mute">(özel)</span> : null}
                    </Metric>
                  ) : null}
                </dl>
                {!r.lineCount ? (
                  <Link
                    href={productHref(r.id, month)}
                    className="relative z-10 mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-info hover:underline"
                  >
                    <FilePlus2 size={15} aria-hidden="true" /> Reçeteyi girin
                  </Link>
                ) : null}
              </li>
            ))}
          </motion.ul>
          <div className="mx-5 mb-1 space-y-0.5 border-t border-line-strong pt-3 text-[13px] text-ink-mute sm:hidden">
            <p className="flex flex-wrap justify-between gap-x-3">
              <span>Görünen {num(filtered.length)} ürün</span>
              <span className="tabular">
                {monthLabel}: {num(totals.qty)} adet ·{" "}
                <Signed value={totals.profit} className="font-semibold text-ink">
                  {tl(totals.profit)}
                </Signed>{" "}
                brüt kâr{totals.noRecipe ? ` (reçetesiz ${num(totals.noRecipe)} hariç)` : ""}
              </span>
            </p>
            <p className="tabular">
              Ortalama maliyet oranı <span className="font-medium text-ink">{pct(totals.avg.costRatio)}</span> · kâr marjı{" "}
              <span className="font-medium text-ink">{pct(totals.avg.margin)}</span>
            </p>
          </div>

          {/* Sayfalama ve sayfa boyu (sayfa ?sayfa=2 ile adreste) */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-line pr-5">
            <Pagination
              page={paged.page}
              pageCount={paged.pageCount}
              onChange={onPage}
              unit="ürün"
              className="min-w-0 flex-1"
            />
            <label className="ml-auto inline-flex items-center gap-2 py-3 pl-5 text-[13px] text-ink-mute">
              Sayfada
              <Select
                value={goster}
                onChange={(e) => {
                  setInteracted(true);
                  setGoster(e.target.value);
                }}
                className="w-24 pointer-coarse:h-11"
                aria-label="Sayfada gösterilen ürün sayısı"
              >
                {PAGE_SIZES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>
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
            fireOverride: r.fireOverridden ? r.fireRate : null,
          }))}
          initialName={creating}
          initialCategory={category ?? undefined}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </Card>
  );
}
