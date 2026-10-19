"use client";

import { Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PriceLine } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Ingredient } from "@/lib/calc/types";
import { COUNT_GROUPS, COUNT_UNITS, INGREDIENT_CATEGORIES, UNITS } from "@/lib/constants";
import { dateTR, num, pct, tl, tlUnit } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { deleteIngredient, saveIngredient, updateIngredientPrice } from "@/server/actions/ingredients";

export interface IngredientRow extends Ingredient {
  unitCost: number;
  usedIn: { id: number; label: string }[];
  monthUsage: number;
  history: { at: string; price: number; size: number; by: string | null }[];
}

const catOrder = (c: string) => {
  const i = INGREDIENT_CATEGORIES.indexOf(c);
  return i < 0 ? 99 : i;
};

function PackagePriceCell({ row }: { row: IngredientRow }) {
  const [value, setValue] = useState(num(row.packagePrice, 2));
  const [last, setLast] = useState(row.packagePrice);
  const [saving, setSaving] = useState(false);
  if (row.priceSource === "water") return <span className="text-xs text-sky-700">su faturasından</span>;
  async function commit() {
    const v = parseNumberTR(value);
    if (v === null || v < 0) {
      setValue(num(last, 2));
      return toast.error("Geçerli bir fiyat girin");
    }
    if (Math.abs(v - last) < 0.0001) return setValue(num(v, 2));
    setSaving(true);
    const res = await updateIngredientPrice(row.id, v);
    setSaving(false);
    if (!res.ok) {
      setValue(num(last, 2));
      return toast.error(res.error);
    }
    setLast(v);
    setValue(num(v, 2));
    toast.success(`${row.name}: yeni paket fiyatı ${tl(v, 2)}. ${row.usedIn.length} ürünün maliyeti güncellendi.`);
  }
  return (
    <NumberInput
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setValue(num(last, 2));
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label={`${row.name} paket fiyatı`}
      className="cell-input h-8 w-28 border-transparent bg-transparent px-2 hover:border-coffee-200 focus:bg-white"
    />
  );
}

export function IngredientsClient({ rows, initialFilter }: { rows: IngredientRow[]; initialFilter: string | null }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("");
  const [filter, setFilter] = useState<string>(initialFilter ?? "");
  const [editing, setEditing] = useState<IngredientRow | "new" | null>(null);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort((a, b) => catOrder(a) - catOrder(b)), [rows]);
  const visible = rows
    .filter(
      (r) =>
        (filter === "pasif" ? !r.active : r.active) &&
        (!category || r.category === category) &&
        (filter !== "tahmini" || r.isEstimate) &&
        (filter !== "kullanilmayan" || !r.usedIn.length) &&
        matchesSearch(`${r.name} ${r.supplier ?? ""} ${r.packageDesc ?? ""}`, q),
    )
    .sort((a, b) => catOrder(a.category) - catOrder(b.category) || a.name.localeCompare(b.name, "tr"));

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-coffee-100 p-3">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-coffee-300" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Malzeme, tedarikçi ara…" className="pl-9" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto min-w-40" aria-label="Kategori">
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto min-w-44" aria-label="Filtre">
          <option value="">Tümü</option>
          <option value="tahmini">Tahmini fiyatlılar</option>
          <option value="kullanilmayan">Reçetede olmayanlar</option>
          <option value="pasif">Pasif malzemeler</option>
        </Select>
        <Button onClick={() => setEditing("new")}>
          <Plus size={16} /> Yeni hammadde
        </Button>
      </div>
      {visible.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Malzeme</TH>
                <TH>Tedarikçi</TH>
                <TH>Paket</TH>
                <TH numeric>
                  Paket fiyatı <InfoTip text="KDV hariç, iskonto düşülmüş. Yeni fatura geldiğinde sadece bunu değiştirin; Enter ile kaydedilir." className="ml-1" />
                </TH>
                <TH numeric>İçerik</TH>
                <TH numeric>
                  Birim maliyet <InfoTip text="Paket fiyatı ÷ paket içeriği: 1 gr / 1 ml / 1 adet malzemenin maliyeti. Reçeteler bunu kullanır." className="ml-1" />
                </TH>
                <TH numeric>Alış KDV</TH>
                <TH numeric>Reçete</TH>
                <TH numeric>Son ay kullanım</TH>
              </tr>
            </THead>
            <tbody>
              {visible.map((r) => (
                <TR key={r.id} className={cn(r.isEstimate && "bg-amber-50/40")}>
                  <TD className="min-w-52">
                    <button type="button" className="text-left" onClick={() => setEditing(r)}>
                      <span className="font-medium text-coffee-950 hover:underline">{r.name}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        <span className="text-xs text-coffee-500">{r.category}</span>
                        {r.isEstimate ? <Badge tone="amber">Tahmini</Badge> : null}
                        {!r.usedIn.length ? <Badge tone="gray">Reçetede yok</Badge> : null}
                      </span>
                    </button>
                  </TD>
                  <TD className="text-coffee-700">{r.supplier ?? "–"}</TD>
                  <TD className="max-w-56 truncate text-coffee-700" title={r.packageDesc ?? ""}>
                    {r.packageDesc ?? "–"}
                  </TD>
                  <TD numeric>
                    <PackagePriceCell row={r} />
                  </TD>
                  <TD numeric>
                    {num(r.packageSize)} {r.unit}
                  </TD>
                  <TD numeric className="font-medium">
                    {tlUnit(r.unitCost)}
                    <span className="text-xs font-normal text-coffee-500">/{r.unit}</span>
                  </TD>
                  <TD numeric>{pct(r.vatRate, 0)}</TD>
                  <TD numeric>{r.usedIn.length ? r.usedIn.length : <span className="text-coffee-300">0</span>}</TD>
                  <TD numeric className="text-coffee-600">
                    {r.monthUsage ? `${num(r.monthUsage)} ${r.unit}` : "–"}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <EmptyState title="Malzeme bulunamadı" />
      )}
      <div className="border-t border-coffee-100 px-4 py-2.5 text-xs text-coffee-500">
        {visible.length} malzeme · Sarı zemin: faturada bulunamayan, tahmini değer. Gerçek değeri yazınca işaret kalkar.
      </div>
      {editing ? <IngredientDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} categories={categories} /> : null}
    </Card>
  );
}

function IngredientDialog({ row, onClose, categories }: { row: IngredientRow | null; onClose: () => void; categories: string[] }) {
  const [f, setF] = useState({
    name: row?.name ?? "",
    category: row?.category ?? "Diğer",
    supplier: row?.supplier ?? "",
    packageDesc: row?.packageDesc ?? "",
    packagePrice: num(row?.packagePrice ?? 0, 2),
    packageSize: num(row?.packageSize ?? 1000, 3),
    unit: row?.unit ?? "gr",
    vatRate: num((row?.vatRate ?? 0.01) * 100, 2),
    note: row?.note ?? "",
    isEstimate: row?.isEstimate ?? false,
    priceSource: row?.priceSource ?? "manual",
    countUnit: row?.countUnit ?? "",
    countGroup: row?.countGroup ?? "",
    active: row?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const price = parseNumberTR(f.packagePrice) ?? 0;
  const size = parseNumberTR(f.packageSize) ?? 0;
  const allCats = [...new Set([...INGREDIENT_CATEGORIES, ...categories])];

  async function save() {
    setBusy(true);
    const res = await saveIngredient({
      id: row?.id ?? null,
      name: f.name,
      category: f.category,
      supplier: f.supplier,
      packageDesc: f.packageDesc,
      packagePrice: price,
      packageSize: size,
      unit: f.unit as "gr",
      vatRate: (parseNumberTR(f.vatRate) ?? 0) / 100,
      note: f.note,
      isEstimate: f.isEstimate,
      priceSource: f.priceSource as "manual",
      countUnit: (f.countUnit || null) as "KG" | null,
      countGroup: f.countGroup || null,
      active: f.active,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(row ? "Malzeme güncellendi" : "Malzeme eklendi; artık reçetelerde seçilebilir");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} size="xl" title={row ? row.name : "Yeni hammadde"} description={row ? `${row.category} · ${row.usedIn.length} üründe kullanılıyor` : "Eklediğiniz malzeme reçete kartlarındaki listede çıkar."}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Malzeme adı" htmlFor="i-name">
            <Input id="i-name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategori" htmlFor="i-cat">
              <Select id="i-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
                {allCats.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tedarikçi" htmlFor="i-sup">
              <Input id="i-sup" value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} />
            </Field>
          </div>
          <Field label="Paket açıklaması" htmlFor="i-pack" hint="ör. Espresso Blend 1 kg">
            <Input id="i-pack" value={f.packageDesc} onChange={(e) => set({ packageDesc: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Paket fiyatı (₺)" htmlFor="i-price" hint="KDV hariç">
              <NumberInput id="i-price" value={f.packagePrice} onChange={(e) => set({ packagePrice: e.target.value })} disabled={f.priceSource === "water"} className="cell-input" />
            </Field>
            <Field label="Paket içeriği" htmlFor="i-size">
              <NumberInput id="i-size" value={f.packageSize} onChange={(e) => set({ packageSize: e.target.value })} className="cell-input" />
            </Field>
            <Field label="Birim" htmlFor="i-unit">
              <Select id="i-unit" value={f.unit} onChange={(e) => set({ unit: e.target.value as "gr" })}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="rounded-lg bg-coffee-50 px-3 py-2 text-sm">
            Birim maliyet: <strong>{size ? tlUnit(price / size) : "–"}</strong> / {f.unit}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Alış KDV oranı (%)" htmlFor="i-vat" hint="Gıda %1, ambalaj %20">
              <NumberInput id="i-vat" value={f.vatRate} onChange={(e) => set({ vatRate: e.target.value })} />
            </Field>
            <Field label="Fiyat kaynağı" htmlFor="i-src">
              <Select id="i-src" value={f.priceSource} onChange={(e) => set({ priceSource: e.target.value as "manual" })}>
                <option value="manual">Fatura / elle</option>
                <option value="water">Su faturasından (su, buz)</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sayım birimi" htmlFor="i-cu" hint="Boş = sayım listesinde yok">
              <Select id="i-cu" value={f.countUnit} onChange={(e) => set({ countUnit: e.target.value })}>
                <option value="">Sayılmaz</option>
                {COUNT_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="Sayım grubu" htmlFor="i-cg">
              <Select id="i-cg" value={f.countGroup} onChange={(e) => set({ countGroup: e.target.value })}>
                <option value="">—</option>
                {COUNT_GROUPS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Kaynak / not" htmlFor="i-note">
            <Textarea id="i-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={3} />
          </Field>
          <div className="flex flex-wrap gap-5">
            <Checkbox label="Tahmini fiyat (faturada yok)" checked={f.isEstimate} onChange={(e) => set({ isEstimate: e.target.checked })} />
            <Checkbox label="Aktif" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          </div>
        </div>
        <div className="space-y-4">
          {row && row.history.length ? (
            <div>
              <p className="mb-2 text-sm font-semibold">Birim maliyet geçmişi</p>
              <PriceLine data={row.history.map((h) => ({ label: dateTR(h.at.slice(0, 10)), value: h.size ? h.price / h.size : 0 }))} />
              <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-coffee-700">
                {[...row.history].reverse().map((h, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {dateTR(h.at.slice(0, 10))} · {h.by ?? "–"}
                    </span>
                    <span className="tabular">
                      {tl(h.price, 2)} / {num(h.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {row ? (
            <div>
              <p className="mb-2 text-sm font-semibold">Kullanıldığı ürünler ({row.usedIn.length})</p>
              {row.usedIn.length ? (
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                  {row.usedIn.map((u) => (
                    <Link key={u.id} href={`/panel/urunler/${u.id}`} className="rounded-md bg-coffee-50 px-2 py-1 text-xs text-coffee-800 hover:bg-coffee-100">
                      {u.label}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-coffee-500">Hiçbir reçetede yok.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between gap-2 border-t border-coffee-100 pt-4">
        {row ? (
          <Button
            variant="ghost"
            className="text-rose-700 hover:bg-rose-50"
            onClick={async () => {
              const res = await deleteIngredient(row.id);
              if (!res.ok) return toast.error(res.error);
              toast.success("Silindi");
              onClose();
            }}
          >
            <Trash2 size={16} /> Sil
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
