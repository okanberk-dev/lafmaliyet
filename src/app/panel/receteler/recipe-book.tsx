"use client";

import { BookOpen, CircleHelp, Pencil, SearchX } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconLink } from "@/components/ui/button";
import { Card, Well } from "@/components/ui/card";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { EmptyState, InfoTip, SectionTitle } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { SIZE_LABELS } from "@/lib/constants";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

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
/** Bir boyda miktarı girilmemiş (0) malzeme var mı: kartta turuncu "?" ile görünür */
const hasMissing = (p: Product) => p.variants.some((v) => v.lines.some((l) => l.qty === 0));

const ALL = "all";
/** Adresteki süzgeç anahtarları (Temizle hepsini birden sıfırlar) */
const QUERY_KEYS = ["ara", "kategori", "eksik"];

/**
 * Barda telefonla kullanılan reçete defteri: üstte yapışkan arama, kategori çipleri ve ambalaj anahtarı;
 * altta ürün başına boyları yan yana gösteren reçete kartları. Süzgeçler adreste durur (paylaşılabilir).
 */
export function RecipeBook({ groups, canEdit }: { groups: RecipeGroup[]; canEdit: boolean }) {
  const reduce = useCalmMotion();
  const [q, setQ] = useQueryText("ara");
  const [cat, setCat] = useQueryState<string>("kategori", ALL);
  const [missingParam, setMissing] = useQueryState<string>("eksik", "0");
  const [packParam, setPack] = useQueryState<string>("ambalaj", "0");
  const [switched, setSwitched] = useState(false);
  const onlyMissing = canEdit && missingParam === "1";
  const showPack = packParam === "1";
  const barRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** Aramaya uyan ürünler (çiplerdeki sayılar için, kategori ve "miktarı eksik" seçiminden önce) */
  const searched = useMemo(
    () => groups.map((g) => ({ ...g, products: g.products.filter((p) => matches(searchText(p, g.name), q)) })),
    [groups, q],
  );
  const matched = onlyMissing ? searched.map((g) => ({ ...g, products: g.products.filter(hasMissing) })) : searched;
  // Adresteki kategori artık yoksa (ürünler taşındı) "Tümü"ne düşülür
  const activeCat = cat !== ALL && groups.some((g) => String(g.id) === cat) ? cat : ALL;
  const visible = matched.filter((g) => (activeCat === ALL || String(g.id) === activeCat) && g.products.length);
  const total = groups.reduce((a, g) => a + g.products.length, 0);
  const matchedTotal = matched.reduce((a, g) => a + g.products.length, 0);
  const shown = visible.reduce((a, g) => a + g.products.length, 0);
  /** Çip yalnızca miktarı eksik ürün varken görünür; sayısı aramaya uyar */
  const anyMissing = useMemo(() => groups.some((g) => g.products.some(hasMissing)), [groups]);
  const missingCount = searched.reduce((a, g) => a + g.products.filter(hasMissing).length, 0);
  const filtered = q.trim() !== "" || activeCat !== ALL || onlyMissing;

  /** Liste aşağı kaydırılmışken süzgeç değişirse yeni listenin başına dön (yapışkan çubuğun altına) */
  const toListTop = () => {
    const bar = barRef.current?.getBoundingClientRect().bottom ?? 0;
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    if (top < bar) window.scrollBy({ top: top - bar - 12, behavior: "auto" });
  };
  const clear = () => {
    setQ("");
    clearQuery(QUERY_KEYS);
    setSwitched(true);
    toListTop();
  };
  const pickCat = (v: string) => {
    setCat(v);
    setSwitched(true);
    toListTop();
  };

  if (!groups.length) {
    return (
      <Card>
        <EmptyState
          icon={<BookOpen />}
          title="Henüz reçete yok"
          description="Ürünlere reçete girildikçe burada boy boy listelenir."
          action={
            canEdit ? (
              <ButtonLink href="/panel/urunler" variant="secondary">
                Ürünlere git
              </ButtonLink>
            ) : null
          }
        />
      </Card>
    );
  }

  return (
    <div>
      {/* Barda telefonla kullanılır: arama ve kategori kaydırırken üstte kalır */}
      <div
        ref={barRef}
        className="no-print sticky top-14 z-20 -mx-4 mb-6 space-y-2.5 border-b border-line bg-background/90 px-4 pt-2 pb-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10 lg:pt-3"
      >
        {/* Yazdır düğmesi sayfa başlığında: telefonda arama kutusuna yer kalsın */}
        <div className="flex items-center gap-2">
          <SearchField className="flex-1" value={q} onChange={setQ} placeholder="Ürün, malzeme" label="Reçetelerde ürün ya da malzeme ara" />
          {/* Etiketin içindeki anahtar: yazıya dokunmak da açıp kapatır */}
          <label
            title="Bardak, kapak, pipet gibi ambalaj satırlarını göster"
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-surface pr-3 pl-2 text-[13px] font-medium text-ink-mute ring-1 ring-line-strong select-none ring-inset pointer-coarse:h-10"
          >
            <Switch checked={showPack} onChange={(v) => setPack(v ? "1" : "0")} label="Ambalajı göster" onText="Ambalaj görünüyor" offText="Ambalaj gizli" />
            <span className={cn("hidden sm:inline", showPack && "text-ink")}>Ambalajı göster</span>
            <span className={cn("sm:hidden", showPack && "text-ink")}>Ambalaj</span>
          </label>
        </div>
        <FilterBar active={filtered} onClear={clear} shown={filtered ? shown : undefined} total={filtered ? total : undefined} unit="ürün">
          {/* Telefon ve tablette tek satırda yana kayar (yapışkan çubuk alçak kalır), geniş ekranda alt satıra sarar */}
          <div
            role="group"
            aria-label="Kategori"
            className="-mx-4 flex min-w-0 basis-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:basis-[calc(100%+3rem)] sm:px-6 lg:mx-0 lg:flex-1 lg:basis-auto lg:flex-wrap lg:overflow-visible lg:px-0"
          >
            <FilterChip active={activeCat === ALL} onToggle={() => pickCat(ALL)} count={matchedTotal}>
              Tümü
            </FilterChip>
            {matched.map((g) => (
              <FilterChip
                key={g.id}
                active={activeCat === String(g.id)}
                onToggle={() => pickCat(activeCat === String(g.id) ? ALL : String(g.id))}
                count={g.products.length}
                className={cn(!g.products.length && activeCat !== String(g.id) && "opacity-50")}
              >
                {g.name}
              </FilterChip>
            ))}
            {canEdit && (anyMissing || onlyMissing) ? (
              <FilterChip
                active={onlyMissing}
                onToggle={() => {
                  setMissing(onlyMissing ? "0" : "1");
                  setSwitched(true);
                  toListTop();
                }}
                count={missingCount}
                className={onlyMissing ? undefined : "text-warn"}
              >
                <CircleHelp size={14} aria-hidden="true" /> Miktarı eksik
              </FilterChip>
            ) : null}
          </div>
        </FilterBar>
      </div>

      <div ref={listRef} />
      {visible.length ? (
        <motion.div
          key={`${activeCat}|${onlyMissing}`}
          className="space-y-8"
          initial={switched && !reduce ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
        >
          {visible.map((g) => (
            <section key={g.id} aria-label={g.name} className="scroll-mt-40">
              <SectionTitle actions={<span className="text-[13px] text-ink-mute tabular">{num(g.products.length)} ürün</span>}>{g.name}</SectionTitle>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {g.products.map((p) => (
                  <RecipeCard key={p.name} product={p} showPack={showPack} canEdit={canEdit} query={q} />
                ))}
              </div>
            </section>
          ))}
        </motion.div>
      ) : (
        <Card>
          <EmptyState
            icon={<SearchX />}
            title="Bu süzgece uyan reçete yok"
            description={
              q.trim()
                ? `"${q.trim()}" hiçbir ürün ya da malzeme adında geçmiyor. Yazımı kontrol edin ya da süzgeci temizleyip bütün kategorilere bakın.`
                : "Seçili kategoride gösterilecek ürün yok. Süzgeci temizleyip bütün kategorilere bakın."
            }
            action={
              <Button variant="secondary" onClick={clear}>
                Süzgeci temizle
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}

function RecipeCard({ product, showPack, canEdit, query }: { product: Product; showPack: boolean; canEdit: boolean; query: string }) {
  const multi = product.variants.length > 1;
  const rows = useMemo(() => mergeLines(product.variants), [product.variants]);
  const shown = rows
    .map((r) => ({ ...r, cells: r.cells.map((c) => (c && (showPack || !c.packaging) ? c : null)) }))
    .filter((r) => r.cells.some(Boolean));
  // Boyların aynı notu tek kez yazılır ("M = solo, L = doppio" iki boyda da aynı); farklıysa boy adıyla
  const notes = useMemo(() => {
    const byText = new Map<string, Size[]>();
    for (const v of product.variants) {
      const t = v.note?.trim();
      if (t) byText.set(t, [...(byText.get(t) ?? []), v.size]);
    }
    return [...byText.entries()].map(([text, sizes]) => ({
      text,
      label: multi && sizes.length < product.variants.length ? sizes.map((x) => SIZE_LABELS[x]).join(", ") : null,
    }));
  }, [product.variants, multi]);
  // Malzeme adıyla arandıysa (ürün adı uymuyorsa) eşleşen satır vurgulanır: "hangi üründe süt var?"
  const highlight = query.trim() !== "" && !matches(product.name, query);
  const hiddenPack = showPack ? 0 : rows.filter((r) => r.cells.every((c) => !c || c.packaging)).length;

  return (
    <Card className="break-inside-avoid">
      <div className="flex min-h-[3.25rem] items-center justify-between gap-3 px-5 pt-4 pb-2.5">
        <h3 className="min-w-0 text-base leading-6 font-semibold tracking-tight break-words text-ink">{product.name}</h3>
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
                  const hit = highlight && matches(r.name, query);
                  return (
                    <tr key={r.key} className={cn("border-b border-line last:border-0", hit && "bg-lime/20")}>
                      <td className={cn("px-3 py-2 align-top break-words", pack ? "text-ink-mute" : "text-ink", hit && "font-medium text-ink")}>{r.name}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-3 py-2 text-right align-top font-semibold whitespace-nowrap tabular">
                          {c === null ? (
                            <span className="font-normal text-ink-quiet">
                              <span aria-hidden="true">–</span>
                              <span className="sr-only">bu boyda yok</span>
                            </span>
                          ) : c.qty === 0 ? (
                            <span className="inline-flex items-center gap-1 text-warn">
                              ?<span className="sr-only"> miktar girilmemiş</span>
                              <InfoTip text={canEdit ? "Miktar girilmemiş. Kalemle reçeteyi açıp bu boyun miktarını yazın." : "Miktar girilmemiş. Yöneticiye haber verin."} />
                            </span>
                          ) : (
                            <span className={c.packaging ? "font-medium text-ink-mute" : "text-ink"}>
                              {num(c.qty, 3)} {c.unit}
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
                    {hiddenPack ? "Yalnızca ambalaj satırı var. Görmek için üstten “Ambalajı göster”i açın." : "Malzeme girilmemiş."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Well>
      </div>
      {notes.length ? (
        <div className="space-y-1 px-5 pb-4 text-[13px] leading-5 break-words text-ink-mute">
          {notes.map((n) => (
            <p key={n.text}>
              {n.label ? <span className="font-medium text-ink-soft">{n.label}: </span> : null}
              {n.text}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
