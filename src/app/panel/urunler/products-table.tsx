"use client";

import { ArrowDown, ArrowUp, ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NumberInput, Select } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { ProductStatus } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { num, pct, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { updateProductPrice } from "@/server/actions/products";

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
}

type SortKey = keyof Pick<
  ProductRow,
  "price" | "cost" | "unitProfit" | "margin" | "costRatio" | "suggestedPrice" | "soldQty" | "monthProfit" | "net" | "commission" | "totalCost" | "monthNet"
>;

const STATUSES: ProductStatus[] = ["İyi", "Dikkat", "Düşük kâr", "Reçete yok"];

function PriceCell({ row }: { row: ProductRow }) {
  const [value, setValue] = useState(num(row.price, 2));
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState(row.price);

  async function commit() {
    const v = parseNumberTR(value);
    if (v === null || v < 0) {
      toast.error("Geçerli bir fiyat girin");
      setValue(num(last, 2));
      return;
    }
    if (Math.abs(v - last) < 0.005) {
      setValue(num(v, 2));
      return;
    }
    setSaving(true);
    const res = await updateProductPrice(row.id, v);
    setSaving(false);
    if (res.ok) {
      setLast(v);
      setValue(num(v, 2));
      toast.success(`${row.name} ${row.size}: ${tl(v)}`);
    } else {
      toast.error(res.error);
      setValue(num(last, 2));
    }
  }

  return (
    <NumberInput
      aria-label={`${row.name} ${row.size} satış fiyatı`}
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
      className="cell-input h-8 w-24 border-transparent bg-transparent px-2 hover:border-coffee-200 focus:bg-white"
    />
  );
}

export function ProductsTable({
  rows,
  categories,
  monthLabel,
  target,
  initialCategory,
  initialStatus,
}: {
  rows: ProductRow[];
  categories: { id: number; name: string }[];
  monthLabel: string;
  target: number;
  initialCategory: number | null;
  initialStatus: string | null;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<number | null>(initialCategory);
  const [status, setStatus] = useState<string | null>(initialStatus && STATUSES.includes(initialStatus as ProductStatus) ? initialStatus : null);
  const [showInactive, setShowInactive] = useState(false);
  const [details, setDetails] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const filtered = useMemo(() => {
    let list = rows.filter(
      (r) =>
        (showInactive || r.active) &&
        (category === null || r.categoryId === category) &&
        (status === null || r.status === status) &&
        matchesSearch(`${r.name} ${r.size} ${r.category}`, q),
    );
    if (sort) list = [...list].sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir);
    return list;
  }, [rows, q, category, status, showInactive, sort]);

  const head = (key: SortKey, label: string, info?: string) => (
    <TH numeric>
      <button
        type="button"
        className="inline-flex items-center gap-1 uppercase hover:text-coffee-900"
        onClick={() => setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }))}
      >
        {label}
        {sort?.key === key ? sort.dir === -1 ? <ArrowDown size={12} /> : <ArrowUp size={12} /> : null}
      </button>
      {info ? <InfoTip text={info} className="ml-1" /> : null}
    </TH>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-coffee-100 p-3">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-coffee-300" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara…" className="pl-9" aria-label="Ürün ara" />
        </div>
        <Select value={category ?? ""} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : null)} className="w-auto min-w-44" aria-label="Kategori">
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={status ?? ""} onChange={(e) => setStatus(e.target.value || null)} className="w-auto min-w-36" aria-label="Durum">
          <option value="">Tüm durumlar</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button variant={details ? "secondary" : "outline"} size="md" onClick={() => setDetails((d) => !d)}>
          <SlidersHorizontal size={16} />
          {details ? "Sade görünüm" : "Tüm sütunlar"}
        </Button>
        <label className="flex items-center gap-2 px-2 text-sm text-coffee-700">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-coffee-800" />
          Pasifleri göster
        </label>
      </div>
      {filtered.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH className="sticky left-0 z-10 bg-coffee-50">Ürün</TH>
                <TH numeric>
                  Satış fiyatı <InfoTip text="KDV dahil menü fiyatı. Üzerine tıklayıp değiştirebilirsiniz; Enter ile kaydedilir." className="ml-1" />
                </TH>
                {details ? head("net", "Net satış", "Satış fiyatı ÷ (1 + KDV). Devlete ödenecek KDV çıktıktan sonra kasanıza kalan.") : null}
                {details ? head("commission", "POS kom.", "Satış fiyatı × banka komisyonu × kartlı satış oranı. Nakitte komisyon yoktur.") : null}
                {head("cost", "Maliyet", "Reçete kartındaki malzeme + ambalaj + fire payı (KDV hariç).")}
                {details ? head("totalCost", "Toplam maliyet", "Malzeme + ambalaj + POS komisyonu.") : null}
                {head("unitProfit", "Birim kâr", "Net satış − toplam maliyet. Bir adet satınca kira/personel öncesi elinize kalan.")}
                {head("margin", "Kâr marjı", "Birim kâr ÷ net satış.")}
                {head("costRatio", "Maliyet oranı", `Malzeme maliyeti ÷ net satış (food cost). Hedef ≤ %${num(target * 100)}.`)}
                {head("suggestedPrice", "Önerilen fiyat", "Maliyetin hedef orana denk geldiği KDV dahil fiyat, 5 ₺'ye yuvarlanmış.")}
                <TH>
                  Durum <InfoTip text="İyi = maliyet oranı hedefin altında. Dikkat = hedefin 10 puan üstüne kadar. Düşük kâr = daha fazlası." className="ml-1" />
                </TH>
                {head("soldQty", `${monthLabel} adet`, "Satış raporundan bu ürünle eşleşen adet.")}
                {head("monthProfit", `${monthLabel} brüt kâr`, "Birim kâr × satış adedi.")}
                {details ? head("monthNet", "Net ciro", "Net satış × satış adedi.") : null}
                {details ? <TH numeric>Fire</TH> : null}
              </tr>
            </THead>
            <tbody>
              {filtered.map((r) => (
                <TR key={r.id} className={cn(!r.active && "opacity-50")}>
                  <TD className="sticky left-0 z-[1] bg-white">
                    <Link href={`/panel/urunler/${r.id}`} className="group flex items-center gap-2">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium text-coffee-950 group-hover:underline">
                          {r.name}
                          <Badge tone="coffee" className="px-1.5 py-0 text-[11px]">
                            {r.size}
                          </Badge>
                          {r.hasEstimate ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Reçetesinde tahmini fiyatlı malzeme var" />
                          ) : null}
                        </span>
                        <span className="block text-xs text-coffee-500">{r.category}</span>
                      </span>
                    </Link>
                  </TD>
                  <TD numeric>
                    <PriceCell row={r} />
                  </TD>
                  {details ? <TD numeric>{tl(r.net, 2)}</TD> : null}
                  {details ? <TD numeric>{tl(r.commission, 2)}</TD> : null}
                  <TD numeric>{tl(r.cost, 2)}</TD>
                  {details ? <TD numeric>{tl(r.totalCost, 2)}</TD> : null}
                  <TD numeric className={cn(r.unitProfit < 0 && "text-rose-700")}>{tl(r.unitProfit, 2)}</TD>
                  <TD numeric>{pct(r.margin)}</TD>
                  <TD
                    numeric
                    className={cn(r.costRatio > target + 0.1 ? "text-rose-700" : r.costRatio > target ? "text-amber-700" : "text-emerald-700")}
                  >
                    {pct(r.costRatio)}
                  </TD>
                  <TD numeric>
                    <span className={cn("inline-flex items-center gap-1", r.price < r.suggestedPrice && "font-semibold text-coffee-950")}>
                      {r.price < r.suggestedPrice ? <ArrowUpRight size={14} className="text-rose-600" /> : null}
                      {tl(r.suggestedPrice)}
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD numeric>{r.soldQty ? num(r.soldQty) : <span className="text-coffee-300">0</span>}</TD>
                  <TD numeric>{r.soldQty ? tl(r.monthProfit) : <span className="text-coffee-300">–</span>}</TD>
                  {details ? <TD numeric>{r.soldQty ? tl(r.monthNet) : "–"}</TD> : null}
                  {details ? (
                    <TD numeric>
                      {pct(r.fireRate, 0)}
                      {r.fireOverridden ? <span className="ml-1 text-xs text-coffee-500">(özel)</span> : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <EmptyState title="Bu filtrelerle ürün bulunamadı" description="Aramayı veya filtreleri değiştirin." />
      )}
      <div className="border-t border-coffee-100 px-4 py-2.5 text-xs text-coffee-500">
        {filtered.length} ürün gösteriliyor · Sarı nokta: reçetede faturada bulunamayan, tahmini fiyatlı malzeme var.
      </div>
    </Card>
  );
}
