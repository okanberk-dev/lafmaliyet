"use client";

import { Pencil, Printer, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { SIZE_LABELS } from "@/lib/constants";
import { num } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";

interface Group {
  id: number;
  name: string;
  products: {
    name: string;
    variants: { id: number; size: "M" | "L" | "Tek"; note: string | null; lines: { name: string; qty: number; unit: string; packaging: boolean }[] }[];
  }[];
}

export function RecipeBook({ groups, canEdit }: { groups: Group[]; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const [showPack, setShowPack] = useState(false);

  const visible = groups
    .filter((g) => cat === null || g.id === cat)
    .map((g) => ({ ...g, products: g.products.filter((p) => matchesSearch(`${p.name} ${g.name}`, q)) }))
    .filter((g) => g.products.length);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-coffee-300" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCat(null)} className={cn("rounded-full px-3 py-1.5 text-xs font-medium", cat === null ? "bg-coffee-800 text-white" : "bg-coffee-100 text-coffee-800")}>
            Tümü
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setCat(g.id)}
              className={cn("rounded-full px-3 py-1.5 text-xs font-medium", cat === g.id ? "bg-coffee-800 text-white" : "bg-coffee-100 text-coffee-800 hover:bg-coffee-200")}
            >
              {g.name}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 px-2 text-sm text-coffee-700">
          <input type="checkbox" checked={showPack} onChange={(e) => setShowPack(e.target.checked)} className="accent-coffee-800" />
          Ambalajı göster
        </label>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer size={16} /> Yazdır
        </Button>
      </div>

      {visible.map((g) => (
        <section key={g.id}>
          <h2 className="mb-3 font-display text-xl font-semibold text-coffee-950">{g.name}</h2>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {g.products.map((p) => (
              <Card key={p.name} className="break-inside-avoid">
                <div className="flex items-center justify-between border-b border-coffee-100 px-4 py-3">
                  <h3 className="font-semibold text-coffee-950">{p.name}</h3>
                  {canEdit ? (
                    <Link href={`/panel/urunler/${p.variants[0].id}`} className="no-print rounded p-1 text-coffee-400 hover:bg-coffee-50 hover:text-coffee-800" aria-label="Reçeteyi düzenle">
                      <Pencil size={14} />
                    </Link>
                  ) : null}
                </div>
                <div className={cn("grid divide-coffee-100", p.variants.length > 1 ? "grid-cols-2 divide-x" : "grid-cols-1")}>
                  {p.variants.map((v) => (
                    <div key={v.id} className="px-4 py-3">
                      <Badge tone="coffee" className="mb-2">
                        {v.size === "Tek" ? "Tek boy" : SIZE_LABELS[v.size]}
                      </Badge>
                      <ul className="space-y-1 text-sm">
                        {v.lines
                          .filter((l) => showPack || !l.packaging)
                          .map((l, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className={cn("text-coffee-800", l.packaging && "text-coffee-500")}>{l.name}</span>
                              <span className={cn("shrink-0 font-semibold tabular", l.qty === 0 && "text-amber-700")}>
                                {l.qty === 0 ? "?" : `${num(l.qty, 1)} ${l.unit}`}
                              </span>
                            </li>
                          ))}
                      </ul>
                      {v.note ? <p className="mt-2 text-xs text-coffee-500">{v.note}</p> : null}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
