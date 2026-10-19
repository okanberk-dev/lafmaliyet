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
  Tag,
  Trash2,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { RangeSlider } from "@/components/akmanos/range-slider";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, Label, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Gauge } from "@/components/ui/gauge";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, GrowthPill, InfoTip, KeyValue, Progress, Signed } from "@/components/ui/misc";
import { Segmented, SegmentedLinks } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { priceProduct } from "@/lib/calc/engine";
import { evaluateExpression, parseNumberTR } from "@/lib/calc/expr";
import type { Settings, Size } from "@/lib/calc/types";
import { PACKAGING_CATEGORY, RECIPE_PARAMS, SIZE_LABELS, SIZES } from "@/lib/constants";
import { num, pct, tl, tlUnit } from "@/lib/format";
import { createProduct, deleteProduct, saveRecipe } from "@/server/actions/products";

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

function toInput(qty: number, expr: string | null) {
  return expr ?? num(qty, 4);
}

function resolveQty(input: string, settings: Settings): { qty: number; expr: string | null; error: string | null } {
  const raw = input.trim();
  if (!raw) return { qty: 0, expr: null, error: null };
  const n = parseNumberTR(raw);
  if (n !== null && !/[a-zçğıöşü]/i.test(raw)) return { qty: n, expr: null, error: null };
  try {
    return { qty: evaluateExpression(raw, settings), expr: raw.replace(/^=/, ""), error: null };
  } catch (e) {
    return { qty: 0, expr: raw, error: e instanceof Error ? e.message : "Geçersiz formül" };
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

/** Reçete satırı: yukarı/aşağı taşınınca yaylı kayar, eklenince belirir, silinince söner */
const MotionTR = motion.create(TR);

/** İlk/son satırdaki taşıma düğmesi: soluk, ama odaklanabilir kalır */
const edgeClass = "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:text-ink-mute";

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

type SideTab = "dokum" | "dene" | "satis";

export function RecipeEditor({
  product,
  items,
  categories,
  ingredients,
  settings,
  soldQty,
  monthLabel,
  history,
  siblings,
  waterPerLiter,
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
  monthLabel: string;
  history: { month: string; label: string; qty: number }[];
  siblings: { id: number; size: string }[];
  waterPerLiter: number;
}) {
  const router = useRouter();
  const reduce = useCalmMotion();
  /** Miktar alanını altındaki hata/uyarı metnine bağlamak için (satır anahtarı sunucuyla eşleşmez, sıra eşleşir) */
  const uid = useId();
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const initialRows = useMemo<Row[]>(
    () => items.map((it) => ({ key: keySeq++, ingredientId: it.ingredientId, input: toInput(it.qty, it.qtyExpr), note: it.note ?? "" })),
    [items],
  );

  const [name, setName] = useState(product.name);
  const [size, setSize] = useState(product.size);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [price, setPrice] = useState(num(product.price, 2));
  const [fire, setFire] = useState(product.fireOverride === null ? "" : num(product.fireOverride * 100, 2));
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

  const priceNum = parseNumberTR(price) ?? 0;
  const fireNum = fire.trim() === "" ? null : (parseNumberTR(fire) ?? 0) / 100;

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

  const dirty =
    name !== product.name ||
    size !== product.size ||
    categoryId !== product.categoryId ||
    Math.abs(priceNum - product.price) > 0.001 ||
    fireNum !== product.fireOverride ||
    note !== (product.note ?? "") ||
    active !== product.active ||
    showOnMenu !== product.showOnMenu ||
    JSON.stringify(rows.map((r) => [r.ingredientId, r.input, r.note])) !==
      JSON.stringify(initialRows.map((r) => [r.ingredientId, r.input, r.note]));

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

  function reset() {
    setName(product.name);
    setSize(product.size);
    setCategoryId(product.categoryId);
    setPrice(num(product.price, 2));
    setFire(product.fireOverride === null ? "" : num(product.fireOverride * 100, 2));
    setNote(product.note ?? "");
    setActive(product.active);
    setShowOnMenu(product.showOnMenu);
    setRows(initialRows);
  }

  async function save() {
    const bad = lines.find((l) => l.error);
    if (bad) return toast.error(`Formül hatası: ${bad.error}`);
    if (lines.some((l) => !l.row.ingredientId)) return toast.error("Boş malzeme satırlarını doldurun ya da silin");
    if (parseNumberTR(price) === null) return toast.error("Satış fiyatını girin");
    setSaving(true);
    const res = await saveRecipe({
      productId: product.id,
      name: name.trim(),
      size,
      categoryId,
      price: priceNum,
      fireOverride: fireNum,
      note,
      active,
      showOnMenu,
      items: lines.map((l) => ({ ingredientId: l.row.ingredientId!, qty: l.qty, qtyExpr: l.expr, note: l.row.note })),
    });
    setSaving(false);
    if (res.ok) toast.success("Reçete kaydedildi");
    else toast.error(res.error);
  }

  async function remove() {
    setDeleting(true);
    const res = await deleteProduct(product.id);
    setDeleting(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Ürün silindi");
    router.push("/panel/urunler");
  }

  const grouped = useMemo(() => {
    const m = new Map<string, IngredientOption[]>();
    for (const i of ingredients) {
      const list = m.get(i.category) ?? [];
      list.push(i);
      m.set(i.category, list);
    }
    return [...m.entries()].map(([cat, list]) => [cat, list.sort((a, b) => a.name.localeCompare(b.name, "tr"))] as const);
  }, [ingredients]);

  const gaugeTone =
    econ.costRatio <= settings.hedefMaliyet ? "brand" : econ.costRatio <= settings.hedefMaliyet + 0.1 ? "warn" : "bad";
  const trialDiff = trialEcon ? trialEcon.unitProfit - econ.unitProfit : 0;
  const plus = (v: number) => (v >= 0 ? "+" : "");
  const maxSold = Math.max(1, ...history.map((h) => h.qty));
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
            <ButtonLink href="/panel/urunler" variant="ghost" size="sm">
              <ArrowLeft size={16} /> Ürünler
            </ButtonLink>
            <Button variant="secondary" onClick={() => setCopyOpen(true)}>
              <Copy size={16} /> Kopyala
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-bad hover:bg-bad-soft hover:text-bad">
              <Trash2 size={16} /> Sil
            </Button>
          </>
        }
        tabs={
          siblings.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] text-ink-mute">Boylar</span>
              <SegmentedLinks
                label="Boylar"
                value={String(product.id)}
                options={siblings.map((s) => ({ value: String(s.id), label: s.size, href: `/panel/urunler/${s.id}` }))}
              />
            </div>
          ) : undefined
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* Reçete satırları */}
          <motion.div {...rise(1, reduce)}>
            <Card>
              <CardHeader
                icon={<ClipboardList />}
                title="Malzemeler"
                description={
                  <>
                    Miktar sayı ya da Ayarlar&apos;a bağlı formül olabilir (ör.{" "}
                    <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-info ring-1 ring-line">2*ShotCift</code>).
                  </>
                }
                meta={lines.length ? <span className="tabular">{lines.length} malzeme</span> : null}
                actions={
                  lines.length ? (
                    <Button size="sm" variant="secondary" onClick={addRow}>
                      <Plus size={15} /> Malzeme ekle
                    </Button>
                  ) : null
                }
              />
              {lines.length ? (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH className="w-8 pr-0 text-ink-mute">#</TH>
                        <TH>Malzeme</TH>
                        <TH>Miktar</TH>
                        <TH numeric>
                          <span className="inline-flex items-center gap-1">
                            Birim fiyat
                            <InfoTip text="Birim maliyet (KDV hariç): paket fiyatı ÷ paket içeriği. Hammaddeler sayfasından gelir." />
                          </span>
                        </TH>
                        <TH numeric>Tutar</TH>
                        <TH numeric>
                          <span className="inline-flex items-center gap-1">
                            {monthLabel} kullanım
                            <InfoTip text="Miktar × bu ayın satış adedi (fire hariç). Tutarlılık kontrolünde faturayla karşılaştırılır." />
                          </span>
                        </TH>
                        <TH className="w-px">
                          <span className="sr-only">Eylemler</span>
                        </TH>
                      </tr>
                    </THead>
                    <tbody>
                      <AnimatePresence initial={false}>
                        {lines.map((l, idx) => (
                          <MotionTR
                            key={l.row.key}
                            layout={reduce ? false : "position"}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={rowTransition}
                          >
                            <TD className="w-8 pt-5 pr-0 align-top text-xs text-ink-quiet tabular">{idx + 1}</TD>
                            <TD className="min-w-64 align-top sm:min-w-72">
                              <div className="flex items-start gap-3">
                                <IngredientTile ing={l.ing} />
                                <div className="min-w-0 flex-1">
                                  <Select
                                    value={l.row.ingredientId ?? ""}
                                    onChange={(e) => update(l.row.key, { ingredientId: e.target.value ? Number(e.target.value) : null })}
                                    data-warn={!l.row.ingredientId ? "true" : undefined}
                                    aria-label={`${idx + 1}. satır malzemesi`}
                                    autoFocus={l.row.key === newKey}
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
                                  {l.ing?.isEstimate || l.ing?.priceSource === "water" || l.isPackaging ? (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {l.ing?.isEstimate ? (
                                        <Badge tone="amber" dot>
                                          Tahmini fiyat
                                        </Badge>
                                      ) : null}
                                      {l.ing?.priceSource === "water" ? (
                                        <Badge tone="blue" title="Su faturasından hesaplanır">
                                          Su faturası ({tl(waterPerLiter, 2)}/L)
                                        </Badge>
                                      ) : null}
                                      {l.isPackaging ? <Badge tone="gray">Ambalaj</Badge> : null}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </TD>
                            <TD className="min-w-40 align-top">
                              <div className="flex items-center gap-2">
                                <Input
                                  value={l.row.input}
                                  onChange={(e) => update(l.row.key, { input: e.target.value })}
                                  className="cell-input w-28 text-right tabular"
                                  aria-label={`${idx + 1}. satır miktarı`}
                                  aria-invalid={l.error ? true : undefined}
                                  aria-describedby={l.error || l.expr || (l.qty === 0 && l.row.ingredientId) ? `${uid}-q${idx}` : undefined}
                                  data-warn={!l.error && l.qty === 0 && l.row.ingredientId ? "true" : undefined}
                                  placeholder="0"
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                                <span className="text-xs text-ink-mute">{l.ing?.unit}</span>
                              </div>
                              {l.error ? (
                                <p id={`${uid}-q${idx}`} className="mt-1 max-w-48 text-xs text-bad">
                                  {l.error}
                                </p>
                              ) : l.expr ? (
                                <p id={`${uid}-q${idx}`} className="mt-1 text-xs text-ink-mute tabular">
                                  = {num(l.qty, 2)} {l.ing?.unit}
                                </p>
                              ) : l.qty === 0 && l.row.ingredientId ? (
                                <p id={`${uid}-q${idx}`} className="mt-1 text-xs text-warn">
                                  Miktar girilmedi (0 sayılıyor)
                                </p>
                              ) : null}
                            </TD>
                            <TD numeric className="pt-5 align-top">
                              {l.ing ? tlUnit(l.unitCost) : "–"}
                              {l.ing ? <div className="mt-0.5 text-xs text-ink-mute">KDV {pct(l.vatRate, 0)}</div> : null}
                            </TD>
                            <TD numeric className="pt-5 align-top">
                              <span className="font-medium">{tl(l.total, 2)}</span>
                              <div className="mt-0.5 text-xs text-ink-mute">KDV dahil {tl(l.totalVat, 2)}</div>
                            </TD>
                            <TD numeric className="pt-5 align-top text-ink-soft">
                              {soldQty ? `${num(l.qty * soldQty, 0)} ${l.ing?.unit ?? ""}` : "–"}
                            </TD>
                            <TD className="align-top">
                              <div className="flex justify-end gap-1.5">
                                {/* Uçta aria-disabled (disabled değil): klavyeyle taşınan satırın düğmesi odağı kaybetmesin */}
                                <IconButton
                                  label="Yukarı taşı"
                                  aria-disabled={idx === 0 || undefined}
                                  className={edgeClass}
                                  onClick={() => move(idx, -1)}
                                >
                                  <ArrowUp size={15} />
                                </IconButton>
                                <IconButton
                                  label="Aşağı taşı"
                                  aria-disabled={idx === lines.length - 1 || undefined}
                                  className={edgeClass}
                                  onClick={() => move(idx, 1)}
                                >
                                  <ArrowDown size={15} />
                                </IconButton>
                                <IconButton label="Satırı sil" tone="danger" onClick={() => setRows((rs) => rs.filter((r) => r.key !== l.row.key))}>
                                  <Trash2 size={15} />
                                </IconButton>
                              </div>
                            </TD>
                          </MotionTR>
                        ))}
                      </AnimatePresence>
                    </tbody>
                    <tfoot>
                      <TFootRow>
                        <TD colSpan={4} className="text-right">
                          Toplam
                        </TD>
                        <TD numeric>
                          {tl(econ.ingredientTotal, 2)}
                          <div className="mt-0.5 text-xs font-normal text-ink-mute">KDV dahil {tl(econ.totalVatIncl, 2)}</div>
                        </TD>
                        <TD colSpan={2} />
                      </TFootRow>
                    </tfoot>
                  </Table>
                </TableWrap>
              ) : (
                <EmptyState
                  icon={<ClipboardList />}
                  title="Henüz malzeme yok"
                  description="“Malzeme ekle” ile başlayın."
                  action={
                    <Button variant="secondary" onClick={addRow}>
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
                <Field label="Ürün adı" htmlFor="r-name">
                  <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
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
                <Field label="Not" className="sm:col-span-2" htmlFor="r-note" hint="Reçete varsayımları, bardak boyu vb.">
                  <Textarea id="r-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
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
            </Card>
          </motion.div>
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
                <Gauge
                  value={econ.costRatio}
                  target={settings.hedefMaliyet}
                  display={<AnimatedNumber value={econ.costRatio} format={(v) => pct(v)} />}
                  label={`Maliyet oranı · hedef ≤ %${num(settings.hedefMaliyet * 100)}`}
                  tone={gaugeTone}
                />
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
                  <div>
                    <p className="text-xs text-ink-mute">1 adet kâr</p>
                    <Signed value={econ.unitProfit} className="block text-xl font-semibold tracking-tight">
                      <AnimatedNumber value={econ.unitProfit} format={(v) => tl(v, 2)} />
                    </Signed>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-ink-mute">Kâr marjı</p>
                    <Signed value={econ.margin} className="block text-xl font-semibold tracking-tight text-ink">
                      <AnimatedNumber value={econ.margin} format={(v) => pct(v)} />
                    </Signed>
                  </div>
                </div>
              </Well>

              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-3">
                <Field
                  label="Satış fiyatı (KDV dahil)"
                  htmlFor="r-price"
                  hint={
                    <>
                      Önerilen: <span className="font-medium text-ink-soft tabular">{tl(econ.suggestedPrice)}</span>
                    </>
                  }
                >
                  <div className="relative">
                    <NumberInput id="r-price" value={price} onChange={(e) => setPrice(e.target.value)} className="cell-input pr-7 font-semibold" />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
                  </div>
                </Field>
                <Field
                  label="Zayi / fire"
                  tip={`Bu ürüne özel fire oranı. Boş bırakılırsa Ayarlar'daki genel oran (%${num(settings.fire * 100, 1)}) kullanılır.${settings.fireExcludesPackaging ? " Ambalaj fireye dahil edilmiyor." : ""}`}
                  htmlFor="r-fire"
                >
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute">%</span>
                    <NumberInput
                      id="r-fire"
                      value={fire}
                      onChange={(e) => setFire(e.target.value)}
                      placeholder={num(settings.fire * 100, 1)}
                      className="cell-input pl-7"
                    />
                  </div>
                </Field>
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
                      <KeyValue label={`Fire payı (${pct(econ.fireRate)})`} value={tl(econ.fire, 2)} />
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
                              className="pr-7 font-semibold"
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
                          <Button key={d} size="sm" variant="secondary" className="flex-1 px-2" onClick={() => setTrial(num(priceNum + d, 2))}>
                            +{d} ₺
                          </Button>
                        ))}
                        <Button size="sm" variant="secondary" className="flex-1 px-2" onClick={() => setTrial(num(econ.suggestedPrice, 2))}>
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
                            <Button size="sm" variant="secondary" className="w-full" onClick={() => setPrice(num(trialPrice!, 2))}>
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
                        >
                          <span className="truncate text-ink-mute">{h.label}</span>
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

      {/* Kaydet çubuğu: değişiklik olunca altta yüzen kapsül */}
      <FloatingBar open={dirty} className="max-w-lg flex-nowrap justify-between py-2 pr-2 pl-4">
        <p className="flex min-w-0 items-center gap-2 text-[13px] leading-tight font-medium text-ink-soft">
          <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          Kaydedilmemiş değişiklikler
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="ghost" onClick={reset} aria-label="Geri al" title="Geri al" className="max-sm:px-2.5">
            <RotateCcw size={16} /> <span className="max-sm:hidden">Geri al</span>
          </Button>
          <Button onClick={save} disabled={saving}>
            <Save size={16} /> {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </FloatingBar>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        pending={deleting}
        title="Ürün silinsin mi?"
        confirmLabel="Sil"
        description={
          <>
            <span className="mb-2 block font-semibold text-ink">
              {product.name} · {product.size}
            </span>
            Reçetesi de silinir. Geçmiş satış satırları kalır ama eşleşmesiz görünür. Menüden kaldırmak için silmek yerine &apos;Menüde
            aktif&apos; anahtarını kapatabilirsiniz.
          </>
        }
      />

      <CopyDialog open={copyOpen} onClose={() => setCopyOpen(false)} product={product} />
    </div>
  );
}

/** Malzemenin kategorisine göre pastel ikon karosu; boş satırda kesik çizgili yer tutucu */
function IngredientTile({ ing }: { ing?: IngredientOption }) {
  if (!ing) {
    return (
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong text-ink-quiet" aria-hidden="true">
        <Plus size={16} />
      </span>
    );
  }
  const Icon = ing.priceSource === "water" ? Droplets : (CATEGORY_ICON[ing.category] ?? Box);
  return (
    <span title={ing.category} className="inline-flex shrink-0">
      <IconTile tone={toneFor(ing.category)}>
        <Icon />
      </IconTile>
    </span>
  );
}

function CopyDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product: { id: number; name: string; size: "M" | "L" | "Tek"; categoryId: number; price: number };
}) {
  const router = useRouter();
  const formId = useId();
  const [name, setName] = useState(product.name);
  const [size, setSize] = useState<Size>(product.size === "M" ? "L" : "M");
  const [price, setPrice] = useState(num(product.price, 2));
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const res = await createProduct({ name, size, categoryId: product.categoryId, price: parseNumberTR(price) ?? 0, copyFromId: product.id });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Kopya oluşturuldu");
    onClose();
    router.push(`/panel/urunler/${res.data.id}`);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ürünü kopyala"
      description="Reçetesiyle birlikte yeni bir ürün ya da boy oluşturur."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            <Copy size={16} /> {busy ? "Kopyalanıyor…" : "Kopyala"}
          </Button>
        </>
      }
    >
      {/* Enter ile de kopyalanır */}
      <form
        id={formId}
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Ürün adı" htmlFor="c-name">
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Boy" htmlFor="c-size">
            <Select id="c-size" value={size} onChange={(e) => setSize(e.target.value as Size)}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} — {SIZE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Satış fiyatı" htmlFor="c-price">
            <NumberInput id="c-price" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
