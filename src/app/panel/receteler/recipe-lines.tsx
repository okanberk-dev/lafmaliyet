"use client";

import { ArrowDown, ArrowUp, Plus, Sigma, StickyNote, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import type { Settings } from "@/lib/calc/types";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { num } from "@/lib/format";
import type { RecipeSnapshot } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";

import { catOrder } from "../hammaddeler/categories";
import { qtyText, resolveQty } from "../urunler/logic";

/**
 * Personelin reçete önerisindeki malzeme satırları: "Değişiklik öner" (change-editor.tsx) ve "Yeni ürün öner"
 * (new-product-sheet.tsx) aynı düzenleyiciyi kullanır. Fiyat ve maliyet yoktur; yalnız malzeme adı, birimi ve
 * formüllerin ölçüleri gelir.
 */
export interface ProposeKit {
  ingredients: { id: number; name: string; unit: string; category: string; active: boolean; packaging: boolean }[];
  /** Formüllerde kullanılan ölçüler (ShotCift = 18 gr …); yalnızca bunlar gönderilir */
  params: { name: string; key: string; label: string; unit: string; value: number }[];
}

export interface LineRow {
  key: number;
  ingredientId: number | null;
  input: string;
  note: string;
  noteOpen: boolean;
}

let seq = 1;
export const toRows = (snap: RecipeSnapshot): LineRow[] =>
  snap.items.map((l) => ({ key: seq++, ingredientId: l.ingredientId, input: qtyText(l.qty, l.qtyExpr), note: l.note ?? "", noteOpen: Boolean(l.note) }));
export const blankRow = (): LineRow => ({ key: seq++, ingredientId: null, input: "", note: "", noteOpen: false });
/** Başka boyun satırlarının kopyası (yeni anahtarlarla) */
export const copyRows = (rows: LineRow[]): LineRow[] => rows.map((r) => ({ ...r, key: seq++ }));

/** Önerinin hesap ortamı: formül ölçüleri (yalnız kit'tekiler), malzemeler ve kategoriye göre seçim listesi */
export function useRecipeKit(kit: ProposeKit) {
  const settings = useMemo(() => {
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const p of kit.params) out[p.key] = p.value;
    return out as unknown as Settings;
  }, [kit.params]);
  const ingById = useMemo(() => new Map(kit.ingredients.map((i) => [i.id, i])), [kit.ingredients]);
  const grouped = useMemo(() => {
    const m = new Map<string, ProposeKit["ingredients"]>();
    for (const i of kit.ingredients) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()]
      .sort(([a], [b]) => catOrder(a) - catOrder(b) || a.localeCompare(b, "tr"))
      .map(([cat, list]) => [cat, [...list].sort((a, b) => a.name.localeCompare(b.name, "tr"))] as const);
  }, [kit.ingredients]);
  /** Formül ölçülerinin birimleri (gr, ml): adet ve dilim satırına formül yazılmaz, "Formül" düğmesi orada çıkmaz */
  const formulaUnits = useMemo(() => new Set(kit.params.map((p) => p.unit)), [kit.params]);
  return { settings, ingById, grouped, formulaUnits };
}

export type RecipeKit = ReturnType<typeof useRecipeKit>;

/** Satırlardan kaydedilecek reçete; okunamayan satır varsa ilk hatası ("Medium: 2. satırda malzeme seçin") */
export function buildSnapshot(rows: LineRow[], note: string, kit: RecipeKit, label: string): { snap: RecipeSnapshot; error: string | null } {
  let error: string | null = null;
  const items = rows.map((r, i) => {
    const ing = r.ingredientId ? kit.ingById.get(r.ingredientId) : undefined;
    const q = resolveQty(r.input, kit.settings);
    if (!error && !ing) error = `${label}: ${i + 1}. satırda malzeme seçin`;
    if (!error && q.error) error = `${label} · ${ing?.name ?? `${i + 1}. satır`}: ${q.error}`;
    return { ingredientId: ing?.id ?? 0, name: ing?.name ?? "?", unit: ing?.unit ?? "", qty: q.qty, qtyExpr: q.expr, note: r.note.trim() || null };
  });
  return { snap: { note: note.trim() || null, items }, error };
}

/**
 * Malzeme satırları: malzeme seçimi, miktar (sayı ya da 2*ShotCift gibi formül), sıra ve satır notu; altta
 * "Malzeme ekle" ve çağıranın ek düğmeleri (`children`). Pasif malzeme yeni satıra seçilemez, satırda duruyorsa kalır.
 */
export function RecipeLinesEditor({
  rows,
  onChange,
  kit,
  idPrefix,
  label,
  children,
}: {
  rows: LineRow[];
  onChange: (fn: (rows: LineRow[]) => LineRow[]) => void;
  kit: RecipeKit;
  /** Alan kimliklerinin öneki (aynı sayfada iki düzenleyici çakışmasın) */
  idPrefix: string;
  /** Boy adı ("Medium"): liste etiketi */
  label: string;
  children?: ReactNode;
}) {
  /**
   * Telefonda miktar alanı rakam klavyesiyle açılır; formül (2*Pompa) yazmak için harfli klavye gerekir. Formüllü
   * satırlar kendiliğinden, "Formül" düğmesine basılan satırlar da harfli klavyeyle açılır (ürün kartındaki gibi).
   */
  const [textKeys, setTextKeys] = useState<ReadonlySet<number>>(() => new Set());
  const update = (key: number, patch: Partial<LineRow>) => onChange((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (idx: number, d: -1 | 1) =>
    onChange((rs) => {
      const j = idx + d;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  /**
   * "Formül": satırın miktar alanını harfli klavyeyle yeniden odaklar. Klavye türü odakta değişmez: inputMode
   * çizimi beklemeden alana yazılır, alan bırakılıp yeniden odaklanır. Hepsi dokunuşun içinde, eşzamanlı (iOS
   * klavyeyi yalnızca kullanıcı hareketi içindeki focus() ile açar). Eski sayı seçili gelir, yazılan formül onun
   * yerine geçer.
   */
  function formulaKeyboard(key: number, inputId: string) {
    setTextKeys((s) => new Set(s).add(key));
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    if (!el) return;
    el.inputMode = "text";
    el.blur();
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }
  return (
    <>
      <ul className="space-y-2" aria-label={`${label} malzemeleri`}>
        {rows.map((r, idx) => {
          const ing = r.ingredientId ? kit.ingById.get(r.ingredientId) : undefined;
          const q = resolveQty(r.input, kit.settings);
          const hintId = `${idPrefix}-${r.key}`;
          const qtyId = `${hintId}-miktar`;
          const textKeyboard = Boolean(q.expr) || textKeys.has(r.key);
          return (
            <li key={r.key} className="rounded-2xl bg-panel p-2.5 ring-1 ring-line">
              <div className="flex items-start gap-2">
                <Select
                  value={r.ingredientId ?? ""}
                  onChange={(e) => update(r.key, { ingredientId: e.target.value ? Number(e.target.value) : null })}
                  aria-label={`${idx + 1}. satır malzemesi`}
                  data-warn={!r.ingredientId ? "true" : undefined}
                  className="min-w-0 flex-1 font-medium"
                >
                  <option value="">Malzeme seçin…</option>
                  {kit.grouped.map(([cat, list]) => (
                    <optgroup key={cat} label={cat}>
                      {list.map((i) => (
                        <option key={i.id} value={i.id} disabled={!i.active && i.id !== r.ingredientId}>
                          {i.name}
                          {i.active ? "" : " (pasif)"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <IconButton
                  label={`${ing?.name ?? `${idx + 1}. satır`} satırını çıkar`}
                  tone="danger"
                  onClick={() => onChange((rs) => rs.filter((x) => x.key !== r.key))}
                  className="size-9"
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    id={qtyId}
                    value={r.input}
                    onChange={(e) => update(r.key, { input: e.target.value })}
                    // Rakam klavyesi; formülde (ya da "Formül" düğmesinden sonra) harfli klavye
                    inputMode={textKeyboard ? "text" : "decimal"}
                    autoComplete="off"
                    aria-label={`${ing?.name ?? `${idx + 1}. satır`} miktarı`}
                    aria-invalid={q.error ? true : undefined}
                    aria-describedby={hintId}
                    placeholder="0"
                    className="w-32 text-right tabular"
                  />
                  <span className="min-w-8 text-[13px] text-ink-mute">{ing?.unit ?? ""}</span>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <IconButton label="Yukarı taşı" disabled={idx === 0} onClick={() => move(idx, -1)}>
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton label="Aşağı taşı" disabled={idx === rows.length - 1} onClick={() => move(idx, 1)}>
                    <ArrowDown size={15} />
                  </IconButton>
                  <IconButton label={r.noteOpen ? "Satır notunu gizle" : "Satır notu ekle"} onClick={() => update(r.key, { noteOpen: !r.noteOpen })} className={cn(r.note && "text-ink")}>
                    <StickyNote size={15} />
                  </IconButton>
                </div>
              </div>
              <p id={hintId} className={cn("mt-1 text-xs", q.error ? "text-bad" : "text-ink-mute")}>
                {q.error ?? (q.expr ? `= ${num(q.qty, 3)} ${ing?.unit ?? ""}` : q.echo ? `${q.echo} olarak okundu` : "")}
              </p>
              {/* Yalnızca dokunmatikte: rakam klavyesinde harf ve * yok. Satırda yer olmadığı için miktarın altında. */}
              {!textKeyboard && (!ing || kit.formulaUnits.has(ing.unit)) ? (
                <button
                  type="button"
                  onClick={() => formulaKeyboard(r.key, qtyId)}
                  className="mt-2 hidden h-11 w-fit cursor-pointer items-center gap-1.5 rounded-xl bg-surface px-3 text-[13px] font-medium text-ink-mute ring-1 ring-line ring-inset focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none pointer-coarse:flex"
                  title="Miktara formül yazın (ör. 2*ShotCift): harfli klavye açılır"
                >
                  <Sigma size={14} aria-hidden="true" /> Formül
                </button>
              ) : null}
              {r.noteOpen ? (
                <Input
                  value={r.note}
                  onChange={(e) => update(r.key, { note: e.target.value })}
                  maxLength={300}
                  placeholder="Satır notu (ör. sıcak sütle)"
                  aria-label={`${ing?.name ?? `${idx + 1}. satır`} notu`}
                  className="mt-2"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => onChange((rs) => [...rs, blankRow()])}>
          <Plus size={15} /> Malzeme ekle
        </Button>
        {children}
      </div>
    </>
  );
}

/** Formül açıklaması: miktara sayı ya da formül yazılabilir; ölçüler Ayarlar'dan */
export function FormulaHelp({ params }: { params: ProposeKit["params"] }) {
  return (
    <details className="rounded-2xl bg-panel px-3.5 py-2.5 text-[13px] text-ink-mute">
      <summary className="cursor-pointer font-medium text-ink-soft">Formüller (ShotCift, Pompa…)</summary>
      <p className="mt-1.5">
        Miktara sayı ya da formül yazılabilir: “2*ShotCift”, “2*Pompa” (şurup), “1,5*PurePompa” (püre).{" "}
        {/* Telefonun rakam klavyesinde harf ve * yok: satırdaki "Formül" düğmesi harfli klavyeyi açar */}
        <span className="hidden pointer-coarse:inline">Harf ve * için satırdaki “Formül” düğmesine dokunun. </span>
        Ölçüler Ayarlar&apos;dan gelir:
      </p>
      <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {params.map((p) => (
          <li key={p.name}>
            <code className="font-mono text-info">{p.name}</code> = {num(p.value, 2)} {p.unit} · {p.label}
          </li>
        ))}
      </ul>
    </details>
  );
}
