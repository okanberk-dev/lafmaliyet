"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Box,
  CakeSlice,
  Calculator,
  Cherry,
  ClipboardList,
  Coffee,
  Cookie,
  Copy,
  CupSoda,
  Droplet,
  Droplets,
  IceCreamCone,
  Milk,
  Package,
  Plus,
  RotateCcw,
  Save,
  Sigma,
  StickyNote,
  Tag,
  Trash2,
  TrendingUp,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type MouseEvent } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { RangeSlider } from "@/components/akmanos/range-slider";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { fold } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, Label, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Gauge } from "@/components/ui/gauge";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, GrowthPill, InfoTip, KeyValue, Progress, Signed } from "@/components/ui/misc";
import { Segmented, SegmentedLinks } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { priceProduct } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings, Size } from "@/lib/calc/types";
import { PACKAGING_CATEGORY, RECIPE_PARAMS, SIZE_LABELS, SIZES } from "@/lib/constants";
import { monthLabel as monthTitle, num, pct, tl, tlUnit } from "@/lib/format";
import { monthLocativeTR } from "@/lib/reminders";
import { PRICE_PUSH_REMINDER } from "@/lib/site-menu/push";
import { cn } from "@/lib/utils";
import { createProduct, deleteProduct, saveRecipe } from "@/server/actions/products";

import { catOrder } from "../../hammaddeler/categories";
import {
  copiedSummary,
  copyDescription,
  firePct,
  fireText,
  LIST_QUERY_KEY,
  listHref,
  parseFireInput,
  productHref,
  qtyText,
  recipeSignature,
  resolveQty,
  sameRate,
} from "../logic";
import { priceText } from "../price-text";
import { SiteMenuCard, type ProductSiteInfo } from "./site-menu-card";

interface IngredientOption {
  id: number;
  name: string;
  unit: string;
  category: string;
  unitCost: number;
  vatRate: number;
  isEstimate: boolean;
  priceSource: string;
}

interface Row {
  key: number;
  ingredientId: number | null;
  input: string;
  note: string;
}

let keySeq = 1;

/** Listeye dönüş: listenin son süzgeçleri (oturumda saklanır) + kartta seçili ay */
function readListQuery(): string | null {
  try {
    return window.sessionStorage.getItem(LIST_QUERY_KEY);
  } catch {
    return null;
  }
}

/** Hammadde kategorisinin ikonu (Hammaddeler sayfasındaki kategoriler) */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  Kahve: Coffee,
  Süt: Milk,
  "Sos & Şurup": Droplet,
  Püre: Cherry,
  Toz: Wheat,
  Dondurma: IceCreamCone,
  Tatlı: CakeSlice,
  Atıştırmalık: Cookie,
  "Şişe İçecek": CupSoda,
  [PACKAGING_CATEGORY]: Package,
  Diğer: Box,
};

/**
 * Reçete satırının geniş düzeni (kart en az 36rem): malzeme · miktar · tutar · sıra · sil. Başlık, satırlar ve
 * toplam aynı ızgarayı kullanır, sütunlar alt alta hizalı kalır. Dar düzende (telefon) satır üç katlıdır:
 * malzeme + sil, büyük miktar alanı + tutar, sıra / not / formül düğmeleri (hepsi 44px); satır notu varsa altta
 * tam genişlikte.
 * Satır yukarı/aşağı taşınınca yaylı kayar, eklenince belirir, silinince söner.
 */
const LINE_GRID = "@xl:grid-cols-[minmax(0,1fr)_9rem_6.25rem_5.25rem_2.5rem]";

/** İlk/son satırdaki taşıma düğmesi: soluk, ama odaklanabilir kalır */
const edgeClass = "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:text-ink-mute pointer-coarse:size-11";

/** Dar düzenin satır altı düğmesi (Not, Formül): 44px yükseklik, metinli */
const rowToolClass =
  "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-mute ring-1 ring-line ring-inset hover:bg-surface hover:text-ink sm:h-9 pointer-coarse:h-11";

/** Sayfa açılışında kartların sırayla belirmesi; hareket azaltılmışsa anında görünür */
function rise(i: number, reduce: boolean | null) {
  return {
    initial: reduce ? (false as const) : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT, delay: i * 0.06 },
  };
}

/** Fiyat simülatörünün kaydırıcı aralığı: şimdiki ve önerilen fiyatın çevresi, 5 ₺'ye yuvarlı */
function sliderRange(price: number, suggested: number, trial: number | null) {
  const hi = Math.max(price, suggested, 1);
  const lo = Math.min(price > 0 ? price : hi, suggested > 0 ? suggested : hi);
  let min = Math.max(0, Math.floor((lo * 0.6) / 5) * 5);
  let max = Math.max(min + 5, Math.ceil((hi * 1.5) / 5) * 5);
  if (trial !== null && trial >= 0) {
    min = Math.min(min, Math.floor(trial));
    max = Math.max(max, Math.ceil(trial));
  }
  return { min, max };
}

/**
 * Zam kutusundaki aylık etki: "Bu zam ayda ≈ 1.240 ₺ kâr götürüyor (Eylül'de 310 adet). " Satış ayı standart aya
 * ölçeklendiyse (süren ay) adet "ayda" yazılır; satış verisi yoksa boş (price-loss.ts).
 */
function impactMonthText(pi: { monthly?: number | null; monthlyQty?: number | null; lossBasis?: { month: string; scale: number } | null; drivers: unknown[] }): string {
  const b = pi.lossBasis;
  if (!b || pi.monthly == null || pi.monthlyQty == null) return "";
  if (!(pi.monthlyQty > 0)) return `${monthLocativeTR(b.month)} satılmadı. `;
  if (pi.monthly < 1) return "";
  const qty = b.scale === 1 ? `${monthLocativeTR(b.month)} ${num(pi.monthlyQty)} adet` : `${monthTitle(b.month)} satışlarından ayda ≈ ${num(pi.monthlyQty)} adet`;
  return `${pi.drivers.length > 1 ? "Bu zamlar" : "Bu zam"} ayda ≈ ${tl(pi.monthly)} kâr götürüyor (${qty}). `;
}

type SideTab = "dokum" | "dene" | "satis";

export function RecipeEditor({
  product,
  items,
  categories,
  ingredients,
  settings,
  soldQty,
  month,
  months,
  monthLabel,
  history,
  siblings,
  water,
  priceImpact = null,
  site = null,
}: {
  product: {
    id: number;
    name: string;
    size: "M" | "L" | "Tek";
    categoryId: number;
    price: number;
    fireOverride: number | null;
    note: string | null;
    active: boolean;
    showOnMenu: boolean;
  };
  items: { ingredientId: number; qty: number; qtyExpr: string | null; note: string | null }[];
  categories: { id: number; name: string }[];
  ingredients: IngredientOption[];
  settings: Settings;
  soldQty: number;
  /** Kartın gösterdiği ay (listeden ?ay ile gelir) ve ay seçicideki aylar */
  month: string;
  months: string[];
  monthLabel: string;
  history: { month: string; label: string; qty: number }[];
  siblings: { id: number; size: string }[];
  /** Su + buz litre maliyeti ve nereden geldiği (water.reason metni) */
  water: { perLiter: number; costed: boolean; text: string; short: string };
  /** Son 30 günün hammadde zamları bu ürünün maliyetini artırdıysa (price-impact.ts) */
  priceImpact?: {
    costBefore: number;
    costAfter: number;
    ratioBefore: number;
    ratioAfter: number;
    suggestedPrice: number;
    basis: "target" | "keep";
    needsPrice: boolean;
    acknowledged: boolean;
    drivers: { name: string; pct: number }[];
    /** Zammın bu üründen ayda götürdüğü kâr ve ayda satılan adet (price-loss.ts); satış verisi yoksa null */
    monthly?: number | null;
    monthlyQty?: number | null;
    /** Aylık tutarın satış ayı ve standart aya ölçeği (1: ay olduğu gibi) */
    lossBasis?: { month: string; scale: number } | null;
  } | null;
  /** laffogato.net menü bağlantısı (docs/SITE-MENU.md); yoksa kart gösterilmez */
  site?: ProductSiteInfo | null;
}) {
  const router = useRouter();
  const reduce = useCalmMotion();
  /** Miktar alanının kimliği ve altındaki hata/uyarı metni için (satır anahtarı sunucuyla eşleşmez, sıra eşleşir) */
  const uid = useId();
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  // Kayıtlı satırların anahtarı sıradan gelir (-1, -2…; yeni satırlar artı): ay değişince ya da kayıttan sonra sunucu
  // aynı reçeteyi yeniden gönderdiğinde "Geri al" satırları baştan çizdirmez
  const initialRows = useMemo<Row[]>(
    () => items.map((it, i) => ({ key: -(i + 1), ingredientId: it.ingredientId, input: qtyText(it.qty, it.qtyExpr), note: it.note ?? "" })),
    [items],
  );
  // Kayıtlı reçetenin imzası, alandaki metinle aynı çözümleyiciden geçerek: "=ShotCift" / "ShotCift", "0.5" / "0,5"
  // kayıttan sonra "kaydedilmemiş" görünmez
  const savedSig = useMemo(
    () =>
      recipeSignature(
        items.map((it) => {
          const q = resolveQty(qtyText(it.qty, it.qtyExpr), settings);
          return { ingredientId: it.ingredientId, qty: q.qty, expr: q.expr, note: it.note };
        }),
      ),
    [items, settings],
  );

  const [name, setName] = useState(product.name);
  const [size, setSize] = useState(product.size);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [price, setPrice] = useState(priceText(product.price));
  const [fire, setFire] = useState(fireText(product.fireOverride));
  const [note, setNote] = useState(product.note ?? "");
  const [active, setActive] = useState(product.active);
  const [showOnMenu, setShowOnMenu] = useState(product.showOnMenu);
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [trial, setTrial] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("dokum");
  /** Yeni eklenen satırın malzeme seçimi odak alsın */
  const [newKey, setNewKey] = useState<number | null>(null);
  /** Notu boşken "Not" düğmesiyle açılmış satırlar */
  const [noteOpen, setNoteOpen] = useState<ReadonlySet<number>>(() => new Set());
  /**
   * Telefonda miktar alanı rakam klavyesiyle açılır; formül (2*ShotCift) yazmak için harfli klavye gerekir.
   * Formüllü satırlar kendiliğinden, "Formül" düğmesine basılan satırlar da harfli klavyeyle açılır.
   */
  const [textKeys, setTextKeys] = useState<ReadonlySet<number>>(() => new Set());

  const priceNum = parseNumberTR(price) ?? 0;
  const fireInput = parseFireInput(fire);
  // Okunamayan fire metni önizlemede genel oranla hesaplanır; kayıt hata gösterip durur (sessizce %0 olmaz)
  const fireNum = fireInput.error ? null : fireInput.rate;

  const lines = rows.map((r) => {
    const ing = r.ingredientId ? ingById.get(r.ingredientId) : undefined;
    const q = resolveQty(r.input, settings);
    const unitCost = ing?.unitCost ?? 0;
    return {
      row: r,
      ing,
      ...q,
      unitCost,
      vatRate: ing?.vatRate ?? 0,
      total: q.qty * unitCost,
      totalVat: q.qty * unitCost * (1 + (ing?.vatRate ?? 0)),
      isPackaging: ing?.category === PACKAGING_CATEGORY,
    };
  });
  const econ = priceProduct({ price: priceNum, fireOverride: fireNum }, lines, settings);
  const trialPrice = parseNumberTR(trial);
  const trialEcon = trialPrice !== null ? priceProduct({ price: trialPrice, fireOverride: fireNum }, lines, settings) : null;

  // Kaydedilecek değerler karşılaştırılır (yazılan metin değil): baştaki/sondaki boşluk, "0.5" ↔ "0,5" ve
  // "=ShotCift" ↔ "ShotCift" değişiklik sayılmaz
  const dirty =
    name.trim() !== product.name ||
    size !== product.size ||
    categoryId !== product.categoryId ||
    Math.abs(priceNum - product.price) > 0.001 ||
    !!fireInput.error ||
    !sameRate(fireInput.rate, product.fireOverride) ||
    note.trim() !== (product.note ?? "") ||
    active !== product.active ||
    showOnMenu !== product.showOnMenu ||
    recipeSignature(lines.map((l) => ({ ingredientId: l.row.ingredientId, qty: l.qty, expr: l.expr, note: l.row.note }))) !== savedSig;

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (idx: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = idx + d;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  function addRow() {
    const key = keySeq++;
    setRows((rs) => [...rs, { key, ingredientId: null, input: "", note: "" }]);
    setNewKey(key);
  }
  /** Satırı çıkarır; kaydedilene kadar bildirimdeki "Geri al" ile aynı yerine döner */
  function removeRow(key: number) {
    const idx = rows.findIndex((r) => r.key === key);
    if (idx < 0) return;
    const row = rows[idx];
    setRows((rs) => rs.filter((r) => r.key !== key));
    const ingName = row.ingredientId ? ingById.get(row.ingredientId)?.name : null;
    if (ingName)
      toast(`${ingName} çıkarıldı`, {
        description: "Kaydedince reçeteden silinir.",
        action: {
          label: "Geri al",
          onClick: () => setRows((rs) => (rs.some((r) => r.key === row.key) ? rs : [...rs.slice(0, idx), row, ...rs.slice(idx)])),
        },
      });
  }

  function reset() {
    setName(product.name);
    setSize(product.size);
    setCategoryId(product.categoryId);
    setPrice(priceText(product.price));
    setFire(fireText(product.fireOverride));
    setNote(product.note ?? "");
    setActive(product.active);
    setShowOnMenu(product.showOnMenu);
    setRows(initialRows);
    setNoteOpen(new Set());
    setTextKeys(new Set());
  }

  /**
   * "Formül": satırın miktar alanını harfli klavyeyle yeniden odaklar. Klavye türü odakta değişmez: inputMode
   * çizimi beklemeden alana yazılır, alan bırakılıp yeniden odaklanır. Hepsi dokunuşun içinde, eşzamanlı (iOS
   * klavyeyi yalnızca kullanıcı hareketi içindeki focus() ile açar). Eski sayı seçili gelir: yazılan formül onun
   * yerine geçer ("2*ShotCift150" olmaz).
   */
  function formulaKeyboard(key: number, idx: number) {
    setTextKeys((s) => new Set(s).add(key));
    const el = document.getElementById(`${uid}-qty${idx}`) as HTMLInputElement | null;
    if (!el) return;
    el.inputMode = "text";
    el.blur();
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }

  async function save() {
    if (saving) return;
    if (!name.trim()) return toast.error("Ürün adını girin");
    const badIdx = lines.findIndex((l) => l.error);
    if (badIdx >= 0) {
      const bad = lines[badIdx];
      document.getElementById(`${uid}-qty${badIdx}`)?.focus();
      return toast.error(`${badIdx + 1}. satır${bad.ing ? ` (${bad.ing.name})` : ""}: ${bad.error}`);
    }
    if (lines.some((l) => !l.row.ingredientId)) return toast.error("Boş malzeme satırlarını doldurun ya da silin");
    if (parseNumberTR(price) === null || priceNum < 0) {
      document.getElementById("r-price")?.focus();
      return toast.error("Satış fiyatını girin (ör. 185 ya da 185,50)");
    }
    if (fireInput.error) {
      document.getElementById("r-fire")?.focus();
      return toast.error(`Zayi / fire: ${fireInput.error}`);
    }
    // Kayıttan sonra alanlar kaydedilen biçime getirilir ("0.125" → "0,125", "=ShotCift" → "ShotCift"),
    // ama yalnızca kayıt sürerken değiştirilmemişse
    const sent = {
      name,
      note,
      price,
      fire,
      active,
      showOnMenu,
      rows: new Map(lines.map((l) => [l.row.key, { input: l.row.input, note: l.row.note, to: qtyText(l.qty, l.expr) }])),
    };
    setSaving(true);
    const res = await saveRecipe({
      productId: product.id,
      name: name.trim(),
      size,
      categoryId,
      price: priceNum,
      fireOverride: fireInput.rate,
      note,
      active,
      showOnMenu,
      items: lines.map((l) => ({ ingredientId: l.row.ingredientId!, qty: l.qty, qtyExpr: l.expr, note: l.row.note })),
    });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    // Siteye bağlı üründe yazılan değerler sitenin yanıtından: fiyat kuruşa yuvarlı, "Tükendi" QR menüden kaldırır
    const saved = res.data;
    setName((v) => (v === sent.name ? v.trim() : v));
    setNote((v) => (v === sent.note ? v.trim() : v));
    setPrice((v) => (v === sent.price ? priceText(saved.price) : v));
    setFire((v) => (v === sent.fire ? fireText(fireInput.rate) : v));
    setActive((v) => (v === sent.active ? saved.active : v));
    setShowOnMenu((v) => (v === sent.showOnMenu ? saved.showOnMenu : v));
    setRows((rs) =>
      rs.map((r) => {
        const s = sent.rows.get(r.key);
        return s && s.input === r.input && s.note === r.note ? { ...r, input: s.to, note: r.note.trim() } : r;
      }),
    );
    // Sitenin kuralıyla kendiliğinden değişen anahtarlar söylenir (Tükendi QR menüyü kapatır, Satışta ikisini açar)
    const forced = [
      saved.showOnMenu !== sent.showOnMenu ? `QR menüde göster de ${saved.showOnMenu ? "açıldı" : "kapandı"}` : null,
      saved.active !== sent.active ? `Menüde aktif de ${saved.active ? "açıldı" : "kapandı"}` : null,
    ].filter(Boolean);
    const siteNote = saved.site
      ? [
          saved.site.price ? PRICE_PUSH_REMINDER : null,
          saved.site.visibility ? `Sitede ${saved.active && saved.showOnMenu ? "Satışta" : "Tükendi"} oldu.` : null,
          forced.length ? `${forced.join(", ")} (sitede ${saved.active && saved.showOnMenu ? "Satışta" : "Tükendi"}; iki yer aynı kalsın diye).` : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;
    toast.success(`${name.trim()} kaydedildi`, {
      description: `${lines.length} malzeme · maliyet ${tl(econ.cost, 2)} · satış ${tl(saved.price, 2)}${
        fireInput.rate !== null ? ` · özel fire ${firePct(fireInput.rate)}` : ""
      }${siteNote ? `. ${siteNote}` : ""}`,
      ...(siteNote ? { duration: 12_000 } : {}),
    });
  }

  /** Siteye bağlanınca ürün sitenin fiyatını ve menü durumunu aldı: alanlar ona getirilir (kart kaydedilmişti) */
  function adopt(values: { price: number; active: boolean; showOnMenu: boolean }) {
    setPrice(priceText(values.price));
    setActive(values.active);
    setShowOnMenu(values.showOnMenu);
  }

  // ⌘S / Ctrl+S kaydeder; kaydedilmemiş değişiklik varken sayfadan çıkmadan önce tarayıcı sorar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "s" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      e.preventDefault();
      if (dirty) void save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);
  // beforeunload yalnızca yenileme / sekme kapatmayı kapsar: panel içi bağlantıda (← Ürünler, boylar, menü) önce sorulur
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: globalThis.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveHref(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  async function remove() {
    setDeleting(true);
    const res = await deleteProduct(product.id);
    setDeleting(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${product.name} · ${product.size} silindi`);
    router.push(listHref(readListQuery(), month));
  }

  /** "← Ürünler": listenin son süzgeçlerine döner (yoksa düz bağlantı, kartın ayıyla) */
  function backToList(e: MouseEvent<HTMLAnchorElement>) {
    const saved = readListQuery();
    if (saved === null || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    router.push(listHref(saved, month));
  }

  const grouped = useMemo(() => {
    const m = new Map<string, IngredientOption[]>();
    for (const i of ingredients) {
      const list = m.get(i.category) ?? [];
      list.push(i);
      m.set(i.category, list);
    }
    // Gruplar Hammaddeler sayfasındaki kategori sırasıyla (Kahve, Süt… Ambalaj), içleri A → Z
    return [...m.entries()]
      .sort(([a], [b]) => catOrder(a) - catOrder(b) || a.localeCompare(b, "tr"))
      .map(([cat, list]) => [cat, list.sort((a, b) => a.name.localeCompare(b.name, "tr"))] as const);
  }, [ingredients]);

  const noRecipe = econ.status === "Reçete yok";
  // Fiyatı 0 olan reçeteli ürün: oran %0 çıkar ama zararına satılır (durum "Düşük kâr"); gösterge yeşil olmasın
  const noPrice = !noRecipe && !(econ.net > 0);
  const gaugeTone =
    noPrice ? "bad" : econ.costRatio <= settings.hedefMaliyet ? "brand" : econ.costRatio <= settings.hedefMaliyet + 0.1 ? "warn" : "bad";
  const trialDiff = trialEcon ? trialEcon.unitProfit - econ.unitProfit : 0;
  const plus = (v: number) => (v >= 0 ? "+" : "");
  const maxSold = Math.max(1, ...history.map((h) => h.qty));
  const totalSold = history.reduce((a, h) => a + h.qty, 0);
  const soldMonths = history.filter((h) => h.qty > 0).length;
  const categoryName = categories.find((c) => c.id === product.categoryId)?.name;
  const range = sliderRange(priceNum, econ.suggestedPrice, trialPrice);

  const sideTabs: { value: SideTab; label: string }[] = [
    { value: "dokum", label: "Döküm" },
    { value: "dene", label: "Fiyat dene" },
    ...(history.length ? [{ value: "satis" as const, label: "Satışlar" }] : []),
  ];

  const rowTransition = reduce ? { duration: 0 } : { layout: SPRING_SWAP, default: { duration: 0.18, ease: EASE_OUT } };

  return (
    <div className="pb-28">
      <PageHeader
        eyebrow="Menü"
        excel="Reçete Kartları"
        title={`${product.name} – ${SIZE_LABELS[product.size]}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {categoryName}
            {/* Geniş ekranda durum, sağdaki özet kartının başında */}
            <span className="inline-flex lg:hidden">
              <StatusBadge status={econ.status} />
            </span>
            {!product.active ? <Badge tone="gray">Pasif</Badge> : null}
          </span>
        }
        actions={
          <>
            {/* Telefonda yalnızca ikonlar: geri, ay ve kopyala tek satıra sığsın */}
            <ButtonLink
              href={listHref(null, month)}
              onClick={backToList}
              variant="ghost"
              size="sm"
              aria-label="Ürünler listesine dön"
              className="pointer-coarse:h-11 max-sm:size-11 max-sm:px-0"
            >
              <ArrowLeft size={16} aria-hidden="true" /> <span className="max-sm:sr-only">Ürünler</span>
            </ButtonLink>
            {/* Kartın "satılan adet" ve "kalan kâr" satırları bu ayın; listeden gelen ay seçili */}
            {months.length > 1 ? <MonthPicker months={months} value={month} /> : null}
            <Button
              variant="secondary"
              onClick={() => setCopyOpen(true)}
              aria-label="Kopyala"
              className="pointer-coarse:h-11 max-sm:size-11 max-sm:px-0"
              title="Reçetesi, fire oranı ve notuyla birlikte yeni ürün ya da boy oluştur"
            >
              <Copy size={16} aria-hidden="true" /> <span className="max-sm:sr-only">Kopyala</span>
            </Button>
          </>
        }
        tabs={
          siblings.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] text-ink-mute">Boylar</span>
              <SegmentedLinks
                label="Boylar"
                className="[&_a]:min-w-11 [&_a]:justify-center"
                value={String(product.id)}
                options={siblings.map((s) => ({ value: String(s.id), label: s.size, href: productHref(s.id, month) }))}
              />
            </div>
          ) : undefined
        }
      />

      {priceImpact ? (
        <div
          role="status"
          className={cn(
            "mb-4 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm",
            priceImpact.needsPrice && !priceImpact.acknowledged ? "bg-warn-soft text-warn" : "bg-info-soft text-info",
          )}
        >
          <TrendingUp size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words">
            <span className="font-semibold">Hammadde zammı:</span> son 30 günde{" "}
            {priceImpact.drivers
              .slice(0, 3)
              .map((d) => `${d.name} +${pct(d.pct, 0)}`)
              .join(", ")}
            ; maliyet <span className="tabular">{tl(priceImpact.costBefore, 2)} → {tl(priceImpact.costAfter, 2)}</span>, maliyet oranı{" "}
            <span className="tabular">
              {pct(priceImpact.ratioBefore, 0)} → {pct(priceImpact.ratioAfter, 0)}
            </span>
            .{" "}
            {impactMonthText(priceImpact)}
            {priceImpact.needsPrice
              ? priceImpact.acknowledged
                ? "Fiyatı korumayı seçtiniz."
                : priceImpact.basis === "keep"
                  ? `Zammın payı kadar önerilen fiyat ${tl(priceImpact.suggestedPrice)} (eski maliyet oranını korur); fiyat alanından değiştirebilirsiniz.`
                  : `Hedef maliyet oranı için önerilen fiyat ${tl(priceImpact.suggestedPrice)}; fiyat alanından değiştirebilirsiniz.`
              : "Maliyet oranı hâlâ hedefte."}{" "}
            <Link href="/panel/urunler#zamlar" className="font-medium underline-offset-2 hover:underline">
              Bütün zamlar →
            </Link>
          </p>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* Reçete satırları. Kart bir kap (container): dar alanda (telefon, kenar çubuklu masaüstü) her satır iki
              katlı, genişte tek satır ve sütun başlıkları. Yatay kaydırma yok; miktar, tutar ve sil hep görünür. */}
          <motion.div {...rise(1, reduce)}>
            <Card className="@container">
              <CardHeader
                icon={<ClipboardList />}
                title="Malzemeler"
                description={
                  <>
                    Miktar sayı ya da Ayarlar&apos;a bağlı formül olabilir (ör.{" "}
                    <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-info ring-1 ring-line">2*ShotCift</code>).{" "}
                    {/* Telefonun rakam klavyesinde harf ve Enter yok: dar düzende satırdaki "Formül" düğmesi harfli klavyeyi açar */}
                    <span className="pointer-coarse:hidden @xl:pointer-coarse:inline">Miktarda Enter sonraki satıra geçer.</span>
                    <span className="hidden pointer-coarse:inline @xl:pointer-coarse:hidden">Harf ve * için satırdaki “Formül” düğmesine dokunun.</span>
                  </>
                }
                meta={
                  lines.length ? (
                    <span className="tabular">
                      {lines.length} malzeme · {tl(econ.ingredientTotal, 2)}
                    </span>
                  ) : null
                }
                actions={
                  lines.length ? (
                    <Button size="sm" variant="secondary" onClick={addRow} className="pointer-coarse:h-11">
                      <Plus size={15} /> Malzeme ekle
                    </Button>
                  ) : null
                }
              />
              {lines.length ? (
                <div className="px-2 pb-2">
                  <div className={cn(LINE_GRID, "hidden gap-x-3 border-b border-line-strong px-3 pt-1 pb-3 text-sm font-semibold text-ink @xl:grid")}>
                    <span>Malzeme</span>
                    <span className="inline-flex items-center gap-1">
                      Miktar
                      <InfoTip text="Malzemenin birimiyle (gr, ml, adet). Formül de yazılabilir: 2*ShotCift ya da =ShotCift. Ondalık için virgül (0,125) ya da nokta (0.125) yazılır; noktalı sayının nasıl okunduğu alanın altında görünür." />
                    </span>
                    <span className="inline-flex items-center justify-end gap-1">
                      Tutar
                      <InfoTip text="Miktar × birim maliyet (KDV hariç). Birim maliyet Hammaddeler sayfasından gelir; altında KDV dahil tutar." />
                    </span>
                  </div>
                  <ul aria-label="Reçete malzemeleri">
                    <AnimatePresence initial={false}>
                      {lines.map((l, idx) => {
                        const hintId = `${uid}-q${idx}`;
                        return (
                          <motion.li
                            key={l.row.key}
                            layout={reduce ? false : "position"}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={rowTransition}
                            className={cn(
                              "grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-2.5 border-b border-line-strong/70 px-3 py-3.5 transition-colors hover:bg-surface/60 @xl:py-3",
                              LINE_GRID,
                            )}
                          >
                            {/* Malzeme: dar düzende üst katın tamamı (sil düğmesi yanında). Dar ızgara üç sütun: miktar ·
                                tutar · sil; malzeme ilk ikisini, tutar son ikisini kaplar (seçim kutusu tutar kadar geniş) */}
                            <div className="col-span-2 col-start-1 row-start-1 flex min-w-0 items-start gap-3 @xl:col-span-1 @xl:col-start-1">
                              {/* Orta genişlikte karo gizlenir, malzeme seçimine yer kalsın */}
                              <IngredientTile ing={l.ing} className="max-[380px]:hidden @xl:hidden @3xl:inline-flex" />
                              <div className="min-w-0 flex-1">
                                <Select
                                  value={l.row.ingredientId ?? ""}
                                  onChange={(e) => update(l.row.key, { ingredientId: e.target.value ? Number(e.target.value) : null })}
                                  data-warn={!l.row.ingredientId ? "true" : undefined}
                                  aria-label={`${idx + 1}. satır malzemesi`}
                                  autoFocus={l.row.key === newKey}
                                  className="h-11 font-medium pointer-coarse:h-11 sm:h-9 sm:font-normal @xl:pointer-coarse:h-11"
                                >
                                  <option value="">Malzeme seçin…</option>
                                  {grouped.map(([cat, list]) => (
                                    <optgroup key={cat} label={cat}>
                                      {list.map((i) => (
                                        <option key={i.id} value={i.id}>
                                          {i.name}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </Select>
                                {l.ing ? (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-mute">
                                    {l.ing.isEstimate ? (
                                      <Badge tone="amber" dot>
                                        Tahmini fiyat
                                      </Badge>
                                    ) : null}
                                    {l.ing.priceSource === "water" ? (
                                      water.costed ? (
                                        <Badge tone="blue" title={water.text}>
                                          Su faturası ({tl(water.perLiter, 2)}/L)
                                        </Badge>
                                      ) : (
                                        <span className="inline-flex items-center gap-1">
                                          <Badge tone="amber" dot>
                                            {water.short}
                                          </Badge>
                                          <InfoTip text={`${water.text}.`} />
                                        </span>
                                      )
                                    ) : null}
                                    {l.isPackaging ? <Badge tone="gray">Ambalaj</Badge> : null}
                                    <span className="tabular" title="Birim maliyet (KDV hariç) ve alış KDV oranı">
                                      {tlUnit(l.unitCost)}/{l.ing.unit} · KDV {pct(l.vatRate, 0)}
                                    </span>
                                    {soldQty ? (
                                      <span className="tabular" title="Miktar × bu ayın satış adedi (fire hariç). Tutarlılık kontrolünde faturayla karşılaştırılır.">
                                        {monthLabel}: {num(l.qty * soldQty, 0)} {l.ing.unit}
                                      </span>
                                    ) : null}
                                    {/* Geniş düzende "Not" burada; dar düzende satırın altındaki düğmelerde */}
                                    {!l.row.note && !noteOpen.has(l.row.key) ? (
                                      <button
                                        type="button"
                                        onClick={() => setNoteOpen((s) => new Set(s).add(l.row.key))}
                                        className="hidden cursor-pointer items-center gap-1 rounded-md text-ink-mute hover:text-ink hover:underline pointer-coarse:-my-2 pointer-coarse:py-2 @xl:inline-flex"
                                        title="Bu satıra not ekle (ör. yalnızca sıcak servis)"
                                      >
                                        <StickyNote size={12} aria-hidden="true" /> Not
                                      </button>
                                    ) : null}
                                  </div>
                                ) : (
                                  <p className="mt-1.5 text-xs text-warn">Listeden bir malzeme seçin ya da satırı silin.</p>
                                )}
                              </div>
                            </div>

                            {/* Miktar: dar düzende büyük alan (48px, 18px yazı), genişte sütunda */}
                            <div className="col-start-1 row-start-2 min-w-0 @xl:col-start-2 @xl:row-start-1">
                              <div className="flex items-center gap-2 @xl:gap-1.5">
                                <Input
                                  id={`${uid}-qty${idx}`}
                                  value={l.row.input}
                                  onChange={(e) => update(l.row.key, { input: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key !== "Enter") return;
                                    e.preventDefault();
                                    if (idx < lines.length - 1) document.getElementById(`${uid}-qty${idx + 1}`)?.focus();
                                    else addRow();
                                  }}
                                  // Formül (DondurmaTop, 2*ShotCift) sola yaslı ve eşaralıklı yazılır, tamamı görünsün
                                  className={cn(
                                    "cell-input h-12 min-w-0 flex-1 text-right text-lg font-semibold tabular pointer-coarse:h-12 pointer-coarse:text-lg sm:text-sm @xl:h-9 @xl:font-normal @xl:pointer-coarse:h-11 @xl:pointer-coarse:text-base",
                                    l.expr && "px-3 text-left font-mono text-base sm:text-[13px] @xl:px-2 pointer-coarse:text-base",
                                  )}
                                  title={l.expr ?? undefined}
                                  aria-label={`${idx + 1}. satır miktarı${l.ing ? ` (${l.ing.unit})` : ""}`}
                                  aria-invalid={l.error ? true : undefined}
                                  aria-describedby={l.error || l.expr || l.echo || (l.qty === 0 && l.row.ingredientId) ? hintId : undefined}
                                  data-warn={!l.error && l.qty === 0 && l.row.ingredientId ? "true" : undefined}
                                  placeholder="0"
                                  // Rakam klavyesi; formülde (ya da "Formül" düğmesinden sonra) harfli klavye
                                  inputMode={l.expr || textKeys.has(l.row.key) ? "text" : "decimal"}
                                  enterKeyHint={idx < lines.length - 1 ? "next" : "done"}
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                                {/* Birim sabit genişlikte (gr, ml, adet, dilim): miktar alanları satırdan satıra aynı genişlikte */}
                                <span className="w-9 shrink-0 text-sm text-ink-mute @xl:w-7 @xl:min-w-6 @xl:text-xs">{l.ing?.unit}</span>
                              </div>
                              {l.error ? (
                                <p id={hintId} className="mt-1 text-xs text-bad @xl:max-w-40">
                                  {l.error}
                                </p>
                              ) : l.expr ? (
                                <p id={hintId} className="mt-1 text-xs text-ink-mute tabular">
                                  = {num(l.qty, 2)} {l.ing?.unit}
                                </p>
                              ) : l.echo ? (
                                // Nokta ondalık mı bin ayıracı mı: nasıl okunduğu görünsün ("0.125" → 0,125; "1.250" → 1250)
                                <p id={hintId} className="mt-1 text-xs text-ink-mute tabular" title="Noktalı sayının okunuşu. Ondalık için virgül yazabilirsiniz (0,125).">
                                  = {l.echo} {l.ing?.unit}
                                </p>
                              ) : l.qty === 0 && l.row.ingredientId ? (
                                <p id={hintId} className="mt-1 text-xs text-warn @xl:max-w-40">
                                  Miktar girilmedi (0 sayılıyor)
                                </p>
                              ) : null}
                            </div>

                            {/* Tutar (KDV hariç), altında KDV dahil. Dar düzende en az "KDV dahil 999,99 ₺" genişliğinde:
                                tutarın basamak sayısı miktar alanının genişliğini satırdan satıra değiştirmez. (En az
                                genişlik içteki satırda: globals.css ızgara öğelerine min-width: 0 verir.) */}
                            <div className="col-span-2 col-start-2 row-start-2 pt-1.5 text-right text-sm tabular @xl:col-span-1 @xl:col-start-3 @xl:row-start-1 @xl:pt-2">
                              <span className="text-base font-semibold text-ink @xl:text-sm @xl:font-medium">{tl(l.total, 2)}</span>
                              <div className="mt-0.5 min-w-[6.75rem] text-xs whitespace-nowrap text-ink-mute @xl:min-w-0">KDV dahil {tl(l.totalVat, 2)}</div>
                            </div>

                            {/* Sıra (ve dar düzende Not / Formül): uçta aria-disabled (disabled değil), klavyeyle taşınan
                                satırın düğmesi odağı kaybetmesin */}
                            <div className="col-span-3 col-start-1 row-start-3 flex flex-wrap items-center gap-1.5 @xl:col-span-1 @xl:col-start-4 @xl:row-start-1 @xl:flex-nowrap @xl:justify-end @xl:gap-1">
                              <IconButton
                                label="Yukarı taşı"
                                aria-disabled={idx === 0 || undefined}
                                className={cn(edgeClass, "max-sm:size-11")}
                                onClick={() => move(idx, -1)}
                              >
                                <ArrowUp size={15} />
                              </IconButton>
                              <IconButton
                                label="Aşağı taşı"
                                aria-disabled={idx === lines.length - 1 || undefined}
                                className={cn(edgeClass, "max-sm:size-11")}
                                onClick={() => move(idx, 1)}
                              >
                                <ArrowDown size={15} />
                              </IconButton>
                              {l.ing && !l.row.note && !noteOpen.has(l.row.key) ? (
                                <button
                                  type="button"
                                  onClick={() => setNoteOpen((s) => new Set(s).add(l.row.key))}
                                  className={cn(rowToolClass, "@xl:hidden")}
                                  title="Bu satıra not ekle (ör. yalnızca sıcak servis)"
                                >
                                  <StickyNote size={14} aria-hidden="true" /> Not
                                </button>
                              ) : null}
                              {/* Yalnızca dokunmatikte: rakam klavyesinde harf ve * yok */}
                              {!l.expr && !textKeys.has(l.row.key) ? (
                                <button
                                  type="button"
                                  onClick={() => formulaKeyboard(l.row.key, idx)}
                                  className={cn(rowToolClass, "hidden pointer-coarse:inline-flex @xl:pointer-coarse:hidden")}
                                  title="Miktara formül yazın (ör. 2*ShotCift): harfli klavye açılır"
                                >
                                  <Sigma size={14} aria-hidden="true" /> Formül
                                </button>
                              ) : null}
                            </div>

                            {/* Sil: dar düzende malzemenin yanında, genişte satır sonunda */}
                            <div className="col-start-3 row-start-1 flex justify-end @xl:col-start-5">
                              <IconButton
                                label={`${l.ing?.name ?? "Boş"} satırını sil`}
                                tone="danger"
                                className="pointer-coarse:size-11 max-sm:size-11"
                                onClick={() => removeRow(l.row.key)}
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            </div>

                            {/* Satır notu (Excel'deki hücre notu): varsa hep görünür, yoksa "Not" ile açılır. Dar düzende
                                satırın tam genişliğinde, "Not" düğmesinin hemen altında; genişte malzeme sütununda,
                                seçim kutusunun altında (karo görünürken onunla hizalı) */}
                            {l.row.note || noteOpen.has(l.row.key) ? (
                              <div className="col-span-3 col-start-1 row-start-4 min-w-0 @xl:col-span-1 @xl:col-start-1 @xl:row-start-2 @3xl:pl-12">
                                <div className="relative">
                                  <StickyNote size={13} className="pointer-events-none absolute top-3 left-2.5 text-ink-quiet sm:top-2.5" aria-hidden="true" />
                                  {/* Not uzunsa alan yazıyla birlikte uzar (tek satırda kesilmesin); telefonda 16px yazı */}
                                  <Textarea
                                    rows={1}
                                    value={l.row.note}
                                    onChange={(e) => update(l.row.key, { note: e.target.value })}
                                    onBlur={() => {
                                      if (l.row.note.trim()) return;
                                      setNoteOpen((s) => {
                                        const n = new Set(s);
                                        n.delete(l.row.key);
                                        return n;
                                      });
                                    }}
                                    autoFocus={!l.row.note && noteOpen.has(l.row.key)}
                                    maxLength={300}
                                    placeholder="Satır notu (ör. yalnızca sıcak serviste)"
                                    aria-label={`${idx + 1}. satır notu`}
                                    className="field-sizing-content min-h-11 resize-none py-2.5 pl-8 leading-5 sm:min-h-8 sm:py-1.5 sm:text-[13px] pointer-coarse:text-base"
                                  />
                                </div>
                              </div>
                            ) : null}
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                  <button
                    type="button"
                    onClick={addRow}
                    className="mx-1 mt-2 flex min-h-11 w-[calc(100%-0.5rem)] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[13px] font-medium text-ink-mute transition-colors hover:border-ink/30 hover:bg-surface/60 hover:text-ink"
                  >
                    <Plus size={15} aria-hidden="true" /> Malzeme ekle
                  </button>
                  <div className={cn("mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3 text-sm font-semibold text-ink", LINE_GRID)}>
                    <span className="@xl:col-span-2 @xl:text-right">Toplam</span>
                    <span className="text-right tabular @xl:col-start-3">
                      {tl(econ.ingredientTotal, 2)}
                      <span className="mt-0.5 block text-xs font-normal text-ink-mute">KDV dahil {tl(econ.totalVatIncl, 2)}</span>
                    </span>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<ClipboardList />}
                  title="Henüz malzeme yok"
                  description="Reçetedeki malzemeleri tek tek ekleyin; maliyet, kâr ve önerilen fiyat siz yazdıkça hesaplanır."
                  action={
                    <Button onClick={addRow}>
                      <Plus size={16} /> Malzeme ekle
                    </Button>
                  }
                />
              )}
              <CardFooter className="flex-col items-start justify-start gap-2.5 py-4">
                <p className="flex items-center gap-1.5 font-medium text-ink-soft">
                  Formülde kullanılabilecek ayarlar
                  <InfoTip text="Değerler Ayarlar sayfasından gelir. Ayar değişince bu reçete de güncellenir. Örnek: 2*ShotCift, ShotTek+5." />
                </p>
                <ul className="flex flex-wrap gap-1.5" aria-label="Formül adları">
                  {RECIPE_PARAMS.map((p) => (
                    <li key={p.name} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pr-2.5 pl-1 text-xs ring-1 ring-line">
                      <code className="rounded-full bg-info-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-info">{p.name}</code>
                      <span className="text-ink-mute">
                        {p.label} · <span className="font-medium text-ink tabular">{num(Number(settings[p.key]), 0)}</span> {p.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardFooter>
            </Card>
          </motion.div>

          {/* Ürün bilgileri */}
          <motion.div {...rise(2, reduce)}>
            <Card>
              <CardHeader icon={<Tag />} title="Ürün bilgileri" />
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Ürün adı" htmlFor="r-name" error={name.trim() ? undefined : "Ürün adı boş olamaz"}>
                  <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-invalid={name.trim() ? undefined : true} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Boy" htmlFor="r-size">
                    <Select id="r-size" value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
                      {SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s} — {SIZE_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Kategori" htmlFor="r-cat">
                    <Select id="r-cat" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field
                  label="Not"
                  className="sm:col-span-2"
                  htmlFor="r-note"
                  hint="Reçete varsayımları, bardak boyu vb. Ürün listesinde adın yanında ⓘ olarak, reçete defterinde kartın altında görünür."
                >
                  <Textarea id="r-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
                </Field>
                <div className="flex flex-wrap gap-x-6 gap-y-1 sm:col-span-2">
                  <Switch checked={active} onChange={setActive} label="Menüde aktif" showText onText="Menüde aktif" offText="Menüde pasif" />
                  <Switch
                    checked={showOnMenu}
                    onChange={setShowOnMenu}
                    label="QR menüde göster"
                    showText
                    onText="QR menüde görünür"
                    offText="QR menüde gizli"
                  />
                </div>
              </CardContent>
              {/* Kalıcı silme nadir ve geri alınamaz: başlıkta değil, ürün bilgilerinin sonunda */}
              <CardFooter className="flex-wrap justify-between gap-2 py-3">
                <p className="text-[13px] text-ink-mute">Menüden kaldırmak için silmek yerine &apos;Menüde aktif&apos; anahtarını kapatın.</p>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-bad hover:bg-bad-soft hover:text-bad">
                  <Trash2 size={15} /> Ürünü sil
                </Button>
              </CardFooter>
            </Card>
          </motion.div>

          {/* laffogato.net menüsü: bağlıysa fiyat ve menü durumu kaydedilince önce siteye gider */}
          {site && (site.configured || site.link) ? (
            <motion.div {...rise(3, reduce)}>
              <SiteMenuCard
                product={{ id: product.id, name: product.name, size: product.size, price: product.price, active: product.active, showOnMenu: product.showOnMenu }}
                site={site}
                dirty={dirty}
                onAdopted={adopt}
              />
            </motion.div>
          ) : null}
        </div>

        {/* Özet: maliyet, fiyat, kâr. Telefonda en üstte (ekranın asıl cevabı), geniş ekranda sağda.
            Yalnızca yeterince uzun ekranda sabit: kart (~1000px, "Fiyat dene" açıkken) ekrandan uzunsa
            alt kısmı ("Bu fiyatı uygula") sayfa sonuna kadar görünmez kalırdı. */}
        <motion.aside
          {...rise(0, reduce)}
          className="order-first min-w-0 lg:top-6 lg:order-none lg:[@media(min-height:64rem)]:sticky"
        >
          <Card>
            <CardHeader
              icon={<Calculator />}
              title="Maliyet ve kâr"
              description="Değiştirdikçe anında hesaplanır"
              actions={
                <span className="hidden lg:inline-flex">
                  <StatusBadge status={econ.status} />
                </span>
              }
            />
            <CardContent className="space-y-4">
              <Well className="pt-5 pb-3">
                {/* Reçetesiz üründe oranlar anlamsız (malzeme maliyeti 0): listedeki gibi "–" */}
                <Gauge
                  value={noRecipe ? 0 : econ.costRatio}
                  target={settings.hedefMaliyet}
                  display={noRecipe || noPrice ? <span className="text-ink-quiet">–</span> : <AnimatedNumber value={econ.costRatio} format={(v) => pct(v)} />}
                  label={
                    noRecipe
                      ? "Maliyet oranı · malzeme ekleyince hesaplanır"
                      : noPrice
                        ? "Maliyet oranı · satış fiyatı girilince hesaplanır"
                        : `Maliyet oranı · hedef ≤ %${num(settings.hedefMaliyet * 100)}`
                  }
                  tone={gaugeTone}
                />
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
                  <div>
                    <p className="text-xs text-ink-mute">1 adet kâr</p>
                    {noRecipe ? (
                      <span className="block text-xl font-semibold tracking-tight text-ink-quiet">–</span>
                    ) : (
                      <Signed value={econ.unitProfit} className="block text-xl font-semibold tracking-tight">
                        <AnimatedNumber value={econ.unitProfit} format={(v) => tl(v, 2)} />
                      </Signed>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-ink-mute">Kâr marjı</p>
                    {noRecipe ? (
                      <span className="block text-xl font-semibold tracking-tight text-ink-quiet">–</span>
                    ) : (
                      <Signed value={econ.margin} className="block text-xl font-semibold tracking-tight text-ink">
                        <AnimatedNumber value={econ.margin} format={(v) => pct(v)} />
                      </Signed>
                    )}
                  </div>
                </div>
              </Well>

              {/* Telefonda alt alta (tek sütun form), genişte fiyat + dar fire sütunu */}
              <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
                <Field
                  label="Satış fiyatı (KDV dahil)"
                  htmlFor="r-price"
                  hint={
                    lines.length ? (
                      <span className="flex flex-wrap items-center gap-x-1.5">
                        Önerilen: <span className="font-medium text-ink-soft tabular">{tl(econ.suggestedPrice)}</span>
                        {econ.suggestedPrice > 0 && Math.abs(econ.suggestedPrice - priceNum) >= 0.5 ? (
                          <button
                            type="button"
                            onClick={() => setPrice(priceText(econ.suggestedPrice))}
                            title="Satış fiyatını önerilen fiyata ayarlar; Kaydet'e basınca geçerli olur"
                            className="cursor-pointer font-medium text-info hover:underline pointer-coarse:-my-3.5 pointer-coarse:px-1 pointer-coarse:py-3.5"
                          >
                            Uygula
                          </button>
                        ) : null}
                      </span>
                    ) : (
                      "Önerilen fiyat malzeme girilince hesaplanır"
                    )
                  }
                >
                  <div className="relative">
                    <NumberInput
                      id="r-price"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="cell-input h-12 pr-8 text-lg font-semibold pointer-coarse:h-12 pointer-coarse:text-lg sm:h-9 sm:text-sm sm:pointer-coarse:h-11 sm:pointer-coarse:text-base"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
                  </div>
                </Field>
                <Field
                  label="Zayi / fire"
                  tip={`Bu ürüne özel fire oranı, yüzde olarak: 8 ya da %8 yazın (%8 olur). Boş bırakılırsa Ayarlar'daki genel oran (%${num(settings.fire * 100, 1)}) kullanılır.${settings.fireExcludesPackaging ? " Ambalaj fireye dahil edilmiyor." : ""}`}
                  htmlFor="r-fire"
                >
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">%</span>
                    <NumberInput
                      id="r-fire"
                      value={fire}
                      onChange={(e) => setFire(e.target.value)}
                      placeholder={num(settings.fire * 100, 1)}
                      aria-invalid={fireInput.error ? true : undefined}
                      data-warn={fireInput.warning ? "true" : undefined}
                      aria-describedby={fire.trim() ? "r-fire-hint" : undefined}
                      className="cell-input h-11 pl-7 pointer-coarse:h-11 sm:h-9 sm:pointer-coarse:h-11"
                    />
                  </div>
                </Field>
                {/* Fire alanının okunuşu: dar sütuna sığmadığı için iki sütunun altında */}
                {fire.trim() ? (
                  <p
                    id="r-fire-hint"
                    className={cn("-mt-1 text-xs sm:col-span-2", fireInput.error ? "text-bad" : fireInput.warning ? "text-warn" : "text-ink-mute")}
                    role={fireInput.error || fireInput.warning ? "alert" : undefined}
                  >
                    {fireInput.error ? (
                      <>Zayi / fire: {fireInput.error}</>
                    ) : fireInput.warning ? (
                      <>
                        Zayi / fire {fireInput.warning}{" "}
                        {fireInput.suggestion ? (
                          <button
                            type="button"
                            onClick={() => setFire(fireInput.suggestion!)}
                            className="cursor-pointer font-medium text-info hover:underline pointer-coarse:-my-3.5 pointer-coarse:px-1 pointer-coarse:py-3.5"
                          >
                            %{fireInput.suggestion} yap
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        Bu ürüne özel fire {firePct(fireInput.rate ?? 0)} (genel oran {firePct(settings.fire)}).{" "}
                        <button
                          type="button"
                          onClick={() => setFire("")}
                          className="cursor-pointer font-medium text-info hover:underline pointer-coarse:-my-3.5 pointer-coarse:px-1 pointer-coarse:py-3.5"
                        >
                          Genel orana dön
                        </button>
                      </>
                    )}
                  </p>
                ) : null}
              </div>

              <Segmented label="Özet görünümü" value={sideTab} onChange={setSideTab} options={sideTabs} stretch />

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={sideTab}
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                >
                  {sideTab === "dokum" ? (
                    <div className="divide-y divide-line">
                      <KeyValue label="Malzeme toplamı" value={tl(econ.ingredientTotal, 2)} />
                      <KeyValue label={`Fire payı (${firePct(econ.fireRate)}${econ.fireOverridden ? ", bu ürüne özel" : ""})`} value={tl(econ.fire, 2)} />
                      <KeyValue label="Ürün maliyeti" value={tl(econ.cost, 2)} strong />
                      <KeyValue label={`Satış fiyatı (KDV hariç, %${num(settings.kdv * 100)})`} value={tl(econ.net, 2)} />
                      <KeyValue
                        label={`Kart komisyonu (%${num(settings.komisyon * 100, 1)} × %${num(settings.kartOrani * 100, 1)})`}
                        value={tl(econ.commission, 2)}
                      />
                      <KeyValue label={`${monthLabel} satılan adet`} value={num(soldQty)} />
                      <KeyValue
                        label={`${monthLabel} bu üründen kalan kâr`}
                        value={<Signed value={econ.unitProfit * soldQty}>{tl(econ.unitProfit * soldQty)}</Signed>}
                        strong
                      />
                    </div>
                  ) : null}

                  {sideTab === "dene" ? (
                    <div className="space-y-3">
                      <p className="text-[13px] text-ink-mute">Kaydetmeden farklı fiyatları deneyin.</p>
                      <Well className="space-y-3 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <Label htmlFor="trial">Deneme fiyatı (KDV dahil)</Label>
                          <div className="relative w-28 shrink-0">
                            <NumberInput
                              id="trial"
                              value={trial}
                              onChange={(e) => setTrial(e.target.value)}
                              placeholder={num(priceNum, 2)}
                              className="pr-7 font-semibold pointer-coarse:h-11"
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
                          </div>
                        </div>
                        <RangeSlider
                          value={trialPrice ?? priceNum}
                          onValueChange={(v) => setTrial(num(v, 2))}
                          min={range.min}
                          max={range.max}
                          step={1}
                          showTicks={false}
                          aria-label="Deneme fiyatı"
                          formatValueText={(v) => tl(v, 2)}
                        />
                        <div className="flex justify-between text-[11px] text-ink-mute tabular" aria-hidden="true">
                          <span>{tl(range.min)}</span>
                          <span>{tl(range.max)}</span>
                        </div>
                      </Well>
                      <div className="flex flex-wrap gap-1.5">
                        {[5, 10, 20].map((d) => (
                          <Button key={d} size="sm" variant="secondary" className="flex-1 px-2 pointer-coarse:h-11" onClick={() => setTrial(num(priceNum + d, 2))}>
                            +{d} ₺
                          </Button>
                        ))}
                        <Button size="sm" variant="secondary" className="flex-1 px-2 pointer-coarse:h-11" onClick={() => setTrial(num(econ.suggestedPrice, 2))}>
                          Önerilen
                        </Button>
                      </div>
                      {trialEcon ? (
                        <Well className="py-1">
                          <div className="divide-y divide-line">
                            <KeyValue
                              label="1 adet kâr"
                              value={
                                <span className="inline-flex items-center gap-2">
                                  <Signed value={trialEcon.unitProfit}>{tl(trialEcon.unitProfit, 2)}</Signed>
                                  <GrowthPill value={trialDiff}>
                                    {plus(trialDiff)}
                                    {tl(trialDiff, 2)}
                                  </GrowthPill>
                                </span>
                              }
                            />
                            <KeyValue label="Kâr marjı" value={pct(trialEcon.margin)} />
                            <KeyValue label="Maliyet oranı" value={pct(trialEcon.costRatio)} />
                            <KeyValue
                              label="Aynı satışla aylık fark"
                              value={
                                <Signed value={trialDiff} className={trialDiff > 0 ? "text-good" : undefined}>
                                  {plus(trialDiff)}
                                  {tl(trialDiff * soldQty)}
                                </Signed>
                              }
                              strong
                            />
                          </div>
                          <div className="py-2.5">
                            <Button size="sm" variant="secondary" className="w-full pointer-coarse:h-11" onClick={() => setPrice(priceText(trialPrice!))}>
                              Bu fiyatı uygula
                            </Button>
                          </div>
                        </Well>
                      ) : null}
                    </div>
                  ) : null}

                  {sideTab === "satis" && history.length ? (
                    <ul className="divide-y divide-line" aria-label="Aylık satış">
                      {history.map((h, i) => (
                        <motion.li
                          key={h.month}
                          initial={reduce ? false : { opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.25, ease: EASE_OUT, delay: Math.min(i, 12) * 0.03 }}
                          className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm"
                          aria-current={h.month === month ? "true" : undefined}
                        >
                          <span className={cn("truncate", h.month === month ? "font-semibold text-ink" : "text-ink-mute")}>{h.label}</span>
                          <Progress value={h.qty / maxSold} />
                          <span className="text-right text-ink tabular">{num(h.qty)} adet</span>
                        </motion.li>
                      ))}
                    </ul>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.aside>
      </div>

      {/* Kaydet çubuğu: değişiklik olunca altta yüzen kapsül (telefonda alt menünün üstünde). Kaydedilmemiş
          maliyet ve kâr da burada: telefonda miktarı değiştirirken üstteki özet kartı ekranın dışında kalır. */}
      <FloatingBar open={dirty} className="max-w-lg flex-nowrap justify-between gap-2 py-2 pr-2 pl-4">
        <div className="min-w-0" aria-live="polite">
          <p className="flex items-center gap-2 text-[13px] leading-tight font-medium text-ink-soft">
            <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
            <span className="max-[400px]:hidden">Kaydedilmemiş değişiklikler</span>
            <span className="min-[401px]:hidden">Kaydedilmedi</span>
          </p>
          <p className="mt-0.5 text-xs leading-4 text-ink-mute tabular">
            {noRecipe ? (
              "Malzeme ekleyince hesaplanır"
            ) : (
              <>
                Maliyet{" "}
                <span className={cn("font-semibold", gaugeTone === "bad" ? "text-bad" : gaugeTone === "warn" ? "text-warn" : "text-ink")}>
                  {pct(econ.costRatio)}
                </span>{" "}
                · kâr{" "}
                <Signed value={econ.unitProfit} className="font-semibold text-ink">
                  {tl(econ.unitProfit, 2)}
                </Signed>
              </>
            )}
          </p>
        </div>
        {/* Telefonda düğmeler ikonsuz, yalnız yazı: "Geri al" ikon olarak anlaşılmıyordu; iki yazılı düğme ikonlu
            Kaydet + yuvarlak ok kadar yer kaplar, soldaki maliyet satırı 375px'te de tek satırda kalır */}
        <div className="flex shrink-0 gap-1.5">
          <Button variant="ghost" onClick={reset} title="Kaydedilmemiş değişiklikleri geri al" className="h-11 pointer-coarse:h-11 max-sm:px-3 sm:h-9">
            <RotateCcw size={16} className="max-sm:hidden" aria-hidden="true" /> Geri al
          </Button>
          <Button onClick={save} disabled={saving} title="Kaydet (⌘S / Ctrl+S)" className="h-11 px-4 pointer-coarse:h-11 sm:h-9">
            <Save size={16} className="max-sm:hidden" aria-hidden="true" /> {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </FloatingBar>

      <ConfirmDialog
        open={leaveHref !== null}
        onClose={() => setLeaveHref(null)}
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          if (href) router.push(href);
        }}
        title="Kaydedilmemiş değişiklikler var"
        confirmLabel="Kaydetmeden çık"
        description="Bu karttaki değişiklikler henüz kaydedilmedi; çıkarsanız kaybolur. Kalmak için Vazgeç'e basıp alttaki Kaydet'i kullanın."
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        pending={deleting}
        title="Ürün silinsin mi?"
        confirmLabel="Ürünü sil"
        description={
          <>
            <span className="mb-2 block font-semibold text-ink">
              {product.name} · {product.size}
            </span>
            Reçetesiyle birlikte kalıcı olarak silinir; geri alınamaz.
            {totalSold
              ? ` Satış raporlarında ${num(soldMonths)} ayda toplam ${num(totalSold)} adet satışı var: bu satırlar kalır ama eşleşmesiz görünür ve POS eşleştirmesi de silinir.`
              : " Bu ürünün satış kaydı yok."}{" "}
            Yalnızca menüden kaldırmak için silmek yerine &apos;Menüde aktif&apos; anahtarını kapatıp kaydedin.
            {site?.link ? ` Site bağlantısı da kalkar; laffogato.net'teki ${site.item?.name ?? "kalem"} silinmez.` : null}
          </>
        }
      />

      {/* Yalnız açıkken çizilir: kart kayıttan sonra baştan kurulmaz, alanlar her açılışta son kaydedilen ad ve fiyatla başlasın */}
      {copyOpen ? (
        <CopyDialog open onClose={() => setCopyOpen(false)} product={product} month={month} takenSizes={siblings.map((x) => x.size)} dirty={dirty} />
      ) : null}
    </div>
  );
}

/** Malzemenin kategorisine göre pastel ikon karosu; boş satırda kesik çizgili yer tutucu */
function IngredientTile({ ing, className }: { ing?: IngredientOption; className?: string }) {
  if (!ing) {
    return (
      <span
        className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong text-ink-quiet", className)}
        aria-hidden="true"
      >
        <Plus size={16} />
      </span>
    );
  }
  const Icon = ing.priceSource === "water" ? Droplets : (CATEGORY_ICON[ing.category] ?? Box);
  return (
    <span title={ing.category} className={cn("inline-flex shrink-0", className)}>
      <IconTile tone={toneFor(ing.category)}>
        <Icon />
      </IconTile>
    </span>
  );
}

/**
 * Reçetesiyle kopyalama. Aynı adın henüz olmayan ilk boyu seçili gelir; aynı ad + boy zaten varsa göndermeden
 * uyarır. Enter kopyalar, Esc kapatır.
 */
function CopyDialog({
  open,
  onClose,
  product,
  month,
  takenSizes,
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  product: { id: number; name: string; size: "M" | "L" | "Tek"; categoryId: number; price: number; fireOverride: number | null; note: string | null };
  month: string;
  /** Bu adın var olan boyları */
  takenSizes: string[];
  /** Kartta kaydedilmemiş değişiklik var: kopyaya kayıtlı hâli geçer (açıkça söylenir) */
  dirty: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [name, setName] = useState(product.name);
  const [size, setSize] = useState<Size>(() => SIZES.find((x) => !takenSizes.includes(x)) ?? (product.size === "M" ? "L" : "M"));
  const [price, setPrice] = useState(priceText(product.price));
  const [priceError, setPriceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const duplicate = fold(name.trim()) === fold(product.name) && takenSizes.includes(size);

  async function submit() {
    if (busy || duplicate) return;
    if (!name.trim()) return document.getElementById("c-name")?.focus();
    const p = parseNumberTR(price);
    if (p === null || p < 0) {
      setPriceError("Geçerli bir fiyat girin (ör. 185 ya da 185,50)");
      return document.getElementById("c-price")?.focus();
    }
    setBusy(true);
    const res = await createProduct({ name, size, categoryId: product.categoryId, price: p, copyFromId: product.id });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${name.trim()} · ${size} oluşturuldu`, { description: `${copiedSummary(res.data)} Miktarları yeni boya göre düzeltin.` });
    onClose();
    router.push(productHref(res.data.id, month));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ürünü kopyala"
      description={copyDescription(product)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy || duplicate || !name.trim()}>
            <Copy size={16} /> {busy ? "Kopyalanıyor…" : "Kopyala"}
          </Button>
        </>
      }
    >
      {/* Enter ile de kopyalanır */}
      <form
        id={formId}
        className="space-y-4 pb-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {dirty ? (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs leading-5 text-warn" role="status">
            Kartta kaydedilmemiş değişiklikler var. Kopyaya son kaydedilen reçete, fire ve not geçer; değişikliklerin de geçmesi için önce
            Vazgeç&apos;e basıp kaydedin.
          </p>
        ) : null}
        <Field label="Ürün adı" htmlFor="c-name" error={name.trim() ? undefined : "Ürün adını yazın"}>
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-invalid={name.trim() ? undefined : true} />
        </Field>
        <div className="grid gap-3 min-[420px]:grid-cols-2">
          <Field label="Boy" htmlFor="c-size" error={duplicate ? `${product.name} · ${size} zaten var; başka bir boy seçin` : undefined}>
            <Select id="c-size" value={size} onChange={(e) => setSize(e.target.value as Size)} aria-invalid={duplicate || undefined}>
              {SIZES.map((x) => (
                <option key={x} value={x}>
                  {x} — {SIZE_LABELS[x]}
                  {fold(name.trim()) === fold(product.name) && takenSizes.includes(x) ? " (var)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Satış fiyatı (KDV dahil)" htmlFor="c-price" error={priceError}>
            <div className="relative">
              <NumberInput
                id="c-price"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPriceError(null);
                }}
                aria-invalid={priceError ? true : undefined}
                className="cell-input pr-7"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
            </div>
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
