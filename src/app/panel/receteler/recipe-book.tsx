"use client";

import { BookOpen, Pencil, Printer, SearchX } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, IconLink } from "@/components/ui/button";
import { Card, Well } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/form";
import { EmptyState, SectionTitle } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SIZE_LABELS } from "@/lib/constants";
import { num } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";

type Size = "M" | "L" | "Tek";
type Line = { name: string; qty: number; unit: string; packaging: boolean };
type Variant = { id: number; size: Size; note: string | null; lines: Line[] };
type Product = { name: string; variants: Variant[] };

/** Sunucudan gelen veri yalnızca ad, boy, miktar ve not taşır; maliyet bilgisi bu bileşene hiç ulaşmaz. */
export interface RecipeGroup {
  id: number;
  name: string;
  products: Product[];
}

/** Boylar yan yana: aynı malzeme tek satırda, her boyun miktarı kendi sütununda */
type Row = { key: string; name: string; cells: (Line | null)[] };

function mergeLines(variants: Variant[]): Row[] {
  const rows: Row[] = [];
  const index = new Map<string, number>();
  variants.forEach((v, vi) => {
    // Aynı malzeme bir boyda iki kez geçerse ayrı satır kalsın
    const seen = new Map<string, number>();
    for (const l of v.lines) {
      const n = (seen.get(l.name) ?? 0) + 1;
      seen.set(l.name, n);
      const key = `${l.name}#${n}`;
      let ri = index.get(key);
      if (ri === undefined) {
        ri = rows.length;
        index.set(key, ri);
        rows.push({ key, name: l.name, cells: variants.map(() => null) });
      }
      rows[ri].cells[vi] = l;
    }
  });
  return rows;
}

const searchText = (p: Product, group: string) => `${p.name} ${group} ${p.variants.flatMap((v) => v.lines.map((l) => l.name)).join(" ")}`;

const ALL = "all";

/**
 * Barda telefonla kullanılan reçete defteri: üstte yapışkan arama, kategori seçimi (yaylı kayan vurgu)
 * ve ambalaj anahtarı; altta ürün başına boyları yan yana gösteren reçete kartları.
 */
export function RecipeBook({ groups, canEdit }: { groups: RecipeGroup[]; canEdit: boolean }) {
  const reduce = useCalmMotion();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [showPack, setShowPack] = useState(false);
  const [switched, setSwitched] = useState(false);

  /** Aramaya uyan ürünler, kategori seçiminden önce (seçimdeki sayılar için) */
  const matched = useMemo(
    () => groups.map((g) => ({ ...g, products: g.products.filter((p) => matchesSearch(searchText(p, g.name), q)) })),
    [groups, q],
  );
  const visible = matched.filter((g) => (cat === ALL || String(g.id) === cat) && g.products.length);
  const total = matched.reduce((a, g) => a + g.products.length, 0);

  if (!groups.length) {
    return (
      <Card>
        <EmptyState icon={<BookOpen />} title="Henüz reçete yok" description="Ürünlere reçete girildikçe burada boy boy listelenir." />
      </Card>
    );
  }

  return (
    <div>
      {/* Barda telefonla kullanılır: arama ve kategori kaydırırken üstte kalır */}
      <div className="no-print sticky top-14 z-20 -mx-4 mb-6 space-y-2.5 border-b border-line bg-background/90 px-4 pt-2 pb-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10 lg:pt-3">
        <div className="flex items-center gap-2">
          <SearchInput
            wrapperClassName="min-w-0 flex-1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ürün ya da malzeme ara…"
            aria-label="Reçetelerde ara"
          />
          {/* Etiketin içindeki anahtar: yazıya dokunmak da açıp kapatır */}
          <label
            title="Bardak, kapak, pipet gibi ambalaj satırlarını göster"
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-surface pr-3 pl-2 text-[13px] font-medium text-ink-mute ring-1 ring-inset ring-line-strong select-none"
          >
            <Switch checked={showPack} onChange={setShowPack} label="Ambalajı göster" onText="Ambalaj görünüyor" offText="Ambalaj gizli" />
            <span className={cn("hidden sm:inline", showPack && "text-ink")}>Ambalajı göster</span>
            <span className={cn("sm:hidden", showPack && "text-ink")}>Ambalaj</span>
          </label>
          <Button variant="secondary" onClick={() => window.print()} aria-label="Yazdır" className="max-sm:px-2.5">
            <Printer size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Yazdır</span>
          </Button>
        </div>
        <Segmented
          label="Kategori"
          value={cat}
          onChange={(v) => {
            setCat(v);
            setSwitched(true);
          }}
          options={[{ value: ALL, label: "Tümü", count: total }, ...matched.map((g) => ({ value: String(g.id), label: g.name, count: g.products.length }))]}
        />
      </div>

      {visible.length ? (
        <motion.div
          key={cat}
          className="space-y-8"
          initial={switched && !reduce ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
        >
          {visible.map((g) => (
            <section key={g.id} aria-label={g.name}>
              <SectionTitle actions={<span className="text-[13px] text-ink-mute tabular">{g.products.length} ürün</span>}>{g.name}</SectionTitle>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {g.products.map((p) => (
                  <RecipeCard key={p.name} product={p} showPack={showPack} canEdit={canEdit} />
                ))}
              </div>
            </section>
          ))}
        </motion.div>
      ) : (
        <Card>
          <EmptyState
            icon={<SearchX />}
            title="Bu aramaya uyan reçete yok"
            description="Başka bir ürün ya da malzeme adı deneyin veya bütün kategorilere bakın."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQ("");
                  setCat(ALL);
                }}
              >
                Filtreleri temizle
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}

function RecipeCard({ product, showPack, canEdit }: { product: Product; showPack: boolean; canEdit: boolean }) {
  const multi = product.variants.length > 1;
  const rows = useMemo(() => mergeLines(product.variants), [product.variants]);
  const shown = rows
    .map((r) => ({ ...r, cells: r.cells.map((c) => (c && (showPack || !c.packaging) ? c : null)) }))
    .filter((r) => r.cells.some(Boolean));
  const notes = product.variants.filter((v) => v.note);

  return (
    <Card className="break-inside-avoid">
      <div className="flex min-h-[3.25rem] items-center justify-between gap-3 px-5 pt-4 pb-2.5">
        <h3 className="min-w-0 text-base leading-6 font-semibold tracking-tight text-ink">{product.name}</h3>
        {canEdit ? (
          <IconLink href={`/panel/urunler/${product.variants[0].id}`} label={`${product.name} reçetesini düzenle`} className="no-print">
            <Pencil size={15} />
          </IconLink>
        ) : null}
      </div>
      <div className="px-3 pb-3">
        <Well className="px-1 py-1 ring-1 ring-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="border-b border-line-strong px-3 py-2 text-left text-[13px] font-semibold text-ink-soft">
                  Malzeme
                </th>
                {product.variants.map((v) => (
                  <th key={v.id} scope="col" className="w-[1%] border-b border-line-strong px-3 py-2 text-right whitespace-nowrap">
                    <Badge tone="gray">{SIZE_LABELS[v.size]}</Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((r) => {
                  const pack = r.cells.some((c) => c?.packaging);
                  return (
                    <tr key={r.key} className="border-b border-line last:border-0">
                      <td className={cn("px-3 py-2 align-top", pack ? "text-ink-mute" : "text-ink")}>{r.name}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-3 py-2 text-right align-top font-semibold whitespace-nowrap tabular">
                          {c === null ? (
                            <span className="font-normal text-ink-quiet">
                              <span aria-hidden="true">–</span>
                              <span className="sr-only">bu boyda yok</span>
                            </span>
                          ) : c.qty === 0 ? (
                            <span className="text-warn" title="Miktar girilmemiş">
                              ?<span className="sr-only"> miktar girilmemiş</span>
                            </span>
                          ) : (
                            <span className={c.packaging ? "font-medium text-ink-mute" : "text-ink"}>
                              {num(c.qty, 1)} {c.unit}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={product.variants.length + 1} className="px-3 py-3 text-[13px] text-ink-mute">
                    Malzeme girilmemiş.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Well>
      </div>
      {notes.length ? (
        <div className="space-y-1 px-5 pb-4 text-[13px] leading-5 text-ink-mute">
          {notes.map((v) => (
            <p key={v.id}>
              {multi ? <span className="font-medium text-ink-soft">{SIZE_LABELS[v.size]}: </span> : null}
              {v.note}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
