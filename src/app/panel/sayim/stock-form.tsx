"use client";

import { ClipboardCopy, Plus, Printer, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, NumberInput } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveStockCounts, saveStockExtras } from "@/server/actions/stock";

interface Line {
  id: number;
  name: string;
  packageDesc: string | null;
  countUnit: string;
  qty: number | null;
  prevQty: number | null;
  unitPrice: number;
  vatRate: number;
}

export function StockCountForm({
  month,
  monthLabel,
  isAdmin,
  groups,
  extras: initialExtras,
  hasPrev,
}: {
  month: string;
  monthLabel: string;
  isAdmin: boolean;
  groups: { name: string; lines: Line[] }[];
  extras: { name: string; unit: string; qty: number; unitPrice: number }[];
  hasPrev: boolean;
}) {
  const all = groups.flatMap((g) => g.lines);
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(all.map((l) => [l.id, l.qty === null ? "" : num(l.qty, 3)])),
  );
  const [extras, setExtras] = useState(initialExtras.map((e) => ({ name: e.name, unit: e.unit, qty: num(e.qty, 3), unitPrice: num(e.unitPrice, 2) })));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "empty">("all");

  const qtyOf = (id: number) => {
    const v = values[id];
    return v === undefined || v.trim() === "" ? null : parseNumberTR(v);
  };
  const dirty = all.some((l) => qtyOf(l.id) !== l.qty) || JSON.stringify(extras) !== JSON.stringify(initialExtras.map((e) => ({ name: e.name, unit: e.unit, qty: num(e.qty, 3), unitPrice: num(e.unitPrice, 2) })));
  const counted = all.filter((l) => qtyOf(l.id) !== null).length;
  const groupTotal = (g: { lines: Line[] }) => g.lines.reduce((a, l) => a + (qtyOf(l.id) ?? 0) * l.unitPrice, 0);
  const extrasTotal = extras.reduce((a, e) => a + (parseNumberTR(e.qty) ?? 0) * (parseNumberTR(e.unitPrice) ?? 0), 0);
  const total = groups.reduce((a, g) => a + groupTotal(g), 0) + extrasTotal;
  const totalVat = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + (qtyOf(l.id) ?? 0) * l.unitPrice * (1 + l.vatRate), 0), 0) + extrasTotal * 1.01;

  async function save() {
    const bad = all.find((l) => values[l.id]?.trim() && qtyOf(l.id) === null);
    if (bad) return toast.error(`${bad.name}: geçersiz miktar`);
    setBusy(true);
    const res = await saveStockCounts(
      month,
      all.filter((l) => qtyOf(l.id) !== l.qty).map((l) => ({ ingredientId: l.id, qty: qtyOf(l.id) })),
    );
    if (res.ok && isAdmin) {
      const ex = await saveStockExtras(
        month,
        extras.filter((e) => e.name.trim()).map((e) => ({ name: e.name, unit: e.unit || "ADET", qty: parseNumberTR(e.qty) ?? 0, unitPrice: parseNumberTR(e.unitPrice) ?? 0 })),
      );
      if (!ex.ok) toast.error(ex.error);
    }
    setBusy(false);
    if (res.ok) toast.success(`${monthLabel} sayımı kaydedildi`);
    else toast.error(res.error);
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="font-medium text-coffee-900">
              {counted} / {all.length} kalem sayıldı
            </span>
            <div className="flex rounded-lg bg-coffee-50 p-1">
              {(["all", "empty"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn("rounded-md px-3 py-1 text-xs font-medium", filter === f ? "bg-white shadow-sm" : "text-coffee-600")}
                >
                  {f === "all" ? "Tümü" : "Sayılmayanlar"}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {hasPrev ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setValues((v) => {
                      const next = { ...v };
                      for (const l of all) if (!next[l.id]?.trim() && l.prevQty !== null) next[l.id] = num(l.prevQty, 3);
                      return next;
                    });
                    toast.message("Boş satırlar geçen ayın sayımıyla dolduruldu");
                  }}
                >
                  <ClipboardCopy size={14} /> Geçen aydan doldur
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer size={14} /> Yazdır
              </Button>
            </div>
          </CardContent>
        </Card>
        {isAdmin ? (
          <Card>
            <CardContent className="py-3">
              <p className="text-xs font-medium text-coffee-600">Toplam stok (KDV hariç)</p>
              <p className="text-2xl font-semibold">{tl(total)}</p>
              <p className="text-xs text-coffee-500">KDV dahil {tl(totalVat)} · Gelir-giderde &quot;sonraki aya devreden mal&quot; olur</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {groups.map((g) => {
        const lines = g.lines.filter((l) => filter === "all" || qtyOf(l.id) === null);
        if (!lines.length) return null;
        return (
          <Card key={g.name} className="break-inside-avoid">
            <CardHeader title={g.name} actions={isAdmin ? <span className="text-sm font-semibold tabular">{tl(groupTotal(g))}</span> : null} className="py-3" />
            <ul className="divide-y divide-coffee-50">
              {lines.map((l) => {
                const q = qtyOf(l.id);
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="font-medium text-coffee-950">{l.name}</p>
                      <p className="truncate text-xs text-coffee-500">
                        {l.packageDesc}
                        {l.prevQty !== null ? ` · geçen ay ${num(l.prevQty, 3)} ${l.countUnit}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <NumberInput
                        value={values[l.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [l.id]: e.target.value }))}
                        placeholder="—"
                        aria-label={`${l.name} miktarı`}
                        className={cn("cell-input h-10 w-24 text-base sm:h-9 sm:text-sm", values[l.id]?.trim() && q === null && "border-rose-400 bg-rose-50")}
                      />
                      <span className="w-12 text-xs font-medium text-coffee-600">{l.countUnit}</span>
                    </div>
                    {isAdmin ? (
                      <div className="flex w-56 justify-end gap-4 text-right text-xs text-coffee-600 tabular">
                        <span>
                          {tl(l.unitPrice, 2)}/{l.countUnit}
                        </span>
                        <span className="w-24 font-semibold text-coffee-950">{q ? tl(q * l.unitPrice) : "–"}</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      {isAdmin ? (
        <Card>
          <CardHeader
            title="Listede olmayanlar"
            description="Hammaddelerde olmayan ama stokta duran kalemler (elle fiyatlı)."
            actions={
              <Button size="sm" variant="secondary" onClick={() => setExtras((x) => [...x, { name: "", unit: "ADET", qty: "", unitPrice: "" }])}>
                <Plus size={14} /> Kalem ekle
              </Button>
            }
          />
          <CardContent className="space-y-2">
            {extras.map((e, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input value={e.name} onChange={(ev) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, name: ev.target.value } : y)))} placeholder="Kalem adı" className="min-w-48 flex-1" />
                <Input value={e.unit} onChange={(ev) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, unit: ev.target.value } : y)))} className="w-24" aria-label="Birim" />
                <NumberInput value={e.qty} onChange={(ev) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, qty: ev.target.value } : y)))} placeholder="Miktar" className="cell-input w-24" />
                <NumberInput value={e.unitPrice} onChange={(ev) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, unitPrice: ev.target.value } : y)))} placeholder="Birim fiyat" className="cell-input w-28" />
                <button type="button" onClick={() => setExtras((x) => x.filter((_, j) => j !== i))} className="rounded p-2 text-coffee-400 hover:bg-rose-50 hover:text-rose-700" aria-label="Kaldır">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!extras.length ? <p className="text-sm text-coffee-500">Ek kalem yok.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className={cn("no-print fixed inset-x-0 bottom-0 z-20 border-t border-coffee-200 bg-white/95 backdrop-blur transition-transform lg:left-64", dirty ? "translate-y-0" : "translate-y-full")}>
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-sm text-coffee-700">
            {monthLabel} sayımında kaydedilmemiş değişiklik var
            {isAdmin ? ` · toplam ${tl(total)}` : ""}
          </p>
          <Button onClick={save} disabled={busy} size="lg">
            <Save size={18} /> {busy ? "Kaydediliyor…" : "Sayımı kaydet"}
          </Button>
        </div>
      </div>
    </div>
  );
}
