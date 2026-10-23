"use client";

import { Check, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { toastUnreachable } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FilterChip, useQueryState } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { SIZE_LABELS, SIZES } from "@/lib/constants";
import { NEW_PRODUCT_NAME_MAX, newProductIssue, readProposedPrice, takenIssue, type ProductSize } from "@/lib/recipe-change";
import { proposeNewProduct } from "@/server/actions/recipe-requests";

import { blankRow, buildSnapshot, copyRows, FormulaHelp, RecipeLinesEditor, useRecipeKit, type LineRow, type ProposeKit } from "./recipe-lines";

/** Öneri penceresinin ürün tarafı: kategoriler, var olan ürünler (pasif dahil) ve bekleyen yeni ürün önerileri */
export interface NewProductKit {
  categories: { id: number; name: string }[];
  /** Aynı ad + boy göndermeden uyarılır (sunucu da denetler) */
  taken: { name: string; size: ProductSize }[];
  pending: { name: string; size: ProductSize }[];
}

/** "Medium boyundan kopyala" (Tek boy: "Tek boydan") */
const COPY_FROM: Record<ProductSize, string> = { M: "Medium boyundan kopyala", L: "Large boyundan kopyala", Tek: "Tek boydan kopyala" };

/** Reçete defterinin başlığındaki "Yeni ürün öner" (personel); kategori süzgeci açıksa o kategori seçili gelir */
export function ProposeProductButton({ kit, product }: { kit: ProposeKit; product: NewProductKit }) {
  const [open, setOpen] = useState(false);
  const [kategori] = useQueryState<string>("kategori", "");
  const initialCategory = product.categories.find((c) => String(c.id) === kategori)?.id ?? null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" /> Yeni ürün öner
      </Button>
      {open ? <NewProductSheet kit={kit} product={product} initialCategory={initialCategory} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Personelin yeni ürün önerisi: ad, kategori, boylar, boy başına isteğe bağlı satış fiyatı, her boyun reçetesi (malzeme
 * satırları "Değişiklik öner" ile aynı düzenleyici; listede olmayan malzeme oradan eklenir), yöneticiye not. Maliyet
 * yok; satış fiyatı yalnız yazılır: yönetici Reçete onayları'nda önceden dolu görür, değiştirip onaylayınca ürün açılır.
 * Telefonda alttan açılan sayfa.
 */
function NewProductSheet({ kit, product, initialCategory, onClose }: { kit: ProposeKit; product: NewProductKit; initialCategory: number | null; onClose: () => void }) {
  const recipeKit = useRecipeKit(kit);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(initialCategory);
  const [sizes, setSizes] = useState<ProductSize[]>([]);
  const [active, setActive] = useState<ProductSize>("M");
  const [rows, setRows] = useState<Record<ProductSize, LineRow[]>>(() => ({ M: [blankRow()], L: [blankRow()], Tek: [blankRow()] }));
  /** Boy başına yazılan satış fiyatı (metin; boş bırakılabilir) ve hatası */
  const [prices, setPrices] = useState<Record<ProductSize, string>>({ M: "", L: "", Tek: "" });
  const [priceError, setPriceError] = useState<{ size: ProductSize; text: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const chosen = SIZES.filter((x) => sizes.includes(x));
  const current: ProductSize | null = chosen.includes(active) ? active : (chosen[0] ?? null);
  const filled = (x: ProductSize) => rows[x].filter((r) => r.ingredientId !== null).length;
  const builds = chosen.map((x) => ({ size: x, ...buildSnapshot(rows[x], "", recipeKit, SIZE_LABELS[x]) }));
  const issue = newProductIssue(
    { name, categoryId, sizes: chosen.map((x) => ({ size: x, lines: rows[x].length })) },
    product.taken,
    product.pending,
  );
  const nameIssue = chosen.map((x) => takenIssue(name, x, product.taken, product.pending)).find(Boolean) ?? null;
  const dirty = name.trim() !== "" || message.trim() !== "" || chosen.some((x) => filled(x) > 0 || prices[x].trim() !== "");
  const priceId = (x: ProductSize) => `yeni-fiyat-${x}`;
  // Boy çıkarılınca onun fiyat hatası da kalkar
  const shownPriceError = priceError && chosen.includes(priceError.size) ? priceError : null;

  const toggleSize = (x: ProductSize) => {
    setSizes((list) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]));
    if (!sizes.includes(x)) setActive(x);
  };
  const setCurrentRows = (fn: (rows: LineRow[]) => LineRow[]) => {
    if (current) setRows((r) => ({ ...r, [current]: fn(r[current]) }));
  };
  /** Başka boyun satırları bu boya kopyalanır (bu boyda yazılanlar "Geri al" ile döner) */
  const copyFrom = (from: ProductSize) => {
    if (!current) return;
    const before = rows[current];
    const target = current;
    setRows((r) => ({ ...r, [target]: copyRows(r[from]) }));
    if (before.some((r) => r.ingredientId !== null))
      toast.message(`${SIZE_LABELS[from]} satırları kopyalandı`, {
        description: "Miktarları bu boya göre düzeltin.",
        action: { label: "Geri al", onClick: () => setRows((r) => ({ ...r, [target]: before })) },
      });
  };

  const requestClose = () => {
    if (busy) return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };

  async function submit() {
    if (busy) return;
    if (issue) return void toast.error(issue);
    // Fiyat alanları reçetenin üstünde: önce onlar
    const badPrice = chosen.map((x) => ({ size: x, text: readProposedPrice(prices[x]).error })).find((p) => p.text);
    if (badPrice?.text) {
      setPriceError({ size: badPrice.size, text: badPrice.text });
      document.getElementById(priceId(badPrice.size))?.focus();
      return void toast.error(chosen.length > 1 ? `${SIZE_LABELS[badPrice.size]}: ${badPrice.text}` : badPrice.text);
    }
    const bad = builds.find((b) => b.error);
    if (bad) {
      setActive(bad.size);
      return void toast.error(bad.error);
    }
    setBusy(true);
    try {
      const res = await proposeNewProduct({
        name,
        categoryId: categoryId ?? 0,
        message: message.trim() || null,
        sizes: builds.map((b) => ({
          size: b.size,
          items: b.snap.items.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty, qtyExpr: i.qtyExpr, note: i.note })),
          price: readProposedPrice(prices[b.size]).value,
        })),
      });
      if (!res.ok) return void toast.error(res.error);
      const priced = chosen.some((x) => readProposedPrice(prices[x]).value !== null);
      toast.success("Öneriniz yöneticiye gitti", {
        description: `${priced ? "Yönetici fiyatı kontrol edip onaylayınca" : "Yönetici satış fiyatını yazıp onaylayınca"} ürün reçete defterine eklenir. Sonucu “Önerilerim”de görürsünüz.`,
      });
      onClose();
    } catch (e) {
      toastUnreachable(e);
    } finally {
      setBusy(false);
    }
  }

  const others = current ? chosen.filter((x) => x !== current && filled(x) > 0) : [];

  return (
    <Dialog
      open
      onClose={requestClose}
      size="lg"
      title="Yeni ürün öner"
      description="Menüde olmayan bir ürünü reçetesiyle önerin. Yönetici fiyatını belirleyip onaylayınca ürün eklenir."
      footer={
        askDiscard ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-soft">Öneriniz gönderilmedi.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setAskDiscard(false)}>
                Düzenlemeye dön
              </Button>
              <Button variant="danger" onClick={onClose}>
                Göndermeden kapat
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button variant="ghost" onClick={requestClose} className="max-sm:h-11">
              Vazgeç
            </Button>
            <Button onClick={() => void submit()} disabled={busy} className="max-sm:h-11 max-sm:flex-1">
              {busy ? "Gönderiliyor…" : "Onaya gönder"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Ürün adı" htmlFor="yeni-urun-ad" error={nameIssue}>
          <Input
            id="yeni-urun-ad"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NEW_PRODUCT_NAME_MAX}
            placeholder="ör. Çilekli Latte"
            autoComplete="off"
            aria-invalid={nameIssue ? true : undefined}
          />
        </Field>
        <Field label="Kategori" htmlFor="yeni-urun-kategori">
          <Select id="yeni-urun-kategori" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Kategori seçin…</option>
            {product.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Boy" hint="Bir ya da birkaç boy seçin; her boyun reçetesini ayrı yazın.">
          <div role="group" aria-label="Boy" className="flex flex-wrap gap-2">
            {SIZES.map((x) => (
              <FilterChip key={x} active={sizes.includes(x)} onToggle={() => toggleSize(x)}>
                {sizes.includes(x) ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
                {SIZE_LABELS[x]}
              </FilterChip>
            ))}
          </div>
        </Field>
        {chosen.length ? (
          <Field
            label="Satış fiyatı (₺, KDV dahil)"
            error={shownPriceError ? (chosen.length > 1 ? `${SIZE_LABELS[shownPriceError.size]}: ${shownPriceError.text}` : shownPriceError.text) : null}
            hint="Biliyorsanız yazın; yönetici onaylarken değiştirebilir."
          >
            <div role="group" aria-label="Satış fiyatı" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {chosen.map((x) => (
                <div key={x} className="flex min-w-0 flex-col gap-1">
                  {chosen.length > 1 ? (
                    <label htmlFor={priceId(x)} className="text-xs text-ink-mute">
                      {SIZE_LABELS[x]}
                    </label>
                  ) : null}
                  <div className="relative">
                    <NumberInput
                      id={priceId(x)}
                      value={prices[x]}
                      onChange={(e) => {
                        setPrices((p) => ({ ...p, [x]: e.target.value }));
                        setPriceError(null);
                      }}
                      placeholder="ör. 165"
                      aria-label={`${SIZE_LABELS[x]} satış fiyatı`}
                      aria-invalid={shownPriceError?.size === x ? true : undefined}
                      className="cell-input pr-7"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
                  </div>
                </div>
              ))}
            </div>
          </Field>
        ) : null}

        {current ? (
          <section aria-label="Reçete" className="space-y-3">
            {chosen.length > 1 ? (
              <Segmented
                label="Reçetesi yazılan boy"
                value={current}
                onChange={setActive}
                options={chosen.map((x) => ({
                  value: x,
                  label: (
                    <>
                      {SIZE_LABELS[x]}
                      {filled(x) ? <span className="text-ink-quiet tabular">{filled(x)}</span> : null}
                    </>
                  ),
                }))}
              />
            ) : (
              <p className="text-[13px] font-medium text-ink-soft">{SIZE_LABELS[current]} reçetesi</p>
            )}
            <RecipeLinesEditor rows={rows[current]} onChange={setCurrentRows} kit={recipeKit} idPrefix={`yeni-${current}`} label={SIZE_LABELS[current]}>
              {others.map((x) => (
                <Button key={x} variant="ghost" onClick={() => copyFrom(x)}>
                  <Copy size={15} aria-hidden="true" /> {others.length === 1 ? "Diğer boydan kopyala" : COPY_FROM[x]}
                </Button>
              ))}
            </RecipeLinesEditor>
            <FormulaHelp params={kit.params} />
          </section>
        ) : (
          <p className="rounded-2xl bg-panel px-3.5 py-3 text-[13px] text-ink-mute">Reçeteyi yazmak için önce boy seçin.</p>
        )}

        <Field label="Yöneticiye not (isteğe bağlı)" htmlFor="yeni-urun-not" hint="Ör. “müşteriler soruyor”, “tadım için yaptık, çok beğenildi”.">
          <Textarea id="yeni-urun-not" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
