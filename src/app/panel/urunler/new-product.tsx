"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { fold, useQueryState } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS, SIZES } from "@/lib/constants";
import { createProduct } from "@/server/actions/products";

import { categoryFireDefault, copiedSummary, firePct, newProductFireHint, productHref } from "./logic";
import { priceText } from "./price-text";

/** Reçetesi kopyalanabilecek ürün (kopyalama listesi ve aynı ad + boy denetimi için) */
export interface ProductOption {
  id: number;
  name: string;
  size: string;
  label: string;
  categoryId?: number;
  active?: boolean;
  price?: number;
  /** Ürüne özel zayi oranı (boş = genel oran); yeni ürünün kategoriden alacağı oranı göstermek için */
  fireOverride?: number | null;
}

/**
 * Sayfa başlığındaki "Yeni ürün" düğmesi; kategori süzgeci açıksa o kategori seçili gelir. `/panel/urunler?yeni=1`
 * pencereyi açık getirir (Reçete defterinin "Yeni ürün"ü; denetim E-48); kapanınca adres temizlenir.
 */
export function NewProductButton({ categories, products }: { categories: { id: number; name: string }[]; products: ProductOption[] }) {
  const [open, setOpen] = useState(false);
  const [yeni, setYeni] = useQueryState<string>("yeni", "");
  const [kategori] = useQueryState<string>("kategori", "");
  const initialCategory = categories.find((c) => String(c.id) === kategori)?.id;
  const shown = open || yeni === "1";
  function close() {
    setOpen(false);
    if (yeni) setYeni("");
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> Yeni ürün
      </Button>
      {shown ? <NewProductDialog categories={categories} products={products} initialCategory={initialCategory} onClose={close} /> : null}
    </>
  );
}

/**
 * Yeni ürün penceresi. Her açılışta temiz başlar (açılınca bağlanır). Enter oluşturur, Esc kapatır.
 * Aynı ad + boyda ürün varsa daha göndermeden uyarır; kopyalanan ürünün fiyatı ve kategorisi öneri olarak gelir.
 */
export function NewProductDialog({
  categories,
  products,
  onClose,
  initialName = "",
  initialCategory,
}: {
  categories: { id: number; name: string }[];
  products: ProductOption[];
  onClose: () => void;
  initialName?: string;
  initialCategory?: number;
}) {
  const router = useRouter();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(initialName);
  const [size, setSize] = useState<Size>("M");
  const [categoryId, setCategoryId] = useState<number>(initialCategory ?? categories[0]?.id ?? 0);
  const [categoryTouched, setCategoryTouched] = useState(initialCategory !== undefined);
  const [price, setPrice] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState<string>("");
  // Listede seçili ay yeni ürünün kartına da taşınır
  const [ay] = useQueryState<string>("ay", "");

  // Kopyalama listesi kategori sırasıyla gruplanır; kategorisi bilinmeyenler en sona
  const known = new Set(categories.map((c) => c.id));
  const groups = [
    ...categories.map((c) => ({ key: String(c.id), label: c.name, items: products.filter((p) => p.categoryId === c.id) })),
    { key: "other", label: "Diğer", items: products.filter((p) => p.categoryId === undefined || !known.has(p.categoryId)) },
  ].filter((g) => g.items.length);

  const duplicate = name.trim() ? products.find((p) => p.size === size && fold(p.name.trim()) === fold(name.trim())) : undefined;
  // Kopyasız yeni ürünün zayi oranı: kategorideki en sık oran (sunucu da aynı kuralla yazar)
  const categoryFire = categoryFireDefault(products.filter((p) => p.categoryId === categoryId));

  function pickCopy(value: string) {
    setCopyFrom(value);
    const src = products.find((p) => String(p.id) === value);
    if (!src) return;
    if (!price.trim() && src.price !== undefined) setPrice(priceText(src.price));
    if (!categoryTouched && src.categoryId !== undefined && known.has(src.categoryId)) setCategoryId(src.categoryId);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const p = parseNumberTR(price);
    if (p === null || p < 0) {
      setPriceError("Geçerli bir fiyat girin (ör. 185 ya da 185,50)");
      document.getElementById("np-price")?.focus();
      return;
    }
    if (duplicate) return;
    setBusy(true);
    const res = await tryAction(() => createProduct({ name, size, categoryId, price: p, copyFromId: copyFrom ? Number(copyFrom) : null }));
    setBusy(false);
    // Atılan eylem (E-51): bildirim çıktı, pencere ve yazılanlar yerinde
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    if (copyFrom) toast.success(`${name.trim()} oluşturuldu`, { description: copiedSummary(res.data) });
    else
      toast.success(
        `${name.trim()} oluşturuldu, şimdi reçetesini girin`,
        res.data.fireOverride !== null ? { description: `Zayi oranı ${firePct(res.data.fireOverride)} yazıldı (bu kategorideki ürünlerin çoğunda böyle).` } : undefined,
      );
    onClose();
    router.push(productHref(res.data.id, /^\d{4}-\d{2}$/.test(ay) ? ay : null));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Yeni ürün"
      description="Ürünü oluşturduktan sonra reçete kartına malzemeleri eklersiniz."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy || !!duplicate}>
            {busy ? "Oluşturuluyor…" : "Oluştur ve reçeteye geç"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4 pb-3" noValidate>
        <Field
          label="Ürün adı"
          htmlFor="np-name"
          error={duplicate ? `“${duplicate.name} · ${duplicate.size}” zaten var. Başka bir boy seçin ya da adı değiştirin.` : undefined}
        >
          <Input
            id="np-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder="ör. Caramel Biscoff Latte"
            aria-invalid={duplicate ? true : undefined}
            data-autofocus="always"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Boy" htmlFor="np-size">
            <Select id="np-size" value={size} onChange={(e) => setSize(e.target.value as Size)}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} — {SIZE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Satış fiyatı (KDV dahil)" htmlFor="np-price" error={priceError} hint="Menüdeki fiyat; virgüllü yazabilirsiniz">
            <div className="relative">
              <NumberInput
                id="np-price"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPriceError(null);
                }}
                placeholder="ör. 185"
                required
                aria-invalid={priceError ? true : undefined}
                className="cell-input pr-7"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
            </div>
          </Field>
        </div>
        <Field label="Kategori" htmlFor="np-cat" hint={copyFrom ? undefined : newProductFireHint(categoryFire)}>
          <Select
            id="np-cat"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(Number(e.target.value));
              setCategoryTouched(true);
            }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Reçeteyi şu üründen kopyala (isteğe bağlı)"
          hint="Benzer bir ürünün malzemeleri, özel fire oranı ve notu hazır gelir; sonra değiştirirsiniz. Fiyat boşsa o ürünün fiyatı yazılır."
          htmlFor="np-copy"
        >
          <Select id="np-copy" value={copyFrom} onChange={(e) => pickCopy(e.target.value)}>
            <option value="">Boş reçete</option>
            {groups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.active === false ? " (pasif)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}
