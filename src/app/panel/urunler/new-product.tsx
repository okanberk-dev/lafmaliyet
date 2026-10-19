"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { SIZE_LABELS, SIZES } from "@/lib/constants";
import { createProduct } from "@/server/actions/products";

export function NewProductButton({
  categories,
  products,
}: {
  categories: { id: number; name: string }[];
  products: { id: number; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [size, setSize] = useState<"M" | "L" | "Tek">("M");
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 0);
  const [price, setPrice] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = parseNumberTR(price);
    if (p === null) return toast.error("Satış fiyatını girin");
    setBusy(true);
    const res = await createProduct({ name, size, categoryId, price: p, copyFromId: copyFrom ? Number(copyFrom) : null });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Ürün oluşturuldu, şimdi reçetesini girin");
    setOpen(false);
    router.push(`/panel/urunler/${res.data.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> Yeni ürün
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Yeni ürün" description="Ürünü oluşturduktan sonra reçete kartına malzemeleri eklersiniz.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Ürün adı" htmlFor="np-name">
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="ör. Caramel Biscoff Latte" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Boy" htmlFor="np-size">
              <Select id="np-size" value={size} onChange={(e) => setSize(e.target.value as "M" | "L" | "Tek")}>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} — {SIZE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Satış fiyatı (KDV dahil)" htmlFor="np-price">
              <NumberInput id="np-price" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="250" required />
            </Field>
          </div>
          <Field label="Kategori" htmlFor="np-cat">
            <Select id="np-cat" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reçeteyi şu üründen kopyala (isteğe bağlı)" hint="Benzer bir ürünün malzemeleri hazır gelir, sonra değiştirirsiniz." htmlFor="np-copy">
            <Select id="np-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Boş reçete</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Oluşturuluyor…" : "Oluştur ve reçeteye geç"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
