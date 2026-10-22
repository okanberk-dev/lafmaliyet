"use client";

import { Check, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FilterChip, useQueryState } from "@/components/ui/filters";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { SIZE_LABELS, SIZES } from "@/lib/constants";
import { NEW_PRODUCT_NAME_MAX, newProductIssue, takenIssue, type ProductSize } from "@/lib/recipe-change";
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
 * Personelin yeni ürün önerisi: ad, kategori, boylar ve her boyun reçetesi (malzeme satırları "Değişiklik öner" ile
 * aynı düzenleyici), yöneticiye not. Fiyat ve maliyet yok: yönetici Reçete onayları'nda satış fiyatını yazıp onaylayınca
 * ürün açılır. Telefonda alttan açılan sayfa.
 */
function NewProductSheet({ kit, product, initialCategory, onClose }: { kit: ProposeKit; product: NewProductKit; initialCategory: number | null; onClose: () => void }) {
  const recipeKit = useRecipeKit(kit);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(initialCategory);
  const [sizes, setSizes] = useState<ProductSize[]>([]);
  const [active, setActive] = useState<ProductSize>("M");
  const [rows, setRows] = useState<Record<ProductSize, LineRow[]>>(() => ({ M: [blankRow()], L: [blankRow()], Tek: [blankRow()] }));
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
  const dirty = name.trim() !== "" || message.trim() !== "" || chosen.some((x) => filled(x) > 0);

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
        })),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Öneriniz yöneticiye gitti", {
        description: "Yönetici satış fiyatını yazıp onaylayınca ürün reçete defterine eklenir. Sonucu “Önerilerim”de görürsünüz.",
      });
      onClose();
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
      description="Menüde olmayan bir ürünü reçetesiyle önerin. Yönetici satış fiyatını yazıp onaylayınca ürün eklenir."
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
