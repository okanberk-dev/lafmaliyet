"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { InfoTip, Signed } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { priceProduct } from "@/lib/calc/engine";
import { evaluateExpression, parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { PACKAGING_CATEGORY, RECIPE_PARAMS, SIZE_LABELS, SIZES } from "@/lib/constants";
import { num, pct, tl, tlUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  const [copyOpen, setCopyOpen] = useState(false);

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

  const grouped = useMemo(() => {
    const m = new Map<string, IngredientOption[]>();
    for (const i of ingredients) {
      const list = m.get(i.category) ?? [];
      list.push(i);
      m.set(i.category, list);
    }
    return [...m.entries()].map(([cat, list]) => [cat, list.sort((a, b) => a.name.localeCompare(b.name, "tr"))] as const);
  }, [ingredients]);

  const statusTone = econ.costRatio <= settings.hedefMaliyet ? "text-emerald-700" : econ.costRatio <= settings.hedefMaliyet + 0.1 ? "text-amber-700" : "text-rose-700";

  return (
    <>
      <div className="mb-3">
        <Link href="/panel/urunler" className="inline-flex items-center gap-1 text-sm text-coffee-600 hover:text-coffee-900">
          <ArrowLeft size={16} /> Kârlılık listesine dön
        </Link>
      </div>
      <PageHeader
        title={`${product.name} – ${SIZE_LABELS[product.size]}`}
        excel="Reçete Kartları"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {categories.find((c) => c.id === product.categoryId)?.name}
            <StatusBadge status={econ.status} />
            {!product.active ? <Badge tone="gray">Pasif</Badge> : null}
            {siblings.length > 1 ? (
              <span className="flex items-center gap-1">
                Boylar:
                {siblings.map((s) => (
                  <Link
                    key={s.id}
                    href={`/panel/urunler/${s.id}`}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-semibold",
                      s.id === product.id ? "bg-coffee-800 text-white" : "bg-coffee-100 text-coffee-800 hover:bg-coffee-200",
                    )}
                  >
                    {s.size}
                  </Link>
                ))}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setCopyOpen(true)}>
              <Copy size={16} /> Kopyala
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-rose-700 hover:bg-rose-50">
              <Trash2 size={16} /> Sil
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card>
            <CardHeader
              title="Malzemeler"
              description={
                <>
                  Miktar sayı ya da Ayarlar&apos;a bağlı formül olabilir (ör. <code className="rounded bg-coffee-50 px-1">2*ShotCift</code>). Ayar değişince bu
                  reçete de güncellenir.
                </>
              }
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRows((rs) => [...rs, { key: keySeq++, ingredientId: null, input: "", note: "" }])}
                >
                  <Plus size={14} /> Malzeme ekle
                </Button>
              }
            />
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH className="w-8">#</TH>
                    <TH>Malzeme</TH>
                    <TH>Miktar</TH>
                    <TH numeric>
                      Fiyat <InfoTip text="Birim maliyet (KDV hariç): paket fiyatı ÷ paket içeriği. Hammaddeler sayfasından gelir." className="ml-1" />
                    </TH>
                    <TH numeric>KDV</TH>
                    <TH numeric>Toplam</TH>
                    <TH numeric>KDV dahil</TH>
                    <TH numeric>
                      {monthLabel} kullanım <InfoTip text="Miktar × bu ayın satış adedi (fire hariç). Tutarlılık kontrolünde faturayla karşılaştırılır." className="ml-1" />
                    </TH>
                    <TH className="w-24" />
                  </tr>
                </THead>
                <tbody>
                  {lines.map((l, idx) => (
                    <TR key={l.row.key}>
                      <TD className="text-coffee-400">{idx + 1}</TD>
                      <TD className="min-w-56">
                        <Select
                          value={l.row.ingredientId ?? ""}
                          onChange={(e) => update(l.row.key, { ingredientId: e.target.value ? Number(e.target.value) : null })}
                          className={cn("h-9", !l.row.ingredientId && "border-amber-300 bg-amber-50")}
                          aria-label="Malzeme"
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
                        <div className="mt-1 flex flex-wrap gap-1">
                          {l.ing?.isEstimate ? <Badge tone="amber">Tahmini fiyat</Badge> : null}
                          {l.ing?.priceSource === "water" ? (
                            <Badge tone="blue" title="Su faturasından hesaplanır">
                              Su faturası ({tl(waterPerLiter, 2)}/L)
                            </Badge>
                          ) : null}
                          {l.isPackaging ? <Badge tone="gray">Ambalaj</Badge> : null}
                        </div>
                      </TD>
                      <TD className="min-w-40">
                        <div className="flex items-center gap-2">
                          <Input
                            value={l.row.input}
                            onChange={(e) => update(l.row.key, { input: e.target.value })}
                            className={cn(
                              "cell-input h-9 w-28 text-right tabular",
                              l.error && "border-rose-400 bg-rose-50",
                              !l.error && l.qty === 0 && l.row.ingredientId && "border-amber-300 bg-amber-50",
                            )}
                            aria-label="Miktar"
                            placeholder="0"
                          />
                          <span className="text-xs text-coffee-500">{l.ing?.unit}</span>
                        </div>
                        {l.error ? (
                          <p className="mt-1 text-xs text-rose-700">{l.error}</p>
                        ) : l.expr ? (
                          <p className="mt-1 text-xs text-coffee-500">= {num(l.qty, 2)} {l.ing?.unit}</p>
                        ) : l.qty === 0 && l.row.ingredientId ? (
                          <p className="mt-1 text-xs text-amber-700">Miktar girilmedi (0 sayılıyor)</p>
                        ) : null}
                      </TD>
                      <TD numeric>{l.ing ? tlUnit(l.unitCost) : "–"}</TD>
                      <TD numeric>{l.ing ? pct(l.vatRate, 0) : "–"}</TD>
                      <TD numeric className="font-medium">{tl(l.total, 2)}</TD>
                      <TD numeric className="text-coffee-600">{tl(l.totalVat, 2)}</TD>
                      <TD numeric className="text-coffee-600">
                        {soldQty ? `${num(l.qty * soldQty, 0)} ${l.ing?.unit ?? ""}` : "–"}
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-0.5">
                          <button type="button" className="rounded p-1 text-coffee-400 hover:bg-coffee-50 hover:text-coffee-800" onClick={() => move(idx, -1)} aria-label="Yukarı taşı">
                            <ArrowUp size={14} />
                          </button>
                          <button type="button" className="rounded p-1 text-coffee-400 hover:bg-coffee-50 hover:text-coffee-800" onClick={() => move(idx, 1)} aria-label="Aşağı taşı">
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-coffee-400 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setRows((rs) => rs.filter((r) => r.key !== l.row.key))}
                            aria-label="Satırı sil"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                  {!lines.length ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-coffee-500">
                        Henüz malzeme yok. &quot;Malzeme ekle&quot; ile başlayın.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="border-t border-coffee-100 bg-coffee-50/60 font-semibold">
                    <td colSpan={5} className="px-3 py-2 text-right text-sm">
                      TOPLAM
                    </td>
                    <td className="px-3 py-2 text-right tabular">{tl(econ.ingredientTotal, 2)}</td>
                    <td className="px-3 py-2 text-right tabular text-coffee-600">{tl(econ.totalVatIncl, 2)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </Table>
            </TableWrap>
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-coffee-100 px-5 py-3 text-xs text-coffee-500">
              <span>Formülde kullanılabilecek ayarlar:</span>
              {RECIPE_PARAMS.map((p) => (
                <span key={p.name} className="whitespace-nowrap">
                  <code className="rounded bg-coffee-50 px-1 text-coffee-800">{p.name}</code> {p.label} ({num(Number(settings[p.key]), 0)} {p.unit})
                </span>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Ürün bilgileri" />
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
              <div className="flex flex-wrap gap-6 sm:col-span-2">
                <Checkbox label="Menüde aktif" checked={active} onChange={(e) => setActive(e.target.checked)} />
                <Checkbox label="QR menüde göster" checked={showOnMenu} onChange={(e) => setShowOnMenu(e.target.checked)} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-4">
          <Card className="xl:sticky xl:top-6">
            <CardHeader title="Maliyet ve kâr" description="Değiştirdikçe anında hesaplanır" />
            <CardContent className="space-y-2.5 text-sm">
              <Line label="Malzeme toplamı" value={tl(econ.ingredientTotal, 2)} />
              <div className="flex items-center justify-between gap-3">
                <span className="text-coffee-700">
                  Zayi / fire oranı{" "}
                  <InfoTip text={`Bu ürüne özel fire oranı. Boş bırakılırsa Ayarlar'daki genel oran (%${num(settings.fire * 100, 1)}) kullanılır.${settings.fireExcludesPackaging ? " Ambalaj fireye dahil edilmiyor." : ""}`} />
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-coffee-400">%</span>
                  <NumberInput
                    value={fire}
                    onChange={(e) => setFire(e.target.value)}
                    placeholder={num(settings.fire * 100, 1)}
                    className="cell-input h-8 w-20"
                    aria-label="Fire oranı"
                  />
                </div>
              </div>
              <Line label={`Fire payı (${pct(econ.fireRate)})`} value={tl(econ.fire, 2)} />
              <Line label="Ürün maliyeti" value={tl(econ.cost, 2)} strong />
              <hr className="border-coffee-100" />
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-coffee-900">Satış fiyatı (KDV dahil)</span>
                <NumberInput value={price} onChange={(e) => setPrice(e.target.value)} className="cell-input h-9 w-28 font-semibold" aria-label="Satış fiyatı" />
              </div>
              <Line label={`Satış fiyatı (KDV hariç, %${num(settings.kdv * 100)})`} value={tl(econ.net, 2)} />
              <Line label={`Kart komisyonu (%${num(settings.komisyon * 100, 1)} × %${num(settings.kartOrani * 100, 1)})`} value={tl(econ.commission, 2)} />
              <div className="flex items-baseline justify-between rounded-xl bg-coffee-50 px-3 py-2.5">
                <span className="font-semibold text-coffee-900">1 adet kâr</span>
                <Signed value={econ.unitProfit} className="text-lg font-semibold">
                  {tl(econ.unitProfit, 2)}
                </Signed>
              </div>
              <Line label="Kâr marjı" value={pct(econ.margin)} />
              <div className="flex justify-between">
                <span className="text-coffee-700">Maliyet oranı (hedef ≤ %{num(settings.hedefMaliyet * 100)})</span>
                <span className={cn("font-semibold tabular", statusTone)}>{pct(econ.costRatio)}</span>
              </div>
              <Line label="Önerilen fiyat" value={tl(econ.suggestedPrice)} />
              <hr className="border-coffee-100" />
              <Line label={`${monthLabel} satılan adet`} value={num(soldQty)} />
              <Line label={`${monthLabel} bu üründen kalan kâr`} value={tl(econ.unitProfit * soldQty)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Fiyat simülatörü" description="Kaydetmeden farklı fiyatları deneyin" />
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {[5, 10, 20].map((d) => (
                  <Button key={d} size="xs" variant="secondary" onClick={() => setTrial(num(priceNum + d, 2))}>
                    +{d} ₺
                  </Button>
                ))}
                <Button size="xs" variant="secondary" onClick={() => setTrial(num(econ.suggestedPrice, 2))}>
                  Önerilen
                </Button>
              </div>
              <Field label="Deneme fiyatı (KDV dahil)" htmlFor="trial">
                <NumberInput id="trial" value={trial} onChange={(e) => setTrial(e.target.value)} placeholder={num(priceNum, 2)} />
              </Field>
              {trialEcon ? (
                <div className="space-y-1.5 rounded-xl bg-coffee-50 p-3">
                  <Line label="1 adet kâr" value={`${tl(trialEcon.unitProfit, 2)} (${trialEcon.unitProfit >= econ.unitProfit ? "+" : ""}${tl(trialEcon.unitProfit - econ.unitProfit, 2)})`} />
                  <Line label="Kâr marjı" value={pct(trialEcon.margin)} />
                  <Line label="Maliyet oranı" value={pct(trialEcon.costRatio)} />
                  <Line
                    label={`Aynı satışla aylık fark`}
                    value={`${trialEcon.unitProfit >= econ.unitProfit ? "+" : ""}${tl((trialEcon.unitProfit - econ.unitProfit) * soldQty)}`}
                    strong
                  />
                  <div className="pt-1">
                    <Button size="xs" variant="outline" onClick={() => setPrice(num(trialPrice!, 2))}>
                      Bu fiyatı uygula
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {history.length ? (
            <Card>
              <CardHeader title="Aylık satış" />
              <CardContent className="space-y-1.5 text-sm">
                {history.map((h) => (
                  <Line key={h.month} label={h.label} value={`${num(h.qty)} adet`} />
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Kaydet çubuğu */}
      <div
        className={cn(
          "no-print fixed inset-x-0 bottom-0 z-20 border-t border-coffee-200 bg-white/95 backdrop-blur transition-transform lg:left-64",
          dirty ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-sm text-coffee-700">Kaydedilmemiş değişiklikler var</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset}>
              <RotateCcw size={16} /> Geri al
            </Button>
            <Button onClick={save} disabled={saving}>
              <Save size={16} /> {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Ürün silinsin mi?"
        description="Reçetesi de silinir. Geçmiş satış satırları kalır ama eşleşmesiz görünür. Menüden kaldırmak için silmek yerine 'Menüde aktif' işaretini kaldırabilirsiniz."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Vazgeç
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const res = await deleteProduct(product.id);
                if (!res.ok) return toast.error(res.error);
                toast.success("Ürün silindi");
                router.push("/panel/urunler");
              }}
            >
              Sil
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <strong>
            {product.name} · {product.size}
          </strong>
        </p>
      </Dialog>

      <CopyDialog open={copyOpen} onClose={() => setCopyOpen(false)} product={product} />
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-coffee-700">{label}</span>
      <span className={cn("tabular", strong ? "font-semibold text-coffee-950" : "text-coffee-900")}>{value}</span>
    </div>
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
  const [name, setName] = useState(product.name);
  const [size, setSize] = useState<"M" | "L" | "Tek">(product.size === "M" ? "L" : "M");
  const [price, setPrice] = useState(num(product.price, 2));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Ürünü kopyala" description="Reçetesiyle birlikte yeni bir ürün ya da boy oluşturur.">
      <div className="space-y-4">
        <Field label="Ürün adı" htmlFor="c-name">
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Boy" htmlFor="c-size">
            <Select id="c-size" value={size} onChange={(e) => setSize(e.target.value as "M" | "L" | "Tek")}>
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
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await createProduct({ name, size, categoryId: product.categoryId, price: parseNumberTR(price) ?? 0, copyFromId: product.id });
              setBusy(false);
              if (!res.ok) return toast.error(res.error);
              toast.success("Kopya oluşturuldu");
              onClose();
              router.push(`/panel/urunler/${res.data.id}`);
            }}
          >
            Kopyala
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
